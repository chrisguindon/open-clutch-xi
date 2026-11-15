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
import { BALL } from '../src/sim/config';
import { emptyInput } from '../src/sim/human';
import { makeMatch, runFor } from './helpers';

/** Put the ball into open play at a position with a velocity. */
function liveBall(m: Match, x: number, y: number, z: number, vx: number, vy: number, vz: number, lastTeam: 0 | 1 = 0) {
  const w = m.world;
  // Start play.
  (m as unknown as { phase: string }).phase = 'playing';
  w.restrictTouchTo = null;
  w.ball.reset(x, z, y);
  w.ball.vel.set(vx, vy, vz);
  w.lastTouchTeam = lastTeam;
  w.lastTouchId = w.players.find((p) => p.team === lastTeam && !p.isGK)!.id;
  // Move players away from the ball path.
  for (const p of w.players) p.place(0, (p.id % 2 ? 1 : -1) * (w.pitch.width / 2 - 1), 0);
}

describe('match rules', () => {
  it('starts with a kick-off for the home team and restricts touches to the taker', () => {
    const m = makeMatch();
    expect(m.phase).toBe('kickoff');
    expect(m.restart?.type).toBe('kickoff');
    expect(m.world.restrictTouchTo).toBe(m.restart?.takerId);
    expect(m.humanId).toBe(m.restart?.takerId);
  });

  it('AI takes the kick-off when both teams are AI controlled', () => {
    const m = makeMatch({ aiOnly: true });
    runFor(m, 4, null, () => m.phase === 'playing');
    expect(m.phase).toBe('playing');
  });

  it('human can take the kick-off with a pass', () => {
    const m = makeMatch();
    const input = emptyInput();
    runFor(m, 0.2, input);
    input.buttons.pass.down = true;
    runFor(m, 0.1, input);
    input.buttons.pass.down = false;
    input.buttons.pass.released = true;
    input.buttons.pass.held = 0.2;
    runFor(m, 1.0, input, () => m.phase === 'playing');
    expect(m.phase).toBe('playing');
  });

  it('detects a goal, updates the score and restarts with the conceding team', () => {
    const m = makeMatch();
    const L2 = m.pitch.length / 2;
    liveBall(m, L2 - 3, 0.5, 0, 20, 0, 0, 0);
    runFor(m, 1, null, () => m.phase === 'goal');
    expect(m.phase).toBe('goal');
    expect(m.score).toEqual([1, 0]);
    runFor(m, 5, null, () => m.phase === 'kickoff');
    expect(m.phase).toBe('kickoff');
    expect(m.restart?.team).toBe(1);
  });

  it('does not award a goal when the ball goes over the crossbar', () => {
    const m = makeMatch();
    const L2 = m.pitch.length / 2;
    liveBall(m, L2 - 3, m.pitch.goalHeight + 0.6, 0, 20, 1, 0, 0);
    runFor(m, 1, null, () => m.phase !== 'playing');
    expect(m.score).toEqual([0, 0]);
    expect(m.phase).toBe('stoppage');
  });

  it('awards a throw-in to the other team when the ball crosses the touchline', () => {
    const m = makeMatch();
    const W2 = m.pitch.width / 2;
    liveBall(m, 5, BALL.radius, W2 - 1, 0, 0, 8, 1);
    runFor(m, 1, null, () => m.phase === 'stoppage');
    expect(m.phase).toBe('stoppage');
    runFor(m, 2, null, () => m.phase === 'restart');
    expect(m.restart?.type).toBe('throwIn');
    expect(m.restart?.team).toBe(0);
    expect(m.world.ball.heldBy).toBe(m.restart?.takerId);
  });

  it('awards a corner when the defending team puts it behind', () => {
    const m = makeMatch();
    const L2 = m.pitch.length / 2;
    liveBall(m, L2 - 2, BALL.radius, m.pitch.goalWidth, 10, 0, 0, 1); // team 1 defends +x
    runFor(m, 2.5, null, () => m.phase === 'restart');
    expect(m.restart?.type).toBe('corner');
    expect(m.restart?.team).toBe(0);
    expect(m.stats[0].corners).toBe(1);
  });

  it('awards a goal kick when the attacking team puts it behind', () => {
    const m = makeMatch();
    const L2 = m.pitch.length / 2;
    liveBall(m, L2 - 2, BALL.radius, m.pitch.goalWidth, 10, 0, 0, 0);
    runFor(m, 2.5, null, () => m.phase === 'restart');
    expect(m.restart?.type).toBe('goalKick');
    expect(m.restart?.team).toBe(1);
    expect(m.world.players[m.restart!.takerId].isGK).toBe(true);
  });

  it('ends the match when the clock runs out', () => {
    const m = makeMatch({ duration: 5, aiOnly: true });
    runFor(m, 30, null, () => m.phase === 'fullTime');
    expect(m.phase).toBe('fullTime');
    expect(m.minute).toBe(90);
  });

  it('penalty shootout decision logic', () => {
    const k = (team: 0 | 1, scored: boolean) => ({ team, scored, saved: false });
    expect(Match.shootoutDecided([k(0, true), k(1, true)])).toBe('continue');
    // 3-0 after three each: team 1 cannot catch up with two left.
    expect(Match.shootoutDecided([k(0, true), k(1, false), k(0, true), k(1, false), k(0, true), k(1, false)])).toBe(0);
    // Level after five each → sudden death continues.
    const five = [] as ReturnType<typeof k>[];
    for (let i = 0; i < 5; i++) five.push(k(0, true), k(1, true));
    expect(Match.shootoutDecided(five)).toBe('continue');
    expect(Match.shootoutDecided([...five, k(0, true), k(1, false)])).toBe(0);
    expect(Match.shootoutDecided([...five, k(0, true)])).toBe('continue');
  });

  it('runs a complete penalty shootout to a result', () => {
    const m = makeMatch({ mode: 'penalties', aiOnly: true, seed: 7 });
    runFor(m, 200, null, () => m.phase === 'fullTime');
    expect(m.phase).toBe('fullTime');
    expect(m.penKicks.length).toBeGreaterThanOrEqual(6);
    expect(m.winner).not.toBeNull();
  });

  it('practice mode returns the ball to the player after it goes out', () => {
    const m = makeMatch({ mode: 'practice' });
    const w = m.world;
    w.ball.reset(0, w.pitch.width / 2 + 2);
    runFor(m, 1.5);
    expect(Math.abs(w.ball.pos.z)).toBeLessThan(w.pitch.width / 2);
  });
});
