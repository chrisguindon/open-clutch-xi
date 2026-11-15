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
 * Tactical building blocks shared by the AI: where each player should stand for the formation, the
 * ball position and the phase (open play, restarts, kick-off), plus steering helpers that turn
 * "go there" into a movement command. Positions stretch and compress with the ball, like a real
 * team keeping its distances.
 */

import { FormationSlot, TeamId } from '../config';
import { Player, PlayerCommand } from '../player';
import { World } from '../world';
import { clamp, hyp } from '../../core/math';
import { PACE } from '../config';

/** The kinds of restart (Laws 8, 13–17) the AI positions itself for. */
export type RestartType = 'kickoff' | 'throwIn' | 'corner' | 'goalKick' | 'freeKick' | 'penalty';

/** A restart waiting to be taken: what, by whom, and where. */
export interface RestartInfo {
  type: RestartType;
  team: TeamId;
  x: number;
  z: number;
  takerId: number;
  /** Indirect free kick (Law 13): a goal can't be scored directly. */
  indirect?: boolean;
}

/** What the AI needs to know about the match phase this tick. */
export interface TacticalContext {
  /** play: normal play; restart: set piece waiting to be taken; kickoff: kick-off waiting; idle: players stand still. */
  phase: 'play' | 'restart' | 'kickoff' | 'idle';
  restart: RestartInfo | null;
  /** Human-controlled player id (excluded from AI control), or null. */
  humanId: number | null;
  practice: boolean;
}

/** How far each role may push up / drop back (normalised pitch x). */
const ROLE_RANGE: Record<string, readonly [number, number]> = {
  DEF: [-0.88, 0.4],
  MID: [-0.78, 0.72],
  FWD: [-0.45, 0.86],
  GK: [-1, -0.8],
};

/**
 * Formation slot → world position, shifted by team phase (attack / defence) and by the ball.
 * Keeps the team compact around the ball and goal-side when defending.
 */
export function slotPosition(world: World, team: TeamId, slot: FormationSlot, attacking: boolean, ballX: number, ballZ: number): { x: number; z: number } {
  const L2 = world.pitch.length / 2,
    W2 = world.pitch.width / 2;
  const dir = world.attackDir(team);
  const ballF = clamp((ballX * dir) / L2, -1, 1);
  let fx = slot.fx;
  if (slot.role === 'GK') return { x: -dir * (L2 - 1), z: 0 };
  if (attacking) fx += slot.role === 'FWD' ? 0.3 : slot.role === 'MID' ? 0.26 : 0.2;
  else fx -= 0.1;
  fx += ballF * (attacking ? 0.42 : 0.38);
  const r = ROLE_RANGE[slot.role];
  const lo = r[0],
    hi = r[1];
  fx = clamp(fx, lo, hi);
  let x = fx * L2 * dir;
  const width = attacking ? 1.05 : 0.7;
  let z = slot.fz * W2 * width * 0.82 + ballZ * (attacking ? 0.22 : 0.42);
  z = clamp(z, -W2 + 1.5, W2 - 1.5);
  // Defenders stay goal-side of the ball when defending.
  if (!attacking && slot.role !== 'FWD') {
    const goalSideX = ballX * dir - 2.5;
    if (x * dir > goalSideX) x = goalSideX * dir;
  }
  return { x, z };
}

/** Steering: arrive at a target with deceleration; optional facing. */
export function arrive(cmd: PlayerCommand, p: Player, tx: number, tz: number, sprintDist = 7, slowRadius = 1.6, faceX?: number, faceZ?: number): number {
  const dx = tx - p.pos.x,
    dz = tz - p.pos.z;
  const d = hyp(dx, dz);
  if (d < 0.2) {
    cmd.move.set(0, 0);
    cmd.sprint = false;
  } else {
    const f = clamp(d / slowRadius, 0, 1);
    cmd.move.set((dx / d) * f, (dz / d) * f);
    cmd.sprint = d > sprintDist;
  }
  if (faceX !== undefined && faceZ !== undefined && d < 3) {
    const fx = faceX - p.pos.x,
      fz = faceZ - p.pos.z;
    if (cmd.face) cmd.face.set(fx, fz);
  }
  return d;
}

/** Urgency levels for off-ball movement. */
export type Urgency = 0 | 1 | 2 | 3;

/**
 * Natural off-ball movement. Players hold position inside a small deadzone, walk or jog to
 * nearby targets, run when far, and only sprint when the situation is urgent:
 *  0 = shape (walk/jog, run if far), 1 = support/marking, 2 = pressing/recovery/runs, 3 = chasing the ball.
 * Within a few metres of the target the player keeps facing the ball (strafing / backpedalling).
 */
export function moveTo(cmd: PlayerCommand, p: Player, tx: number, tz: number, urgency: Urgency, faceX?: number, faceZ?: number, deadzone = 0.8): number {
  const dx = tx - p.pos.x,
    dz = tz - p.pos.z;
  const d = hyp(dx, dz);
  if (faceX !== undefined && faceZ !== undefined && d < (urgency >= 2 ? 3 : 7) && cmd.face) {
    cmd.face.set(faceX - p.pos.x, faceZ - p.pos.z);
  }
  if (d < deadzone) {
    cmd.move.set(0, 0);
    cmd.sprint = false;
    return d;
  }
  let pace: number;
  let sprint = false;
  switch (urgency) {
    case 0:
      pace = d < 4 ? PACE.walk : d < 14 ? PACE.jog : PACE.run;
      break;
    case 1:
      pace = d < 2.5 ? PACE.walk : d < 9 ? PACE.jog : PACE.run;
      sprint = d > 18;
      break;
    case 2:
      pace = d < 1.5 ? PACE.jog : PACE.run;
      sprint = d > 5;
      break;
    default:
      pace = PACE.run;
      sprint = d > 1.2;
      break;
  }
  // Ease in to the target.
  const ease = clamp(d / (urgency >= 2 ? 0.8 : 1.6), 0.35, 1);
  cmd.move.set((dx / d) * pace * ease, (dz / d) * pace * ease);
  cmd.sprint = sprint;
  return d;
}

/** Deepest outfield defender x (in attacking direction coordinates of `team`'s opponents). */
export function lastDefenderX(world: World, attackingTeam: TeamId): number {
  const dir = world.attackDir(attackingTeam);
  let best = -Infinity;
  for (const o of world.players) {
    if (o.team === attackingTeam || o.isGK) continue;
    best = Math.max(best, o.pos.x * dir);
  }
  return best === -Infinity ? 0 : best * dir;
}
