/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/**
 * Performance & fluidity profiler (toggle with F3, or open the game with `?diag`).
 *
 * Built for investigating performance on the player's own hardware:
 * - frame pacing: average FPS, median / p95 / p99 frame time, 1% low FPS, hitches, live frame graph
 * - per-subsystem main-thread CPU time: input, simulation (incl. AI), interpolation, camera, animation,
 *   scene update, shadow pass, render submission (WebGL command encoding), UI/HUD
 * - "game JS busy %": share of wall time spent in the game's frame callback. This is NOT total browser
 *   CPU: style/layout/compositing, the GPU process and audio run outside it.
 * - GPU frame time via EXT_disjoint_timer_query_webgl2 where the browser exposes it (reported as
 *   unavailable otherwise — never estimated)
 * - draw calls / triangles summed over every pass (shadow + main + post)
 * - JS heap and estimated GC activity (Chrome's performance.memory; unavailable elsewhere)
 * - long tasks and long animation frames (PerformanceObserver where supported)
 * - device pixel ratio, internal render resolution and active settings
 *
 * Overhead: per-frame bookkeeping is a handful of performance.now() calls and typed-array writes;
 * GPU queries, shadow/pass hooks and draw-call counting only run while the overlay is open or a
 * benchmark is running.
 */
import { InputLatencyTracker } from './inputLatency';
import { BRAND } from '../brand';

const WINDOW = 900; // frames kept (~15 s at 60 Hz)

export const SECTIONS = ['input', 'sim', 'ai', 'interp', 'camera', 'game', 'anim', 'scene', 'shadow', 'render', 'ui'] as const;
export type Section = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<Section, string> = {
  input: 'input poll',
  sim: 'simulation (total)',
  ai: '  of which AI',
  interp: 'interpolation',
  camera: 'camera',
  game: 'game logic/audio',
  anim: 'animation (skeletons)',
  scene: 'scene update',
  shadow: 'shadow pass (CPU)',
  render: 'render submit (CPU)',
  ui: 'HUD / UI',
};

/**
 * Profiling budgets (ms per frame at 60 fps = 16.7 ms) for a mid-range desktop, 11v11, High quality.
 * Not guarantees — the overlay flags sections that exceed them so regressions stand out.
 */
export const BUDGET_MS: Record<Section | 'jsTotal' | 'gpu', number> = {
  input: 0.1,
  sim: 1.5,
  ai: 0.8,
  interp: 0.1,
  camera: 0.1,
  game: 0.3,
  anim: 1.5,
  scene: 1.0,
  shadow: 1.0,
  render: 3.0,
  ui: 0.3,
  jsTotal: 8.0,
  gpu: 10.0,
};

