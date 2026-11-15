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
import { makeMatch, summary } from './helpers';

/** Scenario harness: a live 3v3 with the human on team 0 and a fully scripted layout. */
function scenario(seed = 1, difficulty: 'easy' | 'medium' | 'hard' = 'medium') {
  const m = makeMatch({ seed, difficulty, format: '3v3' });
  (m as unknown as { phase: string }).phase = 'playing';
  m.world.restrictTouchTo = null;
  const input = emptyInput();
  const w = m.world;
  const human = w.players.find((p) => p.team === 0 && !p.isGK)!;
  m.setHuman(human.id);
  const mate = w.players.find((p) => p.team === 0 && !p.isGK && p.id !== human.id)!;
  const opps = w.players.filter((p) => p.team === 1 && !p.isGK);
  const keeper = w.players.find((p) => p.team === 1 && p.isGK)!;
  const ownKeeper = w.players.find((p) => p.team === 0 && p.isGK)!;
  return { m, w, input, human, mate, opps, keeper, ownKeeper };
}

function step(m: Match, input: InputFrame, seconds: number, until?: () => boolean): void {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    m.step(SIM_DT, input);
    consumeEdges(input);
    if (until?.()) return;
  }
}

function tap(input: InputFrame, b: keyof InputFrame['buttons'], held = 0.15): void {
  input.buttons[b].pressed = true;
  input.buttons[b].released = true;
  input.buttons[b].down = false;
  input.buttons[b].held = held;
}

const farAway = (s: ReturnType<typeof scenario>) => {
  s.opps.forEach((o, i) => o.place(-s.w.pitch.length / 2 + 4, -10 + i * 20, 0));
};

