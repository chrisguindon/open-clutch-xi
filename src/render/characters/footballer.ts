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
 * One skinned footballer on screen. Locomotion clips are blended by gait phase so the feet plant
 * where the simulation's touches happen. Procedural layers then add what clips can't know: the
 * kicking foot, tackles, headers, keeper reach and dives, leaning, and celebration gestures. The
 * simulation decides every action; this file only shows it (see docs/gameplay/animation.md).
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Anim } from '../../sim/player';
import { KICK_TIMING } from '../../sim/config';
import { gaitWeights } from '../../sim/gait';
import { Lean, bodyLean } from './lean';
import { BakedAction, PoseSampler, retargetFor } from './clipSampler';
import { clamp, lerp, smoothstep } from '../../core/math';
import { CharacterAssets } from './assets';
import { KitSpec, createKitMaterial } from './kitMaterial';
import type { BodyType } from './assets';
import type { HairStyle } from './squad';
import type { PoseInput } from '../playerModel';

/**
 * How one player looks. Chosen by the renderer (matchView.ts) and never read by the simulation:
 * body, skin, hair, height and build are presentation only, so they can't change how anyone plays.
 */
export interface Appearance {
  /** Which base body to draw ('m' or 'f'; see CharacterAssets.bodies). */
  body: BodyType;
  skin: 'light' | 'dark';
  /** Multiplies the skin texture for in-between tones. */
  skinTint: string;
  hair: HairStyle;
  beard: boolean;
  hairColour: string;
  height: number;
  build: number;
}

/** Shared interface implemented by both the skinned footballer and the procedural fallback rig. */
export interface PlayerVisual {
  readonly root: THREE.Object3D;
  update(s: PoseInput, dt: number, camDist: number): void;
  setShadows(on: boolean): void;
  dispose(): void;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
/** Beyond this camera distance the skeleton animates at 30 Hz (cost saving for far-away players only). */
const ANIM_SKIP_DIST = 75;
const LOCO_NAMES: ClipName[] = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'];
const LOD_DIST = [16, 46];

/**
 * Gesture codes: players' (shared with src/sim/celebration.ts) and match officials' signals (20+).
 */
export const OG = {
  ArmsUp: 1,
  FistPump: 2,
  CornerRun: 3,
  Huddle: 4,
  Restrained: 5,
  Yes: 6,
  Teammate: 7,
  HandsOnHead: 10,
  Applaud: 11,
  HandsOnHips: 12,
  PointSky: 13,
  Whistle: 20,
  Point: 21,
  Indirect: 22,
  Advantage: 23,
  Card: 24,
  FlagUp: 30,
  FlagDirection: 32,
  FlagLevel: 33,
  FlagDown: 34,
} as const;

const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qC = new THREE.Quaternion();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const vT = new THREE.Vector3();
/** Scratch target for {@link bodyLean}, shared by all footballers (used and consumed within one update). */
const leanTarget: Lean = { pitch: 0, roll: 0 };
/** Height (m) of the body's pivot above the feet: about the hips, where dives roll. */
const PIVOT_HEIGHT = 0.95;
const mA = new THREE.Matrix4();
// Two-bone arm solver scratch (kept separate: aim() reuses vA–vC and vT internally).
const ikS = new THREE.Vector3();
const ikE = new THREE.Vector3();
const ikH = new THREE.Vector3();
const ikT = new THREE.Vector3();
const ikP = new THREE.Vector3();
const ikD = new THREE.Vector3();
const mRootFromModel = new THREE.Matrix4();
const mModelFromRoot = new THREE.Matrix4();

/**
 * A celebration or reaction arm pose, relative to that arm's shoulder in the character's own frame.
 * `out` is away from the body (to the character's left for the left arm, right for the right arm),
 * `up` is up and `fwd` is forwards. Units are **arm lengths**, so a pose fits every player whatever
 * their height or body, and a length below 1 always leaves the elbow a little bent.
 */
interface ArmPose {
  hand: readonly [out: number, up: number, fwd: number];
  /** Which way the elbow points (same axes; only the direction matters). */
  elbow: readonly [out: number, up: number, fwd: number];
}

/** Seconds for a gesture to blend in, and to blend out when it ends. Eased, so arms never snap. */
const GESTURE_IN = 0.32;
const GESTURE_OUT = 0.28;
/** Smooth 0→1→ easing used for blends and strokes. */
const ease = (u: number): number => {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
};

type ClipName =
  | 'Idle_Loop'
  | 'Walk_Loop'
  | 'Jog_Fwd_Loop'
  | 'Sprint_Loop'
  | 'Crouch_Idle_Loop'
  | 'Jump_Start'
  | 'Jump_Loop'
  | 'Jump_Land'
  | 'Hit_Chest'
  | 'Death01'
  | 'Dance_Loop'
  | 'Roll'
  | 'Slide_Start'
  | 'Slide_Loop'
  | 'Slide_Exit'
  | 'OverhandThrow'
  | 'Yes'
  | 'Idle_No_Loop'
  | 'Hit_Knockback'
  | 'LayToIdle';

/**
 * A skinned CC0 footballer: kit shader, hair/appearance variation, LODs, an AnimationMixer
 * blending real locomotion clips on the simulation's gait phase, clip-driven actions mapped
 * from simulation time, and model-space procedural layers for football-specific actions.
 * Visuals follow the simulation: nothing here can delay or alter gameplay.
 */
export class Footballer implements PlayerVisual {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private model: THREE.Object3D;
  private bones = new Map<string, THREE.Bone>();
  private lods: THREE.SkinnedMesh[] = [];
  private faceParts: THREE.Object3D[] = [];
  private hairMeshes: THREE.SkinnedMesh[] = [];
  private sampler: PoseSampler;
  private actions = new Map<ClipName, BakedAction>();
  /** Action slots: index per clip, target / current blend weights. */
  private slot = new Map<ClipName, number>();
  private actionList: BakedAction[] = [];
  private targetW = new Float32Array(0);
  private curW = new Float32Array(0);
  private lod = 0;
  private skipAccum = 0;
  private time = Math.random() * 10;
  private roll = 0;
  /** Smoothed body lean (radians) from {@link bodyLean}. */
  private lean: Lean = { pitch: 0, roll: 0 };
  private materials: THREE.Material[] = [];

