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
 * Minimal, allocation-conscious vector math for the simulation layer.
 * The simulation never depends on Three.js so it can run headless (tests, replays).
 * Coordinate system: x = pitch length (goals at ±x), z = pitch width, y = up.
 */
export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }
  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  cross(v: Vec3): this {
    const { x, y, z } = this;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  /** Horizontal (xz-plane) length. */
  lengthXZ(): number {
    return Math.sqrt(this.x * this.x + this.z * this.z);
  }
  normalize(): this {
    const l = this.length();
    if (l > 1e-9) this.scale(1 / l);
    return this;
  }
  distanceTo(v: Vec3): number {
    const dx = this.x - v.x,
      dy = this.y - v.y,
      dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  distanceXZ(v: Vec3): number {
    const dx = this.x - v.x,
      dz = this.z - v.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  isFinite(): boolean {
    return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z);
  }
}

/** 2D vector on the pitch plane (x, z). Used heavily by AI and player movement. */
export class Vec2 {
  constructor(
    public x = 0,
    public z = 0,
  ) {}

  set(x: number, z: number): this {
    this.x = x;
    this.z = z;
    return this;
  }
  copy(v: { x: number; z: number }): this {
    this.x = v.x;
    this.z = v.z;
    return this;
  }
  clone(): Vec2 {
    return new Vec2(this.x, this.z);
  }
  add(v: { x: number; z: number }): this {
    this.x += v.x;
    this.z += v.z;
    return this;
  }
  sub(v: { x: number; z: number }): this {
    this.x -= v.x;
    this.z -= v.z;
    return this;
  }
  addScaled(v: { x: number; z: number }, s: number): this {
    this.x += v.x * s;
    this.z += v.z * s;
    return this;
  }
  scale(s: number): this {
    this.x *= s;
    this.z *= s;
    return this;
  }
  dot(v: { x: number; z: number }): number {
    return this.x * v.x + this.z * v.z;
  }
  length(): number {
    return hyp(this.x, this.z);
  }
  lengthSq(): number {
    return this.x * this.x + this.z * this.z;
  }
  normalize(): this {
    const l = this.length();
    if (l > 1e-9) this.scale(1 / l);
    return this;
  }
  clampLength(max: number): this {
    const l = this.length();
    if (l > max && l > 0) this.scale(max / l);
    return this;
  }
  distanceTo(v: { x: number; z: number }): number {
    return hyp(this.x - v.x, this.z - v.z);
  }
  angle(): number {
    return Math.atan2(this.z, this.x);
  }
}

/**
 * Allocation-free Euclidean length. `Math.hypot` boxes its arguments in V8 (it showed up as the
 * single largest source of garbage in the simulation), so hot paths use this instead.
 */
export function hyp(a: number, b: number, c?: number): number {
  return c === undefined ? Math.sqrt(a * a + b * b) : Math.sqrt(a * a + b * b + c * c);
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Shortest signed difference between two angles (radians), result in [-PI, PI]. */
export const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
/** Rotate angle `a` toward `b` by at most `maxStep`. */
export const approachAngle = (a: number, b: number, maxStep: number): number => {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
};
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Distance from point p to segment ab on the xz plane, plus the segment parameter t. */
export function pointSegmentDistXZ(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { dist: number; t: number } {
  const abx = bx - ax,
    abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t,
    cz = az + abz * t;
  return { dist: hyp(px - cx, pz - cz), t };
}
