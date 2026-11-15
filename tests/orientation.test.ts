/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// The rotate screen's rules (src/ui/orientation.ts): who is blocked, which way up the device is, and
// when the match pauses and resumes. The real page is checked by scripts/orientation-check.mjs.
import { describe, expect, it } from 'vitest';
import { PHONE_SHORT_SIDE, isPortrait, orientationAction, shouldBlockForOrientation, type ScreenFacts } from '../src/ui/orientation';

const phone = (width: number, height: number, extra: Partial<ScreenFacts> = {}): ScreenFacts => ({
  width,
  height,
  touch: true,
  orientationType: height > width ? 'portrait-primary' : 'landscape-primary',
  screenWidth: Math.min(width, height),
  screenHeight: Math.max(width, height),
  ...extra,
});

describe('who sees the rotate screen', () => {
  it('blocks phones held upright', () => {
    for (const [w, h] of [
      [360, 740],
      [375, 667],
      [390, 844],
      [412, 915],
      [430, 932],
    ])
      expect(shouldBlockForOrientation(phone(w, h)), `${w}×${h}`).toBe(true);
  });

  it('lets phones play in landscape', () => {
    for (const [w, h] of [
      [740, 360],
      [844, 390],
      [932, 430],
    ])
      expect(shouldBlockForOrientation(phone(w, h))).toBe(false);
  });

  it('lets tablets play upright: they have room', () => {
    expect(shouldBlockForOrientation(phone(768, 1024))).toBe(false);
    expect(shouldBlockForOrientation(phone(820, 1180))).toBe(false);
    expect(PHONE_SHORT_SIDE).toBeLessThanOrEqual(744); // the smallest common tablet width
  });

  it('never blocks a desktop with a mouse, even in a tall, narrow window', () => {
    expect(
      shouldBlockForOrientation({ width: 420, height: 900, touch: false, orientationType: 'landscape-primary', screenWidth: 1920, screenHeight: 1080 }),
    ).toBe(false);
    expect(shouldBlockForOrientation({ width: 420, height: 900, touch: false, orientationType: null })).toBe(false);
  });

  it('trusts the screen orientation over the window shape (keyboard or address bar)', () => {
    // Upright phone with the on-screen keyboard open: the window is wider than tall, the phone isn't.
    expect(shouldBlockForOrientation(phone(390, 300, { orientationType: 'portrait-primary' }))).toBe(true);
    // Upright phone while the address bar resizes the window: still blocked.
    expect(shouldBlockForOrientation(phone(390, 700))).toBe(true);
    expect(shouldBlockForOrientation(phone(390, 844))).toBe(true);
  });

  it('falls back to the window shape when the browser has no screen orientation', () => {
    expect(isPortrait({ width: 390, height: 844, touch: true, orientationType: null })).toBe(true);
    expect(isPortrait({ width: 844, height: 390, touch: true, orientationType: null })).toBe(false);
    expect(shouldBlockForOrientation({ width: 390, height: 844, touch: true, orientationType: null })).toBe(true);
  });
});

describe('pausing and resuming the match', () => {
  it('pauses a running match when the phone turns upright', () => {
    expect(orientationAction(true, 'playing', false)).toBe('pause');
  });

  it('resumes when the phone turns back, only if the rotate screen paused it', () => {
    expect(orientationAction(false, 'paused', true)).toBe('resume');
    expect(orientationAction(false, 'paused', false)).toBeNull(); // you had paused it yourself
  });

  it('does nothing in menus, at full time or while loading', () => {
    for (const state of ['menu', 'fulltime', 'loading']) {
      expect(orientationAction(true, state, false)).toBeNull();
      expect(orientationAction(false, state, false)).toBeNull();
    }
  });
});
