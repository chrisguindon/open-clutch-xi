/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Builds optimised runtime assets from the CC0 sources in asset-src/ (see docs/governance/third-party-assets.md for origins).
//   node scripts/build-assets.mjs [target…]   (targets: player, player_f, hair, anims, skins, grass; default all)
// Outputs to public/assets/: player.glb and player_f.glb (the two CC0 base bodies + LODs + eyes/eyebrows),
// hair.glb, anims.glb, skin_*.webp, grass_*.webp.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, resample, weld, simplifyPrimitive, reorder, quantize, textureCompress, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, existsSync, statSync } from 'node:fs';

const SRC = 'asset-src';
const OUT = 'public/assets';
mkdirSync(OUT, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const BODIES = {
  player: { file: `${SRC}/ubc/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`, node: 'SuperHero_Male' },
  // Same CC0 pack and the same 65-joint skeleton (identical joint names and order), so the shared
  // animations drive it too; small rest-pose differences are corrected at runtime (clipSampler.ts).
  player_f: { file: `${SRC}/ubc/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf`, node: 'Superhero_Female' },
};
const targets = process.argv.slice(2);
const want = (t) => targets.length === 0 || targets.includes(t);
const HAIR_DIR = `${SRC}/ubc/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)`;
// Each file becomes its own glTF scene in hair.glb: the loader must read them all (assets.ts).
const HAIRS = ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Beard', 'Hair_Buns', 'Hair_BuzzedFemale'];
const UAL1 = `${SRC}/ual1/Unreal-Godot/UAL1_Standard.glb`;
const UAL2 = `${SRC}/ual2/Unreal-Godot/UAL2_Standard.glb`;
const CLIPS = [
  // Locomotion (Universal Animation Library 1)
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Crouch_Idle_Loop',
  // Actions and reactions
  'Jump_Start',
  'Jump_Loop',
  'Jump_Land',
  'Hit_Chest',
  'Death01',
  'Dance_Loop',
  'Roll',
  // Universal Animation Library 2
  'Slide_Start',
  'Slide_Loop',
  'Slide_Exit',
  'OverhandThrow',
  'Yes',
  'Idle_No_Loop',
  'Hit_Knockback',
  'LayToIdle',
  'Idle_FoldArms_Loop',
];
const FINGER = /(index|middle|pinky|ring|thumb)_0\d_[lr]/;

async function writeGLB(doc, file) {
  // Positions stay float: the kit shader classifies garments from bind-pose positions in metres.
  // (meshopt() would quantise POSITION too, so its steps are run here explicitly.)
  await doc.transform(
    dedup(),
    prune(),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|JOINTS_\d+|WEIGHTS_\d+|COLOR_\d+)$/, patternTargets: /^(NORMAL|TANGENT)$/ }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(file, doc);
  console.log(`  ${file}  ${(statSync(file).size / 1024).toFixed(0)} KB`);
}

/** Resize + convert every texture in a document to WebP. */
async function webpTextures(doc, size) {
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 86 }));
}

// ---------------------------------------------------------------------------- player.glb, player_f.glb
async function buildBody(target) {
  const { file, node } = BODIES[target];
  console.log(`${target}.glb`);
  const doc = await io.read(file);
  const root = doc.getRoot();
  const body = root.listNodes().find((n) => n.getName() === node);
  // Every body is published under one node name, so runtime code needn't know which body it loaded.
  body.setName('Body_LOD0');
  const skin = body.getSkin();
  const scene = root.listScenes()[0];
  // Level-of-detail copies of the body mesh (same skin, simplified geometry).
  for (const [name, ratio, error] of [
    ['Body_LOD1', 0.32, 0.004],
    ['Body_LOD2', 0.1, 0.02],
  ]) {
    // Deep copy (Mesh.clone() shares primitives and accessors, which would simplify the original too).
    const mesh = doc.createMesh(name);
    for (const src of body.getMesh().listPrimitives()) {
      const prim = doc.createPrimitive().setMaterial(src.getMaterial()).setMode(src.getMode());
      for (const sem of src.listSemantics()) {
        if (['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3', 'COLOR_0', 'COLOR_1'].includes(sem)) continue;
        prim.setAttribute(sem, src.getAttribute(sem).clone());
      }
      prim.setIndices(src.getIndices().clone());
      mesh.addPrimitive(prim);
      await simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
    }
    const lod = doc.createNode(name).setMesh(mesh).setSkin(skin);
    scene.addChild(lod);
  }
  for (const n of root.listNodes()) {
    for (const prim of n.getMesh()?.listPrimitives() ?? []) {
      for (const a of ['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3', 'COLOR_0', 'COLOR_1']) prim.setAttribute(a, null);
    }
  }
  await webpTextures(doc, 1024);
  await writeGLB(doc, `${OUT}/${target}.glb`);
}
for (const target of Object.keys(BODIES)) if (want(target)) await buildBody(target);

