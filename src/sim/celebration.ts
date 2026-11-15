/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import type { Rng } from '../core/rng';

/**
 * Goal celebrations and player reactions, chosen from the *match context* only — the score, the time,
 * whether it's an own goal — and never from anything about the player (no nationality, appearance or
 * gender). The same match with the same seed always produces the same celebrations.
 *
 * Gesture codes travel to the renderer through the frame buffer (PF.Gesture), so replays show exactly what
 * the simulation decided.
 */
export const Gesture = {
  None: 0,
  ArmsUp: 1,
  FistPump: 2,
  CornerRun: 3,
  Huddle: 4,
  Restrained: 5,
  Yes: 6,
  /** Team-mate joining a celebration. */
  Teammate: 7,
  /** Near miss / saved shot: hands on head. */
  HandsOnHead: 10,
  /** Clapping (team-mates, or the scorer applauding the fans). */
  Applaud: 11,
  /** Dejected: hands on hips. */
  HandsOnHips: 12,
  /** Both arms pointing to the sky. */
  PointSky: 13,
} as const;
export type Gesture = (typeof Gesture)[keyof typeof Gesture];

/** The scorer's celebration. Chosen from match context only (never nationality, appearance or gender). */
export type CelebrationStyle = 'armsUp' | 'fistPump' | 'cornerRun' | 'huddle' | 'restrained' | 'yes' | 'pointSky' | 'applaudFans';
/** How big the moment is: a late winner is big, a consolation goal subdued. */
export type Intensity = 'big' | 'normal' | 'subdued';

/** The match situation a celebration is chosen from. */
export interface CelebrationContext {
  /** Displayed match minute (0–90). */
  minute: number;
  /** Goals for / against the scoring team, after this goal. */
  scoreFor: number;
  scoreAgainst: number;
  ownGoal: boolean;
  /** The scoring team's previous celebration this match (avoids repeating it). */
  previous: CelebrationStyle | null;
  /** Practice / tutorial: always brief. */
  practice: boolean;
}

/** The chosen celebration: style, intensity and how long it lasts (players can skip it). */
export interface Celebration {
  style: CelebrationStyle;
  intensity: Intensity;
  /** Seconds before play moves on (skippable earlier). */
  duration: number;
}

/** The scorer's gesture code for each celebration style. */
export const GESTURE_FOR: Record<CelebrationStyle, Gesture> = {
  armsUp: Gesture.ArmsUp,
  fistPump: Gesture.FistPump,
  cornerRun: Gesture.CornerRun,
  huddle: Gesture.Huddle,
  restrained: Gesture.Restrained,
  yes: Gesture.Yes,
  pointSky: Gesture.PointSky,
  applaudFans: Gesture.Applaud,
};

/**
 * Team-mates don't all do the same thing: each picks one of a few reactions, varied by player and by goal
 * (deterministic, so replays match). Same idea for the team that conceded.
 */
const TEAMMATE: Gesture[] = [Gesture.Teammate, Gesture.ArmsUp, Gesture.Applaud, Gesture.FistPump, Gesture.Teammate];
const DEJECTED: Gesture[] = [Gesture.None, Gesture.HandsOnHead, Gesture.HandsOnHips, Gesture.None];
/** A team-mate's reaction, varied per player and per goal so the team never moves in unison. Deterministic. */
export function teammateGesture(playerId: number, goalNumber: number): Gesture {
  return TEAMMATE[(playerId * 7 + goalNumber * 3) % TEAMMATE.length];
}
/** A conceding player's reaction, varied per player and per goal. Deterministic. */
export function dejectedGesture(playerId: number, goalNumber: number): Gesture {
  return DEJECTED[(playerId * 5 + goalNumber) % DEJECTED.length];
}

/**
 * Pick a celebration:
 *  - a late equaliser or winner (80'+) → a big one: a run to the corner or the whole team piling in;
 *  - a consolation goal while still losing heavily → subdued and quick, jogging back for the restart;
 *  - an own goal by the opponents → a brief fist pump;
 *  - otherwise a normal celebration, varied so it doesn't repeat the team's last one.
 */
export function chooseCelebration(ctx: CelebrationContext, rng: Rng): Celebration {
  if (ctx.practice) return { style: 'fistPump', intensity: 'normal', duration: 1.4 };
  const diff = ctx.scoreFor - ctx.scoreAgainst;
  if (diff <= -2) return { style: 'restrained', intensity: 'subdued', duration: 1.3 };
  if (ctx.ownGoal) return { style: 'fistPump', intensity: 'normal', duration: 1.6 };
  if (ctx.minute >= 80 && (diff === 0 || diff === 1)) {
    const big: CelebrationStyle[] = ['cornerRun', 'huddle'];
    const pick = pickAvoiding(big, ctx.previous, rng);
    return { style: pick, intensity: 'big', duration: 2.8 };
  }
  const normal: CelebrationStyle[] = ['armsUp', 'fistPump', 'cornerRun', 'yes', 'pointSky', 'applaudFans'];
  const style = pickAvoiding(normal, ctx.previous, rng);
  return { style, intensity: 'normal', duration: style === 'cornerRun' ? 2.4 : 2.0 };
}

function pickAvoiding<T>(options: T[], previous: T | null, rng: Rng): T {
  const pool = options.length > 1 && previous !== null ? options.filter((o) => o !== previous) : options;
  return pool[Math.floor(rng.next() * pool.length) % pool.length];
}
