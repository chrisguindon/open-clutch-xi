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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { HAIR_POOLS, bodyFor } from '../src/render/characters/squad';
import { BakedAction, PoseSampler, retargetFor, type AnimationBank } from '../src/render/characters/clipSampler';

const SQUAD_SIZES = { '3v3': 3, '5v5': 5, '11v11': 11 };

describe('team composition', () => {
  it('women and men squads use one body; mixed squads include both bodies on both teams in every format', () => {
    for (const n of Object.values(SQUAD_SIZES)) {
      for (const team of [0, 1] as const) {
        const idx = [...Array(n).keys()];
        expect(idx.every((i) => bodyFor('women', team, i) === 'f')).toBe(true);
        expect(idx.every((i) => bodyFor('men', team, i) === 'm')).toBe(true);
        const mixed = new Set(idx.map((i) => bodyFor('mixed', team, i)));
        expect(mixed).toEqual(new Set(['m', 'f']));
      }
    }
  });

  it('every hairstyle is available to both bodies (the buzz cut has a version modelled for each head)', () => {
    const styles = (pool: readonly (string | null)[]) => new Set(pool.filter(Boolean).map((h) => h!.replace('BuzzedFemale', 'Buzzed')));
    expect(styles(HAIR_POOLS.f)).toEqual(styles(HAIR_POOLS.m));
  });
});

describe('gameplay equality', () => {
  // The simulation decides everything a player can do. If it can't see appearance, appearance can't
  // change speed, strength, stamina, skill, AI or collisions. This guards that boundary.
  const simFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? simFiles(p) : p.endsWith('.ts') ? [p] : [];
    });
  it('nothing in src/sim/ imports rendering, settings or appearance code', () => {
    for (const f of simFiles('src/sim')) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from '\.\.\/(\.\.\/)?(render|game|ui)\//);
      expect(src, f).not.toMatch(/\b(squad|SquadMix|BodyType|bodyFor)\b/);
    }
  });
});

describe('animation retargeting between bodies', () => {
  // Two one-bone "skeletons" with different rest poses, and a bank baked on the first.
  const refRest = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, 0)), p: new THREE.Vector3(0, 0.95, 0) };
  const bodyRest = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.3, 0.1)), p: new THREE.Vector3(0, 0.93, 0.01) };
  const bank: AnimationBank = {
    quatBones: ['hip'],
    posBones: ['hip'],
    quatRest: new Float32Array(refRest.q.toArray()),
    posRest: new Float32Array(refRest.p.toArray()),
    clips: new Map(),
  };
  const bone = (rest: typeof refRest) => {
    const b = new THREE.Bone();
    b.quaternion.copy(rest.q);
    b.position.copy(rest.p);
    return b;
  };

  it('the reference body needs no correction (no per-frame cost)', () => {
    const b = bone(refRest);
    expect(retargetFor(bank, [b], [b])).toBeNull();
  });

  it('a clip frame equal to the reference rest pose poses the other body in its own rest pose', () => {
    const b = bone(bodyRest);
    const rt = retargetFor(bank, [b], [b]);
    expect(rt).not.toBeNull();
    // One-frame clip holding the reference rest pose.
    const clip = {
      name: 'rest',
      duration: 1,
      frames: 2,
      quat: new Float32Array([...refRest.q.toArray(), ...refRest.q.toArray()]),
      pos: new Float32Array([...refRest.p.toArray(), ...refRest.p.toArray()]),
    };
    const action = new BakedAction(clip);
    action.enabled = true;
    action.weight = 1;
    b.quaternion.identity();
    b.position.set(0, 0, 0);
    new PoseSampler(bank, [b], [b], rt).apply([action]);
    expect(b.quaternion.angleTo(bodyRest.q)).toBeLessThan(1e-3); // Float32 storage: within 0.06°
    expect(b.position.distanceTo(bodyRest.p)).toBeLessThan(1e-6);
  });

  it('motion in the clip (here, the hips dropping 5 cm) carries over to the other body', () => {
    const b = bone(bodyRest);
    const rt = retargetFor(bank, [b], [b]);
    const low = refRest.p.clone().setY(refRest.p.y - 0.05);
    const clip = {
      name: 'dip',
      duration: 1,
      frames: 2,
      quat: new Float32Array([...refRest.q.toArray(), ...refRest.q.toArray()]),
      pos: new Float32Array([...low.toArray(), ...low.toArray()]),
    };
    const action = new BakedAction(clip);
    action.enabled = true;
    action.weight = 1;
    new PoseSampler(bank, [b], [b], rt).apply([action]);
    expect(b.position.y).toBeCloseTo(bodyRest.p.y - 0.05, 6);
  });
});
