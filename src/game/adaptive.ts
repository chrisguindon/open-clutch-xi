/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import type { Quality } from './settings';

/**
 * Adaptive performance controller. Pure and deterministic, so it can be tested with simulated
 * hardware profiles (tests/adaptive.test.ts).
 *
 * It watches rendered frame times in 2 s windows (1 s while calibrating at start-up) and decides, with
 * hysteresis and cooldowns, whether to lower or raise:
 *   1. on high-refresh screens, the frame-rate target (an even divisor of the refresh, ≥ ~55 fps),
 *   2. render resolution (first down to 85%),
 *   3. the quality level (expensive effects go first: bloom, MSAA, shadows, crowd density…),
 *   4. resolution further (down to 65%),
 *   5. the frame-rate target again, as a last resort (never below ~30 fps).
 * Quality is restored in reverse order, one step at a time, only after sustained headroom (30 s), and a
 * setting that keeps failing needs exponentially longer before it is tried again — no oscillation.
 * Gameplay (simulation, input, player/ball visibility, team colours, UI) is never touched.
 */
export interface QualityLevel {
  name: string;
  quality: Quality;
  overrides: { bloom?: boolean; msaa?: number };
}

/** Quality levels from best to cheapest. Adaptive quality steps along this list, never skipping levels. */
export const LADDER: QualityLevel[] = [
  { name: 'Ultra', quality: 'ultra', overrides: {} },
  { name: 'High', quality: 'high', overrides: {} },
  { name: 'High (no bloom)', quality: 'high', overrides: { bloom: false } },
  { name: 'Medium', quality: 'medium', overrides: {} },
  { name: 'Medium (lean)', quality: 'medium', overrides: { bloom: false, msaa: 2 } },
  { name: 'Low', quality: 'low', overrides: {} },
  { name: 'Low (lean)', quality: 'low', overrides: { msaa: 0 } },
];

/** Position of a preset on the {@link LADDER} (the first level using it). */
export function levelIndexFor(q: Quality): number {
  return Math.max(
    0,
    LADDER.findIndex((l) => l.quality === q),
  );
}

/** Where the controller currently is: quality level, render-resolution scale and frame-rate step. */
export interface AdaptiveState {
  level: number;
  resScale: number;
  /** Frame-rate step below the top target (0 = top). */
  fpsStep: number;
}

/** What one review changed, if anything, and why (shown in the F3 panel and the history). */
export interface AdaptiveDecision {
  changed: boolean;
  kind?: 'resolution' | 'level' | 'framerate';
  direction?: 'down' | 'up';
  reason?: string;
}

/** Limits the player has set: whether quality may change, and the best level allowed. */
export interface AdaptiveOptions {
  /** Quality level may change (Auto graphics, or a manual preset with adaptive quality on). */
  autoLevel: boolean;
  /** Best level allowed (0 = Ultra). A manual preset is a ceiling: adaptation never exceeds it. */
  topLevel: number;
  dynamicResolution: boolean;
  /** Frame-rate target may step down/up (frame-rate setting 'auto'). */
  autoFrameRate: boolean;
  /** How many fps steps exist for the current display (0 = none). */
  maxFpsStep: number;
  /** Frame rate at a given step (for ordering decisions). */
  fpsAt: (step: number) => number;
}

/**
 * Frame-rate targets at or above this are "high refresh": on a 120–240 Hz screen it's better to drop
 * from e.g. 144 to 72 fps than to lower quality. Below it, fps is only cut as a last resort (≥ 30).
 */
export const HIGH_FPS_FLOOR = 55;
export const MIN_FPS = 29;

/** One change, timestamped, for the diagnostics panel. */
export interface HistoryEntry {
  t: number;
  text: string;
}

const RES_FIRST = 0.85,
  RES_MIN = 0.65,
  RES_STEP = 0.1;

/**
 * Keeps the frame rate smooth by trading resolution, effects and frame rate, with hysteresis so it
 * doesn't oscillate. Pure: it reads frame times and returns decisions, and never touches the renderer,
 * which is why tests/adaptive.test.ts can test it with simulated devices. See ADR 0003.
 */
export class AdaptiveController {
  state: AdaptiveState;
  readonly history: HistoryEntry[] = [];
  private window: number[] = [];
  private windowTime = 0;
  private bad = 0;
  private good = 0;
  private cooldown = 0;
  private skipNext = false;
  private calibrateFor: number;
  private elapsed = 0;
  /** Times each state (level/resolution/fps) was abandoned soon after moving up to it. */
  private failures = new Map<string, number>();
  lastReason = 'calibrating';

