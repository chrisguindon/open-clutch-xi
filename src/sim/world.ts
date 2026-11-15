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
 * The physical world of a match: 22 (or 6, or 10) bodies and a ball, advanced in fixed 1/120 s steps.
 *
 * `World.step()` runs in a fixed order, and the order matters:
 *  1. actions start (kicks, tackles, skills, dives) from each player's command;
 *  2. players move, then are separated and kept on the pitch;
 *  3. kicks make contact (with the timing the animation shows);
 *  4. control and dribbling: who has the ball, first touches, dribble touches;
 *  5. the ball flies (src/sim/ball.ts), then keepers save, tackles resolve, and bodies deflect it.
 * Moving players before the ball means a touch is decided from where the player actually is this
 * step, not where they were last step.
 *
 * Everything football-legal (out of play, fouls, offside) is decided by Match, which listens to the
 * events emitted here. Every contact with the ball goes through one place (`markTouch`, emitting
 * `ballTouch`), so the rules can't miss a touch.
 */

import { BALL, GK, KICK_TIMING, PLAYER, PitchConfig, TeamId } from './config';
import { Ball, BallContact, groundPassSpeed, passEndSpeed, predictBall } from './ball';
import { Anim, KickRequest, Player, PlayerCommand } from './player';
import { Emitter } from '../core/events';
import { Rng } from '../core/rng';
import { Vec3, clamp, lerp, pointSegmentDistXZ, hyp } from '../core/math';

/** Physical events the world emits each step. Match turns them into decisions, audio and UI. */
export interface WorldEvents {
  kick: { playerId: number; kind: KickRequest['kind']; power: number; speed: number; onTarget: boolean };
  touch: { playerId: number; soft: boolean };
  control: { playerId: number; previousTeam: TeamId | null };
  bounce: { strength: number };
  post: { strength: number };
  net: { strength: number; side: 1 | -1; x: number; y: number; z: number };
  deflect: { playerId: number; speed: number };
  tackle: { tacklerId: number; victimId: number | null; won: boolean; slide: boolean };
  /** A foul, with the physical facts of the challenge (the match's rules engine judges severity). */
  foul: { offenderId: number; victimId: number; x: number; z: number; slide: boolean; fromBehind: number; tacklerSpeed: number };
  /** Any contact with the ball by a player (dribble touches, kicks, tackles, saves). Used by offside and second-touch rules. */
  ballTouch: { playerId: number };
  save: { keeperId: number; caught: boolean; speed: number };
  skill: { playerId: number };
}

/** The most recent kick, kept for the rules (who played the ball, from where) and the AI. */
export interface LastKick {
  playerId: number;
  team: TeamId;
  kind: KickRequest['kind'];
  time: number;
  receiver: number | null;
  fromX: number;
  fromZ: number;
  onTarget: boolean;
}

const predBuf = new Float32Array(3 * 200);

/** Players, ball and their physical interactions for one match. See the module comment for the step order. */
export class World {
  readonly ball: Ball;
  readonly players: Player[] = [];
  readonly events = new Emitter<WorldEvents>();
  time = 0;

  /** Player currently in close control of the ball (or holding it). */
  controllerId: number | null = null;
  lastTouchId: number | null = null;
  lastTouchTeam: TeamId | null = null;
  /** Team considered in possession (persists through passes). */
  possessionTeam: TeamId | null = null;
  lastKick: LastKick | null = null;
  /** When set, only this player may touch the ball (set pieces). */
  restrictTouchTo: number | null = null;
  /** How a held ball is carried. */
  holdStyle: 'gk' | 'throw' = 'gk';
  /** Seconds the ball has been held by a goalkeeper. */
  holdTime = 0;
  /** Overrides attacking directions (penalty shootouts use a single goal). */
  dirOverride: [1 | -1, 1 | -1] | null = null;
  /** The carrier's intended movement this step (before steering assists). */
  private carrierIntent = {
    x: 0,
    z: 0,
    set(x: number, z: number) {
      this.x = x;
      this.z = z;
    },
  };
  private contacts: BallContact[] = [];

  constructor(
    public pitch: PitchConfig,
    readonly rng: Rng,
  ) {
    this.ball = new Ball(pitch);
  }

  get controller(): Player | null {
    return this.controllerId === null ? null : this.players[this.controllerId];
  }

  /** Players of a team who are on the pitch (sent-off players excluded). */
  teamPlayers(team: TeamId): Player[] {
    return this.players.filter((p) => p.team === team && !p.sentOff);
  }

  /** Direction team attacks along x (+1 or -1). */
  attackDir(team: TeamId): 1 | -1 {
    if (this.dirOverride) return this.dirOverride[team];
    return team === 0 ? 1 : -1;
  }

  inPenaltyArea(x: number, z: number, defendingTeam: TeamId): boolean {
    const p = this.pitch;
    const goalX = (-this.attackDir(defendingTeam) * p.length) / 2;
    return Math.abs(x - goalX) <= p.penaltyAreaDepth && Math.abs(z) <= p.penaltyAreaWidth / 2 && Math.sign(x) === Math.sign(goalX);
  }

  clearPossession(): void {
    this.controllerId = null;
    this.lastKick = null;
  }

  // ---------------------------------------------------------------------------
  // Main step
  // ---------------------------------------------------------------------------

