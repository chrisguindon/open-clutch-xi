/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { download, FluidityDiagnostics, PerfSummary, stamp } from './diagnostics';
import { BRAND } from '../brand';

/**
 * Reproducible performance benchmark (open the game with `?bench`, or press "Run benchmark" in the F3
 * panel). Plays the same fixed-seed AI-vs-AI match with your current graphics settings, then repeats it
 * with one system changed at a time so each system's cost can be read off directly on real hardware:
 *
 *   baseline · shadows off · post-processing off · bloom off · MSAA off · crowd hidden ·
 *   stadium detail hidden · animation frozen · simplified players · 60 Hz simulation ·
 *   pixel ratio 1 · HUD hidden · baseline again (drift / thermal check)
 *
 * With vsync, FPS is capped at the display rate, so compare **game JS ms**, **JS busy %** and
 * **GPU ms** (when available) as well as frame times.
 */
export interface BenchToggles {
  shadows?: boolean;
  post?: boolean;
  bloom?: boolean;
  msaa?: number;
  crowd?: boolean;
  detail?: boolean;
  animation?: boolean;
  simplePlayers?: boolean;
  simHz?: number;
  pixelRatio?: number;
  hud?: boolean;
  /** Override the frame-rate limiter for this variant. */
  frameRate?: 'auto' | 'balanced' | 'display' | 'saver';
}

export interface BenchHost {
  /** (Re)start the fixed-seed scenario; resolves when the first frames have rendered. */
  startScenario(): Promise<void>;
  setToggles(t: BenchToggles): void;
  settings(): Record<string, unknown>;
}

export interface BenchResult {
  variant: string;
  summary: PerfSummary;
}

