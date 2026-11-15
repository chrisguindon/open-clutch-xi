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
import { readFileSync } from 'node:fs';
import { HAIR_POOLS } from '../src/render/characters/squad';
import { canonicalBoneName } from '../src/render/characters/assets';

/** Read the JSON chunk of a GLB (no decoding of meshes needed to inspect its structure). */
function glbJson(path: string): {
  scenes: Array<{ nodes: number[] }>;
  nodes: Array<{ name?: string; mesh?: number; skin?: number; children?: number[] }>;
  scene?: number;
} {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

describe('hair assets', () => {
  // Regression: hair.glb holds one glTF scene per hairstyle, and the loader used to read only the default
  // scene, so only the first style (a buzz cut) ever appeared and players looked bald.
  const gltf = glbJson('public/assets/hair.glb');
  const skinnedMeshNames = new Set(gltf.nodes.filter((n) => n.mesh !== undefined && n.skin !== undefined).map((n) => n.name));
  it('contains every hairstyle the appearance pools use, plus the beard, as skinned meshes', () => {
    const used = new Set([...HAIR_POOLS.m, ...HAIR_POOLS.f].filter(Boolean));
    for (const style of [...used, 'Hair_Beard']) expect(skinnedMeshNames, style!).toContain(style);
  });
  it('spreads them over several scenes, which is why assets.ts must read every scene', () => {
    expect(gltf.scenes.length).toBeGreaterThan(1);
    const src = readFileSync('src/render/characters/assets.ts', 'utf8');
    expect(src).toMatch(/for \(const scene of hairGltf\.scenes\)/);
  });
  it('most players get visible hair: the pools are mostly real styles, with an intentional shaved head in one pool', () => {
    for (const pool of [HAIR_POOLS.m, HAIR_POOLS.f]) expect(pool.filter((h) => h !== null).length / pool.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('hair bone names', () => {
  // Regression: the loader renames duplicate bones in merged files ("Head_1"); hair bound by those names
  // matched none of the player's bones and stayed at the centre spot, so players looked bald.
  const body = new Set(['root', 'Head', 'spine_01', 'neck_01', 'thumb_01_l']);
  it('strips the loader’s de-duplication suffix only when that gives a real body bone', () => {
    expect(canonicalBoneName('Head_1', body)).toBe('Head');
    expect(canonicalBoneName('spine_01_3', body)).toBe('spine_01');
    expect(canonicalBoneName('spine_01', body)).toBe('spine_01'); // a genuine name ending in _01 is kept
    expect(canonicalBoneName('thumb_01_l', body)).toBe('thumb_01_l');
    expect(canonicalBoneName('Hair_Root_2', body)).toBe('Hair_Root_2'); // not a body bone: unchanged
  });
});
