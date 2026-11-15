/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { AIProfile, GK } from '../config';
import { Anim, Player, PlayerCommand } from '../player';
import { World } from '../world';
import { Situation } from './situation';
import { chooseClearance, evaluatePass, nearestOpponent } from './evaluate';
import { arrive, TacticalContext } from './tactics';
import { clamp, hyp } from '../../core/math';

export interface KeeperMemory {
  reactTimer: number;
  reacted: boolean;
  holdDecision: number;
  noiseZ: number;
  noiseTimer: number;
}

export function newKeeperMemory(): KeeperMemory {
  return { reactTimer: 0, reacted: false, holdDecision: -1, noiseZ: 0, noiseTimer: 0 };
}

/**
 * Goalkeeper behaviour: angle-narrowing positioning, shot reaction with dives,
 * sweeping loose balls, smothering 1v1s and distribution after a catch.
 */
export function thinkKeeper(
  g: Player,
  world: World,
  sit: Situation,
  ctx: TacticalContext,
  profile: AIProfile,
  mem: KeeperMemory,
  cmd: PlayerCommand,
  dt: number,
): void {
  const ball = world.ball;
  const pitch = world.pitch;
  const dir = world.attackDir(g.team);
  const goalX = (-dir * pitch.length) / 2;
  const gw = pitch.goalWidth / 2;
  cmd.face?.set(ball.pos.x - g.pos.x, ball.pos.z - g.pos.z);

  // Holding the ball: distribute.
  if (ball.heldBy === g.id) {
    if (mem.holdDecision < 0) mem.holdDecision = GK.holdTime + world.rng.next() * 0.6;
    // Walk a couple of steps forward while looking for an option.
    arrive(cmd, g, goalX + dir * 3, clamp(g.pos.z, -4, 4), 99, 2);
    if (world.holdTime > mem.holdDecision) {
      mem.holdDecision = -1;
      cmd.kick = chooseDistribution(g, world, profile);
    }
    return;
  }
  mem.holdDecision = -1;

  // Penalty / restart where the keeper must stay on the line.
  if (ctx.phase === 'restart' && ctx.restart?.type === 'penalty' && ctx.restart.team !== g.team) {
    arrive(cmd, g, goalX + dir * 0.3, 0, 99, 1);
    return;
  }
  if (ctx.phase !== 'play') {
    if (ctx.restart?.type === 'goalKick' && ctx.restart.takerId === g.id) return; // handled by taker logic
    const t = positionalTarget(world, g, goalX, dir, gw, profile, mem, dt);
    arrive(cmd, g, t.x, t.z, 6, 1.2);
    return;
  }

  // Shot reaction.
  const threat = sit.threat[g.team];
  if (threat && world.lastKick && world.lastKick.team !== g.team) {
    mem.reactTimer += dt;
    if (mem.reactTimer >= profile.gkReaction && !mem.reacted && g.anim !== Anim.Dive) {
      // Where will the ball be when it reaches the keeper's depth?
      let tz = threat.z,
        ty = threat.y,
        tArr = threat.t;
      for (let i = 0; i < sit.pred.length / 3; i++) {
        const x = sit.pred[i * 3];
        if ((x - g.pos.x) * dir <= 0.1) {
          tz = sit.pred[i * 3 + 2];
          ty = sit.pred[i * 3 + 1];
          tArr = (i + 1) * 0.05;
          break;
        }
      }
      const lateral = tz - g.pos.z;
      const reachTime = Math.abs(lateral) / 4.5;
      if (Math.abs(lateral) > 0.75 && tArr < 1.1 && (tArr < reachTime + 0.25 || ty > 1.6)) {
        mem.reacted = true;
        cmd.dive = {
          z: Math.sign(lateral) * clamp(Math.abs(lateral) / (GK.diveSpeed * Math.max(0.2, tArr)), 0.35, 1),
          height: clamp((ty - 0.25) / 1.9, 0, 1),
        };
        return;
      }
      // Shuffle across to get the body behind it (keepers side-step, they don't sprint).
      arrive(cmd, g, g.pos.x, clamp(tz, -gw - 0.6, gw + 0.6), 99, 0.4);
      cmd.move.scale(0.55);
      cmd.sprint = false;
      return;
    }
    // Still reacting (or already committed): hold the set position, no sweeping at shots.
    cmd.move.set(0, 0);
    return;
  } else {
    mem.reactTimer = 0;
    mem.reacted = false;
  }

  // Sweep loose balls in (or near) the box when the keeper gets there first.
  const inBox = world.inPenaltyArea(sit.interceptX[g.id], sit.interceptZ[g.id], g.team);
  if (sit.loose && inBox) {
    const oppTeam = g.team === 0 ? 1 : 0;
    const oppT = sit.firstTime[oppTeam];
    if (sit.interceptTime[g.id] < oppT - 0.15 && sit.interceptTime[g.id] < 2.5) {
      arrive(cmd, g, sit.interceptX[g.id], sit.interceptZ[g.id], 3, 0.8);
      return;
    }
  }

  // 1v1: rush out to smother an attacker dribbling into the box.
  const ctrl = world.controller;
  if (ctrl && ctrl.team !== g.team && world.inPenaltyArea(ctrl.pos.x, ctrl.pos.z, g.team)) {
    const dBall = hyp(ball.pos.x - g.pos.x, ball.pos.z - g.pos.z);
    const goalDist = hyp(ball.pos.x - goalX, ball.pos.z);
    if (goalDist < pitch.penaltyAreaDepth * 0.95 && profile.gkPositioning > 0.5) {
      if (dBall < 1.9 && g.anim !== Anim.Dive) {
        const lz = ball.pos.z - g.pos.z;
        cmd.dive = { z: Math.abs(lz) < 0.3 ? (world.rng.chance(0.5) ? 0.35 : -0.35) : clamp(lz, -1, 1), height: 0 };
        return;
      }
      // Close the angle: approach the ball along the ball-goal line.
      const k = clamp(1 - 2.0 / Math.max(goalDist, 0.1), 0.15, 0.85);
      arrive(cmd, g, goalX + (ball.pos.x - goalX) * k, ball.pos.z * k, 2, 0.6);
      return;
    }
  }

  const t = positionalTarget(world, g, goalX, dir, gw, profile, mem, dt);
  arrive(cmd, g, t.x, t.z, 6, 1.0);
  // Set position with small steps when the ball is close; recover quickly when far out of position.
  const dBall = hyp(ball.pos.x - goalX, ball.pos.z);
  if (dBall < world.pitch.penaltyAreaDepth * 1.6) cmd.move.scale(0.7);
}

