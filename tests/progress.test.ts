/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  emptyProgress,
  loadProgress,
  parseProgress,
  recordMatch,
  recordTutorialCompleted,
  saveProgress,
  summariseMatch,
  type MatchSummary,
} from '../src/game/progress';
import { ACHIEVEMENTS, ACHIEVEMENT_IDS } from '../src/game/achievements';
import { MAX_IMPORT_BYTES, SAVE_FORMAT, applySaveFile, exportSaveData, readSaveFile, resetAllData, resetProgress } from '../src/game/saveData';
import { STORAGE_KEYS } from '../src/game/storage';
import { loadSettings, saveSettings } from '../src/game/settings';
import { Match } from '../src/sim/match';
import { SIM_DT } from '../src/sim/config';
import { NATIONS } from '../src/sim/nations';

type G = { localStorage?: unknown };
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as G).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => {
  delete (globalThis as G).localStorage;
});

let n = 0;
/** A finished match from the player's (team 0) point of view. */
function summary(over: Partial<MatchSummary> = {}): MatchSummary {
  const goalsFor = over.goalsFor ?? 0,
    goalsAgainst = over.goalsAgainst ?? 0;
  return {
    id: `m${n++}`,
    mode: 'match',
    difficulty: 'easy',
    format: '5v5',
    team: 'BRA',
    opponent: 'FRA',
    goalsFor,
    goalsAgainst,
    goals: [
      ...Array.from({ length: goalsFor }, () => ({ team: 0 as const, scorerId: 4, ownGoal: false })),
      ...Array.from({ length: goalsAgainst }, () => ({ team: 1 as const, scorerId: 9, ownGoal: false })),
    ],
    kicks: [],
    winner: goalsFor > goalsAgainst ? 0 : goalsFor < goalsAgainst ? 1 : null,
    finishedAt: '2026-11-15T10:00:00.000Z',
    ...over,
  };
}

describe('match statistics', () => {
  it('a win, a draw and a loss update the record and personal bests', () => {
    let p = emptyProgress();
    p = recordMatch(p, summary({ goalsFor: 3, goalsAgainst: 1 })).progress;
    p = recordMatch(p, summary({ goalsFor: 0, goalsAgainst: 0 })).progress;
    p = recordMatch(p, summary({ goalsFor: 1, goalsAgainst: 2, difficulty: 'hard' })).progress;
    expect(p.stats).toMatchObject({
      played: 3,
      won: 1,
      drawn: 1,
      lost: 1,
      goalsFor: 4,
      goalsAgainst: 3,
      cleanSheets: 1,
      mostGoalsInMatch: 3,
      biggestWin: { for: 3, against: 1 },
    });
    expect(p.stats.byDifficulty.easy).toEqual({ played: 2, won: 1 });
    expect(p.stats.byDifficulty.hard).toEqual({ played: 1, won: 0 });
    expect(p.history.map((h) => h.result)).toEqual(['loss', 'draw', 'win']); // most recent first
  });

  it('the same match is never counted twice', () => {
    const s = summary({ goalsFor: 2 });
    const once = recordMatch(emptyProgress(), s).progress;
    const twice = recordMatch(once, s);
    expect(twice.progress.stats.played).toBe(1);
    expect(twice.unlocked).toEqual([]);
  });

  it('recording is pure: the previous record is not modified', () => {
    const before = emptyProgress();
    recordMatch(before, summary({ goalsFor: 1 }));
    expect(before.stats.played).toBe(0);
  });

  it('shootouts count separately from matches, including saves by the player’s keeper', () => {
    const p = recordMatch(
      emptyProgress(),
      summary({
        mode: 'penalties',
        goalsFor: 4,
        goalsAgainst: 3,
        goals: [],
        winner: 0,
        kicks: [
          { team: 1, scored: false, saved: true },
          { team: 1, scored: false, saved: false }, // a miss is not a save
          { team: 0, scored: false, saved: true }, // the opponent's keeper saved ours
        ],
      }),
    ).progress;
    expect(p.stats.played).toBe(0);
    expect(p.stats.shootoutsWon).toBe(1);
    expect(p.stats.penaltySaves).toBe(1);
  });

  it('keeps a bounded history', () => {
    let p = emptyProgress();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) p = recordMatch(p, summary()).progress;
    expect(p.history).toHaveLength(HISTORY_LIMIT);
    expect(p.stats.played).toBe(HISTORY_LIMIT + 5);
  });

  it('a summary built from a real simulated match matches the simulation’s score and goal log', () => {
    const m = new Match({ mode: 'match', format: '3v3', difficulty: 'easy', duration: 30, seed: 3, replays: false, aiOnly: true });
    for (let i = 0; i < 20000 && m.phase !== 'fullTime'; i++) m.step(SIM_DT, null);
    expect(m.phase).toBe('fullTime');
    const s = summariseMatch(m, { id: 'x', team: 'BRA', opponent: 'FRA', finishedAt: new Date('2026-11-15T10:00:00Z') });
    expect([s.goalsFor, s.goalsAgainst]).toEqual([m.score[0], m.score[1]]);
    expect(s.goals.filter((g) => g.team === 0)).toHaveLength(m.score[0]);
    expect(s.winner).toBe(m.winner);
  });
});

