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
 * A small set of achievements that recognise play, without pressure.
 *
 * Design rules (docs/gameplay/progression.md): every achievement is visible from the start with its
 * condition; nothing is hidden, bought, random or time-limited; no streaks; no gameplay is locked behind
 * one. Each condition is a pure function of the player's local record and the match that just ended,
 * computed from simulation events, so it can be tested and can't be unlocked by mistake.
 *
 * **Identifiers are permanent.** They are stored in players' saved progress and exported files, so
 * never rename one (change its name or description instead) and never reuse a removed one.
 */
import type { MatchSummary, PlayerProgress } from './progress';

export const ACHIEVEMENT_IDS = [
  'first-goal',
  'first-win',
  'clean-sheet',
  'hat-trick',
  'comeback',
  'win-hard',
  'three-countries',
  'shootout-win',
  'penalty-save',
  'tutorial-complete',
] as const;

/** A permanent achievement identifier (stored in progress and exports). */
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export interface AchievementDef {
  id: AchievementId;
  name: string;
  /** The unlock condition in words, shown before and after unlocking. */
  description: string;
  /**
   * Unlocked yet? Called with the progress *after* a match (or the tutorial) was recorded, and the
   * match summary (null when the tutorial finished).
   */
  unlocked: (p: PlayerProgress, last: MatchSummary | null) => boolean;
}

/** Goals scored for team 0 (the player's side) by a single player, own goals excluded. */
function bestScorerGoals(s: MatchSummary): number {
  const byScorer = new Map<number, number>();
  for (const g of s.goals) if (g.team === 0 && !g.ownGoal && g.scorerId !== null) byScorer.set(g.scorerId, (byScorer.get(g.scorerId) ?? 0) + 1);
  return Math.max(0, ...byScorer.values());
}

/** True if the player's side won after trailing by two or more goals at some point. */
function cameBackFromTwoDown(s: MatchSummary): boolean {
  if (s.mode !== 'match' || s.goalsFor <= s.goalsAgainst) return false;
  let us = 0,
    them = 0;
  for (const g of s.goals) {
    if (g.team === 0) us++;
    else them++;
    if (them - us >= 2) return true;
  }
  return false;
}

/** Every achievement, in the order the Records screen lists them (the same order as {@link ACHIEVEMENT_IDS}). */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-goal', name: 'First Goal', description: 'Score a goal in a match.', unlocked: (p) => p.stats.goalsFor >= 1 },
  { id: 'first-win', name: 'First Victory', description: 'Win a match.', unlocked: (p) => p.stats.won >= 1 },
  { id: 'clean-sheet', name: 'Clean Sheet', description: 'Finish a match without conceding a goal.', unlocked: (p) => p.stats.cleanSheets >= 1 },
  {
    id: 'hat-trick',
    name: 'Hat-trick',
    description: 'One of your players scores three goals in a match.',
    unlocked: (_p, s) => !!s && s.mode === 'match' && bestScorerGoals(s) >= 3,
  },
  { id: 'comeback', name: 'Comeback', description: 'Win a match after being two goals behind.', unlocked: (_p, s) => !!s && cameBackFromTwoDown(s) },
  { id: 'win-hard', name: 'Top Level', description: 'Win a match on Hard.', unlocked: (p) => p.stats.byDifficulty.hard.won >= 1 },
  {
    id: 'three-countries',
    name: 'Around the World',
    description: 'Win matches with three different countries.',
    unlocked: (p) => p.stats.teamsWonWith.length >= 3,
  },
  { id: 'shootout-win', name: 'Nerves of Steel', description: 'Win a penalty shootout.', unlocked: (p) => p.stats.shootoutsWon >= 1 },
  { id: 'penalty-save', name: 'Safe Hands', description: 'Save a penalty in a shootout.', unlocked: (p) => p.stats.penaltySaves >= 1 },
  { id: 'tutorial-complete', name: 'Ready to Play', description: 'Complete the tutorial without skipping a step.', unlocked: (p) => p.tutorialCompleted },
];

/** Look up a definition by id. */
export function achievementById(id: AchievementId): AchievementDef {
  return ACHIEVEMENTS.find((a) => a.id === id)!;
}