// ---------------------------------------------------------------------------- hair.glb
if (want('hair')) {
  console.log('hair.glb');
  const doc = await io.read(`${HAIR_DIR}/${HAIRS[0]}.gltf`);
  for (const h of HAIRS.slice(1)) mergeDocuments(doc, await io.read(`${HAIR_DIR}/${h}.gltf`));
  // Merge all buffers into one (GLB needs a single buffer).
  await doc.transform(unpartition());
  for (const n of doc.getRoot().listNodes()) {
    for (const prim of n.getMesh()?.listPrimitives() ?? []) {
      for (const a of ['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3', 'COLOR_0', 'COLOR_1']) prim.setAttribute(a, null);
    }
  }
  await webpTextures(doc, 1024);
  await writeGLB(doc, `${OUT}/hair.glb`);
}

// ---------------------------------------------------------------------------- anims.glb
if (want('anims')) {
  console.log('anims.glb');
  const doc = await io.read(UAL1);
  const ual1Nodes = new Map(
    doc
      .getRoot()
      .listNodes()
      .map((n) => [n.getName(), n]),
  );
  mergeDocuments(doc, await io.read(UAL2));
  await doc.transform(unpartition());
  const root = doc.getRoot();
  // Both libraries share the same skeleton. After merging, retarget every channel onto the first
  // library's bones (otherwise the loader renames the duplicate bones and those clips bind to nothing).
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const t = ch.getTargetNode();
      const canonical = t && ual1Nodes.get(t.getName());
      if (canonical && canonical !== t) ch.setTargetNode(canonical);
    }
  }
  for (const n of root.listNodes()) {
    if (ual1Nodes.get(n.getName()) !== n && !n.getMesh()) n.dispose();
  }
  // Keep only the clips we use; drop finger channels (hands use a fixed relaxed pose at runtime).
  const seen = new Set();
  for (const anim of root.listAnimations()) {
    const name = anim.getName();
    if (!CLIPS.includes(name) || seen.has(name)) {
      for (const smp of anim.listSamplers()) smp.dispose();
      anim.dispose();
      continue;
    }
    seen.add(name);
    for (const ch of anim.listChannels()) {
      const target = ch.getTargetNode();
      if (!target || FINGER.test(target.getName()) || ch.getTargetPath() === 'scale') {
        const smp = ch.getSampler();
        ch.dispose();
        smp?.dispose(); // samplers keep their keyframe accessors alive otherwise
      }
    }
  }
  const missing = CLIPS.filter((c) => !seen.has(c));
  if (missing.length) console.warn('  missing clips:', missing.join(', '));
  // No meshes needed: the animation targets are resolved by bone name at runtime.
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const n of root.listNodes()) if (n.getSkin()) n.setSkin(null);
  for (const s of root.listSkins()) s.dispose();
  for (const t of root.listTextures()) t.dispose();
  for (const m of root.listMaterials()) m.dispose();
  await doc.transform(resample({ tolerance: 2e-3 }));
  for (const anim of root.listAnimations()) {
    let bytes = 0;
    for (const s2 of anim.listSamplers()) bytes += s2.getOutput().getByteLength() + s2.getInput().getByteLength();
    console.log(`    ${anim.getName()} ${(bytes / 1024).toFixed(0)} KB`);
  }
  await writeGLB(doc, `${OUT}/anims.glb`);
}

// ---------------------------------------------------------------------------- skin textures
const TEX = `${SRC}/ubc/Base Characters/Textures`;
// Each body has its own UV layout, so each needs its own light and dark skin texture.
for (const [src, out] of want('skins')
  ? [
      ['T_Superhero_Male_Ligh.png', 'skin_light.webp'],
      ['T_Superhero_Male_Dark.png', 'skin_dark.webp'],
      ['T_Superhero_Female_Light_BaseColor.png', 'skin_f_light.webp'],
      ['T_Superhero_Female_Dark_BaseColor.png', 'skin_f_dark.webp'],
    ]
  : []) {
  if (!existsSync(`${TEX}/${src}`)) {
    console.warn('  missing', src);
    continue;
  }
  await sharp(`${TEX}/${src}`).resize(1024, 1024).webp({ quality: 86 }).toFile(`${OUT}/${out}`);
  console.log(`  ${OUT}/${out}  ${(statSync(`${OUT}/${out}`).size / 1024).toFixed(0)} KB`);
}
// ---------------------------------------------------------------------------- grass (ambientCG Grass005, CC0)
for (const [src, out, q] of want('grass')
  ? [
      ['Color', 'grass_color.webp', 85],
      ['NormalGL', 'grass_normal.webp', 90],
      ['Roughness', 'grass_rough.webp', 80],
    ]
  : []) {
  const f = `${SRC}/grass/Grass005_1K-JPG_${src}.jpg`;
  if (!existsSync(f)) {
    console.warn('  missing', f);
    continue;
  }
  await sharp(f).resize(1024, 1024).webp({ quality: q }).toFile(`${OUT}/${out}`);
  console.log(`  ${OUT}/${out}  ${(statSync(`${OUT}/${out}`).size / 1024).toFixed(0)} KB`);
}
void EXTMeshoptCompression;
void weld;
