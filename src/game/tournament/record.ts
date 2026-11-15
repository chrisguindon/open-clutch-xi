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
 * Saving the XI Nations Cup: the cup in progress and past finishes, in one record (`tournament-v1`).
 *
 * Like the player's progress (src/game/progress.ts), the record is validated strictly when loaded or
 * imported: anything malformed is rejected as a whole, never half-loaded, and the stored text is kept as
 * a recovery copy before the game starts afresh. A save is written after every match, so closing the
 * browser between matches loses nothing; quitting during a match simply replays that match.
 */

import { STORAGE_KEYS, isRecord, keepRecoveryCopy, readJson, writeJson } from '../storage';
import { GROUPS, KNOCKOUTS, type CupFormat, type Fixture, type MatchResult, type Stage, type Tournament } from './cup';

/** One finished cup, for the records screen. */
export interface CupHistoryEntry {
  format: CupFormat;
  team: string;
  /** How far the player got. */
  finish: 'champion' | Stage;
  champion: string;
  finishedAt: string;
}

export interface CupRecord {
  version: 1;
  /** The cup in progress (finished cups stay here until a new one starts, so the result can be viewed). */
  active: Tournament | null;
  /** Finished cups, newest first (at most {@link MAX_HISTORY}). */
  history: CupHistoryEntry[];
}

export const MAX_HISTORY = 20;
const STAGES: readonly Stage[] = ['group', 'R16', 'QF', 'SF', 'F'];
const FORMATS: readonly CupFormat[] = ['short16', 'classic32'];
const code = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{2,4}$/.test(v);
const score = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100;
const iso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

export const emptyCupRecord = (): CupRecord => ({ version: 1, active: null, history: [] });

function parseResult(v: unknown): MatchResult | null | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v) || !score(v.home) || !score(v.away) || typeof v.byPlayer !== 'boolean') return null;
  const r: MatchResult = { home: v.home, away: v.away, byPlayer: v.byPlayer };
  if (v.shootout !== undefined) {
    if (!isRecord(v.shootout) || !score(v.shootout.home) || !score(v.shootout.away)) return null;
    r.shootout = { home: v.shootout.home, away: v.shootout.away };
  }
  return r;
}

/** Validates a stored tournament. Returns null for anything malformed or inconsistent. */
export function parseTournament(v: unknown): Tournament | null {
  if (!isRecord(v) || v.version !== 1 || !FORMATS.includes(v.format as CupFormat) || !code(v.team) || !iso(v.createdAt)) return null;
  if (typeof v.seed !== 'number' || !Number.isInteger(v.seed) || v.seed < 0 || v.seed > 0xffffffff) return null;
  const format = v.format as CupFormat;
  const s = v.settings;
  if (!isRecord(s) || !['3v3', '5v5', '11v11'].includes(s.format as string) || !['beginner', 'easy', 'medium', 'hard'].includes(s.difficulty as string))
    return null;
  if (typeof s.minutes !== 'number' || !(s.minutes >= 1 && s.minutes <= 20)) return null;
  if (!Array.isArray(v.groups) || v.groups.length !== GROUPS[format]) return null;
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const g of v.groups) {
    if (!Array.isArray(g) || g.length !== 4 || !g.every(code)) return null;
    for (const t of g as string[]) {
      if (seen.has(t)) return null;
      seen.add(t);
    }
    groups.push([...(g as string[])]);
  }
  if (!seen.has(v.team)) return null;
  if (!Array.isArray(v.fixtures) || v.fixtures.length > 200) return null;
  const fixtures: Fixture[] = [];
  const ids = new Set<string>();
  for (const f of v.fixtures) {
    if (!isRecord(f) || typeof f.id !== 'string' || f.id.length > 12 || ids.has(f.id) || !STAGES.includes(f.stage as Stage)) return null;
    if (f.stage !== 'group' && !KNOCKOUTS[format].includes(f.stage as Exclude<Stage, 'group'>)) return null;
    if (!code(f.home) || !code(f.away) || f.home === f.away || !seen.has(f.home) || !seen.has(f.away)) return null;
    if (typeof f.round !== 'number' || !Number.isInteger(f.round) || f.round < 1 || f.round > 5) return null;
    if (f.stage === 'group' && (typeof f.group !== 'number' || !Number.isInteger(f.group) || f.group < 0 || f.group >= groups.length)) return null;
    const result = parseResult(f.result);
    if (result === null) return null;
    const out: Fixture = { id: f.id, stage: f.stage as Stage, round: f.round, home: f.home, away: f.away };
    if (f.stage === 'group') out.group = f.group as number;
    if (result) out.result = result;
    ids.add(f.id);
    fixtures.push(out);
  }
  return {
    version: 1,
    seed: v.seed,
    format,
    team: v.team,
    settings: { format: s.format as Tournament['settings']['format'], difficulty: s.difficulty as Tournament['settings']['difficulty'], minutes: s.minutes },
    groups,
    fixtures,
    createdAt: v.createdAt,
  };
}

/** Validates a whole cup record (the active cup and the history). */
export function parseCupRecord(v: unknown): CupRecord | null {
  if (!isRecord(v) || v.version !== 1 || !Array.isArray(v.history)) return null;
  let active: Tournament | null = null;
  if (v.active !== null) {
    active = parseTournament(v.active);
    if (!active) return null;
  }
  const history: CupHistoryEntry[] = [];
  for (const h of v.history.slice(0, MAX_HISTORY)) {
    if (!isRecord(h) || !FORMATS.includes(h.format as CupFormat) || !code(h.team) || !code(h.champion) || !iso(h.finishedAt)) return null;
    if (h.finish !== 'champion' && !STAGES.includes(h.finish as Stage)) return null;
    history.push({
      format: h.format as CupFormat,
      team: h.team,
      finish: h.finish as CupHistoryEntry['finish'],
      champion: h.champion,
      finishedAt: h.finishedAt,
    });
  }
  return { version: 1, active, history };
}

/** Loads the cup record: empty if nothing is saved; unreadable data is kept as a recovery copy. */
export function loadCupRecord(): CupRecord {
  const raw = readJson(STORAGE_KEYS.tournament);
  if (raw === undefined) return emptyCupRecord();
  const parsed = parseCupRecord(raw);
  if (parsed) return parsed;
  keepRecoveryCopy(STORAGE_KEYS.tournament);
  return emptyCupRecord();
}

/** Saves the cup record. Returns false if the browser refused (it then lasts for this session only). */
export function saveCupRecord(r: CupRecord): boolean {
  return writeJson(STORAGE_KEYS.tournament, r);
}

/** Adds a finished cup to the history (newest first), once. Pure. */
export function withHistory(r: CupRecord, entry: CupHistoryEntry): CupRecord {
  return { ...r, history: [entry, ...r.history].slice(0, MAX_HISTORY) };
}
