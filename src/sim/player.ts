/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { MOVE, GK, PLAYER, Role, TeamId } from './config';
import { cadence } from './gait';
import { Vec2, angleDiff, approachAngle, clamp, hyp } from '../core/math';

/** Animation/action state. Also drives the procedural animation in the renderer. */
export enum Anim {
  Locomotion = 0,
  Kick = 1,
  Pass = 2,
  Tackle = 3,
  Slide = 4,
  Stumble = 5,
  Dive = 6,
  Hold = 7,
  Throw = 8,
  Celebrate = 9,
  Header = 10,
  Skill = 11,
  Dejected = 12,
  GkReady = 13,
  Fallen = 14,
}

/** What kind of kick is being played; it decides the ball's trajectory and how the rules treat it. */
export type KickKind = 'shot' | 'pass' | 'through' | 'lob' | 'chip' | 'header' | 'clear' | 'touch';

/** A kick a controller asks for. The world applies it at the moment of foot contact, not when requested. */
export interface KickRequest {
  kind: KickKind;
  /** 0..1 */
  power: number;
  /** Desired horizontal direction (normalised) — for passes this points at the target. */
  dir: { x: number; z: number };
  /** Exact target point on the pitch (optional, used for passes / crosses). */
  target?: { x: number; z: number };
  /** Target height for shots (m). */
  height?: number;
  /** Curl −1..1 (positive curls to the kicker's left). */
  curl?: number;
  /** Intended receiver id (for passes). */
  receiver?: number;
  /** Aim error std-dev (radians), applied at contact. */
  error?: number;
}

/** What a controller (human or AI) asks a player to do this tick. */
export interface PlayerCommand {
  /** Desired movement direction, magnitude 0..1. */
  move: Vec2;
  sprint: boolean;
  /** Optional facing override (e.g. keep facing ball while jockeying). */
  face?: Vec2 | null;
  kick?: KickRequest | null;
  tackle?: 'stand' | 'slide' | null;
  skill?: { x: number; z: number } | null;
  /** Goalkeeper dive request: lateral direction (+1/-1 relative to the z axis) and height 0..1. */
  dive?: { z: number; height: number } | null;
}

/** A command that does nothing: stand still, face forward. */
export function emptyCommand(): PlayerCommand {
  return { move: new Vec2(), sprint: false, face: new Vec2() };
}

/**
 * One footballer's simulated state: position, velocity, facing, stamina, animation state and gait
 * phase. Movement physics (acceleration that falls off near top speed, speed-dependent turning)
 * lives here; deciding *what* to do is the job of the AI or the human input.
 */
export class Player {
  readonly pos = new Vec2();
  readonly vel = new Vec2();
  /** Facing angle (radians, atan2(z, x)). */
  facing = 0;
  /** Vertical position (jumps, dives). */
  y = 0;
  vy = 0;

  anim: Anim = Anim.Locomotion;
  animTime = 0;
  /** Duration of the current locked action; locomotion when animTime >= lockTime. */
  lockTime = 0;
  /** Accumulated stride distance for the run cycle. */
  runPhase = 0;
  /** Gait cycle phase (radians). Left foot is forward at sin = 1, right at sin = −1. */
  gaitPhase = 0;
  /** Sim time of the last dribble touch and the foot used (+1 left, −1 right). */
  touchTime = -10;
  touchFoot = 1;
  /** Kicking foot for the current kick (+1 left, −1 right). */
  kickFoot = -1;
  /** Kick time of the last pass this player tried (and failed) to cut out. */
  interceptRoll = -1;
  /** Seconds remaining of a sharp-cut plant (heavy braking before changing direction). */
  plant = 0;
  stamina = 1;
  /** Seconds remaining during which this player cannot control the ball. */
  noControl = 0;
  /** Seconds remaining of a speed burst (skill moves). */
  burst = 0;
  /** Seconds remaining of tackle immunity (after a skill move). */
  evade = 0;
  /** Seconds remaining after being fooled by a skill move. */
  fooled = 0;

  /** Pending kick waiting for the ball to arrive within reach. */
  pendingKick: KickRequest | null = null;
  pendingKickTtl = 0;
  /** Kick being executed (wind-up in progress). */
  activeKick: KickRequest | null = null;
  kickContactAt = 0;
  kickDone = false;

  /** Tackle state. */
  tackleHit = false;
  /** Dive state for goalkeepers. */
  diveDir = 0;
  diveHeight = 0;
  /** Target lateral dive velocity reached after the push-off. */
  diveSpeed = 0;
  /** Dive speed / reach multiplier (penalty-shootout difficulty tuning; 1 elsewhere). */
  diveBoost = 1;

