/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { loadCharacterAssets } from '../render/characters/assets';
import { BakedAction, PoseSampler } from '../render/characters/clipSampler';

/** Dev check: max bone-rotation difference (degrees) between THREE.AnimationMixer and the baked sampler, per clip. */
export async function compareAnimations(): Promise<Record<string, number>> {
  const assets = await loadCharacterAssets(() => undefined);
  const a = skClone(assets.body.scene),
    b = skClone(assets.body.scene);
  const bonesA = new Map<string, THREE.Object3D>(),
    bonesB = new Map<string, THREE.Object3D>();
  a.traverse((o) => {
    if ((o as THREE.Bone).isBone) bonesA.set(o.name, o);
  });
  b.traverse((o) => {
    if ((o as THREE.Bone).isBone) bonesB.set(o.name, o);
  });
  const rest = new Map<string, THREE.Quaternion>();
  for (const [n, o] of bonesA) rest.set(n, o.quaternion.clone());
  const bank = assets.bank;
  const sampler = new PoseSampler(
    bank,
    bank.quatBones.map((n) => bonesB.get(n)),
    bank.posBones.map((n) => bonesB.get(n)),
  );
  const out: Record<string, number> = {};
  for (const [name, clip] of assets.clips) {
    // Fresh mixer + skeleton per clip (no state carried between clips).
    const fresh = skClone(assets.body.scene);
    bonesA.clear();
    fresh.traverse((o) => {
      if ((o as THREE.Bone).isBone) bonesA.set(o.name, o);
    });
    const mixer = new THREE.AnimationMixer(fresh);
    const act = mixer.clipAction(clip);
    act.play();
    act.timeScale = 0;
    act.time = 0.5;
    mixer.update(0); // warm-up: three's first evaluation after activation differs
    const ba = new BakedAction(bank.clips.get(name)!);
    ba.enabled = true;
    ba.weight = 1;
    let worst = 0;
    const detail: string[] = [];
    for (const t of (globalThis as unknown as { __times?: (d: number) => number[] }).__times?.(clip.duration) ?? [
      0.13,
      clip.duration * 0.37,
      clip.duration * 0.71,
    ]) {
      for (const [n, q] of rest) bonesA.get(n)!.quaternion.copy(q); // in game, untracked bones sit at rest
      act.time = t;
      act.weight = 1;
      mixer.update(0);
      ba.time = t;
      sampler.apply([ba]);
      for (const n of bank.quatBones) {
        const qa = bonesA.get(n)!.quaternion,
          qb = bonesB.get(n)!.quaternion;
        const d = THREE.MathUtils.radToDeg(qa.angleTo(qb));
        if (d > 5) detail.push(`${t.toFixed(2)}/${clip.duration.toFixed(2)} ${n} ${d.toFixed(0)}`);
        worst = Math.max(worst, d);
      }
    }
    act.stop();
    out[name] = Math.round(worst * 100) / 100;
    if (detail.length)
      (out as Record<string, unknown>)[name + '_detail'] =
        detail.slice(0, 6).join(' | ') + ` (tracks ${clip.tracks.length}, frames ${bank.clips.get(name)!.frames})`;
  }
  return out;
}
