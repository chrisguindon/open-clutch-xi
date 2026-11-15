/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { PLAYER, TeamId } from '../config';
import { groundPassSpeed, groundTravelTime, passEndSpeed } from '../ball';
import { World } from '../world';
import { Player } from '../player';
import { clamp, pointSegmentDistXZ, hyp } from '../../core/math';

/**
 * Positional value of a point for a team (0..1): progress towards goal, weighted by centrality
 * near the goal. A lightweight stand-in for "expected threat" models.
 */
export function positionValue(world: World, team: TeamId, x: number, z: number): number {
  const L = world.pitch.length,
    W = world.pitch.width;
  const dir = world.attackDir(team);
  const u = clamp((x * dir + L / 2) / L, 0, 1);
  const c = 1 - clamp(Math.abs(z) / (W / 2), 0, 1);
  return 0.06 + 0.5 * u * u + 0.44 * u * u * u * (0.35 + 0.65 * c);
}

export interface ShotEval {
  quality: number;
  aimZ: number;
  distance: number;
}

/** Shot quality from (x, z) for `team`, with the best aim point across the goal mouth. */
export function evaluateShot(world: World, team: TeamId, x: number, z: number, shooterId: number): ShotEval {
  const p = world.pitch;
  const goalX = (world.attackDir(team) * p.length) / 2;
  const dx = goalX - x;
  const dist = hyp(dx, z);
  const gw = p.goalWidth / 2;
  // Opening angle subtended by the posts.
  const a1 = Math.atan2(gw - z, Math.abs(dx));
  const a2 = Math.atan2(-gw - z, Math.abs(dx));
  const angle = Math.abs(a1 - a2);
  const maxDist = Math.min(30, p.length * 0.48);
  const distF = clamp(1 - (dist - 5) / (maxDist - 5), 0, 1);
  const angF = Math.pow(clamp(angle / 0.55, 0, 1), 0.65);
  let q = distF * angF;

  // Best aim point: maximise the keeper's required movement and avoid blockers.
  let bestScore = -Infinity,
    bestZ = 0;
  const keeper = world.players.find((pl) => pl.isGK && pl.team !== team);
  const samples = 7;
  for (let i = 0; i < samples; i++) {
    const az = -gw + 0.4 + ((2 * gw - 0.8) * i) / (samples - 1);
    let score = 0;
    if (keeper) {
      // Lateral distance of the keeper from the shot line at the keeper's depth.
      const t = clamp((keeper.pos.x - x) / (goalX - x || 1e-6), 0, 1);
      const lineZ = z + (az - z) * t;
      score += Math.min(2.5, Math.abs(keeper.pos.z - lineZ)) * 0.6;
    }
    for (const o of world.players) {
      if (o.team === team || o.isGK || o.id === shooterId) continue;
      const s = pointSegmentDistXZ(o.pos.x, o.pos.z, x, z, goalX, az);
      if (s.t > 0.02 && s.t < 0.98 && s.dist < 1.1) score -= (1.1 - s.dist) * 1.5;
    }
    if (score > bestScore) {
      bestScore = score;
      bestZ = az;
    }
  }
  // Blockers in the shooting cone and keeper coverage reduce quality.
  for (const o of world.players) {
    if (o.team === team || o.id === shooterId) continue;
    if (o.isGK) continue;
    const s = pointSegmentDistXZ(o.pos.x, o.pos.z, x, z, goalX, bestZ);
    if (s.t > 0.03 && s.t < 0.95 && s.dist < 1.0) q *= 0.45 + s.dist * 0.4;
  }
  q *= clamp(0.55 + bestScore * 0.28, 0.35, 1.25);
  return { quality: clamp(q, 0, 1), aimZ: bestZ, distance: dist };
}

export interface PassEval {
  success: number;
  value: number;
  utility: number;
}

/**
 * Evaluate a ground pass from the ball to (tx, tz) for the receiver.
 * Success probability is based on whether any opponent can reach the passing lane before the ball.
 */