  constructor(
    start: AdaptiveState,
    public opts: AdaptiveOptions,
    calibrateSeconds = 8,
  ) {
    this.state = { ...start };
    this.calibrateFor = calibrateSeconds;
    // The first window after (re)starting includes start-up work (shader compiles, texture uploads).
    this.skipNext = true;
  }

  get calibrating(): boolean {
    return this.elapsed < this.calibrateFor;
  }

  /** Ignore the current window (tab hidden / shown, window resized, quality rebuilt). */
  interrupt(): void {
    this.window = [];
    this.windowTime = 0;
    this.bad = this.good = 0;
    this.skipNext = true;
  }

  /**
   * Feed one rendered frame. `costMs` = the game's CPU work for the frame (and GPU time when
   * measurable, whichever is larger). Returns a decision when something should change.
   */
  frame(dtSec: number, targetDtSec: number, costMs: number): AdaptiveDecision {
    if (!(dtSec > 0)) return { changed: false };
    // Tab switches are excluded by `interrupt()`; a genuinely slow device (1–2 fps) must still adapt,
    // so long frames are clamped rather than ignored.
    dtSec = Math.min(dtSec, 1);
    this.elapsed += dtSec;
    this.window.push(dtSec * 1000, costMs);
    this.windowTime += dtSec;
    const winLen = this.calibrating ? 1 : 2;
    if (this.windowTime < winLen) return { changed: false };
    const frames: number[] = [],
      costs: number[] = [];
    for (let i = 0; i < this.window.length; i += 2) {
      frames.push(this.window[i]);
      costs.push(this.window[i + 1]);
    }
    this.window = [];
    this.windowTime = 0;
    if (this.skipNext) {
      this.skipNext = false;
      return { changed: false };
    }
    if (this.cooldown > 0) {
      this.cooldown -= winLen;
      return { changed: false };
    }
    frames.sort((a, b) => a - b);
    costs.sort((a, b) => a - b);
    const median = frames[Math.floor(frames.length * 0.5)];
    const p90 = frames[Math.floor(frames.length * 0.9)];
    const cost = costs[Math.floor(costs.length * 0.5)];
    const target = targetDtSec * 1000;
    // p90 catches stutter, but one missed vsync at 144–240 Hz is a few ms and barely visible.
    const isBad = median > target * 1.2 || (p90 > target * 1.7 && p90 > target + 6);
    // "Good" = on target with clear headroom (the frame's own work under ~60% of the budget).
    const isGood = median <= target * 1.06 && p90 <= Math.max(target * 1.3, target + 3) && cost / target < 0.6;
    if (isBad) {
      this.bad++;
      this.good = 0;
    } else if (isGood) {
      this.good++;
      this.bad = 0;
    } else {
      this.bad = 0;
      this.good = 0;
    }
    const cal = this.calibrating;
    if (this.bad >= (cal ? 1 : 2)) {
      this.noteDegrade();
      const d = this.degrade(median, target);
      if (d.changed) {
        this.bad = 0;
        this.cooldown = cal ? 1 : 4;
      }
      return d;
    }
    const needGood = cal ? 3 : 15;
    if (this.good >= needGood) {
      const d = this.improve(cost, target);
      this.good = 0;
      if (d.changed) this.cooldown = cal ? 1 : 6;
      return d;
    }
    return { changed: false };
  }

  private log(text: string): void {
    this.lastReason = text;
    this.history.push({ t: Math.round(this.elapsed), text });
    if (this.history.length > 30) this.history.shift();
  }

  private change(kind: 'resolution' | 'level' | 'framerate', direction: 'down' | 'up', text: string): AdaptiveDecision {
    this.log(text);
    return { changed: true, kind, direction, reason: text };
  }

