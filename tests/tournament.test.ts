/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// XI Nations Cup: draw, fixtures, standings and tiebreakers, simulated results, knockout progression and
// saving. All pure and seeded, so every behaviour is tested without a browser.
import { afterEach, describe, expect, it } from 'vitest';
import {
  GROUPS,
  advance,
  champion,
  createTournament,
  currentStage,
  drawGroups,
  nextPlayerFixture,
  playerFinish,
  recordResult,
  simulateResult,
  type CupFormat,
  type Fixture,
  type Tournament,
} from '../src/game/tournament/cup';
import { groupTable } from '../src/game/tournament/standings';
import { emptyCupRecord, loadCupRecord, parseCupRecord, parseTournament, saveCupRecord } from '../src/game/tournament/record';
import { NATIONS } from '../src/sim/nations';
import { STORAGE_KEYS } from '../src/game/storage';
import { exportSaveData, readSaveFile } from '../src/game/saveData';

const catalogue = NATIONS.map((n) => ({ code: n.short, region: n.region ?? 'Other' }));
const settings = { format: '5v5' as const, difficulty: 'easy' as const, minutes: 4 };
const make = (format: CupFormat = 'short16', seed = 42, team = 'CAN') =>
  advance(createTournament({ catalogue, team, format, seed, settings, now: new Date('2026-11-15T12:00:00Z') }));

/** Plays the player's matches with a fixed policy until they're out or the cup is over. */
function playThrough(t: Tournament, policy: (f: Fixture) => { home: number; away: number; shootout?: { home: number; away: number } }): Tournament {
  for (let next = nextPlayerFixture(t), guard = 0; next && guard < 10; next = nextPlayerFixture(t), guard++) t = recordResult(t, next.id, policy(next));
  return t;
}
const playerWins = (t: Tournament) => (f: Fixture) => (f.home === t.team ? { home: 2, away: 0 } : { home: 0, away: 2 });
function recordUntilKnockout(t: Tournament): Tournament {
  for (let next = nextPlayerFixture(t); next && next.stage === 'group'; next = nextPlayerFixture(t)) t = recordResult(t, next.id, playerWins(t)(next));
  return t;
}
const playerLoses = (t: Tournament) => (f: Fixture) => (f.home === t.team ? { home: 0, away: 1 } : { home: 1, away: 0 });

describe('draw', () => {
  it('draws the right number of distinct teams, including the player, in groups of four', () => {
    for (const format of ['short16', 'classic32'] as const) {
      const groups = drawGroups(catalogue, 'MAR', format, 7);
      expect(groups).toHaveLength(GROUPS[format]);
      const all = groups.flat();
      expect(groups.every((g) => g.length === 4)).toBe(true);
      expect(new Set(all).size).toBe(all.length);
      expect(all).toContain('MAR');
    }
  });

  it('spreads teams from one region across groups where it can', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const groups = drawGroups(catalogue, 'BRA', 'classic32', seed);
      const region = new Map(catalogue.map((e) => [e.code, e.region]));
      const counts = new Map<string, number>();
      for (const c of groups.flat()) counts.set(region.get(c)!, (counts.get(region.get(c)!) ?? 0) + 1);
      for (const g of groups) {
        for (const [r, n] of counts) {
          const inGroup = g.filter((c) => region.get(c) === r).length;
          expect(inGroup).toBeLessThanOrEqual(Math.ceil(n / groups.length));
        }
      }
    }
  });

  it('is deterministic for a seed, and different seeds give different draws', () => {
    expect(drawGroups(catalogue, 'CAN', 'short16', 5)).toEqual(drawGroups(catalogue, 'CAN', 'short16', 5));
    expect(drawGroups(catalogue, 'CAN', 'short16', 5)).not.toEqual(drawGroups(catalogue, 'CAN', 'short16', 6));
  });
});

describe('fixtures', () => {
  it('every group is a round robin over three matchdays', () => {
    const t = createTournament({ catalogue, team: 'CAN', format: 'short16', seed: 1, settings });
    expect(t.fixtures).toHaveLength(24);
    t.groups.forEach((g, gi) => {
      const fx = t.fixtures.filter((f) => f.group === gi);
      const pairs = new Set(fx.map((f) => [f.home, f.away].sort().join('-')));
      expect(pairs.size).toBe(6);
      for (const team of g) for (const round of [1, 2, 3]) expect(fx.filter((f) => f.round === round && (f.home === team || f.away === team))).toHaveLength(1);
    });
  });

  it("plays the other matches of a round before the player's match is due, and no further", () => {
    const t = make();
    const next = nextPlayerFixture(t)!;
    expect(next.round).toBe(1);
    expect(t.fixtures.filter((f) => f.result).every((f) => f.round === 1 && f.home !== t.team && f.away !== t.team)).toBe(true);
    expect(t.fixtures.filter((f) => f.round > 1 && f.result)).toHaveLength(0);
  });
});

