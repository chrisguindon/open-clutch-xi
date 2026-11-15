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
import { SIM_DT } from '../src/sim/config';
import { InputFrame, consumeEdges, emptyInput } from '../src/sim/human';
import { Player } from '../src/sim/player';
import { makeMatch } from './helpers';

/** Live 3v3 with the human on team 0 and everyone else parked far away. */
function solo(seed = 1) {
  const m = makeMatch({ seed, format: '3v3' });
  (m as unknown as { phase: string }).phase = 'playing';
  m.world.restrictTouchTo = null;
  const w = m.world;
  const h = w.players.find((p) => p.team === 0 && !p.isGK)!;
  m.setHuman(h.id);
  for (const p of w.players) if (p.id !== h.id) p.place(-20, (p.id - 3) * 4, 0);
  return { m, w, h, input: emptyInput() };
}

function step(m: Match, input: InputFrame | null, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    m.step(SIM_DT, input);
    if (input) consumeEdges(input);
    each?.();
  }
}

const footDist = (p: Player, x: number, z: number) => Math.hypot(x - p.footX(0.35), z - p.footZ(0.35));

describe('ball contact', () => {
  it('dribble touches only happen with the ball at the feet, and the ball stays within playing distance', () => {
    const { m, w, h, input } = solo();
    h.place(-15, 0, 0);
    w.ball.reset(h.footX(0.5), 0);
    let touches = 0,
      worstContact = 0,
      maxGap = 0;
    w.events.on('touch', (e) => {
      if (e.playerId !== h.id) return;
      touches++;
      // The touch event fires after the impulse: rewind one step of ball motion.
      const bx = w.ball.pos.x - w.ball.vel.x * SIM_DT,
        bz = w.ball.pos.z - w.ball.vel.z * SIM_DT;
      worstContact = Math.max(worstContact, Math.min(footDist(h, bx, bz), Math.hypot(bx - h.pos.x, bz - h.pos.z)));
    });
    input.move = { x: 1, z: 0 };
    step(m, input, 4, () => {
      maxGap = Math.max(maxGap, Math.hypot(w.ball.pos.x - h.pos.x, w.ball.pos.z - h.pos.z));
    });
    expect(touches).toBeGreaterThan(3);
    expect(worstContact).toBeLessThan(0.8);
    expect(maxGap).toBeLessThan(1.8);
    expect(w.controllerId).toBe(h.id);
  });

  it('the ball is not glued: between touches it rolls freely (velocity changes only at touches)', () => {
    const { m, w, h, input } = solo();
    h.place(-15, 0, 0);
    w.ball.reset(h.footX(0.5), 0);
    input.move = { x: 1, z: 0 };
    step(m, input, 1);
    let touchedThisStep = false;
    w.events.on('touch', () => {
      touchedThisStep = true;
    });
    let accelerations = 0;
    let prev = w.ball.speed;
    step(m, input, 3, () => {
      const sp = w.ball.speed;
      // Free rolling only decelerates; speed may only increase on a touch.
      if (sp > prev + 0.05 && !touchedThisStep) accelerations++;
      prev = sp;
      touchedThisStep = false;
    });
    expect(accelerations).toBe(0);
  });

  it('kicks release the ball from the kicking foot', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { m, w, h, input } = solo(seed);
      h.place(0, 0, 0);
      w.ball.reset(h.footX(0.6), 0.1 * seed);
      let contact = Infinity;
      w.events.on('kick', (e) => {
        if (e.playerId !== h.id) return;
        // Ball position before this step's motion, vs the kicking foot (beside the body, in front).
        const bx = w.ball.pos.x - w.ball.vel.x * SIM_DT,
          bz = w.ball.pos.z - w.ball.vel.z * SIM_DT;
        contact = Math.hypot(bx - h.footX(0.42), bz - h.footZ(0.42));
      });
      step(m, input, 0.2);
      input.move = { x: 0, z: seed % 2 ? 1 : -1 };
      Object.assign(input.buttons.shoot, { pressed: true, released: true, held: 0.4 });
      step(m, input, 0.6);
      expect(contact).toBeLessThan(0.55);
    }
  });

  it('first touch settles a firm pass within playing distance', () => {
    let kept = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { m, w, h } = solo(seed);
      h.place(0, 0, Math.PI);
      w.ball.reset(12, 0.2 * (seed - 3));
      w.ball.vel.set(-11, 0, 0);
      w.lastKick = { playerId: 99, team: 0, kind: 'pass', time: w.time, receiver: h.id, fromX: 12, fromZ: 0, onTarget: false };
      step(m, null, 1.6);
      if (w.controllerId === h.id && Math.hypot(w.ball.pos.x - h.pos.x, w.ball.pos.z - h.pos.z) < 1.6) kept++;
    }
    expect(kept).toBeGreaterThanOrEqual(5);
  });

  it('a shielding carrier keeps the ball from a challenger behind him', () => {
    let lost = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const m = makeMatch({ seed, format: '3v3', aiOnly: true });
      (m as unknown as { phase: string }).phase = 'playing';
      m.world.restrictTouchTo = null;
      const w = m.world;
      const carrier = w.players.find((p) => p.team === 0 && !p.isGK)!;
      const def = w.players.find((p) => p.team === 1 && !p.isGK)!;
      for (const p of w.players) if (p.id !== carrier.id && p.id !== def.id && !p.isGK) p.place(-20, (p.id - 3) * 4, 0);
      // Carrier stands with the ball on the far side from the defender, facing away.
      carrier.place(0, 0, 0);
      w.ball.reset(0.45, 0);
      w.controllerId = carrier.id;
      def.place(-0.9, 0, 0);
      let stolen = false;
      w.events.on('control', (e) => {
        if (w.players[e.playerId].team === 1) stolen = true;
      });
      for (let i = 0; i < Math.round(0.8 / SIM_DT); i++) {
        m.step(SIM_DT, null);
        if (stolen) break;
      }
      if (stolen) lost++;
    }
    expect(lost).toBeLessThanOrEqual(3);
  });
});