export const VARIANTS: Array<{ name: string; t: BenchToggles }> = [
  { name: 'baseline', t: {} },
  { name: 'shadows off', t: { shadows: false } },
  { name: 'post-processing off', t: { post: false } },
  { name: 'bloom off', t: { bloom: false } },
  { name: 'MSAA off', t: { msaa: 0 } },
  { name: 'crowd hidden', t: { crowd: false } },
  { name: 'stadium detail hidden', t: { detail: false } },
  { name: 'animation frozen', t: { animation: false } },
  { name: 'simplified players', t: { simplePlayers: true } },
  { name: '60 Hz simulation', t: { simHz: 60 } },
  { name: 'pixel ratio 1', t: { pixelRatio: 1 } },
  { name: 'HUD hidden', t: { hud: false } },
  { name: 'frame rate: 60', t: { frameRate: 'balanced' } },
  { name: 'frame rate: Max (every refresh)', t: { frameRate: 'display' } },
  { name: 'baseline (repeat)', t: {} },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Benchmark {
  running = false;
  private el: HTMLElement | null = null;

  constructor(
    private host: BenchHost,
    private diag: FluidityDiagnostics,
  ) {}

  async run(opts: { warmup?: number; measure?: number } = {}): Promise<Record<string, unknown>> {
    if (this.running) return {};
    this.running = true;
    const warmup = opts.warmup ?? 2000,
      measure = opts.measure ?? 7000;
    this.show("<b>Benchmark running…</b><br>Keep this tab visible and don't touch the controls.");
    const results: BenchResult[] = [];
    this.diag.benchmarking = true;
    try {
      for (let i = 0; i < VARIANTS.length; i++) {
        const v = VARIANTS[i];
        this.show(`<b>Benchmark ${i + 1}/${VARIANTS.length}</b><br>${v.name}<br><small>Keep this tab visible.</small>`);
        this.host.setToggles(v.t);
        await this.host.startScenario();
        await sleep(warmup);
        this.diag.reset();
        await sleep(measure);
        results.push({ variant: v.name, summary: this.diag.summary() });
      }
    } finally {
      this.host.setToggles({});
      this.diag.benchmarking = false;
      this.running = false;
    }
    const report = {
      generated: new Date().toISOString(),
      settings: this.host.settings(),
      environment: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
        devicePixelRatio: window.devicePixelRatio,
        screen: [screen.width, screen.height],
        viewport: [innerWidth, innerHeight],
      },
      notes:
        'FPS is capped by vsync and the frame-rate limiter; compare jsFrameMs / gpuMs between variants. jsBusyPct covers only the game frame callback; mainThreadBusyPctEstimate covers all main-thread work; neither is total browser CPU (GPU process, compositor, audio). Check summary.validity for interrupted rows. The benchmark is AI-only, so input latency is measured in normal play instead (F3 panel).',
      results,
    };
    this.showResults(report, results);
    return report;
  }

  private show(html: string): void {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'bench';
      document.body.appendChild(this.el);
      this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.el.innerHTML = html;
    this.el.hidden = false;
  }

  private showResults(report: Record<string, unknown>, results: BenchResult[]): void {
    const base = results[0].summary;
    const fmt = (v: number | undefined, d = 1) => (v === undefined || Number.isNaN(v) ? '–' : v.toFixed(d));
    const delta = (v: number, b: number) => {
      const d = v - b;
      return `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
    };
    const rows = results
      .map(
        ({
          variant,
          summary: s,
        }) => `<tr${s.validity.valid ? '' : ' class="invalid" title="' + s.validity.warnings.join('; ') + '"'}><td>${s.validity.valid ? '' : '⚠ '}${variant}</td><td>${fmt(s.fps)}</td><td>${fmt(s.frameMs.p50)}</td><td>${fmt(s.frameMs.p95)}</td><td>${fmt(s.frameMs.p99)}</td><td>${fmt(s.low1Fps)}</td>
      <td>${fmt(s.jsFrameMs, 2)}</td><td>${delta(s.jsFrameMs, base.jsFrameMs)}</td><td>${fmt(s.jsBusyPct)}</td>
      <td>${s.gpuMs ? fmt(s.gpuMs.mean, 2) : 'n/a'}</td><td>${s.gpuMs && base.gpuMs ? delta(s.gpuMs.mean, base.gpuMs.mean) : '–'}</td><td>${s.drawCalls}</td><td>${(s.triangles / 1000).toFixed(0)}k</td></tr>`,
      )
      .join('');
    this.show(`<div class="bench-head"><b>Benchmark results</b><button data-b="close">×</button></div>
      <div class="bench-scroll"><table><thead><tr><th>variant</th><th>FPS</th><th>p50</th><th>p95</th><th>p99</th><th>1% low</th><th>JS ms</th><th>Δ JS</th><th>JS busy %</th><th>GPU ms</th><th>Δ GPU</th><th>calls</th><th>tris</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="bench-note">Display ${base.displayHz} Hz (measured from raw frame callbacks) · limiter ${base.frameLimiter.setting} → ${base.frameLimiter.targetFps} fps.
      ${results.some((r) => !r.summary.validity.valid) ? '⚠ rows were disturbed (focus lost, tab hidden or not live play) — hover for details and re-run with the tab focused.' : 'All rows measured in uninterrupted live play.'}</p>
      <p class="bench-note">GPU ms needs EXT_disjoint_timer_query_webgl2 (${base.gpuTimer}). FPS is capped by vsync — compare JS ms and GPU ms. Per-system CPU breakdown is in the exported JSON.</p>
      <div class="bench-actions"><button data-b="export">Export JSON</button><button data-b="copy">Copy JSON</button></div>`);
    this.el!.querySelector('[data-b=close]')!.addEventListener('click', () => {
      this.el!.hidden = true;
    });
    this.el!.querySelector('[data-b=export]')!.addEventListener('click', () => download(`${BRAND.filePrefix}-benchmark-${stamp()}.json`, report));
    this.el!.querySelector('[data-b=copy]')!.addEventListener('click', () => {
      void navigator.clipboard?.writeText(JSON.stringify(report, null, 1));
    });
    (window as unknown as { __benchReport: unknown }).__benchReport = report;
  }
}
