/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { clamp, hyp } from '../core/math';

/**
 * Match officials (Laws 5 and 6). They never make decisions themselves: the match's rules engine decides,
 * and the officials *show* the decision — whistle, point, cards, advantage, flags — so what players see
 * always matches what the game did. Their movement follows the usual positioning patterns:
 *  - the referee runs a diagonal, staying 12–20 m from the ball, on the ball's flank, never in the lanes
 *    through the middle;
 *  - each assistant patrols one half along one touchline, level with the second-last defender (the
 *    offside line) or the ball, whichever is nearer the goal line.
 */
export type RefSignal = 'none' | 'whistle' | 'point' | 'indirect' | 'advantage' | 'yellow' | 'red' | 'goal';
/** Assistant referee flag signals. */
export type FlagSignal = 'none' | 'raised' | 'offside' | 'throwIn' | 'goalKick' | 'corner';

/** One official's position, movement and current signal (plain data, so frames and tests can read it). */
export interface Official {
  role: 'referee' | 'assistant';
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  signal: RefSignal | FlagSignal;
  /** Direction of the signal on the ground (e.g. which way a throw-in goes, where the free kick is). */
  signalX: number;
  signalZ: number;
  /** Seconds the current signal has been shown; signals end on their own. */
  signalTime: number;
  signalDuration: number;
  /** Signals waiting to be shown after the current one (e.g. a card after pointing to the free kick). */
  queue: Array<{ signal: RefSignal | FlagSignal; x: number; z: number; duration: number }>;
}

/** What the officials need from the match each step to position themselves. */
export interface OfficialsInput {
  ballX: number;
  ballZ: number;
  pitchLength: number;
  pitchWidth: number;
  /** Offside line x (as world x) for the attack going towards +x and towards −x. */
  offsideLinePlusX: number;
  offsideLineMinusX: number;
  live: boolean;
}

const REF_SPEED = 6.5;
const AR_SPEED = 6;

function official(role: Official['role'], x: number, z: number): Official {
  return { role, x, z, vx: 0, vz: 0, facing: 0, signal: 'none', signalX: 0, signalZ: 0, signalTime: 0, signalDuration: 0, queue: [] };
}

/**
 * The referee and two assistants (the assistants are shown only under Standard rules). They move to
 * see play and *display* decisions already made by Match; they never decide anything themselves.
 */
export class Officials {
  readonly referee: Official;
  /** [0] covers the +x half on the −z touchline, [1] the −x half on the +z touchline (diagonal system). */
  readonly assistants: [Official, Official];
  /** Readable log of every signal shown (tests, accessibility announcements). */
  readonly log: Array<{ who: Official['role']; signal: string; t: number }> = [];
  private time = 0;

  constructor(
    readonly pitchLength: number,
    readonly pitchWidth: number,
    readonly withAssistants: boolean,
  ) {
    this.referee = official('referee', -6, 6);
    this.assistants = [official('assistant', pitchLength / 4, -pitchWidth / 2 - 1.2), official('assistant', -pitchLength / 4, pitchWidth / 2 + 1.2)];
  }

  /** Show a referee signal (decided by the rules engine). `after` queues it behind the current signal. */
  refSignal(signal: RefSignal, towardsX = 0, towardsZ = 0, duration = 1.6, after = false): void {
    const r = this.referee;
    if (after && r.signal !== 'none') r.queue.push({ signal, x: towardsX, z: towardsZ, duration });
    else this.setSignal(r, signal, towardsX, towardsZ, duration);
  }

  /** Clear all signals (e.g. a new decision supersedes the previous one). */
  clearSignals(): void {
    for (const o of [this.referee, ...this.assistants]) {
      o.signal = 'none';
      o.queue.length = 0;
    }
  }

  /** Show a flag signal from the assistant responsible for the half where (x, z) is. */
  flag(signal: FlagSignal, atX: number, towardsX = 0, towardsZ = 0, duration = 1.8): void {
    if (!this.withAssistants) return;
    const ar = atX >= 0 ? this.assistants[0] : this.assistants[1];
    this.setSignal(ar, signal, towardsX, towardsZ, duration);
  }

  private setSignal(o: Official, signal: RefSignal | FlagSignal, tx: number, tz: number, duration: number): void {
    if (o.signal === signal && o.signalX === tx && o.signalZ === tz) {
      // Same signal still showing: just keep it up (no new log entry).
      o.signalDuration = Math.max(o.signalDuration - o.signalTime, duration);
      o.signalTime = 0;
      return;
    }
    o.signal = signal;
    o.signalX = tx;
    o.signalZ = tz;
    o.signalTime = 0;
    o.signalDuration = duration;
    this.log.push({ who: o.role, signal, t: +this.time.toFixed(2) });
    if (this.log.length > 50) this.log.shift();
  }

  update(dt: number, s: OfficialsInput): void {
    this.time += dt;
    const L2 = s.pitchLength / 2,
      W2 = s.pitchWidth / 2;
    // Referee: on the diagonal (bottom-left ↔ top-right), ~15 m behind/beside the ball, on the pitch.
    const r = this.referee;
    const side = s.ballX >= 0 ? 1 : -1;
    const tx = clamp(s.ballX - side * Math.min(14, s.pitchLength * 0.14), -L2 + 4, L2 - 4);
    const tz = clamp(s.ballZ * 0.35 + side * Math.min(10, W2 * 0.45), -W2 + 3, W2 - 3);
    this.move(r, tx, tz, REF_SPEED, dt, s.ballX, s.ballZ);
    // Assistants: level with the offside line or the ball in their half, on their touchline.
    const ar0 = this.assistants[0],
      ar1 = this.assistants[1];
    const t0 = clamp(Math.max(s.ballX, s.offsideLinePlusX, 0), 0, L2);
    const t1 = clamp(Math.min(s.ballX, s.offsideLineMinusX, 0), -L2, 0);
    this.move(ar0, t0, -W2 - 1.2, AR_SPEED, dt, s.ballX, s.ballZ);
    this.move(ar1, t1, W2 + 1.2, AR_SPEED, dt, s.ballX, s.ballZ);
    for (const o of [r, ar0, ar1]) {
      if (o.signal === 'none') continue;
      o.signalTime += dt;
      if (o.signalTime >= o.signalDuration) {
        o.signal = 'none';
        o.signalTime = 0;
        const next = o.queue.shift();
        if (next) this.setSignal(o, next.signal, next.x, next.z, next.duration);
      }
    }
  }

  private move(o: Official, tx: number, tz: number, maxSpeed: number, dt: number, lookX: number, lookZ: number): void {
    const dx = tx - o.x,
      dz = tz - o.z;
    const d = hyp(dx, dz);
    // Arrive smoothly; officials walk when close and run when play moves away.
    const want = d < 0.3 ? 0 : Math.min(maxSpeed, d * 1.2);
    const vx = d > 1e-6 ? (dx / d) * want : 0,
      vz = d > 1e-6 ? (dz / d) * want : 0;
    const k = Math.min(1, dt * 4);
    o.vx += (vx - o.vx) * k;
    o.vz += (vz - o.vz) * k;
    o.x += o.vx * dt;
    o.z += o.vz * dt;
    // Face the ball (officials watch play, side-stepping rather than turning their back on it).
    o.facing = Math.atan2(lookZ - o.z, lookX - o.x);
  }
}