  constructor(
    private assets: CharacterAssets,
    kit: KitSpec,
    atlas: THREE.Texture,
    cell: number,
    look: Appearance,
    seed: number,
  ) {
    // The requested body, or the reference body if that one failed to load.
    const bodyAssets = assets.bodies[look.body] ?? assets.bodies.m;
    this.model = SkeletonUtils.clone(bodyAssets.gltf.scene);
    // Each character starts its looping reactions at a different point, so team-mates never move in unison.
    this.loopOffset = ((seed * 0.6180339) % 1) * 3;
    this.pivot.position.y = PIVOT_HEIGHT;
    this.model.position.y = -PIVOT_HEIGHT;
    this.model.scale.set(look.build, look.height, look.build);
    this.pivot.add(this.model);
    this.root.add(this.pivot);

    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    let bodyParent: THREE.Object3D | null = null;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.frustumCulled = false;
      if (o.name.startsWith('Body_LOD')) {
        const idx = Number(o.name.slice(-1));
        this.lods[idx] = m;
        bodyParent = m.parent;
      } else {
        this.faceParts.push(m);
      }
    });
    // One skeleton per player: SkeletonUtils.clone gives every skinned mesh its own Skeleton, and each
    // visible skeleton recomputes 65 bone matrices and re-uploads its bone texture every frame.
    // All of this character's meshes use the same joints and bind pose, so they share the body's.
    const shared = this.lods[0].skeleton;
    for (const m of [...this.lods.slice(1), ...this.faceParts] as THREE.SkinnedMesh[]) {
      if (
        m &&
        m.skeleton !== shared &&
        sameSkeleton(
          m.skeleton.bones.map((b) => b.name),
          m.skeleton,
          shared,
        )
      )
        m.bind(shared, m.bindMatrix);
    }
    // Kit material on all body LODs; hair-coloured eyebrows.
    const srcMat = this.lods[0].material as THREE.MeshStandardMaterial;
    const skinMap = look.skin === 'light' ? bodyAssets.skins.light : bodyAssets.skins.dark;
    const kitMat = createKitMaterial(srcMat, kit, atlas, cell, skinMap, new THREE.Color(look.skinTint), {
      body: bodyAssets.fit,
      reference: assets.bodies.m.fit,
    });
    this.materials.push(kitMat);
    for (const l of this.lods) if (l) l.material = kitMat;
    for (const f of this.faceParts) {
      if (f.name === 'Eyebrows') {
        const m = ((f as THREE.Mesh).material as THREE.MeshStandardMaterial).clone();
        m.color.set(look.hairColour);
        (f as THREE.Mesh).material = m;
        this.materials.push(m);
      }
    }
    // Hair: rebind the hairstyle meshes to this player's skeleton.
    const styles = [look.hair, look.beard ? 'Hair_Beard' : null].filter(Boolean) as string[];
    for (const style of styles) {
      const src = assets.hair.get(style); // exact name: "Hair_Buzzed" must not match "Hair_BuzzedFemale"
      if (!src || !bodyParent) continue;
      const mat = (src.material as THREE.MeshStandardMaterial).clone();
      mat.color.set(look.hairColour);
      this.materials.push(mat);
      const mesh = new THREE.SkinnedMesh(src.geometry, mat);
      mesh.name = style;
      (bodyParent as THREE.Object3D).add(mesh);
      const body = this.lods[0].skeleton;
      // Real bone names (the loader renames duplicates in merged files; see assets.ts).
      const names: string[] = (src.userData.boneNames as string[] | undefined) ?? src.skeleton.bones.map((b) => b.name);
      if (sameSkeleton(names, src.skeleton, body)) {
        mesh.bind(body, src.bindMatrix);
      } else if (sameJoints(names, body)) {
        // Same joints, different proportions (another base body). The hairstyles are rigged to the head
        // bone alone, so moving them from the reference head to this body's head is one matrix:
        // bind' = inverse(bodyHeadInverse) · hairHeadInverse · bind. Sharing the body's skeleton this way
        // avoids a second skeleton (and bone-texture upload) per hair mesh every frame.
        const head = body.bones.findIndex((b) => b.name === 'Head');
        const fix = body.boneInverses[head].clone().invert().multiply(src.skeleton.boneInverses[head]);
        mesh.bind(body, fix.multiply(src.bindMatrix));
      } else {
        const bones = names.map((n, i) => this.bones.get(n) ?? src.skeleton.bones[i]);
        mesh.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
      }
      mesh.frustumCulled = false;
      this.hairMeshes.push(mesh);
    }