  private degrade(median: number, target: number): AdaptiveDecision {
    this.state = { ...this.state };
    const s = this.state,
      o = this.opts;
    const why = `frames ${median.toFixed(1)} ms vs ${target.toFixed(1)} ms target`;
    const nextFps = o.autoFrameRate && s.fpsStep < o.maxFpsStep ? o.fpsAt(s.fpsStep + 1) : 0;
    // 1. High-refresh screens: halve the rate (144 → 72) before touching visuals.
    if (nextFps >= HIGH_FPS_FLOOR) {
      s.fpsStep++;
      return this.change('framerate', 'down', `frame-rate target ↓ ${Math.round(nextFps)} fps (${why})`);
    }
    // 2. A little resolution.
    if (o.dynamicResolution && s.resScale > RES_FIRST + 1e-6) {
      s.resScale = Math.max(RES_FIRST, round(s.resScale - RES_STEP));
      return this.change('resolution', 'down', `resolution ↓ ${Math.round(s.resScale * 100)}% (${why})`);
    }
    // 3. The quality ladder.
    if (o.autoLevel && s.level < LADDER.length - 1) {
      s.level++;
      return this.change('level', 'down', `quality ↓ ${LADDER[s.level].name} (${why})`);
    }
    // 4. More resolution.
    if (o.dynamicResolution && s.resScale > RES_MIN + 1e-6) {
      s.resScale = Math.max(RES_MIN, round(s.resScale - RES_STEP));
      return this.change('resolution', 'down', `resolution ↓ ${Math.round(s.resScale * 100)}% (${why})`);
    }
    // 5. Last resort on constrained hardware: a lower frame rate, never below ~30 fps.
    if (nextFps >= MIN_FPS) {
      s.fpsStep++;
      return this.change('framerate', 'down', `frame-rate target ↓ ${Math.round(nextFps)} fps (${why})`);
    }
    return { changed: false };
  }

  private improve(cost: number, target: number): AdaptiveDecision {
    const s = this.state,
      o = this.opts;
    const why = `headroom: frame work ${Math.round((cost / target) * 100)}% of the budget`;
    const canFpsUp = o.autoFrameRate && s.fpsStep > 0;
    const upFps = canFpsUp ? o.fpsAt(s.fpsStep - 1) : 0;
    // Faster rate only if the frame work fits comfortably in the faster budget.
    const fitsFaster = canFpsUp && cost < (1000 / upFps) * 0.45;
    const resUp = (cap: number) => ({ ...s, resScale: Math.min(cap, round(s.resScale + RES_STEP)) });
    // Undo in reverse order of `degrade`. Each candidate is subject to the failure back-off.
    const candidates: Array<[boolean, AdaptiveState, 'resolution' | 'level' | 'framerate', () => string]> = [
      [
        canFpsUp && o.fpsAt(s.fpsStep) < HIGH_FPS_FLOOR && fitsFaster,
        { ...s, fpsStep: s.fpsStep - 1 },
        'framerate',
        () => `frame-rate target ↑ ${Math.round(upFps)} fps`,
      ],
      [o.dynamicResolution && s.resScale < RES_FIRST - 1e-6, resUp(RES_FIRST), 'resolution', () => `resolution ↑ ${Math.round(this.state.resScale * 100)}%`],
      [o.autoLevel && s.level > o.topLevel, { ...s, level: s.level - 1 }, 'level', () => `quality ↑ ${LADDER[this.state.level].name}`],
      [o.dynamicResolution && s.resScale < 1 - 1e-6, resUp(1), 'resolution', () => `resolution ↑ ${Math.round(this.state.resScale * 100)}%`],
      [fitsFaster, { ...s, fpsStep: s.fpsStep - 1 }, 'framerate', () => `frame-rate target ↑ ${Math.round(upFps)} fps`],
    ];
    for (const [ok, next, kind, text] of candidates) {
      if (!ok) continue;
      // A step that recently failed means we're at the edge: wait, rather than trying the next step.
      if (this.blocked(key(next))) break;
      this.state = next;
      this.lastUp = { key: key(next), t: this.elapsed };
      return this.change(kind, 'up', `${text()} (${why})`);
    }
    return { changed: false };
  }

  /**
   * Back-off: a state that had to be abandoned within 40 s of moving up to it has "failed"; after n
   * failures it is only retried after 4^n good periods (≈ 2, 8, 32… minutes of steady play). This stops
   * the controller ping-ponging between two settings on hardware that sits right at the edge.
   */
  private lastUp: { key: string; t: number } | null = null;
  private retryCredit = new Map<string, number>();
  private noteDegrade(): void {
    if (this.lastUp && this.elapsed - this.lastUp.t < 40) this.failures.set(this.lastUp.key, (this.failures.get(this.lastUp.key) ?? 0) + 1);
    this.lastUp = null;
  }
  private blocked(k: string): boolean {
    const f = this.failures.get(k) ?? 0;
    if (f === 0) return false;
    const have = (this.retryCredit.get(k) ?? 0) + 1;
    this.retryCredit.set(k, have);
    if (have >= 4 ** f) {
      this.retryCredit.set(k, 0);
      return false;
    }
    return true;
  }
}

function key(s: AdaptiveState): string {
  return `${s.level}/${s.resScale}/${s.fpsStep}`;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
