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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { GameplayMetrics, measure } from './metrics';

/**
 * Gameplay-feel guardrails. These are diagnostic proxies measured from AI-vs-AI simulations
 * (possession length, sprinting, dead time…) protecting earlier football-feel improvements against regressions.
 * Thresholds are deliberately looser than the tuning targets to tolerate seed variance.
 * Results are written to test-results/metrics.json and compared with tests/fixtures/metrics-baseline.json.
 */
const results: Record<string, GameplayMetrics> = {};

function record(key: string, m: GameplayMetrics): void {
  results[key] = m;
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/metrics.json', JSON.stringify(results, null, 2));
}

describe('gameplay metrics guardrails', () => {
  it('5v5 medium: patient possession, natural pace, little dead time', () => {
    const m = measure('5v5', 'medium', [5, 6, 7], 180);
    record('5v5/medium', m);
    expect(m.possessionSeqAvg).toBeGreaterThan(3.5);
    expect(m.controlledFrac).toBeGreaterThan(0.55);
    expect(m.possessedFrac).toBeGreaterThan(0.72);
    expect(m.sprintFrac).toBeLessThan(0.25);
    expect(m.avgSpeed).toBeLessThan(4.0);
    expect(m.turnoversPerMin).toBeLessThan(12);
    expect(m.passCompletion).toBeGreaterThan(0.7);
    expect(m.shotsPerMatch).toBeGreaterThan(5);
    expect(m.goalsPerMatch).toBeGreaterThan(0.8);
    expect(m.deadSecondsPerMatch).toBeLessThan(30);
    expect(m.restartLatency).toBeLessThan(1.6);
  }, 300000);

  it('3v3 medium stays lively (more chances than 5v5)', () => {
    const m = measure('3v3', 'medium', [5, 6, 7], 180);
    record('3v3/medium', m);
    expect(m.shotsPerMatch).toBeGreaterThan(8);
    expect(m.sprintFrac).toBeLessThan(0.25);
    expect(m.possessedFrac).toBeGreaterThan(0.6);
  }, 300000);

  it('5v5 hard defends better than easy (fewer shots conceded per possession) without speed advantages', () => {
    const hard = measure('5v5', 'hard', [5, 6], 180);
    const easy = measure('5v5', 'easy', [5, 6], 180);
    record('5v5/hard', hard);
    record('5v5/easy', easy);
    // Pass completion is not compared here: over 30 seeds Hard and Easy complete about the same share
    // (0.81 vs 0.82 — both sides playing Hard also intercept more), and two 3-minute matches
    // vary by ±0.05, so a 2-seed comparison only measures noise. Ball control is the robust difficulty
    // signal (Hard 0.70 vs Easy 0.63 over 30 seeds) and stays strict.
    expect(hard.controlledFrac).toBeGreaterThan(easy.controlledFrac);
    // Same physics: average speeds stay in the same band.
    expect(Math.abs(hard.avgSpeed - easy.avgSpeed)).toBeLessThan(0.8);
  }, 300000);

  it('improves on the recorded original baseline', () => {
    const path = 'tests/fixtures/metrics-baseline.json';
    if (!existsSync(path) || !results['5v5/medium']) return;
    const base = JSON.parse(readFileSync(path, 'utf8'))['5v5/medium'] as GameplayMetrics;
    const now = results['5v5/medium'];
    expect(now.possessionSeqAvg).toBeGreaterThan(base.possessionSeqAvg * 1.5);
    expect(now.controlledFrac).toBeGreaterThan(base.controlledFrac);
    expect(now.turnoversPerMin).toBeLessThan(base.turnoversPerMin * 0.7);
    expect(now.deadSecondsPerMatch).toBeLessThan(base.deadSecondsPerMatch);
  });
});