export function evaluatePass(world: World, passer: Player, receiver: Player, tx: number, tz: number, reactionTime: number, lofted = false): PassEval {
  const bx = world.ball.pos.x,
    bz = world.ball.pos.z;
  const dist = hyp(tx - bx, tz - bz);
  const v0 = lofted ? 16 : groundPassSpeed(dist, passEndSpeed(dist, 0.5));
  // The receiver meets the ball in the last metre or so: only the lane before that is contestable.
  const tMax = dist > 2 ? 1 - 1.2 / dist : 1;
  const ex = bx + (tx - bx) * tMax,
    ez = bz + (tz - bz) * tMax;
  let success = 1;
  // Lane interception. The pass is lost to the *first* defender who gets to the line, so only the two
  // most dangerous defenders count. Multiplying every defender's risk (the old rule) let the long tail of
  // the logistic curve add up: ten defenders five metres from the lane each shaved off ~10%, so in 11v11
  // nearly every pass in the attacking third rated below 5% and the AI simply stopped passing there.
  let r1 = 0,
    r2 = 0;
  for (const o of world.players) {
    if (o.team === passer.team) continue;
    const s = pointSegmentDistXZ(o.pos.x, o.pos.z, bx, bz, ex, ez);
    if (lofted && s.t < 0.75) continue; // lofted balls fly over mid-lane defenders
    const along = s.t * dist * tMax;
    const tb = lofted ? along / 14 : Math.min(groundTravelTime(v0, along), 4);
    const reach = o.isGK ? 1.6 : PLAYER.reach + 0.15;
    // A defender standing in the passing line right next to the passer will block it.
    if (s.t * dist < 2.5 && s.dist < 1.0 && s.t > 0) {
      success *= 0.35;
      continue;
    }
    const to = Math.max(0, s.dist - reach) / (PLAYER.sprintSpeed * 0.9) + reactionTime;
    const margin = to - tb;
    const risk = 1 / (1 + Math.exp(margin * 8));
    if (risk > r1) {
      r2 = r1;
      r1 = risk;
    } else if (risk > r2) r2 = risk;
  }
  success *= (1 - r1 * 0.92) * (1 - r2 * 0.46);
  // Receiver must get there before defenders.
  const rDist = hyp(tx - receiver.pos.x, tz - receiver.pos.z);
  const tArrive = lofted ? dist / 14 : Math.min(groundTravelTime(v0, dist), 4);
  const tReceiver = Math.max(0, rDist - 0.5) / (PLAYER.sprintSpeed * 0.9);
  if (tReceiver > tArrive + 0.6) success *= 0.55;
  if (dist < 3) success *= 0.6;
  // the reception point itself is contested. The lane check above misses a defender who simply
  // gets to the target spot first (through balls into a covered area, passes to a tightly marked player).
  // The receiver can't take the ball before it arrives; an opponent who can be there by then wins it.
  const tTake = Math.max(tReceiver, tArrive);
  const toFeet = rDist < 1.5;
  // Only the first defender to get there matters, so take the most dangerous one (multiplying over
  // every nearby opponent made any forward pass in 11v11 look hopeless).
  let maxRisk = 0;
  for (const o of world.players) {
    if (o.team === passer.team) continue;
    const od = hyp(tx - o.pos.x, tz - o.pos.z);
    if (od > 12) continue;
    // Keepers claim high balls in their area from much further away.
    const reach = o.isGK ? (lofted && world.inPenaltyArea(tx, tz, o.team) ? 3 : 1.4) : PLAYER.reach;
    const tOpp = Math.max(0, od - reach) / (PLAYER.sprintSpeed * 0.9) + reactionTime;
    maxRisk = Math.max(maxRisk, 1 / (1 + Math.exp((tOpp - tTake) * 6)));
  }
  // A ground pass to a team-mate's feet: they can shield it, so the lane check above is enough (measured:
  // carrier passes to feet completed 99% with this term, i.e. it only made the AI timid). Passes into
  // space and crosses (aerial duels, keepers claiming) are genuinely contested at the landing spot.
  if (!toFeet || lofted) success *= 1 - maxRisk * (lofted ? 0.6 : 0.5);
  // the ball keeps rolling until the receiver arrives. A pass into empty space by the touchline
  // or byline (rated "open" above) that runs out before the receiver gets there is a wasted ball.
  if (dist > 0.5) {
    const late = Math.max(0, tReceiver - tArrive);
    const vEnd = lofted ? 6 : passEndSpeed(dist, 0.5);
    const run = Math.min(late * vEnd * 0.8, 12) + 0.6;
    const ux = (tx - bx) / dist,
      uz = (tz - bz) / dist;
    const mx = tx + ux * run,
      mz = tz + uz * run;
    const L2 = world.pitch.length / 2,
      W2 = world.pitch.width / 2;
    if (Math.abs(mx) > L2 || Math.abs(mz) > W2) success *= 0.35;
  }
  // A passer closed down to arm's length is often tackled or hurried during the wind-up.
  const near = nearestOpponent(world, passer.team, bx, bz).dist;
  if (near < 1.2) success *= 0.75 + near * 0.2;

  const value = positionValue(world, passer.team, tx, tz);
  return { success: clamp(success, 0, 1), value, utility: 0 };
}

