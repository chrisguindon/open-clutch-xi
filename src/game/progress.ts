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
 * The player's local record: statistics, recent matches and achievements, kept in this browser only
 * (no account, no server, nothing sent anywhere; see docs/architecture/persistence.md).
 *
 * How a match reaches the record:
 *  1. When a match or shootout reaches full time, the game builds a {@link MatchSummary} from the
 *     simulation (`summariseMatch`): the score, the goal log and the shootout kicks. Matches that are
 *     quit or restarted never reach full time, so **abandoned matches are not counted**.
 *  2. {@link recordMatch} returns the updated record and the achievements this match unlocked. It is
 *     pure (the input record is not modified) and **idempotent per match id**, so a summary delivered
 *     twice is counted once.
 *  3. The game saves the result through src/game/storage.ts.
 *
 * Practice and the tutorial never count as matches. The tutorial only sets `tutorialCompleted`.
 */
import type { Difficulty, GameMode, MatchFormat } from '../sim/config';
import type { Match, PenaltyKick } from '../sim/match';
import { ACHIEVEMENTS, ACHIEVEMENT_IDS, type AchievementId } from './achievements';
import { STORAGE_KEYS, isRecord, keepRecoveryCopy, readJson, writeJson } from './storage';

/** What the record needs to know about one finished match or shootout. Team 0 is always the player. */
export interface MatchSummary {
  /** Unique per match played (start time + seed); used to never count the same match twice. */
  id: string;
  mode: Extract<GameMode, 'match' | 'penalties'>;
  difficulty: Difficulty;
  format: MatchFormat;
  /** Team ids (country codes such as 'BRA'). */
  team: string;
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  /** In order. For own goals, `team` is the team credited with the goal. */
  goals: ReadonlyArray<{ team: 0 | 1; scorerId: number | null; ownGoal: boolean }>;
  /** Shootout kicks (penalties mode only). */
  kicks: readonly PenaltyKick[];
  /** Winner of the match or shootout; null for a draw. */
  winner: 0 | 1 | null;
  /** ISO 8601 time the match finished. */
  finishedAt: string;
}

/** Running totals and personal bests across every recorded match and shootout. */
export interface PlayerStats {
  /** Matches (not shootouts) played to full time, and their results. */
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  /** Personal bests: the largest winning margin (and its score), and most goals in one match. */
  biggestWin: { for: number; against: number } | null;
  mostGoalsInMatch: number;
  byDifficulty: Record<Difficulty, { played: number; won: number }>;
  /** Country codes the player has won a match with (for "Around the world"). */
  teamsWonWith: string[];
  shootoutsWon: number;
  shootoutsLost: number;
  /** Penalties saved by the player's goalkeeper in shootouts. */
  penaltySaves: number;
}

/** One line of the recent-matches list on the Records screen. */
export interface MatchHistoryEntry {
  id: string;
  finishedAt: string;
  mode: MatchSummary['mode'];
  team: string;
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  result: 'win' | 'draw' | 'loss';
  difficulty: Difficulty;
  format: MatchFormat;
}

/** Everything saved under `player-progress-v1`: validated by {@link parseProgress} whenever it is read. */
export interface PlayerProgress {
  /** Schema version. Bump only with a migration in {@link parseProgress}. */
  version: 1;
  stats: PlayerStats;
  /** Most recent first, at most {@link HISTORY_LIMIT}. */
  history: MatchHistoryEntry[];
  /** Unlocked achievements only, with the time they were unlocked (ISO 8601). */
  achievements: Partial<Record<AchievementId, { unlockedAt: string }>>;
  tutorialCompleted: boolean;
  /**
   * XI Nations Cup milestones: times the player reached the knockouts, and cups won. Added after the
   * first records were saved, so older records without it load as zeros (no version bump needed).
   */
  cup: { knockouts: number; trophies: number };
}

/** Recent matches kept (older ones still count in the statistics). */
export const HISTORY_LIMIT = 20;
const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'easy', 'medium', 'hard'];
const FORMATS: readonly MatchFormat[] = ['3v3', '5v5', '11v11'];
/** Upper bound for any counter: far beyond real play, low enough to reject nonsense in imported files. */
const MAX_COUNT = 1_000_000;
const MAX_TEAMS = 200;

/** The record of a player who hasn't finished a match yet. */
export function emptyProgress(): PlayerProgress {
  return {
    version: 1,
    stats: {
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      cleanSheets: 0,
      biggestWin: null,
      mostGoalsInMatch: 0,
      byDifficulty: { beginner: { played: 0, won: 0 }, easy: { played: 0, won: 0 }, medium: { played: 0, won: 0 }, hard: { played: 0, won: 0 } },
      teamsWonWith: [],
      shootoutsWon: 0,
      shootoutsLost: 0,
      penaltySaves: 0,
    },
    history: [],
    achievements: {},
    tutorialCompleted: false,
    cup: { knockouts: 0, trophies: 0 },
  };
}