  step(dt: number, commands: PlayerCommand[]): void {
    this.time += dt;
    const ball = this.ball;

    for (const p of this.players) this.startActions(p, commands[p.id], dt);
    // Remember what the carrier actually wants before any steering assist adjusts the movement.
    const c0 = this.controller;
    if (c0) this.carrierIntent.set(commands[c0.id].move.x, commands[c0.id].move.z);
    this.assistCarrier(commands);
    for (const p of this.players) p.move(commands[p.id], dt, this.controllerId === p.id);
    this.resolvePlayerCollisions();
    this.keepPlayersInBounds();

    for (const p of this.players) this.processKick(p);

    this.updateControl(dt, commands);
    this.contacts.length = 0;
    ball.step(dt, this.contacts);
    for (const c of this.contacts) {
      if (c.type === 'bounce') this.events.emit('bounce', { strength: c.strength });
      else if (c.type === 'post') this.events.emit('post', { strength: c.strength });
      else this.events.emit('net', { strength: c.strength, side: c.goalSide, x: c.x, y: c.y, z: c.z });
    }
    this.keeperSaves();
    this.resolveTackles();
    this.ballBodyCollisions();

    if (ball.heldBy !== null) {
      const h = this.players[ball.heldBy];
      this.holdTime += dt;
      if (this.holdStyle === 'gk') {
        ball.pos.set(h.footX(0.32), 1.05 + h.y, h.footZ(0.32));
      } else {
        ball.pos.set(h.footX(0.05), 2.15, h.footZ(0.05));
      }
    } else {
      this.holdTime = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private startActions(p: Player, cmd: PlayerCommand, dt: number): void {
    if (p.pendingKick) {
      p.pendingKickTtl -= dt;
      if (p.pendingKickTtl <= 0) p.pendingKick = null;
    }
    const ball = this.ball;

    // Holding the ball (goalkeeper or throw-in): kicks release it immediately.
    if (ball.heldBy === p.id) {
      if (cmd.kick) this.releaseHeld(p, cmd.kick);
      return;
    }
    if (p.locked) return;

    if (cmd.dive && p.isGK) {
      p.setAnim(Anim.Dive, 1.15);
      const dz = Math.sign(cmd.dive.z) || 1;
      p.diveDir = dz;
      p.diveHeight = cmd.dive.height;
      // (The penalty boost mostly extends reach; a much faster dive just flies past the ball.)
      const lateral = clamp(Math.abs(cmd.dive.z), 0.3, 1) * GK.diveSpeed * Math.min(1.1, p.diveBoost);
      // Push-off: the body accelerates sideways over the wind-up (see Player.move).
      p.diveSpeed = dz * lateral;
      p.vel.set(p.vel.x * 0.3, p.vel.z * 0.5 + dz * lateral * 0.15);
      p.vy = 1.0 + cmd.dive.height * 3.6;
      p.y = 0.01;
      return;
    }

    if (cmd.tackle && this.controllerId !== p.id) {
      p.tackleHit = false;
      const fx = Math.cos(p.facing),
        fz = Math.sin(p.facing);
      if (cmd.tackle === 'slide') {
        p.setAnim(Anim.Slide, 1.0);
        const sp = Math.max(p.speed + 1.2, 7.4);
        p.vel.set(fx * sp, fz * sp);
      } else {
        p.setAnim(Anim.Tackle, 0.42);
        p.vel.x += fx * 2.2;
        p.vel.z += fz * 2.2;
      }
      return;
    }

    if (cmd.skill && this.controllerId === p.id) {
      this.performSkill(p, cmd.skill);
      return;
    }

    if (cmd.kick) {
      p.pendingKick = cmd.kick;
      p.pendingKickTtl = 0.45;
    }
    if (p.pendingKick && !p.activeKick && p.noControl <= 0 && this.canTouch(p)) {
      const d = hyp(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      const k = p.pendingKick;
      const low = ball.pos.y < 0.95;
      const headHeight = ball.pos.y > 1.2 && ball.pos.y < 2.6;
      if (d < PLAYER.reach + 0.35 && (low || headHeight)) {
        if (headHeight && !low) {
          k.kind = 'header';
          p.setAnim(Anim.Header, 0.5);
          p.kickContactAt = 0.06;
          if (ball.pos.y > 1.9) p.vy = 3.2;
        } else {
          const isShot = k.kind === 'shot' || k.kind === 'chip' || k.kind === 'clear';
          const isLob = k.kind === 'lob';
          p.setAnim(isShot || isLob ? Anim.Kick : Anim.Pass, isShot ? KICK_TIMING.shotTotal : KICK_TIMING.passTotal);
          p.kickContactAt = isShot ? KICK_TIMING.shotContact : isLob ? KICK_TIMING.lobContact : KICK_TIMING.passContact;
        }
        // Kicking foot: the side the ball is on relative to the kick direction, else the stronger foot.
        const kl = hyp(k.dir.x, k.dir.z) || 1;
        const lat = (ball.pos.x - p.pos.x) * (k.dir.z / kl) - (ball.pos.z - p.pos.z) * (k.dir.x / kl);
        p.kickFoot = Math.abs(lat) > 0.15 ? (lat > 0 ? 1 : -1) : p.id % 5 === 0 ? 1 : -1;
        p.activeKick = k;
        p.pendingKick = null;
        p.kickDone = false;
      }
    }
  }

  /**
   * Restart taker who may not touch the ball again until another player has (Laws 13, 15–17, 8). AI takers
   * simply don't; a human who does commits an offence, which the match penalises.
   */
  secondTouchBan: number | null = null;

  private canTouch(p: Player): boolean {
    if (p.sentOff) return false;
    if (this.secondTouchBan === p.id && !p.humanControlled) return false;
    return this.restrictTouchTo === null || this.restrictTouchTo === p.id;
  }

  private performSkill(p: Player, dir: { x: number; z: number }): void {
    const ball = this.ball;
    const fx = Math.cos(p.facing),
      fz = Math.sin(p.facing);
    p.setAnim(Anim.Skill, 0.3);
    p.burst = 0.75;
    p.evade = 0.5;
    let dx = dir.x,
      dz = dir.z;
    const mag = hyp(dx, dz);
    if (mag < 0.2) {
      // Step-over: no ball movement; fools nearby defenders.
      dx = 0;
      dz = 0;
    } else {
      dx /= mag;
      dz /= mag;
    }
    const forwardDot = dx * fx + dz * fz;
    if (mag >= 0.2) {
      if (forwardDot < -0.5) {
        // Drag-back: pull the ball back and turn.
        ball.vel.set(-fx * 3.2, 0, -fz * 3.2);
        p.facing += Math.PI;
        p.vel.scale(0.2);
      } else {
        // Feint & cut: push ball sideways/forwards and burst after it.
        // A sharp, short push into space; the burst lets the player get onto it first.
        const sp = 3.4 + p.speed * 0.45;
        ball.vel.set(dx * sp, 0, dz * sp);
        p.vel.set(dx * Math.max(p.speed, 3.2), dz * Math.max(p.speed, 3.2));
      }
    }
    // Defenders close by in front of the player may be wrong-footed.
    for (const o of this.players) {
      if (o.team === p.team || o.isGK) continue;
      const ox = o.pos.x - p.pos.x,
        oz = o.pos.z - p.pos.z;
      const d = hyp(ox, oz);
      if (d < 3.2 && this.rng.chance(0.7 - d * 0.12)) o.fooled = 0.45;
    }
    this.markTouch(p);
    this.events.emit('skill', { playerId: p.id });
  }

  private releaseHeld(p: Player, req: KickRequest): void {
    const ball = this.ball;
    ball.heldBy = null;
    const style = this.holdStyle;
    p.setAnim(style === 'gk' && (req.kind === 'clear' || req.kind === 'lob') ? Anim.Kick : Anim.Throw, 0.45);
    if (style === 'throw') ball.pos.y = 2.1;
    this.applyKick(p, req, style === 'gk' && req.kind === 'pass');
    p.noControl = 0.4;
  }

  private processKick(p: Player): void {
    if (!p.activeKick || p.kickDone) return;
    if (p.animTime < p.kickContactAt) return;
    p.kickDone = true;
    const k = p.activeKick;
    const ball = this.ball;
    const d = hyp(ball.pos.x - p.footX(0.3), ball.pos.z - p.footZ(0.3));
    const heightOk = k.kind === 'header' ? ball.pos.y > 1.0 && ball.pos.y < 2.9 + p.y : ball.pos.y < 1.1;
    if (d < PLAYER.reach && heightOk && ball.heldBy === null && this.canTouch(p)) {
      this.applyKick(p, k, false);
    }
    p.activeKick = null;
  }

  /** Compute and apply the ball velocity for a kick. */
  applyKick(p: Player, k: KickRequest, throwRoll: boolean): void {
    const ball = this.ball;
    const rng = this.rng;
    let dirX = k.dir.x,
      dirZ = k.dir.z;
    const dl = hyp(dirX, dirZ) || 1;
    dirX /= dl;
    dirZ /= dl;

    // Execution error: base error, plus awkward body angle, sprinting, pressure from the power.
    const facingDot = Math.cos(p.facing) * dirX + Math.sin(p.facing) * dirZ;
    let err = (k.error ?? 0.02) * (1 + (1 - facingDot) * 0.6 + (p.speed > PLAYER.runSpeed ? 0.35 : 0));
    if (k.kind === 'shot') err *= 0.7 + k.power * 0.6;
    const angle = Math.atan2(dirZ, dirX) + rng.gaussian() * err;
    dirX = Math.cos(angle);
    dirZ = Math.sin(angle);

    const pitchLen = this.pitch.length;
    let vx = 0,
      vy = 0,
      vz = 0;
    let spinY = 0;
    let topspin = 0;
    const tdist = k.target ? hyp(k.target.x - ball.pos.x, k.target.z - ball.pos.z) : 0;

    switch (k.kind) {
      case 'shot': {
        const speed = lerp(14, 31.5, k.power);
        const goalX = (this.attackDir(p.team) * pitchLen) / 2;
        const D = Math.max(2, Math.abs(goalX - ball.pos.x) / Math.max(0.2, Math.abs(dirX)));
        let h = k.height ?? lerp(0.25, 1.6, k.power);
        if (k.power > 0.9) h += Math.abs(rng.gaussian()) * (k.power - 0.9) * 9; // over-hit risk
        h += rng.gaussian() * err * D * 0.35;
        h = Math.max(BALL.radius, h);
        const vh = speed * 0.98;
        const t = D / (vh * (1 - BALL.airDrag * vh * 0.3 * Math.min(1, D / 30)));
        vy = (h - ball.pos.y + 0.5 * BALL.gravity * t * t) / t;
        vy = clamp(vy, 0, 12);
        // Curl: aim slightly away from the target so the ball bends back.
        const curl = k.curl ?? 0;
        if (Math.abs(curl) > 0.01) {
          const off = curl * 0.09 * clamp(D / 20, 0.4, 1.4);
          const a2 = Math.atan2(dirZ, dirX) + off;
          dirX = Math.cos(a2);
          dirZ = Math.sin(a2);
          spinY = curl * 34;
        }
        vx = dirX * vh;
        vz = dirZ * vh;
        topspin = k.power > 0.75 ? 8 : 0;
        break;
      }
      case 'chip': {
        const D = Math.max(6, tdist || 14);
        const theta = 0.95;
        const v = Math.sqrt((BALL.gravity * D) / Math.sin(2 * theta)) * (1 + 0.006 * D);
        vx = dirX * v * Math.cos(theta);
        vz = dirZ * v * Math.cos(theta);
        vy = v * Math.sin(theta);
        topspin = -10;
        break;
      }
      case 'pass':
      case 'through': {
        if (throwRoll) {
          const v = clamp(groundPassSpeed(Math.max(3, tdist), 3.5), 6, 18);
          vx = dirX * v;
          vz = dirZ * v;
          vy = 1.5;
          break;
        }
        const D = tdist || lerp(8, 26, k.power);
        const end = k.kind === 'through' ? Math.max(3.5, D * 0.1) : passEndSpeed(D, k.power);
        let v = groundPassSpeed(D, end);
        v = clamp(v, 5.5, 27);
        vx = dirX * v;
        vz = dirZ * v;
        vy = this.holdStyle === 'throw' && ball.pos.y > 1.5 ? 2.5 : v > 20 ? 1.2 : 0.2;
        break;
      }
      case 'lob':
      case 'clear': {
        const D = clamp(tdist || (k.kind === 'clear' ? pitchLen * 0.45 : 22), 6, 70);
        const theta = k.kind === 'clear' ? 0.6 : D > 28 ? 0.55 : 0.68;
        const v = Math.sqrt((BALL.gravity * D) / Math.sin(2 * theta)) * (1 + 0.0075 * D);
        const hv = v * Math.cos(theta);
        vx = dirX * hv;
        vz = dirZ * hv;
        vy = v * Math.sin(theta);
        topspin = -6;
        if (k.curl) spinY = k.curl * 18;
        break;
      }
      case 'header': {
        const speed = lerp(8, 17, k.power);
        vx = dirX * speed;
        vz = dirZ * speed;
        const goalDist = Math.abs((this.attackDir(p.team) * pitchLen) / 2 - ball.pos.x);
        const t = goalDist / speed;
        const targetH = k.height ?? 0.8;
        vy = clamp((targetH - ball.pos.y + 0.5 * BALL.gravity * t * t) / Math.max(0.1, t), -6, 5);
        break;
      }
      case 'touch': {
        const v = 4;
        vx = dirX * v;
        vz = dirZ * v;
        break;
      }
    }

    ball.vel.set(vx, vy, vz);
    // Spin: sidespin about y; topspin about the horizontal axis perpendicular to travel.
    const hs = hyp(vx, vz) || 1;
    ball.spin.set((vz / hs) * topspin, spinY, (-vx / hs) * topspin);
    if (ball.pos.y < BALL.radius + 0.02) ball.pos.y = BALL.radius + 0.005;
    ball.grounded = vy <= 0.05;

    p.noControl = 0.22;
    this.controllerId = null;
    this.markTouch(p);
    const onTarget = k.kind === 'shot' || k.kind === 'header' || k.kind === 'chip' ? this.predictOnTarget(p.team) : false;
    this.lastKick = {
      playerId: p.id,
      team: p.team,
      kind: k.kind,
      time: this.time,
      receiver: k.receiver ?? null,
      fromX: ball.pos.x,
      fromZ: ball.pos.z,
      onTarget,
    };
    this.possessionTeam = p.team;
    this.events.emit('kick', { playerId: p.id, kind: k.kind, power: k.power, speed: ball.speed, onTarget });
  }

  /** Predict whether the current ball trajectory will end up in the goal attacked by `team`. */
  predictOnTarget(team: TeamId): boolean {
    const ball = this.ball;
    const goalX = (this.attackDir(team) * this.pitch.length) / 2;
    predictBall(ball.pos, ball.vel, ball.spin, 150, 1 / 50, predBuf);
    let px = ball.pos.x;
    for (let i = 0; i < 150; i++) {
      const x = predBuf[i * 3],
        y = predBuf[i * 3 + 1],
        z = predBuf[i * 3 + 2];
      if ((px - goalX) * (x - goalX) <= 0) {
        return Math.abs(z) < this.pitch.goalWidth / 2 + 0.05 && y < this.pitch.goalHeight + 0.05;
      }
      px = x;
    }
    return false;
  }

  private markTouch(p: Player): void {
    this.lastTouchId = p.id;
    this.lastTouchTeam = p.team;
    this.events.emit('ballTouch', { playerId: p.id });
  }

  // ---------------------------------------------------------------------------
  // Ball control & dribbling
  // ---------------------------------------------------------------------------

  /** How far the ball has left the carrier's feet: 0 = at the feet, 1 = fully exposed. */
  exposure(c: Player): number {
    const ball = this.ball;
    const d = hyp(ball.pos.x - c.footX(0.4), ball.pos.z - c.footZ(0.4));
    let e = clamp((d - 0.3) / 0.75, 0, 1);
    // A ball rolling away from the carrier is more exposed.
    const bx = ball.pos.x - c.pos.x,
      bz = ball.pos.z - c.pos.z;
    const bl = hyp(bx, bz) || 1;
    const away = ((ball.vel.x - c.vel.x) * bx + (ball.vel.z - c.vel.z) * bz) / bl;
    if (away > 1.2) e = Math.min(1, e + 0.2);
    return e;
  }

  /** True when the carrier's body is between the challenger and the ball. */
  isShielded(c: Player, o: Player): boolean {
    const ball = this.ball;
    const s = pointSegmentDistXZ(c.pos.x, c.pos.z, o.pos.x, o.pos.z, ball.pos.x, ball.pos.z);
    return s.dist < PLAYER.radius + 0.12 && s.t > 0.15 && s.t < 0.97;
  }

  private nearestTmp: { o: Player | null; d: number } = { o: null, d: Infinity };
  /** Nearest opponent (returns a shared scratch object — read it immediately). */
  private nearestOpponent(p: Player): { o: Player | null; d: number } {
    let best: Player | null = null,
      bd = Infinity;
    for (const o of this.players) {
      if (o.team === p.team) continue;
      const d = hyp(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    this.nearestTmp.o = best;
    this.nearestTmp.d = bd;
    return this.nearestTmp;
  }

  private updateControl(dt: number, commands: PlayerCommand[]): void {
    const ball = this.ball;
    if (ball.heldBy !== null) {
      this.controllerId = ball.heldBy;
      return;
    }
    const low = ball.pos.y < 0.8;

    // Keep control while the ball stays on a leash around the carrier (between touches it rolls freely).
    let ctrl = this.controller;
    if (ctrl) {
      const d = hyp(ball.pos.x - ctrl.pos.x, ball.pos.z - ctrl.pos.z);
      const leash = ctrl.lastSprint ? 3.6 : ctrl.burst > 0 ? 3.0 : 2.2;
      const rel = hyp(ball.vel.x - ctrl.vel.x, ball.vel.z - ctrl.vel.z);
      if (!low || d > leash || rel > 9 || ctrl.noControl > 0 || (ctrl.locked && !ctrl.activeKick && ctrl.anim !== Anim.Skill && ctrl.anim !== Anim.Tackle)) {
        this.controllerId = null;
        ctrl = null;
      }
    }

    // Steals: an opponent can only take the ball when it has left the carrier's feet and isn't shielded.
    if (ctrl && ctrl.evade <= 0) {
      const e = this.exposure(ctrl);
      if (e > 0.45) {
        const cd = hyp(ball.pos.x - ctrl.footX(0.35), ball.pos.z - ctrl.footZ(0.35));
        for (const o of this.players) {
          if (o.team === ctrl.team || o.noControl > 0 || o.locked || o.fooled > 0 || !this.canTouch(o)) continue;
          const od = hyp(ball.pos.x - o.footX(0.3), ball.pos.z - o.footZ(0.3));
          if (od > PLAYER.controlRadius || od > cd - 0.25 || this.isShielded(ctrl, o)) continue;
          // The challenger must be facing the ball to nick it.
          const ox = ball.pos.x - o.pos.x,
            oz = ball.pos.z - o.pos.z;
          const ol = hyp(ox, oz) || 1;
          if ((Math.cos(o.facing) * ox + Math.sin(o.facing) * oz) / ol < 0.3) continue;
          ctrl.noControl = 0.3;
          this.controllerId = null;
          this.events.emit('tackle', { tacklerId: o.id, victimId: ctrl.id, won: true, slide: false });
          this.takeControl(o, commands[o.id]);
          ctrl = this.controller;
          break;
        }
      }
    }

    // Acquire control: closest eligible player within reach.
    if (!ctrl && low) {
      let best: Player | null = null;
      let bestD = Infinity;
      for (const p of this.players) {
        if (p.noControl > 0 || !this.canTouch(p)) continue;
        if (p.locked && p.anim !== Anim.Skill) continue;
        const d = hyp(ball.pos.x - p.footX(0.25), ball.pos.z - p.footZ(0.25));
        const intended = this.lastKick?.receiver === p.id && this.lastKick.team === p.team;
        if (d > PLAYER.controlRadius + (intended ? 0.25 : 0)) continue;
        const rel = hyp(ball.vel.x - p.vel.x, ball.vel.z - p.vel.z);
        // Very fast balls are deflected rather than trapped (handled by body collisions),
        // unless the player is a goalkeeper who can use their hands.
        if (rel > 19 && !p.isGK) continue;
        // Cutting out a moving pass meant for someone else is a skill, not automatic:
        // the faster the ball, the harder it is to read and trap. One attempt per pass.
        const lk = this.lastKick;
        if (!intended && lk && !p.isGK && rel > 7 && this.time - lk.time < 2.5 && lk.playerId !== p.id) {
          if (p.interceptRoll === lk.time) continue;
          const chance = clamp(1.3 - rel / 12, 0.2, 0.92);
          if (this.rng.next() > chance) {
            p.interceptRoll = lk.time;
            // Sometimes it clips the foot on the way past.
            if (this.rng.chance(0.3)) {
              const a = this.rng.gaussian() * 0.35;
              const vx = ball.vel.x * Math.cos(a) - ball.vel.z * Math.sin(a);
              const vz = ball.vel.x * Math.sin(a) + ball.vel.z * Math.cos(a);
              ball.vel.x = vx * 0.7;
              ball.vel.z = vz * 0.7;
              this.markTouch(p);
              this.events.emit('deflect', { playerId: p.id, speed: rel });
            }
            continue;
          }
        }
        const score = d - (p.humanControlled ? 0.1 : 0);
        if (score < bestD) {
          bestD = score;
          best = p;
        }
      }
      if (best) {
        if (this.takeControl(best, commands[best.id])) return;
        ctrl = this.controller;
      }
    }

    if (!ctrl) return;
    this.dribble(ctrl, commands[ctrl.id], dt);
  }

  /**
   * A player wins the ball: keepers gather it in their area, outfield players take a directional
   * first touch whose quality depends on the incoming speed, height and pressure.
   * Returns true if the ball was caught in the hands.
   */
  private takeControl(best: Player, cmd: PlayerCommand | undefined): boolean {
    const ball = this.ball;
    const prevTeam = this.possessionTeam;
    if (best.isGK && this.inPenaltyArea(best.pos.x, best.pos.z, best.team) && this.lastTouchTeam !== best.team && this.restrictTouchTo === null) {
      ball.heldBy = best.id;
      this.holdStyle = 'gk';
      ball.vel.set(0, 0, 0);
      ball.spin.set(0, 0, 0);
      this.controllerId = best.id;
      this.possessionTeam = best.team;
      best.setAnim(Anim.Hold, 0.4);
      this.markTouch(best);
      this.events.emit('control', { playerId: best.id, previousTeam: prevTeam });
      return true;
    }
    this.controllerId = best.id;
    const rvx = ball.vel.x - best.vel.x,
      rvz = ball.vel.z - best.vel.z;
    const rel = hyp(rvx, rvz);
    const pressure = this.nearestOpponent(best).d;
    // Direction of the touch: where the player wants to go, else where they face.
    const ml = cmd ? hyp(cmd.move.x, cmd.move.z) : 0;
    let dx = ml > 0.2 ? cmd!.move.x / ml : Math.cos(best.facing);
    let dz = ml > 0.2 ? cmd!.move.z / ml : Math.sin(best.facing);
    const sigma = 0.03 + Math.max(0, rel - 9) * 0.022 + (pressure < 1.5 ? 0.06 : 0) + (ball.pos.y > 0.35 ? 0.08 : 0);
    const a = Math.atan2(dz, dx) + this.rng.gaussian() * sigma;
    dx = Math.cos(a);
    dz = Math.sin(a);
    const moving = ml > 0.2 ? best.speed : 0;
    // Settle the ball within playing distance rather than matching a full-speed chase.
    let touchSpeed = moving > 0.5 ? clamp(moving * 0.85 + 0.4, 1.0, 5.5) : 0.35;
    touchSpeed *= 1 + this.rng.gaussian() * sigma;
    ball.vel.set(dx * touchSpeed, 0, dz * touchSpeed);
    // Heavy touch: very fast balls aren't fully killed.
    if (rel > 14) {
      const keep = Math.min(0.35, (rel - 14) * 0.04);
      ball.vel.x += rvx * keep;
      ball.vel.z += rvz * keep;
    }
    ball.spin.set(0, 0, 0);
    best.touchTime = this.time;
    best.touchFoot = Math.sin(best.gaitPhase) >= 0 ? 1 : -1;
    best.touchCooldown = 0.18;
    this.markTouch(best);
    this.possessionTeam = best.team;
    this.events.emit('control', { playerId: best.id, previousTeam: prevTeam });
    this.events.emit('touch', { playerId: best.id, soft: rel < 9 });
    return false;
  }

  /**
   * Touch-based dribbling: the ball rolls freely between touches; a touch is taken with the foot
   * that's coming forward when the ball needs redirecting, the player is catching up with it,
   * or the player wants to stop/shield. Sprinting takes longer, riskier touches.
   */
  private dribble(p: Player, cmd: PlayerCommand, dt: number): void {
    const ball = this.ball;
    if (p.anim === Anim.Skill) return; // the skill already set the ball moving
    if (p.activeKick) {
      this.approachKick(p, dt);
      return;
    }
    if (ball.pos.y > 0.45) return;

    void cmd;
    const it = this.carrierIntent;
    const ml = hyp(it.x, it.z);
    const dirX = ml > 0.15 ? it.x / ml : Math.cos(p.facing);
    const dirZ = ml > 0.15 ? it.z / ml : Math.sin(p.facing);
    const footD = Math.min(hyp(ball.pos.x - p.footX(0.35), ball.pos.z - p.footZ(0.35)), hyp(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z) + 0.05);
    // Human drag-back: a sharp reversal of the stick with the ball in reach rolls it back the new way
    // (instead of the player chasing a ball that keeps running away from them).
    const bvx = ball.vel.x,
      bvz = ball.vel.z,
      bsp0 = hyp(bvx, bvz);
    const reversing = p.humanControlled && ml > 0.3 && bsp0 > 0.8 && (bvx * dirX + bvz * dirZ) / bsp0 < -0.25;
    if (p.touchCooldown > 0 || footD > (reversing ? PLAYER.reach : 0.72)) return;
    if (reversing) {
      ball.vel.set(dirX * 1.7 + p.vel.x * 0.15, 0, dirZ * 1.7 + p.vel.z * 0.15);
      ball.spin.set(0, 0, 0);
      p.touchCooldown = 0.18;
      p.touchTime = this.time;
      p.touchFoot = Math.sin(p.gaitPhase) >= 0 ? 1 : -1;
      this.markTouch(p);
      this.events.emit('touch', { playerId: p.id, soft: true });
      return;
    }

    const sprinting = p.lastSprint && p.speed > PLAYER.runSpeed * 0.85;
    const bx = ball.pos.x - p.pos.x,
      bz = ball.pos.z - p.pos.z;
    const ahead = bx * dirX + bz * dirZ;
    const relAlong = (ball.vel.x - p.vel.x) * dirX + (ball.vel.z - p.vel.z) * dirZ;
    const ballSp = hyp(ball.vel.x, ball.vel.z);
    const opp = this.nearestOpponent(p);
    // Under pressure, keep the ball much closer (shorter, more frequent touches).
    const tight = opp.d < 3.5;
    const lead = tight ? 0.4 + p.speed * 0.05 : 0.55 + p.speed * 0.12;
    const shield = ml < 0.25 && opp.o !== null && opp.d < 2.2;
    const stopping = ml < 0.2 && ballSp > 0.45;
    const misaligned = ballSp > 0.8 && (ball.vel.x * dirX + ball.vel.z * dirZ) / ballSp < 0.82;
    const catching = ahead < lead * 0.6 && relAlong < 0.7;
    const footForward = tight || Math.abs(Math.sin(p.gaitPhase)) > 0.5;
    const urgent = ahead < 0.2 || misaligned;
    if (!(shield || stopping || urgent || (catching && footForward))) return;

    let vx: number, vz: number;
    if (shield) {
      // Keep the ball on the far side of the body from the challenger.
      const o = opp.o!;
      const ax = p.pos.x - o.pos.x,
        az = p.pos.z - o.pos.z;
      const al = hyp(ax, az) || 1;
      const tx = p.pos.x + (ax / al) * 0.45,
        tz = p.pos.z + (az / al) * 0.45;
      vx = (tx - ball.pos.x) * 2.5 + p.vel.x * 0.6;
      vz = (tz - ball.pos.z) * 2.5 + p.vel.z * 0.6;
    } else if (stopping) {
      vx = p.vel.x * 0.7;
      vz = p.vel.z * 0.7;
    } else {
      const turnSharp = misaligned && p.speed > 3;
      const sigma = (sprinting ? 0.06 : 0.022) + (turnSharp ? 0.04 : 0) + (opp.d < 1.5 ? 0.03 : 0);
      const a = Math.atan2(dirZ, dirX) + this.rng.gaussian() * sigma;
      // Touch weight follows the player's current pace (plus a little if they're accelerating),
      // so the ball stays within playing distance; sprinting knocks it further.
      const desired = ml * (p.lastSprint ? PLAYER.sprintSpeed : PLAYER.runSpeed);
      const base = p.speed + Math.max(0, desired - p.speed) * 0.25;
      const sp = sprinting ? base * 1.4 + 1.0 : tight ? Math.max(base * 1.02 + 0.25, 0.7) : Math.max(base * 1.12 + 0.35, 0.9);
      vx = Math.cos(a) * sp;
      vz = Math.sin(a) * sp;
    }
    ball.vel.set(vx, 0, vz);
    ball.spin.set(0, 0, 0);
    p.touchCooldown = sprinting ? 0.36 : shield ? 0.3 : 0.2;
    p.touchTime = this.time;
    p.touchFoot = Math.sin(p.gaitPhase) >= 0 ? 1 : -1;
    this.markTouch(p);
    this.events.emit('touch', { playerId: p.id, soft: !sprinting });
  }

  /** During a kick wind-up the kicker adjusts their last step so the kicking foot meets the ball. */
  private approachKick(p: Player, dt: number): void {
    const k = p.activeKick!;
    const ball = this.ball;
    const dl = hyp(k.dir.x, k.dir.z) || 1;
    const dx = k.dir.x / dl,
      dz = k.dir.z / dl;
    // The kicking foot is beside the body, so the body lines up slightly to the other side of the ball.
    // Right of a direction (dx, dz) is (−dz, dx); kickFoot −1 = right foot.
    const footSide = p.kickFoot === -1 ? 1 : -1;
    const rx = -dz * footSide,
      rz = dx * footSide;
    const tx = ball.pos.x - dx * 0.42 - rx * 0.14,
      tz = ball.pos.z - dz * 0.42 - rz * 0.14;
    const ex = tx - p.pos.x,
      ez = tz - p.pos.z;
    const e = hyp(ex, ez);
    const maxStep = 4.5 * dt;
    if (e > 1e-4) {
      const s = Math.min(1, maxStep / e);
      p.pos.x += ex * s;
      p.pos.z += ez * s;
    }
    // The ball slows as the planted foot approaches.
    ball.vel.x *= 1 - Math.min(1, 3 * dt);
    ball.vel.z *= 1 - Math.min(1, 3 * dt);
  }

  /** Steering assist for the carrier: bias movement towards a rolling ball so players run onto their touches. */
  private assistCarrier(commands: PlayerCommand[]): void {
    const c = this.controller;
    if (!c || this.ball.heldBy !== null || c.activeKick || c.locked) return;
    const cmd = commands[c.id];
    let ml = hyp(cmd.move.x, cmd.move.z);
    const ball = this.ball;
    const bx = ball.pos.x - c.pos.x,
      bz = ball.pos.z - c.pos.z;
    const bl = hyp(bx, bz);
    // Ball rolling away from the carrier: go and collect it before doing anything else
    // (unless a human is clearly steering the other way).
    if (bl > 0.9) {
      const away = (ball.vel.x * bx + ball.vel.z * bz) / bl;
      const opposing = c.humanControlled && ml > 0.3 && (bx * cmd.move.x + bz * cmd.move.z) / (bl * ml) < -0.3;
      if (away > c.speed * 0.7 && away > 1 && !opposing) {
        const need = Math.min(1, (away + 1.8) / PLAYER.runSpeed);
        cmd.move.set((bx / bl) * Math.max(need, ml), (bz / bl) * Math.max(need, ml));
        cmd.sprint = cmd.sprint || away > PLAYER.runSpeed * 0.85;
        return;
      }
    }
    if (ml < 0.2) return;
    ml = hyp(cmd.move.x, cmd.move.z);
    if (bl < 0.5) return;
    const cos = (bx * cmd.move.x + bz * cmd.move.z) / (bl * ml);
    if (cos < 0.3) {
      // Ball is behind or beside: turn back and collect it before setting off in the new direction.
      if (bl > 0.6) cmd.move.set((bx / bl) * Math.min(ml, 0.8), (bz / bl) * Math.min(ml, 0.8));
      return;
    }
    const w = 0.45 * cos;
    cmd.move.set(cmd.move.x * (1 - w) + (bx / bl) * ml * w, cmd.move.z * (1 - w) + (bz / bl) * ml * w);
  }

  // ---------------------------------------------------------------------------
  // Tackles, saves, collisions
  // ---------------------------------------------------------------------------

  private resolveTackles(): void {
    const ball = this.ball;
    for (const t of this.players) {
      if (t.tackleHit) continue;
      const slide = t.anim === Anim.Slide;
      const stand = t.anim === Anim.Tackle;
      if (!slide && !stand) continue;
      const active = slide ? t.animTime > 0.04 && t.animTime < 0.62 : t.animTime > 0.05 && t.animTime < 0.3;
      if (!active) continue;
      const fx = Math.cos(t.facing),
        fz = Math.sin(t.facing);
      const reach = slide ? 1.25 : 0.95;
      const ballLow = ball.pos.y < 0.7 && ball.heldBy === null;

      const seg = pointSegmentDistXZ(ball.pos.x, ball.pos.z, t.pos.x, t.pos.z, t.pos.x + fx * reach, t.pos.z + fz * reach);
      const ctrl = this.controller;
      const victim = ctrl && ctrl.team !== t.team ? ctrl : null;

      if (ballLow && seg.dist < (slide ? 0.45 : 0.55) && this.canTouch(t)) {
        // Got a foot to the ball. Standing tackles are judged on timing: how exposed the ball is,
        // the angle of approach, shielding and how fast the carrier is moving.
        let success = true;
        let clean = false;
        if (victim) {
          const e = this.exposure(victim);
          const shielded = this.isShielded(victim, t);
          const facingDot = Math.cos(victim.facing) * fx + Math.sin(victim.facing) * fz; // +1 = from behind
          const front = Math.max(0, -facingDot);
          let chance = slide ? 0.55 + 0.35 * e : 0.22 + 0.58 * e + 0.15 * front - Math.min(0.2, victim.speed * 0.022);
          if (shielded) chance -= 0.32;
          if (victim.evade > 0) chance -= 0.45;
          success = this.rng.next() < clamp(chance, 0.04, 0.95);
          clean = !slide && success && this.rng.next() < 0.35 + 0.35 * front;
          if (!success && !slide && facingDot > 0.5 && (shielded || e < 0.25) && this.rng.next() < 0.3) {
            // Clumsy challenge through the back of the player.
            t.tackleHit = true;
            victim.setAnim(Anim.Stumble, 0.5);
            this.events.emit('tackle', { tacklerId: t.id, victimId: victim.id, won: false, slide });
            this.events.emit('foul', {
              offenderId: t.id,
              victimId: victim.id,
              x: victim.pos.x,
              z: victim.pos.z,
              slide: false,
              fromBehind: facingDot,
              tacklerSpeed: t.speed,
            });
            continue;
          }
        }
        if (success) {
          if (victim) {
            victim.noControl = 0.5;
            if (victim.anim === Anim.Locomotion) victim.setAnim(Anim.Stumble, 0.4);
          }
          this.controllerId = null;
          t.tackleHit = true;
          this.events.emit('tackle', { tacklerId: t.id, victimId: victim?.id ?? null, won: true, slide });
          if (clean) {
            // Won cleanly: the tackler comes away with the ball at their feet.
            ball.vel.set(t.vel.x * 0.5 + fx * 1.2, 0, t.vel.z * 0.5 + fz * 1.2);
            t.noControl = 0;
            t.lockTime = Math.min(t.lockTime, t.animTime + 0.12);
            this.takeControlAfterTackle(t);
          } else {
            const sp = slide ? Math.max(6, t.speed * 1.05) : 4.2;
            const side = this.rng.gaussian() * 0.35;
            ball.vel.set((fx - fz * side) * sp, slide ? 0.6 : 0.2, (fz + fx * side) * sp);
            ball.pos.y = Math.max(ball.pos.y, BALL.radius + 0.01);
            t.noControl = slide ? 0.25 : 0.08;
            this.markTouch(t);
          }
          continue;
        } else {
          // Missed: the tackler has committed and is briefly out of the play.
          t.tackleHit = true;
          t.lockTime += slide ? 0.2 : 0.32;
          if (victim) victim.burst = Math.max(victim.burst, 0.35);
          this.events.emit('tackle', { tacklerId: t.id, victimId: victim?.id ?? null, won: false, slide });
          continue;
        }
      }

      // Slide tackles that take the man instead of the ball are fouls.
      if (slide && t.animTime > 0.08) {
        for (const o of this.players) {
          if (o.team === t.team || o.anim === Anim.Fallen || o.anim === Anim.Dive) continue;
          const s2 = pointSegmentDistXZ(o.pos.x, o.pos.z, t.pos.x, t.pos.z, t.pos.x + fx * 1.0, t.pos.z + fz * 1.0);
          if (s2.dist < 0.42) {
            t.tackleHit = true;
            o.setAnim(Anim.Fallen, 1.3);
            o.vel.scale(0.3);
            o.noControl = 1.0;
            if (this.controllerId === o.id) this.controllerId = null;
            const behind = Math.cos(o.facing) * fx + Math.sin(o.facing) * fz; // +1 = from behind
            this.events.emit('foul', { offenderId: t.id, victimId: o.id, x: o.pos.x, z: o.pos.z, slide: true, fromBehind: behind, tacklerSpeed: t.speed });
            break;
          }
        }
      }
    }
  }

  private takeControlAfterTackle(t: Player): void {
    const prevTeam = this.possessionTeam;
    this.controllerId = t.id;
    this.possessionTeam = t.team;
    t.touchTime = this.time;
    t.touchCooldown = 0.2;
    this.markTouch(t);
    this.events.emit('control', { playerId: t.id, previousTeam: prevTeam });
  }

  private keeperSaves(): void {
    const ball = this.ball;
    if (ball.heldBy !== null) return;
    const speed = ball.speed;
    if (speed < 3) return;
    for (const g of this.players) {
      if (!g.isGK || g.noControl > 0 || !this.canTouch(g)) continue;
      if (!this.inPenaltyArea(g.pos.x, g.pos.z, g.team)) continue;
      if (this.lastTouchId === g.id && this.time - (this.lastKick?.time ?? 0) < 0.4) continue;
      // Save volume: standing = vertical capsule with arms; diving = horizontal capsule along dive direction.
      let ax: number, ay: number, az: number, bx: number, by: number, bz: number, rad: number;
      if (g.anim === Anim.Dive) {
        // The body stretches out over the first fraction of a second.
        const dz = g.diveDir;
        // (Penalty difficulty boost also stretches the keeper out faster — the ball arrives in ~0.4 s.)
        const e = clamp((g.animTime - 0.04) / (GK.diveExtendTime / g.diveBoost), 0, 1);
        const ext = 0.35 + GK.diveReach * g.diveBoost * e * e * (3 - 2 * e);
        ax = g.pos.x;
        ay = g.y + 0.35;
        az = g.pos.z - dz * 0.3;
        bx = g.pos.x;
        by = g.y + 0.5 + g.diveHeight * 0.6;
        bz = g.pos.z + dz * ext;
        rad = 0.3;
      } else {
        ax = g.pos.x;
        ay = 0.1 + g.y;
        az = g.pos.z;
        bx = g.pos.x;
        by = GK.standingHeight - 0.25 + g.y;
        bz = g.pos.z;
        rad = 0.5;
      }
      const d = segDist3(ball.pos, ax, ay, az, bx, by, bz);
      if (d > rad + BALL.radius) continue;
      // Contact! Catch or parry.
      const towardsGoal = ball.vel.x * -this.attackDir(g.team) > 0;
      const catchable = speed < (g.anim === Anim.Dive ? 15 : 21) && ball.pos.y < 2.3;
      const catchProb = catchable ? clamp(1.15 - speed / 26, 0.25, 0.95) : 0;
      if (this.rng.next() < catchProb) {
        ball.heldBy = g.id;
        this.holdStyle = 'gk';
        ball.vel.set(0, 0, 0);
        ball.spin.set(0, 0, 0);
        this.controllerId = g.id;
        this.possessionTeam = g.team;
        if (g.anim !== Anim.Dive) g.setAnim(Anim.Hold, 0.5);
        this.markTouch(g);
        this.events.emit('save', { keeperId: g.id, caught: true, speed });
      } else {
        // Parry: push the ball away from goal and wide.
        const out = this.attackDir(g.team); // away from own goal along x
        const side = Math.sign(ball.pos.z - g.pos.z) || (this.rng.chance(0.5) ? 1 : -1);
        const pv = speed * 0.38;
        ball.vel.set(out * pv * 0.7 + (towardsGoal ? 0 : ball.vel.x * 0.2), 1.5 + this.rng.next() * 3, side * pv * 0.8);
        ball.spin.scale(0.2);
        g.noControl = 0.35;
        this.markTouch(g);
        this.events.emit('save', { keeperId: g.id, caught: false, speed });
      }
      return;
    }
  }

  private ballBodyCollisions(): void {
    const ball = this.ball;
    if (ball.heldBy !== null) return;
    const lk = this.lastKick;
    for (const p of this.players) {
      if (p.id === this.controllerId) continue;
      if (!this.canTouch(p) && this.restrictTouchTo !== null) continue;
      if (lk && lk.playerId === p.id && this.time - lk.time < 0.25) continue;
      if (p.anim === Anim.Fallen) continue;
      const top = p.y + (p.anim === Anim.Slide || p.anim === Anim.Dive ? 0.6 : PLAYER.height);
      if (ball.pos.y > top + BALL.radius || ball.pos.y < p.y - BALL.radius) continue;
      const dx = ball.pos.x - p.pos.x,
        dz = ball.pos.z - p.pos.z;
      const d = hyp(dx, dz);
      const minD = PLAYER.radius * (ball.pos.y > 1.5 ? 0.7 : 1) + BALL.radius;
      if (d >= minD || d < 1e-6) continue;
      const nx = dx / d,
        nz = dz / d;
      const rvx = ball.vel.x - p.vel.x,
        rvz = ball.vel.z - p.vel.z;
      const vn = rvx * nx + rvz * nz;
      ball.pos.x = p.pos.x + nx * minD;
      ball.pos.z = p.pos.z + nz * minD;
      if (vn < 0) {
        const rel = hyp(rvx, rvz);
        const e = 0.32;
        ball.vel.x -= (1 + e) * vn * nx;
        ball.vel.z -= (1 + e) * vn * nz;
        ball.vel.x += this.rng.gaussian() * 0.5;
        ball.vel.z += this.rng.gaussian() * 0.5;
        ball.spin.scale(0.3);
        if (rel > 6) {
          this.markTouch(p);
          this.events.emit('deflect', { playerId: p.id, speed: rel });
        }
      }
    }
  }

  private resolvePlayerCollisions(): void {
    const ps = this.players;
    const minD = PLAYER.radius * 2;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        const dx = b.pos.x - a.pos.x,
          dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-8) continue;
        if (a.anim === Anim.Fallen || b.anim === Anim.Fallen) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d,
          nz = dz / d;
        const overlap = (minD - d) * 0.5;
        // Heavier push on the player without the ball (ball carrier shields).
        const wa = this.controllerId === a.id ? 0.35 : this.controllerId === b.id ? 0.65 : 0.5;
        a.pos.x -= nx * overlap * 2 * wa;
        a.pos.z -= nz * overlap * 2 * wa;
        b.pos.x += nx * overlap * 2 * (1 - wa);
        b.pos.z += nz * overlap * 2 * (1 - wa);
        const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
        if (rv < 0) {
          a.vel.x += nx * rv * 0.5;
          a.vel.z += nz * rv * 0.5;
          b.vel.x -= nx * rv * 0.5;
          b.vel.z -= nz * rv * 0.5;
        }
      }
    }
  }

  private keepPlayersInBounds(): void {
    const hx = this.pitch.length / 2 + 3;
    const hz = this.pitch.width / 2 + 2.5;
    for (const p of this.players) {
      if (p.sentOff) continue; // off the pitch, beside the technical area
      p.pos.x = clamp(p.pos.x, -hx, hx);
      p.pos.z = clamp(p.pos.z, -hz, hz);
      // Keep players out of the goal frame.
      const gx = this.pitch.length / 2;
      if (Math.abs(p.pos.x) > gx && Math.abs(p.pos.z) < this.pitch.goalWidth / 2 + 0.3) {
        p.pos.x = Math.sign(p.pos.x) * Math.min(Math.abs(p.pos.x), gx + this.pitch.goalDepth - 0.3);
      }
    }
  }
}

function segDist3(p: Vec3, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-9 ? ((p.x - ax) * abx + (p.y - ay) * aby + (p.z - az) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t - p.x,
    cy = ay + aby * t - p.y,
    cz = az + abz * t - p.z;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}
