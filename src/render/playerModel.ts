/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Anim } from '../sim/player';
import { clamp, lerp, smoothstep } from '../core/math';
import { KICK_TIMING } from '../sim/config';

/**
 * Procedural footballer: rigid-skinned humanoid built from primitives and merged into a
 * single SkinnedMesh (one draw call per player). Animation is fully procedural.
 * Model space: faces +z, left side is +x, y up.
 */

export interface Kit {
  shirt: string;
  secondary: string;
  shorts: string;
  socks: string;
  skin: string;
  hair: string;
  boots: string;
  keeper: boolean;
  gloves: string;
}

const B = {
  hips: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  shL: 5,
  armL: 6,
  foreL: 7,
  handL: 8,
  shR: 9,
  armR: 10,
  foreR: 11,
  handR: 12,
  thighL: 13,
  shinL: 14,
  footL: 15,
  thighR: 16,
  shinR: 17,
  footR: 18,
} as const;
const BONE_COUNT = 19;
const HIP_Y = 0.98;

interface BoneDef {
  parent: number;
  pos: [number, number, number];
}
const BONES: BoneDef[] = [
  { parent: -1, pos: [0, HIP_Y, 0] },
  { parent: B.hips, pos: [0, 0.12, 0] },
  { parent: B.spine, pos: [0, 0.2, 0] },
  { parent: B.chest, pos: [0, 0.26, 0] },
  { parent: B.neck, pos: [0, 0.08, 0] },
  { parent: B.chest, pos: [0.2, 0.19, 0] },
  { parent: B.shL, pos: [0.03, 0, 0] },
  { parent: B.armL, pos: [0, -0.28, 0] },
  { parent: B.foreL, pos: [0, -0.25, 0] },
  { parent: B.chest, pos: [-0.2, 0.19, 0] },
  { parent: B.shR, pos: [-0.03, 0, 0] },
  { parent: B.armR, pos: [0, -0.28, 0] },
  { parent: B.foreR, pos: [0, -0.25, 0] },
  { parent: B.hips, pos: [0.1, -0.05, 0] },
  { parent: B.thighL, pos: [0, -0.44, 0] },
  { parent: B.shinL, pos: [0, -0.44, 0] },
  { parent: B.hips, pos: [-0.1, -0.05, 0] },
  { parent: B.thighR, pos: [0, -0.44, 0] },
  { parent: B.shinR, pos: [0, -0.44, 0] },
];

/** Model-space bind position of each bone. */
const BIND: THREE.Vector3[] = (() => {
  const out: THREE.Vector3[] = [];
  BONES.forEach((b, i) => {
    const v = new THREE.Vector3(...b.pos);
    if (b.parent >= 0) v.add(out[b.parent]);
    out[i] = v;
  });
  return out;
})();

function part(geo: THREE.BufferGeometry, bone: number, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  // Vertex colours are linear in the shader; convert from sRGB hex.
  const colors = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    si[i * 4] = bone;
    sw[i * 4] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function capsule(r: number, len: number, x: number, y: number, z: number, seg = 8): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, 3, seg);
  g.translate(x, y, z);
  return g;
}
function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, sz = 1, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  g.scale(1, 1, sz);
  g.translate(x, y, z);
  return g;
}
function sphere(r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ws = 12, hs = 8): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