/** Build the summary of a finished match from the simulation's own records. */
export function summariseMatch(m: Match, info: { id: string; team: string; opponent: string; finishedAt: Date }): MatchSummary {
  const mode = m.options.mode === 'penalties' ? 'penalties' : 'match';
  return {
    id: info.id,
    mode,
    difficulty: m.options.difficulty,
    format: m.options.format,
    team: info.team,
    opponent: info.opponent,
    goalsFor: m.score[0],
    goalsAgainst: m.score[1],
    goals: m.goalLog.map((g) => ({ team: g.team, scorerId: g.scorerId, ownGoal: g.ownGoal })),
    kicks: m.penKicks.map((k) => ({ ...k })),
    winner: m.winner,
    finishedAt: info.finishedAt.toISOString(),
  };
}

/**
 * Add a finished match to the record. Pure: returns a new record (the input is untouched) and the ids
 * of achievements unlocked by this match. A summary whose id is already in the history is ignored.
 */
export function recordMatch(progress: PlayerProgress, s: MatchSummary): { progress: PlayerProgress; unlocked: AchievementId[] } {
  if (progress.history.some((h) => h.id === s.id)) return { progress, unlocked: [] };
  const p = structuredClone(progress);
  const st = p.stats;
  const result: MatchHistoryEntry['result'] = s.winner === 0 ? 'win' : s.winner === 1 ? 'loss' : 'draw';
  if (s.mode === 'match') {
    st.played++;
    if (result === 'win') st.won++;
    else if (result === 'loss') st.lost++;
    else st.drawn++;
    st.goalsFor += s.goalsFor;
    st.goalsAgainst += s.goalsAgainst;
    if (s.goalsAgainst === 0) st.cleanSheets++;
    st.mostGoalsInMatch = Math.max(st.mostGoalsInMatch, s.goalsFor);
    const margin = s.goalsFor - s.goalsAgainst;
    const best = st.biggestWin;
    if (margin > 0 && (!best || margin > best.for - best.against || (margin === best.for - best.against && s.goalsFor > best.for))) {
      st.biggestWin = { for: s.goalsFor, against: s.goalsAgainst };
    }
    st.byDifficulty[s.difficulty].played++;
    if (result === 'win') {
      st.byDifficulty[s.difficulty].won++;
      if (!st.teamsWonWith.includes(s.team) && st.teamsWonWith.length < MAX_TEAMS) st.teamsWonWith.push(s.team);
    }
  } else {
    if (result === 'win') st.shootoutsWon++;
    else if (result === 'loss') st.shootoutsLost++;
    // The player keeps goal against the opponent's (team 1) kicks.
    st.penaltySaves += s.kicks.filter((k) => k.team === 1 && k.saved).length;
  }
  p.history = [
    {
      id: s.id,
      finishedAt: s.finishedAt,
      mode: s.mode,
      team: s.team,
      opponent: s.opponent,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      result,
      difficulty: s.difficulty,
      format: s.format,
    },
    ...p.history,
  ].slice(0, HISTORY_LIMIT);
  return { progress: p, unlocked: unlockAchievements(p, s, s.finishedAt) };
}

/** Mark the tutorial as completed (only call when no step was skipped). */
export function recordTutorialCompleted(progress: PlayerProgress, at: Date): { progress: PlayerProgress; unlocked: AchievementId[] } {
  if (progress.tutorialCompleted) return { progress, unlocked: [] };
  const p = structuredClone(progress);
  p.tutorialCompleted = true;
  return { progress: p, unlocked: unlockAchievements(p, null, at.toISOString()) };
}

/**
 * An XI Nations Cup milestone: the player's team reached the knockout rounds, or won the cup. Counted
 * once per cup by the caller (src/game/game.ts). Pure; returns the new record and newly unlocked ids.
 */
export function recordCupMilestone(progress: PlayerProgress, kind: 'knockouts' | 'trophy', at: Date): { progress: PlayerProgress; unlocked: AchievementId[] } {
  const p = structuredClone(progress);
  if (kind === 'knockouts') p.cup.knockouts = Math.min(MAX_COUNT, p.cup.knockouts + 1);
  else p.cup.trophies = Math.min(MAX_COUNT, p.cup.trophies + 1);
  return { progress: p, unlocked: unlockAchievements(p, null, at.toISOString()) };
}

