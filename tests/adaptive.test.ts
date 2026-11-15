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
import { AdaptiveController, AdaptiveOptions, LADDER, levelIndexFor } from '../src/game/adaptive';
import type { Quality } from '../src/game/settings';
import { REFRESH_FALLBACK_DT, autoFrameSteps, estimateRefresh, frameIntervalFor } from '../src/game/frames';

/**
 * SIMULATED hardware profiles (not real devices): a frame costs max(CPU, GPU) where GPU work scales with
 * the quality level and the pixel count, and frames are presented on whole display refreshes. These
 * check the controller's logic — convergence, stability, recovery — not real-world performance.
 */
interface Profile {
  name: string;
  hz: number;
  cpuMs: number;
  gpuUltraMs: number;
}
const LEVEL_COST = [1.6, 1.0, 0.9, 0.65, 0.55, 0.4, 0.35];

function simulate(p: Profile, seconds: number, opts: Partial<AdaptiveOptions> = {}, start: Quality = 'high', load?: (t: number) => number) {
  const R = 1 / p.hz;
  const o: AdaptiveOptions = {
    autoLevel: true,
    topLevel: 0,
    dynamicResolution: true,
    autoFrameRate: true,
    maxFpsStep: autoFrameSteps(R),
    fpsAt: (s) => 1 / frameIntervalFor(R, 'auto', s),
    ...opts,
  };
  const c = new AdaptiveController({ level: levelIndexFor(start), resScale: 1, fpsStep: 0 }, o);
  let t = 0,
    changes = 0,
    lastChange = 0;
  const trace: Array<{ t: number; level: number; res: number; fps: number }> = [];
  while (t < seconds) {
    const target = frameIntervalFor(R, o.autoFrameRate ? 'auto' : 'display', c.state.fpsStep);
    const k = load ? load(t) : 1;
    const gpu = p.gpuUltraMs * LEVEL_COST[c.state.level] * c.state.resScale ** 2 * k;
    const work = Math.max(p.cpuMs * k, gpu) / 1000;
    // Presented on the next refresh at or after the work completes, never faster than the limiter.
    const dt = Math.max(target, Math.ceil(work / R - 1e-9) * R);
    const d = c.frame(dt, target, p.cpuMs * k);
    if (d.changed) {
      changes++;
      lastChange = t;
    }
    t += dt;
    trace.push({ t, level: c.state.level, res: c.state.resScale, fps: 1 / target });
  }
  return { c, changes, lastChange, trace, fps: 1 / frameIntervalFor(R, 'auto', c.state.fpsStep) };
}

