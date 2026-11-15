/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { AnimationBank, bakeAnimations } from './clipSampler';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** The two CC0 base bodies (same skeleton, different proportions). Purely visual: see {@link BodyAssets}. */
export type BodyType = 'm' | 'f';

/**
 * Skeleton landmarks of one body in its bind pose (metres): where the kit shader's garment boundaries
 * belong. Measured from the bones at load time, so a new body never needs hand-tuned numbers.
 */
export interface BodyFit {
  /** Heights: 0, ankle, knee, hip, shoulder, neck, top of the head. Increasing. */
  heights: [number, number, number, number, number, number, number];
  /** Sideways distance of the shoulder joint from the body's centre line. */
  shoulderX: number;
  /**
   * Height (in the reference body's space) of the small chest number and crest. A body-shape choice, not
   * a measurement: on a body with a bust they sit higher, on the upper chest, where kit badges belong.
   */
  chestBadgeY: number;
}

/**
 * One base body: its model, its skin textures (each body has its own UV layout) and its landmarks.
 * Appearance only — the simulation never knows which body a player is drawn with.
 */
export interface BodyAssets {
  type: BodyType;
  gltf: GLTF;
  skins: { light: THREE.Texture; dark: THREE.Texture };
  fit: BodyFit;
}

/**
 * Character asset library: CC0 Quaternius base characters, hairstyles and animation clips
 * (see docs/governance/third-party-assets.md). Loaded once at boot and shared by every player instance.
 */
export interface CharacterAssets {
  /** The reference body: the animations are baked against it, and the kit shader is calibrated to it. */
  body: GLTF;
  /** Every available body. `f` is missing if its file failed to load; players then use `m`. */
  bodies: { m: BodyAssets; f?: BodyAssets };
  hair: Map<string, THREE.SkinnedMesh>;
  clips: Map<string, THREE.AnimationClip>;
  /** Clips baked for the lightweight pose sampler (see clipSampler.ts). */
  bank: AnimationBank;
  /** Reference body skins (kept for code that predates multiple bodies). */
  skins: { light: THREE.Texture; dark: THREE.Texture };
  /** For each locomotion loop: clip time (s) at which the left foot is furthest forward. */
  leftFootForward: Map<string, number>;
}

/** Running clips blended by speed, slowest first. Their timing follows the simulation's gait phase. */
export const LOCOMOTION_CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'] as const;

const base = (import.meta.env?.BASE_URL ?? './') + 'assets/';

/**
 * Load and prepare every character asset once at boot: both bodies, hairstyles and clips (baked for the
 * pose sampler). The reference body is required; the second body is optional (see {@link CharacterAssets}).
 * @param onProgress - called with the overall download fraction, 0–1, for the loading bar
 */
