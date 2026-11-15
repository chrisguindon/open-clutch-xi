/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { Frame } from './frames';

export interface ReplayView {
  a: Frame;
  b: Frame;
  alpha: number;
  /** 0..1 progress through the replay. */
  progress: number;
  /** Frame index where the decisive strike happens (for camera direction). */
  strikeIndex: number;
  index: number;
}

/**
 * Plays back a buffered goal: starts shortly before the decisive strike, slows down around it,
 * and is guaranteed to finish (end of footage, skip, or a hard time limit).
 * Pure logic — no rendering — so it is unit-testable.
 */
export class ReplayDirector {
  readonly strikeIndex: number;
  private pos: number;
  private elapsed = 0;
  done = false;

  constructor(
    readonly frames: Frame[],
    readonly rate = 60,
    readonly leadIn = 1.3,
    /** Hard cap on real playback time (s). */
    readonly maxDuration = 7,
  ) {
    this.strikeIndex = ReplayDirector.findStrike(frames);
    this.pos = Math.max(0, this.strikeIndex - leadIn * rate);
    if (frames.length < 2) this.done = true;
  }

  /** Index of the largest single-step jump in ball speed (the strike); falls back to the middle. */
  static findStrike(frames: Frame[]): number {
    let best = -1,
      bestJump = 4; // m/s threshold
    for (let i = 2; i < frames.length; i++) {
      const v1 = speedAt(frames, i - 1),
        v2 = speedAt(frames, i);
      const jump = v2 - v1;
      if (jump > bestJump) {
        bestJump = jump;
        best = i;
      }
    }
    return best >= 0 ? best : Math.floor(frames.length / 2);
  }

  /** Playback speed: normal during the build-up, slow motion from just before the strike. */
  private speed(): number {
    const d = (this.pos - this.strikeIndex) / this.rate;
    return d < -0.35 ? 1 : 0.55;
  }

  update(dt: number, skip: boolean): ReplayView | null {
    if (this.done) return null;
    this.elapsed += dt;
    if (skip || this.elapsed > this.maxDuration) {
      this.done = true;
      return null;
    }
    this.pos += dt * this.rate * this.speed();
    const last = this.frames.length - 1;
    if (this.pos >= last) {
      this.done = true;
      return null;
    }
    const i = Math.floor(this.pos);
    return {
      a: this.frames[i],
      b: this.frames[Math.min(last, i + 1)],
      alpha: this.pos - i,
      progress: this.pos / last,
      strikeIndex: this.strikeIndex,
      index: i,
    };
  }
}

function speedAt(frames: Frame[], i: number): number {
  const a = frames[i - 1].ball,
    b = frames[i].ball;
  const dt = Math.max(1e-3, frames[i].time - frames[i - 1].time);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / dt;
}
