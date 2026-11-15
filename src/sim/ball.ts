/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { BALL, PitchConfig } from './config';
import { Vec3, hyp } from '../core/math';

export type BallContact =
  | { type: 'bounce'; strength: number }
  | { type: 'post'; strength: number; goalSide: 1 | -1 }
  | { type: 'net'; strength: number; goalSide: 1 | -1; x: number; y: number; z: number };

const tmpA = new Vec3();
const tmpB = new Vec3();

/**
 * Football with gravity, quadratic drag, Magnus effect (curl / topspin),
 * bounce with spin transfer, rolling resistance, goal posts and nets.
 */
export class Ball {
  readonly pos = new Vec3(0, BALL.radius, 0);
  readonly vel = new Vec3();
  /** Angular velocity (rad/s). Drives Magnus force and visual rotation. */
  readonly spin = new Vec3();
  /** Orientation quaternion (x, y, z, w) for rendering. */
  readonly quat = [0, 0, 0, 1];
  /** True when the ball is resting on / rolling along the ground. */
  grounded = true;
  /** When set, a goalkeeper holds the ball and physics is suspended. */
  heldBy: number | null = null;

  constructor(private pitch: PitchConfig) {}

  setPitch(pitch: PitchConfig): void {
    this.pitch = pitch;
  }