describe('achievements', () => {
  it('ids are unique and every definition has a name and a visible condition', () => {
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENT_IDS.length);
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual([...ACHIEVEMENT_IDS]);
    for (const a of ACHIEVEMENTS) expect(a.name && a.description).toBeTruthy();
  });

  it('a first win unlocks First Goal, First Victory and Clean Sheet once, with a timestamp', () => {
    const r = recordMatch(emptyProgress(), summary({ goalsFor: 2 }));
    expect(r.unlocked.sort()).toEqual(['clean-sheet', 'first-goal', 'first-win']);
    expect(r.progress.achievements['first-win']?.unlockedAt).toBe('2026-11-15T10:00:00.000Z');
    const again = recordMatch(r.progress, summary({ goalsFor: 1 }));
    expect(again.unlocked).toEqual([]);
  });

  it('a defeat unlocks nothing', () => {
    expect(recordMatch(emptyProgress(), summary({ goalsAgainst: 1 })).unlocked).toEqual([]);
  });

  it('hat-trick needs three goals by one player, own goals excluded', () => {
    const three = summary({ goalsFor: 3 }); // all by player 4
    expect(recordMatch(emptyProgress(), three).unlocked).toContain('hat-trick');
    const spread = summary({ goalsFor: 3, goals: [4, 5, 6].map((id) => ({ team: 0 as const, scorerId: id, ownGoal: false })) });
    expect(recordMatch(emptyProgress(), spread).unlocked).not.toContain('hat-trick');
    const withOg = summary({
      goalsFor: 3,
      goals: [
        { team: 0, scorerId: 4, ownGoal: false },
        { team: 0, scorerId: 4, ownGoal: false },
        { team: 0, scorerId: 9, ownGoal: true },
      ],
    });
    expect(recordMatch(emptyProgress(), withOg).unlocked).not.toContain('hat-trick');
  });

  it('comeback needs a win after trailing by two', () => {
    const goals = [1, 1, 0, 0, 0].map((team) => ({ team: team as 0 | 1, scorerId: team ? 9 : 4, ownGoal: false }));
    expect(recordMatch(emptyProgress(), summary({ goalsFor: 3, goalsAgainst: 2, goals })).unlocked).toContain('comeback');
    const neverTwoDown = [1, 0, 1, 0, 0].map((team) => ({ team: team as 0 | 1, scorerId: 4, ownGoal: false }));
    expect(recordMatch(emptyProgress(), summary({ goalsFor: 3, goalsAgainst: 2, goals: neverTwoDown })).unlocked).not.toContain('comeback');
  });

  it('Around the World needs wins with three different countries; Top Level needs a win on Hard', () => {
    let p = emptyProgress();
    let r = recordMatch(p, summary({ goalsFor: 1, team: 'BRA' }));
    r = recordMatch(r.progress, summary({ goalsFor: 1, team: 'BRA' }));
    r = recordMatch(r.progress, summary({ goalsFor: 1, team: 'JPN' }));
    expect(r.progress.achievements['three-countries']).toBeUndefined();
    r = recordMatch(r.progress, summary({ goalsFor: 1, team: 'GHA', difficulty: 'hard' }));
    expect(r.unlocked.sort()).toEqual(['three-countries', 'win-hard']);
    p = r.progress;
    expect(p.stats.teamsWonWith).toEqual(['BRA', 'JPN', 'GHA']);
  });

  it('the tutorial achievement unlocks once', () => {
    const r = recordTutorialCompleted(emptyProgress(), new Date('2026-11-15T10:00:00Z'));
    expect(r.unlocked).toEqual(['tutorial-complete']);
    expect(recordTutorialCompleted(r.progress, new Date()).unlocked).toEqual([]);
  });
});

