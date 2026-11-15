/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/**
 * The XI Nations Cup: a fictional international tournament (see docs/gameplay/tournament.md).
 *
 * This module is the competition itself, with no rendering, DOM or storage:
 * - **draw**: pick the entrants and deal them into groups of four, spreading regions across groups;
 * - **fixtures**: each group plays a round robin over three matchdays, then a knockout bracket;
 * - **results**: the player plays their own team's matches; every other match gets a result from a
 *   small seeded model ({@link simulateResult}), not the full 3D simulation, which would be far too slow
 *   for up to 63 matches;
 * - **progression**: {@link recordResult} stores a result, plays the rest of that round, and creates the
 *   next round once a round is complete.
 *
 * The stored record keeps only the draw and the fixtures with their results. Everything else (tables,
 * the current stage, whether the player is still in, the champion) is *derived* by pure functions, so a
 * save can never hold contradictory state.
 *
 * **Deterministic.** All randomness comes from the tournament's seed through {@link Rng}, mixed with
 * each fixture's id, so reloading a save never rerolls a result and a seed always gives the same cup.
 * **Fair.** Every team has the same strength: the national teams differ in identity, not ability.
 */

import { Rng } from '../../core/rng';
import type { Difficulty, MatchFormat } from '../../sim/config';
import { groupTable } from './standings';

/** Short: 16 teams, 4 groups, quarter-finals. Classic: 32 teams, 8 groups, round of 16. */
export type CupFormat = 'short16' | 'classic32';
/** Knockout rounds, in order. */
export type KnockoutStage = 'R16' | 'QF' | 'SF' | 'F';
export type Stage = 'group' | KnockoutStage;

/** A score; `shootout` only for a knockout match level after normal time (kicks scored each). */
export interface MatchResult {
  home: number;
  away: number;
  shootout?: { home: number; away: number };
  /** True when the player played this match (false: decided by the result model). */
  byPlayer: boolean;
}

export interface Fixture {
  /** Stable, unique id ("G2-3" = group C, third pairing; "QF-1"…). Seeds the result model. */
  id: string;
  stage: Stage;
  /** Group index (0 = A) for group matches. */
  group?: number;
  /** Matchday 1–3 for group matches; for knockouts, the round's position (1 = first round played). */
  round: number;
  home: string;
  away: string;
  result?: MatchResult;
}

/** The match settings the player chose for every match they play in this cup. */
export interface CupSettings {
  format: MatchFormat;
  difficulty: Difficulty;
  minutes: number;
}

/** A tournament in progress (or finished). Plain JSON: this is what is saved. */
export interface Tournament {
  version: 1;
  seed: number;
  format: CupFormat;
  /** The player's team code. */
  team: string;
  settings: CupSettings;
  /** Team codes per group, in drawn order. */
  groups: string[][];
  fixtures: Fixture[];
  createdAt: string;
}

/** A team the cup can draw: its permanent code and region (used to spread regions over groups). */
export interface Entrant {
  code: string;
  region: string;
}

