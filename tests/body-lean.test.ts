/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Body lean follows the simulated acceleration: forward to burst away, back to brake, into turns.
import { describe, expect, it } from 'vitest';
import { BANK_FULL_SPEED, LEAN_LIMIT, bodyLean } from '../src/render/characters/lean';
import { PLAYER } from '../src/sim/config';

const out = { pitch: 0, roll: 0 };

describe('body lean', () => {
  it('stands upright at a steady speed in a straight line', () => {
    expect(bodyLean(0, 0, 6, out)).toEqual({ pitch: 0, roll: 0 });
  });

  it('leans forward when accelerating and back when braking, within limits', () => {
    expect(bodyLean(PLAYER.accel, 0, 3, out).pitch).toBeGreaterThan(0.1);
    expect(out.pitch).toBeLessThanOrEqual(LEAN_LIMIT.forward);
    expect(bodyLean(-PLAYER.decel, 0, 3, out).pitch).toBeLessThan(-0.1);
    expect(out.pitch).toBeGreaterThanOrEqual(-LEAN_LIMIT.back);
  });

  it('banks into the turn, more at speed, never past the limit', () => {
    // Turning left at sprint speed: acceleration towards the model's left (+).
    const sprint = bodyLean(0, 12, 8, out).roll;
    expect(sprint).toBeGreaterThan(0);
    expect(sprint).toBeLessThanOrEqual(LEAN_LIMIT.side);
    expect(bodyLean(0, -12, 8, out).roll).toBeCloseTo(-sprint, 9);
    // A walker turning just as sharply barely banks: they step round instead.
    expect(Math.abs(bodyLean(0, 12, 1, out).roll)).toBeLessThan(sprint / 2);
    expect(bodyLean(0, 12, BANK_FULL_SPEED / 2, out).roll).toBeLessThan(bodyLean(0, 12, BANK_FULL_SPEED, out).roll);
    expect(Math.abs(bodyLean(0, 500, 9, out).roll)).toBe(LEAN_LIMIT.side);
  });

  it('follows the physical angle atan(a/g) scaled down, so gentle changes give gentle leans', () => {
    const small = bodyLean(1, 0, 5, out).pitch;
    const larger = bodyLean(3, 0, 5, out).pitch;
    expect(small).toBeGreaterThan(0);
    expect(larger).toBeGreaterThan(small * 2.5);
    expect(larger).toBeLessThan(Math.atan(3 / 9.81));
  });
});