class Ring {
  readonly a: Float32Array;
  n = 0;
  i = 0;
  constructor(size: number) {
    this.a = new Float32Array(size);
  }
  push(v: number): void {
    this.a[this.i] = v;
    this.i = (this.i + 1) % this.a.length;
    if (this.n < this.a.length) this.n++;
  }
  values(): number[] {
    const out = new Array<number>(this.n);
    for (let k = 0; k < this.n; k++) out[k] = this.a[(this.i - this.n + k + this.a.length) % this.a.length];
    return out;
  }
  mean(): number {
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.a[k];
    return this.n ? s / this.n : 0;
  }
  clear(): void {
    this.n = 0;
    this.i = 0;
  }
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
function mean(v: number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return v.length ? s / v.length : 0;
}
const r2 = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export interface PerfSummary {
  frames: number;
  fps: number;
  frameMs: { mean: number; p50: number; p95: number; p99: number; max: number; stdev: number };
  /** Average FPS over the slowest 1% of frames. */
  low1Fps: number;
  /** Share of frames > 1.5× the median frame time. */
  hitchPct: number;
  /** Rendered frames per second implied by the fastest 10% of frames (≈ the frame-rate limiter's target). */
  refreshHzEstimate: number;
  /** Display refresh measured from raw requestAnimationFrame intervals (independent of the limiter). */
  displayHz: number;
  frameLimiter: { setting: string; targetFps: number };
  /** Measurement validity: share of frames in live play, focus/visibility interruptions. */
  validity: { liveFramePct: number; modeFrames: Record<string, number>; blurEvents: number; hiddenEvents: number; valid: boolean; warnings: string[] };
  /** Estimated busy share of the page's main thread (all work incl. browser style/layout/GC), from idle-callback slack. */
  mainThreadBusyPctEstimate: number | null;
  inputActions: ReturnType<InputLatencyTracker['summary']>;
  /** Mean main-thread ms per frame spent in the game's frame callback, and its share of wall time. */
  jsFrameMs: number;
  jsBusyPct: number;
  sectionsMs: Record<Section, { mean: number; p95: number }>;
  gpuMs: { mean: number; p95: number } | null;
  gpuTimer: 'available' | 'unavailable' | 'off';
  drawCalls: number;
  triangles: number;
  simStepsPerSec: number;
  stepsPerFrame: Record<string, number>;
  heap: { usedMB: number; allocMBps: number; gcPerMin: number } | null;
  longTasks: { count: number; totalMs: number; maxMs: number; supported: boolean };
  longFrames: { count: number; maxBlockingMs: number; topScripts: string[]; supported: boolean };
  interpolation: { mode: string; alphaMin: number; alphaMax: number; snapsPerMin: number };
  input: { samples: number; toSimMs: { p50: number; p95: number }; toSubmitMs: { p50: number; p95: number }; note: string };
  camera: { aimLagM: { mean: number; max: number }; jerkP95: number; fov: number; mode: string };
  adaptive: ReturnType<FluidityDiagnostics['adaptive']>;
  display: {
    devicePixelRatio: number;
    pixelRatio: number;
    internalWidth: number;
    internalHeight: number;
    cssWidth: number;
    cssHeight: number;
    resolutionScale: number;
  };
}

/** Optional GPU timer (EXT_disjoint_timer_query_webgl2). */
class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private free: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  get supported(): boolean {
    return !!this.ext;
  }
  begin(): void {
    if (!this.ext || this.active || this.pending.length > 6) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
  /** Collect finished results (ms), oldest first. */
  poll(out: (ms: number) => void): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.pending.shift();
      this.free.push(q);
      if (!disjoint) out(ns / 1e6);
    }
  }
}

export interface RenderStatsSource {
  gl: WebGL2RenderingContext;
  info(): { calls: number; triangles: number };
  resetInfo(): void;
  display(): PerfSummary['display'];
}

