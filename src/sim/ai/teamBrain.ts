/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { AIProfile, Formation, PACE, PLAYER, TeamId } from '../config';
import { Anim, KickRequest, Player, PlayerCommand } from '../player';
import { World } from '../world';
import { Situation } from './situation';
import { chooseClearance, evaluatePass, evaluateShot, nearestOpponent, positionValue } from './evaluate';
import { arrive, lastDefenderX, moveTo, slotPosition, TacticalContext } from './tactics';
import { KeeperMemory, newKeeperMemory, thinkKeeper } from './goalkeeper';
import { Vec2, clamp, hyp } from '../../core/math';

interface Memory {
  decisionTimer: number;
  dribble: Vec2;
  runTimer: number;
  runX: number;
  runZ: number;
  supportTimer: number;
  supportX: number;
  supportZ: number;
  tackleCooldown: number;
  restartTimer: number;
  restartDelay: number;
  reactTimer: number;
  practiceHold: number;
  /** Smoothed formation target (players don't chase every twitch of the ball). */
  homeX: number;
  homeZ: number;
  homeInit: boolean;
  supportScore: number;
  holdTimer: number;
  /** Seconds the current carrier has spent holding / recycling without progress (builds impatience). */
  patience: number;
  keeper: KeeperMemory;
}

/** A candidate action with its utility and the factors behind it (for the dev overlay / audit). */
type Option = { utility: number; label: string; kick?: KickRequest; dribble?: { x: number; z: number }; hold?: boolean; why?: string };

/** One ball-carrier decision: what was chosen, the alternatives and why (dev overlay, AI audit, tests). */
export interface DecisionInfo {
  team: TeamId;
  playerId: number;
  time: number;
  label: string;
  utility: number;
  /** Ball progress towards the attacked goal (-1 own goal line … 1 opponent's). */
  progress: number;
  /** Distance to the nearest opponent (m). */
  pressure: number;
  kick?: KickRequest;
  why?: string;
  options: Array<{ label: string; utility: number; why?: string }>;
}

/**
 * Team-level AI. Each tick it assigns roles (carrier, chaser, pressers, markers, supporters,
 * runners, shape-holders) then produces a PlayerCommand for every AI-controlled player.
 * Combines a role FSM, utility scoring for ball-carrier decisions and steering behaviours.
 */
export class TeamBrain {
  private mem: Memory[] = [];
  /** Who presses / marks whom (recomputed every tick, cheap). */
  private assignments = new Map<number, number>();
  private lastPossession: TeamId | null = null;
  // Reusable scratch collections (avoid per-tick allocations at 120 Hz).
  private teamList: Player[] = [];
  private aiOutfield: Player[] = [];
  private ranked: Player[] = [];
  private threats: Player[] = [];
  private supporters = new Set<number>();
  private homeTmp = { x: 0, z: 0 };
  private transitionTimer = 0;

  constructor(
    readonly team: TeamId,
    public profile: AIProfile,
    public formation: Formation,
  ) {}

  /** Optional hook for tests/tuning: observe every ball-carrier decision. */
  static decisionLog: ((label: string, progress: number, utility: number, options: Array<{ label: string; utility: number }>) => void) | null = null;
  /** Richer hook: every carrier decision with its alternatives and reasons. */
  static decisionInfo: ((d: DecisionInfo) => void) | null = null;
  /** Build human-readable reasons for each option (dev overlay / audit only; off in normal play). */
  static explain = false;
  /** Latest decision per player (for the dev overlay). */
  readonly lastDecision = new Map<number, DecisionInfo>();

  private memory(p: Player): Memory {
    let m = this.mem[p.index];
    if (!m) {
      m = this.mem[p.index] = {
        decisionTimer: 0,
        dribble: new Vec2(),
        runTimer: 0,
        runX: 0,
        runZ: 0,
        supportTimer: 0,
        supportX: p.pos.x,
        supportZ: p.pos.z,
        tackleCooldown: 0,
        restartTimer: 0,
        restartDelay: 1,
        reactTimer: 0,
        practiceHold: 0,
        homeX: p.pos.x,
        homeZ: p.pos.z,
        homeInit: false,
        supportScore: -Infinity,
        holdTimer: 0,
        patience: 0,
        keeper: newKeeperMemory(),
      };
    }
    return m;
  }

  /** A player was sent off: stop commanding them (the team plays on with one fewer). */
  removePlayer(id: number): void {
    const i = this.teamList.findIndex((p) => p.id === id);
    if (i >= 0) this.teamList.splice(i, 1);
    this.assignments.delete(id);
  }

  resetMemory(): void {
    this.mem = [];
    this.transitionTimer = 0;
  }

