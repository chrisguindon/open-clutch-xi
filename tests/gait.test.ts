/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Gait: legs must cycle so that a stride covers the distance travelled (no foot skating). These tests
// check the pure gait table, and re-measure the real animation clips so the table can't silently
// drift from the art.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GAIT_KEYS, STRIDE_LENGTH, cadence, gaitWeights, strideLength } from '../src/sim/gait';

describe('gait table', () => {
  it('weights are non-negative and sum to one at every speed', () => {
    const w: [number, number, number, number] = [0, 0, 0, 0];
    for (let sp = 0; sp <= 10; sp += 0.05) {
      gaitWeights(sp, w);
      expect(w.every((x) => x >= 0)).toBe(true);
      expect(w[0] + w[1] + w[2] + w[3]).toBeCloseTo(1, 9);
    }
  });

  it('each style plays alone at its key speed', () => {
    const w: [number, number, number, number] = [0, 0, 0, 0];
    GAIT_KEYS.forEach((k, i) => expect(gaitWeights(k, w)[i]).toBeCloseTo(1, 9));
  });

  it('cadence keeps distance per cycle equal to the stride length (no skating)', () => {
    for (const sp of [0.5, 1.9, 3, 4, 5.4, 7, 8.1]) expect(sp / cadence(sp)).toBeCloseTo(strideLength(sp), 9);
  });

  it('cadence is zero when standing and rises smoothly to a sprint', () => {
    expect(cadence(0)).toBe(0);
    let prev = cadence(0.2);
    for (let sp = 0.3; sp <= 8.1; sp += 0.1) {
      const c = cadence(sp);
      expect(Math.abs(c - prev)).toBeLessThan(0.12); // no visible jumps in leg tempo
      prev = c;
    }
    expect(cadence(8.1)).toBeGreaterThan(1.4);
    expect(cadence(8.1)).toBeLessThan(1.8);
  });
});

describe('stride lengths match the animation clips', () => {
  it('measured planted-foot travel per cycle agrees with STRIDE_LENGTH within 12%', async () => {
    (globalThis as { self?: unknown }).self ??= globalThis; // the meshopt decoder expects a browser global
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    await MeshoptDecoder.ready;
    const load = (file: string) =>
      new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const b = readFileSync(file);
        loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '', resolve, reject);
      });
    const body = await load('public/assets/player.glb');
    const anims = await load('public/assets/anims.glb');
    const mixer = new THREE.AnimationMixer(body.scene);
    const foot = body.scene.getObjectByName('foot_l')!;
    const p = new THREE.Vector3();
    const clips = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'];
    for (let c = 0; c < clips.length; c++) {
      const clip = anims.animations.find((a) => a.name === clips[c])!;
      const action = mixer.clipAction(clip);
      action.play();
      const N = 120;
      const ys: number[] = [],
        zs: number[] = [];
      for (let i = 0; i < N; i++) {
        action.time = (i / N) * clip.duration;
        mixer.update(0);
        body.scene.updateMatrixWorld(true);
        foot.getWorldPosition(p);
        ys.push(p.y);
        zs.push(p.z);
      }
      action.stop();
      // Stance = the quarter of the cycle where the foot is lowest; its backward speed there, times
      // one cycle, is how far the body travels per stride while that foot is planted.
      const yCut = [...ys].sort((a, b) => a - b)[Math.floor(N * 0.25)];
      const travel: number[] = [];
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        if (ys[i] <= yCut && ys[j] <= yCut) travel.push((zs[i] - zs[j]) * N);
      }
      travel.sort((a, b) => a - b);
      const measured = travel[Math.floor(travel.length / 2)];
      expect(Math.abs(measured / STRIDE_LENGTH[c + 1] - 1), `${clips[c]} measured ${measured.toFixed(2)} m`).toBeLessThan(0.12);
    }
  }, 120_000);
});
