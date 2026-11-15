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
 * Turns one frame of device-agnostic input into a PlayerCommand for the human-controlled player:
 * movement, sprint, and kicks with assistance (pass target selection, shot placement from the stick
 * and charge). The simulation never sees keys or buttons, so keyboard, controller and touch all
 * play by the same rules, and tests can drive a "human" with plain data.
 */

import { KickRequest, Player, PlayerCommand } from './player';
import { World } from './world';
import { pickPassTarget } from './ai/evaluate';
import { clamp, lerp, hyp } from '../core/math';

export interface ButtonState {
  /** Currently held. */
  down: boolean;
  /** Became pressed since the last consumed frame. */
  pressed: boolean;
  /** Became released since the last consumed frame. */
  released: boolean;
  /** Seconds held (current hold, or the hold that just ended on release). */
  held: number;
}

export type ActionName = 'shoot' | 'pass' | 'through' | 'lob' | 'tackle' | 'switch' | 'skill';

/** Device-agnostic input for one frame. Movement is already in world space (camera-relative mapping done by the input layer). */
export interface InputFrame {
  move: { x: number; z: number };
  sprint: boolean;
  buttons: Record<ActionName, ButtonState>;
  /** Optional mouse aim point on the pitch. */
  aim: { x: number; z: number } | null;
  /**
   * Responsive passing: an ordinary pass fires on button PRESS (auto-weighted to the target) instead of
   * on release with hold-to-charge. Shots, through balls and lobs keep their power control either way.
   */
  passOnPress: boolean;
  /** Simple controls: shots fire on press with assisted power (Advanced: hold to charge, release). */
  shotOnPress: boolean;
  /**
   * Defending meaning of the action buttons, by device:
   *  - 'keys'  (keyboard): pass = standing tackle, shoot = slide, through = switch, lob = hold to jockey
   *  - 'pad'   (gamepad, console-football convention): shoot (B) = tackle, lob (X) = slide, pass (A) = hold to jockey
   *  - 'direct' (touch): dedicated Tackle / Switch / Slide buttons (tackle / switch / lob actions)
   */
  defendScheme: 'keys' | 'pad' | 'direct';
}

export function emptyButton(): ButtonState {
  return { down: false, pressed: false, released: false, held: 0 };
}

export function emptyInput(): InputFrame {
  return {
    move: { x: 0, z: 0 },
    sprint: false,
    buttons: {
      shoot: emptyButton(),
      pass: emptyButton(),
      through: emptyButton(),
      lob: emptyButton(),
      tackle: emptyButton(),
      switch: emptyButton(),
      skill: emptyButton(),
    },
    aim: null,
    passOnPress: false,
    shotOnPress: false,
    defendScheme: 'pad',
  };
}

/** Shot power used for a shot on press (Simple controls): firm but controllable. */
export const SHOT_PRESS_POWER = 0.72;

/** Whether the human's action buttons currently mean "jockey" (contain) — used by the match to slow / face. */
export function humanJockeying(f: InputFrame, defending: boolean): boolean {
  if (!defending) return false;
  return f.defendScheme === 'keys' ? f.buttons.lob.down : f.defendScheme === 'pad' ? f.buttons.pass.down : false;
}
/** Whether the human asked to switch player this frame (dedicated switch, or keyboard "through" when defending). */
export function humanSwitchPressed(f: InputFrame, defending: boolean): boolean {
  return f.buttons.switch.pressed || (defending && f.defendScheme === 'keys' && f.buttons.through.pressed);
}

/** Pass power used for a pass on press (same as a quick tap in charged mode). */
export const PASS_PRESS_POWER = 0.12;

/** Clear edge-triggered flags after a fixed step consumed them. */
export function consumeEdges(f: InputFrame): void {
  for (const k of Object.keys(f.buttons) as ActionName[]) {
    f.buttons[k].pressed = false;
    f.buttons[k].released = false;
  }
}

/** Seconds of holding for full power. */
export const FULL_CHARGE = 0.9;

export function chargeToPower(held: number, min = 0.15): number {
  return clamp(held / FULL_CHARGE, min, 1);
}

/**
 * Translates player intent into simulation commands, adding the kind of assistance
 * players expect from modern football games (pass target selection, shot aim on goal).
 */