export function buildPlayerGeometry(kit: Kit): THREE.BufferGeometry {
  const key = JSON.stringify(kit);
  const cached = geoCache.get(key);
  if (cached) return cached;
  const parts: THREE.BufferGeometry[] = [];
  const P = (g: THREE.BufferGeometry, bone: number, color: string) => parts.push(part(g, bone, color));
  const sleeve = kit.keeper ? kit.shirt : kit.skin;

  // Hips / shorts.
  P(cyl(0.165, 0.18, 0.24, 0, 0.93, 0, 0.72), B.hips, kit.shorts);
  // Torso.
  P(cyl(0.19, 0.165, 0.24, 0, 1.12, 0, 0.66), B.spine, kit.shirt);
  P(cyl(0.22, 0.19, 0.3, 0, 1.37, 0, 0.64), B.chest, kit.shirt);
  P(sphere(0.2, 0, 1.47, 0, 1.12, 0.42, 0.62), B.chest, kit.shirt);
  // Kit accent: side panels and collar.
  P(cyl(0.225, 0.2, 0.05, 0, 1.25, 0, 0.66), B.chest, kit.secondary);
  const collar = new THREE.TorusGeometry(0.062, 0.018, 6, 14);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 1.535, 0.005);
  P(collar, B.chest, kit.secondary);
  for (const s of [1, -1]) P(sphere(0.085, s * 0.2, 1.47, 0, 1, 0.9, 0.95), B.chest, kit.shirt);
  // Neck & head.
  P(cyl(0.048, 0.055, 0.12, 0, 1.6, 0), B.neck, kit.skin);
  P(sphere(0.105, 0, 1.71, 0.005, 0.93, 1.12, 1.0, 16, 12), B.head, kit.skin);
  const hair = new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
  hair.scale(0.95, 1.08, 1.05);
  hair.rotateX(-0.25);
  hair.translate(0, 1.72, -0.008);
  P(hair, B.head, kit.hair);
  for (const s of [1, -1]) {
    P(sphere(0.014, s * 0.036, 1.725, 0.094, 1, 1, 0.6, 6, 4), B.head, '#1a1a1a');
    P(sphere(0.022, s * 0.1, 1.71, 0, 0.6, 1, 1, 6, 5), B.head, kit.skin);
  }
  P(sphere(0.018, 0, 1.69, 0.104, 0.8, 1, 1, 6, 4), B.head, kit.skin);

  for (const s of [1, -1]) {
    const L = s > 0;
    const ax = s * 0.23;
    const arm = L ? B.armL : B.armR,
      fore = L ? B.foreL : B.foreR,
      hand = L ? B.handL : B.handR;
    // Sleeve + upper arm.
    P(cyl(0.062, 0.055, 0.15, ax, 1.42, 0), arm, kit.shirt);
    P(capsule(0.045, 0.17, ax, 1.31, 0), arm, sleeve);
    P(sphere(0.047, ax, 1.21, 0), fore, sleeve);
    P(capsule(0.04, 0.19, ax, 1.08, 0), fore, sleeve);
    P(sphere(kit.keeper ? 0.058 : 0.045, ax, 0.93, 0.0, 0.9, 1.1, 0.8), hand, kit.keeper ? kit.gloves : kit.skin);
    // Legs.
    const lx = s * 0.1;
    const thigh = L ? B.thighL : B.thighR,
      shin = L ? B.shinL : B.shinR,
      foot = L ? B.footL : B.footR;
    P(cyl(0.088, 0.082, 0.2, lx, 0.82, 0), thigh, kit.shorts);
    P(capsule(0.07, 0.22, lx, 0.65, 0), thigh, kit.skin);
    P(sphere(0.062, lx, 0.49, 0.005), shin, kit.skin);
    P(capsule(0.056, 0.3, lx, 0.27, 0), shin, kit.socks);
    P(cyl(0.06, 0.06, 0.05, lx, 0.44, 0), shin, kit.secondary);
    const boot = new THREE.BoxGeometry(0.095, 0.075, 0.25, 1, 1, 2);
    boot.translate(lx, 0.04, 0.045);
    P(boot, foot, kit.boots);
    P(sphere(0.05, lx, 0.07, -0.05, 1, 0.8, 1), foot, kit.boots);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  // Keep each primitive's own smooth normals (recomputing on the merged, non-indexed mesh would facet it).
  merged.computeBoundingSphere();
  geoCache.set(key, merged);
  return merged;
}

