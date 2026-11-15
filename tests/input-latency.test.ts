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
import { InputLatencyTracker } from '../src/game/inputLatency';
import { makeMatch, runFor, clearPitch } from './helpers';
import { emptyInput } from '../src/sim/human';

describe('input latency tracker', () => {
  it('times a direction change: input → sim step → velocity response → submitted frame', () => {
    const t = new InputLatencyTracker();
    t.moveInput(1000, 1, 0, 0, 0);
    t.simStep(1004, 0.1, 0); // first step used the input, not yet moving enough
    t.simStep(1012, 0.4, 0); // velocity responded (≥ 0.35 m/s along the new direction)
    t.frameSubmitted(1016);
    const s = t.summary();
    expect(s.move.toSim.p50).toBe(4);
    expect(s.move.toMotion.p50).toBe(12);
    expect(s.move.toMotionFrame.p50).toBe(16);
  });

  it('charged pass: press → ball = queue + hold + wind-up', () => {
    const t = new InputLatencyTracker();
    t.buttonDown('pass', 0);
    t.simStep(6, 0, 0); // first step saw the press
    t.buttonUp('pass', 80); // released after 80 ms
    t.kicked('pass', 160);
    const s = t.summary().pass;
    expect(s.pressToRelease.p50).toBe(160);
    expect(s.queue.p50).toBe(6);
    expect(s.hold.p50).toBe(80);
    expect(s.windup.p50).toBe(80);
  });

  it('responsive pass: the kick comes before the release — no hold time, wind-up from the first step', () => {
    const t = new InputLatencyTracker();
    t.buttonDown('pass', 0);
    t.simStep(8, 0, 0);
    t.kicked('pass', 83);
    t.buttonUp('pass', 120);
    const s = t.summary().pass;
    expect(s.pressToRelease.p50).toBe(83);
    expect(s.hold.p50).toBe(0);
    expect(s.queue.p50).toBe(8);
    expect(s.windup.p50).toBe(75);
  });

  it('times player switching and ignores unrelated kicks', () => {
    const t = new InputLatencyTracker();
    t.kicked('shoot', 50); // no pending shot press → ignored
    t.buttonDown('switch', 100);
    t.switched(108);
    const s = t.summary();
    expect(s.shoot.pressToRelease.n).toBe(0);
    expect(s.switch.toSwitch.p50).toBe(8);
  });
});

describe('charged passing still fires on release', () => {
  it('a held pass button does not kick until it is released', () => {
    const m = makeMatch({ format: '3v3' });
    m.phase = 'playing';
    m.world.restrictTouchTo = null;
    const h = m.human!;
    clearPitch(m, [h.id, ...m.world.players.filter((p) => p.team === 0 && p.id !== h.id).map((p) => p.id)]);
    m.world.ball.reset(h.footX(0.5), h.footZ(0.5));
    m.world.clearPossession();
    const input = emptyInput();
    runFor(m, 0.4, input);
    input.buttons.pass.down = true;
    input.buttons.pass.pressed = true;
    runFor(m, 0.4, { ...input, buttons: { ...input.buttons, pass: { down: true, pressed: false, released: false, held: 0.4 } } });
    expect(Math.hypot(m.world.ball.vel.x, m.world.ball.vel.z)).toBeLessThan(4);
  });
});