/** Position on the ball–goal line, coming off the line as the ball gets closer. */
function positionalTarget(
  world: World,
  g: Player,
  goalX: number,
  dir: number,
  gw: number,
  profile: AIProfile,
  mem: KeeperMemory,
  dt: number,
): { x: number; z: number } {
  const ball = world.ball;
  const bx = ball.pos.x,
    bz = ball.pos.z;
  const dx = bx - goalX,
    dz = bz;
  const dist = hyp(dx, dz) || 1;
  const L = world.pitch.length;
  // Come off the line a little as the ball approaches, scaled by goal size.
  const gs = world.pitch.goalWidth / 7.32;
  const out = dist > L * 0.55 ? 2.5 * gs : clamp(0.3 + dist * 0.032, 0.3, 1.3) * gs;
  let x = goalX + (dx / dist) * out;
  let z = (dz / dist) * out * 1.0 + bz * 0.12;
  // Positioning error for weaker keepers (slowly varying).
  mem.noiseTimer -= dt;
  if (mem.noiseTimer <= 0) {
    mem.noiseTimer = 1.5;
    mem.noiseZ = world.rng.gaussian() * (1 - profile.gkPositioning) * 1.2;
  }
  z += mem.noiseZ;
  z = clamp(z, -gw + 0.2, gw - 0.2);
  if ((x - goalX) * dir < 0.3) x = goalX + dir * 0.3;
  void g;
  return { x, z };
}

function chooseDistribution(g: Player, world: World, profile: AIProfile) {
  const dir = world.attackDir(g.team);
  let best: { id: number; u: number; x: number; z: number; d: number } | null = null;
  for (const t of world.players) {
    if (t.team !== g.team || t.id === g.id) continue;
    const d = hyp(t.pos.x - g.pos.x, t.pos.z - g.pos.z);
    if (d > world.pitch.length * 0.6 || d < 5) continue;
    const ev = evaluatePass(world, g, t, t.pos.x, t.pos.z, profile.reaction, d > 22);
    const open = Math.min(8, nearestOpponent(world, g.team, t.pos.x, t.pos.z).dist) / 8;
    const u = ev.success * 0.8 + open * 0.3 + (((t.pos.x - g.pos.x) * dir) / world.pitch.length) * 0.4;
    if (!best || u > best.u) best = { id: t.id, u, x: t.pos.x, z: t.pos.z, d };
  }
  if (best && best.u > 0.75) {
    const dx = best.x - world.ball.pos.x,
      dz = best.z - world.ball.pos.z;
    return {
      kind: best.d > 22 ? ('lob' as const) : ('pass' as const),
      power: 0.6,
      dir: { x: dx, z: dz },
      target: { x: best.x, z: best.z },
      receiver: best.id,
      error: profile.passError,
    };
  }
  // No safe pass: clear to the least contested area rather than a random spot.
  const c = chooseClearance(world, g.team, world.ball.pos.x, world.ball.pos.z);
  return {
    kind: 'clear' as const,
    power: 1,
    dir: { x: c.x - world.ball.pos.x, z: c.z - world.ball.pos.z },
    target: { x: c.x, z: c.z },
    error: profile.passError * 2,
  };
}