  reset(x: number, z: number, y: number = BALL.radius): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.grounded = y <= BALL.radius + 1e-3;
    this.heldBy = null;
  }

  get speed(): number {
    return this.vel.length();
  }

  /** Advance the ball by dt seconds. Returns contacts that occurred (for audio/visual feedback). */
  step(dt: number, contacts?: BallContact[]): void {
    if (this.heldBy !== null) {
      this.vel.set(0, 0, 0);
      this.integrateRotation(dt);
      return;
    }
    const r = BALL.radius;
    const v = this.vel;
    const speed = v.length();
    const airborne = this.pos.y > r + 0.01 || v.y > 0.05;

    // Forces: gravity, drag, Magnus.
    if (airborne) {
      v.y -= BALL.gravity * dt;
      const drag = BALL.airDrag * speed;
      v.addScaled(v, -drag * dt);
      tmpA
        .copy(this.spin)
        .cross(v)
        .scale(BALL.magnus * dt);
      v.add(tmpA);
      this.spin.scale(Math.exp(-BALL.spinDecay * dt));
    }

    this.pos.addScaled(v, dt);

    // Ground contact.
    if (this.pos.y <= r) {
      this.pos.y = r;
      if (v.y < -1.2) {
        const impact = -v.y;
        // Restitution falls slightly for hard impacts (grass absorbs more).
        const e = BALL.restitution * (1 - Math.min(0.25, impact / 60));
        v.y = impact * e;
        // Tangential friction: bleed horizontal speed and convert towards rolling spin.
        const fric = 0.82 + Math.min(0.12, impact * 0.004);
        v.x *= fric;
        v.z *= fric;
        this.spin.x = this.spin.x * 0.5 + (v.z / r) * 0.5;
        this.spin.z = this.spin.z * 0.5 + (-v.x / r) * 0.5;
        this.spin.y *= 0.6;
        contacts?.push({ type: 'bounce', strength: impact });
        this.grounded = false;
      } else {
        v.y = 0;
        this.grounded = true;
      }
    } else {
      this.grounded = false;
    }

    if (this.grounded) {
      // Rolling resistance on grass.
      const hs = hyp(v.x, v.z);
      if (hs > 0) {
        const dec = (BALL.rollDecel + BALL.rollDrag * hs) * dt;
        const ns = Math.max(0, hs - dec);
        const k = ns / hs;
        v.x *= k;
        v.z *= k;
      }
      // Rolling spin matches ground speed; sidespin dies quickly on the grass.
      this.spin.set(v.z / r, this.spin.y * Math.exp(-4 * dt), -v.x / r);
    }

    this.collideGoals(contacts);
    this.integrateRotation(dt);
  }

  private collideGoals(contacts?: BallContact[]): void {
    const p = this.pitch;
    const hx = p.length / 2;
    const gw = p.goalWidth / 2;
    const gh = p.goalHeight;
    const pr = p.postRadius;
    const r = BALL.radius;
    for (const side of [1, -1] as const) {
      const lx = hx * side;
      // Quick reject: only near this goal.
      if (Math.abs(this.pos.x - lx) > p.goalDepth + 1.5) continue;
      // Posts (vertical) and crossbar (horizontal) as capsules.
      this.collideSegment(lx, 0, -gw, lx, gh, -gw, pr, side, contacts);
      this.collideSegment(lx, 0, gw, lx, gh, gw, pr, side, contacts);
      this.collideSegment(lx, gh, -gw, lx, gh, gw, pr, side, contacts);

      // Net volume behind the goal line.
      const depth = p.goalDepth;
      const behind = (this.pos.x - lx) * side; // >0 behind the goal line
      if (behind > 0 && behind < depth + r) {
        const insideMouth = Math.abs(this.pos.z) < gw && this.pos.y < gh;
        const wasInside = Math.abs(this.pos.z) < gw + r && this.pos.y < gh + r;
        if (insideMouth || wasInside) {
          // The net drags on the ball while it's inside the goal.
          if (insideMouth && behind > r) {
            this.vel.x *= 0.985;
            this.vel.z *= 0.985;
          }
          const backX = lx + side * (depth - r);
          if ((this.pos.x - backX) * side > 0) {
            this.hitNet(contacts, side, Math.abs(this.vel.x));
            this.pos.x = backX;
            this.vel.x = -this.vel.x * BALL.netDamping * 0.5;
            this.vel.z *= 0.5;
            this.vel.y *= 0.5;
          }
          if (insideMouth) {
            if (Math.abs(this.pos.z) > gw - r) {
              this.hitNet(contacts, side, Math.abs(this.vel.z));
              this.pos.z = Math.sign(this.pos.z) * (gw - r);
              this.vel.z = -this.vel.z * BALL.netDamping;
              this.vel.x *= 0.7;
            }
            if (this.pos.y > gh - r) {
              this.hitNet(contacts, side, Math.abs(this.vel.y));
              this.pos.y = gh - r;
              this.vel.y = -this.vel.y * BALL.netDamping;
            }
          }
        } else {
          // Outside the goal: side netting and roof from outside.
          const zEdge = gw + r;
          if (Math.abs(this.pos.z) < zEdge && Math.abs(this.pos.z) > gw - r && this.pos.y < gh) {
            const s = Math.sign(this.pos.z);
            this.hitNet(contacts, side, Math.abs(this.vel.z));
            this.pos.z = s * zEdge;
            this.vel.z = Math.abs(this.vel.z) * s * BALL.netDamping * 2;
          } else if (Math.abs(this.pos.z) < gw && this.pos.y < gh + r && this.pos.y > gh - r && this.vel.y < 0) {
            this.hitNet(contacts, side, Math.abs(this.vel.y));
            this.pos.y = gh + r;
            this.vel.y = Math.abs(this.vel.y) * 0.25;
          }
        }
      }
    }
  }

  private hitNet(contacts: BallContact[] | undefined, side: 1 | -1, strength: number): void {
    if (strength < 0.5) return;
    contacts?.push({ type: 'net', strength, goalSide: side, x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  /** Sphere vs capsule (segment a-b with radius pr) collision with restitution. */
  private collideSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, pr: number, side: 1 | -1, contacts?: BallContact[]): void {
    const p = this.pos;
    const abx = bx - ax,
      aby = by - ay,
      abz = bz - az;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = ((p.x - ax) * abx + (p.y - ay) * aby + (p.z - az) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    tmpB.set(ax + abx * t, ay + aby * t, az + abz * t);
    tmpA.copy(p).sub(tmpB);
    const d = tmpA.length();
    const minD = BALL.radius + pr;
    if (d >= minD || d < 1e-6) return;
    tmpA.scale(1 / d); // normal
    p.copy(tmpB).addScaled(tmpA, minD);
    const vn = this.vel.dot(tmpA);
    if (vn < 0) {
      this.vel.addScaled(tmpA, -(1 + BALL.postRestitution) * vn);
      this.spin.scale(0.5);
      if (-vn > 1) contacts?.push({ type: 'post', strength: -vn, goalSide: side });
    }
  }

  /** Integrate visual orientation from angular velocity. */
  private integrateRotation(dt: number): void {
    const wx = this.spin.x,
      wy = this.spin.y,
      wz = this.spin.z;
    const q = this.quat;
    const [qx, qy, qz, qw] = q;
    const h = 0.5 * dt;
    q[0] = qx + h * (wx * qw + wy * qz - wz * qy);
    q[1] = qy + h * (wy * qw + wz * qx - wx * qz);
    q[2] = qz + h * (wz * qw + wx * qy - wy * qx);
    q[3] = qw + h * (-wx * qx - wy * qy - wz * qz);
    const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
    q[0] /= n;
    q[1] /= n;
    q[2] /= n;
    q[3] /= n;
  }
}

/**
 * Lightweight trajectory predictor (no goal collisions) used by the AI to anticipate
 * where a ball will be. Writes `steps` samples spaced `dt` apart into `out` as [x,y,z,...].
 */
export function predictBall(pos: Vec3, vel: Vec3, spin: Vec3, steps: number, dt: number, out: Float32Array): void {
  let px = pos.x,
    py = pos.y,
    pz = pos.z;
  let vx = vel.x,
    vy = vel.y,
    vz = vel.z;
  const sx = spin.x,
    sy = spin.y,
    sz = spin.z;
  const r = BALL.radius;
  const sub = 4;
  const h = dt / sub;
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < sub; k++) {
      const airborne = py > r + 0.01 || vy > 0.05;
      if (airborne) {
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        vy -= BALL.gravity * h;
        const dr = 1 - BALL.airDrag * sp * h;
        vx *= dr;
        vy *= dr;
        vz *= dr;
        const mx = sy * vz - sz * vy;
        const my = sz * vx - sx * vz;
        const mz = sx * vy - sy * vx;
        vx += mx * BALL.magnus * h;
        vy += my * BALL.magnus * h;
        vz += mz * BALL.magnus * h;
      }
      px += vx * h;
      py += vy * h;
      pz += vz * h;
      if (py <= r) {
        py = r;
        if (vy < -1.2) {
          vy = -vy * BALL.restitution * 0.9;
          vx *= 0.85;
          vz *= 0.85;
        } else {
          vy = 0;
        }
      }
      if (py <= r + 1e-3 && vy === 0) {
        const hs = hyp(vx, vz);
        if (hs > 0) {
          const ns = Math.max(0, hs - (BALL.rollDecel + BALL.rollDrag * hs) * h);
          vx *= ns / hs;
          vz *= ns / hs;
        }
      }
    }
    out[i * 3] = px;
    out[i * 3 + 1] = py;
    out[i * 3 + 2] = pz;
  }
}

