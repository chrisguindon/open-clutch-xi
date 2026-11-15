/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { applyBinding, applyPadBinding } from '../src/ui/ui';
import { DEFAULT_BINDINGS, DEFAULT_KBM_BINDINGS, DEFAULT_PAD_BINDINGS, KeyAction, activeBindings, keyLabel, loadSettings } from '../src/game/settings';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});
const save = (o: object) => store.set('floodlight-fc-settings-v1', JSON.stringify(o));

describe('control scheme migration', () => {
  it('new installs see the "How would you like to play?" screen', () => {
    const s = loadSettings();
    expect(s.controlsChosen).toBe(false);
    expect(s.controlScheme).toBe('keyboard');
  });
  it('returning keyboard players are not asked again and keep their custom keys', () => {
    const custom = { ...structuredClone(DEFAULT_BINDINGS), pass: ['KeyH'] };
    save({ bindings: custom, bindingsVersion: 2 });
    const s = loadSettings();
    expect(s.controlsChosen).toBe(true);
    expect(s.controlScheme).toBe('keyboard');
    expect(activeBindings(s).pass).toEqual(['KeyH']);
  });
  it('"Mouse aiming" players move to keyboard & mouse with their keys kept and the two clicks added', () => {
    const custom = { ...structuredClone(DEFAULT_BINDINGS), shoot: ['KeyU'], pass: ['KeyH'] };
    save({ bindings: custom, mouseAim: true, bindingsVersion: 2 });
    const s = loadSettings();
    expect(s.controlScheme).toBe('keyboardMouse');
    expect(s.kbmBindings.shoot).toEqual(['Mouse0', 'KeyU']);
    expect(s.kbmBindings.pass).toEqual(['Mouse2', 'KeyH']);
    expect(s.bindings.shoot).toEqual(['KeyU']); // keyboard-only layout untouched
  });
  it('saved control-scheme choices are kept', () => {
    save({ controlScheme: 'controller', controlsChosen: true, padBindings: { ...DEFAULT_PAD_BINDINGS, shoot: [3] } });
    const s = loadSettings();
    expect(s.controlScheme).toBe('controller');
    expect(s.padBindings.shoot).toEqual([3]);
    expect(s.padBindings.pass).toEqual([0]);
  });
});

describe('keyboard & mouse layout', () => {
  it('nothing essential is only on the middle button', () => {
    for (const [a, codes] of Object.entries(DEFAULT_KBM_BINDINGS)) {
      if (codes.includes('Mouse1'))
        expect(
          codes.some((c) => c !== 'Mouse1'),
          a,
        ).toBe(true);
    }
  });
  it('every action has a binding and no input does two things', () => {
    const seen = new Map<string, string>();
    for (const [a, codes] of Object.entries(DEFAULT_KBM_BINDINGS)) {
      expect(codes.length, a).toBeGreaterThan(0);
      for (const c of codes) {
        expect(seen.get(c), `${c} used by ${seen.get(c)} and ${a}`).toBeUndefined();
        seen.set(c, a);
      }
    }
  });
  it('mouse buttons rebind like keys, swapping on conflict', () => {
    const b = structuredClone(DEFAULT_KBM_BINDINGS);
    const msg = applyBinding(b, 'skill' as KeyAction, 'Mouse2', false);
    expect(b.skill).toEqual(['Mouse2']);
    expect(b.pass).toEqual(['KeyF']);
    expect(msg).toContain('Right click');
  });
  it('mouse buttons have readable names', () => {
    expect(keyLabel('Mouse0')).toBe('Left click');
    expect(keyLabel('Mouse1')).toBe('Middle click');
    expect(keyLabel('Mouse2')).toBe('Right click');
  });
});

describe('controller remapping', () => {
  it('a button does one thing: the previous owner takes the old button', () => {
    const p = structuredClone(DEFAULT_PAD_BINDINGS);
    const msg = applyPadBinding(p, 'shoot', 3);
    expect(p.shoot).toEqual([3]);
    expect(p.through).toEqual([1]);
    expect(msg).toMatch(/Y → Shoot/);
    const all = Object.values(p).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it('re-binding to the same button is a no-op', () => {
    const p = structuredClone(DEFAULT_PAD_BINDINGS);
    expect(applyPadBinding(p, 'pass', 0)).toBeNull();
    expect(p).toEqual(DEFAULT_PAD_BINDINGS);
  });
});
