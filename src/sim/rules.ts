/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import type { MatchFormat, TeamId } from './config';

/**
 * Football rules used by the match (see docs/gameplay/FOOTBALL_RULES.md for the full Law-by-Law matrix).
 *
 * Two profiles:
 *  - **Standard** (11v11): the recognisable Laws of the Game — offside (Law 11), fouls with cautions and
 *    sendings-off (Law 12), advantage, 9.15 m at free kicks / corners / kick-offs (Laws 13, 17, 8),
 *    opponents outside the penalty area at goal kicks (Law 16), the second-touch offence.
 *  - **Arcade** (3v3, 5v5): faster small-sided play. No offside, fouls without cards, shorter restart
 *    distances. These are this game's own simplifications, not IFAB rules.
 *
 * Everything here is pure and deterministic so it can be unit-tested without running a match.
 */
export type RulesProfileName = 'standard' | 'arcade';

/** The rule switches that differ between Standard and Arcade play. */
export interface RulesProfile {
  name: RulesProfileName;
  /** Law 11. */
  offside: boolean;
  /** Law 12 cautions / sendings-off. */
  cards: boolean;
  /** Law 5: the referee may play advantage. */
  advantage: boolean;
  /** Distance opponents keep at free kicks, corners and kick-offs (m). Law: 9.15 m. */
  restartDistance: number;
  /** Distance opponents keep from a throw-in (m). Law 15: 2 m. */
  throwInDistance: number;
  /** Law 16: opponents stay outside the penalty area until a goal kick is in play. */
  goalKickClearsArea: boolean;
  /** Assistant referees take part (signals offside, throw-ins, goal kicks, corners). */
  assistants: boolean;
}

/** The two rules profiles. Arcade values are the game's own choices, not IFAB rules. */
export const RULES: Record<RulesProfileName, RulesProfile> = {
  standard: {
    name: 'standard',
    offside: true,
    cards: true,
    advantage: true,
    restartDistance: 9.15,
    throwInDistance: 2,
    goalKickClearsArea: true,
    assistants: true,
  },
  arcade: {
    name: 'arcade',
    offside: false,
    cards: false,
    advantage: true,
    restartDistance: 5,
    throwInDistance: 2,
    goalKickClearsArea: false,
    assistants: false,
  },
};

/** Standard rules for 11v11, Arcade rules for the small-sided formats. */
export function rulesForFormat(format: MatchFormat): RulesProfileName {
  return format === '11v11' ? 'standard' : 'arcade';
}

/** Minimal views of the world the rules need (keeps this module independent of World / Player). */
export interface RulesPlayer {
  id: number;
  team: TeamId;
  isGK: boolean;
  pos: { x: number; z: number };
  sentOff?: boolean;
}

/**
 * The offside line for attackers of `attackingTeam`: the x of the second-last opponent (usually the last
 * outfield defender, the keeper being the last), measured towards the goal they attack. Law 11.1.
 * Returns progress along the attacking direction (larger = nearer the goal line).
 */
export function offsideLine(players: readonly RulesPlayer[], attackingTeam: TeamId, dir: 1 | -1): number {
  const depths: number[] = [];
  for (const p of players) if (p.team !== attackingTeam && !p.sentOff) depths.push(p.pos.x * dir);
  depths.sort((a, b) => b - a);
  return depths.length >= 2 ? depths[1] : (depths[0] ?? 0);
}

/**
 * Law 11.1: a player is in an offside position if any part of the head, body or feet is in the opponents'
 * half (excluding the halfway line) and nearer to the opponents' goal line than both the ball and the
 * second-last opponent. Being in an offside position is not an offence by itself.
 * (Players are points here; `margin` absorbs the body width so marginal cases favour the attacker.)
 */
export function inOffsidePosition(p: RulesPlayer, players: readonly RulesPlayer[], ballX: number, dir: 1 | -1, margin = 0.15): boolean {
  const depth = p.pos.x * dir;
  if (depth <= 0) return false; // own half, or level with the halfway line
  const line = offsideLine(players, p.team, dir);
  return depth > Math.max(ballX * dir, line) + margin;
}

/**
 * Restarts from which an offside offence can't be committed directly (Law 11.3): goal kick, throw-in,
 * corner kick.
 */
export function offsideExemptRestart(type: string | null | undefined): boolean {
  return type === 'goalKick' || type === 'throwIn' || type === 'corner';
}

/** Law 12.1 categories of a foul's force: see {@link foulSeverity}. */
export type FoulSeverity = 'careless' | 'reckless' | 'excessive';

/** The physical facts of a challenge, measured by the world; the only input to the severity decision. */
export interface FoulFacts {
  /** Sliding tackle (both feet off the ground in the challenge). */
  slide: boolean;
  /** −1 = head-on … +1 = straight from behind. */
  fromBehind: number;
  /** Tackler speed at the challenge (m/s). */
  tacklerSpeed: number;
  /** Victim was in possession and heading towards goal in a promising position. */
  promisingAttack: boolean;
}

/**
 * Law 12.1 distinguishes careless (foul only), reckless (caution) and excessive force (sending-off).
 * The game decides from the physical facts of the challenge — never randomly — so the same challenge
 * always gets the same decision:
 *  - a slide from behind at speed → excessive force (endangers the opponent's safety)
 *  - a slide from behind, or a sprinting slide from the side → reckless
 *  - anything else → careless
 */
export function foulSeverity(f: FoulFacts): FoulSeverity {
  if (f.slide && f.fromBehind > 0.6 && f.tacklerSpeed > 6.5) return 'excessive';
  if (f.slide && (f.fromBehind > 0.35 || f.tacklerSpeed > 7.2)) return 'reckless';
  return 'careless';
}

/** Disciplinary outcome of a foul. */
export type Sanction = 'none' | 'yellow' | 'red';

/** Sanction for a foul under a profile. A second caution in the match means a sending-off. */
export function sanctionFor(severity: FoulSeverity, profile: RulesProfile, priorYellows: number): Sanction {
  if (!profile.cards) return 'none';
  if (severity === 'excessive') return 'red';
  if (severity === 'reckless') return priorYellows >= 1 ? 'red' : 'yellow';
  return 'none';
}

/** Law 15 / 13 / 16 / 17: goals can't be scored directly from these restarts (only from a direct free kick, penalty, corner, goal kick vs opponents, kick-off). */
export function canScoreDirectly(restart: { type: string; indirect?: boolean } | null): boolean {
  if (!restart) return true;
  if (restart.type === 'throwIn') return false;
  if (restart.type === 'freeKick' && restart.indirect) return false;
  return true;
}
