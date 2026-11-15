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
import { Difficulty, SIM_DT } from '../sim/config';
import { consumeEdges, emptyInput } from '../sim/human';
import { Rng } from '../core/rng';

/**
 * Repeatable penalty-shootout simulation on the real match code (physics, keeper, AI). Models simple
 * human behaviours for the shooter and the keeper and reports outcome rates. Used by
 * tests/penalties.test.ts and docs/gameplay/ai-and-difficulty.md. Outcomes depend on the physical simulation; these
 * models are approximations of players, not a substitute for playtesting.
 */
export type ShooterModel = 'good' | 'central' | 'overhit' | 'weak' | 'wide';
/** Simulated goalkeeper behaviours, from no dive at all to always guessing right. */
export type KeeperModel = 'none' | 'random' | 'tell' | 'early' | 'perfect';

/** Outcome counts from a batch of simulated penalties. */
export interface PenaltyRates {
  kicks: number;
  goal: number;
  saved: number;
  missed: number;
}

function newRates(): PenaltyRates {
  return { kicks: 0, goal: 0, saved: 0, missed: 0 };
}

/** Human shooting vs AI keeper. */
export function simulateShooting(model: ShooterModel, difficulty: Difficulty, kicks = 200, seed = 1): PenaltyRates {
  const out = newRates();
  const rng = new Rng(seed * 7919);
  let s = seed;
  while (out.kicks < kicks) {
    const m = new Match({ mode: 'penalties', format: '5v5', difficulty, duration: 9999, seed: s++, replays: false });
    const input = emptyInput();
    const gw = m.pitch.goalWidth / 2,
      gh = m.pitch.goalHeight;
    let guard = 0;
    m.events.on('penalty', (e) => {
      if (e.team !== 0) return;
      out.kicks++;
      if (e.scored) out.goal++;
      else if (m.lastPenaltyOutcome === 'saved') out.saved++;
      else out.missed++;
    });
    while (m.phase !== 'fullTime' && out.kicks < kicks && guard++ < 120 * 120) {
      if (m.phase === 'penReady' && m.restart?.team === 0 && m.phaseTime > 0.3) {
        const side = rng.chance(0.5) ? 1 : -1;
        let z = 0,
          y = 0.6,
          p = 0.7;
        if (model === 'good') {
          z = side * rng.range(gw - 0.75, gw - 0.35);
          y = rng.range(0.3, 1.7);
          p = rng.range(0.6, 0.8);
        }
        if (model === 'central') {
          z = rng.range(-0.8, 0.8);
          y = rng.range(0.4, 1.4);
          p = rng.range(0.5, 0.75);
        }
        if (model === 'overhit') {
          z = side * rng.range(gw - 0.75, gw - 0.35);
          y = rng.range(0.6, 1.8);
          p = 1;
        }
        if (model === 'weak') {
          z = side * rng.range(gw - 1.2, gw - 0.5);
          y = rng.range(0.2, 0.8);
          p = rng.range(0.15, 0.3);
        }
        if (model === 'wide') {
          z = side * rng.range(gw - 0.05, gw + 0.6);
          y = rng.range(0.4, 1.6);
          p = rng.range(0.6, 0.8);
        }
        m.takePenalty(z, y, p);
      }
      m.step(SIM_DT, input);
      consumeEdges(input);
    }
    void gh;
  }
  return out;
}

/** AI shooting vs a modelled human keeper. */
export function simulateKeeping(model: KeeperModel, difficulty: Difficulty, kicks = 200, seed = 1): PenaltyRates {
  const out = newRates();
  const rng = new Rng(seed * 104729);
  let s = seed;
  while (out.kicks < kicks) {
    const m = new Match({ mode: 'penalties', format: '5v5', difficulty, duration: 9999, seed: s++, replays: false });
    const input = emptyInput();
    let guard = 0;
    let dived = false;
    let plannedSide = 0;
    m.events.on('penalty', (e) => {
      if (e.team !== 1) return;
      out.kicks++;
      if (e.scored) out.goal++;
      else if (m.lastPenaltyOutcome === 'saved') out.saved++;
      else out.missed++;
    });
    m.events.on('phase', (e) => {
      if (e.phase === 'penReady') {
        dived = false;
        plannedSide = rng.chance(0.5) ? 1 : -1;
      }
    });
    while (m.phase !== 'fullTime' && out.kicks < kicks && guard++ < 120 * 120) {
      // Our own kicks in this simulation: a well-aimed shot (only the AI kicks against us are measured).
      if (m.phase === 'penReady' && m.restart?.team === 0 && m.phaseTime > 0.2) m.takePenalty(rng.chance(0.5) ? 2.8 : -2.8, 1, 0.7);
      const keeping = m.restart?.team === 1;
      input.move.z = 0;
      input.buttons.shoot.pressed = false;
      if (keeping && !dived && model !== 'none') {
        const info = m.penaltyInfo();
        // Seconds until the strike (run-up) — the keeper sees the shooter arriving at the ball.
        const tToStrike = info.timeToStrike;
        const side = model === 'random' ? plannedSide : model === 'perfect' ? info.aimSide : info.tellSide || plannedSide;
        const diveAt = model === 'early' ? 0.35 : 0;
        const strikeSeen = m.phase === 'penFlight';
        if ((model === 'early' && m.phase === 'penRunup' && tToStrike <= diveAt) || (model !== 'early' && strikeSeen)) {
          input.move.z = side;
          input.buttons.shoot.pressed = true;
          input.buttons.shoot.down = true;
          dived = true;
        }
      }
      m.step(SIM_DT, input);
      consumeEdges(input);
      input.buttons.shoot.down = false;
    }
  }
  return out;
}

/** Outcome counts as rounded percentages. */
export function pct(r: PenaltyRates): { goal: number; saved: number; missed: number } {
  const k = Math.max(1, r.kicks);
  return { goal: Math.round((r.goal / k) * 100), saved: Math.round((r.saved / k) * 100), missed: Math.round((r.missed / k) * 100) };
}