  think(world: World, sit: Situation, ctx: TacticalContext, dt: number, out: PlayerCommand[]): void {
    const team = this.team;
    if (this.teamList.length === 0) for (const p of world.players) if (p.team === team) this.teamList.push(p);
    const players = this.teamList;
    const ball = world.ball;
    const ctrl = world.controller;
    const ownBall = !!ctrl && ctrl.team === team;
    const oppBall = !!ctrl && ctrl.team !== team;
    const attacking = world.possessionTeam === team;

    // Transition delay: players need a moment (reaction) to switch between attack and defence.
    if (world.possessionTeam !== this.lastPossession) {
      this.lastPossession = world.possessionTeam;
      this.transitionTimer = this.profile.reaction;
    }
    this.transitionTimer = Math.max(0, this.transitionTimer - dt);
    const shapeAttacking = this.transitionTimer > 0 ? !attacking : attacking;

    for (const p of players) {
      const m = this.memory(p);
      m.tackleCooldown = Math.max(0, m.tackleCooldown - dt);
      m.runTimer = Math.max(0, m.runTimer - dt);
      m.supportTimer -= dt;
    }

    // Set pieces and idle phases.
    if (ctx.phase !== 'play') {
      for (const p of players) {
        if (p.id === ctx.humanId) continue;
        const cmd = out[p.id];
        if (ctx.phase === 'idle') {
          cmd.face?.set(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
          continue;
        }
        if (p.isGK && !(ctx.restart && ctx.restart.takerId === p.id)) {
          thinkKeeper(p, world, sit, ctx, this.profile, this.memory(p).keeper, cmd, dt);
          continue;
        }
        this.setPiece(p, world, ctx, cmd, dt);
      }
      return;
    }

    // Role assignment.
    const human = ctx.humanId !== null ? world.players[ctx.humanId] : null;
    const humanOnTeam = human && human.team === team ? human : null;
    const aiOutfield = this.aiOutfield;
    aiOutfield.length = 0;
    for (const p of players) if (!p.isGK && p.id !== ctx.humanId) aiOutfield.push(p);

    // Chaser for loose balls: earliest arrival, unless the human is about as quick.
    let chaser: Player | null = null;
    if (sit.loose) {
      let best: Player | null = null;
      let bestT = Infinity;
      for (const p of aiOutfield) {
        const t = sit.interceptTime[p.id];
        if (t < bestT) {
          bestT = t;
          best = p;
        }
      }
      const humanT = humanOnTeam ? sit.interceptTime[humanOnTeam.id] : Infinity;
      if (best && bestT < humanT - 0.35) chaser = best;
      // Only chase a pass meant for a teammate if we're the intended receiver or nobody else is closer.
      const lk = world.lastKick;
      if (lk && lk.team === team && lk.receiver !== null && lk.receiver !== ctx.humanId) {
        const recv = world.players[lk.receiver];
        if (recv && !recv.isGK && recv.team === team && world.time - lk.time < 3) chaser = recv;
      }
    }

    // Pressing & marking assignments when defending.
    this.assignments.clear();
    let presser: Player | null = null;
    let cover: Player | null = null;
    if (oppBall && ctrl) {
      const ranked = this.ranked;
      ranked.length = 0;
      for (const p of aiOutfield) ranked.push(p);
      ranked.sort((a, b) => sit.interceptTime[a.id] - sit.interceptTime[b.id]);
      const humanT = humanOnTeam ? sit.interceptTime[humanOnTeam.id] : Infinity;
      const dir = world.attackDir(team);
      const ballInOwnHalf = ball.pos.x * dir < world.pitch.length * 0.1;
      const pressHeight = this.profile.press > 0.6 || ballInOwnHalf;
      if (ranked.length && (!humanOnTeam || sit.interceptTime[ranked[0].id] < humanT - 1.0)) {
        if (pressHeight || sit.interceptTime[ranked[0].id] < 1.2) presser = ranked.shift() ?? null;
      }
      if (this.profile.press > 0.55 && ballInOwnHalf && ranked.length > 1) cover = ranked.shift() ?? null;
      // Markers: assign remaining defenders to dangerous opponents (greedy by distance).
      const threats = this.threats;
      threats.length = 0;
      for (const o of world.players) if (o.team !== team && !o.isGK && o.id !== ctrl.id) threats.push(o);
      threats.sort((a, b) => b.pos.x * -dir - a.pos.x * -dir); // most advanced first
      const free = ranked; // remaining candidates are consumed in place
      for (const o of threats) {
        if (!free.length) break;
        let bi = -1,
          bd = Infinity;
        for (let i = 0; i < free.length; i++) {
          const d = hyp(free[i].pos.x - o.pos.x, free[i].pos.z - o.pos.z);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        if (bi >= 0 && bd < world.pitch.length * 0.4) {
          this.assignments.set(free[bi].id, o.id);
          free.splice(bi, 1);
        }
      }
    }

    // Supporters: the two teammates nearest the carrier move into open passing angles.
    const supporters = this.supporters;
    supporters.clear();
    if (ownBall && ctrl) {
      // Two nearest teammates to the carrier (no allocation).
      let a: Player | null = null,
        b: Player | null = null,
        da = Infinity,
        db = Infinity;
      for (const p of aiOutfield) {
        if (p.id === ctrl.id) continue;
        const d = p.pos.distanceTo(ctrl.pos);
        if (d < da) {
          b = a;
          db = da;
          a = p;
          da = d;
        } else if (d < db) {
          b = p;
          db = d;
        }
      }
      if (a) supporters.add(a.id);
      if (b) supporters.add(b.id);
    }

    for (const p of players) {
      if (p.id === ctx.humanId) continue;
      const cmd = out[p.id];
      const m = this.memory(p);
      if (p.isGK) {
        if (ctrl && ctrl.id === p.id && ball.heldBy === null) {
          // Ball at the keeper's feet (back-pass): play it like an outfield player, safely.
          this.carrier(p, world, sit, ctx, cmd, m, dt);
        } else {
          thinkKeeper(p, world, sit, ctx, this.profile, m.keeper, cmd, dt);
        }
        continue;
      }
      const slot = this.formation.slots[p.index] ?? this.formation.slots[this.formation.slots.length - 1];
      const raw = slotPosition(world, team, slot, shapeAttacking, ball.pos.x, ball.pos.z);
      // Positional discipline: the shape target eases towards the ideal spot instead of twitching with the ball.
      if (!m.homeInit || hyp(raw.x - m.homeX, raw.z - m.homeZ) > 18) {
        m.homeX = raw.x;
        m.homeZ = raw.z;
        m.homeInit = true;
      } else {
        const k = 1 - Math.exp(-1.4 * dt);
        m.homeX += (raw.x - m.homeX) * k;
        m.homeZ += (raw.z - m.homeZ) * k;
      }
      const home = this.homeTmp;
      home.x = m.homeX;
      home.z = m.homeZ;

      if (ctrl && ctrl.id === p.id) {
        this.carrier(p, world, sit, ctx, cmd, m, dt);
      } else if (chaser && chaser.id === p.id) {
        this.chase(p, world, sit, cmd);
      } else if (presser && presser.id === p.id && ctrl) {
        this.press(p, ctrl, world, cmd, m, dt);
      } else if (cover && cover.id === p.id && ctrl) {
        const g = this.ownGoal(world);
        const dx = g.x - ctrl.pos.x,
          dz = g.z - ctrl.pos.z;
        const d = hyp(dx, dz) || 1;
        moveTo(cmd, p, ctrl.pos.x + (dx / d) * 4.5, ctrl.pos.z + (dz / d) * 4.5, 1, ball.pos.x, ball.pos.z);
      } else if (this.assignments.has(p.id)) {
        this.mark(p, world.players[this.assignments.get(p.id)!], world, cmd, home);
      } else if (ownBall || (sit.loose && attacking)) {
        this.attackPosition(p, world, sit, cmd, m, home, supporters.has(p.id), dt);
      } else {
        // Out of possession and off the ball: recover urgently if caught upfield of the ball.
        const behindBall = (p.pos.x - ball.pos.x) * world.attackDir(team) > 6 && !attacking;
        moveTo(cmd, p, home.x, home.z, behindBall ? 2 : 0, ball.pos.x, ball.pos.z, 1.0);
      }
    }
  }

  private ownGoal(world: World): { x: number; z: number } {
    return { x: (-world.attackDir(this.team) * world.pitch.length) / 2, z: 0 };
  }

  private chase(p: Player, world: World, sit: Situation, cmd: PlayerCommand): void {
    const ball = world.ball;
    const ix = sit.interceptX[p.id],
      iz = sit.interceptZ[p.id];
    // Sprint only when it's a race for the ball; otherwise run onto it.
    const oppTeam = this.team === 0 ? 1 : 0;
    const contested = sit.firstTime[oppTeam] < sit.interceptTime[p.id] + 1.2;
    moveTo(cmd, p, ix, iz, contested ? 3 : 2, undefined, undefined, 0.2);
    // Attack high balls: header towards goal in the attacking box, clear in our own box.
    const dBall = hyp(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
    if (ball.pos.y > 1.2 && dBall < 2.2) {
      const dir = world.attackDir(this.team);
      const goalX = (dir * world.pitch.length) / 2;
      const nearOppGoal = Math.abs(goalX - ball.pos.x) < world.pitch.penaltyAreaDepth + 2;
      const inOwnBox = world.inPenaltyArea(ball.pos.x, ball.pos.z, this.team);
      if (nearOppGoal) {
        const aim = (world.rng.next() - 0.5) * world.pitch.goalWidth * 0.7;
        cmd.kick = { kind: 'shot', power: 0.8, dir: { x: goalX - ball.pos.x, z: aim - ball.pos.z }, height: 0.5, error: this.profile.shotError * 1.4 };
      } else if (inOwnBox) {
        cmd.kick = { kind: 'clear', power: 1, dir: { x: dir, z: Math.sign(ball.pos.z) * 0.6 }, error: 0.2 };
      }
    }
  }

  /**
   * Pressing: close down goal-side, then jockey at a short distance facing the ball and only
   * commit to a tackle when the ball comes off the carrier's feet. Poor tacklers dive in early.
   */
  private press(p: Player, carrier: Player, world: World, cmd: PlayerCommand, m: Memory, dt: number): void {
    const ball = world.ball;
    const g = this.ownGoal(world);
    const dx = g.x - ball.pos.x,
      dz = g.z - ball.pos.z;
    const d = hyp(dx, dz) || 1;
    const jockey = 1.9 - this.profile.press * 0.6;
    const tx = ball.pos.x + (dx / d) * jockey + carrier.vel.x * 0.2;
    const tz = ball.pos.z + (dz / d) * jockey + carrier.vel.z * 0.2;
    const dist = moveTo(cmd, p, tx, tz, 2, ball.pos.x, ball.pos.z, 0.25);
    const dirToGoal = world.attackDir(this.team);
    const inOurHalf = ball.pos.x * dirToGoal < world.pitch.length * 0.12;
    if (dist > 3 && !inOurHalf && this.profile.press < 0.6) cmd.sprint = false;
    if (dist < 2.5) {
      // Jockey: match the carrier's movement at a controlled pace, body facing the ball.
      cmd.face?.set(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      cmd.sprint = carrier.speed > PLAYER.runSpeed * 0.95;
      const ml = cmd.move.length();
      const want = Math.max(carrier.speed / PLAYER.runSpeed + 0.15, ml * 0.6);
      if (ml > 1e-3) cmd.move.scale(Math.min(1, want) / ml);
    }
    const footD = hyp(ball.pos.x - p.footX(0.5), ball.pos.z - p.footZ(0.5));
    if (m.tackleCooldown <= 0 && footD < 1.15 && carrier.anim !== Anim.Stumble) {
      const exposure = world.exposure(carrier);
      const shielded = world.isShielded(carrier, p);
      // Good defenders time the tackle for when the ball is exposed; weaker ones lunge regardless.
      const rate = exposure > 0.4 && !shielded ? 1.5 + this.profile.tackle * 3.5 : (1 - this.profile.tackle) * 0.9 + (carrier.speed < 1 ? 0.25 : 0);
      // Contain in midfield, commit in our own third.
      const fromOwnGoal = ((ball.pos.x - g.x) * dirToGoal) / world.pitch.length; // 0 = our goal line, 1 = theirs
      const zone = fromOwnGoal < 0.35 ? 1 : fromOwnGoal < 0.7 ? 0.55 : 0.35;
      if (world.rng.next() < rate * zone * dt) {
        p.facing = Math.atan2(ball.pos.z - p.pos.z, ball.pos.x - p.pos.x);
        const inOwnBox = world.inPenaltyArea(p.pos.x, p.pos.z, this.team);
        const behind = Math.cos(carrier.facing) * Math.cos(p.facing) + Math.sin(carrier.facing) * Math.sin(p.facing) > 0.4;
        const slide = !inOwnBox && behind && carrier.speed > 5.5 && exposure > 0.5 && world.rng.chance(0.3 * this.profile.tackle);
        cmd.tackle = slide ? 'slide' : 'stand';
        m.tackleCooldown = 1.3 - this.profile.tackle * 0.5;
      }
    }
  }

  private mark(p: Player, o: Player, world: World, cmd: PlayerCommand, home: { x: number; z: number }): void {
    const ball = world.ball;
    const g = this.ownGoal(world);
    const dx = g.x - o.pos.x,
      dz = g.z - o.pos.z;
    const d = hyp(dx, dz) || 1;
    const md = this.profile.markDistance;
    // Goal-side and slightly ball-side of the opponent.
    const bx = ball.pos.x - o.pos.x,
      bz = ball.pos.z - o.pos.z;
    const bd = hyp(bx, bz) || 1;
    let tx = o.pos.x + (dx / d) * md + (bx / bd) * 0.7;
    let tz = o.pos.z + (dz / d) * md + (bz / bd) * 0.7;
    // Blend with zonal shape when the opponent is far from our area of responsibility.
    const far = hyp(tx - home.x, tz - home.z);
    if (far > 14) {
      const k = clamp((far - 14) / 10, 0, 0.7);
      tx += (home.x - tx) * k;
      tz += (home.z - tz) * k;
    }
    const urgentMark = hyp(o.pos.x - g.x, o.pos.z - g.z) < world.pitch.length * 0.35;
    moveTo(cmd, p, tx, tz, urgentMark ? 2 : 1, ball.pos.x, ball.pos.z, 0.9);
  }

  private attackPosition(
    p: Player,
    world: World,
    sit: Situation,
    cmd: PlayerCommand,
    m: Memory,
    home: { x: number; z: number },
    supporter: boolean,
    dt: number,
  ): void {
    const ball = world.ball;
    const dir = world.attackDir(this.team);
    const L2 = world.pitch.length / 2,
      W2 = world.pitch.width / 2;
    const carrier = world.controller;

    // Attacking the penalty area (11v11). With a team-mate on the ball in the final third, forwards and
    // then midfielders take distinct spots in and around the box instead of waiting level with the ball.
    // Measured before this existed: in 11v11 fewer than one team-mate was ahead of an attacking-third
    // carrier, so every pass scored as a loss of position and carriers dribbled into crowded defences
    // (one pass in 332 attacking-third decisions; 0.8 shots a minute against 3.6 in 5v5).
    if (carrier && carrier.team === this.team && carrier.id !== p.id && world.players.length >= 16) {
      const target = this.boxTarget(p, carrier, world);
      if (target) {
        moveTo(cmd, p, target.x, target.z, 1, ball.pos.x, ball.pos.z, 0.8);
        return;
      }
    }

    // 11v11, ball in midfield: forwards hold the last defender's shoulder in the widest gap of the back
    // line (onside), so the carrier always has a forward option before the box spots above take over.
    if (carrier && carrier.team === this.team && carrier.id !== p.id && p.role === 'FWD' && world.players.length >= 16 && m.runTimer <= 0) {
      const progress = (carrier.pos.x * dir) / L2;
      if (progress > 0.1 && progress < 0.5) {
        const target = this.channelTarget(p, world);
        moveTo(cmd, p, target.x, target.z, 1, ball.pos.x, ball.pos.z, 0.8);
        return;
      }
    }

    // Forward runs in behind when a teammate has the ball facing forward.
    if (m.runTimer > 0) {
      const d = moveTo(cmd, p, m.runX, m.runZ, 2, undefined, undefined, 0.6);
      if (d < 1) m.runTimer = 0;
      return;
    }
    if (carrier && carrier.team === this.team && p.role !== 'DEF') {
      const facingFwd = Math.cos(carrier.facing) * dir > 0.2;
      const lineX = lastDefenderX(world, this.team);
      const behind = (p.pos.x - lineX) * dir;
      // Runs are occasional, timed events (about one every few seconds per willing runner).
      if (facingFwd && behind > -10 && world.rng.next() < this.profile.runs * 0.55 * dt) {
        m.runTimer = 2.4;
        m.runX = clamp(lineX + dir * 6, -L2 + 3, L2 - 3);
        m.runZ = clamp(p.pos.z * 0.6 + world.rng.range(-4, 4), -W2 + 3, W2 - 3);
        return;
      }
    }

    // Find an open spot near home (or near the carrier for supporters). Re-evaluated only every
    // second or so, and players only relocate for a clearly better spot (no constant shuffling).
    if (m.supportTimer <= 0) {
      m.supportTimer = 1.0 + world.rng.next() * 0.6;
      const cx = supporter && carrier ? carrier.pos.x : home.x;
      const cz = supporter && carrier ? carrier.pos.z : home.z;
      let best = -Infinity;
      const samples = 9;
      const keepX = m.supportX,
        keepZ = m.supportZ;
      for (let i = -1; i < samples; i++) {
        let sx: number, sz: number;
        if (i === -1) {
          sx = keepX;
          sz = keepZ;
        } else if (supporter && carrier) {
          const ang = (i / samples) * Math.PI * 2;
          const r = 8 + (i % 3) * 2.5;
          sx = cx + Math.cos(ang) * r;
          sz = cz + Math.sin(ang) * r;
        } else {
          const ang = (i / samples) * Math.PI * 2;
          const r = i === 0 ? 0 : 3.5;
          sx = cx + Math.cos(ang) * r;
          sz = cz + Math.sin(ang) * r;
        }
        sx = clamp(sx, -L2 + 2, L2 - 2);
        sz = clamp(sz, -W2 + 1.5, W2 - 1.5);
        const open = Math.min(8, nearestOpponent(world, this.team, sx, sz).dist);
        let score = open * 0.25 + positionValue(world, this.team, sx, sz) * 2.2;
        score -= hyp(sx - home.x, sz - home.z) * (supporter ? 0.05 : 0.14);
        // Passing lane from the ball must be clear.
        if (carrier) {
          for (const o of world.players) {
            if (o.team === this.team) continue;
            const ax = ball.pos.x,
              az = ball.pos.z;
            const abx = sx - ax,
              abz = sz - az;
            const len2 = abx * abx + abz * abz || 1;
            const t = clamp(((o.pos.x - ax) * abx + (o.pos.z - az) * abz) / len2, 0, 1);
            const dd = hyp(o.pos.x - (ax + abx * t), o.pos.z - (az + abz * t));
            if (dd < 1.6) score -= (1.6 - dd) * 1.2;
          }
        }
        // Don't crowd teammates.
        for (const t of world.players) {
          if (t.team !== this.team || t.id === p.id) continue;
          const dd = hyp(t.pos.x - sx, t.pos.z - sz);
          if (dd < 5) score -= (5 - dd) * 0.25;
        }
        if (i === -1) score += 0.35; // hysteresis: prefer staying put
        if (score > best) {
          best = score;
          m.supportX = sx;
          m.supportZ = sz;
        }
      }
    }
    void sit;
    moveTo(cmd, p, m.supportX, m.supportZ, supporter ? 1 : 0, ball.pos.x, ball.pos.z, 1.0);
  }

  private channelTmp = { x: 0, z: 0 };
  private defenderZ = new Float32Array(16);
  /**
   * A forward's spot on the shoulder of the last defender: just onside, in the middle of the widest gap
   * between defenders near the line (nearest to the forward when gaps are similar). Allocation-free.
   */
  private channelTarget(p: Player, world: World): { x: number; z: number } {
    const dir = world.attackDir(this.team);
    const W2 = world.pitch.width / 2;
    const line = lastDefenderX(world, this.team) * dir; // attack-frame depth of the offside line
    let n = 0;
    for (const o of world.players) {
      if (o.team === this.team || o.isGK || o.sentOff) continue;
      if (line - o.pos.x * dir < 12 && n < this.defenderZ.length) this.defenderZ[n++] = o.pos.z;
    }
    const zs = this.defenderZ.subarray(0, n).sort();
    const edge = W2 * 0.7;
    let bestScore = -Infinity,
      bestZ = p.pos.z;
    for (let i = 0; i <= n; i++) {
      const lo = i === 0 ? -edge : zs[i - 1],
        hi = i === n ? edge : zs[i];
      if (hi <= lo) continue;
      const mid = (lo + hi) / 2;
      const score = Math.min(hi - lo, 20) - Math.abs(mid - p.pos.z) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestZ = mid;
      }
    }
    this.channelTmp.x = (line - 1) * dir;
    this.channelTmp.z = clamp(bestZ, -edge, edge);
    return this.channelTmp;
  }

  private boxTmp = { x: 0, z: 0 };
  /**
   * This player's attacking spot when a team-mate carries the ball in the final third, or null.
   *
   * Spots, in order of who takes them: near post, penalty spot, far post (forwards first), then the edge
   * of the box for a cut-back (the next midfielder). "Near" is the side the ball is on, as in real
   * attacking play: runs that attack the near post, the far post and the space a cut-back goes to.
   * Every spot is kept onside: no further forward than the deepest outfield defender (the offside line,
   * with the keeper the last opponent), because offside applies in 11v11.
   * Allocation-free: the slot is this player's rank among eligible team-mates by their place in the team list.
   */
  private boxTarget(p: Player, carrier: Player, world: World): { x: number; z: number } | null {
    if (p.role === 'DEF' || p.isGK) return null;
    const dir = world.attackDir(this.team);
    const L2 = world.pitch.length / 2;
    // Only once the carrier is within about 26 m of goal: earlier, runners left the carrier with no
    // support nearby (measured: fewer final-third entries and fewer shots).
    if ((carrier.pos.x * dir) / L2 < 0.5) return null;
    // Rank: forwards (by index), then midfielders (by index), skipping the carrier and keepers/defenders.
    let slot = 0;
    for (const q of world.players) {
      if (q.team !== this.team || q.id === p.id || q.id === carrier.id || q.isGK || q.sentOff) continue;
      const ahead = (q.role === 'FWD' && p.role !== 'FWD') || (q.role === p.role && q.index < p.index);
      if (ahead) slot++;
    }
    if (slot > 3) return null;
    const side = carrier.pos.z >= 0 ? 1 : -1;
    const goalX = dir * L2;
    const t = this.boxTmp;
    switch (slot) {
      case 0: // near post
        t.x = goalX - dir * 5.5;
        t.z = side * 3.5;
        break;
      case 1: // penalty spot
        t.x = goalX - dir * 11;
        t.z = -side * 0.5;
        break;
      case 2: // far post
        t.x = goalX - dir * 6.5;
        t.z = -side * 4.5;
        break;
      default: // edge of the box, for a cut-back
        t.x = goalX - dir * 17;
        t.z = side * 5;
    }
    // Stay onside: no further forward than the deepest outfield defender (with a small margin).
    const line = lastDefenderX(world, this.team) * dir - 0.6;
    if (t.x * dir > line) t.x = line * dir;
    return t;
  }

  // ---------------------------------------------------------------------------
  // Ball carrier: utility-based decision making
  // ---------------------------------------------------------------------------

  private carrier(p: Player, world: World, _sit: Situation, ctx: TacticalContext, cmd: PlayerCommand, m: Memory, dt: number): void {
    const ball = world.ball;
    const prof = this.profile;
    const dir = world.attackDir(this.team);
    const L2 = world.pitch.length / 2,
      W2 = world.pitch.width / 2;
    const pressure = nearestOpponent(world, this.team, p.pos.x, p.pos.z).dist;

    // Practice partners just lay the ball back to the human.
    if (ctx.practice && ctx.humanId !== null) {
      m.practiceHold += dt;
      const h = world.players[ctx.humanId];
      cmd.face?.set(h.pos.x - p.pos.x, h.pos.z - p.pos.z);
      if (m.practiceHold > 0.6) {
        m.practiceHold = 0;
        const tx = h.pos.x + h.vel.x * 0.6,
          tz = h.pos.z + h.vel.z * 0.6;
        cmd.kick = { kind: 'pass', power: 0.5, dir: { x: tx - ball.pos.x, z: tz - ball.pos.z }, target: { x: tx, z: tz }, receiver: h.id, error: 0.02 };
      }
      return;
    }

    m.decisionTimer -= dt;
    const underPressure = pressure < 2.6;
    // Under pressure decisions come twice as often (but not every tick, which would make carriers dither).
    const due = m.decisionTimer <= 0 || (underPressure && m.decisionTimer <= prof.decisionInterval * 0.5);
    if (!due) {
      this.steerDribble(p, world, cmd, m);
      return;
    }
    m.decisionTimer = prof.decisionInterval * (0.8 + world.rng.next() * 0.4);

    const options: Option[] = [];
    const rng = world.rng;
    const noise = () => rng.gaussian() * prof.decisionNoise;
    const here = positionValue(world, this.team, ball.pos.x, ball.pos.z);
    const ex = TeamBrain.explain;
    const f2 = (v: number) => v.toFixed(2);

    // Keepers with the ball at their feet: pass it or clear it, never dribble upfield.
    if (p.isGK) {
      m.decisionTimer = Math.max(m.decisionTimer, 0.4);
    }

    // 11v11: ten defenders pack the penalty area, so most passes into it are genuinely blocked. Real
    // teams then go wide and cross, cut the ball back, or shoot from the edge of the box. These three
    // adjustments (11v11 only; small-sided play already creates plenty) let the AI do the same.
    const elevenASide = world.players.length >= 16;
    let teammatesInBox = 0;
    if (elevenASide) {
      for (const t of world.players) {
        if (t.team === this.team && t.id !== p.id && !t.isGK && world.inPenaltyArea(t.pos.x, t.pos.z, this.team === 0 ? 1 : 0)) teammatesInBox++;
      }
    }

    // 1. Shoot.
    const shot = evaluateShot(world, this.team, ball.pos.x, ball.pos.z, p.id);
    // A shot just below the quality threshold from the edge of the box is a reasonable attempt in 11v11
    // (the alternative is usually dribbling into a crowd); elsewhere it stays discouraged.
    const belowThresholdShot = elevenASide && shot.distance < 21 ? -0.03 : -0.12;
    // no hopeful punts — a shot needs a real chance (and long range costs extra).
    const longRange = Math.max(0, shot.distance - 22) * 0.025;
    if (!p.isGK && shot.quality > Math.max(prof.shotThreshold * 0.5, 0.07) && shot.distance < 27) {
      const goalX = dir * L2;
      const power = clamp(0.5 + shot.distance / 34, 0.5, 0.9);
      const curl = shot.distance > 12 && rng.chance(0.4) ? Math.sign(shot.aimZ) * dir * 0.6 : 0;
      options.push({
        label: 'shoot',
        utility: shot.quality * 1.8 + (shot.quality > prof.shotThreshold ? 0.34 : belowThresholdShot) + m.patience * 0.05 - longRange + noise(),
        why: ex ? `quality ${f2(shot.quality)} (threshold ${f2(prof.shotThreshold)}), ${shot.distance.toFixed(0)} m` : undefined,
        kick: {
          kind: 'shot',
          power,
          dir: { x: goalX - ball.pos.x, z: shot.aimZ - ball.pos.z },
          height: rng.range(0.25, 1.7),
          curl,
          error: prof.shotError,
        },
      });
      // Chip when the keeper is off his line and close.
      const keeper = world.players.find((q) => q.isGK && q.team !== this.team);
      if (keeper && shot.distance < 20 && Math.abs(keeper.pos.x - goalX) > 4) {
        options.push({
          label: 'chip',
          utility: shot.quality * 1.2 + 0.1 + noise(),
          kick: {
            kind: 'chip',
            power: 0.6,
            dir: { x: goalX - ball.pos.x, z: shot.aimZ - ball.pos.z },
            target: { x: goalX, z: shot.aimZ },
            error: prof.shotError,
          },
        });
      }
    }

    // 2. Passes & through balls.
    const maxPass = world.pitch.length * prof.vision + 6;
    for (const t of world.players) {
      if (t.team !== this.team || t.id === p.id) continue;
      const dist = t.pos.distanceTo(p.pos);
      if (dist > maxPass || dist < 3) continue;
      if (t.isGK && !(underPressure && ball.pos.x * dir < 0)) continue;
      // Ground pass to feet (leading slightly).
      const tx = t.pos.x + t.vel.x * 0.45,
        tz = t.pos.z + t.vel.z * 0.45;
      const ev = evaluatePass(world, p, t, tx, tz, prof.reaction * 0.8);
      // A wide player level with the box can cross to the team-mates attacking it: that's progress, even
      // though a wide position scores low on its own.
      const crossingZone = Math.abs(tz) > W2 * 0.45 && tx * dir > L2 * 0.5;
      const crossValue = elevenASide && crossingZone && teammatesInBox >= 2 ? 0.12 : 0;
      const gain = ev.value + crossValue - here;
      // Losing the ball is costly (more so deep in our own half): favour safe, patient circulation.
      const lossCost = 0.45 + (1 - positionValue(world, this.team, ball.pos.x, ball.pos.z)) * 0.5;
      const sure = ev.success * ev.success;
      let u = sure * (0.3 + gain * (3.0 + m.patience * 0.8)) - (1 - ev.success) * lossCost + noise();
      if (underPressure) u += 0.12;
      if (t.id === ctx.humanId) u += 0.08; // AI teammates like involving the human
      options.push({
        label: 'pass',
        utility: u,
        why: ex ? `to #${t.id}: success ${f2(ev.success)}, gain ${f2(gain)}, loss cost ${f2(lossCost)}` : undefined,
        kick: { kind: 'pass', power: 0.5, dir: { x: tx - ball.pos.x, z: tz - ball.pos.z }, target: { x: tx, z: tz }, receiver: t.id, error: prof.passError },
      });
      // Through ball into the runner's path.
      const runSpeed = t.vel.x * dir;
      if (runSpeed > 2.0 && !t.isGK) {
        const lead = clamp(dist * 0.35, 3.5, 9);
        const rx = clamp(t.pos.x + (t.vel.x / (t.speed || 1)) * lead, -L2 + 1.5, L2 - 1.5);
        const rz = clamp(t.pos.z + (t.vel.z / (t.speed || 1)) * lead, -W2 + 1.5, W2 - 1.5);
        const ev2 = evaluatePass(world, p, t, rx, rz, prof.reaction * 0.8);
        const u2 = ev2.success * ev2.success * (0.42 + (ev2.value - here) * 3.4) - (1 - ev2.success) * lossCost + noise();
        options.push({
          label: 'through',
          utility: u2,
          why: ex ? `to #${t.id}: success ${f2(ev2.success)}, gain ${f2(ev2.value - here)}` : undefined,
          kick: {
            kind: 'through',
            power: 0.5,
            dir: { x: rx - ball.pos.x, z: rz - ball.pos.z },
            target: { x: rx, z: rz },
            receiver: t.id,
            error: prof.passError,
          },
        });
      }
      // Cross from wide areas into the box.
      const wide = Math.abs(ball.pos.z) > W2 * 0.45 && ball.pos.x * dir > L2 * 0.45;
      const inBox = Math.abs(t.pos.x - dir * L2) < world.pitch.penaltyAreaDepth && Math.abs(t.pos.z) < world.pitch.penaltyAreaWidth / 2;
      if (wide && inBox && !t.isGK) {
        const cx = t.pos.x + t.vel.x * 0.5,
          cz = t.pos.z + t.vel.z * 0.5;
        const ev3 = evaluatePass(world, p, t, cx, cz, prof.reaction, true);
        // measured 0 of 10 crosses reaching a team-mate — only cross with a real chance. In 11v11, with
        // runners attacking the near post, spot and far post, a cross at even odds is a good option.
        if (ev3.success > (elevenASide ? 0.35 : 0.5))
          options.push({
            label: 'cross',
            utility: ev3.success * (elevenASide ? 0.8 : 0.65) + noise(),
            why: ex ? `to #${t.id} in the box: success ${f2(ev3.success)}` : undefined,
            kick: {
              kind: 'lob',
              power: 0.7,
              dir: { x: cx - ball.pos.x, z: cz - ball.pos.z },
              target: { x: cx, z: cz },
              receiver: t.id,
              error: prof.passError * 1.3,
            },
          });
      }
    }

    // 3. Dribble: sample directions towards goal and pick open space.
    const goalAng = Math.atan2(-ball.pos.z * 0.6, dir * L2 - ball.pos.x);
    let bestDrib: Option | null = null;
    for (let i = -3; i <= 3; i++) {
      const ang = goalAng + i * 0.42;
      const ax = Math.cos(ang),
        az = Math.sin(ang);
      const sx = p.pos.x + ax * 5,
        sz = p.pos.z + az * 5;
      if (Math.abs(sz) > W2 - 1 || Math.abs(sx) > L2 - 0.5) continue;
      const space = Math.min(7, nearestOpponent(world, this.team, sx, sz).dist);
      const gain = positionValue(world, this.team, sx, sz) - here;
      // Dribbling while closely pressed risks losing the ball.
      const pressPenalty = pressure < 3.5 ? (3.5 - pressure) * 0.18 : 0;
      const u = gain * (4.0 + m.patience) + Math.min(space, 6) * 0.035 - (space < 2 ? 0.35 : 0) + 0.06 - pressPenalty + noise();
      if (!bestDrib || u > bestDrib.utility)
        bestDrib = {
          label: 'dribble',
          utility: u,
          dribble: { x: ax, z: az },
          why: ex ? `space ${space.toFixed(1)} m, gain ${f2(gain)}, pressure ${pressure.toFixed(1)} m` : undefined,
        };
    }
    if (bestDrib && !p.isGK) options.push(bestDrib);
    // Hold / shield: keep the ball and wait for teammates to move into better positions.
    if (!p.isGK) {
      // A defender squared up in front makes holding (and waiting for support) more attractive.
      let blocked = false;
      for (const o of world.players) {
        if (o.team === this.team) continue;
        const ox = o.pos.x - p.pos.x,
          oz = o.pos.z - p.pos.z;
        const od = hyp(ox, oz);
        if (od < 3 && (ox * dir) / (od || 1) > 0.3) {
          blocked = true;
          break;
        }
      }
      options.push({ label: 'hold', utility: 0.08 + (blocked ? 0.14 : 0) - (pressure < 1.4 ? 0.1 : 0) - m.patience * 0.12 + noise() * 0.5, hold: true });
    }
    // 4. Clearance: keepers always may; outfielders under heavy pressure deep in our own half. Aimed at
    // the least contested landing spot (or into touch), never just "up the middle".
    if (p.isGK || (underPressure && ball.pos.x * dir < -L2 * 0.5)) {
      const c = chooseClearance(world, this.team, ball.pos.x, ball.pos.z);
      options.push({
        label: 'clear',
        utility: p.isGK ? 0.05 + noise() : 0.25 + (2 - pressure) * 0.1 + noise(),
        why: ex ? c.why : undefined,
        kick: { kind: 'clear', power: 1, dir: { x: c.x - ball.pos.x, z: c.z - ball.pos.z }, target: { x: c.x, z: c.z }, error: p.isGK ? 0.12 : 0.15 },
      });
    }

    let best: Option | null = null;
    for (const o of options) if (!best || o.utility > best.utility) best = o;
    if (best) {
      TeamBrain.decisionLog?.(best.label, (ball.pos.x * dir) / L2, best.utility, options);
      const info: DecisionInfo = {
        team: this.team,
        playerId: p.id,
        time: world.time,
        label: best.label,
        utility: best.utility,
        progress: (ball.pos.x * dir) / L2,
        pressure,
        kick: best.kick,
        why: best.why,
        options: options
          .map((o) => ({ label: o.label, utility: o.utility, why: o.why }))
          .sort((a, b) => b.utility - a.utility)
          .slice(0, 5),
      };
      this.lastDecision.set(p.id, info);
      TeamBrain.decisionInfo?.(info);
    }
    if (!best) {
      this.steerDribble(p, world, cmd, m);
      return;
    }
    if (best.kick) {
      cmd.kick = best.kick;
      m.patience = 0;
      cmd.move.set(best.kick.dir.x, best.kick.dir.z).normalize().scale(0.3);
    } else if (best.hold) {
      m.holdTimer = 0.9;
      m.patience += 0.5;
      this.steerDribble(p, world, cmd, m);
    } else if (best.dribble) {
      m.holdTimer = 0;
      m.patience = Math.max(0, m.patience - 0.3);
      m.dribble.set(best.dribble.x, best.dribble.z);
      this.steerDribble(p, world, cmd, m);
    }
  }

  private steerDribble(p: Player, world: World, cmd: PlayerCommand, m: Memory): void {
    let mx = m.dribble.x,
      mz = m.dribble.z;
    if (mx === 0 && mz === 0) {
      mx = world.attackDir(this.team);
    }
    // Obstacle avoidance: steer away from defenders ahead.
    let ax = 0,
      az = 0;
    for (const o of world.players) {
      if (o.team === this.team) continue;
      const dx = o.pos.x - p.pos.x,
        dz = o.pos.z - p.pos.z;
      const d = hyp(dx, dz);
      if (d > 4.5 || d < 0.01) continue;
      const ahead = (dx * mx + dz * mz) / d;
      if (ahead < -0.2) continue;
      const w = (4.5 - d) / 4.5;
      // Push perpendicular to the dribble direction, away from the defender's side.
      const px = -mz,
        pz = mx;
      const side = Math.sign(dx * px + dz * pz) || 1;
      ax -= px * side * w * 1.2;
      az -= pz * side * w * 1.2;
      ax -= (dx / d) * w * 0.4;
      az -= (dz / d) * w * 0.4;
    }
    mx += ax;
    mz += az;
    // Stay on the pitch.
    const L2 = world.pitch.length / 2,
      W2 = world.pitch.width / 2;
    if (p.pos.z > W2 - 2.5) mz -= 1;
    if (p.pos.z < -W2 + 2.5) mz += 1;
    if (p.pos.x > L2 - 2) mx -= 1;
    if (p.pos.x < -L2 + 2) mx += 1;
    const l = hyp(mx, mz) || 1;
    // Pace with the ball: hold/shield at walking pace, jog when building up, run into space,
    // and only sprint into open grass in the opponent's half.
    const space = nearestOpponent(world, this.team, p.pos.x + (mx / l) * 4, p.pos.z + (mz / l) * 4).dist;
    const attackingHalf = p.pos.x * world.attackDir(this.team) > 0;
    let pace: number = space > 4.5 ? PACE.run : PACE.jog;
    if (m.holdTimer > 0) {
      m.holdTimer -= 1 / 120;
      // Turn the back to the nearest opponent and protect the ball.
      const near = nearestOpponent(world, this.team, p.pos.x, p.pos.z);
      const o = world.players[near.id];
      if (o && near.dist < 3) {
        // Stand firm with the back to the challenger; the dribble logic keeps the ball on the far side.
        cmd.face?.set(p.pos.x - o.pos.x, p.pos.z - o.pos.z);
        pace = 0;
      } else {
        pace = PACE.walk;
      }
    }
    const l2 = hyp(mx, mz) || 1;
    // Don't run the ball into a defender squared up in front: slow down, or try to beat him.
    if (m.holdTimer <= 0) {
      for (const o of world.players) {
        if (o.team === this.team || o.isGK) continue;
        const ox = o.pos.x - p.pos.x,
          oz = o.pos.z - p.pos.z;
        const od = hyp(ox, oz);
        if (od > 2.6 || od < 0.01) continue;
        const inFront = (ox * mx + oz * mz) / (od * l2);
        if (inFront < 0.7) continue;
        if (p.burst <= 0 && p.evade <= 0 && world.rng.next() < this.profile.runs * 0.6 * (1 / 120)) {
          // Skill move: cut away from the defender's side.
          const side = Math.sign(ox * (-mz / l2) + oz * (mx / l2)) || 1;
          cmd.skill = { x: (mx / l2) * 0.4 - (-mz / l2) * side, z: (mz / l2) * 0.4 - (mx / l2) * side };
        } else {
          pace = Math.min(pace, od < 1.8 ? 0.12 : PACE.walk);
        }
        break;
      }
    }
    cmd.move.set((mx / l2) * pace, (mz / l2) * pace);
    cmd.sprint = m.holdTimer <= 0 && space > 8 && attackingHalf && p.stamina > 0.4;
    void PLAYER;
  }

  // ---------------------------------------------------------------------------
  // Set pieces
  // ---------------------------------------------------------------------------

  private setPiece(p: Player, world: World, ctx: TacticalContext, cmd: PlayerCommand, dt: number): void {
    const r = ctx.restart;
    const ball = world.ball;
    const m = this.memory(p);
    const slot = this.formation.slots[p.index] ?? this.formation.slots[0];
    const dir = world.attackDir(this.team);
    const L2 = world.pitch.length / 2;

    if (ctx.phase === 'kickoff') {
      // Positions are set by the match; take the kick-off if we're the taker.
      if (r && r.takerId === p.id) {
        this.takeRestart(p, world, ctx, cmd, m, dt);
      } else {
        cmd.face?.set(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      }
      return;
    }
    if (!r) return;

    if (r.takerId === p.id) {
      this.takeRestart(p, world, ctx, cmd, m, dt);
      return;
    }
    m.restartTimer = 0;

    const ourRestart = r.team === this.team;
    let home = slotPosition(world, this.team, slot, ourRestart, r.x, r.z);
    if (r.type === 'corner' || (r.type === 'freeKick' && Math.abs(r.x - (ourRestart ? dir : -dir) * L2) < 25)) {
      // Attackers flood the box, defenders mark it.
      const goalX = (ourRestart ? dir : -dir) * L2;
      const inward = ourRestart ? -dir : dir;
      const spread = world.pitch.goalAreaWidth;
      const k = (p.index % 4) / 3 - 0.5;
      if (slot.role !== 'DEF' || !ourRestart) {
        home = { x: goalX + inward * (ourRestart ? 7 + (p.index % 2) * 3 : 4 + (p.index % 3) * 2), z: k * spread * 1.4 };
      }
    }
    if (r.type === 'penalty') {
      const goalX = (ourRestart ? dir : -dir) * L2;
      const inward = ourRestart ? -dir : dir;
      home = { x: goalX + inward * (world.pitch.penaltyAreaDepth + 2), z: (p.index - 2) * 3 };
    }
    // Opponents keep their distance from the ball.
    if (!ourRestart) {
      const minD = r.type === 'throwIn' ? 2.5 : 6;
      const dx = home.x - r.x,
        dz = home.z - r.z;
      const d = hyp(dx, dz);
      if (d < minD) {
        const nx = d > 0.01 ? dx / d : -dir,
          nz = d > 0.01 ? dz / d : 0;
        home = { x: r.x + nx * minD, z: r.z + nz * minD };
      }
    }
    arrive(cmd, p, home.x, home.z, 8, 1.5, ball.pos.x, ball.pos.z);
  }

  private takeRestart(p: Player, world: World, ctx: TacticalContext, cmd: PlayerCommand, m: Memory, dt: number): void {
    const r = ctx.restart!;
    const ball = world.ball;
    const prof = this.profile;
    const dir = world.attackDir(this.team);
    const L2 = world.pitch.length / 2;
    if (m.restartTimer === 0) m.restartDelay = 0.35 + world.rng.next() * 0.4;
    m.restartTimer += dt;
    // Stand next to the ball facing upfield.
    const behind = r.type === 'throwIn' ? 0 : 0.55;
    const fx = r.type === 'throwIn' ? 0 : dir;
    const fz = r.type === 'throwIn' ? -Math.sign(r.z) : 0;
    if (ball.heldBy !== p.id) {
      arrive(cmd, p, ball.pos.x - fx * behind, ball.pos.z - fz * behind, 4, 0.6);
    }
    cmd.face?.set(fx || world.attackDir(this.team) * 0.2, fz);
    if (m.restartTimer < m.restartDelay) return;

    const choosePass = (lofted: boolean, maxDist: number): KickRequest | null => {
      let best: { u: number; k: KickRequest } | null = null;
      for (const t of world.players) {
        if (t.team !== this.team || t.id === p.id) continue;
        if (t.isGK && r.type !== 'goalKick') continue;
        const d = t.pos.distanceTo(p.pos);
        if (d > maxDist || d < 3) continue;
        const ev = evaluatePass(world, p, t, t.pos.x, t.pos.z, prof.reaction, lofted);
        // skip restart passes that will probably be intercepted — but only below what the long-ball
        // fallback achieves (measured ≈25–30%), otherwise the fallback is worse.
        if (ev.success < 0.3) continue;
        const u = ev.success + ev.value * 0.6 + world.rng.gaussian() * prof.decisionNoise;
        if (!best || u > best.u) {
          best = {
            u,
            k: {
              kind: lofted ? 'lob' : 'pass',
              power: 0.5,
              dir: { x: t.pos.x - ball.pos.x, z: t.pos.z - ball.pos.z },
              target: { x: t.pos.x, z: t.pos.z },
              receiver: t.id,
              error: prof.passError,
            },
          };
        }
      }
      return best ? best.k : null;
    };

    let kick: KickRequest | null = null;
    switch (r.type) {
      case 'kickoff': {
        // Nearest teammate, preferably backwards.
        kick = choosePass(false, 20);
        break;
      }
      case 'throwIn': {
        kick = choosePass(false, 16);
        if (kick) kick.kind = 'pass';
        break;
      }
      case 'corner': {
        const goalX = dir * L2;
        const tx = goalX - dir * world.rng.range(5, 9);
        const tz = world.rng.range(-3, 3);
        kick = {
          kind: 'lob',
          power: 0.7,
          dir: { x: tx - ball.pos.x, z: tz - ball.pos.z },
          target: { x: tx, z: tz },
          error: prof.passError,
          curl: -Math.sign(ball.pos.z) * dir * 0.4,
        };
        break;
      }
      case 'goalKick': {
        kick = choosePass(false, 25);
        if (!kick || world.rng.chance(0.4)) {
          const c = chooseClearance(world, this.team, ball.pos.x, ball.pos.z, false);
          kick = { kind: 'clear', power: 1, dir: { x: c.x - ball.pos.x, z: c.z - ball.pos.z }, target: { x: c.x, z: c.z }, error: prof.passError * 2 };
        }
        break;
      }
      case 'freeKick': {
        const shot = evaluateShot(world, this.team, ball.pos.x, ball.pos.z, p.id);
        if (shot.distance < 25 && shot.quality > 0.15) {
          const goalX = dir * L2;
          kick = {
            kind: 'shot',
            power: 0.8,
            dir: { x: goalX - ball.pos.x, z: shot.aimZ - ball.pos.z },
            height: 1.6,
            curl: Math.sign(shot.aimZ) * dir * 0.8,
            error: prof.shotError,
          };
        } else {
          kick = choosePass(false, 25) ?? choosePass(true, 35);
        }
        break;
      }
      case 'penalty': {
        const goalX = dir * L2;
        const side = world.rng.chance(0.5) ? 1 : -1;
        const z = world.rng.chance(0.15) ? 0 : side * (world.pitch.goalWidth / 2 - world.rng.range(0.4, 0.9));
        kick = {
          kind: 'shot',
          power: world.rng.range(0.6, 0.85),
          dir: { x: goalX - ball.pos.x, z: z - ball.pos.z },
          height: world.rng.range(0.2, 1.6),
          error: prof.shotError * 0.8,
        };
        break;
      }
    }
    if (!kick) {
      // No safe pass: a long ball to the least contested area (this used to be lofted blindly upfield and
      // went straight out of play two times in three).
      const c = chooseClearance(world, this.team, ball.pos.x, ball.pos.z, false);
      kick = { kind: 'lob', power: 0.6, dir: { x: c.x - ball.pos.x, z: c.z - ball.pos.z }, target: { x: c.x, z: c.z }, error: 0.1 };
    }
    cmd.kick = kick;
    m.restartTimer = 0;
  }
}
