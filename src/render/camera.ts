/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/**
 * Gameplay and cinematic cameras. Broadcast, Dynamic and Tactical keep a fixed orientation each, so
 * "up" on the stick always means the same direction on screen. Smoothing is integrated in small
 * sub-steps so the camera path doesn't depend on frame rate. Safety rules: rise when a player
 * blocks the view of the ball, never end up inside a player, and stay inside the stadium bowl
 * (tested in tests/camera.test.ts).
 */

import * as THREE from 'three';
import { PitchConfig } from '../sim/config';
import { CameraMode } from '../game/settings';
import { clamp, damp, lerp } from '../core/math';
import { StadiumLayout, seatHeightAt, stadiumLayout } from './stadium';

/** Scripted camera shots that temporarily replace the gameplay camera (intro, replay, celebration, penalties…). */
export type Cinematic =
  | { kind: 'intro'; t: number }
  | { kind: 'replay'; angle: number; t: number }
  | { kind: 'celebrate'; t: number }
  | { kind: 'penShoot' }
  | { kind: 'penKeep' }
  | { kind: 'orbit'; t: number }
  | { kind: 'attract'; t: number };

/**
 * When does the goal-celebration shot (orbiting the scorer) end? As soon as the match leaves the goal
 * phase for anything but a replay (which sets its own shot). It used to end only at the kick-off, but
 * practice and the tutorial go straight back to open play after a goal, so the camera stayed orbiting
 * the scorer with the ball out of shot: the main cause of the "stuck tutorial" playtest report.
 * @param phase - the phase the match just entered
 */
export function celebrationShotEnds(phase: string): boolean {
  return phase !== 'goal' && phase !== 'replay';
}

/** What the camera follows each frame, from interpolated render positions (never the live simulation). */
export interface CameraInput {
  ball: THREE.Vector3;
  ballVel: THREE.Vector3;
  focus: THREE.Vector3 | null;
  /** Attacking direction of the human team (+1/-1). */
  attackDir: number;
  /** Optional cinematic subject (scorer). */
  subject?: THREE.Vector3 | null;
  /** All player positions (camera collision, ball-occlusion and zoom framing). */
  players?: readonly THREE.Vector3[];
  /** Home side line-up for the intro tracking shot. */
  lineup?: readonly THREE.Vector3[];
}

/** Player body as a vertical capsule for camera collision / occlusion. */
const BODY_R = 0.42,
  BODY_H = 1.9;
/** Closest distance in the ground plane between point (px,pz) and segment a→b (result in SEG; no allocation). */
const SEG = { d: 0, t: 0 };
function segPoint2(ax: number, az: number, bx: number, bz: number, px: number, pz: number): void {
  const dx = bx - ax,
    dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-6;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  const cx = ax + dx * t - px,
    cz = az + dz * t - pz;
  SEG.d = Math.sqrt(cx * cx + cz * cz);
  SEG.t = t;
}

/**
 * Football camera with smoothing tuned to keep the ball and the controlled player
 * readable without sudden motion. Gameplay modes keep a fixed orientation per mode
 * so controls stay consistent; cinematic modes are used for intros and replays.
 */
/** Camera smoothing integration sub-step (s). */
const CAM_SUBSTEP = 1 / 250;

/** Smoothing and framing knobs, adjustable in the movement lab (`?lab`); see {@link CAMERA_TUNING_DEFAULTS}. */
export interface CameraTuning {
  /** Follow-target smoothing rates (1/s) along the pitch (x) and across it (z). Higher = tighter. */
  targetRateX: number;
  targetRateZ: number;
  /** Multiplier on the position / aim smoothing rates. */
  posRateScale: number;
  /** Ball-velocity lead (s) along / across the pitch. */
  leadX: number;
  leadZ: number;
  /** Broadcast camera auto-zoom on/off. */
  autoZoom: boolean;
  /** Dynamic camera anchor smoothing rate (1/s). */
  dynamicRate: number;
  /** Movement lab: completely static camera (isolates player/ball motion from camera motion). */
  fixed: boolean;
}
/** The shipped camera tuning. The lab can override it without editing code (src/dev/tuning.ts). */
export const CAMERA_TUNING_DEFAULTS: CameraTuning = {
  targetRateX: 3.4,
  targetRateZ: 2.8,
  posRateScale: 1,
  leadX: 0.25,
  leadZ: 0.15,
  autoZoom: true,
  dynamicRate: 3.5,
  fixed: false,
};

/** Seconds of the intro spent on the player line-up before the aerial sweep. */
export const INTRO_LINEUP = 3;
/** Total intro length. */
export const INTRO_LENGTH = INTRO_LINEUP + 3.4;

