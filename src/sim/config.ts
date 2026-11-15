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
 * Static game configuration: pitch geometry per format, physical constants,
 * formations and AI difficulty profiles. Pure data — no logic.
 */
export type TeamId = 0 | 1;
export type Role = 'GK' | 'DEF' | 'MID' | 'FWD';
export type MatchFormat = '3v3' | '5v5' | '11v11';
export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard';
export type GameMode = 'match' | 'practice' | 'penalties';

export interface PitchConfig {
  length: number;
  width: number;
  goalWidth: number;
  goalHeight: number;
  goalDepth: number;
  penaltyAreaDepth: number;
  penaltyAreaWidth: number;
  goalAreaDepth: number;
  goalAreaWidth: number;
  centerCircleRadius: number;
  penaltySpot: number;
  cornerArcRadius: number;
  postRadius: number;
}

export const PITCHES: Record<MatchFormat, PitchConfig> = {
  '3v3': {
    length: 50,
    width: 32,
    goalWidth: 6.0,
    goalHeight: 2.2,
    goalDepth: 1.6,
    penaltyAreaDepth: 9,
    penaltyAreaWidth: 18,
    goalAreaDepth: 3.2,
    goalAreaWidth: 9.5,
    centerCircleRadius: 5,
    penaltySpot: 7.5,
    cornerArcRadius: 0.8,
    postRadius: 0.06,
  },
  '5v5': {
    length: 66,
    width: 42,
    goalWidth: 6.8,
    goalHeight: 2.35,
    goalDepth: 1.8,
    penaltyAreaDepth: 12,
    penaltyAreaWidth: 25,
    goalAreaDepth: 4,
    goalAreaWidth: 12,
    centerCircleRadius: 7,
    penaltySpot: 9.5,
    cornerArcRadius: 1,
    postRadius: 0.06,
  },
  '11v11': {
    length: 105,
    width: 68,
    goalWidth: 7.32,
    goalHeight: 2.44,
    goalDepth: 2,
    penaltyAreaDepth: 16.5,
    penaltyAreaWidth: 40.32,
    goalAreaDepth: 5.5,
    goalAreaWidth: 18.32,
    centerCircleRadius: 9.15,
    penaltySpot: 11,
    cornerArcRadius: 1,
    postRadius: 0.06,
  },
};

export const BALL = {
  radius: 0.11,
  gravity: 9.81,
  /** Quadratic air drag coefficient: a = -k |v| v. (0.5 * rho * Cd * A / m) */
  airDrag: 0.0125,
  /** Magnus coefficient: a = k (omega x v). */
  magnus: 0.0052,
  /** Ground bounce restitution. */
  restitution: 0.6,
  /** Constant rolling deceleration (m/s²). */
  rollDecel: 1.25,
  /** Velocity-proportional rolling deceleration (1/s). */
  rollDrag: 0.24,
  /** Spin decay in air (1/s). */
  spinDecay: 0.35,
  postRestitution: 0.72,
  netDamping: 0.12,
} as const;

export const PLAYER = {
  radius: 0.34,
  height: 1.82,
  walkSpeed: 1.9,
  jogSpeed: 4.0,
  runSpeed: 5.9,
  sprintSpeed: 8.1,
  dribbleSpeedFactor: 0.92,
  /** Peak acceleration from standstill (falls off towards top speed). */
  accel: 19,
  /** Braking deceleration. */
  decel: 24,
  /** Velocity-direction turn rate (rad/s) at walking pace… */
  turnRateSlow: 14,
  /** …and at full sprint. Momentum makes fast players carve wider turns. */
  turnRateFast: 3.6,
  /** Facing turn rates (rad/s). */
  turnRate: 13,
  sprintTurnRate: 6.5,
  /** Horizontal radius within which a player can play the ball. */
  reach: 0.95,
  /** Radius for close control while dribbling. */
  controlRadius: 0.85,
  staminaDrain: 0.11,
  staminaRegen: 0.07,
} as const;

/**
 * Steering / momentum tuning (mutable so the movement lab can adjust it live; see src/dev/lab.ts).
 * `human*` modifiers apply only to the human-controlled player: quicker to react, brake and turn
 * than the AI, but with the same top speeds, so there is no unrealistic speed advantage.
 */