export function humanCommand(world: World, p: Player, f: InputFrame, cmd: PlayerCommand): void {
  cmd.move.set(f.move.x, f.move.z);
  cmd.sprint = f.sprint;
  const b = f.buttons;
  const ball = world.ball;
  const ctrl = world.controller;
  const oppHasBall = !!ctrl && ctrl.team !== p.team;
  const dir = world.attackDir(p.team);

  // Kick direction intent: stick direction, else facing.
  const ml = hyp(f.move.x, f.move.z);
  const ix = ml > 0.2 ? f.move.x / ml : Math.cos(p.facing);
  const iz = ml > 0.2 ? f.move.z / ml : Math.sin(p.facing);

  if (b.skill.pressed) cmd.skill = { x: f.move.x, z: f.move.z };

  if (b.tackle.pressed) cmd.tackle = f.sprint ? 'slide' : 'stand';

  if (oppHasBall) {
    // Context-sensitive defending on the action buttons (mapping depends on the device, see InputFrame).
    if (f.defendScheme === 'keys') {
      if (b.pass.pressed) cmd.tackle = 'stand';
      if (b.shoot.pressed) cmd.tackle = 'slide';
    } else {
      if (b.shoot.pressed) cmd.tackle = 'stand';
      if (b.lob.pressed) cmd.tackle = 'slide';
    }
    if (humanJockeying(f, true)) {
      // Jockey: contain at a controlled pace, square on to the ball carrier.
      cmd.sprint = false;
      const ml0 = hyp(cmd.move.x, cmd.move.z);
      if (ml0 > 0.55) cmd.move.set((cmd.move.x / ml0) * 0.55, (cmd.move.z / ml0) * 0.55);
      if (ctrl) cmd.face?.set(ctrl.pos.x - p.pos.x, ctrl.pos.z - p.pos.z);
    }
    return;
  }

  if (f.shotOnPress ? b.shoot.pressed : b.shoot.released) {
    cmd.kick = shotRequest(world, p, f.shotOnPress ? SHOT_PRESS_POWER : chargeToPower(b.shoot.held, 0.2), f);
  } else if (f.passOnPress ? b.pass.pressed : b.pass.released) {
    const power = f.passOnPress ? PASS_PRESS_POWER : chargeToPower(b.pass.held, 0.1);
    cmd.kick = passRequest(world, p, 'pass', power, ix, iz, ml <= 0.2);
  } else if (b.through.released) {
    cmd.kick = passRequest(world, p, 'through', chargeToPower(b.through.held, 0.3), ix, iz);
  } else if (b.lob.released) {
    cmd.kick = passRequest(world, p, 'lob', chargeToPower(b.lob.held, 0.3), ix, iz);
  }
  void ball;
  void dir;
}

export function shotRequest(world: World, p: Player, power: number, f: InputFrame): KickRequest {
  const ball = world.ball;
  const dir = world.attackDir(p.team);
  const gw = world.pitch.goalWidth / 2;
  const goalX = (dir * world.pitch.length) / 2;
  let aimZ: number;
  if (f.aim) {
    // Mouse aim: project the aim direction onto the goal line.
    const ax = f.aim.x - ball.pos.x,
      az = f.aim.z - ball.pos.z;
    const t = Math.abs(ax) > 0.1 ? (goalX - ball.pos.x) / ax : 0;
    aimZ = t > 0 ? ball.pos.z + az * t : f.aim.z;
  } else {
    // Stick across the pitch picks the side; neutral aims away from the keeper.
    const lateral = f.move.z;
    if (Math.abs(lateral) > 0.25) {
      aimZ = Math.sign(lateral) * (gw - 0.55) * Math.min(1, Math.abs(lateral) * 1.3);
    } else {
      const keeper = world.players.find((q) => q.isGK && q.team !== p.team);
      const kz = keeper ? keeper.pos.z : 0;
      aimZ = (kz > ball.pos.z * 0.1 ? -1 : 1) * (gw - 0.6);
      if (Math.abs(ball.pos.z) > gw) aimZ = -Math.sign(ball.pos.z) * (gw - 0.6); // far post
    }
  }
  aimZ = clamp(aimZ, -gw + 0.25, gw - 0.25);
  // Finesse: mid-power shots curl towards the aim point.
  const curl = power > 0.3 && power < 0.78 && Math.abs(aimZ) > gw * 0.4 ? Math.sign(aimZ) * dir * 0.55 : 0;
  return {
    kind: 'shot',
    power,
    dir: { x: goalX - ball.pos.x, z: aimZ - ball.pos.z },
    height: lerp(0.2, 1.75, power),
    curl,
    error: 0.028,
  };
}

export function passRequest(
  world: World,
  p: Player,
  kind: 'pass' | 'through' | 'lob',
  power: number,
  ix: number,
  iz: number,
  noDirection = false,
): KickRequest {
  const ball = world.ball;
  const L2 = world.pitch.length / 2,
    W2 = world.pitch.width / 2;
  const maxDist = kind === 'lob' ? world.pitch.length * 0.8 : world.pitch.length * 0.6;
  let target = pickPassTarget(world, p, ix, iz, maxDist);
  // No stick input and nobody in front: play it to the nearest outfield teammate.
  if (!target && noDirection) {
    let best = Infinity;
    for (const t of world.players) {
      if (t.team !== p.team || t.id === p.id || t.isGK) continue;
      const d = t.pos.distanceTo(p.pos);
      if (d < best && d < maxDist) {
        best = d;
        target = t;
      }
    }
  }
  let tx: number, tz: number;
  let receiver: number | undefined;
  if (target) {
    receiver = target.id;
    if (kind === 'through') {
      // Lead the receiver into space towards goal (or along their run).
      const dir = world.attackDir(p.team);
      const sp = target.speed;
      const rx = sp > 1.5 ? target.vel.x / sp : dir;
      const rz = sp > 1.5 ? target.vel.z / sp : 0;
      const lead = lerp(4, 10, power);
      tx = target.pos.x + (rx * 0.7 + dir * 0.3) * lead;
      tz = target.pos.z + rz * 0.7 * lead;
    } else {
      const lead = kind === 'lob' ? 0.9 : 0.45;
      tx = target.pos.x + target.vel.x * lead;
      tz = target.pos.z + target.vel.z * lead;
    }
  } else {
    const dist = kind === 'lob' ? lerp(12, 40, power) : lerp(7, 28, power);
    tx = ball.pos.x + ix * dist;
    tz = ball.pos.z + iz * dist;
  }
  tx = clamp(tx, -L2 - 1, L2 + 1);
  tz = clamp(tz, -W2 + 0.5, W2 - 0.5);
  return {
    kind,
    power,
    dir: { x: tx - ball.pos.x, z: tz - ball.pos.z },
    target: { x: tx, z: tz },
    receiver,
    error: kind === 'lob' ? 0.04 : 0.025,
  };
}