/** Interpolated per-player state the animator needs. */
export interface PoseInput {
  anim: Anim;
  animTime: number;
  speed: number;
  lean: number;
  mood: number;
  y: number;
  /** Lateral dive direction in model space (+1 = model left / +x). */
  diveSide: number;
  isGK: boolean;
  sprint: boolean;
  hasBall: boolean;
  /** Simulation gait phase (radians): left foot forward at sin = 1. Keeps feet in sync with ball touches. */
  gait: number;
  /** Velocity in model space: forward (+z) and lateral (+x = model left) components. */
  fwd: number;
  lat: number;
  /** Seconds since the last dribble touch and the foot used (+1 left, −1 right). */
  touchAge: number;
  touchFoot: number;
  /** Kicking foot (+1 left, −1 right). */
  kickFoot: number;
  /** Celebration / reaction / official's signal gesture code (see src/sim/celebration.ts, OfficialGesture). */
  gesture?: number;
  /** Direction for pointing gestures, in the root frame (+z forward, +x the character's left). */
  pointX?: number;
  pointZ?: number;
  /** Optional reach target in model space (goalkeeper hands towards the ball). */
  reach: { x: number; y: number; z: number } | null;
}

/**
 * Rig wrapper: builds bones and evaluates a procedural pose each frame,
 * smoothing toward target rotations for clean transitions.
 */
export class PlayerRig {
  setShadows(on: boolean): void {
    this.mesh.castShadow = on;
  }

  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  private target = new Float32Array(BONE_COUNT * 3);
  private current = new Float32Array(BONE_COUNT * 3);
  private hipY = HIP_Y;
  private hipYTarget = HIP_Y;
  private hipRot = new THREE.Vector3();
  private hipRotTarget = new THREE.Vector3();
  private time = Math.random() * 10;

