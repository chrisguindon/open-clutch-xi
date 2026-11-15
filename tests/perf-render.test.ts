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
import { frameIntervalFor, autoFrameSteps } from '../src/game/frames';
import { AnimationBank, BakedAction, BakedClip, PoseSampler } from '../src/render/characters/clipSampler';
import { summary } from './helpers';

describe('frame-rate limiter', () => {
  const hz = (refresh: number, s: 'balanced' | 'display' | 'saver') => Math.round(1 / frameIntervalFor(1 / refresh, s));
  it('balanced keeps ~60 fps as an even divisor of the refresh rate', () => {
    expect(hz(60, 'balanced')).toBe(60);
    expect(hz(120, 'balanced')).toBe(60);
    expect(hz(144, 'balanced')).toBe(72);
    expect(hz(240, 'balanced')).toBe(60);
    expect(hz(75, 'balanced')).toBe(75);
    expect(hz(165, 'balanced')).toBe(55);
  });
  it('saver targets ~30 fps, display renders every refresh', () => {
    expect(hz(60, 'saver')).toBe(30);
    expect(hz(144, 'saver')).toBe(29);
    expect(hz(144, 'display')).toBe(144);
  });
});

describe('auto frame rate', () => {
  const fps = (refresh: number, step = 0) => Math.round(1 / frameIntervalFor(1 / refresh, 'auto', step));
  it('renders every refresh up to ~165 Hz and an even divisor above (240 Hz → 120 fps)', () => {
    expect(fps(60)).toBe(60);
    expect(fps(120)).toBe(120);
    expect(fps(144)).toBe(144);
    expect(fps(165)).toBe(165);
    expect(fps(240)).toBe(120);
    expect(fps(360)).toBe(120);
  });
  it('steps down by whole divisors when the PC cannot keep up, never below ~30 fps', () => {
    expect(fps(144, 1)).toBe(72);
    expect(fps(144, 9)).toBe(36);
    expect(fps(240, 1)).toBe(80);
    expect(fps(240, 2)).toBe(60);
    expect(fps(240, 9)).toBe(30);
    expect(fps(60, 1)).toBe(30);
    expect(fps(60, 3)).toBe(30);
    expect(autoFrameSteps(1 / 60)).toBe(1);
    expect(autoFrameSteps(1 / 144)).toBe(3); // 144 → 72 → 48 → 36
  });
});

describe('baked pose sampler', () => {
  // Synthetic bank shaped like the real one: 65 rotated bones, 2 translated, 4 clips.
  const NB = 65,
    NP = 2;
  const clip = (name: string, dur: number): BakedClip => {
    const frames = Math.ceil(dur * 30) + 1;
    const quat = new Float32Array(frames * NB * 4),
      pos = new Float32Array(frames * NP * 3);
    const q = new THREE.Quaternion();
    for (let f = 0; f < frames; f++)
      for (let b = 0; b < NB; b++) {
        q.setFromEuler(new THREE.Euler(Math.sin(f * 0.2 + b) * 0.5, Math.cos(f * 0.1 + b) * 0.3, 0));
        quat.set([q.x, q.y, q.z, q.w], (f * NB + b) * 4);
      }
    return { name, duration: dur, frames, quat, pos };
  };
  const bank: AnimationBank = {
    quatBones: Array.from({ length: NB }, (_, i) => `b${i}`),
    posBones: ['b0', 'b1'],
    quatRest: new Float32Array(NB * 4),
    posRest: new Float32Array(2 * 3),
    clips: new Map([
      ['a', clip('a', 1)],
      ['b', clip('b', 0.7)],
      ['c', clip('c', 2)],
      ['d', clip('d', 0.9)],
    ]),
  };

  it('blends correctly: a single clip at weight 1 reproduces its baked frame', () => {
    const bones = bank.quatBones.map(() => new THREE.Object3D());
    const s = new PoseSampler(bank, bones, [bones[0], bones[1]]);
    const a = new BakedAction(bank.clips.get('a')!);
    a.enabled = true;
    a.weight = 1;
    a.time = 10 / 30;
    s.apply([a]);
    const Q = bank.clips.get('a')!.quat;
    const o = (10 * NB + 7) * 4;
    const ref = new THREE.Quaternion(Q[o], Q[o + 1], Q[o + 2], Q[o + 3]);
    expect(bones[7].quaternion.angleTo(ref)).toBeLessThan(1e-3);
  });

  it('poses 22 players with 3 blended clips each well within the animation budget', () => {
    const players = Array.from({ length: 22 }, () => {
      const bones = bank.quatBones.map(() => new THREE.Object3D());
      const acts = [...bank.clips.values()].map((c) => new BakedAction(c));
      acts.slice(0, 3).forEach((a, i) => {
        a.enabled = true;
        a.weight = [0.5, 0.3, 0.2][i];
      });
      return { s: new PoseSampler(bank, bones, [bones[0], bones[1]]), acts };
    });
    for (let i = 0; i < 200; i++)
      for (const p of players) {
        p.acts.forEach((a) => {
          a.time = i / 60;
        });
        p.s.apply(p.acts);
      }
    // Best of 5 batches: other test files run in parallel and preempt this process; the fastest batch
    // measures the code, not the machine's load.
    const N = 120;
    let msPerFrame = Infinity;
    for (let b = 0; b < 5; b++) {
      const t0 = performance.now();
      for (let i = 0; i < N; i++)
        for (const p of players) {
          p.acts.forEach((a) => {
            a.time = (b * N + i) / 60;
          });
          p.s.apply(p.acts);
        }
      msPerFrame = Math.min(msPerFrame, (performance.now() - t0) / N);
    }
    summary('pose-sampler', `22 players × 3 clips: ${msPerFrame.toFixed(3)} ms/frame`);
    // Budget for ALL animation work is 1.5 ms/frame; the pose blend itself must be a small part of it.
    // (Measured ~0.15 ms alone; generous bound because test files run in parallel workers.)
    expect(msPerFrame).toBeLessThan(1.0);
  });
});
