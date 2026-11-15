/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { KICK_TIMING, MOVE } from '../sim/config';
import type { Match } from '../sim/match';
import type { CameraRig, CameraTuning } from '../render/camera';
import { measureResponsiveness } from './responsiveness';
import { applyTuning, clearTuning, currentTuning, loadTuning, saveTuning } from './tuning';

/**
 * Movement lab (open the game with `?lab`): one player on an empty pitch for isolating movement,
 * animation, camera and ball-handling feel. Scenarios: stationary ball, rolling ball, dribbling lane.
 * Every major gameplay parameter can be adjusted live; settings persist and can optionally be used in
 * normal matches. Development tool — not part of the regular menus.
 */
export interface LabHost {
  match(): Match | null;
  cam: CameraRig;
  cut(): void;
}

type Slider = { group: string; label: string; get: () => number; set: (v: number) => void; min: number; max: number; step: number };

export class MovementLab {
  private el: HTMLElement;
  private useInMatches: boolean;
  private scenario: 'free' | 'stationary' | 'rolling' | 'dribble' = 'stationary';
  private rollTimer = 0;

  constructor(private host: LabHost) {
    const stored = loadTuning();
    this.useInMatches = stored?.useInMatches ?? false;
    applyTuning(stored, host.cam.tune);
    this.el = document.createElement('div');
    this.el.className = 'lab';
    document.body.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.render();
  }

  private sliders(): Slider[] {
    const c: CameraTuning = this.host.cam.tune;
    const m = (k: keyof typeof MOVE, label: string, min: number, max: number, step: number, group = 'Movement (all players)'): Slider => ({
      group,
      label,
      get: () => MOVE[k] as number,
      set: (v) => {
        (MOVE as unknown as Record<string, number>)[k] = v;
      },
      min,
      max,
      step,
    });
    return [
      m('accel', 'Acceleration (m/s²)', 8, 40, 0.5),
      m('decel', 'Braking (m/s²)', 8, 50, 0.5),
      m('turnRateSlow', 'Turn rate slow (rad/s)', 4, 30, 0.5),
      m('turnRateFast', 'Turn rate at sprint (rad/s)', 1, 15, 0.1),
      m('plantAngle', 'Reversal plant angle (rad)', 1.2, 3.2, 0.05),
      m('plantBase', 'Plant base time (s)', 0, 0.4, 0.01),
      m('turnSpeedLoss', 'Max speed lost in hard turns', 0, 0.9, 0.05),
      m('humanAccel', 'Accel ×', 0.8, 1.6, 0.05, 'Human modifiers'),
      m('humanDecel', 'Braking ×', 0.8, 2.2, 0.05, 'Human modifiers'),
      m('humanTurn', 'Turning ×', 0.8, 2.5, 0.05, 'Human modifiers'),
      m('humanPlant', 'Plant time ×', 0, 1.5, 0.05, 'Human modifiers'),
      m('humanTurnSpeedLoss', 'Turn speed loss ×', 0, 1.5, 0.05, 'Human modifiers'),
      {
        group: 'Kick timing',
        label: 'Pass contact (s)',
        get: () => KICK_TIMING.passContact,
        set: (v) => {
          KICK_TIMING.passContact = v;
          KICK_TIMING.passTotal = Math.max(v + 0.15, KICK_TIMING.passTotal);
        },
        min: 0.03,
        max: 0.2,
        step: 0.005,
      },
      {
        group: 'Kick timing',
        label: 'Shot contact (s)',
        get: () => KICK_TIMING.shotContact,
        set: (v) => {
          KICK_TIMING.shotContact = v;
          KICK_TIMING.shotTotal = Math.max(v + 0.2, KICK_TIMING.shotTotal);
        },
        min: 0.05,
        max: 0.25,
        step: 0.005,
      },
      {
        group: 'Camera',
        label: 'Follow rate along pitch',
        get: () => c.targetRateX,
        set: (v) => {
          c.targetRateX = v;
        },
        min: 0.5,
        max: 10,
        step: 0.1,
      },
      {
        group: 'Camera',
        label: 'Follow rate across pitch',
        get: () => c.targetRateZ,
        set: (v) => {
          c.targetRateZ = v;
        },
        min: 0.5,
        max: 10,
        step: 0.1,
      },
      {
        group: 'Camera',
        label: 'Position smoothing ×',
        get: () => c.posRateScale,
        set: (v) => {
          c.posRateScale = v;
        },
        min: 0.3,
        max: 3,
        step: 0.05,
      },
      {
        group: 'Camera',
        label: 'Ball lead (s)',
        get: () => c.leadX,
        set: (v) => {
          c.leadX = v;
        },
        min: 0,
        max: 0.6,
        step: 0.01,
      },
      {
        group: 'Camera',
        label: 'Dynamic cam follow rate',
        get: () => c.dynamicRate,
        set: (v) => {
          c.dynamicRate = v;
        },
        min: 0.5,
        max: 10,
        step: 0.1,
      },
    ];
  }

