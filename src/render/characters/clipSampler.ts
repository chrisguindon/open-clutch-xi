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

/**
 * Baked skeletal animation (replaces THREE.AnimationMixer for the footballers).
 *
 * Profiling showed the mixer was the largest source of per-frame garbage and a large part of the
 * animation CPU cost: every enabled action re-runs a keyframe search and property-mixer accumulation
 * for ~65 bone tracks per player per frame (boxed numbers in the interpolant search, generic
 * accumulate/apply paths). Our clip times are driven explicitly from the simulation, so none of the
 * mixer's scheduling features are needed.
 *
 * At load time every clip is sampled once at a fixed rate into flat Float32Arrays in a shared bone
 * order (bones without a track in a clip hold their rest pose). Per frame a pose is a weighted blend
 * of the active clips: an index computation, a lerp between two baked frames and a sign-aligned
 * quaternion accumulation per bone, written straight into the bones. No allocation.
 */
export const BAKE_RATE = 30;

/** One animation clip sampled at a fixed rate into flat typed arrays (no allocation when played back). */
export interface BakedClip {
  name: string;
  duration: number;
  frames: number;
  /** frames × bones × 4 (x, y, z, w) */
  quat: Float32Array;
  /** frames × posBones × 3 */
  pos: Float32Array;
}

/** Every baked clip, with the bone order shared by all of them and the rest pose they were baked on. */
export interface AnimationBank {
  /** Bones with rotation tracks in at least one clip (blend order). */
  quatBones: string[];
  /** Bones with position tracks in at least one clip. */
  posBones: string[];
  clips: Map<string, BakedClip>;
  /** Rest rotations (x, y, z, w per quatBone) of the skeleton the clips were baked on. */
  quatRest: Float32Array;
  /** Rest positions (x, y, z per posBone) of the skeleton the clips were baked on. */
  posRest: Float32Array;
}

/**
 * Per-body corrections that let clips baked on the reference skeleton drive another body with the same
 * joints but different proportions. The clips store *absolute* local rotations and translations (bone
 * lengths included), so without this the second body would be posed with the reference body's bone
 * lengths and rest angles: stretched limbs and a tilted head.
 *
 * - rotation: `q_body = q_clip · inverse(q_restRef) · q_restBody` (a constant right-multiply per bone);
 * - translation: `p_body = p_clip + (p_restBody − p_restRef)` (keeps the body's own bone lengths, while
 *   motion such as the pelvis bobbing in a run still comes from the clip).
 */
export interface Retarget {
  /** One correction quaternion (x, y, z, w) per quatBone. */
  q: Float32Array;
  /** One offset (x, y, z) per posBone. */
  p: Float32Array;
}

/**
 * Corrections for a body whose bones (in their rest pose) are `qBones` / `pBones`, matching the bank's
 * bone order. Returns null when the body *is* the reference (nothing to correct, so no per-frame cost).
 */
export function retargetFor(bank: AnimationBank, qBones: Array<THREE.Object3D | undefined>, pBones: Array<THREE.Object3D | undefined>): Retarget | null {
  const q = new Float32Array(bank.quatBones.length * 4);
  const p = new Float32Array(bank.posBones.length * 3);
  const ref = new THREE.Quaternion();
  const c = new THREE.Quaternion();
  let differs = false;
  qBones.forEach((bone, i) => {
    const o = i * 4;
    ref.set(bank.quatRest[o], bank.quatRest[o + 1], bank.quatRest[o + 2], bank.quatRest[o + 3]);
    if (bone) c.copy(ref).invert().multiply(bone.quaternion);
    else c.identity();
    if (1 - Math.abs(c.w) > 1e-6) differs = true;
    q.set([c.x, c.y, c.z, c.w], o);
  });
  pBones.forEach((bone, i) => {
    const o = i * 3;
    if (!bone) return;
    const dx = bone.position.x - bank.posRest[o],
      dy = bone.position.y - bank.posRest[o + 1],
      dz = bone.position.z - bank.posRest[o + 2];
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-6) differs = true;
    p.set([dx, dy, dz], o);
  });
  return differs ? { q, p } : null;
}

