/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// When the controlled player's name is shown over the pitch (src/ui/playerLabel.ts). The layouts and
// the screen measurements are checked in a real browser by scripts/mobile-hud-check.mjs.
import { describe, expect, it } from 'vitest';
import { BRIEF_LABEL_FADE, BRIEF_LABEL_SECONDS, SMALL_SCREEN_SHORT_SIDE, playerLabelCueTime, playerLabelMode, playerLabelOpacity } from '../src/ui/playerLabel';
import { INTRO_LENGTH } from '../src/render/camera';

describe('player name over the pitch', () => {
  it('is always shown on a big screen with a mouse or keyboard', () => {
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [1024, 700],
    ])
      expect(playerLabelMode({ touchControls: false, width, height })).toBe('always');
  });

  it('is brief whenever touch controls are on screen, whatever the size (phones and tablets)', () => {
    for (const [width, height] of [
      [667, 375],
      [844, 390],
      [915, 412],
      [1180, 820],
    ])
      expect(playerLabelMode({ touchControls: true, width, height })).toBe('brief');
  });

  it('is brief in a small window even without touch, judged by the shorter side', () => {
    expect(playerLabelMode({ touchControls: false, width: 900, height: SMALL_SCREEN_SHORT_SIDE - 1 })).toBe('brief');
    expect(playerLabelMode({ touchControls: false, width: SMALL_SCREEN_SHORT_SIDE - 1, height: 900 })).toBe('brief');
    expect(playerLabelMode({ touchControls: false, width: 900, height: SMALL_SCREEN_SHORT_SIDE })).toBe('always');
  });

  it('a brief name shows fully after a change of player, fades, then disappears', () => {
    expect(playerLabelOpacity('brief', 0)).toBe(1);
    expect(playerLabelOpacity('brief', BRIEF_LABEL_SECONDS - BRIEF_LABEL_FADE)).toBe(1);
    const mid = playerLabelOpacity('brief', BRIEF_LABEL_SECONDS - BRIEF_LABEL_FADE / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(playerLabelOpacity('brief', BRIEF_LABEL_SECONDS)).toBe(0);
    expect(playerLabelOpacity('brief', 60)).toBe(0);
    expect(playerLabelOpacity('brief', Infinity)).toBe(0); // no change yet
  });

  it('starts the initial cue after an unskipped intro', () => {
    let name: string | null = null;
    let changedAt = -Infinity;
    for (let now = 0; now < INTRO_LENGTH; now += 0.1) {
      changedAt = playerLabelCueTime(name, 'Kick-off taker', changedAt, now, true);
      name = 'Kick-off taker';
    }

    expect(changedAt).toBe(-Infinity);
    changedAt = playerLabelCueTime(name, 'Kick-off taker', changedAt, INTRO_LENGTH, false);
    expect(changedAt).toBe(INTRO_LENGTH);
    expect(playerLabelOpacity('brief', INTRO_LENGTH - changedAt)).toBe(1);
    expect(playerLabelOpacity('brief', INTRO_LENGTH + BRIEF_LABEL_SECONDS - changedAt)).toBeCloseTo(0, 12);
  });

  it('starts the initial cue immediately when the intro is skipped, then restarts it on a player switch', () => {
    let name: string | null = null;
    let changedAt = -Infinity;
    changedAt = playerLabelCueTime(name, 'Kick-off taker', changedAt, 0.25, true);
    name = 'Kick-off taker';
    expect(changedAt).toBe(-Infinity);

    changedAt = playerLabelCueTime(name, 'Kick-off taker', changedAt, 0.25, false);
    expect(changedAt).toBe(0.25);
    expect(playerLabelOpacity('brief', 0.25 - changedAt)).toBe(1);

    changedAt = playerLabelCueTime(name, 'New player', changedAt, 2, false);
    expect(changedAt).toBe(2);
    expect(playerLabelOpacity('brief', 2 - changedAt)).toBe(1);
  });

  it('with reduced motion a brief name disappears without fading', () => {
    expect(playerLabelOpacity('brief', BRIEF_LABEL_SECONDS - 0.05, true)).toBe(1);
    expect(playerLabelOpacity('brief', BRIEF_LABEL_SECONDS, true)).toBe(0);
  });

  it('an always-on name never fades', () => {
    for (const t of [0, 1, 10, 1000]) expect(playerLabelOpacity('always', t)).toBe(1);
  });
});