  /** Dribble knock-on cooldown. */
  touchCooldown = 0;
  /** Lean (for animation) derived from acceleration. */
  lean = 0;
  /** Last commanded move intent magnitude. */
  intent = 0;

  humanControlled = false;
  /** Sent off (Law 12): off the pitch for the rest of the match, can't touch the ball or be selected. */
  sentOff = false;
  /** Emotional state for animation: 0 neutral, 1 celebrating, 2 dejected. */
  mood: 0 | 1 | 2 = 0;
  /** Gesture shown by the animation (celebration style or reaction; see src/sim/celebration.ts). */
  gesture = 0;
  /** Seconds left on a temporary reaction gesture (near miss, save); 0 = held until cleared. */
  gestureTime = 0;
  lastSprint = false;

  constructor(
    readonly id: number,
    readonly team: TeamId,
    readonly role: Role,
    readonly number: number,
    readonly name: string,
    /** Index within the team. */
    readonly index: number,
  ) {}

  get isGK(): boolean {
    return this.role === 'GK';
  }

  get locked(): boolean {
    return this.anim !== Anim.Locomotion && this.anim !== Anim.GkReady && this.animTime < this.lockTime;
  }

  get speed(): number {
    return this.vel.length();
  }

  /** Foot position: slightly in front of the body, where the ball is played. */
  footX(dist = 0.45): number {
    return this.pos.x + Math.cos(this.facing) * dist;
  }
  footZ(dist = 0.45): number {
    return this.pos.z + Math.sin(this.facing) * dist;
  }

  setAnim(anim: Anim, lock: number): void {
    this.anim = anim;
    this.animTime = 0;
    this.lockTime = lock;
  }

  /** Teleport to a position, clearing motion and actions. */
  place(x: number, z: number, facing: number): void {
    this.pos.set(x, z);
    this.vel.set(0, 0);
    this.facing = facing;
    this.y = 0;
    this.vy = 0;
    this.anim = this.isGK ? Anim.GkReady : Anim.Locomotion;
    this.animTime = 0;
    this.lockTime = 0;
    this.pendingKick = null;
    this.activeKick = null;
    this.noControl = 0;
    this.burst = 0;
    this.evade = 0;
    this.fooled = 0;
  }

  /**
   * Integrate locomotion for one fixed step from a command.
   * `hasBall` slightly reduces top speed while dribbling.
   */
  move(cmd: PlayerCommand, dt: number, hasBall: boolean): void {
    this.animTime += dt;
    this.noControl = Math.max(0, this.noControl - dt);
    this.burst = Math.max(0, this.burst - dt);
    this.evade = Math.max(0, this.evade - dt);
    this.fooled = Math.max(0, this.fooled - dt);
    this.touchCooldown = Math.max(0, this.touchCooldown - dt);

    if (this.anim !== Anim.Locomotion && this.anim !== Anim.GkReady && this.animTime >= this.lockTime) {
      this.anim = this.isGK ? Anim.GkReady : Anim.Locomotion;
    }

    // Vertical motion (jumps / dives).
    if (this.y > 0 || this.vy > 0) {
      this.vy -= 9.81 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    }

    const locked = this.locked;
    let desiredX = 0,
      desiredZ = 0;
    let sprint = false;
    if (!locked && this.fooled <= 0) {
      const mag = Math.min(1, cmd.move.length());
      this.intent = mag;
      sprint = cmd.sprint && mag > 0.3 && this.stamina > 0.05;
      let top = sprint ? PLAYER.sprintSpeed * (0.82 + 0.18 * Math.min(1, this.stamina * 2)) : PLAYER.runSpeed;
      if (hasBall) top *= PLAYER.dribbleSpeedFactor;
      if (this.burst > 0) top *= 1.16;
      if (mag > 1e-3) {
        desiredX = (cmd.move.x / Math.max(mag, 1e-6)) * mag * top;
        desiredZ = (cmd.move.z / Math.max(mag, 1e-6)) * mag * top;
      }
    } else {
      this.intent = 0;
    }
    this.lastSprint = sprint;

    // Stamina.
    if (sprint && this.speed > 3) this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
    else this.stamina = Math.min(1, this.stamina + PLAYER.staminaRegen * dt * (this.speed < 3 ? 1.6 : 1));

    if (this.anim === Anim.Dive && this.animTime < GK.diveWindup + 0.05) {
      // Goalkeeper push-off: accelerate into the dive.
      const k = Math.min(1, dt / Math.max(0.01, GK.diveWindup - this.animTime + dt));
      this.vel.z += (this.diveSpeed - this.vel.z) * k;
    } else if (locked) {
      // Momentum-driven during locked actions (slides, dives keep their own velocity).
      const friction = this.anim === Anim.Slide ? 5.5 : this.anim === Anim.Dive ? (this.y > 0 ? 0.4 : 9) : 10;
      const k = Math.exp(-friction * dt);
      this.vel.scale(k);
    } else {
      this.steer(desiredX, desiredZ, dt);
    }

    // Facing.
    if (!locked || this.anim === Anim.Kick || this.anim === Anim.Pass) {
      const sp = this.speed;
      let targetAngle: number | null = null;
      if (this.activeKick) targetAngle = Math.atan2(this.activeKick.dir.z, this.activeKick.dir.x);
      else if (cmd.face && cmd.face.lengthSq() > 1e-6) targetAngle = Math.atan2(cmd.face.z, cmd.face.x);
      else if (sp > 0.4) targetAngle = Math.atan2(this.vel.z, this.vel.x);
      if (targetAngle !== null) {
        const rate = sp > PLAYER.runSpeed + 0.5 ? PLAYER.sprintTurnRate : PLAYER.turnRate;
        this.facing = approachAngle(this.facing, targetAngle, rate * dt * (this.activeKick ? 2 : 1));
      }
    }

    this.pos.addScaled(this.vel, dt);
    const sp = this.speed;
    this.runPhase += sp * dt;
    // Legs cycle at the rate where a stride covers the distance travelled, so feet don't skate.
    this.gaitPhase += cadence(sp) * Math.PI * 2 * dt;
  }