/**
 * The game's camera: three gameplay modes with fixed orientations (so stick directions stay the same
 * on screen) plus cinematic shots. Updated once per display frame after interpolation, in small
 * sub-steps so its path doesn't depend on the frame rate. See the module comment for its safety rules.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'broadcast';
  cinematic: Cinematic | null = null;
  reduceMotion = false;
  private target = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private desiredPos = new THREE.Vector3();
  private snap = true;
  private fovBase = 38;
  private fovKick = 0;
  private shake = 0;
  private tmp = new THREE.Vector3();
  private layout: StadiumLayout;
  private introFrom = new THREE.Vector3();
  private replayFinish = false;
  private prevFocus = new THREE.Vector3();
  private prevDynAnchor = new THREE.Vector3();
  private dynAnchor = new THREE.Vector3();
  private prevDesired = new THREE.Vector3();
  private prevLook = new THREE.Vector3();
  private lookTmp = new THREE.Vector3();
  /** Tunable camera behaviour (movement lab / settings). */
  readonly tune = { ...CAMERA_TUNING_DEFAULTS };
  /** Smoothed broadcast zoom (fov) from how spread out the play around the ball is. */
  private zoomFov = 38;
  /** Smoothed height added when a player hides the ball / subject from a low camera. */
  private occlusionLift = 0;
  /** Exposed for tests / diagnostics: was the ball (or subject) hidden last frame? */
  occluded = false;

  constructor(
    private pitch: PitchConfig,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(this.fovBase, aspect, 0.3, 1200);
    this.camera.position.set(0, 20, pitch.width);
    this.layout = stadiumLayout(pitch);
  }

  setPitch(p: PitchConfig): void {
    this.pitch = p;
    this.layout = stadiumLayout(p);
    this.snap = true;
  }

  /** Keep a camera position inside the stadium bowl: above the seats, below the roof, in front of the back walls. */
  private constrain(v: THREE.Vector3): void {
    const l = this.layout;
    const roofFrontOffset = (l.sideBack - l.sideFront) * 0.25;
    const ax = Math.abs(v.x),
      az = Math.abs(v.z);
    if (az > l.sideFront - 1) {
      v.z = Math.sign(v.z) * Math.min(az, l.sideBack - 1.5);
      const d = Math.abs(v.z) - l.sideFront;
      v.y = Math.max(v.y, seatHeightAt(l, d) + 1.6);
      if (d > roofFrontOffset - 1) v.y = Math.min(v.y, l.roofY - 1.2);
    }
    if (ax > l.endFront - 1) {
      v.x = Math.sign(v.x) * Math.min(ax, l.endBack - 1.5);
      const d = Math.abs(v.x) - l.endFront;
      v.y = Math.max(v.y, seatHeightAt(l, d) + 1.6);
      if (d > roofFrontOffset - 1) v.y = Math.min(v.y, l.roofY - 1.2);
    }
  }

  /** Broadcast camera position for a target (shared with the intro so it lands exactly). */
  private broadcastPos(out: THREE.Vector3): THREE.Vector3 {
    const p = this.pitch;
    const L2 = p.length / 2;
    const l = this.layout;
    const scale = clamp(p.length / 66, 0.75, 1.6);
    const dist = Math.min((p.width / 2 + 17) * scale * 0.95, l.sideBack - 2);
    const h = Math.min(15 * scale, l.roofY - 1.5);
    out.set(clamp(this.target.x, -L2 * 0.78, L2 * 0.78), h, dist + this.target.z * 0.2);
    return out;
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the target next frame (after teleports / restarts). */
  cut(): void {
    this.snap = true;
    this.cuts++;
  }
  /** Number of hard cuts so far (diagnostics ignore motion across a cut). */
  cuts = 0;
  /** Where the camera is aiming (smoothed look-at point). */
  get aim(): THREE.Vector3 {
    return this.lookAt;
  }

  kick(amount: number): void {
    if (this.reduceMotion) return;
    this.fovKick = Math.max(this.fovKick, amount);
    this.shake = Math.max(this.shake, amount * 0.04);
  }

  /** Ground-plane axes for camera-relative controls. */
  groundAxes(): { fwd: { x: number; z: number }; right: { x: number; z: number } } {
    // Gameplay modes have fixed orientation, which keeps controls predictable.
    // Behind the goal looking out: screen-right is world -z.
    const ax = this.axes;
    const set = (fx: number, fz: number) => {
      ax.fwd.x = fx;
      ax.fwd.z = fz;
      ax.right.x = -fz;
      ax.right.z = fx;
      return ax;
    };
    if (this.cinematic?.kind === 'penKeep') return set(-1, 0);
    if (this.cinematic?.kind === 'penShoot') return set(1, 0);
    const d = this.camera.getWorldDirection(this.tmp);
    let fx = d.x,
      fz = d.z;
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    // Snap broadcast & tactical to the exact axes.
    if (this.mode !== 'dynamic' || !this.cinematic) {
      if (Math.abs(fz) > Math.abs(fx)) {
        fx = 0;
        fz = Math.sign(fz);
      } else {
        fz = 0;
        fx = Math.sign(fx);
      }
    }
    return set(fx, fz);
  }
  private axes = { fwd: { x: 1, z: 0 }, right: { x: 0, z: 1 } };

  update(dt: number, inp: CameraInput): void {
    const p = this.pitch;
    const L2 = p.length / 2,
      W2 = p.width / 2;
    const scale = clamp(p.length / 66, 0.75, 1.6);
    let fov = this.fovBase;
    let posRate = 3.2,
      lookRate = 4.5;

    // Action focus: ball, pulled slightly towards the controlled player, with velocity lead.
    const focus = this.tmp.copy(inp.ball);
    focus.y = 0;
    if (inp.focus) focus.lerp(inp.focus, 0.25);
    focus.x += clamp(inp.ballVel.x * this.tune.leadX, -5, 5);
    focus.z += clamp(inp.ballVel.z * this.tune.leadZ, -3, 3);
    // Smoothing is integrated in ≤4 ms sub-steps with the input interpolated across the frame, so the
    // camera follows the same path at 30, 60, 144 or 240 Hz and under irregular frame times.
    const n = Math.max(1, Math.ceil(dt / CAM_SUBSTEP)),
      h = dt / n;
    const pf = this.prevFocus;
    if (this.snap) pf.copy(focus);
    // Dynamic-camera anchor: between the controlled player and the ball, smoothed, so player switches
    // and long passes glide instead of swinging the camera (and the ball stays in frame).
    const df = inp.focus ?? inp.ball;
    const ax = df.x * 0.55 + inp.ball.x * 0.45,
      az = df.z * 0.55 + inp.ball.z * 0.45;
    const pa = this.prevDynAnchor;
    if (this.snap) {
      pa.set(ax, 0, az);
      this.dynAnchor.set(ax, 0, az);
    }
    const kd = damp(this.tune.dynamicRate, h);
    const kx = damp(this.tune.targetRateX, h),
      kz = damp(this.tune.targetRateZ, h);
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      this.target.x += (pf.x + (focus.x - pf.x) * u - this.target.x) * kx;
      this.target.z += (pf.z + (focus.z - pf.z) * u - this.target.z) * kz;
      this.dynAnchor.x += (pa.x + (ax - pa.x) * u - this.dynAnchor.x) * kd;
      this.dynAnchor.z += (pa.z + (az - pa.z) * u - this.dynAnchor.z) * kd;
    }
    pf.copy(focus);
    pa.set(ax, 0, az);
    this.target.y = 0;
    if (this.snap) this.target.copy(focus);

    const c = this.cinematic;
    const look = this.lookTmp.set(0, 0, 0);
    if (c) {
      if ('t' in c && c.kind !== 'replay') c.t += dt;
      switch (c.kind) {
        case 'intro': {
          const lineup = inp.lineup;
          if (lineup && lineup.length && c.t < INTRO_LINEUP) {
            // Player introductions: low dolly along the home side's kick-off line-up.
            let minX = Infinity,
              maxX = -Infinity,
              mz = 0;
            for (const v of lineup) {
              minX = Math.min(minX, v.x);
              maxX = Math.max(maxX, v.x);
              mz += v.z;
            }
            mz /= lineup.length;
            const u = c.t / INTRO_LINEUP;
            const x = lerp(minX - 2, maxX + 1, u * u * (3 - 2 * u));
            this.desiredPos.set(x, 1.9, Math.min(W2 - 1, mz + 11));
            look.set(x + 2.5, 1.1, mz);
            fov = 30;
            posRate = 6;
            lookRate = 6;
            if (c.t < 0.05) this.snap = true;
            break;
          }
          // Sweep from high above one goal down into the broadcast position.
          const t0 = lineup && lineup.length ? INTRO_LINEUP : 0;
          if (t0 && c.t - dt < t0) this.snap = true; // hard cut from the line-up to the aerial
          const u = clamp((c.t - t0) / 3.2, 0, 1);
          const e = u * u * (3 - 2 * u);
          this.introFrom.set(-L2 * 0.85, 30 * scale, -W2 * 0.4);
          const end = this.broadcastPos(new THREE.Vector3());
          this.desiredPos.lerpVectors(this.introFrom, end, e);
          this.desiredPos.y += Math.sin(e * Math.PI) * 6 * scale;
          look.set(lerp(-L2 * 0.4, 0, e), 0, 0);
          posRate = 20;
          lookRate = 20;
          break;
        }
        case 'attract': {
          const a = c.t * 0.06;
          this.desiredPos.set(Math.sin(a) * L2 * 0.8, 11 * scale + Math.sin(c.t * 0.13) * 3, Math.cos(a) * (this.layout.sideFront + 3));
          look.set(this.target.x * 0.5, 0, this.target.z * 0.5);
          posRate = 1.2;
          lookRate = 1.5;
          break;
        }
        case 'orbit': {
          const a = c.t * 0.12;
          this.desiredPos.set(Math.sin(a) * L2 * 0.85, 13 * scale, Math.cos(a) * (this.layout.sideFront + 2));
          look.set(0, 0, 0);
          posRate = 1.5;
          lookRate = 2;
          break;
        }
        case 'replay': {
          // t = seconds relative to the decisive strike (negative = build-up).
          const b = inp.ball;
          const goalX = Math.sign(b.x || inp.attackDir) * L2;
          const finish = c.t > 0.15;
          // Hard cut (not a pan) between the build-up and finish angles.
          if (finish !== this.replayFinish) {
            this.replayFinish = finish;
            this.snap = true;
          }
          if (!finish && c.angle % 2 === 0) {
            // Side-on tracking shot, slightly behind the play, framing ball and goal.
            this.desiredPos.set(b.x - Math.sign(goalX) * 6, 4.2, b.z + 12);
            look.set(lerp(b.x, goalX, 0.3), 0.6, b.z * 0.7);
            fov = 34;
          } else if (!finish) {
            // High, wide angle for the build-up.
            this.desiredPos.set(b.x - Math.sign(goalX) * 14, 10, b.z + 14);
            look.set(lerp(b.x, goalX, 0.4), 0, b.z * 0.5);
            fov = 36;
          } else {
            // Behind the goal for the strike and finish.
            this.desiredPos.set(goalX + Math.sign(goalX) * 5, 2.6, b.z * 0.25 + 1.5);
            look.set(b.x, Math.max(0.6, b.y), b.z);
            fov = 40;
          }
          posRate = finish ? 6 : 3;
          lookRate = 8;
          break;
        }
        case 'celebrate': {
          const s = inp.subject ?? inp.ball;
          const a = c.t * 0.35 + 0.8;
          this.desiredPos.set(s.x + Math.sin(a) * 5.5, 1.9, s.z + Math.cos(a) * 5.5);
          look.set(s.x, 1.2, s.z);
          posRate = 2.5;
          lookRate = 5;
          fov = 34;
          break;
        }
        case 'penShoot': {
          const sx = L2 - p.penaltySpot;
          this.desiredPos.set(sx - 7.5, 2.4, 0.6);
          look.set(L2, 1.1, 0);
          posRate = 4;
          lookRate = 4;
          fov = 40;
          break;
        }
        case 'penKeep': {
          this.desiredPos.set(L2 + 5.2, 2.3, 0);
          look.set(L2 - p.penaltySpot, 0.8, 0);
          posRate = 4;
          lookRate = 4;
          fov = 50;
          break;
        }
      }
    } else if (this.tune.fixed) {
      this.desiredPos.set(0, 14 * scale, W2 + 16 * scale);
      look.set(0, 0, 0);
      fov = 46;
      posRate = 1e3;
      lookRate = 1e3;
    } else {
      switch (this.mode) {
        case 'broadcast': {
          this.broadcastPos(this.desiredPos);
          look.set(clamp(this.target.x, -L2 * 0.85, L2 * 0.85), 0, this.target.z * 0.55);
          // Dynamic zoom: tighter when the play is compact around the ball, wider when it opens up
          // or the ball is moving fast (long passes / shots stay in frame).
          const base = 36 + (p.length > 80 ? 4 : 0);
          let spread = 10;
          if (inp.players) {
            let lo = inp.ball.x,
              hi = inp.ball.x;
            for (const v of inp.players) {
              if (Math.abs(v.x - inp.ball.x) > 24 || Math.abs(v.z - inp.ball.z) > 20) continue;
              lo = Math.min(lo, v.x);
              hi = Math.max(hi, v.x);
            }
            spread = hi - lo;
          }
          const speed = Math.hypot(inp.ballVel.x, inp.ballVel.z);
          const want = clamp(base - 6 + spread * 0.3 + Math.max(0, speed - 10) * 0.35, base - 6, base + 3);
          this.zoomFov += (want - this.zoomFov) * damp(this.snap ? 1e3 : 0.9, dt);
          fov = this.tune.autoZoom ? this.zoomFov : base;
          break;
        }
        case 'dynamic': {
          const f = this.dynAnchor;
          const d = inp.attackDir;
          this.desiredPos.set(f.x - d * 13, 8.5, f.z * 0.85);
          look.set(f.x + d * 7, 0.5, f.z * 0.9);
          posRate = 3.5;
          lookRate = 5;
          fov = 50;
          break;
        }
        case 'tactical': {
          const h = 34 * scale;
          this.desiredPos.set(clamp(this.target.x, -L2 * 0.7, L2 * 0.7), h, this.target.z * 0.3 + h * 0.62);
          look.set(clamp(this.target.x, -L2 * 0.75, L2 * 0.75), 0, this.target.z * 0.6);
          fov = 42;
          break;
        }
      }
    }

    // Ball / subject occlusion: if a player stands between a low camera and what it is framing, rise above them.
    const players = inp.players;
    if (players && this.desiredPos.y < 12) {
      const focusPt = c?.kind === 'celebrate' ? (inp.subject ?? inp.ball) : inp.ball;
      const fy = c?.kind === 'celebrate' ? 1.3 : Math.max(0.15, inp.ball.y);
      const cp = this.camera.position;
      let hidden = false;
      for (const v of players) {
        if (v === inp.subject) continue;
        segPoint2(cp.x, cp.z, focusPt.x, focusPt.z, v.x, v.z);
        const d = SEG.d,
          t = SEG.t;
        if (d > BODY_R + 0.12 || t <= 0.02 || t >= 0.97) continue;
        if (lerp(cp.y, fy, t) < BODY_H) {
          hidden = true;
          break;
        }
      }
      this.occluded = hidden;
      this.occlusionLift += ((hidden ? 2.4 : 0) - this.occlusionLift) * damp(hidden ? 2.5 : 0.8, dt);
      this.desiredPos.y += this.occlusionLift;
    } else {
      this.occluded = false;
      this.occlusionLift = 0;
    }
    this.constrain(this.desiredPos);
    const cam = this.camera;
    if (this.snap) {
      cam.position.copy(this.desiredPos);
      this.lookAt.copy(look);
      this.prevDesired.copy(this.desiredPos);
      this.prevLook.copy(look);
      this.snap = false;
    } else {
      const kp = damp(posRate * this.tune.posRateScale, h),
        kl = damp(lookRate * this.tune.posRateScale, h);
      const pd = this.prevDesired,
        pl = this.prevLook,
        d = this.desiredPos;
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        cam.position.x += (pd.x + (d.x - pd.x) * u - cam.position.x) * kp;
        cam.position.y += (pd.y + (d.y - pd.y) * u - cam.position.y) * kp;
        cam.position.z += (pd.z + (d.z - pd.z) * u - cam.position.z) * kp;
        this.lookAt.x += (pl.x + (look.x - pl.x) * u - this.lookAt.x) * kl;
        this.lookAt.y += (pl.y + (look.y - pl.y) * u - this.lookAt.y) * kl;
        this.lookAt.z += (pl.z + (look.z - pl.z) * u - this.lookAt.z) * kl;
      }
      pd.copy(d);
      pl.copy(look);
    }
    // Subtle shake for big moments (disabled with reduced motion).
    if (this.shake > 0 && !this.reduceMotion) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.15);
    }
    // Never inside a player: push the camera out of any body capsule it would clip.
    if (players && cam.position.y < BODY_H + 0.4) {
      for (const v of players) {
        const dx = cam.position.x - v.x,
          dz = cam.position.z - v.z;
        const d = Math.hypot(dx, dz),
          min = BODY_R + 0.55;
        if (d < min) {
          const k = d > 1e-4 ? min / d : 0;
          cam.position.x = d > 1e-4 ? v.x + dx * k : v.x + min;
          cam.position.z = d > 1e-4 ? v.z + dz * k : v.z;
        }
      }
    }
    cam.lookAt(this.lookAt);
    this.fovKick = Math.max(0, this.fovKick - dt * 6);
    const targetFov = fov + this.fovKick * 3;
    cam.fov += (targetFov - cam.fov) * damp(6, dt);
    cam.updateProjectionMatrix();
  }
}
