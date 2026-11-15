/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { BALL, PLAYER, TeamId } from '../config';
import { hyp } from '../../core/math';
import { predictBall } from '../ball';
import { World } from '../world';
import { Player } from '../player';

/** Ball prediction: 64 samples, 0.05 s apart, covering 3.2 s of flight. */
export const PRED_STEPS = 64;
export const PRED_DT = 0.05;

/** A predicted shot on goal, so keepers and defenders can react before the ball arrives. */
export interface ShotThreat {
  /** Time until the ball crosses the goal line. */
  t: number;
  z: number;
  y: number;
}

/**
 * Shared per-tick analysis of the game state used by every AI decision.
 * Computing it once per tick keeps AI cost linear in the number of players.
 */
export class Situation {
  /** Predicted ball positions [x,y,z] at PRED_DT intervals. */
  readonly pred = new Float32Array(PRED_STEPS * 3);
  /** Earliest time each player can play the ball. */
  // Typed arrays avoid boxing doubles (a major source of garbage at 120 Hz).
  interceptTime = new Float64Array(0);
  interceptX = new Float64Array(0);
  interceptZ = new Float64Array(0);
  /** Player per team who reaches the ball first. */
  readonly first: [number | null, number | null] = [null, null];
  readonly firstTime: [number, number] = [Infinity, Infinity];
  /** Shot heading at the goal defended by team (index = defending team). */
  readonly threat: [ShotThreat | null, ShotThreat | null] = [null, null];
  /** Ball is loose (no controller, not held). */
  loose = true;

  update(world: World): void {
    const ball = world.ball;
    predictBall(ball.pos, ball.vel, ball.spin, PRED_STEPS, PRED_DT, this.pred);
    const n = world.players.length;
    if (this.interceptTime.length !== n) {
      this.interceptTime = new Float64Array(n).fill(Infinity);
      this.interceptX = new Float64Array(n);
      this.interceptZ = new Float64Array(n);
    }
    this.loose = world.controllerId === null && ball.heldBy === null;
    this.first[0] = this.first[1] = null;
    this.firstTime[0] = this.firstTime[1] = Infinity;

    const ctrl = world.controller;
    for (const p of world.players) {
      let t = Infinity,
        ix = ball.pos.x,
        iz = ball.pos.z;
      if (ctrl && ctrl.id === p.id) {
        t = 0;
      } else if (ball.heldBy !== null) {
        t = Infinity;
      } else {
        // Current position first.
        const t0 = timeToReach(p, ball.pos.x, ball.pos.z);
        if (t0 <= 0.02 && ball.pos.y < 1.0) {
          t = 0;
        } else {
          for (let i = 0; i < PRED_STEPS; i++) {
            const bx = this.pred[i * 3],
              by = this.pred[i * 3 + 1],
              bz = this.pred[i * 3 + 2];
            if (by > (p.isGK ? 2.4 : 1.0)) continue;
            const bt = (i + 1) * PRED_DT;
            if (timeToReach(p, bx, bz) <= bt) {
              t = bt;
              ix = bx;
              iz = bz;
              break;
            }
          }
          if (t === Infinity) {
            // Ball will still be moving after the horizon: chase the final point.
            const k = (PRED_STEPS - 1) * 3;
            ix = this.pred[k];
            iz = this.pred[k + 2];
            t = PRED_STEPS * PRED_DT + timeToReach(p, ix, iz);
          }
        }
      }
      // Controlled ball: opponents aim at the ball carrier's feet.
      if (ctrl && ctrl.id !== p.id) {
        ix = ball.pos.x + ctrl.vel.x * 0.3;
        iz = ball.pos.z + ctrl.vel.z * 0.3;
        t = timeToReach(p, ix, iz);
      }
      this.interceptTime[p.id] = t;
      this.interceptX[p.id] = ix;
      this.interceptZ[p.id] = iz;
      if (t < this.firstTime[p.team]) {
        this.firstTime[p.team] = t;
        this.first[p.team] = p.id;
      }
    }

    // Shots on goal.
    this.threat[0] = this.threat[1] = null;
    if (this.loose && ball.speed > 5) {
      for (const team of [0, 1] as TeamId[]) {
        const goalX = (-world.attackDir(team) * world.pitch.length) / 2;
        let px = ball.pos.x;
        for (let i = 0; i < PRED_STEPS; i++) {
          const x = this.pred[i * 3];
          if ((px - goalX) * (x - goalX) <= 0) {
            const y = this.pred[i * 3 + 1],
              z = this.pred[i * 3 + 2];
            if (Math.abs(z) < world.pitch.goalWidth / 2 + 1.0 && y < world.pitch.goalHeight + 0.6) {
              this.threat[team] = { t: (i + 1) * PRED_DT, z, y };
            }
            break;
          }
          px = x;
        }
      }
    }
  }
}

/** Estimated time for a player to get within reach of a point (sprinting). */
export function timeToReach(p: Player, x: number, z: number): number {
  const dx = x - p.pos.x,
    dz = z - p.pos.z;
  const d = hyp(dx, dz) - PLAYER.reach * 0.75;
  if (d <= 0) return 0;
  // Turning penalty: moving the wrong way costs time to brake.
  const sp = p.speed;
  let penalty = 0;
  if (sp > 0.5) {
    const cos = (p.vel.x * dx + p.vel.z * dz) / (sp * (d + PLAYER.reach * 0.75));
    penalty = (1 - cos) * sp * 0.045;
  }
  const lock = p.locked ? Math.max(0, p.lockTime - p.animTime) : 0;
  const fooled = p.fooled;
  return d / (PLAYER.sprintSpeed * 0.94) + penalty + lock + fooled;
}

export { BALL };