export async function loadCharacterAssets(onProgress?: (f: number) => void): Promise<CharacterAssets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const files = ['player.glb', 'hair.glb', 'anims.glb', 'player_f.glb'];
  const progress = new Array(files.length).fill(0);
  const report = () => onProgress?.(progress.reduce((a, b) => a + b, 0) / files.length);
  const load = (f: string, i: number) =>
    loader
      .loadAsync(base + f, (e) => {
        if (e.total) {
          progress[i] = e.loaded / e.total;
          report();
        }
      })
      .then((g) => {
        progress[i] = 1;
        report();
        return g;
      });
  const texLoader = new THREE.TextureLoader();
  const loadTex = (f: string) =>
    texLoader.loadAsync(base + f).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // glTF UV convention
      t.anisotropy = 4;
      return t;
    });
  // The second body is optional: if it fails to load, every player uses the reference body and the
  // match still starts (the same "every asset has a fallback" rule as the rest of the game).
  const optional = <T>(p: Promise<T>): Promise<T | null> =>
    p.catch((err: unknown) => {
      console.warn('Optional character asset failed to load; using the reference body instead.', err);
      return null;
    });
  const [body, hairGltf, anims, light, dark, bodyF, lightF, darkF] = await Promise.all([
    load(files[0], 0),
    load(files[1], 1),
    load(files[2], 2),
    loadTex('skin_light.webp'),
    loadTex('skin_dark.webp'),
    optional(load(files[3], 3)),
    optional(loadTex('skin_f_light.webp')),
    optional(loadTex('skin_f_dark.webp')),
  ]);
  progress[3] = 1;
  // hair.glb merges five hairstyle files, and each brought its own glTF scene. `gltf.scene` is only the
  // default (first) one, so reading just that found the buzz cut alone: every player given another style
  // got no hair at all, and the buzz cut is so close-cropped it looks bald too.
  const hair = new Map<string, THREE.SkinnedMesh>();
  for (const scene of hairGltf.scenes) {
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) hair.set(o.name, o as THREE.SkinnedMesh);
    });
  }
  // Each merged hairstyle brought its own copy of the skeleton, and the loader renames duplicate bones to
  // keep names unique ("Head_1", "spine_01_2"). Footballers bind hair to their own bones *by name*, so
  // those renamed bones matched nothing: the hair stayed on its own skeleton, standing at the centre spot,
  // and every player except those with the first hairstyle looked bald. Record each hair bone's real name.
  const bodyBones = new Set<string>();
  body.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) bodyBones.add(o.name);
  });
  for (const mesh of hair.values()) mesh.userData.boneNames = mesh.skeleton.bones.map((b) => canonicalBoneName(b.name, bodyBones));
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of anims.animations) clips.set(c.name, c);
  const leftFootForward = analyseGait(body, clips);
  const bank = bakeAnimations(body.scene, clips);
  const bodies: CharacterAssets['bodies'] = { m: { type: 'm', gltf: body, skins: { light, dark }, fit: measureBody(body) } };
  if (bodyF && lightF && darkF) bodies.f = { type: 'f', gltf: bodyF, skins: { light: lightF, dark: darkF }, fit: measureBody(bodyF, 1.395) };
  return { body, bodies, hair, clips, bank, skins: { light, dark }, leftFootForward };
}

/**
 * The real name of a bone that the glTF loader may have renamed to keep names unique (it appends
 * `_<n>`). Only strips the suffix when the result is a bone of the body, so genuine names such as
 * `spine_01` are left alone.
 */
export function canonicalBoneName(name: string, bodyBones: ReadonlySet<string>): string {
  if (bodyBones.has(name)) return name;
  const stripped = name.replace(/_\d+$/, '');
  return bodyBones.has(stripped) ? stripped : name;
}

/** Bind-pose landmarks of a body, from its bones and mesh bounds (see {@link BodyFit}). */
export function measureBody(gltf: GLTF, chestBadgeY = 1.315): BodyFit {
  gltf.scene.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  const at = (bone: string): THREE.Vector3 => {
    const o = gltf.scene.getObjectByName(bone);
    if (!o) throw new Error(`Character body is missing the ${bone} bone`);
    return o.getWorldPosition(p);
  };
  const top = new THREE.Box3().setFromObject(gltf.scene).max.y;
  return {
    heights: [0, at('foot_l').y, at('calf_l').y, at('thigh_l').y, at('upperarm_l').y, at('neck_01').y, top],
    shoulderX: Math.abs(at('upperarm_l').x),
    chestBadgeY,
  };
}

/**
 * Sample each locomotion loop on a scratch skeleton and find when the left foot is furthest
 * in front of the right foot. Playback is then driven by the simulation's gait phase, so the
 * visible foot plants line up with dribble touches.
 */
function analyseGait(body: GLTF, clips: Map<string, THREE.AnimationClip>): Map<string, number> {
  const out = new Map<string, number>();
  const scene = body.scene.clone(true);
  const mixer = new THREE.AnimationMixer(scene);
  const footL = scene.getObjectByName('foot_l')!;
  const footR = scene.getObjectByName('foot_r')!;
  const pL = new THREE.Vector3(),
    pR = new THREE.Vector3();
  for (const name of LOCOMOTION_CLIPS) {
    const clip = clips.get(name);
    if (!clip || name === 'Idle_Loop') continue;
    const action = mixer.clipAction(clip);
    action.play();
    let best = -Infinity,
      bestT = 0;
    const n = 64;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * clip.duration;
      action.time = t;
      mixer.update(0);
      scene.updateMatrixWorld(true);
      footL.getWorldPosition(pL);
      footR.getWorldPosition(pR);
      const d = pL.z - pR.z; // model faces +z
      if (d > best) {
        best = d;
        bestT = t;
      }
    }
    action.stop();
    out.set(name, bestT);
  }
  mixer.stopAllAction();
  return out;
}