/** Unlock (in place) every achievement whose condition now holds; returns the newly unlocked ids. */
function unlockAchievements(p: PlayerProgress, last: MatchSummary | null, at: string): AchievementId[] {
  const unlocked: AchievementId[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id] || !a.unlocked(p, last)) continue;
    p.achievements[a.id] = { unlockedAt: at };
    unlocked.push(a.id);
  }
  return unlocked;
}

// ----------------------------------------------------------------------------- validation

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : null);
const isoDate = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const teamCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{2,4}$/.test(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v);

/**
 * Validate stored or imported progress. **Strict:** anything malformed returns null instead of being
 * guessed at, so a damaged or hand-made file can never inject unexpected values. (Unknown extra fields
 * are dropped.) Future schema versions would be migrated here before validation.
 */
export function parseProgress(raw: unknown): PlayerProgress | null {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.stats) || !Array.isArray(raw.history) || !isRecord(raw.achievements)) return null;
  const s = raw.stats;
  const out = emptyProgress();
  for (const k of [
    'played',
    'won',
    'drawn',
    'lost',
    'goalsFor',
    'goalsAgainst',
    'cleanSheets',
    'mostGoalsInMatch',
    'shootoutsWon',
    'shootoutsLost',
    'penaltySaves',
  ] as const) {
    const n = count(s[k]);
    if (n === null) return null;
    out.stats[k] = n;
  }
  if (s.biggestWin !== null) {
    if (!isRecord(s.biggestWin)) return null;
    const f = count(s.biggestWin.for),
      a = count(s.biggestWin.against);
    if (f === null || a === null || f <= a) return null;
    out.stats.biggestWin = { for: f, against: a };
  }
  if (!isRecord(s.byDifficulty)) return null;
  for (const d of DIFFICULTIES) {
    const e = s.byDifficulty[d];
    if (!isRecord(e)) return null;
    const played = count(e.played),
      won = count(e.won);
    if (played === null || won === null || won > played) return null;
    out.stats.byDifficulty[d] = { played, won };
  }
  if (!Array.isArray(s.teamsWonWith) || s.teamsWonWith.length > MAX_TEAMS || !s.teamsWonWith.every(teamCode)) return null;
  out.stats.teamsWonWith = [...new Set(s.teamsWonWith)];
  if (raw.history.length > HISTORY_LIMIT) return null;
  for (const h of raw.history) {
    if (!isRecord(h)) return null;
    const goalsFor = count(h.goalsFor),
      goalsAgainst = count(h.goalsAgainst);
    if (
      typeof h.id !== 'string' ||
      h.id.length > 64 ||
      !isoDate(h.finishedAt) ||
      !oneOf(h.mode, ['match', 'penalties'] as const) ||
      !teamCode(h.team) ||
      !teamCode(h.opponent) ||
      goalsFor === null ||
      goalsAgainst === null ||
      !oneOf(h.result, ['win', 'draw', 'loss'] as const) ||
      !oneOf(h.difficulty, DIFFICULTIES) ||
      !oneOf(h.format, FORMATS)
    )
      return null;
    out.history.push({
      id: h.id,
      finishedAt: h.finishedAt,
      mode: h.mode,
      team: h.team,
      opponent: h.opponent,
      goalsFor,
      goalsAgainst,
      result: h.result,
      difficulty: h.difficulty,
      format: h.format,
    });
  }
  for (const [id, v] of Object.entries(raw.achievements)) {
    if (!oneOf(id, ACHIEVEMENT_IDS) || !isRecord(v) || !isoDate(v.unlockedAt)) return null;
    out.achievements[id] = { unlockedAt: v.unlockedAt };
  }
  if (typeof raw.tutorialCompleted !== 'boolean') return null;
  out.tutorialCompleted = raw.tutorialCompleted;
  if (raw.cup !== undefined) {
    if (!isRecord(raw.cup)) return null;
    const knockouts = count(raw.cup.knockouts),
      trophies = count(raw.cup.trophies);
    if (knockouts === null || trophies === null) return null;
    out.cup = { knockouts, trophies };
  }
  return out;
}

// ----------------------------------------------------------------------------- persistence

/**
 * Load the saved record. Nothing saved, or storage unavailable: an empty record. Unreadable data is
 * never half-loaded: the game starts a fresh record, and the original text is kept as a `:corrupt`
 * copy for recovery before anything overwrites it.
 */
export function loadProgress(): PlayerProgress {
  const raw = readJson(STORAGE_KEYS.progress);
  if (raw === undefined) return emptyProgress();
  const parsed = parseProgress(raw);
  if (parsed) return parsed;
  keepRecoveryCopy(STORAGE_KEYS.progress);
  return emptyProgress();
}

/** Save the record. Returns false if the browser refused (it then lasts for this session only). */
export function saveProgress(p: PlayerProgress): boolean {
  return writeJson(STORAGE_KEYS.progress, p);
}
