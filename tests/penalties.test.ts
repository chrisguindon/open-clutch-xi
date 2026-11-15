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
import { simulateShooting, simulateKeeping, pct } from '../src/dev/penaltySim';

/**
 * Penalty shootout balance. Outcomes come from the real physics + keeper code with modelled
 * human behaviour; tolerances are wide on purpose — these guard the shape of the balance, and the
 * "fun" is judged by playtesting. Full sweep: tests/tools/penalty-report.test.ts.
 */
describe('penalty shootout balance', { timeout: 60000 }, () => {
  it('regression: the keeper can save penalties at all (was 0% — keeper could not touch the ball)', () => {
    expect(simulateShooting('central', 'medium', 40).saved).toBeGreaterThan(5);
  });

  it('shooting (medium): good penalties usually score, poor ones can fail', () => {
    const good = pct(simulateShooting('good', 'medium', 100));
    const central = pct(simulateShooting('central', 'medium', 80));
    const overhit = pct(simulateShooting('overhit', 'medium', 80));
    const wide = pct(simulateShooting('wide', 'medium', 60));
    expect(good.goal).toBeGreaterThanOrEqual(65);
    expect(good.goal).toBeLessThanOrEqual(95);
    expect(central.saved).toBeGreaterThanOrEqual(35);
    expect(overhit.missed).toBeGreaterThanOrEqual(35);
    expect(wide.missed).toBeGreaterThanOrEqual(70);
  });

  it('shooting gets harder with difficulty', () => {
    const easy = pct(simulateShooting('good', 'easy', 80)).goal;
    const hard = pct(simulateShooting('good', 'hard', 80)).goal;
    expect(easy).toBeGreaterThan(hard + 10);
    expect(hard).toBeGreaterThanOrEqual(50);
  });

  it('keeping (medium): reading the shooter pays off, guessing beats standing still, diving early is punished', () => {
    const none = pct(simulateKeeping('none', 'medium', 80)).saved;
    const random = pct(simulateKeeping('random', 'medium', 100)).saved;
    const tell = pct(simulateKeeping('tell', 'medium', 100)).saved;
    const early = pct(simulateKeeping('early', 'medium', 80)).saved;
    const perfect = pct(simulateKeeping('perfect', 'medium', 80)).saved;
    expect(none).toBeLessThanOrEqual(22);
    expect(random).toBeGreaterThan(none + 10);
    expect(tell).toBeGreaterThan(random + 8);
    expect(early).toBeLessThan(tell);
    expect(perfect).toBeGreaterThanOrEqual(60);
  });

  it('keeping is more forgiving on easy than on hard', () => {
    expect(pct(simulateKeeping('perfect', 'easy', 80)).saved).toBeGreaterThan(pct(simulateKeeping('perfect', 'hard', 80)).saved);
  });
});
