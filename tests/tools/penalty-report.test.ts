/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { it } from 'vitest';
import { appendFileSync, mkdirSync } from 'node:fs';
import { simulateShooting, simulateKeeping, pct } from '../../src/dev/penaltySim';

/** Full penalty outcome sweep (opt-in: PENALTIES=1 npx vitest run tests/tools/penalty-report.test.ts). */
const run = process.env.PENALTIES ? it : it.skip;
const N = Number(process.env.PEN_N || 200);
run(
  'penalty outcome report',
  () => {
    mkdirSync('test-results', { recursive: true });
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (const m of ['good', 'central', 'overhit', 'weak', 'wide'] as const)
        appendFileSync('test-results/penalties.log', `${d} SHOOT ${m} ${JSON.stringify(pct(simulateShooting(m, d, N)))}\n`);
      for (const m of ['none', 'random', 'tell', 'early', 'perfect'] as const)
        appendFileSync('test-results/penalties.log', `${d} KEEP ${m} ${JSON.stringify(pct(simulateKeeping(m, d, N)))}\n`);
    }
  },
  1800000,
);