/** Number of groups per format (four teams each). */
export const GROUPS: Record<CupFormat, number> = { short16: 4, classic32: 8 };
/** Knockout rounds per format, in order. */
export const KNOCKOUTS: Record<CupFormat, KnockoutStage[]> = { short16: ['QF', 'SF', 'F'], classic32: ['R16', 'QF', 'SF', 'F'] };
/** Display names. */
export const STAGE_NAMES: Record<Stage, string> = { group: 'Group stage', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', F: 'Final' };
/** Average goals per team per match in the result model (close to real international football). */
export const MEAN_GOALS = 1.3;
/** Chance that a penalty is scored in a simulated shootout. */
export const PENALTY_SCORED = 0.75;

/** Group letter for an index (0 → "A"). */
export const groupLetter = (g: number): string => String.fromCharCode(65 + g);

/** A 32-bit hash of a string mixed with a seed (FNV-1a), for per-fixture and per-team randomness. */
export function hashSeed(seed: number, key: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fisher–Yates shuffle with a seeded generator (returns a new array). */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draws the groups: the player's team plus randomly chosen opponents, dealt so that teams from the same
 * region are spread across groups (like real draws use pots), with the order shuffled within regions.
 * @throws if the catalogue is too small or the player's team isn't in it.
 */
export function drawGroups(catalogue: readonly Entrant[], team: string, format: CupFormat, seed: number): string[][] {
  const groups = GROUPS[format];
  const size = groups * 4;
  const mine = catalogue.find((e) => e.code === team);
  if (!mine) throw new Error(`unknown team ${team}`);
  if (catalogue.length < size) throw new Error(`the cup needs ${size} teams`);
  const rng = new Rng(hashSeed(seed, 'draw'));
  const others = shuffled(
    catalogue.filter((e) => e.code !== team),
    rng,
  ).slice(0, size - 1);
  // Order by region (regions in a shuffled order, teams shuffled within each), then deal across groups:
  // consecutive teams, which mostly share a region, land in different groups.
  const regions = shuffled([...new Set([mine, ...others].map((e) => e.region))], rng);
  const ordered = shuffled([mine, ...others], rng).sort((a, b) => regions.indexOf(a.region) - regions.indexOf(b.region));
  const out: string[][] = Array.from({ length: groups }, () => []);
  ordered.forEach((e, i) => out[i % groups].push(e.code));
  return out;
}

/** Round-robin pairings for a group of four: three matchdays, two matches each. */
const ROUND_ROBIN: Array<[number, number, number]> = [
  [1, 0, 1],
  [1, 2, 3],
  [2, 0, 2],
  [2, 3, 1],
  [3, 3, 0],
  [3, 1, 2],
];

/** Creates a new tournament: draw plus group fixtures. Knockout fixtures are created as rounds finish. */
export function createTournament(o: {
  catalogue: readonly Entrant[];
  team: string;
  format: CupFormat;
  seed: number;
  settings: CupSettings;
  now?: Date;
}): Tournament {
  const groups = drawGroups(o.catalogue, o.team, o.format, o.seed);
  const fixtures: Fixture[] = [];
  groups.forEach((g, gi) =>
    ROUND_ROBIN.forEach(([round, h, a], k) => fixtures.push({ id: `G${gi}-${k + 1}`, stage: 'group', group: gi, round, home: g[h], away: g[a] })),
  );
  // Order fixtures by matchday, so "the next match" is always the earliest one.
  fixtures.sort((x, y) => x.round - y.round || (x.group ?? 0) - (y.group ?? 0));
  return {
    version: 1,
    seed: o.seed >>> 0,
    format: o.format,
    team: o.team,
    settings: { ...o.settings },
    groups,
    fixtures,
    createdAt: (o.now ?? new Date()).toISOString(),
  };
}

/**
 * Result for a match the player doesn't play: each side's goals from a Poisson distribution
 * (mean {@link MEAN_GOALS}), and a shootout for a level knockout match. Seeded by the fixture id, so the
 * same fixture always has the same result.
 */
export function simulateResult(seed: number, fixture: Fixture): MatchResult {
  const rng = new Rng(hashSeed(seed, fixture.id));
  const poisson = (mean: number) => {
    // Knuth's method: count events until the product of uniforms drops below e^-mean.
    const limit = Math.exp(-mean);
    let k = 0,
      p = rng.next();
    while (p > limit && k < 9) {
      k++;
      p *= rng.next();
    }
    return k;
  };
  const r: MatchResult = { home: poisson(MEAN_GOALS), away: poisson(MEAN_GOALS), byPlayer: false };
  if (fixture.stage !== 'group' && r.home === r.away) r.shootout = simulateShootout(rng);
  return r;
}

/** Five kicks each (stopping once decided), then sudden death. Returns the kicks scored. */
export function simulateShootout(rng: Rng): { home: number; away: number } {
  let h = 0,
    a = 0;
  for (let i = 0; i < 5; i++) {
    if (rng.chance(PENALTY_SCORED)) h++;
    if (h > a + (5 - i) || a > h + (4 - i)) break; // one side can't catch up even scoring every kick left
    if (rng.chance(PENALTY_SCORED)) a++;
    if (h > a + (4 - i) || a > h + (4 - i)) break;
  }
  for (let i = 0; h === a && i < 50; i++) {
    const sh = rng.chance(PENALTY_SCORED),
      sa = rng.chance(PENALTY_SCORED);
    h += sh ? 1 : 0;
    a += sa ? 1 : 0;
  }
  if (h === a) h++; // 50 rounds of sudden death all level: practically impossible, but always end
  return { home: h, away: a };
}

/** The winner of a played knockout fixture, or null if not played (or a group match). */
export function winnerOf(f: Fixture): string | null {
  const r = f.result;
  if (!r || f.stage === 'group') return null;
  if (r.home !== r.away) return r.home > r.away ? f.home : f.away;
  if (!r.shootout) return null;
  return r.shootout.home > r.shootout.away ? f.home : f.away;
}

/** The stage currently being played (the earliest with an unplayed fixture), or null when finished. */
export function currentStage(t: Tournament): Stage | null {
  const open = t.fixtures.find((f) => !f.result);
  return open ? open.stage : null;
}

/** Champion's code once the final has been played. */
export function champion(t: Tournament): string | null {
  const final = t.fixtures.find((f) => f.stage === 'F');
  return final ? winnerOf(final) : null;
}

/** The player's next match, or null if they are out or the cup is over. */
export function nextPlayerFixture(t: Tournament): Fixture | null {
  return t.fixtures.find((f) => !f.result && (f.home === t.team || f.away === t.team)) ?? null;
}

/** Whether the player's team still has a match to play. */
export function playerStillIn(t: Tournament): boolean {
  return nextPlayerFixture(t) !== null;
}

/**
 * How far the player got, for history and the final screen: 'champion', 'final', 'SF', 'QF', 'R16',
 * 'group', or null while still in.
 */
export function playerFinish(t: Tournament): 'champion' | Stage | null {
  if (champion(t) === t.team) return 'champion';
  if (nextPlayerFixture(t)) return null;
  const mine = t.fixtures.filter((f) => f.result && (f.home === t.team || f.away === t.team));
  const last = mine[mine.length - 1];
  return last ? last.stage : 'group';
}

/** Knockout pairings for the first knockout round, as [group, position] pairs (position 0 = winner). */
function firstRoundPairs(format: CupFormat): Array<[[number, number], [number, number]]> {
  // Group winners meet runners-up; the two teams from one group are placed in opposite halves of the
  // bracket, so they can only meet again in the final.
  if (format === 'short16')
    return [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [2, 0],
        [3, 1],
      ],
      [
        [1, 0],
        [0, 1],
      ],
      [
        [3, 0],
        [2, 1],
      ],
    ];
  return [
    [
      [0, 0],
      [1, 1],
    ],
    [
      [2, 0],
      [3, 1],
    ],
    [
      [4, 0],
      [5, 1],
    ],
    [
      [6, 0],
      [7, 1],
    ],
    [
      [1, 0],
      [0, 1],
    ],
    [
      [3, 0],
      [2, 1],
    ],
    [
      [5, 0],
      [4, 1],
    ],
    [
      [7, 0],
      [6, 1],
    ],
  ];
}

/** Creates the next knockout round if the current round is complete; returns the same record otherwise. */
function addNextRound(t: Tournament): Tournament {
  if (t.fixtures.some((f) => !f.result)) return t;
  const stages = KNOCKOUTS[t.format];
  const last = t.fixtures[t.fixtures.length - 1];
  let next: Fixture[] = [];
  if (last.stage === 'group') {
    const tables = t.groups.map((_, g) => groupTable(t, g));
    next = firstRoundPairs(t.format).map(([[g1, p1], [g2, p2]], i) => ({
      id: `${stages[0]}-${i + 1}`,
      stage: stages[0],
      round: 1,
      home: tables[g1][p1].team,
      away: tables[g2][p2].team,
    }));
  } else if (last.stage !== 'F') {
    const prev = t.fixtures.filter((f) => f.stage === last.stage);
    const stage = stages[stages.indexOf(last.stage) + 1];
    // Winners of neighbouring ties meet: 1 v 2, 3 v 4… (the bracket order set in the first round).
    for (let i = 0; i < prev.length; i += 2) {
      next.push({ id: `${stage}-${i / 2 + 1}`, stage, round: last.round + 1, home: winnerOf(prev[i])!, away: winnerOf(prev[i + 1])! });
    }
  }
  return next.length ? { ...t, fixtures: [...t.fixtures, ...next] } : t;
}

/**
 * Plays every unplayed fixture of the earliest open round that doesn't involve the player, then creates
 * the next round if that round is complete. Repeats until the player has a match to play, or the cup
 * is over. Once the player is knocked out, this plays the cup to the end, so the champion can be shown.
 * Pure: returns a new record.
 */
export function advance(t: Tournament): Tournament {
  let cur = t;
  for (let guard = 0; guard < 20; guard++) {
    const open = cur.fixtures.find((f) => !f.result);
    if (!open) {
      const grown = addNextRound(cur);
      if (grown === cur) return cur; // final played
      cur = grown;
      continue;
    }
    const sameRound = (f: Fixture) => f.stage === open.stage && f.round === open.round;
    const waitingForPlayer = cur.fixtures.some((f) => !f.result && sameRound(f) && (f.home === cur.team || f.away === cur.team));
    if (waitingForPlayer) return cur;
    cur = { ...cur, fixtures: cur.fixtures.map((f) => (!f.result && sameRound(f) ? { ...f, result: simulateResult(cur.seed, f) } : f)) };
  }
  return cur;
}

/**
 * Stores the player's result for their next fixture, then {@link advance}s. A level knockout result
 * needs the shootout score.
 * @throws if `fixtureId` isn't the player's next match, or the result is incomplete.
 */
export function recordResult(t: Tournament, fixtureId: string, result: Omit<MatchResult, 'byPlayer'>): Tournament {
  const next = nextPlayerFixture(t);
  if (!next || next.id !== fixtureId) throw new Error(`${fixtureId} is not the player's next match`);
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n < 100;
  if (!ok(result.home) || !ok(result.away)) throw new Error('invalid score');
  const knockoutDraw = next.stage !== 'group' && result.home === result.away;
  if (knockoutDraw && (!result.shootout || result.shootout.home === result.shootout.away || !ok(result.shootout.home) || !ok(result.shootout.away)))
    throw new Error('a level knockout match needs a decisive shootout');
  const stored: MatchResult = { home: result.home, away: result.away, byPlayer: true, ...(knockoutDraw ? { shootout: { ...result.shootout! } } : {}) };
  return advance({ ...t, fixtures: t.fixtures.map((f) => (f.id === fixtureId ? { ...f, result: stored } : f)) });
}
