/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { Match } from '../../src/sim/match';
import { AI_PROFILES, Difficulty, MatchFormat, SIM_DT } from '../../src/sim/config';

/**
 * Attacking report (not part of `npm test`): `npm run report:attack`.
 * AI-vs-AI matches on fixed seeds, per format and difficulty: shots, shots on target, goals, crosses,
 * final-third entries and pass completion per match minute, so 11v11 can be compared with 5v5 and a
 * change can be compared before/after. Deterministic: the same code and seeds give the same numbers.
 * Writes test-results/attack-report.txt.
 */
interface Row {
  minutes: number;
  shots: number;
  onTarget: number;
  goals: number;
  crosses: number;
  crossesReceived: number;
  thirdEntries: number;
  passes: number;
  completed: number;
}

function play(format: MatchFormat, difficulty: Difficulty, seed: number, seconds: number): Row {
  const m = new Match({ mode: 'match', format, difficulty, duration: seconds, seed, replays: false, aiOnly: true });
  m.brains[0].profile = AI_PROFILES[difficulty];
  const w = m.world;
  const L2 = w.pitch.length / 2,
    W2 = w.pitch.width / 2;
  const r: Row = { minutes: seconds / 60, shots: 0, onTarget: 0, goals: 0, crosses: 0, crossesReceived: 0, thirdEntries: 0, passes: 0, completed: 0 };
  let pendingCross: { team: number; t: number } | null = null;
  const lastThird: [boolean, boolean] = [false, false];
  w.events.on('kick', (e) => {
    const p = w.players[e.playerId];
    // A cross met first time (header or volley) by a team-mate counts as reaching them.
    if (pendingCross && e.kind !== 'lob' && w.time - pendingCross.t < 3 && p.team === pendingCross.team) {
      r.crossesReceived++;
      pendingCross = null;
    }
    if (e.kind === 'lob' && Math.abs(w.ball.pos.z) > W2 * 0.55 && p.pos.x * w.attackDir(p.team) > L2 * 0.4) {
      r.crosses++;
      pendingCross = { team: p.team, t: w.time };
    }
  });
  w.events.on('control', (e) => {
    const p = w.players[e.playerId];
    if (pendingCross && w.time - pendingCross.t < 3 && p.team === pendingCross.team && p.pos.x * w.attackDir(p.team) > L2 * 0.6) r.crossesReceived++;
    pendingCross = null;
  });
  for (let i = 0; m.phase !== 'fullTime' && i < (seconds + 120) * 120; i++) {
    m.step(SIM_DT, null);
    const c = w.controller;
    for (const t of [0, 1] as const) {
      const inThird = !!c && c.team === t && c.pos.x * w.attackDir(t) > L2 / 3;
      if (inThird && !lastThird[t]) r.thirdEntries++;
      lastThird[t] = inThird;
    }
  }
  for (const s of m.stats) {
    r.shots += s.shots;
    r.onTarget += s.shotsOnTarget;
    r.goals += s.goals;
    r.passes += s.passes;
    r.completed += s.passesCompleted;
  }
  return r;
}

it.skipIf(!process.env.ATTACK)(
  'attack report',
  () => {
    const cases = (process.env.CASES || '11v11/beginner,11v11/easy,11v11/medium,11v11/hard,5v5/medium').split(',');
    const seeds = (process.env.SEEDS || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
    const seconds = Number(process.env.SECONDS || 240);
    const lines = [`Attacking report: ${seeds.length} seeds × ${seconds} s, AI v AI. Rates are per match minute (both teams).`, ''];
    lines.push(
      `${'case'.padEnd(16)}${'shots/min'.padStart(10)}${'onTgt%'.padStart(8)}${'goals/min'.padStart(10)}${'crosses/min'.padStart(12)}${'crossOK%'.padStart(9)}${'3rd/min'.padStart(9)}${'pass%'.padStart(7)}`,
    );
    for (const c of cases) {
      const [f, d] = c.split('/');
      const sum: Row = { minutes: 0, shots: 0, onTarget: 0, goals: 0, crosses: 0, crossesReceived: 0, thirdEntries: 0, passes: 0, completed: 0 };
      for (const seed of seeds) {
        const r = play(f as MatchFormat, d as Difficulty, seed, seconds);
        for (const k of Object.keys(sum) as Array<keyof Row>) sum[k] += r[k];
      }
      const pm = (n: number) => (n / sum.minutes).toFixed(2);
      const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0).toString();
      lines.push(
        `${c.padEnd(16)}${pm(sum.shots).padStart(10)}${pct(sum.onTarget, sum.shots).padStart(8)}${pm(sum.goals).padStart(10)}${pm(sum.crosses).padStart(12)}${pct(sum.crossesReceived, sum.crosses).padStart(9)}${pm(sum.thirdEntries).padStart(9)}${pct(sum.completed, sum.passes).padStart(7)}`,
      );
    }
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/attack-report.txt', lines.join('\n'));
    console.log(lines.join('\n'));
  },
  3600000,
);
