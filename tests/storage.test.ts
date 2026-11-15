/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS, hasStored, readJson, remove, writeJson } from '../src/game/storage';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/game/settings';
import { loadTuning } from '../src/dev/tuning';

type G = { localStorage?: unknown };
function fakeStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as G).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}
afterEach(() => {
  delete (globalThis as G).localStorage;
});

describe('local storage wrapper', () => {
  it('round-trips JSON and reports what is stored', () => {
    fakeStorage();
    expect(hasStored(STORAGE_KEYS.settings)).toBe(false);
    expect(writeJson(STORAGE_KEYS.settings, { minutes: 6 })).toBe(true);
    expect(hasStored(STORAGE_KEYS.settings)).toBe(true);
    expect(readJson(STORAGE_KEYS.settings)).toEqual({ minutes: 6 });
    remove(STORAGE_KEYS.settings);
    expect(readJson(STORAGE_KEYS.settings)).toBeUndefined();
  });

  it('treats corrupt JSON as nothing saved, and keeps the first corrupt copy for recovery', () => {
    const store = fakeStorage();
    store.set(STORAGE_KEYS.settings, '{"minutes": 6,');
    expect(readJson(STORAGE_KEYS.settings)).toBeUndefined();
    expect(store.get(`${STORAGE_KEYS.settings}:corrupt`)).toBe('{"minutes": 6,');
    store.set(STORAGE_KEYS.settings, 'also broken');
    readJson(STORAGE_KEYS.settings);
    expect(store.get(`${STORAGE_KEYS.settings}:corrupt`)).toBe('{"minutes": 6,');
  });

  it('falls back to memory when storage throws (private mode), so the session still remembers', () => {
    (globalThis as G).localStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(writeJson(STORAGE_KEYS.devTuning, { useInMatches: true })).toBe(false);
    expect(readJson(STORAGE_KEYS.devTuning)).toEqual({ useInMatches: true });
    remove(STORAGE_KEYS.devTuning);
    expect(readJson(STORAGE_KEYS.devTuning)).toBeUndefined();
  });

  it('works with no localStorage at all (tests, headless tools)', () => {
    saveSettings({ ...structuredClone(DEFAULT_SETTINGS), minutes: 8 });
    expect(loadSettings().minutes).toBe(8);
    remove(STORAGE_KEYS.settings);
  });
});

describe('settings validation', () => {
  it('replaces fields of the wrong type with defaults and keeps the valid ones', () => {
    const store = fakeStorage();
    store.set(
      STORAGE_KEYS.settings,
      JSON.stringify({ controlScheme: 'keyboard', bindingsVersion: 2, graphicsMode: 'auto', minutes: 'four', masterVolume: 0.3, minimap: 'yes' }),
    );
    const s = loadSettings();
    expect(s.minutes).toBe(DEFAULT_SETTINGS.minutes);
    expect(s.minimap).toBe(DEFAULT_SETTINGS.minimap);
    expect(s.masterVolume).toBe(0.3);
  });

  it('drops malformed key bindings but keeps the rest of the player’s keys', () => {
    const store = fakeStorage();
    store.set(
      STORAGE_KEYS.settings,
      JSON.stringify({ controlScheme: 'keyboard', bindingsVersion: 2, graphicsMode: 'auto', bindings: { shoot: ['KeyJ'], pass: 'KeyK', sprint: [null] } }),
    );
    const s = loadSettings();
    expect(s.bindings.shoot).toEqual(['KeyJ']);
    expect(s.bindings.pass).toEqual(DEFAULT_SETTINGS.bindings.pass);
    expect(s.bindings.sprint).toEqual(DEFAULT_SETTINGS.bindings.sprint);
  });

  it('a stored value that is not an object (null, array, number) gives defaults instead of crashing', () => {
    const store = fakeStorage();
    for (const junk of ['null', '[1,2]', '42', '"text"']) {
      store.set(STORAGE_KEYS.settings, junk);
      expect(loadSettings().minutes).toBe(DEFAULT_SETTINGS.minutes);
    }
  });

  it('dev tuning tolerates partial or hand-edited data', () => {
    const store = fakeStorage();
    store.set(STORAGE_KEYS.devTuning, JSON.stringify({ move: { accel: 9 }, camera: 'oops' }));
    expect(loadTuning()).toEqual({ move: { accel: 9 }, kick: {}, camera: {}, useInMatches: false });
    store.set(STORAGE_KEYS.devTuning, '[]');
    expect(loadTuning()).toBeNull();
  });
});