/** Minimal action: what the footballer drives each frame (time, weight, enabled). */
export class BakedAction {
  time = 0;
  weight = 0;
  enabled = false;
  constructor(readonly clip: BakedClip) {}
  getClip(): BakedClip {
    return this.clip;
  }
}

/** Bake every clip against the character's skeleton (run once at load). */
export function bakeAnimations(scene: THREE.Object3D, clips: Map<string, THREE.AnimationClip>): AnimationBank {
  const root = scene.clone(true);
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o);
  });
  const quatSet = new Set<string>(),
    posSet = new Set<string>();
  for (const c of clips.values()) {
    for (const t of c.tracks) {
      const dot = t.name.lastIndexOf('.');
      const bone = t.name.slice(0, dot),
        prop = t.name.slice(dot + 1);
      if (!bones.has(bone)) continue;
      if (prop === 'quaternion') quatSet.add(bone);
      else if (prop === 'position') posSet.add(bone);
    }
  }
  const quatBones = [...quatSet],
    posBones = [...posSet];
  const rest = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  for (const [n, b] of bones) rest.set(n, { q: b.quaternion.clone(), p: b.position.clone() });
  const mixer = new THREE.AnimationMixer(root);
  const quatRest = new Float32Array(quatBones.length * 4);
  quatBones.forEach((n, i) => {
    const q = rest.get(n)!.q;
    quatRest.set([q.x, q.y, q.z, q.w], i * 4);
  });
  const posRest = new Float32Array(posBones.length * 3);
  posBones.forEach((n, i) => {
    const p = rest.get(n)!.p;
    posRest.set([p.x, p.y, p.z], i * 3);
  });
  const out = new Map<string, BakedClip>();
  for (const [name, clip] of clips) {
    const frames = Math.max(2, Math.ceil(clip.duration * BAKE_RATE) + 1);
    const quat = new Float32Array(frames * quatBones.length * 4);
    const pos = new Float32Array(frames * posBones.length * 3);
    const action = mixer.clipAction(clip);
    action.play();
    // Warm-up: three's first evaluation after activating an action differs from steady state
    // (it showed up as a wrong frame 0 → a pose glitch at every loop seam).
    mixer.setTime(clip.duration * 0.5);
    for (let f = 0; f < frames; f++) {
      for (const [n, r] of rest) {
        const b = bones.get(n)!;
        b.quaternion.copy(r.q);
        b.position.copy(r.p);
      }
      // (Frame 0 sampled just after t = 0: at the exact seam of a non-seamless loop three may return either end.)
      mixer.setTime(Math.min(clip.duration, Math.max(1e-4, f / BAKE_RATE)));
      quatBones.forEach((n, i) => {
        const q = bones.get(n)!.quaternion;
        quat.set([q.x, q.y, q.z, q.w], (f * quatBones.length + i) * 4);
      });
      posBones.forEach((n, i) => {
        const p = bones.get(n)!.position;
        pos.set([p.x, p.y, p.z], (f * posBones.length + i) * 3);
      });
    }
    action.stop();
    mixer.uncacheAction(clip);
    out.set(name, { name, duration: clip.duration, frames, quat, pos });
  }
  return { quatBones, posBones, clips: out, quatRest, posRest };
}

/** Per-character pose evaluator. */
export class PoseSampler {
  private qAcc: Float32Array;
  private pAcc: Float32Array;
  /**
   * @param retarget - corrections for a body other than the one the clips were baked on
   *   (from {@link retargetFor}); null for the reference body
   */
  constructor(
    private bank: AnimationBank,
    private qBones: Array<THREE.Object3D | undefined>,
    private pBones: Array<THREE.Object3D | undefined>,
    private retarget: Retarget | null = null,
  ) {
    this.qAcc = new Float32Array(bank.quatBones.length * 4);
    this.pAcc = new Float32Array(bank.posBones.length * 3);
  }

