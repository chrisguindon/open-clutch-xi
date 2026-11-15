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
import { PerformanceObserver } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'fs';
import { Match } from '../src/sim/match';
import { MatchFormat, SIM_DT } from '../src/sim/config';

/**
 * CPU benchmarks for the simulation (the part we can measure reliably headlessly).
 * GPU/rendering performance must be measured on real hardware (see scripts/perf-capture.mjs for
 * draw-call and triangle counts). Thresholds are generous to stay stable on slow CI machines.
 */
async function bench(format: MatchFormat) {
  const m = new Match({ mode: 'match', format, difficulty: 'medium', duration: 9999, seed: 3, replays: false, aiOnly: true });
  for (let i = 0; i < 2000; i++) m.step(SIM_DT, null); // warm up the JIT
  let gcEvents = 0,
    gcMs = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      gcEvents++;
      gcMs += e.duration;
    }
  });
  obs.observe({ entryTypes: ['gc'] });
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) m.step(SIM_DT, null);
  const ms = (performance.now() - t0) / 10000;
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  return { msPerStep: +ms.toFixed(4), gcEventsPer10kSteps: gcEvents, gcMs: +gcMs.toFixed(1) };
}

describe('simulation performance', () => {
  const out: Record<string, unknown> = {};
  for (const format of ['5v5', '11v11'] as const) {
    it(`${format}: fast fixed steps with low allocation pressure`, async () => {
      const r = await bench(format);
      out[format] = r;
      mkdirSync('test-results', { recursive: true });
      writeFileSync('test-results/perf.json', JSON.stringify(out, null, 2));
      // 120 Hz needs 2 steps per 60 fps frame: keep well under 1 ms per step even on slow machines.
      expect(r.msPerStep).toBeLessThan(0.6);
      // ~83 s of game time; the original version produced ~100 GC events in 11v11 before allocation fixes.
      expect(r.gcEventsPer10kSteps).toBeLessThan(80);
    }, 60000);
  }
});