describe('standings', () => {
  const base = createTournament({ catalogue, team: 'CAN', format: 'short16', seed: 3, settings });
  const g = 0;
  const [a, b, c, d] = base.groups[g];
  const withResults = (scores: Record<string, [number, number]>): Tournament => ({
    ...base,
    fixtures: base.fixtures.map((f) => {
      const key = `${f.home}-${f.away}`;
      return f.group === g && scores[key] ? { ...f, result: { home: scores[key][0], away: scores[key][1], byPlayer: false } } : f;
    }),
  });
  const fx = base.fixtures.filter((f) => f.group === g);
  const score = (x: string, y: string, sx: number, sy: number): Record<string, [number, number]> => {
    const f = fx.find((q) => (q.home === x && q.away === y) || (q.home === y && q.away === x))!;
    return { [`${f.home}-${f.away}`]: f.home === x ? [sx, sy] : [sy, sx] };
  };

  it('ranks by points, then goal difference, then goals scored', () => {
    const t = withResults({
      ...score(a, b, 3, 0),
      ...score(c, d, 1, 0),
      ...score(a, c, 0, 0),
      ...score(b, d, 2, 2),
      ...score(a, d, 1, 1),
      ...score(b, c, 4, 4),
    });
    const table = groupTable(t, g);
    expect(table.map((r) => r.team)[0]).toBe(a); // 5 pts
    expect(table[0]).toMatchObject({ played: 3, won: 1, drawn: 2, lost: 0, points: 5, goalsFor: 4, goalsAgainst: 1 });
    // c: 1 win 2 draws = 5 pts too, but goal difference +1 v a's +3
    expect(table[1].team).toBe(c);
    // b and d: 2 pts each; b scored 6, d 3 (goal difference b −3, d −1, so d first)
    expect(table.map((r) => r.team).slice(2)).toEqual([d, b]);
  });

  it('separates teams level on all of that by the match between them', () => {
    // a and b finish level on points, goal difference and goals scored; a beat b, so a ranks higher.
    const t = withResults({
      ...score(a, b, 1, 0),
      ...score(a, c, 0, 1),
      ...score(b, c, 1, 0),
      ...score(a, d, 1, 0),
      ...score(b, d, 1, 0),
      ...score(c, d, 0, 1),
    });
    const table = groupTable(t, g);
    const ra = table.find((r) => r.team === a)!,
      rb = table.find((r) => r.team === b)!;
    expect([ra.points, ra.goalsFor - ra.goalsAgainst, ra.goalsFor]).toEqual([rb.points, rb.goalsFor - rb.goalsAgainst, rb.goalsFor]);
    expect(table.findIndex((r) => r.team === a)).toBeLessThan(table.findIndex((r) => r.team === b));
  });

  it('decides a complete tie by a seeded drawing of lots: stable for the cup, different across seeds', () => {
    const allDraws = { ...score(a, b, 1, 1), ...score(c, d, 1, 1), ...score(a, c, 1, 1), ...score(b, d, 1, 1), ...score(a, d, 1, 1), ...score(b, c, 1, 1) };
    const t = withResults(allDraws);
    const order = groupTable(t, g).map((r) => r.team);
    expect(groupTable(t, g).map((r) => r.team)).toEqual(order);
    const orders = new Set<string>();
    for (let seed = 0; seed < 12; seed++)
      orders.add(
        groupTable({ ...t, seed }, g)
          .map((r) => r.team)
          .join(),
      );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('results of other matches', () => {
  it('are deterministic per fixture, plausible, and knockout draws always have a winner', () => {
    const f: Fixture = { id: 'QF-2', stage: 'QF', round: 1, home: 'FRA', away: 'BRA' };
    expect(simulateResult(9, f)).toEqual(simulateResult(9, f));
    let goals = 0,
      n = 0;
    for (let seed = 0; seed < 400; seed++) {
      const r = simulateResult(seed, f);
      goals += r.home + r.away;
      n++;
      if (r.home === r.away) expect(r.shootout && r.shootout.home !== r.shootout.away).toBe(true);
      else expect(r.shootout).toBeUndefined();
    }
    expect(goals / n).toBeGreaterThan(2.0);
    expect(goals / n).toBeLessThan(3.2);
  });

  it('reloading a save never rerolls results', () => {
    const t = make('classic32', 77);
    const reloaded = parseTournament(JSON.parse(JSON.stringify(t)))!;
    const next = nextPlayerFixture(t)!;
    const r = { home: 1, away: 1 };
    expect(recordResult(reloaded, next.id, r)).toEqual(recordResult(t, next.id, r));
  });
});

describe('knockouts', () => {
  for (const [format, total] of [
    ['short16', 31],
    ['classic32', 63],
  ] as const) {
    it(`${format}: a player who wins everything lifts the trophy after ${total} matches`, () => {
      const t0 = make(format, 11);
      const t = playThrough(t0, playerWins(t0));
      expect(t.fixtures).toHaveLength(total);
      expect(t.fixtures.every((f) => f.result)).toBe(true);
      expect(champion(t)).toBe(t.team);
      expect(playerFinish(t)).toBe('champion');
      expect(currentStage(t)).toBeNull();
    });
  }

  it('a player knocked out in the groups still sees the cup played to a champion', () => {
    const t0 = make('short16', 12);
    const t = playThrough(t0, playerLoses(t0));
    expect(playerFinish(t)).toBe('group');
    expect(champion(t)).not.toBeNull();
    expect(champion(t)).not.toBe(t.team);
    expect(t.fixtures.filter((f) => f.result?.byPlayer)).toHaveLength(3);
  });

  it('teams from the same group can only meet again in the final', () => {
    const t0 = make('classic32', 13);
    const t = playThrough(t0, playerWins(t0));
    const r16 = t.fixtures.filter((f) => f.stage === 'R16');
    const half = (team: string) => (r16.findIndex((f) => f.home === team || f.away === team) < 4 ? 'top' : 'bottom');
    t.groups.forEach((_, gi) => {
      const done = groupTable(t, gi);
      expect(half(done[0].team)).not.toBe(half(done[1].team));
    });
  });

  it('a level knockout match needs a decisive shootout, and the shootout decides who goes through', () => {
    const t0 = make('short16', 14);
    const viaShootouts = playThrough(t0, (f) =>
      f.stage === 'group' ? playerWins(t0)(f) : { home: 1, away: 1, shootout: f.home === t0.team ? { home: 4, away: 2 } : { home: 2, away: 4 } },
    );
    expect(champion(viaShootouts)).toBe(t0.team);
    const ko = playThrough(t0, (f) => (f.stage === 'group' ? playerWins(t0)(f) : { home: 1, away: 1, shootout: { home: 5, away: 4 } }));
    expect(ko.fixtures.some((f) => f.stage !== 'group')).toBe(true);
    // At the first knockout match: refuse a draw without a shootout, or with a level one.
    const atKnockout = recordUntilKnockout(t0);
    const qf = nextPlayerFixture(atKnockout)!;
    expect(qf.stage).toBe('QF');
    expect(() => recordResult(atKnockout, qf.id, { home: 1, away: 1 })).toThrow(/shootout/);
    expect(() => recordResult(atKnockout, qf.id, { home: 1, away: 1, shootout: { home: 3, away: 3 } })).toThrow(/shootout/);
  });

  it("refuses a result for anything but the player's next match", () => {
    const t = make();
    const other = t.fixtures.find((f) => f.home !== t.team && f.away !== t.team && !f.result)!;
    expect(() => recordResult(t, other.id, { home: 1, away: 0 })).toThrow();
    expect(() => recordResult(t, nextPlayerFixture(t)!.id, { home: -1, away: 0 })).toThrow();
  });
});

describe('saving', () => {
  type G = { localStorage?: unknown };
  const store = new Map<string, string>();
  const fake = () => {
    store.clear();
    (globalThis as G).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  };
  afterEach(() => delete (globalThis as G).localStorage);

  it('round-trips through storage between matches (closing the browser resumes the same cup)', () => {
    fake();
    const t0 = make('classic32', 21);
    const t1 = recordResult(t0, nextPlayerFixture(t0)!.id, { home: 2, away: 1 });
    expect(saveCupRecord({ ...emptyCupRecord(), active: t1 })).toBe(true);
    const back = loadCupRecord();
    expect(back.active).toEqual(t1);
    expect(nextPlayerFixture(back.active!)).toEqual(nextPlayerFixture(t1));
  });

  it('never half-loads a damaged or unknown-version record, and keeps a recovery copy', () => {
    fake();
    store.set(STORAGE_KEYS.tournament, JSON.stringify({ version: 2, active: null, history: [] }));
    expect(loadCupRecord()).toEqual(emptyCupRecord());
    expect(store.has(`${STORAGE_KEYS.tournament}:corrupt`)).toBe(true);
    const t = make();
    for (const broken of [
      { ...t, groups: t.groups.slice(1) },
      { ...t, team: 'ZZZ' },
      { ...t, fixtures: [{ ...t.fixtures[0], home: t.fixtures[0].away }] },
      { ...t, fixtures: [{ ...t.fixtures[0], result: { home: 1, away: 'x', byPlayer: false } }] },
      { ...t, seed: -1 },
      { ...t, settings: { ...t.settings, minutes: 999 } },
    ])
      expect(parseTournament(broken)).toBeNull();
    expect(
      parseCupRecord({
        version: 1,
        active: null,
        history: [{ format: 'short16', team: 'CAN', finish: 'winner', champion: 'BRA', finishedAt: '2026-11-15T00:00:00Z' }],
      }),
    ).toBeNull();
  });

  it('is included in exported saved data and validated on import', () => {
    fake();
    saveCupRecord({ ...emptyCupRecord(), active: make() });
    const text = exportSaveData();
    const read = readSaveFile(text);
    expect(read.ok && read.file.data.tournament?.active?.team).toBe('CAN');
    const bad = JSON.parse(text);
    bad.data.tournament.active.groups = [];
    const refused = readSaveFile(JSON.stringify(bad));
    expect(refused.ok).toBe(false);
  });
});
