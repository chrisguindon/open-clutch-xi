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
 * Input-to-action latency tracking for real gameplay (keyboard / gamepad / touch).
 *
 * Every measurement starts from the browser input event's timestamp (performance.now() timebase) and
 * ends at a point *inside the game*:
 *   - move:   input → first simulation step that used it (toSim)
 *             input → first step where the controlled player's velocity measurably responds (toMotion)
 *             input → the frame containing that response was submitted to WebGL (toMotionFrame)
 *   - pass / shot / through / lob: press → ball leaves the foot (pressToRelease), split into the time the
 *     button was held (hold) and the kick wind-up after release (windup)
 *   - switch: press → controlled player changed
 * These are SOFTWARE PROCESSING delays. Physical end-to-end latency additionally includes USB/OS
 * input handling before the event is stamped, waiting for vsync, the compositor and the display's own
 * response time — that needs external hardware (high-speed camera / latency tester) to measure.
 */
export type ActionKind = 'pass' | 'shoot' | 'through' | 'lob' | 'switch';

interface PendingMove {
  t: number;
  dirX: number;
  dirZ: number;
  base: number;
  simAt: number | null;
  motionAt: number | null;
}
interface PendingAction {
  kind: ActionKind;
  pressAt: number;
  releaseAt: number | null;
  simAt: number | null;
}

const MAX = 200;
function push(a: number[], v: number): void {
  a.push(v);
  if (a.length > MAX) a.shift();
}
function pct(v: number[], p: number): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
}
const stat = (v: number[]) => ({ n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95) });

export class InputLatencyTracker {
  readonly move = { toSim: [] as number[], toMotion: [] as number[], toMotionFrame: [] as number[] };
  /** pressToRelease = press → ball leaves the foot; queue = press → first simulation step that saw it;
   *  hold = how long the button was held before release when the kick waited for the release (charged);
   *  windup = in-game kick wind-up (from the later of first step / release to ball contact). */
  readonly actions: Record<ActionKind, { pressToRelease: number[]; queue: number[]; hold: number[]; windup: number[] }> = {
    pass: { pressToRelease: [], queue: [], hold: [], windup: [] },
    shoot: { pressToRelease: [], queue: [], hold: [], windup: [] },
    through: { pressToRelease: [], queue: [], hold: [], windup: [] },
    lob: { pressToRelease: [], queue: [], hold: [], windup: [] },
    switch: { pressToRelease: [], queue: [], hold: [], windup: [] },
  };
  private pendingMove: PendingMove | null = null;
  private pending: PendingAction[] = [];
  private frameWaiters: number[] = [];
  /** Velocity response threshold (m/s) along the new input direction. */
  motionThreshold = 0.35;

  /** A movement input changed (new direction in world space, already camera-mapped). */
  moveInput(t: number, dirX: number, dirZ: number, velX: number, velZ: number): void {
    const l = Math.hypot(dirX, dirZ);
    if (l < 0.2) {
      this.pendingMove = null;
      return;
    } // releases are not timed
    const dx = dirX / l,
      dz = dirZ / l;
    this.pendingMove = { t, dirX: dx, dirZ: dz, base: velX * dx + velZ * dz, simAt: null, motionAt: null };
  }

  /** Called after every simulation step with the controlled player's velocity. */
  simStep(now: number, velX: number, velZ: number): void {
    for (const p of this.pending) if (p.simAt === null) p.simAt = now;
    const m = this.pendingMove;
    if (!m) return;
    if (m.simAt === null) {
      m.simAt = now;
      push(this.move.toSim, now - m.t);
    }
    const along = velX * m.dirX + velZ * m.dirZ;
    if (m.motionAt === null && along - m.base >= this.motionThreshold) {
      m.motionAt = now;
      push(this.move.toMotion, now - m.t);
      this.frameWaiters.push(m.t);
      this.pendingMove = null;
    } else if (now - m.t > 1500) {
      this.pendingMove = null; // never responded (e.g. already at top speed that way)
    }
  }

  buttonDown(kind: ActionKind, t: number): void {
    this.pending = this.pending.filter((p) => t - p.pressAt < 3000);
    this.pending.push({ kind, pressAt: t, releaseAt: null, simAt: null });
  }
  buttonUp(kind: ActionKind, t: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.kind === kind && p.releaseAt === null) {
        p.releaseAt = t;
        break;
      }
    }
  }

  /** The controlled player struck the ball (kind as requested by the human). */
  kicked(kind: ActionKind, now: number): void {
    const i = this.pending.findIndex((p) => p.kind === kind);
    if (i < 0) return;
    const p = this.pending[i];
    this.pending.splice(i, 1);
    const a = this.actions[kind];
    const simAt = p.simAt ?? now;
    const waitedForRelease = p.releaseAt !== null && p.releaseAt <= now;
    push(a.pressToRelease, now - p.pressAt);
    push(a.queue, Math.max(0, simAt - p.pressAt));
    push(a.hold, waitedForRelease ? Math.max(0, p.releaseAt! - p.pressAt) : 0);
    push(a.windup, Math.max(0, now - Math.max(simAt, waitedForRelease ? p.releaseAt! : -Infinity)));
  }

  /** Control moved to another player after a switch press. */
  switched(now: number): void {
    const i = this.pending.findIndex((p) => p.kind === 'switch');
    if (i < 0) return;
    push(this.actions.switch.pressToRelease, now - this.pending[i].pressAt);
    this.pending.splice(i, 1);
  }

  /** A frame was submitted to WebGL. */
  frameSubmitted(now: number): void {
    for (const t of this.frameWaiters) push(this.move.toMotionFrame, now - t);
    this.frameWaiters.length = 0;
  }

  summary() {
    const act = (k: ActionKind) => ({
      pressToRelease: stat(this.actions[k].pressToRelease),
      queue: stat(this.actions[k].queue),
      hold: stat(this.actions[k].hold),
      windup: stat(this.actions[k].windup),
    });
    return {
      move: { toSim: stat(this.move.toSim), toMotion: stat(this.move.toMotion), toMotionFrame: stat(this.move.toMotionFrame) },
      pass: act('pass'),
      shoot: act('shoot'),
      through: act('through'),
      lob: act('lob'),
      switch: { toSwitch: stat(this.actions.switch.pressToRelease) },
      note: 'Software processing only: from the browser input event to the simulation / the submitted frame. Excludes USB/OS input, vsync wait, compositor and display latency (needs external hardware).',
    };
  }

  reset(): void {
    this.move.toSim.length = this.move.toMotion.length = this.move.toMotionFrame.length = 0;
    for (const k of Object.keys(this.actions) as ActionKind[]) {
      const a = this.actions[k];
      a.pressToRelease.length = a.queue.length = a.hold.length = a.windup.length = 0;
    }
    this.pending = [];
    this.pendingMove = null;
    this.frameWaiters = [];
  }
}