export interface MoveTuning {
  accel: number;
  decel: number;
  turnRateSlow: number;
  turnRateFast: number;
  /** Reversal ("plant") threshold angle (rad) and minimum speed (m/s). */
  plantAngle: number;
  plantMinSpeed: number;
  /** Plant duration = plantBase + plantPerSpeed × speed (s). */
  plantBase: number;
  plantPerSpeed: number;
  /** Max fraction of speed shed by a hard turn. */
  turnSpeedLoss: number;
  humanAccel: number;
  humanDecel: number;
  humanTurn: number;
  humanPlant: number;
  humanTurnSpeedLoss: number;
}
export const MOVE_DEFAULTS: Readonly<MoveTuning> = {
  accel: PLAYER.accel,
  decel: PLAYER.decel,
  turnRateSlow: PLAYER.turnRateSlow,
  turnRateFast: PLAYER.turnRateFast,
  plantAngle: 2.0,
  plantMinSpeed: 3.2,
  plantBase: 0.12,
  plantPerSpeed: 0.012,
  turnSpeedLoss: 0.5,
  // the human player brakes, turns and reverses noticeably quicker than the AI; acceleration
  // is only slightly higher so foot races for loose balls stay fair.
  humanAccel: 1.15,
  humanDecel: 1.45,
  humanTurn: 1.4,
  humanPlant: 0.35,
  humanTurnSpeedLoss: 0.6,
};
export const MOVE: MoveTuning = { ...MOVE_DEFAULTS };

/** AI pace tiers expressed as move-command magnitudes (fraction of run speed). */
export const PACE = {
  walk: PLAYER.walkSpeed / PLAYER.runSpeed,
  jog: PLAYER.jogSpeed / PLAYER.runSpeed,
  run: 1,
} as const;

export const GK = {
  diveSpeed: 4.1,
  reach: 1.05,
  /** Hands reach beyond the body centre when fully stretched in a dive. */
  diveReach: 1.15,
  /** Seconds to reach full stretch. */
  diveExtendTime: 0.58,
  /** Push-off phase before the body flies (s). */
  diveWindup: 0.17,
  standingHeight: 2.35,
  holdTime: 1.1,
} as const;

/** Formation slots in normalised coordinates: fx -1 = own goal line, +1 = opponent goal line; fz across width (-1..1). */
export interface FormationSlot {
  role: Role;
  fx: number;
  fz: number;
}

export interface Formation {
  name: string;
  slots: FormationSlot[];
}

export const FORMATIONS: Record<MatchFormat, Formation[]> = {
  '3v3': [
    {
      name: '1-1-1',
      slots: [
        { role: 'GK', fx: -0.95, fz: 0 },
        { role: 'DEF', fx: -0.45, fz: -0.15 },
        { role: 'FWD', fx: 0.1, fz: 0.2 },
      ],
    },
    {
      name: '1-2',
      slots: [
        { role: 'GK', fx: -0.95, fz: 0 },
        { role: 'MID', fx: -0.25, fz: -0.4 },
        { role: 'MID', fx: -0.15, fz: 0.4 },
      ],
    },
  ],
  '5v5': [
    {
      name: '2-1-1',
      slots: [
        { role: 'GK', fx: -0.95, fz: 0 },
        { role: 'DEF', fx: -0.55, fz: -0.4 },
        { role: 'DEF', fx: -0.55, fz: 0.4 },
        { role: 'MID', fx: -0.15, fz: 0 },
        { role: 'FWD', fx: 0.25, fz: 0 },
      ],
    },
    {
      name: '1-2-1',
      slots: [
        { role: 'GK', fx: -0.95, fz: 0 },
        { role: 'DEF', fx: -0.6, fz: 0 },
        { role: 'MID', fx: -0.2, fz: -0.55 },
        { role: 'MID', fx: -0.2, fz: 0.55 },
        { role: 'FWD', fx: 0.25, fz: 0 },
      ],
    },
  ],
  '11v11': [
    {
      name: '4-3-3',
      slots: [
        { role: 'GK', fx: -0.95, fz: 0 },
        { role: 'DEF', fx: -0.62, fz: -0.68 },
        { role: 'DEF', fx: -0.7, fz: -0.24 },
        { role: 'DEF', fx: -0.7, fz: 0.24 },
        { role: 'DEF', fx: -0.62, fz: 0.68 },
        { role: 'MID', fx: -0.35, fz: -0.4 },
        { role: 'MID', fx: -0.42, fz: 0 },
        { role: 'MID', fx: -0.35, fz: 0.4 },
        { role: 'FWD', fx: 0.12, fz: -0.62 },
        { role: 'FWD', fx: 0.18, fz: 0 },
        { role: 'FWD', fx: 0.12, fz: 0.62 },
      ],
    },
    {
      name: '4-4-2',
      slots: [
        { role: 'GK', fx: -0.95, fz: 0 },
        { role: 'DEF', fx: -0.62, fz: -0.68 },
        { role: 'DEF', fx: -0.7, fz: -0.24 },
        { role: 'DEF', fx: -0.7, fz: 0.24 },
        { role: 'DEF', fx: -0.62, fz: 0.68 },
        { role: 'MID', fx: -0.32, fz: -0.66 },
        { role: 'MID', fx: -0.38, fz: -0.2 },
        { role: 'MID', fx: -0.38, fz: 0.2 },
        { role: 'MID', fx: -0.32, fz: 0.66 },
        { role: 'FWD', fx: 0.15, fz: -0.22 },
        { role: 'FWD', fx: 0.15, fz: 0.22 },
      ],
    },
  ],
};