describe('human controls', () => {
  it('dribbles with close control while jogging', () => {
    const s = scenario();
    farAway(s);
    s.human.place(-10, 0, 0);
    s.mate.place(-15, 10, 0);
    s.w.ball.reset(s.human.footX(0.5), 0);
    s.input.move = { x: 1, z: 0 };
    step(s.m, s.input, 2.5);
    expect(s.human.pos.x).toBeGreaterThan(2);
    expect(s.w.controllerId).toBe(s.human.id);
    expect(s.w.ball.pos.distanceXZ({ x: s.human.pos.x, y: 0, z: s.human.pos.z } as never)).toBeLessThan(1.5);
  });

  it('turns with the ball', () => {
    const s = scenario();
    farAway(s);
    s.human.place(0, 0, 0);
    s.w.ball.reset(s.human.footX(0.5), 0);
    s.input.move = { x: 1, z: 0 };
    step(s.m, s.input, 1);
    s.input.move = { x: 0, z: 1 };
    step(s.m, s.input, 1.2);
    expect(s.w.controllerId).toBe(s.human.id);
    expect(s.human.pos.z).toBeGreaterThan(3);
  });

  it('keeps possession while sprint-dribbling in open space', () => {
    const s = scenario();
    farAway(s);
    s.human.place(-15, 0, 0);
    s.w.ball.reset(s.human.footX(0.5), 0);
    s.input.move = { x: 1, z: 0 };
    s.input.sprint = true;
    let maxGap = 0;
    const n = Math.round(2.5 / SIM_DT);
    for (let i = 0; i < n; i++) {
      s.m.step(SIM_DT, s.input);
      consumeEdges(s.input);
      maxGap = Math.max(maxGap, Math.hypot(s.w.ball.pos.x - s.human.pos.x, s.w.ball.pos.z - s.human.pos.z));
    }
    expect(s.human.pos.x).toBeGreaterThan(0);
    expect(maxGap).toBeLessThan(3.5);
    expect(maxGap).toBeGreaterThan(0.9); // touches push the ball ahead
  });

  it('passes to the teammate in the stick direction', () => {
    const s = scenario();
    farAway(s);
    s.human.place(-5, 0, 0);
    s.mate.place(-5, 9, 0);
    s.w.ball.reset(s.human.footX(0.5), 0);
    step(s.m, s.input, 0.3);
    s.input.move = { x: 0, z: 1 };
    tap(s.input, 'pass');
    let received = false;
    s.w.events.on('control', (e) => {
      if (e.playerId === s.mate.id) received = true;
    });
    step(s.m, s.input, 0.1);
    s.input.move = { x: 0, z: 0 };
    step(s.m, s.input, 3, () => received);
    expect(received).toBe(true);
    // Control switches to the receiver.
    expect(s.m.humanId).toBe(s.mate.id);
  });

  it('scores into an empty net from the edge of the box', () => {
    const s = scenario();
    farAway(s);
    const L2 = s.w.pitch.length / 2;
    s.keeper.place(L2 - 1, s.w.pitch.width / 2 - 1, Math.PI);
    s.human.place(L2 - 12, 2, 0);
    s.w.ball.reset(s.human.footX(0.5), s.human.footZ(0.5));
    step(s.m, s.input, 0.2);
    tap(s.input, 'shoot', 0.5);
    step(s.m, s.input, 2, () => s.m.phase === 'goal');
    expect(s.m.score[0]).toBe(1);
  });

  it('shots against a keeper are neither automatic goals nor always saved', () => {
    let goals = 0;
    const trials = 24;
    for (let seed = 1; seed <= trials; seed++) {
      const s = scenario(seed, 'medium');
      farAway(s);
      const L2 = s.w.pitch.length / 2;
      s.keeper.place(L2 - 0.6, 0, Math.PI);
      const z = ((seed % 5) - 2) * 2.5;
      s.human.place(L2 - 13, z, 0);
      s.w.ball.reset(s.human.footX(0.5), s.human.footZ(0.5));
      step(s.m, s.input, 0.25);
      s.input.move = { x: 0, z: seed % 2 ? 1 : -1 }; // pick a corner
      tap(s.input, 'shoot', 0.3 + (seed % 4) * 0.12);
      step(s.m, s.input, 0.1);
      s.input.move = { x: 0, z: 0 };
      step(s.m, s.input, 2.5, () => s.m.phase !== 'playing');
      if (s.m.score[0] > 0) goals++;
    }
    summary(`human shots vs medium keeper: ${goals}/${trials} scored`);
    expect(goals).toBeGreaterThan(trials * 0.2);
    expect(goals).toBeLessThan(trials * 0.9);
  });

  it('tackles are timing-based: exposed balls are winnable, shielded ones much less so', () => {
    const run = (exposed: boolean) => {
      let wins = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const s = scenario(seed);
        const carrier = s.opps[0];
        s.opps.slice(1).forEach((o) => o.place(20, 10, 0));
        s.mate.place(-20, 10, 0);
        // Carrier faces away from the tackler (shielding) or has knocked the ball towards him.
        carrier.place(0, 0, exposed ? Math.PI : 0);
        s.w.ball.reset(exposed ? -0.95 : 0.45, 0);
        s.w.controllerId = carrier.id;
        s.human.place(-2.0, 0, 0);
        s.human.facing = 0;
        s.input.move = { x: 1, z: 0 };
        tap(s.input, 'tackle');
        let won = false;
        s.w.events.on('tackle', (e) => {
          if (e.tacklerId === s.human.id && e.won) won = true;
        });
        step(s.m, s.input, 0.6, () => won);
        if (won) wins++;
      }
      return wins;
    };
    const exposedWins = run(true),
      shieldedWins = run(false);
    summary(`tackles won: exposed ${exposedWins}/30, shielded ${shieldedWins}/30`);
    expect(exposedWins).toBeGreaterThan(15);
    expect(shieldedWins).toBeLessThan(exposedWins * 0.6);
  });

  it('skill move pushes the ball sideways and gives a burst', () => {
    const s = scenario();
    farAway(s);
    s.human.place(0, 0, 0);
    s.w.ball.reset(s.human.footX(0.5), 0);
    s.input.move = { x: 1, z: 0 };
    step(s.m, s.input, 0.6);
    s.input.move = { x: 0.3, z: 1 };
    s.input.buttons.skill.pressed = true;
    let skill = false;
    s.w.events.on('skill', () => {
      skill = true;
    });
    step(s.m, s.input, 0.05);
    expect(skill).toBe(true);
    expect(s.w.ball.vel.z).toBeGreaterThan(2);
    expect(s.human.burst).toBeGreaterThan(0);
  });

  it('through ball finds a runner in space', () => {
    const s = scenario();
    farAway(s);
    s.human.place(-8, -4, 0);
    s.mate.place(-2, 6, 0);
    s.mate.vel.set(6, 0);
    s.w.ball.reset(s.human.footX(0.5), s.human.footZ(0.5));
    step(s.m, s.input, 0.2);
    s.input.move = { x: 0.6, z: 0.8 };
    tap(s.input, 'through', 0.3);
    let received = false;
    s.w.events.on('control', (e) => {
      if (e.playerId === s.mate.id) received = true;
    });
    step(s.m, s.input, 0.15);
    s.input.move = { x: 0, z: 0 }; // release the stick and let the receiver run onto it
    step(s.m, s.input, 3.5, () => received);
    expect(received).toBe(true);
  });

  it('an idle human team still defends and the AI eventually scores', () => {
    const m = makeMatch({ format: '3v3', difficulty: 'hard', seed: 3, duration: 240 });
    const input = emptyInput();
    // Let the AI kick off for us after the stall timeout, then do nothing.
    step(m, input, 200, () => m.score[1] > 0);
    expect(m.score[1]).toBeGreaterThan(0);
  });
});