  constructor(kit: Kit, material: THREE.Material) {
    const geo = buildPlayerGeometry(kit);
    BONES.forEach((b) => {
      const bone = new THREE.Bone();
      bone.position.set(...b.pos);
      this.bones.push(bone);
      if (b.parent >= 0) this.bones[b.parent].add(bone);
    });
    this.mesh = new THREE.SkinnedMesh(geo, material);
    this.mesh.add(this.bones[0]);
    // Bone world matrices must be current so the skeleton computes correct inverse bind matrices.
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  dispose(): void {
    this.mesh.skeleton.dispose();
  }

  /** Evaluate the pose for this frame. */
  update(s: PoseInput, dt: number, _camDist = 0): void {
    this.time += dt;
    const T = this.target;
    T.fill(0);
    const set = (b: number, x: number, y = 0, z = 0) => {
      T[b * 3] = x;
      T[b * 3 + 1] = y;
      T[b * 3 + 2] = z;
    };
    const add = (b: number, x: number, y = 0, z = 0) => {
      T[b * 3] += x;
      T[b * 3 + 1] += y;
      T[b * 3 + 2] += z;
    };
    let hipY = HIP_Y;
    this.hipRotTarget.set(0, 0, 0);
    let rate = 16;

    // Gait: phase comes from the simulation so foot plants match ball touches.
    const a = clamp(s.speed / 8.2, 0, 1);
    // Blend weights: walk → jog → sprint.
    const run = smoothstep(2.0, 4.5, s.speed);
    const sprintW = smoothstep(5.8, 7.8, s.speed);
    const ph = s.gait;
    // Direction of travel relative to facing: forward, backward, sideways.
    const spd = Math.max(0.01, s.speed);
    const fwdW = s.speed > 0.3 ? clamp(s.fwd / spd, -1, 1) : 1;
    const latW = s.speed > 0.3 ? clamp(s.lat / spd, -1, 1) : 0;
    const back = Math.max(0, -fwdW);
    const side = Math.abs(latW);
    // Moving backwards reverses the leg swing; sideways motion swings the legs out to the side.
    const dirSign = fwdW >= 0 ? 1 : -1;
    const sinL = Math.sin(ph) * dirSign,
      cosL = Math.cos(ph);
    const t = s.animTime;

    const locomotion = () => {
      const along = 1 - side * 0.85;
      const A = (0.14 + 0.32 * run + 0.38 * sprintW) * along * (1 - back * 0.35);
      const K = (0.18 + 0.75 * run + 0.6 * sprintW) * (1 - back * 0.3);
      set(B.thighL, -sinL * A);
      set(B.thighR, sinL * A);
      set(B.shinL, 0.05 + run * 0.12 + K * Math.max(0, cosL * dirSign));
      set(B.shinR, 0.05 + run * 0.12 + K * Math.max(0, -cosL * dirSign));
      set(B.footL, -0.08 * run + 0.3 * a * Math.max(0, -sinL));
      set(B.footR, -0.08 * run + 0.3 * a * Math.max(0, sinL));
      // Side-step: legs swing laterally (abduct / cross) in rhythm.
      if (side > 0.05) {
        const sw = Math.sin(ph) * 0.32 * side * Math.min(1, s.speed / 2.5);
        add(B.thighL, 0, 0, sw * Math.sign(latW));
        add(B.thighR, 0, 0, sw * Math.sign(latW));
        add(B.shinL, 0.15 * side);
        add(B.shinR, 0.15 * side);
      }
      // Arms: low and relaxed walking, pumping with ~90° elbows when sprinting.
      const Barm = (0.12 + 0.35 * run + 0.4 * sprintW) * (1 - side * 0.5);
      set(B.armL, sinL * Barm, 0, 0.1 + a * 0.08 + side * 0.15);
      set(B.armR, -sinL * Barm, 0, -0.1 - a * 0.08 - side * 0.15);
      set(B.foreL, -(0.2 + 0.7 * run + 0.55 * sprintW));
      set(B.foreR, -(0.2 + 0.7 * run + 0.55 * sprintW));
      // Torso leans into the run (back when backpedalling); a little twist with each stride.
      set(B.spine, 0.03 + 0.1 * run + 0.14 * sprintW + s.lean * 0.1 * a - back * 0.12, Math.sin(ph) * 0.08 * run);
      set(B.chest, 0.02, Math.sin(ph) * 0.1 * run);
      set(B.neck, -0.05 * run - 0.05 * sprintW + back * 0.1);
      this.hipRotTarget.set(0, -Math.sin(ph) * 0.1 * run, 0);
      // Vertical bob: small when walking, flight phase when running.
      hipY = HIP_Y - a * 0.05 - Math.abs(cosL) * (0.012 + 0.03 * run);
      if (s.speed < 0.25) {
        // Idle: weight shift and breathing.
        add(B.chest, Math.sin(this.time * 2) * 0.02);
        add(B.armL, 0, 0, 0.04);
        add(B.armR, 0, 0, -0.04);
        this.hipRotTarget.z = Math.sin(this.time * 0.7) * 0.025;
      }
      // Dribble touch: the touching foot reaches forward and taps the ball.
      if (s.touchAge < 0.24 && s.hasBall) {
        const bump = Math.sin(Math.PI * clamp(s.touchAge / 0.24, 0, 1));
        const left = s.touchFoot > 0;
        add(left ? B.thighL : B.thighR, -0.45 * bump);
        add(left ? B.shinL : B.shinR, -0.35 * bump);
        add(left ? B.footL : B.footR, -0.3 * bump);
        add(B.spine, 0.05 * bump);
      }
    };

    switch (s.anim) {
      case Anim.Kick:
      case Anim.Pass: {
        locomotion();
        const shot = s.anim === Anim.Kick;
        const c = shot ? KICK_TIMING.shotContact : KICK_TIMING.passContact;
        const total = shot ? KICK_TIMING.shotTotal : KICK_TIMING.passTotal;
        rate = 34;
        // Mirror the whole action for left-footed strikes.
        const L = s.kickFoot > 0;
        const kT = L ? B.thighL : B.thighR,
          kS = L ? B.shinL : B.shinR,
          kF = L ? B.footL : B.footR;
        const pT = L ? B.thighR : B.thighL,
          pS = L ? B.shinR : B.shinL;
        const m = L ? -1 : 1; // mirror sign for y/z rotations
        if (t < c) {
          const u = smoothstep(0, 1, t / c);
          set(kT, 0.85 * u * (shot ? 1 : 0.6), (shot ? 0 : 0.5 * u) * m);
          set(kS, 1.5 * u);
        } else {
          const v = clamp((t - c) / (total - c), 0, 1);
          const swing = smoothstep(0, 0.35, v);
          const back = smoothstep(0.55, 1, v);
          set(kT, lerp(lerp(0.85, shot ? -1.45 : -0.8, swing), -0.2, back), (shot ? 0 : 0.5 * (1 - back)) * m);
          set(kS, lerp(lerp(1.5, 0.05, swing), 0.2, back));
          set(kF, -0.3 * swing);
        }
        set(pT, -0.15);
        set(pS, 0.35);
        // Opposite arm swings out for balance.
        set(L ? B.armR : B.armL, -0.35, 0, 0.95 * (L ? -1 : 1));
        set(L ? B.armL : B.armR, 0.55, 0, -0.4 * (L ? -1 : 1));
        set(L ? B.foreR : B.foreL, -0.4);
        set(B.spine, shot ? -0.12 : 0.05, (shot ? 0.3 : 0.15) * m);
        hipY = HIP_Y - 0.04;
        break;
      }
      case Anim.Header: {
        rate = 30;
        const c = 0.12;
        const back = t < c ? smoothstep(0, 1, t / c) : 1 - smoothstep(c, c + 0.15, t);
        set(B.spine, -0.35 * back + (t > c ? 0.35 * (1 - back) : 0));
        set(B.neck, -0.3 * back + (t > c ? 0.35 : 0));
        set(B.armL, -0.6, 0, 0.9);
        set(B.armR, -0.6, 0, -0.9);
        set(B.foreL, -0.8);
        set(B.foreR, -0.8);
        set(B.thighL, -0.4);
        set(B.shinL, 0.9);
        set(B.thighR, 0.1);
        set(B.shinR, 0.6);
        break;
      }
      case Anim.Tackle: {
        rate = 26;
        const u = smoothstep(0, 0.12, t) * (1 - smoothstep(0.3, 0.42, t));
        set(B.thighR, -1.15 * u, 0.3 * u);
        set(B.shinR, 0.15);
        set(B.thighL, 0.3 * u);
        set(B.shinL, 1.0 * u + 0.1);
        set(B.spine, 0.45 * u);
        set(B.armL, -0.4 * u, 0, 0.7 * u);
        set(B.armR, 0.5 * u, 0, -0.6 * u);
        hipY = HIP_Y - 0.28 * u;
        break;
      }
      case Anim.Slide: {
        rate = 24;
        const down = smoothstep(0, 0.15, t);
        const up = smoothstep(0.75, 1.0, t);
        const u = down * (1 - up);
        this.hipRotTarget.set(-1.15 * u, 0, 0);
        set(B.spine, 0.55 * u);
        set(B.neck, 0.35 * u);
        set(B.thighR, -0.4 * u);
        set(B.shinR, 0.05);
        set(B.thighL, 0.2 * u, 0, 0.15 * u);
        set(B.shinL, 1.7 * u);
        set(B.armL, 0.9 * u, 0, 0.5 * u);
        set(B.armR, 0.9 * u, 0, -0.5 * u);
        hipY = lerp(HIP_Y, 0.3, u);
        break;
      }
      case Anim.Stumble: {
        rate = 20;
        const u = Math.sin(clamp(t / 0.45, 0, 1) * Math.PI);
        set(B.spine, 0.6 * u);
        set(B.armL, -0.8 * u, 0, 1.2 * u);
        set(B.armR, -1.0 * u, 0, -1.0 * u);
        set(B.thighL, -0.5 * u);
        set(B.shinL, 0.8 * u);
        set(B.thighR, 0.3 * u);
        set(B.shinR, 0.5 * u);
        hipY = HIP_Y - 0.12 * u;
        break;
      }
      case Anim.Fallen: {
        rate = 14;
        const down = smoothstep(0, 0.25, t);
        const up = smoothstep(0.9, 1.3, t);
        const u = down * (1 - up);
        this.hipRotTarget.set(-1.45 * u, 0, 0);
        set(B.armL, -0.3 * u, 0, 1.3 * u);
        set(B.armR, -0.3 * u, 0, -1.3 * u);
        set(B.thighL, -0.5 * u);
        set(B.shinL, 0.9 * u);
        set(B.thighR, -0.2 * u);
        set(B.shinR, 0.3 * u);
        set(B.neck, 0.4 * u);
        hipY = lerp(HIP_Y, 0.16, u);
        break;
      }
      case Anim.Dive: {
        rate = 22;
        const side = s.diveSide >= 0 ? 1 : -1;
        const roll = smoothstep(0, 0.28, t) * (1 - smoothstep(0.95, 1.15, t));
        // Head goes towards the dive side: rotation about forward axis (z).
        this.hipRotTarget.set(0, 0, -side * 1.35 * roll);
        const reachSide = side > 0;
        set(reachSide ? B.armL : B.armR, -0.2, 0, side * 2.8 * roll);
        set(reachSide ? B.armR : B.armL, -0.2, 0, side * 2.4 * roll);
        set(B.foreL, -0.1);
        set(B.foreR, -0.1);
        set(B.spine, 0.1, 0, -side * 0.2 * roll);
        set(B.thighL, -0.2, 0, side * 0.1);
        set(B.shinL, 0.3);
        set(B.thighR, -0.1, 0, side * 0.1);
        set(B.shinR, 0.5);
        const landed = s.y <= 0.02 && t > 0.3;
        hipY = landed ? lerp(HIP_Y, 0.3, roll) : HIP_Y - 0.1 * roll;
        break;
      }
      case Anim.Hold: {
        locomotion();
        rate = 22;
        set(B.armL, -1.15, 0, 0.25);
        set(B.armR, -1.15, 0, -0.25);
        set(B.foreL, -0.9, 0, 0);
        set(B.foreR, -0.9, 0, 0);
        break;
      }
      case Anim.Throw: {
        rate = 26;
        const u = clamp(t / 0.45, 0, 1);
        const arm = lerp(-2.9, -1.2, smoothstep(0.1, 0.5, u));
        set(B.armL, arm, 0, 0.15);
        set(B.armR, arm, 0, -0.15);
        set(B.foreL, -0.6 * (1 - u));
        set(B.foreR, -0.6 * (1 - u));
        set(B.spine, lerp(-0.3, 0.3, smoothstep(0.1, 0.5, u)));
        set(B.thighL, -0.3);
        set(B.shinL, 0.4);
        break;
      }
      case Anim.Skill: {
        locomotion();
        rate = 30;
        const u = clamp(t / 0.3, 0, 1);
        set(B.thighR, -0.4 * Math.sin(u * Math.PI), Math.sin(u * Math.PI * 2) * 0.6, -Math.sin(u * Math.PI) * 0.5);
        set(B.shinR, 0.6 * Math.sin(u * Math.PI));
        this.hipRotTarget.set(0, 0, Math.sin(u * Math.PI * 2) * 0.15);
        set(B.spine, 0.2, 0, -Math.sin(u * Math.PI * 2) * 0.2);
        set(B.armL, -0.2, 0, 0.6);
        set(B.armR, -0.2, 0, -0.6);
        break;
      }
      default: {
        locomotion();
        if (s.isGK && s.speed < 2.5 && s.anim === Anim.GkReady && !s.hasBall) {
          const k = 1 - a * 2;
          set(B.thighL, -0.45 * k, 0, 0.12 * k);
          set(B.thighR, -0.45 * k, 0, -0.12 * k);
          set(B.shinL, 0.9 * k);
          set(B.shinR, 0.9 * k);
          set(B.footL, -0.35 * k);
          set(B.footR, -0.35 * k);
          set(B.spine, 0.35 * k);
          set(B.armL, -0.35 * k, 0, 0.55 * k);
          set(B.armR, -0.35 * k, 0, -0.55 * k);
          set(B.foreL, -0.7 * k);
          set(B.foreR, -0.7 * k);
          hipY = HIP_Y - 0.17 * k;
        }
      }
    }

    // Goalkeeper hands reach towards the ball (catching / set position / dive).
    if (s.reach && s.isGK && (s.anim === Anim.GkReady || s.anim === Anim.Hold || s.anim === Anim.Dive || s.anim === Anim.Locomotion)) {
      const r = s.reach;
      for (const left of [true, false]) {
        const sx = left ? 0.23 : -0.23;
        const dx = r.x - sx,
          dy = r.y - 1.45,
          dz = r.z;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const nx = dx / dl,
          ny = dy / dl,
          nz = dz / dl;
        const zr = Math.asin(clamp(nx, -1, 1));
        const xr = Math.atan2(-nz, -ny);
        const w = s.anim === Anim.Dive ? 0.6 : 0.85;
        const arm = left ? B.armL : B.armR,
          fore = left ? B.foreL : B.foreR;
        T[arm * 3] += (xr - T[arm * 3]) * w;
        T[arm * 3 + 2] += (zr + (left ? 0.12 : -0.12) - T[arm * 3 + 2]) * w;
        T[fore * 3] += (-0.25 - T[fore * 3]) * w;
      }
      rate = Math.max(rate, 22);
    }

    // Mood overlays.
    if (s.mood === 1 && (s.anim === Anim.Locomotion || s.anim === Anim.GkReady)) {
      if (s.speed > 2) {
        // Aeroplane celebration.
        set(B.armL, 0, 0, 1.45);
        set(B.armR, 0, 0, -1.45);
        set(B.foreL, 0);
        set(B.foreR, 0);
        this.hipRotTarget.z = Math.sin(this.time * 2.5) * 0.12;
        add(B.spine, 0, 0, Math.sin(this.time * 2.5) * 0.15);
      } else {
        const j = Math.abs(Math.sin(this.time * 5.5));
        const alt = Math.sin(this.time * 5.5) > 0;
        set(B.armL, -0.3, 0, alt ? 2.7 : 2.2);
        set(B.armR, -0.3, 0, alt ? -2.2 : -2.7);
        set(B.foreL, -0.5);
        set(B.foreR, -0.5);
        hipY += j * 0.12;
        set(B.thighL, -0.4 * j);
        set(B.shinL, 0.8 * j);
        set(B.thighR, -0.4 * j);
        set(B.shinR, 0.8 * j);
      }
    } else if (s.mood === 2 && s.anim === Anim.Locomotion) {
      set(B.armL, -0.7, 0, 2.3);
      set(B.armR, -0.7, 0, -2.3);
      set(B.foreL, -2.3);
      set(B.foreR, -2.3);
      set(B.neck, 0.45);
      add(B.spine, 0.15);
    }

    // Smooth towards the target pose.
    const k = 1 - Math.exp(-rate * dt);
    const C = this.current;
    for (let i = 0; i < C.length; i++) C[i] += (T[i] - C[i]) * k;
    this.hipYTarget = hipY;
    this.hipY += (this.hipYTarget - this.hipY) * Math.min(1, k * 1.2);
    this.hipRot.lerp(this.hipRotTarget, k);
    for (let b = 1; b < BONE_COUNT; b++) {
      this.bones[b].rotation.set(C[b * 3], C[b * 3 + 1], C[b * 3 + 2]);
    }
    const hips = this.bones[0];
    hips.position.y = this.hipY;
    hips.rotation.set(this.hipRot.x, this.hipRot.y, this.hipRot.z);
  }

  /** World-space hand position (used to place a held ball). */
  static readonly bindPositions = BIND;
}