export const PLAYERS_PER_TEAM: Record<MatchFormat, number> = { '3v3': 3, '5v5': 5, '11v11': 11 };

/**
 * AI profile. Difficulty changes perception, decision quality and execution accuracy —
 * never movement speed or physics.
 */
export interface AIProfile {
  /** Seconds before a player reacts to a new ball situation. */
  reaction: number;
  /** Seconds between ball-carrier decisions. */
  decisionInterval: number;
  /** Std-dev of noise added to option utilities. */
  decisionNoise: number;
  /** Aim error (radians, std-dev) for passes. */
  passError: number;
  /** Aim error (radians, std-dev) for shots. */
  shotError: number;
  /** 0..1 — how aggressively the team presses (second presser, press height). */
  press: number;
  /** 0..1 — probability of recognising an interceptable pass. */
  intercept: number;
  /** 0..1 — tackle timing quality. */
  tackle: number;
  /** Goalkeeper reaction time (s). */
  gkReaction: number;
  /** Goalkeeper positioning quality 0..1. */
  gkPositioning: number;
  /** Maximum considered pass distance (fraction of pitch length). */
  vision: number;
  /** Marking distance (m); tighter = harder. */
  markDistance: number;
  /** Willingness to make forward runs 0..1. */
  runs: number;
  /** Minimum shot quality to attempt a shot. */
  shotThreshold: number;
}

export const AI_PROFILES: Record<Difficulty, AIProfile> = {
  // Beginner: for first-time players. Same speeds and physics as every level — the opponents just react
  // later, press less, leave more space, choose worse and finish less clinically.
  beginner: {
    reaction: 0.55,
    decisionInterval: 0.7,
    decisionNoise: 0.34,
    passError: 0.12,
    shotError: 0.11,
    press: 0.05,
    intercept: 0.2,
    tackle: 0.2,
    gkReaction: 0.44,
    gkPositioning: 0.42,
    vision: 0.32,
    markDistance: 4.2,
    runs: 0.15,
    shotThreshold: 0.28,
  },
  easy: {
    reaction: 0.42,
    decisionInterval: 0.55,
    decisionNoise: 0.28,
    passError: 0.09,
    shotError: 0.085,
    press: 0.15,
    intercept: 0.35,
    tackle: 0.35,
    gkReaction: 0.36,
    gkPositioning: 0.55,
    vision: 0.4,
    markDistance: 3.2,
    runs: 0.3,
    shotThreshold: 0.22,
  },
  medium: {
    reaction: 0.25,
    decisionInterval: 0.35,
    decisionNoise: 0.14,
    passError: 0.05,
    shotError: 0.055,
    press: 0.5,
    intercept: 0.65,
    tackle: 0.6,
    gkReaction: 0.25,
    gkPositioning: 0.8,
    vision: 0.6,
    markDistance: 2.3,
    runs: 0.6,
    shotThreshold: 0.15,
  },
  hard: {
    reaction: 0.13,
    decisionInterval: 0.22,
    decisionNoise: 0.05,
    passError: 0.028,
    shotError: 0.04,
    press: 0.9,
    intercept: 0.92,
    tackle: 0.85,
    gkReaction: 0.16,
    gkPositioning: 0.95,
    vision: 0.85,
    markDistance: 1.6,
    runs: 0.9,
    shotThreshold: 0.15,
  },
};

/** Kick wind-up (contact time) and total action duration in seconds. Shared by sim and animation. */
/** Kick wind-up timings (s from the button release to foot contact, and total action length). Mutable for the lab. */
export const KICK_TIMING_DEFAULTS = {
  shotContact: 0.12,
  shotTotal: 0.43,
  lobContact: 0.11,
  passContact: 0.075,
  passTotal: 0.31,
};
export const KICK_TIMING: { shotContact: number; shotTotal: number; lobContact: number; passContact: number; passTotal: number } = { ...KICK_TIMING_DEFAULTS };

/** Fixed simulation timestep. */
export const SIM_DT = 1 / 120;
