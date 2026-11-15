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
import { AI_PROFILES, PLAYER, SIM_DT } from '../src/sim/config';
import { Anim } from '../src/sim/player';
import { makeMatch } from './helpers';

function live(m: Match) {
  (m as unknown as { phase: string }).phase = 'playing';
  m.world.restrictTouchTo = null;
}

describe('AI behaviour regressions', () => {
  it('pressers jockey at a distance and do not dive into tackles on a protected ball', () => {
    let earlyLunges = 0,
      approaches = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = makeMatch({ seed, format: '3v3', aiOnly: true, difficulty: 'hard' });
      live(m);
      const w = m.world;
      const carrier = w.players.find((p) => p.team === 0 && !p.isGK)!;
      const def = w.players.find((p) => p.team === 1 && !p.isGK)!;
      for (const p of w.players) if (!p.isGK && p.id !== carrier.id && p.id !== def.id) p.place(-22, (p.id % 2 ? 1 : -1) * 12, 0);
      carrier.place(0, 0, 0);
      w.ball.reset(0.45, 0);
      w.controllerId = carrier.id;
      def.place(8, 0, Math.PI);
      let minGap = Infinity;
      for (let i = 0; i < Math.round(2.5 / SIM_DT); i++) {
        m.step(SIM_DT, null);
        const gap = Math.hypot(def.pos.x - carrier.pos.x, def.pos.z - carrier.pos.z);
        minGap = Math.min(minGap, gap);
        if ((def.anim === Anim.Tackle || def.anim === Anim.Slide) && def.animTime < SIM_DT * 1.5 && w.controllerId === carrier.id && w.exposure(carrier) < 0.2)
          earlyLunges++;
      }
      if (minGap < 3) approaches++;
    }
    expect(approaches).toBeGreaterThanOrEqual(5); // they do close down
    expect(earlyLunges).toBeLessThanOrEqual(1); // hard defenders time their tackles
  });

  it('an unpressured carrier keeps the ball and progresses instead of giving it away', () => {
    let kept = 0,
      progressed = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = makeMatch({ seed, format: '5v5', aiOnly: true });
      live(m);
      const w = m.world;
      const carrier = w.players.find((p) => p.team === 0 && p.role === 'MID')!;
      for (const p of w.players) if (p.team === 1 && !p.isGK) p.place(25, ((p.id % 3) - 1) * 10, Math.PI);
      carrier.place(-15, 0, 0);
      w.ball.reset(carrier.footX(0.5), 0);
      const x0 = carrier.pos.x;
      // Only count a loss that comes straight off this carrier (not a teammate's later duel).
      let lostToOpp = false;
      let lastTeam0: number | null = carrier.id;
      w.events.on('control', (e) => {
        const p = w.players[e.playerId];
        if (p.team === 1 && lastTeam0 === carrier.id) lostToOpp = true;
        if (p.team === 0) lastTeam0 = p.id;
      });
      w.events.on('kick', (e) => {
        if (e.playerId === carrier.id) lastTeam0 = null;
      });
      for (let i = 0; i < Math.round(3 / SIM_DT); i++) m.step(SIM_DT, null);
      if (!lostToOpp) kept++;
      // Progress: the ball has moved upfield (by dribbling or passing).
      if (w.ball.pos.x > x0 + 4) progressed++;
    }
    expect(kept).toBe(5);
    expect(progressed).toBeGreaterThanOrEqual(4);
  });

  it('off-ball players hold shape at a walk/jog rather than sprinting around', () => {
    const m = makeMatch({ seed: 9, format: '5v5', aiOnly: true, duration: 600 });
    let samples = 0,
      sprinting = 0,
      still = 0;
    for (let i = 0; i < Math.round(60 / SIM_DT); i++) {
      m.step(SIM_DT, null);
      if (m.phase !== 'playing' || i % 6) continue;
      const ctrl = m.world.controllerId;
      for (const p of m.world.players) {
        if (p.isGK || p.id === ctrl) continue;
        samples++;
        if (p.lastSprint && p.speed > PLAYER.runSpeed) sprinting++;
        if (p.speed < 0.5) still++;
      }
    }
    expect(sprinting / samples).toBeLessThan(0.15);
    expect(still / samples).toBeLessThan(0.6); // …but they don't freeze either
  });

  it('carriers facing a squared-up defender slow down, shield, pass or try to beat him — rarely run straight into him', () => {
    let lostImmediately = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const m = makeMatch({ seed, format: '5v5', aiOnly: true });
      live(m);
      const w = m.world;
      const carrier = w.players.find((p) => p.team === 0 && p.role === 'MID')!;
      const def = w.players.find((p) => p.team === 1 && p.role === 'DEF')!;
      carrier.place(0, 0, 0);
      w.ball.reset(carrier.footX(0.45), 0);
      w.controllerId = carrier.id;
      def.place(2.2, 0, Math.PI);
      let lost = false;
      w.events.on('control', (e) => {
        if (w.players[e.playerId].team === 1) lost = true;
      });
      for (let i = 0; i < Math.round(1.2 / SIM_DT) && !lost; i++) m.step(SIM_DT, null);
      if (lost) lostImmediately++;
    }
    expect(lostImmediately).toBeLessThanOrEqual(3);
  });

  it('difficulty changes decisions, not physics: identical movement limits for all profiles', () => {
    // Speeds come from PLAYER constants only; profiles contain no speed fields.
    for (const prof of Object.values(AI_PROFILES)) {
      expect(Object.keys(prof).some((k) => /speed|accel/i.test(k))).toBe(false);
    }
  });
});