  private render(): void {
    const groups = new Map<string, string[]>();
    this.sliders().forEach((s, i) => {
      const row = `<label><span>${s.label}</span><input type="range" data-i="${i}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.get()}"><output data-o="${i}">${+s.get().toFixed(3)}</output></label>`;
      groups.set(s.group, [...(groups.get(s.group) ?? []), row]);
    });
    const c = this.host.cam.tune;
    this.el.innerHTML = `<div class="lab-head"><b>Movement lab</b><span>dev tool · F3 diagnostics</span></div>
      <div class="lab-row">
        <button data-a="stationary">Stationary ball</button><button data-a="rolling">Rolling ball</button>
        <button data-a="dribble">Dribble lane</button><button data-a="free">No ball</button>
      </div>
      <div class="lab-row">
        <label class="chk"><input type="checkbox" data-c="fixed" ${c.fixed ? 'checked' : ''}> Fixed camera</label>
        <label class="chk"><input type="checkbox" data-c="autoZoom" ${c.autoZoom ? 'checked' : ''}> Auto zoom</label>
        <span class="hint">C cycles broadcast / dynamic / tactical</span>
      </div>
      ${[...groups].map(([g, rows]) => `<details ${g.startsWith('Human') || g === 'Camera' ? 'open' : ''}><summary>${g}</summary>${rows.join('')}</details>`).join('')}
      <div class="lab-row">
        <button data-a="measure">Measure responsiveness</button><button data-a="defaults">Reset defaults</button><button data-a="copy">Copy JSON</button>
      </div>
      <label class="chk"><input type="checkbox" data-c="useInMatches" ${this.useInMatches ? 'checked' : ''}> Use these settings in normal matches</label>
      <pre class="lab-out"></pre>`;
    const sl = this.sliders();
    this.el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const s = sl[+inp.dataset.i!];
        s.set(+inp.value);
        this.el.querySelector(`[data-o="${inp.dataset.i}"]`)!.textContent = String(+(+inp.value).toFixed(3));
        this.save();
      });
    });
    this.el.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.c!;
        if (k === 'useInMatches') this.useInMatches = inp.checked;
        else (this.host.cam.tune as unknown as Record<string, boolean>)[k] = inp.checked;
        if (k === 'fixed') this.host.cut();
        this.save();
      });
    });
    this.el.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => b.addEventListener('click', () => this.action(b.dataset.a!)));
  }

  private save(): void {
    saveTuning(currentTuning(this.host.cam.tune, this.useInMatches));
  }

  private action(a: string): void {
    const out = this.el.querySelector('.lab-out')!;
    if (a === 'defaults') {
      clearTuning();
      applyTuning(null, this.host.cam.tune);
      this.useInMatches = false;
      this.render();
      return;
    }
    if (a === 'copy') {
      void navigator.clipboard?.writeText(JSON.stringify(currentTuning(this.host.cam.tune, this.useInMatches), null, 2));
      out.textContent = 'Tuning copied to clipboard.';
      return;
    }
    if (a === 'measure') {
      const r = measureResponsiveness();
      const ai = measureResponsiveness(true);
      out.textContent = Object.keys(r)
        .map((k) => `${k.padEnd(18)} ${String((r as unknown as Record<string, unknown>)[k]).padStart(6)}   AI ${(ai as unknown as Record<string, unknown>)[k]}`)
        .join('\n');
      return;
    }
    this.scenario = a as typeof this.scenario;
    this.setupScenario();
  }

  /** Place the human, the ball and park everyone else for the current scenario. */
  setupScenario(): void {
    const m = this.host.match();
    if (!m || m.humanId === null) return;
    const w = m.world,
      h = w.players[m.humanId];
    this.park(m);
    h.place(-12, 0, 0);
    w.clearPossession();
    if (this.scenario === 'stationary') w.ball.reset(-6, 0);
    else if (this.scenario === 'free') w.ball.reset(30, -18);
    else if (this.scenario === 'dribble') w.ball.reset(h.footX(0.5), h.footZ(0.5));
    else if (this.scenario === 'rolling') {
      w.ball.reset(5, -12);
      w.ball.vel.set(-6, 0, 5);
      this.rollTimer = 3.5;
    }
    m.phase = 'playing';
    w.restrictTouchTo = null;
    this.host.cut();
  }

  /** Called after every simulation step: keep the pitch empty apart from the human and the ball. */
  afterStep(dt: number): void {
    const m = this.host.match();
    if (!m) return;
    this.park(m);
    if (m.phase !== 'playing') m.phase = 'playing';
    if (this.scenario === 'rolling') {
      this.rollTimer -= dt;
      if (this.rollTimer <= 0) {
        // Roll another ball across the player's path from a random side.
        const w = m.world,
          h = w.players[m.humanId ?? 0];
        const side = Math.random() < 0.5 ? -1 : 1;
        w.clearPossession();
        w.ball.reset(h.pos.x + 10, side * 12);
        w.ball.vel.set(-4 - Math.random() * 3, 0, -side * (4 + Math.random() * 3));
        this.rollTimer = 4;
      }
    }
  }

  private park(m: Match): void {
    const w = m.world;
    for (const p of w.players) {
      if (p.id === m.humanId) continue;
      const x = -w.pitch.length / 2 + 2 + p.id * 1.2,
        z = w.pitch.width / 2 + 2;
      if (Math.abs(p.pos.x - x) > 0.01 || Math.abs(p.pos.z - z) > 0.01) p.place(x, z, -Math.PI / 2);
      p.vel.set(0, 0);
    }
  }
}