describe('progress persistence', () => {
  it('a record that has won with every country in the catalogue still validates (codes are stable ids)', () => {
    let p = emptyProgress();
    for (const n of NATIONS) p = recordMatch(p, summary({ goalsFor: 1, team: n.short, opponent: NATIONS[0].short })).progress;
    expect(p.stats.teamsWonWith).toHaveLength(NATIONS.length);
    expect(parseProgress(structuredClone(p))).toEqual(p);
  });

  it('first-time player: an empty record; saved records load back identically', () => {
    expect(loadProgress()).toEqual(emptyProgress());
    const p = recordMatch(emptyProgress(), summary({ goalsFor: 2 })).progress;
    saveProgress(p);
    expect(loadProgress()).toEqual(p);
  });

  it('storage blocked: the game keeps working and remembers for the session', () => {
    (globalThis as G).localStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const p = recordMatch(emptyProgress(), summary({ goalsFor: 1 })).progress;
    expect(saveProgress(p)).toBe(false);
    expect(loadProgress().stats.played).toBe(1);
  });

  it('damaged data gives a fresh record and keeps the original as a recovery copy', () => {
    store.set(STORAGE_KEYS.progress, JSON.stringify({ version: 1, stats: { played: -3 } }));
    expect(loadProgress()).toEqual(emptyProgress());
    expect(store.get(`${STORAGE_KEYS.progress}:corrupt`)).toContain('"played":-3');
  });

  it('validation is strict: wrong types, unknown achievements, a newer version or absurd numbers are rejected', () => {
    const good = recordMatch(emptyProgress(), summary({ goalsFor: 2 })).progress;
    expect(parseProgress(structuredClone(good))).toEqual(good);
    const bad = (mutate: (p: Record<string, any>) => void) => {
      const p = structuredClone(good) as unknown as Record<string, any>;
      mutate(p);
      return parseProgress(p);
    };
    expect(bad((p) => (p.version = 2))).toBeNull();
    expect(bad((p) => (p.stats.won = '1'))).toBeNull();
    expect(bad((p) => (p.stats.goalsFor = 1e12))).toBeNull();
    expect(bad((p) => (p.achievements['made-up'] = { unlockedAt: '2026-01-01T00:00:00Z' }))).toBeNull();
    expect(bad((p) => (p.stats.teamsWonWith = ['<img src=x onerror=alert(1)>']))).toBeNull();
    expect(bad((p) => (p.history[0].team = 'not a code'))).toBeNull();
    expect(bad((p) => (p.stats.byDifficulty.easy = { played: 1, won: 5 }))).toBeNull();
  });
});

describe('export, import and reset', () => {
  it('export → import round trip restores settings and progress exactly', () => {
    const s = loadSettings();
    s.minutes = 6;
    s.squad = 'women';
    saveSettings(s);
    const p = recordMatch(emptyProgress(), summary({ goalsFor: 3, goalsAgainst: 1 })).progress;
    saveProgress(p);
    const text = exportSaveData(new Date('2026-11-15T12:00:00Z'));
    expect(JSON.parse(text)).toMatchObject({ format: SAVE_FORMAT, version: 1, exportedAt: '2026-11-15T12:00:00.000Z' });
    resetAllData();
    expect(loadProgress()).toEqual(emptyProgress());
    const r = readSaveFile(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toBe('settings and 1 match and 3 achievements');
    applySaveFile(r.file);
    expect(loadProgress()).toEqual(p);
    expect(loadSettings()).toMatchObject({ minutes: 6, squad: 'women' });
  });

  it('rejects files that are too big, not JSON, of another format, from a newer version or damaged — and changes nothing', () => {
    saveProgress(recordMatch(emptyProgress(), summary({ goalsFor: 1 })).progress);
    const before = new Map(store);
    const cases: Array<[string, RegExp]> = [
      ['x'.repeat(MAX_IMPORT_BYTES + 1), /too large/],
      ['{not json', /valid JSON/],
      [JSON.stringify({ format: 'something-else', version: 1, data: {} }), /from this game/],
      [JSON.stringify({ format: SAVE_FORMAT, version: 99, data: {} }), /newer version/],
      [JSON.stringify({ format: SAVE_FORMAT, version: 1, data: { progress: { version: 1 } } }), /damaged/],
      [JSON.stringify({ format: SAVE_FORMAT, version: 1, data: { scripts: 'alert(1)' } }), /unexpected/],
      [JSON.stringify({ format: SAVE_FORMAT, version: 1, data: {} }), /empty/],
    ];
    for (const [text, msg] of cases) {
      const r = readSaveFile(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
    expect(store).toEqual(before);
  });

  it('imported settings are sanitised like stored ones (invalid values fall back to defaults)', () => {
    const r = readSaveFile(JSON.stringify({ format: SAVE_FORMAT, version: 1, data: { settings: { difficulty: 'impossible', minutes: 2 } } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.data.settings).toEqual({ minutes: 2 });
  });

  it('reset records keeps settings; reset everything removes all saved keys and recovery copies', () => {
    const s = loadSettings();
    s.minutes = 8;
    saveSettings(s);
    saveProgress(recordMatch(emptyProgress(), summary({ goalsFor: 1 })).progress);
    store.set(`${STORAGE_KEYS.progress}:corrupt`, 'old');
    resetProgress();
    expect(loadProgress()).toEqual(emptyProgress());
    expect(store.has(`${STORAGE_KEYS.progress}:corrupt`)).toBe(false);
    expect(loadSettings().minutes).toBe(8);
    resetAllData();
    expect(store.size).toBe(0);
  });
});