  /**
   * Momentum-based steering: speed changes with acceleration that falls off near top speed,
   * the velocity direction rotates at a speed-dependent rate (wider arcs when sprinting), and
   * sharp reversals at speed trigger a short plant (braking) before the cut.
   */
  private steer(desiredX: number, desiredZ: number, dt: number): void {
    const v = this.vel;
    const sp = hyp(v.x, v.z);
    const dsp = hyp(desiredX, desiredZ);
    const fooledK = this.fooled > 0 ? 0.3 : 1;
    const hu = this.humanControlled;
    const accel = MOVE.accel * (hu ? MOVE.humanAccel : 1);
    const decel = MOVE.decel * (hu ? MOVE.humanDecel : 1);
    if (sp < 0.6) {
      // From (near) standstill: accelerate straight towards the desired direction.
      const dvx = desiredX - v.x,
        dvz = desiredZ - v.z;
      const dv = hyp(dvx, dvz);
      const maxDv = accel * dt * fooledK;
      if (dv > maxDv) {
        v.x += (dvx / dv) * maxDv;
        v.z += (dvz / dv) * maxDv;
      } else {
        v.x = desiredX;
        v.z = desiredZ;
      }
      this.lean = clamp(this.lean + (dv > 0.5 ? 1 : -1) * dt * 4, 0, 1);
      return;
    }
    const heading = Math.atan2(v.z, v.x);
    let newHeading = heading;
    let targetSpeed = dsp;
    if (dsp > 0.05) {
      const want = Math.atan2(desiredZ, desiredX);
      const diff = Math.abs(angleDiff(heading, want));
      if (diff > MOVE.plantAngle && sp > MOVE.plantMinSpeed && this.plant <= 0) {
        this.plant = (MOVE.plantBase + sp * MOVE.plantPerSpeed) * (hu ? MOVE.humanPlant : 1);
      }
      if (this.plant > 0) {
        this.plant -= dt;
        targetSpeed = 0;
      } else if (diff > MOVE.plantAngle && sp < MOVE.plantMinSpeed + 1.5 && hu) {
        // Human reversal: brake through the turn rather than carving a wide arc.
        targetSpeed = 0;
      } else {
        const t = clamp((sp - 1.5) / 6.5, 0, 1);
        const rate = MOVE.turnRateSlow + (MOVE.turnRateFast - MOVE.turnRateSlow) * t;
        newHeading = approachAngle(heading, want, rate * dt * (hu ? MOVE.humanTurn : 1));
        // Turning hard costs speed.
        const loss = MOVE.turnSpeedLoss * (hu ? MOVE.humanTurnSpeedLoss : 1);
        if (diff > 0.9) targetSpeed = Math.min(targetSpeed, sp * (1 - Math.min(loss, (diff - 0.9) * 0.35)));
      }
    } else {
      this.plant = 0;
    }
    let nsp: number;
    if (targetSpeed > sp) {
      const a = accel * (1 - 0.55 * (sp / PLAYER.sprintSpeed)) * fooledK;
      nsp = Math.min(targetSpeed, sp + a * dt);
    } else {
      nsp = Math.max(targetSpeed, sp - decel * dt);
    }
    v.x = Math.cos(newHeading) * nsp;
    v.z = Math.sin(newHeading) * nsp;
    this.lean = clamp(this.lean + (Math.abs(nsp - sp) > 0.02 || newHeading !== heading ? 1 : -1) * dt * 4, 0, 1);
  }
}
