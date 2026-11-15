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
import { AI_PROFILES, SIM_DT, MatchFormat, Difficulty } from '../src/sim/config';
import { evaluatePass, evaluateShot } from '../src/sim/ai/evaluate';
import { makeMatch, runFor, summary } from './helpers';

function startPlay(m: Match) {
  (m as unknown as { phase: string }).phase = 'playing';
  m.world.restrictTouchTo = null;
}

describe('AI evaluation', () => {
  it('rates shots from close and central higher than from wide and far', () => {
    const m = makeMatch();
    const L2 = m.pitch.length / 2;
    for (const p of m.world.players) if (!p.isGK) p.place(-L2 + 3, 0, 0);
    const close = evaluateShot(m.world, 0, L2 - 8, 0, -1);
    const far = evaluateShot(m.world, 0, L2 - 24, 12, -1);
    expect(close.quality).toBeGreaterThan(far.quality);
    expect(Math.abs(close.aimZ)).toBeLessThan(m.pitch.goalWidth / 2);
  });

  it('rates a blocked passing lane as risky', () => {
    const m = makeMatch();
    const w = m.world;
    const [a, b] = w.players.filter((p) => p.team === 0 && !p.isGK);
    const opp = w.players.filter((p) => p.team === 1 && !p.isGK);
    a.place(0, 0, 0);
    b.place(12, 0, 0);
    w.ball.reset(0.5, 0);
    opp.forEach((o, i) => o.place(-15, 10 + i, 0));
    const open = evaluatePass(w, a, b, 12, 0, 0.2);
    opp[0].place(6, 0.2, 0);
    const blocked = evaluatePass(w, a, b, 12, 0, 0.2);
    expect(open.success).toBeGreaterThan(0.8);
    expect(blocked.success).toBeLessThan(0.4);
  });
});