export class FluidityDiagnostics {
  enabled = false;
  /** True while a benchmark is recording (turns on the detailed hooks without showing the panel). */
  benchmarking = false;
  private el: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private frameMs = new Ring(WINDOW);
  private jsMs = new Ring(WINDOW);
  private sec = Object.fromEntries(SECTIONS.map((s) => [s, new Ring(WINDOW)])) as Record<Section, Ring>;
  private cur = Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Record<Section, number>;
  private gpuMs = new Ring(WINDOW);
  private calls = new Ring(WINDOW);
  private tris = new Ring(WINDOW);
  private steps = new Ring(WINDOW);
  private alpha = new Ring(WINDOW);
  private snaps = new Ring(WINDOW);
  private camLag = new Ring(WINDOW);
  private camJerk = new Ring(WINDOW);
  private inToSim = new Ring(120);
  private inToSubmit = new Ring(120);
  private mode = 'live';
  private camMode = '';
  private fov = 0;
  private lastCam = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, ok: false };
  private totalSteps = 0;
  private totalTime = 0;
  private totalJs = 0;
  private pendingInput: number | null = null;
  private consumedInput: number | null = null;
  private lastText = 0;
  private gpu: GpuTimer | null = null;
  private stats: RenderStatsSource | null = null;
  private heapLast = 0;
  private heapT = 0;
  private heapAlloc = 0;
  private heapGc = 0;
  private heapSpan = 0;
  private longTaskCount = 0;
  private longTaskTotal = 0;
  private longTaskMax = 0;
  private loafCount = 0;
  private loafMaxBlock = 0;
  private loafScripts = new Map<string, number>();
  private ltSupported = false;
  private loafSupported = false;
  resolutionScale = 1;
  /** Extra info merged into the export (quality, camera, settings…). */
  context: () => Record<string, unknown> = () => ({});
  /** Real-input latency tracking (keyboard / gamepad / touch → simulation / frame). */
  readonly tracker = new InputLatencyTracker();
  /** Set by the game every frame. */
  display = { hz: 60, setting: 'balanced', targetFps: 60 };
  /** Latest AI ball-carrier decision with its reasons (F3 dev overlay). */
  aiDecision: () => string | null = () => null;
  /** Adaptive performance state (graphics mode, level, recent adjustments with reasons). */
  adaptive: () => { mode: string; level: string; calibrating: boolean; resolutionScale: number; history: Array<{ t: number; text: string }> } | null = () =>
    null;
  private modeFrames: Record<string, number> = { live: 0, replay: 0, paused: 0 };
  private blurEvents = 0;
  private hiddenEvents = 0;
  private idleMs = 0;
  private idleStart = 0;
  private idleRunning = false;
  /** Called by the "Run benchmark" button. */
  onBenchmark: (() => void) | null = null;
  /** Called by the "CPU check" button. */
  onCpuCheck: (() => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
    try {
      const types = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] }).supportedEntryTypes ?? [];
      if (types.includes('longtask')) {
        this.ltSupported = true;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            this.longTaskCount++;
            this.longTaskTotal += e.duration;
            this.longTaskMax = Math.max(this.longTaskMax, e.duration);
          }
        }).observe({ type: 'longtask', buffered: false });
      }
      if (types.includes('long-animation-frame')) {
        this.loafSupported = true;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as Array<
            PerformanceEntry & { blockingDuration?: number; scripts?: Array<{ sourceFunctionName?: string; invoker?: string; duration: number }> }
          >) {
            this.loafCount++;
            this.loafMaxBlock = Math.max(this.loafMaxBlock, e.blockingDuration ?? 0);
            for (const s of e.scripts ?? []) {
              const k = `${s.invoker ?? ''} ${s.sourceFunctionName ?? ''}`.trim();
              this.loafScripts.set(k, (this.loafScripts.get(k) ?? 0) + s.duration);
            }
          }
        }).observe({ type: 'long-animation-frame', buffered: false });
      }
    } catch {
      /* not supported */
    }
    window.addEventListener('blur', () => {
      this.blurEvents++;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hiddenEvents++;
    });
    if (new URLSearchParams(location.search).has('diag')) this.toggle(true);
  }

  /**
   * Main-thread idle probe: requestIdleCallback only runs when the main thread has nothing else to do,
   * and reports how much idle time is left. Summing that slack estimates how busy the main thread is
   * with ALL work — our frame callback plus the browser's own style/layout/paint/GC on that thread.
   * (Not total process CPU: the GPU process, compositor and audio threads run elsewhere.)
   */
  private startIdleProbe(): void {
    if (this.idleRunning || typeof requestIdleCallback !== 'function') return;
    this.idleRunning = true;
    this.idleStart = performance.now();
    const tick = (d: IdleDeadline) => {
      if (!this.detailed) {
        this.idleRunning = false;
        return;
      }
      this.idleMs += Math.min(50, d.timeRemaining());
      requestIdleCallback(tick, { timeout: 1000 });
    };
    requestIdleCallback(tick, { timeout: 1000 });
  }

  /** Detailed hooks (GPU timer, pass timing, draw-call counting) are active. */
  get detailed(): boolean {
    return this.enabled || this.benchmarking;
  }

  attachRenderer(src: RenderStatsSource): void {
    this.stats = src;
    this.gpu = new GpuTimer(src.gl);
  }

  toggle(on = !this.enabled): void {
    this.enabled = on;
    if (on && !this.el) this.build();
    if (this.el) this.el.hidden = !on;
  }

  private build(): void {
    const el = document.createElement('div');
    el.className = 'diag';
    el.innerHTML = `<div class="diag-head"><b>Performance &amp; fluidity</b><span>F3 to hide</span></div>
      <canvas width="300" height="70"></canvas><pre></pre>
      <div class="diag-actions"><button data-d="bench">Run benchmark</button><button data-d="cpu">CPU check</button><button data-d="export">Export JSON</button><button data-d="copy">Copy</button><button data-d="reset">Reset</button></div>`;
    document.body.appendChild(el);
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.textEl = el.querySelector('pre');
    el.querySelector('[data-d=export]')!.addEventListener('click', () => download(`${BRAND.filePrefix}-perf-${stamp()}.json`, this.export()));
    el.querySelector('[data-d=copy]')!.addEventListener('click', () => {
      void navigator.clipboard?.writeText(JSON.stringify(this.summary(), null, 2));
    });
    el.querySelector('[data-d=reset]')!.addEventListener('click', () => this.reset());
    el.querySelector('[data-d=bench]')!.addEventListener('click', () => this.onBenchmark?.());
    el.querySelector('[data-d=cpu]')!.addEventListener('click', () => this.onCpuCheck?.());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  reset(): void {
    for (const r of [
      this.frameMs,
      this.jsMs,
      this.gpuMs,
      this.calls,
      this.tris,
      this.steps,
      this.alpha,
      this.snaps,
      this.camLag,
      this.camJerk,
      this.inToSim,
      this.inToSubmit,
    ])
      r.clear();
    for (const s of SECTIONS) this.sec[s].clear();
    this.modeFrames = { live: 0, replay: 0, paused: 0 };
    this.blurEvents = 0;
    this.hiddenEvents = 0;
    this.idleMs = 0;
    this.idleStart = performance.now();
    this.tracker.reset();
    this.totalSteps = 0;
    this.totalTime = 0;
    this.totalJs = 0;
    this.heapAlloc = 0;
    this.heapGc = 0;
    this.heapSpan = 0;
    this.heapLast = 0;
    this.longTaskCount = 0;
    this.longTaskTotal = 0;
    this.longTaskMax = 0;
    this.loafCount = 0;
    this.loafMaxBlock = 0;
    this.loafScripts.clear();
  }

  // --- recording hooks ---

  /** Start of a rAF callback; dtSec = time since the previous one. */
  frame(dtSec: number): void {
    this.frameMs.push(dtSec * 1000);
    this.totalTime += dtSec;
    for (const s of SECTIONS) this.cur[s] = 0;
    if (this.detailed && this.stats) this.stats.resetInfo();
    if (this.detailed) {
      this.gpu?.poll((ms) => this.gpuMs.push(ms));
      this.startIdleProbe();
    }
    this.sampleHeap();
  }
  add(section: Section, ms: number): void {
    this.cur[section] += ms;
  }
  gpuBegin(): void {
    if (this.detailed) this.gpu?.begin();
  }
  gpuEnd(): void {
    if (this.detailed) this.gpu?.end();
  }
  /** End of the rAF callback: total JS time for this frame. */
  frameEnd(jsMs: number): void {
    this.jsMs.push(jsMs);
    this.totalJs += jsMs;
    for (const s of SECTIONS) this.sec[s].push(this.cur[s]);
    if (this.detailed && this.stats) {
      const i = this.stats.info();
      this.calls.push(i.calls);
      this.tris.push(i.triangles);
    }
    if (this.enabled && performance.now() - this.lastText > 300) {
      this.lastText = performance.now();
      this.draw();
    }
  }
  frameSim(ms: number, steps: number): void {
    this.add('sim', ms);
    this.steps.push(steps);
    this.totalSteps += steps;
    if (steps > 0 && this.pendingInput !== null) {
      this.inToSim.push(performance.now() - this.pendingInput);
      this.consumedInput = this.pendingInput;
      this.pendingInput = null;
    }
  }
  frameInterp(alpha: number, snaps: number, mode: string): void {
    this.alpha.push(alpha);
    this.snaps.push(snaps);
    this.mode = mode;
    this.modeFrames[mode] = (this.modeFrames[mode] ?? 0) + 1;
  }
  /** Called right after the frame was handed to WebGL. */
  frameSubmitted(): void {
    if (this.consumedInput !== null) {
      this.inToSubmit.push(performance.now() - this.consumedInput);
      this.consumedInput = null;
    }
  }
  inputEvent(t: number): void {
    if (this.pendingInput === null) this.pendingInput = t;
  }
  camera(px: number, py: number, pz: number, aimX: number, aimZ: number, ballX: number, ballZ: number, dt: number, fov: number, mode: string): void {
    this.camLag.push(Math.hypot(aimX - ballX, aimZ - ballZ));
    this.fov = fov;
    this.camMode = mode;
    const c = this.lastCam;
    if (dt > 0) {
      const vx = (px - c.x) / dt,
        vy = (py - c.y) / dt,
        vz = (pz - c.z) / dt;
      const ax = (vx - c.vx) / dt,
        ay = (vy - c.vy) / dt,
        az = (vz - c.vz) / dt;
      if (c.ok) this.camJerk.push(Math.hypot(ax - c.ax, ay - c.ay, az - c.az) * dt);
      c.vx = vx;
      c.vy = vy;
      c.vz = vz;
      c.ax = ax;
      c.ay = ay;
      c.az = az;
      c.ok = true;
    }
    c.x = px;
    c.y = py;
    c.z = pz;
  }
  cameraCut(): void {
    this.lastCam.ok = false;
  }

  private sampleHeap(): void {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (!mem) return;
    const now = performance.now();
    if (now - this.heapT < 100) return;
    const used = mem.usedJSHeapSize;
    if (this.heapLast) {
      const d = used - this.heapLast;
      if (d > 0) this.heapAlloc += d;
      else if (d < -512 * 1024) this.heapGc++;
      this.heapSpan += (now - this.heapT) / 1000;
    }
    this.heapLast = used;
    this.heapT = now;
  }

  summary(): PerfSummary {
    const fm = this.frameMs.values();
    const sorted = [...fm].sort((a, b) => a - b);
    const med = pct(sorted, 0.5);
    const avg = mean(fm);
    const sd = Math.sqrt(mean(fm.map((v) => (v - avg) ** 2)));
    const worst = sorted.slice(Math.floor(sorted.length * 0.99));
    const fastest = pct(sorted, 0.1) || 16.7;
    const steps = this.steps.values();
    const hist: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3+': 0 };
    for (const s of steps) hist[s >= 3 ? '3+' : String(s)]++;
    for (const k of Object.keys(hist)) hist[k] = steps.length ? r2((hist[k] / steps.length) * 100, 1) : 0;
    const alpha = this.alpha.values();
    const ts = [...this.inToSim.values()].sort((a, b) => a - b);
    const tsub = [...this.inToSubmit.values()].sort((a, b) => a - b);
    const lag = this.camLag.values();
    const jerk = [...this.camJerk.values()].sort((a, b) => a - b);
    const span = fm.reduce((a, b) => a + b, 0) / 1000;
    const sectionsMs = {} as PerfSummary['sectionsMs'];
    for (const s of SECTIONS) {
      const v = this.sec[s].values().sort((a, b) => a - b);
      sectionsMs[s] = { mean: r2(mean(v), 3), p95: r2(pct(v, 0.95), 3) };
    }
    const gpu = [...this.gpuMs.values()].sort((a, b) => a - b);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const display = this.stats?.display() ?? {
      devicePixelRatio: window.devicePixelRatio,
      pixelRatio: 0,
      internalWidth: 0,
      internalHeight: 0,
      cssWidth: innerWidth,
      cssHeight: innerHeight,
      resolutionScale: this.resolutionScale,
    };
    const totalModes = Object.values(this.modeFrames).reduce((a, b) => a + b, 0);
    const livePct = totalModes ? (this.modeFrames.live / totalModes) * 100 : 0;
    const warnings: string[] = [];
    if (livePct < 95)
      warnings.push(`only ${livePct.toFixed(0)}% of frames were live play (paused ${this.modeFrames.paused}, replay ${this.modeFrames.replay})`);
    if (this.blurEvents) warnings.push(`window lost focus ${this.blurEvents}×`);
    if (this.hiddenEvents) warnings.push(`tab was hidden ${this.hiddenEvents}×`);
    const idleSpanMs = performance.now() - this.idleStart;
    return {
      displayHz: this.display.hz,
      frameLimiter: { setting: this.display.setting, targetFps: this.display.targetFps },
      validity: {
        liveFramePct: r2(livePct, 1),
        modeFrames: { ...this.modeFrames },
        blurEvents: this.blurEvents,
        hiddenEvents: this.hiddenEvents,
        valid: warnings.length === 0,
        warnings,
      },
      mainThreadBusyPctEstimate: this.idleRunning && idleSpanMs > 2000 ? r2(Math.max(0, 100 - (this.idleMs / idleSpanMs) * 100), 1) : null,
      inputActions: this.tracker.summary(),
      frames: fm.length,
      fps: r2(avg > 0 ? 1000 / avg : 0, 1),
      frameMs: { mean: r2(avg), p50: r2(med), p95: r2(pct(sorted, 0.95)), p99: r2(pct(sorted, 0.99)), max: r2(sorted[sorted.length - 1] ?? 0), stdev: r2(sd) },
      low1Fps: r2(worst.length ? 1000 / mean(worst) : 0, 1),
      hitchPct: r2(fm.length ? (fm.filter((v) => v > med * 1.5).length / fm.length) * 100 : 0, 1),
      refreshHzEstimate: Math.round(1000 / fastest),
      jsFrameMs: r2(this.jsMs.mean(), 3),
      jsBusyPct: r2(this.totalTime > 0 ? (this.totalJs / 1000 / this.totalTime) * 100 : 0, 1),
      sectionsMs,
      gpuMs: gpu.length ? { mean: r2(mean(gpu), 3), p95: r2(pct(gpu, 0.95), 3) } : null,
      gpuTimer: !this.detailed ? 'off' : this.gpu?.supported ? 'available' : 'unavailable',
      drawCalls: Math.round(this.calls.mean()),
      triangles: Math.round(this.tris.mean()),
      simStepsPerSec: r2(this.totalTime > 0 ? this.totalSteps / this.totalTime : 0, 1),
      stepsPerFrame: hist,
      heap: mem
        ? {
            usedMB: r2(mem.usedJSHeapSize / 1048576, 1),
            allocMBps: r2(this.heapSpan > 0 ? this.heapAlloc / 1048576 / this.heapSpan : 0, 2),
            gcPerMin: r2(this.heapSpan > 0 ? (this.heapGc / this.heapSpan) * 60 : 0, 1),
          }
        : null,
      longTasks: { count: this.longTaskCount, totalMs: r2(this.longTaskTotal, 0), maxMs: r2(this.longTaskMax, 0), supported: this.ltSupported },
      longFrames: {
        count: this.loafCount,
        maxBlockingMs: r2(this.loafMaxBlock, 0),
        supported: this.loafSupported,
        topScripts: [...this.loafScripts]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([k, v]) => `${k} ${Math.round(v)}ms`),
      },
      interpolation: {
        mode: this.mode,
        alphaMin: r2(alpha.length ? Math.min(...alpha) : 0),
        alphaMax: r2(alpha.length ? Math.max(...alpha) : 0),
        snapsPerMin: r2(span > 0 ? (this.snaps.values().reduce((a, b) => a + b, 0) / span) * 60 : 0, 1),
      },
      input: {
        samples: ts.length,
        toSimMs: { p50: r2(pct(ts, 0.5), 1), p95: r2(pct(ts, 0.95), 1) },
        toSubmitMs: { p50: r2(pct(tsub, 0.5), 1), p95: r2(pct(tsub, 0.95), 1) },
        note: 'Input processing delay only (browser event → simulation → frame submitted). Excludes OS/USB, compositor, vsync wait and display latency, which need external hardware to measure.',
      },
      camera: {
        aimLagM: { mean: r2(mean(lag)), max: r2(lag.length ? Math.max(...lag) : 0) },
        jerkP95: r2(pct(jerk, 0.95)),
        fov: r2(this.fov, 1),
        mode: this.camMode,
      },
      display,
      adaptive: this.adaptive(),
    };
  }

  private draw(): void {
    const s = this.summary();
    if (this.textEl) {
      const S = s.sectionsMs;
      const rows = SECTIONS.map(
        (k) =>
          `${S[k].mean > BUDGET_MS[k] ? '!' : ' '}${SECTION_LABEL[k].padEnd(21)} ${S[k].mean.toFixed(2).padStart(6)}  p95 ${S[k].p95.toFixed(2).padStart(5)}  /${BUDGET_MS[k]}`,
      ).join('\n');
      this.textEl.textContent =
        `FPS ${s.fps}   1% low ${s.low1Fps}   display ${s.displayHz} Hz · limiter ${s.frameLimiter.setting} → ${s.frameLimiter.targetFps} fps\n` +
        (s.validity.valid ? '' : `⚠ ${s.validity.warnings.join('; ')}\n`) +
        `frame ms  p50 ${s.frameMs.p50}  p95 ${s.frameMs.p95}  p99 ${s.frameMs.p99}  max ${s.frameMs.max}\n` +
        `hitches ${s.hitchPct}%   game JS ${s.jsFrameMs} ms/frame = ${s.jsBusyPct}% of wall time\n` +
        `GPU ${s.gpuMs ? `${s.gpuMs.mean} ms (p95 ${s.gpuMs.p95})` : s.gpuTimer}\n` +
        `draw calls ${s.drawCalls}   triangles ${(s.triangles / 1000).toFixed(0)}k\n` +
        `── CPU ms/frame: mean, p95, /budget (! = over) ──\n${rows}\n` +
        `sim ${s.simStepsPerSec} steps/s  α ${s.interpolation.alphaMin}–${s.interpolation.alphaMax}\n` +
        `input→sim p50 ${s.input.toSimMs.p50} p95 ${s.input.toSimMs.p95} ms  →submit p50 ${s.input.toSubmitMs.p50}\n` +
        `── real input (software only, ms p50/p95, n) ──\n` +
        `move  →sim ${fmtS(s.inputActions.move.toSim)}  →motion ${fmtS(s.inputActions.move.toMotion)}  →frame ${fmtS(s.inputActions.move.toMotionFrame)}\n` +
        `pass  press→ball ${fmtS(s.inputActions.pass.pressToRelease)}  = queue ${s.inputActions.pass.queue.p50} + hold ${s.inputActions.pass.hold.p50} + windup ${s.inputActions.pass.windup.p50}\n` +
        `shot  press→ball ${fmtS(s.inputActions.shoot.pressToRelease)}  = queue ${s.inputActions.shoot.queue.p50} + hold ${s.inputActions.shoot.hold.p50} + windup ${s.inputActions.shoot.windup.p50}\n` +
        `switch press→change ${fmtS(s.inputActions.switch.toSwitch)}\n` +
        `main thread busy ≈${s.mainThreadBusyPctEstimate ?? 'n/a'}% (all main-thread work, estimate)\n` +
        `heap ${s.heap ? `${s.heap.usedMB} MB  alloc ${s.heap.allocMBps} MB/s  GC≈${s.heap.gcPerMin}/min` : 'n/a (Chrome only)'}\n` +
        `long tasks ${s.longTasks.supported ? `${s.longTasks.count} (max ${s.longTasks.maxMs} ms)` : 'n/a'}  long frames ${s.longFrames.supported ? `${s.longFrames.count} (max block ${s.longFrames.maxBlockingMs} ms)` : 'n/a'}\n` +
        `render ${s.display.internalWidth}×${s.display.internalHeight} (DPR ${s.display.devicePixelRatio}, ratio ${s.display.pixelRatio}, scale ${s.display.resolutionScale})\n` +
        `camera ${s.camera.mode}  lag ${s.camera.aimLagM.mean} m  jerk p95 ${s.camera.jerkP95}` +
        (s.adaptive
          ? `\n── adaptive (${s.adaptive.mode}${s.adaptive.calibrating ? ', calibrating' : ''}) ──\n` +
            `quality ${s.adaptive.level}  resolution ${Math.round(s.adaptive.resolutionScale * 100)}%  target ${s.frameLimiter.targetFps} fps\n` +
            (s.adaptive.history
              .slice(-4)
              .map((h) => `${h.t}s ${h.text}`)
              .join('\n') || 'no adjustments')
          : '') +
        (this.aiDecision() ? `\n── AI decision ──\n${this.aiDecision()}` : '');
    }
    const c = this.canvas;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const v = this.frameMs.values().slice(-c.width);
    const scale = c.height / 50;
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    for (const ms of [16.7, 33.3]) {
      g.beginPath();
      g.moveTo(0, c.height - ms * scale);
      g.lineTo(c.width, c.height - ms * scale);
      g.stroke();
    }
    v.forEach((ms, i) => {
      g.fillStyle = ms > 25 ? '#f87171' : ms > 18 ? '#fbbf24' : '#4ade80';
      const h = Math.min(c.height, ms * scale);
      g.fillRect(i, c.height - h, 1, h);
    });
  }

  export(): Record<string, unknown> {
    return {
      generated: new Date().toISOString(),
      summary: this.summary(),
      budgetsMs: BUDGET_MS,
      context: {
        ...this.context(),
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
      },
      frames: {
        frameMs: this.frameMs.values().map((x) => +x.toFixed(2)),
        jsMs: this.jsMs.values().map((x) => +x.toFixed(3)),
        gpuMs: this.gpuMs.values().map((x) => +x.toFixed(3)),
        steps: this.steps.values(),
      },
    };
  }
}

function fmtS(x: { n: number; p50: number; p95: number }): string {
  return x.n ? `${x.p50}/${x.p95} (${x.n})` : '–';
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Trigger a JSON file download (works in a normal browser tab). */
export function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