/**
 * Initial ground speed needed for a rolling ball to travel `distance` and still be moving at `endSpeed`.
 * Integrates the rolling model analytically-ish (numerically, cheap) for accuracy.
 */
export function groundPassSpeed(distance: number, endSpeed: number): number {
  // Rolling model: dv/dt = -(a + b v). Distance from v0 to v1: s = (v0 - v1)/b - a/b² ln((a + b v0)/(a + b v1)).
  const a = BALL.rollDecel,
    b = BALL.rollDrag;
  const dist = (v0: number) => (v0 - endSpeed) / b - (a / (b * b)) * Math.log((a + b * v0) / (a + b * endSpeed));
  let lo = endSpeed,
    hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (dist(mid) < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Time for a rolling ball launched at v0 to travel `distance` (Infinity if it stops short). */
export function groundTravelTime(v0: number, distance: number): number {
  const a = BALL.rollDecel,
    b = BALL.rollDrag;
  // v(t) = (v0 + a/b) e^{-bt} - a/b ; s(t) = (v0 + a/b)(1 - e^{-bt})/b - a t / b
  const c = v0 + a / b;
  const tStop = Math.log(c / (a / b)) / b;
  const sAt = (t: number) => (c * (1 - Math.exp(-b * t))) / b - (a * t) / b;
  if (sAt(tStop) < distance) return Infinity;
  let lo = 0,
    hi = tStop;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sAt(mid) < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Speed a ground pass should still have on arrival: firmer for longer passes and higher power.
 * Shared by the kick model and the AI's pass evaluation so both agree.
 */
export function passEndSpeed(distance: number, power: number): number {
  const base = 4.5 + (8.5 - 4.5) * Math.max(0, Math.min(1, power));
  return Math.max(base, 3 + distance * 0.16);
}