describe('AI decisions', () => {
  it('an unmarked attacker in front of goal shoots', () => {
    const m = makeMatch({ aiOnly: true, difficulty: 'hard' });
    const w = m.world;
    startPlay(m);
    const L2 = m.pitch.length / 2;
    const att = w.players.find((p) => p.team === 0 && p.role === 'FWD') ?? w.players.find((p) => p.team === 0 && !p.isGK)!;
    for (const p of w.players) if (p.id !== att.id && !p.isGK) p.place(-L2 + 5, (p.id - 3) * 3, 0);
    att.place(L2 - 9, 0, 0);
    w.ball.reset(att.footX(0.5), att.footZ(0.5));
    let shot = false;
    w.events.on('kick', (e) => {
      if (e.playerId === att.id && (e.kind === 'shot' || e.kind === 'chip')) shot = true;
    });
    runFor(m, 2, null, () => shot);
    expect(shot).toBe(true);
  });

  it('a pressured carrier with an open teammate passes', () => {
    const m = makeMatch({ format: '5v5', aiOnly: true, difficulty: 'hard', seed: 3 });
    const w = m.world;
    startPlay(m);
    const team0 = w.players.filter((p) => p.team === 0 && !p.isGK);
    const team1 = w.players.filter((p) => p.team === 1 && !p.isGK);
    const carrier = team0[0];
    carrier.place(-10, 0, 0);
    team0[1].place(-10, 12, 0);
    team0[2].place(-2, -10, 0);
    team0[3].place(0, 8, 0);
    team1[0].place(-7.8, 0, Math.PI);
    team1[1].place(-6, -2, Math.PI);
    team1.slice(2).forEach((o, i) => o.place(15, i * 3, Math.PI));
    w.ball.reset(carrier.footX(0.5), carrier.footZ(0.5));
    let passed = false;
    w.events.on('kick', (e) => {
      if (e.playerId === carrier.id && (e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob')) passed = true;
    });
    runFor(m, 1.5, null, () => passed);
    expect(passed).toBe(true);
  });

  it('the goalkeeper reacts to a shot heading for the corner', () => {
    const m = makeMatch({ aiOnly: true, difficulty: 'hard' });
    const w = m.world;
    startPlay(m);
    const L2 = m.pitch.length / 2;
    for (const p of w.players) if (!p.isGK) p.place(-L2 / 2, (p.id % 3) * 4 - 4, 0);
    const keeper = w.players.find((p) => p.isGK && p.team === 1)!;
    keeper.place(L2 - 0.8, 0, Math.PI);
    const shooter = w.players.find((p) => p.team === 0 && !p.isGK)!;
    w.ball.reset(L2 - 14, 0);
    w.ball.vel.set(16, 1.2, 2.2);
    w.lastKick = { playerId: shooter.id, team: 0, kind: 'shot', time: w.time, receiver: null, fromX: L2 - 14, fromZ: 0, onTarget: true };
    w.lastTouchTeam = 0;
    w.lastTouchId = shooter.id;
    let reacted = false;
    let saved = false;
    w.events.on('save', () => {
      saved = true;
    });
    const startZ = keeper.pos.z;
    runFor(m, 1.2, null, () => {
      if (Math.abs(keeper.pos.z - startZ) > 0.5) reacted = true;
      return saved || m.phase !== 'playing';
    });
    expect(reacted || saved).toBe(true);
  });
});

describe('full AI matches', () => {
  const cases: Array<[MatchFormat, Difficulty]> = [
    ['3v3', 'medium'],
    ['5v5', 'hard'],
    ['5v5', 'easy'],
    ['11v11', 'medium'],
  ];
  for (const [format, difficulty] of cases) {
    it(`completes a ${format} ${difficulty} AI-vs-AI match with sane state`, () => {
      const m = makeMatch({ format, difficulty, aiOnly: true, duration: 150, seed: 99 });
      let kicks = 0,
        passes = 0,
        shots = 0;
      m.events.on('kick', (e) => {
        kicks++;
        if (e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob') passes++;
        if (e.kind === 'shot' || e.kind === 'header' || e.kind === 'chip') shots++;
      });
      const steps = Math.round(400 / SIM_DT);
      for (let i = 0; i < steps && m.phase !== 'fullTime'; i++) {
        m.step(SIM_DT, null);
        if (m.phase === 'replay') m.endReplay();
        if (i % 600 === 0) {
          for (const p of m.world.players) {
            expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z)).toBe(true);
          }
          expect(m.world.ball.pos.isFinite()).toBe(true);
        }
      }
      expect(m.phase).toBe('fullTime');
      expect(passes).toBeGreaterThan(10);
      // Shot volume is guarded statistically (multi-seed) in gameplay-metrics.test.ts.
      expect(shots).toBeGreaterThanOrEqual(0);
      expect(m.stats[0].possession).toBeGreaterThan(5);
      expect(m.stats[1].possession).toBeGreaterThan(5);
      // Log a summary to help tune gameplay.
      summary(
        `${format}/${difficulty}: score ${m.score.join('-')} kicks=${kicks} passes=${passes} shots=${shots}`,
        `poss ${m.stats[0].possession.toFixed(0)}/${m.stats[1].possession.toFixed(0)}`,
        `passComp ${m.stats[0].passesCompleted}/${m.stats[0].passes} ${m.stats[1].passesCompleted}/${m.stats[1].passes}`,
        `tackles ${m.stats[0].tackles}/${m.stats[1].tackles} saves ${m.stats[0].saves}/${m.stats[1].saves}`,
      );
    }, 60000);
  }

  it('is deterministic for a given seed', () => {
    const a = makeMatch({ aiOnly: true, duration: 40, seed: 5 });
    const b = makeMatch({ aiOnly: true, duration: 40, seed: 5 });
    runFor(a, 60, null, () => a.phase === 'fullTime');
    runFor(b, 60, null, () => b.phase === 'fullTime');
    expect(a.score).toEqual(b.score);
    expect(a.world.ball.pos.x).toBeCloseTo(b.world.ball.pos.x, 6);
  });

  it('harder AI outscores easier AI over several matches', () => {
    let hardGoals = 0,
      easyGoals = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const m = new Match({ mode: 'match', format: '5v5', difficulty: 'hard', duration: 150, seed, replays: false, aiOnly: true });
      m.brains[0].profile = AI_PROFILES.easy;
      m.brains[1].profile = AI_PROFILES.hard;
      runFor(m, 300, null, () => m.phase === 'fullTime');
      hardGoals += m.score[1];
      easyGoals += m.score[0];
    }
    summary(`hard vs easy aggregate: ${hardGoals}-${easyGoals}`);
    expect(hardGoals).toBeGreaterThan(easyGoals);
  }, 180000);
});