  /** Blend the enabled actions (weights assumed normalised) and write the pose into the bones. */
  apply(actions: readonly BakedAction[]): void {
    const nq = this.bank.quatBones.length,
      np = this.bank.posBones.length;
    const qa = this.qAcc,
      pa = this.pAcc;
    qa.fill(0);
    pa.fill(0);
    let total = 0;
    for (let k = 0; k < actions.length; k++) {
      const a = actions[k];
      const w = a.weight;
      if (!a.enabled || w <= 0) continue;
      const c = a.clip;
      let t = a.time % c.duration;
      if (t < 0) t += c.duration;
      const u = t * BAKE_RATE;
      const i0 = Math.min(c.frames - 1, Math.floor(u));
      const i1 = Math.min(c.frames - 1, i0 + 1);
      const f = u - i0;
      const Q = c.quat,
        b0 = i0 * nq * 4,
        b1 = i1 * nq * 4;
      for (let b = 0; b < nq; b++) {
        const o = b * 4;
        let x1 = Q[b1 + o],
          y1 = Q[b1 + o + 1],
          z1 = Q[b1 + o + 2],
          w1 = Q[b1 + o + 3];
        const x0 = Q[b0 + o],
          y0 = Q[b0 + o + 1],
          z0 = Q[b0 + o + 2],
          w0 = Q[b0 + o + 3];
        if (x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1 < 0) {
          x1 = -x1;
          y1 = -y1;
          z1 = -z1;
          w1 = -w1;
        }
        const x = x0 + (x1 - x0) * f,
          y = y0 + (y1 - y0) * f,
          z = z0 + (z1 - z0) * f,
          ww = w0 + (w1 - w0) * f;
        // Keep every contribution in the same hemisphere as the accumulator.
        const s = qa[o] * x + qa[o + 1] * y + qa[o + 2] * z + qa[o + 3] * ww < 0 ? -w : w;
        qa[o] += x * s;
        qa[o + 1] += y * s;
        qa[o + 2] += z * s;
        qa[o + 3] += ww * s;
      }
      const P = c.pos,
        p0 = i0 * np * 3,
        p1 = i1 * np * 3;
      for (let b = 0; b < np * 3; b++) pa[b] += (P[p0 + b] + (P[p1 + b] - P[p0 + b]) * f) * w;
      total += w;
    }
    if (total <= 0) return;
    for (let b = 0; b < nq; b++) {
      const bone = this.qBones[b];
      if (!bone) continue;
      const o = b * 4;
      const l = Math.sqrt(qa[o] * qa[o] + qa[o + 1] * qa[o + 1] + qa[o + 2] * qa[o + 2] + qa[o + 3] * qa[o + 3]) || 1;
      const x = qa[o] / l,
        y = qa[o + 1] / l,
        z = qa[o + 2] / l,
        w = qa[o + 3] / l;
      const R = this.retarget?.q;
      if (R) {
        // q · c (Hamilton product), written out to stay allocation-free.
        const cx = R[o],
          cy = R[o + 1],
          cz = R[o + 2],
          cw = R[o + 3];
        bone.quaternion.set(
          w * cx + x * cw + y * cz - z * cy,
          w * cy - x * cz + y * cw + z * cx,
          w * cz + x * cy - y * cx + z * cw,
          w * cw - x * cx - y * cy - z * cz,
        );
      } else bone.quaternion.set(x, y, z, w);
    }
    const inv = 1 / total;
    const P = this.retarget?.p;
    for (let b = 0; b < np; b++) {
      const bone = this.pBones[b];
      if (!bone) continue;
      const o = b * 3;
      if (P) bone.position.set(pa[o] * inv + P[o], pa[o + 1] * inv + P[o + 1], pa[o + 2] * inv + P[o + 2]);
      else bone.position.set(pa[o] * inv, pa[o + 1] * inv, pa[o + 2] * inv);
    }
  }
}
