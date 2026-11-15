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
import { measureResponsiveness } from '../src/dev/responsiveness';
import { summary } from './helpers';

/**
 * Human-control responsiveness (simulation response to perfectly timed input, no display latency).
 * Earlier baseline (before tuning): runUp90 0.35 s, stopRun 0.25 s / 0.70 m, reverseRun 0.55 s,
 * reverseSprint 0.61 s, shuffleReverse 0.40 s, dribbleReverse 0.89 s, pass tap 0.19 s, shot tap 0.23 s.
 */
describe('human movement responsiveness', () => {
  const r = measureResponsiveness();
  const ai = measureResponsiveness(true);
  summary('responsiveness', JSON.stringify(r));
  summary('responsiveness-ai-steering', JSON.stringify(ai));

  it('reacts on the next simulation step', () => {
    expect(r.firstMoveSteps).toBe(1);
  });

  it('accelerates, stops and reverses quickly (arcade-responsive targets)', () => {
    expect(r.runUp90).toBeLessThanOrEqual(0.32);
    expect(r.stopRunTime).toBeLessThanOrEqual(0.2);
    expect(r.stopSprintDist).toBeLessThanOrEqual(1.0);
    expect(r.reverseRun).toBeLessThanOrEqual(0.46);
    expect(r.reverseSprint).toBeLessThanOrEqual(0.53);
    expect(r.shuffleReverse).toBeLessThanOrEqual(0.3);
  });

  it('keeps the ball when turning and reversing while dribbling', () => {
    expect(r.dribbleKept).toBe(true);
    expect(r.dribbleReverseKept).toBe(true);
    expect(r.dribbleTurn90).toBeLessThanOrEqual(0.35);
    expect(r.dribbleReverse).toBeLessThanOrEqual(0.5);
  });

  it('responsive passing fires on press — no wait for the button release', () => {
    // an ordinary pass on press reaches the ball in about the kick wind-up alone.
    expect(r.passPressLatency).toBeLessThanOrEqual(0.1);
    expect(r.passPressLatency).toBeLessThan(r.passTapLatency - 0.05);
  });

  it('actions fire promptly after a tap', () => {
    expect(r.passTapLatency).toBeLessThanOrEqual(0.17);
    expect(r.shotTapLatency).toBeLessThanOrEqual(0.22);
    expect(r.tackleLatency).toBeLessThanOrEqual(0.02);
  });

  it('human is more responsive than AI steering, without a top-speed advantage', () => {
    expect(r.reverseRun).toBeLessThan(ai.reverseRun);
    expect(r.stopRunTime).toBeLessThan(ai.stopRunTime);
    // Same top speed: the time from run to sprint is similar (acceleration boost is small).
    expect(r.runUp90).toBeGreaterThan(ai.runUp90 * 0.8);
  });
});
