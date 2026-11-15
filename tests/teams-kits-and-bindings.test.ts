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
import { existsSync } from 'node:fs';
import { NATIONS, nationByCode, defaultHomeCode } from '../src/sim/nations';
import { resolveKits, kitsClash } from '../src/render/matchView';
import { applyBinding } from '../src/ui/ui';
import { DEFAULT_BINDINGS, LEGACY_BINDINGS_V1, loadSettings, KeyAction } from '../src/game/settings';
import { emptyInput, consumeEdges } from '../src/sim/human';
import { makeMatch, clearPitch } from './helpers';
import { SIM_DT } from '../src/sim/config';
import { Anim } from '../src/sim/player';

describe('national teams', () => {
  it('has the 54 teams with unique codes, ISO codes and flag files', () => {
    expect(NATIONS).toHaveLength(54);
    expect(new Set(NATIONS.map((n) => n.short)).size).toBe(54);
    expect(new Set(NATIONS.map((n) => n.iso)).size).toBe(54);
    for (const n of NATIONS) {
      expect(n.short).toMatch(/^[A-Z]{3}$/);
      expect(existsSync(`public/${n.flag}`)).toBe(true);
      expect(n.away).toBeDefined();
    }
  });

  it('every pairing ends up with distinguishable kits (away / fallback kits)', () => {
    let changed = 0;
    for (const h of NATIONS)
      for (const a of NATIONS) {
        if (h === a) continue;
        const [hk, ak] = resolveKits(h, a);
        expect(kitsClash(hk, ak), `${h.short} v ${a.short}`).toBe(false);
        if (ak.shirt !== a.primary) changed++;
      }
    expect(changed).toBeGreaterThan(50); // e.g. Spain v Portugal, Denmark v Switzerland…
  });

  it('known clashes switch to the away kit', () => {
    const [, ak] = resolveKits(nationByCode('ESP')!, nationByCode('POR')!);
    expect(ak.shirt).toBe(nationByCode('POR')!.away!.primary);
  });

  it("defaults to the player's country when it is in the list", () => {
    expect(defaultHomeCode('fr-CA')).toBe('CAN');
    expect(defaultHomeCode('en-GB')).toBe('ENG');
    expect(defaultHomeCode('it-IT')).toBe('BRA');
  });
});

describe('key bindings', () => {
  const fresh = () => structuredClone(DEFAULT_BINDINGS) as Record<KeyAction, string[]>;
  it('new defaults: pass on Space, shoot J, through K, lob L', () => {
    expect(DEFAULT_BINDINGS.pass).toEqual(['Space']);
    expect(DEFAULT_BINDINGS.shoot).toEqual(['KeyJ']);
    expect(DEFAULT_BINDINGS.through).toEqual(['KeyK']);
    expect(DEFAULT_BINDINGS.lob).toEqual(['KeyL']);
    // No key does two things.
    const all = Object.values(DEFAULT_BINDINGS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it('rebinding to a key used elsewhere swaps instead of leaving an action without a key', () => {
    const b = fresh();
    const msg = applyBinding(b, 'pass', 'KeyJ', false); // J was shoot
    expect(b.pass[0]).toBe('KeyJ');
    expect(b.shoot).toEqual(['Space']);
    expect(msg).toMatch(/moved/);
  });
  it('an alternative key is added without dropping the main key', () => {
    const b = fresh();
    applyBinding(b, 'pass', 'Enter', true);
    expect(b.pass).toEqual(['Space', 'Enter']);
  });
  it('no two actions ever share a key after any sequence of rebinds', () => {
    const b = fresh();
    const codes = ['KeyJ', 'Space', 'KeyK', 'KeyQ', 'KeyE', 'KeyL', 'Enter', 'KeyF'];
    const acts = Object.keys(b) as KeyAction[];
    for (let i = 0; i < 60; i++) applyBinding(b, acts[(i * 7) % acts.length], codes[(i * 3) % codes.length], i % 3 === 0);
    const all = Object.values(b).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const a of acts) expect(b[a].length).toBeGreaterThan(0);
  });
});

describe('settings migration', () => {
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
  it('returning players keep their keys; untouched old defaults get a one-time offer', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ bindings: LEGACY_BINDINGS_V1 }));
    const s = loadSettings();
    expect(s.bindings.shoot).toEqual(['Space']); // unchanged
    expect(s.offerNewControls).toBe(true);
    expect(s.controls).toBe('advanced');
  });
  it('customised bindings are left alone and not nagged', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ bindings: { ...LEGACY_BINDINGS_V1, pass: ['KeyH'] } }));
    const s = loadSettings();
    expect(s.bindings.pass).toEqual(['KeyH']);
    expect(s.offerNewControls).toBe(false);
  });
  it('the old club selection migrates to national teams', () => {
    store.set('floodlight-fc-settings-v1', JSON.stringify({ homeClub: 2, awayClub: 3 }));
    const s = loadSettings();
    expect(nationByCode(s.homeTeam)).toBeDefined();
    expect(nationByCode(s.awayTeam)).toBeDefined();
  });
});

describe('contextual controls', () => {
  function defendingSetup() {
    const m = makeMatch({ format: '3v3' });
    m.phase = 'playing';
    m.world.restrictTouchTo = null;
    const h = m.human!;
    const opp = m.world.players.find((p) => p.team === 1 && !p.isGK)!;
    clearPitch(m, [h.id, opp.id]);
    opp.place(0, 0, Math.PI);
    m.world.ball.reset(opp.footX(0.5), opp.footZ(0.5));
    h.place(1.2, 0, Math.PI);
    m.world.clearPossession();
    const input = emptyInput();
    input.defendScheme = 'keys';
    for (let i = 0; i < 30; i++) {
      m.step(SIM_DT, input);
      consumeEdges(input);
    }
    return { m, h, input };
  }
  it('keyboard defending: the pass key makes a standing tackle', () => {
    const { m, h, input } = defendingSetup();
    expect(m.world.controller?.team).toBe(1);
    input.buttons.pass.pressed = true;
    input.buttons.pass.down = true;
    m.step(SIM_DT, input);
    consumeEdges(input);
    expect(h.anim).toBe(Anim.Tackle);
  });
  it('keyboard defending: the shoot key slides', () => {
    const { m, h, input } = defendingSetup();
    input.buttons.shoot.pressed = true;
    input.buttons.shoot.down = true;
    m.step(SIM_DT, input);
    consumeEdges(input);
    expect(h.anim).toBe(Anim.Slide);
  });
  it('simple controls: a shot fires on press (no charge needed)', () => {
    const m = makeMatch({ format: '3v3' });
    m.phase = 'playing';
    m.world.restrictTouchTo = null;
    const h = m.human!;
    clearPitch(m, [h.id]);
    h.place(m.world.attackDir(0) * 15, 0, m.world.attackDir(0) > 0 ? 0 : Math.PI);
    m.world.ball.reset(h.footX(0.5), h.footZ(0.5));
    m.world.clearPossession();
    const input = emptyInput();
    input.shotOnPress = true;
    for (let i = 0; i < 30; i++) {
      m.step(SIM_DT, input);
      consumeEdges(input);
    }
    input.buttons.shoot.pressed = true;
    input.buttons.shoot.down = true;
    let kickedAt = -1;
    m.events.on('kick', () => {
      if (kickedAt < 0) kickedAt = m.world.time;
    });
    const t0 = m.world.time;
    for (let i = 0; i < 60; i++) {
      m.step(SIM_DT, input);
      consumeEdges(input);
    }
    expect(kickedAt).toBeGreaterThan(0);
    expect(kickedAt - t0).toBeLessThan(0.2);
  });
});