    const bank = assets.bank;
    const qBones = bank.quatBones.map((n) => this.bones.get(n));
    const pBones = bank.posBones.map((n) => this.bones.get(n));
    // Measured now, while the cloned skeleton is still in its rest pose.
    this.sampler = new PoseSampler(bank, qBones, pBones, retargetFor(bank, qBones, pBones));
    for (const [name, clip] of bank.clips) {
      const a = new BakedAction(clip);
      this.actions.set(name as ClipName, a);
      this.slot.set(name as ClipName, this.actionList.length);
      this.actionList.push(a);
    }
    this.relaxHands();
    this.setLOD(0);
  }

  setShadows(on: boolean): void {
    for (const l of this.lods) if (l) l.castShadow = on;
    // Hair does not cast: an extra shadow-pass draw per player for a few pixels of shadow.
    for (const h of this.hairMeshes) h.castShadow = false;
  }

  private setLOD(i: number): void {
    this.lod = i;
    this.lods.forEach((l, k) => {
      if (l) l.visible = k === i;
    });
    for (const f of this.faceParts) f.visible = i === 0;
  }

  /** Fingers aren't animated (tracks stripped): give the hands a natural, slightly curled pose once. */
  private relaxHands(): void {
    for (const side of ['l', 'r']) {
      for (const f of ['index', 'middle', 'ring', 'pinky']) {
        for (let k = 1; k <= 3; k++) this.bones.get(`${f}_0${k}_${side}`)?.rotateZ(side === 'l' ? -0.55 : -0.55);
      }
      this.bones.get(`thumb_02_${side}`)?.rotateZ(-0.3);
    }
  }

  // ------------------------------------------------------------------ model-space helpers

  /**
   * Rotation of an object expressed in the character's model frame, computed from the chain of
   * local quaternions (no matrix updates — this runs several times per player per frame).
   */
  private modelQuat(o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    let n: THREE.Object3D | null = o;
    while (n && n !== this.model) {
      out.premultiply(n.quaternion);
      n = n.parent;
    }
    return out;
  }
  private matricesDirty = true;
  /** World matrices are only needed for position-based aiming; update lazily. */
  private ensureMatrices(): void {
    if (!this.matricesDirty) return;
    this.root.updateMatrixWorld(true);
    this.matricesDirty = false;
  }

  /** Rotate a bone by `angle` about an axis given in the character's model frame. */
  private rot(name: string, axis: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < 1e-4) return;
    const b = this.bones.get(name);
    if (!b || !b.parent) return;
    this.modelQuat(b.parent, qA);
    vA.copy(axis).applyQuaternion(qB.copy(qA).invert());
    b.quaternion.premultiply(qC.setFromAxisAngle(vA, angle));
    this.matricesDirty = true;
  }

  /** Aim a bone chain segment (bone → child) at a target point in the model frame, with blend weight. */
  private aim(boneName: string, childName: string, target: THREE.Vector3, w: number): void {
    const b = this.bones.get(boneName),
      c = this.bones.get(childName);
    if (!b || !c || !b.parent || w <= 0) return;
    // Copy the target first: callers pass shared scratch vectors (vB, vC) that are reused below.
    // (Previously, a target passed as vB was overwritten, so keepers' hands never reached for the ball.)
    vT.copy(target);
    this.ensureMatrices();
    mA.copy(this.model.matrixWorld).invert();
    b.getWorldPosition(vA).applyMatrix4(mA);
    c.getWorldPosition(vB).applyMatrix4(mA);
    vB.sub(vA).normalize();
    vC.copy(vT).sub(vA).normalize();
    qC.setFromUnitVectors(vB, vC);
    qC.slerp(qA.identity(), 1 - w);
    // Model-space rotation → bone local.
    this.modelQuat(b.parent, qA);
    qB.copy(qA).invert().multiply(qC).multiply(qA);
    b.quaternion.premultiply(qB);
    this.matricesDirty = true;
  }

  private setTarget(name: ClipName, w: number): void {
    const i = this.slot.get(name);
    if (i !== undefined && w > this.targetW[i]) this.targetW[i] = w;
  }

  private loopOffset = 0;

  // ------------------------------------------------------------------ per-frame

  /** Benchmark toggle: force the lowest LOD and hide hair/face (measures the cost of full models). */
  simplified = false;
  /** Benchmark toggle: keep LOD selection but skip pose evaluation (measures animation cost). */
  frozen = false;

  update(s: PoseInput, dt: number, camDist: number): void {
    this.time += dt;
    this.lastPose = s;
    const want = this.simplified ? 2 : camDist < LOD_DIST[0] ? 0 : camDist < LOD_DIST[1] ? 1 : 2;
    for (const h of this.hairMeshes) h.visible = !this.simplified;
    if (want !== this.lod) this.setLOD(want);
    if (this.frozen) return;
    // Animation LOD: only very distant players (rare: beyond the far touchline in 11v11) animate at a
    // reduced rate. (the previous 46 m threshold made most far-side players stutter at 30 Hz
    // in the broadcast view while their bodies moved at full frame rate.)
    if (camDist > ANIM_SKIP_DIST) {
      this.skipAccum += dt;
      if (this.skipAccum < 1 / 30) return;
      dt = this.skipAccum;
      this.skipAccum = 0;
    }

    this.gestureDt = dt;
    if (this.targetW.length !== this.actionList.length) {
      this.targetW = new Float32Array(this.actionList.length);
      this.curW = new Float32Array(this.actionList.length);
    }
    this.targetW.fill(0);
    const t = s.animTime;
    const loco = this.locomotionWeights(s);
    // Locomotion weights already follow the simulated speed (which ramps with acceleration); smoothing
    // them again at 12/s (~190 ms to 90%) made the body visibly trail the motion. 20/s ≈ 115 ms.
    let rate = 20;

    // Clip-driven actions follow simulation time exactly.
    switch (s.anim) {
      case Anim.Slide: {
        rate = 25;
        const st = this.actions.get('Slide_Start')!,
          lp = this.actions.get('Slide_Loop')!,
          ex = this.actions.get('Slide_Exit')!;
        if (t < 0.22) {
          st.time = (t / 0.22) * st.getClip().duration;
          this.setTarget('Slide_Start', 1);
        } else if (t < 0.78) {
          lp.time = ((t - 0.22) * 1.2) % lp.getClip().duration;
          this.setTarget('Slide_Loop', 1);
        } else {
          ex.time = clamp((t - 0.78) / 0.22, 0, 1) * ex.getClip().duration * 0.98;
          this.setTarget('Slide_Exit', 1);
        }
        break;
      }
      case Anim.Stumble: {
        rate = 20;
        const a = this.actions.get('Hit_Chest')!;
        a.time = clamp(t / 0.5, 0, 1) * a.getClip().duration * 0.9;
        this.setTarget('Hit_Chest', 0.9);
        this.applyLoco(loco, 0.1);
        break;
      }
      case Anim.Fallen: {
        rate = 16;
        const kb = this.actions.get('Hit_Knockback')!,
          up = this.actions.get('LayToIdle')!;
        if (t < 0.85) {
          kb.time = clamp(t / 0.85, 0, 1) * kb.getClip().duration * 0.97;
          this.setTarget('Hit_Knockback', 1);
        } else {
          up.time = clamp((t - 0.85) / 0.6, 0, 1) * up.getClip().duration * 0.98;
          this.setTarget('LayToIdle', 1);
        }
        break;
      }
      case Anim.Throw: {
        rate = 24;
        const a = this.actions.get('OverhandThrow')!;
        const d = a.getClip().duration;
        a.time = lerp(d * 0.4, d * 0.95, clamp(t / 0.45, 0, 1));
        this.setTarget('OverhandThrow', 1);
        break;
      }
      case Anim.Header:
      case Anim.Dive: {
        rate = 20;
        if (s.y > 0.03 || t < 0.25) {
          const a = this.actions.get('Jump_Loop')!;
          a.time = (this.time * 0.8) % a.getClip().duration;
          this.setTarget('Jump_Loop', 1);
        } else {
          this.applyLoco(loco, 1);
        }
        break;
      }
      default: {
        this.applyLoco(loco, 1);
        // Moods: celebrating on the spot / dejected.
        // Celebrating on the spot: the style comes from the simulation (s.gesture). Arm gestures (arms up,
        // fist pump, restrained) are layered procedurally over the idle; the others use the "Yes" clip.
        const g = s.gesture ?? 0;
        const procedural = g === OG.ArmsUp || g === OG.FistPump || g === OG.Restrained || g === OG.PointSky || g === OG.Applaud;
        const dejectedPose = g === OG.HandsOnHead || g === OG.HandsOnHips;
        if (s.mood === 1 && s.speed < 1.5 && !procedural) {
          const a = this.actions.get('Yes')!;
          a.time = (this.time * (0.8 + (this.loopOffset % 0.3)) + this.loopOffset) % a.getClip().duration;
          this.clearLocoTargets();
          this.setTarget('Yes', 1);
        } else if (s.mood === 2 && s.speed < 1.5 && !dejectedPose) {
          const a = this.actions.get('Idle_No_Loop')!;
          a.time = (this.time * 0.7 + this.loopOffset) % a.getClip().duration;
          this.clearLocoTargets();
          this.setTarget('Idle_No_Loop', 1);
        } else if (s.isGK && s.anim === Anim.GkReady && s.speed < 2.5 && !s.hasBall) {
          // Goalkeeper set position: blend towards a crouched stance.
          const a = this.actions.get('Crouch_Idle_Loop')!;
          a.time = (this.time * 0.5) % a.getClip().duration;
          this.setTarget('Crouch_Idle_Loop', 0.4);
        }
      }
    }

    // Smooth weight transitions (cross-fades), then evaluate the mixer. Weights are normalised to sum
    // to 1: three.js blends any missing weight towards the bind (T-) pose, which showed up as arms
    // briefly lifting during transitions, and over-weighting exaggerated poses.
    const k = 1 - Math.exp(-rate * dt);
    let total = 0;
    // (Typed arrays rather than Map iteration: no per-frame garbage.)
    const tw = this.targetW,
      cw = this.curW,
      list = this.actionList;
    for (let i = 0; i < list.length; i++) {
      const w = cw[i] + (tw[i] - cw[i]) * k;
      cw[i] = w;
      total += w;
    }
    const norm = total > 0.01 ? 1 / total : 0;
    for (let i = 0; i < list.length; i++) {
      const w = cw[i] * norm;
      const a = list[i];
      a.enabled = w > 0.002;
      a.weight = w;
    }
    if (total <= 0.01) {
      const idle = this.actions.get('Idle_Loop')!;
      idle.enabled = true;
      idle.weight = 1;
    }
    this.sampler.apply(this.actionList);

    // Procedural layers in the model frame.
    this.matricesDirty = true;
    this.overlays(s, dt);
  }

  private clearLocoTargets(): void {
    for (const n of LOCO_NAMES) {
      const i = this.slot.get(n);
      if (i !== undefined) this.targetW[i] = 0;
    }
  }

  /** Blend weights for idle / walk / jog / sprint by speed (shared with the simulation's gait, {@link gaitWeights}). */
  private locomotionWeights(s: PoseInput): [number, number, number, number] {
    // Damp the legs during on-the-spot actions so kicks read clearly.
    let sp = s.speed;
    if (s.anim === Anim.Kick || s.anim === Anim.Pass || s.anim === Anim.Tackle) sp = Math.min(sp, 2.2);
    return gaitWeights(sp, this.locoW);
  }
  private readonly locoW: [number, number, number, number] = [0, 0, 0, 0];

  /** Apply locomotion targets with clip times driven by the simulation gait phase. */
  private applyLoco(w: [number, number, number, number], scale: number): void {
    const names: ClipName[] = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'];
    const s = this.lastPose;
    const backwards = s ? s.fwd < -0.3 && s.speed > 0.4 : false;
    const ph = s ? s.gait : 0;
    for (let i = 0; i < 4; i++) {
      const a = this.actions.get(names[i]);
      if (!a) continue;
      const d = a.getClip().duration;
      if (i === 0) {
        a.time = (this.time * 0.8) % d;
      } else {
        // Left foot forward at sin(phase) = 1 (phase π/2), matching the simulation.
        const off = this.assets.leftFootForward.get(names[i]) ?? 0;
        let f = ((backwards ? Math.PI / 2 - ph : ph - Math.PI / 2) / (Math.PI * 2)) % 1;
        if (f < 0) f += 1;
        a.time = (off + f * d) % d;
      }
      this.setTarget(names[i], w[i] * scale);
    }
  }

  private lastPose: PoseInput | null = null;

  private overlays(s: PoseInput, dt: number): void {
    this.lastPose = s;
    const t = s.animTime;
    const spd = Math.max(0.01, s.speed);

    // Strafing / backpedalling: twist the hips towards the direction of travel, keep the chest facing.
    if (s.speed > 0.5 && s.anim !== Anim.Slide && s.anim !== Anim.Dive && s.anim !== Anim.Fallen) {
      const lat = s.lat / spd,
        fwd = s.fwd / spd;
      const yaw = clamp(Math.atan2(lat, Math.abs(fwd)), -1.1, 1.1) * Math.min(1, s.speed / 1.5);
      this.rot('pelvis', Y, yaw);
      this.rot('spine_01', Y, -yaw * 0.55);
      this.rot('spine_02', Y, -yaw * 0.45);
    }

    // Dribble touch: the touching foot reaches forward to the ball.
    if (s.touchAge < 0.24 && s.hasBall && s.anim === Anim.Locomotion) {
      const bump = Math.sin(Math.PI * clamp(s.touchAge / 0.24, 0, 1));
      const side = s.touchFoot > 0 ? 'l' : 'r';
      this.rot(`thigh_${side}`, X, -0.35 * bump);
      this.rot(`calf_${side}`, X, -0.25 * bump);
    }

    switch (s.anim) {
      case Anim.Kick:
      case Anim.Pass: {
        const shot = s.anim === Anim.Kick;
        const c = shot ? KICK_TIMING.shotContact : KICK_TIMING.passContact;
        const total = shot ? KICK_TIMING.shotTotal : KICK_TIMING.passTotal;
        const side = s.kickFoot > 0 ? 'l' : 'r';
        const other = side === 'l' ? 'r' : 'l';
        const m = side === 'l' ? 1 : -1; // lateral sign of the kicking leg (+x is the player's left)
        let thigh: number, calf: number, out: number;
        if (t < c) {
          const u = smoothstep(0, 1, t / c);
          thigh = 0.9 * u * (shot ? 1 : 0.65);
          calf = 1.55 * u;
          out = shot ? 0 : 0.45 * u;
        } else {
          const v = clamp((t - c) / (total - c), 0, 1);
          const swing = smoothstep(0, 0.35, v);
          const back = smoothstep(0.55, 1, v);
          thigh = lerp(lerp(0.9, shot ? -1.5 : -0.85, swing), -0.15, back);
          calf = lerp(lerp(1.55, 0.05, swing), 0.15, back);
          out = (shot ? 0 : 0.45) * (1 - back);
        }
        // Side-foot passes open the hip outwards.
        this.rot(`thigh_${side}`, Y, out * m);
        this.rot(`thigh_${side}`, X, thigh);
        this.rot(`calf_${side}`, X, calf);
        this.rot(`thigh_${other}`, X, -0.12);
        this.rot(`calf_${other}`, X, 0.3);
        this.rot('spine_01', Y, (shot ? 0.28 : 0.15) * m);
        this.rot('spine_02', X, shot ? -0.12 : 0.05);
        // Arms out for balance.
        this.rot(`upperarm_${other}`, Z, -0.8 * (side === 'l' ? -1 : 1));
        this.rot(`upperarm_${side}`, X, 0.35);
        break;
      }
      case Anim.Tackle: {
        const u = smoothstep(0, 0.12, t) * (1 - smoothstep(0.3, 0.42, t));
        this.rot('pelvis', X, 0.25 * u);
        this.rot('thigh_r', X, -1.2 * u);
        this.rot('calf_r', X, 0.1 * u);
        this.rot('thigh_l', X, 0.35 * u);
        this.rot('calf_l', X, 0.9 * u);
        this.root.position.y = -0.18 * u;
        break;
      }
      case Anim.Header: {
        const c = 0.12;
        const back = t < c ? smoothstep(0, 1, t / c) : 1 - smoothstep(c, c + 0.18, t);
        this.rot('spine_02', X, -0.35 * back + (t > c ? 0.35 * (1 - back) : 0));
        this.rot('neck_01', X, -0.3 * back + (t > c ? 0.4 : 0));
        break;
      }
      case Anim.Skill: {
        const u = clamp(t / 0.3, 0, 1);
        this.rot('thigh_r', Y, Math.sin(u * Math.PI * 2) * 0.6);
        this.rot('thigh_r', X, -0.45 * Math.sin(u * Math.PI));
        this.rot('pelvis', Z, Math.sin(u * Math.PI * 2) * 0.12);
        break;
      }
      default:
        break;
    }
    if (s.anim !== Anim.Tackle) this.root.position.y = 0;

    // Goalkeeper dive: roll the whole body about the forward axis around the hips.
    const diving = s.anim === Anim.Dive;
    const rollTarget = diving ? -(s.diveSide >= 0 ? 1 : -1) * 1.35 * smoothstep(0, 0.28, t) * (1 - smoothstep(0.95, 1.15, t)) : 0;
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-dt * (diving ? 18 : 8)));
    // Lean into speeding up, braking and turning (see lean.ts). Only while running: actions and
    // dives pose the whole body themselves.
    if (s.anim === Anim.Locomotion) bodyLean(s.accFwd, s.accLat, s.speed, leanTarget);
    else leanTarget.pitch = leanTarget.roll = 0;
    const k = 1 - Math.exp(-dt * 10); // ≈0.1 s: smooths the step-to-step jitter of simulated acceleration
    this.lean.pitch += (leanTarget.pitch - this.lean.pitch) * k;
    this.lean.roll += (leanTarget.roll - this.lean.roll) * k;
    this.pivot.rotation.z = this.roll - this.lean.roll;
    this.pivot.rotation.x = this.lean.pitch;
    // Tilt about the feet, not the hips: shift the hips the other way so the planted feet stay put.
    this.pivot.position.x = PIVOT_HEIGHT * Math.sin(this.lean.roll);
    this.pivot.position.z = PIVOT_HEIGHT * Math.sin(this.lean.pitch);
    this.pivot.position.y = PIVOT_HEIGHT - Math.abs(this.roll) * 0.45 * (s.y <= 0.02 && diving && t > 0.3 ? 1 : 0.35);
    if (diving) {
      this.matricesDirty = true;
      const side = s.diveSide >= 0 ? 1 : -1;
      const reach = smoothstep(0, 0.25, t);
      vC.set(side * 0.55, 2.35, 0.25);
      this.aim(`upperarm_l`, 'lowerarm_l', vC, reach);
      this.aim(`upperarm_r`, 'lowerarm_r', vC, reach);
    }

    // Goalkeeper hands towards the ball (set position, catches, holding).
    if (s.isGK && s.reach && !diving && (s.anim === Anim.GkReady || s.anim === Anim.Hold || s.anim === Anim.Locomotion)) {
      this.ensureMatrices();
      // Reach target: root frame → model frame.
      vC.set(s.reach.x, s.reach.y, s.reach.z).applyMatrix4(this.root.matrixWorld).applyMatrix4(mA.copy(this.model.matrixWorld).invert());
      const w = s.anim === Anim.Hold ? 0.9 : 0.75;
      vB.copy(vC);
      vB.x += 0.08;
      this.aim('upperarm_l', 'lowerarm_l', vB, w);
      this.aim('lowerarm_l', 'hand_l', vB, w * 0.8);
      vB.copy(vC);
      vB.x -= 0.08;
      this.aim('upperarm_r', 'lowerarm_r', vB, w);
      this.aim('lowerarm_r', 'hand_r', vB, w * 0.8);
    }

    this.applyGesture(s);

    // Running celebration: arms out like wings — only the scorer on a corner run. Team-mates running to join
    // use their normal sprint, so a group never moves in identical stiff poses.
    if (s.mood === 1 && s.speed >= 1.5 && s.anim === Anim.Locomotion && (s.gesture ?? 0) === OG.CornerRun) {
      // Arms out like wings, just below shoulder height, elbows soft and slightly behind the body.
      const w = 0.85 * ease(this.gestureAge / GESTURE_IN);
      this.armPose('l', { hand: [0.88, -0.16, -0.14], elbow: [0, -0.3, -1] }, w);
      this.armPose('r', { hand: [0.88, -0.16, -0.14], elbow: [0, -0.3, -1] }, w);
    }
  }

  /** Root-frame point (+z forward, +x the character's left, y up from the feet) → model frame. */
  private rootPoint(x: number, y: number, z: number): THREE.Vector3 {
    this.ensureMatrices();
    return vC.set(x, y, z).applyMatrix4(this.root.matrixWorld).applyMatrix4(mA.copy(this.model.matrixWorld).invert());
  }

  /**
   * Aim one arm, straight, at a root-frame point. Used for officials' signals, where a straight
   * pointing arm is exactly right. Celebrations use {@link armPose}, which bends the elbow.
   */
  private arm(side: 'l' | 'r', x: number, y: number, z: number, w: number): void {
    const p = this.rootPoint(x, y, z);
    vB.copy(p);
    this.aim(`upperarm_${side}`, `lowerarm_${side}`, vB, w);
    this.aim(`lowerarm_${side}`, `hand_${side}`, vB, w * 0.9);
  }

  /**
   * Pose one arm with a two-bone solver: put the hand at `pose.hand` and bend the elbow towards
   * `pose.elbow`, keeping both bone lengths.
   *
   * Why: the earlier gestures aimed the upper arm *and* the forearm at the same point, and most points
   * were higher than the hand can reach (the arm is about half a metre long), so every celebration was
   * two locked, straight sticks. Real arms bend: given the shoulder S, the target T and the bone lengths
   * a (upper arm) and b (forearm), the law of cosines places the elbow at distance x = (a² − b² + d²)/2d
   * along S→T and h = √(a² − x²) away from that line, on the side the elbow should point.
   * @param w - blend weight 0–1 over the underlying animation
   */
  private armPose(side: 'l' | 'r', pose: ArmPose, w: number): void {
    if (w <= 0.001) return;
    const upper = this.bones.get(`upperarm_${side}`),
      lower = this.bones.get(`lowerarm_${side}`),
      hand = this.bones.get(`hand_${side}`);
    if (!upper || !lower || !hand) return;
    this.ensureMatrices();
    // Work in the root frame (metres, character-relative) so poses are independent of the model's scale.
    mRootFromModel.copy(this.root.matrixWorld).invert();
    upper.getWorldPosition(ikS).applyMatrix4(mRootFromModel);
    lower.getWorldPosition(ikE).applyMatrix4(mRootFromModel);
    hand.getWorldPosition(ikH).applyMatrix4(mRootFromModel);
    const a = ikE.distanceTo(ikS),
      b = ikH.distanceTo(ikE),
      reach = a + b;
    const sx = side === 'l' ? 1 : -1; // +x is the character's left
    ikT
      .set(sx * pose.hand[0], pose.hand[1], pose.hand[2])
      .multiplyScalar(reach)
      .add(ikS);
    // Distance to the target, kept just inside the reachable range so the elbow is never locked.
    ikD.copy(ikT).sub(ikS);
    const d = Math.min(Math.max(ikD.length(), Math.abs(a - b) + 1e-3), reach * 0.995);
    ikD.normalize();
    ikT.copy(ikS).addScaledVector(ikD, d);
    // Elbow direction, made perpendicular to the shoulder→hand line.
    ikP.set(sx * pose.elbow[0], pose.elbow[1], pose.elbow[2]);
    ikP.addScaledVector(ikD, -ikP.dot(ikD));
    if (ikP.lengthSq() < 1e-8) ikP.set(0, -1, 0).addScaledVector(ikD, -ikD.y);
    ikP.normalize();
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    ikE.copy(ikS).addScaledVector(ikD, x).addScaledVector(ikP, h);
    // Root frame → model frame for aim().
    mModelFromRoot.copy(this.model.matrixWorld).invert().multiply(this.root.matrixWorld);
    ikE.applyMatrix4(mModelFromRoot);
    ikT.applyMatrix4(mModelFromRoot);
    this.aim(`upperarm_${side}`, `lowerarm_${side}`, ikE, w);
    this.aim(`lowerarm_${side}`, `hand_${side}`, ikT, w);
  }

  /** Props held in the right hand (referee cards, assistant flag). */
  private props = new Map<string, THREE.Object3D>();

  /** Attach a prop to a bone, sized in metres regardless of the rig's internal units. */
  attachProp(name: string, boneName: string, obj: THREE.Object3D): void {
    const b = this.bones.get(boneName);
    if (!b) return;
    this.model.updateMatrixWorld(true);
    b.getWorldScale(vA);
    obj.scale.multiplyScalar(1 / Math.max(1e-6, vA.x));
    b.add(obj);
    this.props.set(name, obj);
  }

  showProp(name: string, on: boolean): void {
    const p = this.props.get(name);
    if (p) p.visible = on;
  }

  /**
   * Players' celebration gestures hold still (no pumping fist, no clapping rhythm) when the player has
   * asked for reduced motion. Set by the game from Settings → Game → Reduce motion.
   */
  static reduceMotion = false;
  /** The gesture being shown, how long it has been shown, and the previous one while it blends out. */
  private gestureCode = 0;
  private gestureAge = 0;
  private fadingCode = 0;
  private fadingAge = 0;
  private fadingFrom = 0;
  /** Frame time for gesture blending (set at the start of update). */
  private gestureDt = 0;

  /**
   * Gestures layered over the animation: players' celebrations and reactions, and match officials'
   * signals (always matching the decision the rules engine made). A new gesture blends in over
   * {@link GESTURE_IN} seconds and the old one blends out, so arms move into a pose instead of snapping.
   */
  private applyGesture(s: PoseInput): void {
    const g = s.gesture ?? 0;
    if (g !== this.gestureCode) {
      if (this.gestureCode !== 0) {
        this.fadingCode = this.gestureCode;
        this.fadingFrom = this.gestureAge;
        this.fadingAge = 0;
      }
      this.gestureCode = g;
      this.gestureAge = 0;
    }
    this.gestureAge += this.gestureDt;
    if (this.fadingCode !== 0) {
      this.fadingAge += this.gestureDt;
      if (this.fadingAge >= GESTURE_OUT) this.fadingCode = 0;
    }
    if (s.anim === Anim.Dive || s.anim === Anim.Slide) return;
    if (this.fadingCode !== 0) this.poseGesture(this.fadingCode, s, this.fadingFrom + this.fadingAge, 1 - ease(this.fadingAge / GESTURE_OUT));
    if (g !== 0) this.poseGesture(g, s, this.gestureAge, ease(this.gestureAge / GESTURE_IN));
  }

  /**
   * One gesture at blend weight `w`, `age` seconds after it started.
   *
   * Celebrations are short, plausible football reactions: arms raised with soft elbows, a fist pumped a
   * few times (a quick pull down, a slower recovery: not a sine wave), one arm pointing up, clapping,
   * hands on the head or hips. The torso and head take part (arching back with arms up, crunching into a
   * fist pump, looking up when pointing), because arms moving on a frozen body read as robotic.
   */
  private poseGesture(g: number, s: PoseInput, age: number, w: number): void {
    if (w <= 0.001) return;
    const still = Footballer.reduceMotion;
    const off = this.loopOffset; // per character, so team-mates never move in unison
    const px = s.pointX ?? 0,
      pz = s.pointZ ?? 1;
    switch (g) {
      case OG.ArmsUp: {
        const sway = still ? 0 : 0.035 * Math.sin((age + off) * 3.1);
        this.armPose('l', { hand: [0.28, 0.86 + sway, 0.18], elbow: [1, 0.1, -0.4] }, w * 0.9);
        this.armPose('r', { hand: [0.28, 0.86 - sway, 0.18], elbow: [1, 0.1, -0.4] }, w * 0.9);
        this.rot('spine_02', X, -0.1 * w);
        this.rot('neck_01', X, -0.14 * w);
        break;
      }
      case OG.FistPump: {
        // Three pumps after the arm comes up, then the fist stays raised. Each pump: 0.14 s down, 0.48 s back.
        const u = age - 0.25 - (off % 1) * 0.25;
        const period = 0.62;
        let stroke = 0;
        if (!still && u > 0 && u < 3 * period) {
          const k = u % period;
          stroke = k < 0.14 ? ease(k / 0.14) : 1 - ease((k - 0.14) / 0.48);
        }
        // Fist out in front at chin height, elbow down by the side; each pump pulls it down to the chest.
        // (A fist held high beside the head, with the elbow forced sideways, read as a salute.)
        this.armPose('r', { hand: [0.06, 0.24 - 0.42 * stroke, 0.62 - 0.06 * stroke], elbow: [0.3, -1, -0.35] }, w * 0.92);
        this.rot('spine_02', X, 0.13 * stroke * w);
        this.rot('spine_01', X, 0.05 * stroke * w);
        this.rot('neck_01', X, -0.06 * w);
        break;
      }
      case OG.Restrained: {
        // A brief raised hand, then it settles lower: a consolation goal, not a party.
        const settle = 1 - 0.55 * ease((age - 1.4) / 0.6);
        this.armPose('r', { hand: [0.14, 0.14, 0.6], elbow: [0.4, -1, -0.3] }, w * 0.8 * settle);
        this.rot('neck_01', X, 0.06 * w);
        break;
      }
      case OG.PointSky: {
        // One arm pointing up (which arm varies per player); the head follows it.
        const side = off % 2 < 1 ? 'r' : 'l';
        this.armPose(side, { hand: [0.1, 0.97, 0.12], elbow: [1, 0, -0.3] }, w * 0.92);
        this.rot('neck_01', X, -0.28 * w);
        this.rot('spine_02', X, -0.06 * w);
        break;
      }
      case OG.Applaud: {
        // Hands meet in front of the chest about 2.6 times a second (offset per player).
        const c = still ? 0.15 : 0.5 + 0.5 * Math.cos((age + off) * Math.PI * 2 * 2.6);
        this.armPose('l', { hand: [-0.34 + 0.12 * c, -0.3, 0.62], elbow: [0.45, -1, -0.4] }, w * 0.9);
        this.armPose('r', { hand: [-0.34 + 0.12 * c, -0.3, 0.62], elbow: [0.45, -1, -0.4] }, w * 0.9);
        this.rot('spine_02', X, 0.04 * w);
        break;
      }
      case OG.HandsOnHead:
        if (s.speed < 3) {
          this.armPose('l', { hand: [-0.3, 0.56, -0.1], elbow: [1, 0.5, 0.35] }, w * 0.85);
          this.armPose('r', { hand: [-0.3, 0.56, -0.1], elbow: [1, 0.5, 0.35] }, w * 0.85);
          this.rot('neck_01', X, 0.12 * w);
        }
        break;
      case OG.HandsOnHips:
        if (s.speed < 2) {
          this.armPose('l', { hand: [-0.08, -0.82, -0.04], elbow: [1, 0, -0.5] }, w * 0.8);
          this.armPose('r', { hand: [-0.08, -0.82, -0.04], elbow: [1, 0, -0.5] }, w * 0.8);
          this.rot('spine_02', X, 0.06 * w);
        }
        break;
      // Officials' signals: a straight, deliberate pointing arm is exactly what referees do.
      case OG.Whistle:
        this.arm('r', -0.05, 1.6, 0.2, 0.8 * w);
        break;
      case OG.Point:
        this.arm('r', px * 2 - 0.2, 1.6, pz * 2, 0.9 * w);
        break;
      case OG.Indirect:
      case OG.FlagUp:
        this.arm('r', -0.25, 2.9, 0.05, 0.9 * w);
        break;
      case OG.Advantage:
        this.arm('l', px * 2 + 0.25, 1.7, pz * 2, 0.85 * w);
        this.arm('r', px * 2 - 0.25, 1.7, pz * 2, 0.85 * w);
        break;
      case OG.Card:
        this.arm('r', -0.2, 2.9, 0.2, 0.9 * w);
        break;
      case OG.FlagDirection:
        this.arm('r', px * 1.5 - 0.2, 2.3, pz * 1.5, 0.9 * w);
        break;
      case OG.FlagLevel:
        this.arm('r', px * 2 - 0.2, 1.5, pz * 2, 0.9 * w);
        break;
      case OG.FlagDown:
        this.arm('r', px * 1.5 - 0.2, 0.8, pz * 1.5, 0.9 * w);
        break;
    }
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const l of this.lods) l?.skeleton.dispose();
  }
}

/** Same joints in the same order (bind poses may differ). `names` are the hair's real bone names. */
function sameJoints(names: readonly string[], b: THREE.Skeleton): boolean {
  return names.length === b.bones.length && names.every((n, i) => n === b.bones[i].name);
}

/** Same joints (by name, in order) and same inverse bind matrices → meshes can share one Skeleton. */
function sameSkeleton(names: readonly string[], a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  if (!sameJoints(names, b)) return false;
  for (let i = 0; i < a.bones.length; i++) {
    const x = a.boneInverses[i].elements,
      y = b.boneInverses[i].elements;
    for (let k = 0; k < 16; k++) if (Math.abs(x[k] - y[k]) > 1e-4) return false;
  }
  return true;
}
