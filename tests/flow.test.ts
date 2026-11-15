/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { BALL, SIM_DT } from '../src/sim/config';
import { emptyInput } from '../src/sim/human';
import { Frame } from '../src/game/frames';
import { ReplayDirector } from '../src/game/replay';
import { makeMatch, runFor } from './helpers';

function live(m: Match) {
  (m as unknown as { phase: string }).phase = 'playing';
  m.world.restrictTouchTo = null;
}

/** Score a goal from a given distance (to exercise replay selection). */
function scoreFrom(m: Match, distance: number, kind: 'shot' | 'header' = 'shot') {
  const w = m.world;
  live(m);
  const L2 = w.pitch.length / 2;
  const shooter = w.players.find((p) => p.team === 0 && !p.isGK)!;
  for (const p of w.players) if (p.id !== shooter.id) p.place(-L2 + 3, (p.id % 2 ? 1 : -1) * 8, 0);
  w.ball.reset(L2 - 1.5, 0, 0.5);
  w.ball.vel.set(15, 0, 0);
  w.lastTouchTeam = 0;
  w.lastTouchId = shooter.id;
  w.lastKick = { playerId: shooter.id, team: 0, kind, time: w.time, receiver: null, fromX: L2 - distance, fromZ: 0, onTarget: true };
  runFor(m, 1, null, () => m.phase === 'goal');
}

describe('match flow', () => {
  it('restarts quickly: throw-in taken within ~1.5 s of the ball going out', () => {
    const m = makeMatch({ aiOnly: true });
    live(m);
    const w = m.world;
    for (const p of w.players) p.place(0, (p.id % 2 ? 1 : -1) * 6, 0);
    w.ball.reset(5, w.pitch.width / 2 - 1, BALL.radius);
    w.ball.vel.set(0, 0, 8);
    w.lastTouchTeam = 1;
    runFor(m, 1, null, () => m.phase === 'stoppage');
    const t0 = w.time;
    runFor(m, 4, null, () => m.phase === 'playing');
    expect(m.phase).toBe('playing');
    expect(w.time - t0).toBeLessThan(1.6);
  });

  it('goal celebration is short and any action skips it', () => {
    const m = makeMatch({ replays: 'off' });
    scoreFrom(m, 10);
    expect(m.phase).toBe('goal');
    runFor(m, 2.6, null, () => m.phase === 'kickoff');
    expect(m.phase).toBe('kickoff'); // ends by itself in under ~2.5 s

    const m2 = makeMatch({ replays: 'off' });
    scoreFrom(m2, 10);
    const input = emptyInput();
    runFor(m2, 0.7, input);
    input.buttons.pass.pressed = true;
    runFor(m2, 0.05, input);
    expect(m2.phase).toBe('kickoff');
  });

  it('replay modes: off never, best only for standout goals, all always', () => {
    const tapIn = makeMatch({ replays: 'best' });
    scoreFrom(tapIn, 6);
    expect(tapIn.replayWorthy).toBe(false);
    const screamer = makeMatch({ replays: 'best' });
    scoreFrom(screamer, 22);
    expect(screamer.replayWorthy).toBe(true);
    const header = makeMatch({ replays: 'best' });
    scoreFrom(header, 7, 'header');
    expect(header.replayWorthy).toBe(true);
    const all = makeMatch({ replays: 'all' });
    scoreFrom(all, 6);
    expect(all.replayWorthy).toBe(true);
    const off = makeMatch({ replays: 'off' });
    scoreFrom(off, 25);
    expect(off.replayWorthy).toBe(false);
    // Legacy boolean option maps to 'best'.
    expect(makeMatch({ replays: true }).replayMode).toBe('best');
  });

  it('a replay phase always resumes with a kick-off', () => {
    const m = makeMatch({ replays: 'all' });
    scoreFrom(m, 20);
    m.finishCelebration();
    expect(m.phase).toBe('replay');
    // The simulation is frozen during a replay…
    const t = m.world.time;
    for (let i = 0; i < 60; i++) m.step(SIM_DT, null);
    expect(m.world.time).toBe(t);
    expect(m.phase).toBe('replay');
    // …and resumes with the conceding team kicking off.
    m.endReplay();
    expect(m.phase).toBe('kickoff');
    expect(m.restart?.team).toBe(1);
  });
});

function syntheticFrames(n: number, strikeAt: number): Frame[] {
  const frames: Frame[] = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const f = new Frame(2);
    f.time = i / 60;
    x += i < strikeAt ? 0.02 : 0.4; // slow dribble, then a shot at 24 m/s
    f.ball[0] = x;
    frames.push(f);
  }
  return frames;
}

describe('ReplayDirector', () => {
  it('finds the strike and starts shortly before it', () => {
    const frames = syntheticFrames(240, 150);
    const r = new ReplayDirector(frames, 60, 1.3);
    expect(Math.abs(r.strikeIndex - 150)).toBeLessThanOrEqual(1);
    const v = r.update(1 / 60, false)!;
    expect(v.index).toBeGreaterThanOrEqual(150 - 1.3 * 60 - 2);
    expect(v.index).toBeLessThan(150);
  });

  it('terminates at the end of the footage', () => {
    const r = new ReplayDirector(syntheticFrames(240, 150), 60);
    let steps = 0;
    while (r.update(1 / 60, false) && steps < 2000) steps++;
    expect(r.done).toBe(true);
    expect(steps).toBeLessThan(600);
  });

  it('terminates immediately when skipped and within the hard time cap', () => {
    const skip = new ReplayDirector(syntheticFrames(240, 150), 60);
    expect(skip.update(1 / 60, true)).toBeNull();
    expect(skip.done).toBe(true);
    const capped = new ReplayDirector(syntheticFrames(5000, 2500), 60, 1.3, 3);
    let t = 0;
    while (capped.update(1 / 60, false)) t += 1 / 60;
    expect(t).toBeLessThanOrEqual(3.01);
  });

  it('handles empty footage safely', () => {
    const r = new ReplayDirector([], 60);
    expect(r.update(1 / 60, false)).toBeNull();
    expect(r.done).toBe(true);
  });

  it('plays the build-up at normal speed and the strike in slow motion', () => {
    const r = new ReplayDirector(syntheticFrames(400, 200), 60, 1.0);
    const advance = (n: number) => {
      const a = r.update(1 / 60, false)!.index;
      let b = a;
      for (let i = 1; i < n; i++) b = r.update(1 / 60, false)!.index;
      return b - a;
    };
    const buildUp = advance(20); // starts 1 s before the strike
    while (r.update(1 / 60, false)!.index < 205);
    const strike = advance(20);
    expect(buildUp).toBeGreaterThan(16);
    expect(strike).toBeLessThan(buildUp * 0.7);
    void SIM_DT;
  });
});
