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
import * as THREE from 'three';
import { FixedStepClock, Frame, PF, P_STRIDE, snapAlpha } from '../src/game/frames';
import { SIM_DT, PITCHES } from '../src/sim/config';
import { Match } from '../src/sim/match';
import { consumeEdges, emptyInput } from '../src/sim/human';
import { CameraRig } from '../src/render/camera';
import { Rng } from '../src/core/rng';

/** Frame-time generators (seconds). */
const fixed = (hz: number) => () => 1 / hz;
function jittery(seed: number) {
  const r = new Rng(seed);
  return () => {
    const u = r.next();
    if (u < 0.03) return 0.06 + r.next() * 0.06; // occasional hitch (GC / tab stall)
    return 0.007 + r.next() * 0.03; // 7–37 ms
  };
}

/**
 * Drive a practice match with a constant "run right" input through the real fixed-step clock and
 * record the interpolated (rendered) human position at every rendered frame.
 */
function renderRun(nextDt: () => number, seconds: number) {
  const m = new Match({ mode: 'practice', format: '5v5', difficulty: 'medium', duration: 9999, seed: 3, replays: false });
  m.phase = 'playing';
  const id = m.humanId!;
  const w = m.world;
  for (const p of w.players) if (p.id !== id) p.place(-30 + p.id, 19, 0);
  w.players[id].place(-25, 0, 0);
  w.ball.reset(20, -15);
  const input = emptyInput();
  input.move.x = 1;
  const prev = new Frame(w.players.length),
    cur = new Frame(w.players.length);
  cur.capture(m);
  prev.copyFrom(cur);
  const clock = new FixedStepClock(SIM_DT, 14);
  const out: Array<{ t: number; x: number; dt: number }> = [];
  let t = 0;
  while (t < seconds) {
    const dt = Math.min(0.1, nextDt());
    t += dt;
    const { alpha } = clock.advance(dt, () => {
      prev.copyFrom(cur);
      m.step(SIM_DT, input);
      consumeEdges(input);
      if (m.phase !== 'playing') m.phase = 'playing';
      cur.capture(m);
    });
    const o = id * P_STRIDE;
    const a = snapAlpha(Math.abs(cur.players[o + PF.X] - prev.players[o + PF.X]), cur.time - prev.time, alpha, 20, 0.8);
    out.push({ t, x: prev.players[o + PF.X] + (cur.players[o + PF.X] - prev.players[o + PF.X]) * a, dt });
  }
  return out;
}

describe('render interpolation and frame-rate independence', () => {
  it('rendered motion is monotonic and speed-consistent under irregular frame timing', () => {
    const run = renderRun(jittery(11), 4);
    let maxErr = 0;
    for (let i = 1; i < run.length; i++) {
      const dx = run[i].x - run[i - 1].x;
      expect(dx).toBeGreaterThanOrEqual(-1e-6); // never moves backwards
      // Once at speed (after 1 s), on-screen speed must match the simulated speed each frame.
      if (run[i].t > 1 && run[i].dt > 0.004 && run[i].dt < 0.05) {
        const v = dx / run[i].dt;
        maxErr = Math.max(maxErr, Math.abs(v - 5.9) / 5.9);
      }
    }
    expect(maxErr).toBeLessThan(0.03);
  });

  it('positions at the same wall-clock time agree across 30/60/144/240 Hz and jittery frames', () => {
    const at = (run: Array<{ t: number; x: number }>, T: number) => {
      // Linear sample between rendered frames around T.
      for (let i = 1; i < run.length; i++)
        if (run[i].t >= T) {
          const a = run[i - 1],
            b = run[i];
          return a.x + (b.x - a.x) * ((T - a.t) / (b.t - a.t));
        }
      return run[run.length - 1].x;
    };
    const runs = [fixed(30), fixed(60), fixed(144), fixed(240), jittery(5)].map((g) => renderRun(g, 3.2));
    for (const T of [0.5, 1.5, 2.9]) {
      const xs = runs.map((r) => at(r, T));
      // Within ~1.5 simulation steps of travel at sprint pace.
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.1);
    }
  });

  it('teleports snap instead of smearing across the pitch', () => {
    expect(snapAlpha(30, SIM_DT, 0.4, 20, 0.8)).toBe(1);
    expect(snapAlpha(0.05, SIM_DT, 0.4, 20, 0.8)).toBe(0.4);
  });

  it('fixed-step clock caps catch-up after a long stall', () => {
    const c = new FixedStepClock(SIM_DT, 14);
    let n = 0;
    const r = c.advance(1.0, () => {
      n++;
    });
    expect(n).toBe(14);
    expect(r.alpha).toBe(0);
  });

  it('camera tracking is frame-rate independent (no extra jitter at irregular frame times)', () => {
    const track = (nextDt: () => number) => {
      const cam = new CameraRig(PITCHES['5v5'], 16 / 9);
      cam.setPitch(PITCHES['5v5']);
      const ball = new THREE.Vector3(-20, 0.11, 3),
        vel = new THREE.Vector3(8, 0, 0);
      cam.cut();
      const samples: Array<{ t: number; x: number }> = [];
      let t = 0;
      while (t < 4) {
        const dt = Math.min(0.1, nextDt());
        t += dt;
        ball.set(-20 + 8 * t, 0.11, 3 + Math.sin(t) * 2);
        vel.set(8, 0, Math.cos(t) * 2);
        cam.update(dt, { ball, ballVel: vel, focus: null, attackDir: 1, players: [] });
        samples.push({ t, x: cam.camera.position.x });
      }
      return samples;
    };
    const ref = track(fixed(240));
    const at = (run: Array<{ t: number; x: number }>, T: number) => {
      for (let i = 1; i < run.length; i++)
        if (run[i].t >= T) {
          const a = run[i - 1],
            b = run[i];
          return a.x + (b.x - a.x) * ((T - a.t) / (b.t - a.t));
        }
      return run[run.length - 1].x;
    };
    const camWorst: number[] = [];
    for (const g of [fixed(30), fixed(60), jittery(9)]) {
      const run = track(g);
      // Compare at the frames this run actually displays.
      let worst = 0;
      for (const f of run) if (f.t > 2 && f.t < 3.9) worst = Math.max(worst, Math.abs(f.x - at(ref, f.t)));
      camWorst.push(+worst.toFixed(3));
      expect(worst).toBeLessThan(0.05);
    }
  });
});