/**
 * Where to clear the ball: sample landing spots ~25–35 m away across a wide arc and pick the
 * one furthest from opponents and nearest to a team-mate. Going out of play near the touchline is an
 * acceptable result (it relieves pressure); towards our own goal is never considered.
 */
export function chooseClearance(world: World, team: TeamId, fromX: number, fromZ: number, allowTouch = true): { x: number; z: number; why: string } {
  const dir = world.attackDir(team);
  const L2 = world.pitch.length / 2,
    W2 = world.pitch.width / 2;
  let best = { x: fromX + dir * 25, z: fromZ, score: -Infinity, why: '' };
  const len = Math.min(32, world.pitch.length * 0.4);
  for (let i = -6; i <= 6; i++) {
    const ang = i * 0.2; // ±69° from straight up the pitch
    const lx = fromX + dir * Math.cos(ang) * len;
    let lz = fromZ + Math.sin(ang) * len;
    const out = Math.abs(lz) > W2 - 0.5;
    if (out && !allowTouch) lz = Math.sign(lz) * (W2 - 2);
    else if (out) lz = Math.sign(lz) * (W2 + 1);
    if (Math.abs(lx) > L2 - 2) continue;
    let opp = Infinity,
      mate = Infinity;
    for (const p of world.players) {
      const d = hyp(p.pos.x - lx, p.pos.z - lz);
      if (p.team === team) mate = Math.min(mate, d);
      else opp = Math.min(opp, d);
    }
    // Into touch: a safe reset (throw-in to them, but far from our goal).
    const score = out && allowTouch ? 2.5 : Math.min(opp, 15) - Math.min(mate, 15) * 0.6 + (lx * dir) / L2;
    if (score > best.score)
      best = {
        x: lx,
        z: lz,
        score,
        why: out ? 'into touch (no open landing spot)' : `landing ${opp.toFixed(0)} m from an opponent, ${mate.toFixed(0)} m from a team-mate`,
      };
  }
  return { x: best.x, z: best.z, why: best.why };
}

/** Distance and id of the nearest opponent to a point. */
export function nearestOpponent(world: World, team: TeamId, x: number, z: number): { dist: number; id: number } {
  let best = Infinity,
    id = -1;
  for (const o of world.players) {
    if (o.team === team) continue;
    const d = hyp(o.pos.x - x, o.pos.z - z);
    if (d < best) {
      best = d;
      id = o.id;
    }
  }
  return { dist: best, id };
}

/**
 * Find the teammate that best matches a pass direction (used for human pass assistance).
 * Scores alignment with the requested direction and distance.
 */
export function pickPassTarget(world: World, passer: Player, dirX: number, dirZ: number, maxDist: number): Player | null {
  const dl = hyp(dirX, dirZ);
  if (dl < 1e-3) return null;
  dirX /= dl;
  dirZ /= dl;
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const t of world.players) {
    if (t.team !== passer.team || t.id === passer.id) continue;
    const dx = t.pos.x - passer.pos.x,
      dz = t.pos.z - passer.pos.z;
    const d = hyp(dx, dz);
    if (d < 1.5 || d > maxDist) continue;
    const cos = (dx * dirX + dz * dirZ) / d;
    if (cos < 0.55) continue;
    const openness = Math.min(6, nearestOpponent(world, passer.team, t.pos.x, t.pos.z).dist) / 6;
    const score = cos * 2.2 - (d / maxDist) * 0.7 + openness * 0.35 - (t.isGK ? 0.6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
