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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { GameplayMetrics, measure } from '../metrics';

/**
 * Gameplay metrics report (not part of `npm test`): `npm run metrics`.
 * Simulates several AI-vs-AI matches per configuration and prints a before/after table
 * against tests/fixtures/metrics-baseline.json. Writes test-results/metrics-report.json.
 */
const KEYS: Array<keyof GameplayMetrics> = [
  'possessionSeqAvg',
  'possessionSeqMedian',
  'controlledFrac',
  'possessedFrac',
  'sprintFrac',
  'walkFrac',
  'avgSpeed',
  'turnoversPerMin',
  'passCompletion',
  'shotsPerMatch',
  'goalsPerMatch',
  'tacklesPerMatch',
  'deadSecondsPerMatch',
  'restartLatency',
];

it.skipIf(!process.env.METRICS)(
  'metrics report',
  () => {
    const cases = (process.env.CASES || '3v3/medium,5v5/medium,5v5/hard,5v5/easy,11v11/medium').split(',');
    const seeds = (process.env.SEEDS || '5,6,7,8,9,10').split(',').map(Number);
    const base: Record<string, GameplayMetrics> = existsSync('tests/fixtures/metrics-baseline.json')
      ? JSON.parse(readFileSync('tests/fixtures/metrics-baseline.json', 'utf8'))
      : {};
    const now: Record<string, GameplayMetrics> = {};
    const lines: string[] = [];
    for (const c of cases) {
      const [f, d] = c.split('/');
      now[c] = measure(f as never, d as never, seeds, 180);
      lines.push(`\n${c}  (seeds ${seeds.join(',')})`);
      lines.push(`${'metric'.padEnd(22)}${'baseline'.padStart(10)}${'now'.padStart(10)}`);
      for (const k of KEYS) lines.push(`${k.padEnd(22)}${String(base[c]?.[k] ?? '-').padStart(10)}${String(now[c][k]).padStart(10)}`);
    }
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/metrics-report.json', JSON.stringify(now, null, 2));
    writeFileSync('test-results/metrics-report.txt', lines.join('\n'));
    console.log(lines.join('\n'));
  },
  3600000,
);
