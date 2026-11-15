/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { Match } from '../sim/match';

/**
 * A compact, render-ready snapshot of the simulation. The renderer only ever reads
 * frames, which lets it interpolate between fixed steps and play back replays
 * from a ring buffer with no access to live simulation objects.
 */
export const P_STRIDE = 18;
/** Offsets of each per-player field within its P_STRIDE block of `Frame.players`. */
export const PF = {
  X: 0,
  Y: 1,
  Z: 2,
  Facing: 3,
  Anim: 4,
  AnimTime: 5,
  Speed: 6,
  Lean: 7,
  Mood: 8,
  DiveDir: 9,
  Flags: 10,
  VelX: 11,
  VelZ: 12,
  Gait: 13,
  TouchAge: 14,
  TouchFoot: 15,
  KickFoot: 16,
  /** Celebration / reaction gesture (src/sim/celebration.ts). */
  Gesture: 17,
} as const;
/** Bit flags in the {@link PF.Flags} slot: human-controlled, has the ball, sprinting. */
export const FLAG_HUMAN = 1;
export const FLAG_BALL = 2;
export const FLAG_SPRINT = 4;

/** One simulation step's snapshot: the ball, every player (P_STRIDE floats each) and the time. */
export class Frame {
  time = 0;
  readonly ball = new Float32Array(11); // x y z qx qy qz qw held(0/1) vx vy vz
  players: Float32Array;

  constructor(readonly playerCount: number) {
    this.players = new Float32Array(playerCount * P_STRIDE);
  }

  capture(m: Match): void {
    const w = m.world;
    this.time = w.time;
    const b = w.ball;
    this.ball[0] = b.pos.x;
    this.ball[1] = b.pos.y;
    this.ball[2] = b.pos.z;
    this.ball[3] = b.quat[0];
    this.ball[4] = b.quat[1];
    this.ball[5] = b.quat[2];
    this.ball[6] = b.quat[3];
    this.ball[7] = b.heldBy !== null ? 1 : 0;
    this.ball[8] = b.vel.x;
    this.ball[9] = b.vel.y;
    this.ball[10] = b.vel.z;
    const P = this.players;
    for (const p of w.players) {
      const o = p.id * P_STRIDE;
      P[o + PF.X] = p.pos.x;
      P[o + PF.Y] = p.y;
      P[o + PF.Z] = p.pos.z;
      P[o + PF.Facing] = p.facing;
      P[o + PF.Anim] = p.anim;
      P[o + PF.AnimTime] = p.animTime;
      P[o + PF.Speed] = p.speed;
      P[o + PF.Lean] = p.lean;
      P[o + PF.Mood] = p.mood;
      P[o + PF.DiveDir] = p.diveDir;
      P[o + PF.Flags] = (p.humanControlled ? FLAG_HUMAN : 0) | (w.controllerId === p.id ? FLAG_BALL : 0) | (p.lastSprint ? FLAG_SPRINT : 0);
      P[o + PF.VelX] = p.vel.x;
      P[o + PF.VelZ] = p.vel.z;
      P[o + PF.Gait] = p.gaitPhase;
      P[o + PF.TouchAge] = Math.min(10, w.time - p.touchTime);
      P[o + PF.TouchFoot] = p.touchFoot;
      P[o + PF.KickFoot] = p.kickFoot;
      P[o + PF.Gesture] = p.gesture;
    }
  }

  copyFrom(f: Frame): void {
    this.time = f.time;
    this.ball.set(f.ball);
    this.players.set(f.players);
  }
}

/** Ring buffer of recent frames for goal replays. */
export class ReplayBuffer {
  private frames: Frame[] = [];
  private head = 0;
  private count = 0;

  constructor(
    readonly capacity: number,
    playerCount: number,
  ) {
    for (let i = 0; i < capacity; i++) this.frames.push(new Frame(playerCount));
  }

  push(m: Match): void {
    this.frames[this.head].capture(m);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }

  /** Copy out the last `n` frames in chronological order. */
  last(n: number): Frame[] {
    const k = Math.min(n, this.count);
    const out: Frame[] = [];
    for (let i = k; i > 0; i--) {
      const idx = (this.head - i + this.capacity) % this.capacity;
      const f = new Frame(this.frames[idx].playerCount);
      f.copyFrom(this.frames[idx]);
      out.push(f);
    }
    return out;
  }
}

/**
 * Fixed-step accumulator: advances the simulation in SIM_DT steps for a variable frame time and
 * returns the interpolation factor between the last two steps. Caps catch-up work after long stalls
 * (tab switches, GC) instead of spiralling.
 */
export class FixedStepClock {
  acc = 0;
  constructor(
    readonly stepDt: number,
    readonly maxSteps = 14,
  ) {}
  /** Calls `step()` zero or more times; returns { steps, alpha }. `step` may return true to stop early. */
  advance(dt: number, step: () => boolean | void): { steps: number; alpha: number } {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.stepDt && steps < this.maxSteps) {
      this.acc -= this.stepDt;
      steps++;
      if (step()) break;
    }
    if (steps >= this.maxSteps) this.acc = 0;
    return { steps, alpha: Math.min(1, this.acc / this.stepDt) };
  }
  reset(): void {
    this.acc = 0;
  }
}

/**
 * Interpolation factor for an entity that moved `dist` metres between two steps `stepDt` apart:
 * movement faster than `maxSpeed` (or beyond `minJump`) is a teleport → snap to the newer step.
 */
export function snapAlpha(dist: number, stepDt: number, alpha: number, maxSpeed: number, minJump: number): number {
  return dist > Math.max(minJump, maxSpeed * Math.max(1e-3, stepDt)) ? 1 : alpha;
}

/**
 * Frame-rate limiter target: an integer multiple of the display refresh interval so frames stay evenly
 * paced. 'balanced' ≈ 60 fps (60 on 60/120/240 Hz, 72 on 144 Hz, 75 on 75 Hz, ~55 on 165 Hz),
 * 'saver' ≈ 30 fps, 'display' = every refresh.
 */
export function frameIntervalFor(refreshDt: number, setting: 'auto' | 'balanced' | 'display' | 'saver', autoStep = 0): number {
  if (setting === 'display') return refreshDt;
  if (setting === 'auto') return autoFrameDivisor(refreshDt, autoStep) * refreshDt;
  const want = setting === 'saver' ? 1 / 30 : 1 / 60;
  return Math.max(1, Math.round(want / refreshDt)) * refreshDt;
}

/** Highest frame rate 'auto' aims for: smooth on 120–165 Hz screens, half rate on 240 Hz+. */
export const AUTO_MAX_FPS = 170;
/**
 * Lowest rate 'auto' may step down to. The adaptive controller (adaptive.ts) only goes below ~55 fps
 * as a last resort, after resolution and quality have been reduced.
 */
export const AUTO_MIN_FPS = 30;

/**
 * 'auto' frame rate: render every refresh up to ~165 Hz (every 2nd on 240 Hz → 120 fps, every 3rd on
 * 360 Hz), stepping to a lower even divisor (`step`) when the machine can't keep up — never below ~30 fps. Always an integer number of refreshes per frame, so pacing stays even.
 */
export function autoFrameDivisor(refreshDt: number, step = 0): number {
  const hz = 1 / refreshDt;
  const n0 = Math.max(1, Math.ceil(hz / AUTO_MAX_FPS));
  const nMax = Math.max(n0, Math.floor(hz / AUTO_MIN_FPS));
  return Math.min(nMax, n0 + Math.max(0, step));
}

/** Number of distinct 'auto' steps below the top rate on this display. */
export function autoFrameSteps(refreshDt: number): number {
  return autoFrameDivisor(refreshDt, 1000) - autoFrameDivisor(refreshDt, 0);
}
