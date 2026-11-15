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
import { loadSettings } from '../src/game/settings';

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

describe('frame-rate setting migration', () => {
  it('moves an untouched old "balanced" default to auto', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ frameRate: 'balanced' }));
    expect(loadSettings().frameRate).toBe('auto');
  });
  it('keeps a frame rate the player chose', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ frameRate: 'balanced', frameRateChosen: true }));
    expect(loadSettings().frameRate).toBe('balanced');
  });
  it('new installs default to auto and responsive passing', () => {
    const s = loadSettings();
    expect(s.frameRate).toBe('auto');
    expect(s.passControl).toBe('responsive');
  });
});

describe('graphics mode migration', () => {
  it('new installs default to Auto graphics', () => {
    expect(loadSettings().graphicsMode).toBe('auto');
  });
  it('returning players move to Auto, starting from the quality they had', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ quality: 'medium', adaptiveQuality: true }));
    const s = loadSettings();
    expect(s.graphicsMode).toBe('auto');
    expect(s.quality).toBe('medium');
  });
  it('players who had turned adaptive quality off keep their fixed preset', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ quality: 'ultra', adaptiveQuality: false }));
    const s = loadSettings();
    expect(s.graphicsMode).toBe('manual');
    expect(s.quality).toBe('ultra');
  });
  it('an explicit choice is never overridden', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ quality: 'low', graphicsMode: 'manual', adaptiveQuality: true }));
    expect(loadSettings().graphicsMode).toBe('manual');
  });
});

describe('Phase 10 settings: Easy default, team composition, allowed values', () => {
  it('new players start on Easy with mixed squads', () => {
    const s = loadSettings();
    expect(s.difficulty).toBe('easy');
    expect(s.squad).toBe('mixed');
  });
  it('a returning player keeps the difficulty they chose', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ difficulty: 'hard', controlScheme: 'keyboard', bindingsVersion: 2, graphicsMode: 'auto' }));
    expect(loadSettings().difficulty).toBe('hard');
  });
  it('saved settings from before difficulty existed keep the old default (Medium), not the new one', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ controlScheme: 'keyboard', bindingsVersion: 2, graphicsMode: 'auto' }));
    expect(loadSettings().difficulty).toBe('medium');
  });
  it('a value outside the allowed set falls back to the default', () => {
    store.set(
      'floodlight-fc-settings-v1',
      JSON.stringify({ difficulty: 'impossible', squad: 'robots', format: '7v7', controlScheme: 'keyboard', bindingsVersion: 2, graphicsMode: 'auto' }),
    );
    const s = loadSettings();
    expect(s.difficulty).toBe('easy');
    expect(s.squad).toBe('mixed');
    expect(s.format).toBe('5v5');
  });
});