describe('adaptive quality (simulated profiles)', () => {
  it('fast desktop on a 240 Hz screen: keeps 120 fps, climbs to the best level, then stays put', () => {
    const r = simulate({ name: 'desktop-240', hz: 240, cpuMs: 1.5, gpuUltraMs: 1.2 }, 300);
    expect(r.fps).toBe(120);
    expect(r.c.state.level).toBe(0);
    expect(r.c.state.resScale).toBe(1);
    expect(r.lastChange).toBeLessThan(120);
  });

  it('integrated GPU at 60 Hz: settles on a level that holds 60 fps and does not oscillate', () => {
    const r = simulate({ name: 'igpu-60', hz: 60, cpuMs: 4, gpuUltraMs: 30 }, 900);
    expect(r.fps).toBe(60);
    const settled = r.trace.filter((f) => f.t > 300);
    const levels = new Set(settled.map((f) => f.level));
    expect(levels.size).toBeLessThanOrEqual(2); // at most one retry of a higher level
    const lateMisses = settled.filter((f, i) => i > 0 && f.level !== settled[i - 1].level).length;
    expect(lateMisses).toBeLessThanOrEqual(4);
  });

  it('144 Hz gaming laptop: halves to 72 fps before lowering quality', () => {
    const r = simulate({ name: 'laptop-144', hz: 144, cpuMs: 3, gpuUltraMs: 9 }, 120);
    expect(r.fps).toBe(72);
    expect(r.c.state.level).toBeLessThanOrEqual(levelIndexFor('high'));
  });

  it('weak phone: drops resolution and quality, then the frame-rate floor of 30 fps — never lower', () => {
    const r = simulate({ name: 'phone-60', hz: 60, cpuMs: 12, gpuUltraMs: 120 }, 400, {}, 'low');
    expect(r.c.state.level).toBeGreaterThanOrEqual(LADDER.length - 2);
    expect(r.fps).toBe(30);
    // At 30 fps there is room again, so resolution is partly restored — and then it stays stable.
    expect(r.c.state.resScale).toBeGreaterThanOrEqual(0.65);
    // At most one more retry of the higher setting in the last ~4 minutes.
    expect(r.c.history.filter((h) => h.t > 160).length).toBeLessThanOrEqual(2);
    expect(Math.min(...r.trace.map((f) => f.fps))).toBeGreaterThanOrEqual(29.9);
  });

  it('calibration reacts within the first few seconds', () => {
    const r = simulate({ name: 'igpu-60', hz: 60, cpuMs: 4, gpuUltraMs: 30 }, 10);
    expect(r.c.history.length).toBeGreaterThan(0);
    expect(r.c.history[0].t).toBeLessThanOrEqual(3);
  });

  it('a temporary load spike lowers quality, and it recovers gradually afterwards', () => {
    const spike = (t: number) => (t > 60 && t < 75 ? 3 : 1);
    const r = simulate({ name: 'mid-60', hz: 60, cpuMs: 2, gpuUltraMs: 8 }, 400, {}, 'high', spike);
    const during = r.trace.find((f) => f.t > 74)!;
    expect(during.level > levelIndexFor('high') || during.res < 1).toBe(true);
    expect(r.c.state.level).toBeLessThanOrEqual(levelIndexFor('high'));
    expect(r.c.state.resScale).toBe(1);
    // Recovery is gradual (not one jump): several separate upward steps after the spike.
    expect(r.c.history.filter((h) => h.t > 75 && h.text.includes('↑')).length).toBeGreaterThanOrEqual(2);
  });

  it('manual preset is a ceiling: adaptation never goes above it', () => {
    const r = simulate({ name: 'desktop', hz: 60, cpuMs: 1, gpuUltraMs: 2 }, 200, { topLevel: levelIndexFor('medium') }, 'medium');
    expect(Math.min(...r.trace.map((f) => f.level))).toBe(levelIndexFor('medium'));
  });

  it('adaptive quality off: the level never changes', () => {
    const r = simulate({ name: 'igpu-60', hz: 60, cpuMs: 4, gpuUltraMs: 30 }, 120, { autoLevel: false }, 'high');
    expect(new Set(r.trace.map((f) => f.level)).size).toBe(1);
  });

  it('ignores the window around tab switches / resizes, and long stalls', () => {
    const c = new AdaptiveController(
      { level: 1, resScale: 1, fpsStep: 0 },
      { autoLevel: true, topLevel: 0, dynamicResolution: true, autoFrameRate: false, maxFpsStep: 0, fpsAt: () => 60 },
      0,
    );
    // A 2 s stall (tab hidden) is not a performance sample.
    expect(c.frame(2, 1 / 60, 1).changed).toBe(false);
    c.interrupt();
    let changed = false;
    for (let i = 0; i < 130; i++) changed ||= c.frame(1 / 15, 1 / 60, 1).changed; // ~8.7 s of bad frames, first window skipped
    expect(changed).toBe(true);
    expect(c.history[0].t).toBeGreaterThanOrEqual(4);
  });
});

describe('display refresh estimate', () => {
  // Deterministic jitter so samples look like real rAF timings.
  const samples = (n: number, f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i)).sort();
  const jitter = (i: number) => ((i * 7919) % 13) / 13 - 0.5;
  const start = () => ({ dt: REFRESH_FALLBACK_DT, measured: false });

  it('measures common screens from steady intervals', () => {
    for (const hz of [60, 75, 120, 144, 240]) {
      const out = estimateRefresh(
        samples(120, (i) => 1 / hz + jitter(i) * 0.0002),
        120,
        start(),
        start(),
      );
      expect(out.measured).toBe(true);
      expect(Math.abs(1 / out.dt / hz - 1)).toBeLessThan(0.03);
    }
  });

  it('accepts a steady 30 Hz screen (low-power mode)', () => {
    const out = estimateRefresh(
      samples(120, (i) => 1 / 30 + jitter(i) * 0.0003),
      120,
      start(),
      start(),
    );
    expect(out.measured).toBe(true);
    expect(Math.round(1 / out.dt)).toBe(30);
  });

  it('keeps the previous estimate when a slow device makes the intervals meaningless', () => {
    // Software rendering at 2–10 fps: long, wandering intervals.
    const slow = samples(120, (i) => 0.1 + jitter(i) * 0.15);
    const assumed = estimateRefresh(slow, 120, start(), start());
    expect(assumed).toEqual({ dt: REFRESH_FALLBACK_DT, measured: false });
    const measured = estimateRefresh(slow, 120, { dt: 1 / 144, measured: true }, start());
    expect(measured).toEqual({ dt: 1 / 144, measured: true });
    // ~37 fps that wanders between 22 and 32 ms isn't a screen either.
    expect(
      estimateRefresh(
        samples(120, (i) => 0.027 + jitter(i) * 0.01),
        120,
        start(),
        start(),
      ).measured,
    ).toBe(false);
  });

  it('never yields a frame-rate target below the 30 fps floor', () => {
    const out = estimateRefresh(
      samples(120, (i) => 0.2 + jitter(i) * 0.02),
      120,
      start(),
      start(),
    );
    expect(1 / frameIntervalFor(out.dt, 'auto', 1000)).toBeGreaterThanOrEqual(29.5);
  });

  it('waits for enough samples', () => {
    expect(
      estimateRefresh(
        samples(10, () => 1 / 144),
        10,
        start(),
        start(),
      ).measured,
    ).toBe(false);
  });
});
