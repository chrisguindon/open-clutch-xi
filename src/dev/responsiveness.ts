/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { Match } from '../sim/match';
import { MOVE, PLAYER, SIM_DT } from '../sim/config';
import { InputFrame, consumeEdges, emptyInput } from '../sim/human';
import { Anim } from '../sim/player';

/**
 * Human-control responsiveness measurements on an isolated player (practice pitch, partners parked).
 * These measure the *simulation* response to a perfectly timed input: time to move, accelerate, stop,
 * turn and reverse, with and without the ball. They do not include display/OS/device latency.
 * Used by tests/responsiveness.test.ts (before/after numbers) and by the in-game movement lab.
 */
export interface ResponsivenessReport {
  /** Fixed steps from first input to measurable movement (1 = next step). */
  firstMoveSteps: number;
  /** Seconds from standstill to 90% of run speed. */
  runUp90: number;
  /** Seconds from standstill to 90% of (fresh) sprint speed. */
  sprintUp90: number;
  /** Seconds from run speed to 90% of sprint speed after pressing sprint. */
  runToSprint90: number;
  /** Stopping distance (m) / time (s) from run speed after releasing the stick. */
  stopRunDist: number;
  stopRunTime: number;
  /** Stopping distance / time from sprint speed. */
  stopSprintDist: number;
  stopSprintTime: number;
  /** Seconds until moving ≥ 80% of run speed in a direction 90° away (from running). */
  turn90Run: number;
  /** Seconds until moving ≥ 80% of run speed in the opposite direction (from running / sprinting). */
  reverseRun: number;
  reverseSprint: number;
  /** Jockeying: seconds to reach 3 m/s laterally after reversing a side-step at jog pace. */
  shuffleReverse: number;
  /** Dribbling: seconds to be carrying the ball ≥ 3.5 m/s in a direction 90° away, and whether control was kept. */
  dribbleTurn90: number;
  dribbleKept: boolean;
  /** Dribbling 180°: seconds to carry ≥ 3 m/s back the other way. */
  dribbleReverse: number;
  dribbleReverseKept: boolean;
  /** Tap pass (button held 80 ms): seconds from press to the ball leaving the foot. */
  passTapLatency: number;
  /** Responsive passing (pass on press): press → ball leaves the foot, same 80 ms tap. */
  passPressLatency: number;
  /** Tap shot (held 80 ms): seconds from press to the ball leaving the foot. */
  shotTapLatency: number;
  /** Tackle press → tackle animation started (s). */
  tackleLatency: number;
}

function setup(): { m: Match; id: number; input: InputFrame } {
  const m = new Match({ mode: 'practice', format: '5v5', difficulty: 'medium', duration: 9999, seed: 7, replays: false });
  m.phase = 'playing';
  m.world.restrictTouchTo = null;
  const id = m.humanId!;
  return { m, id, input: emptyInput() };
}

/** Park everyone except the human (and the ball unless `withBall`) out of the way. */
function isolate(m: Match, id: number, withBall: boolean): void {
  const w = m.world;
  for (const p of w.players) if (p.id !== id) p.place(-w.pitch.length / 2 + 1 + p.id, w.pitch.width / 2 - 0.5, 0);
  const h = w.players[id];
  h.place(-10, 0, 0);
  if (withBall) {
    w.ball.reset(h.footX(0.5), h.footZ(0.5));
  } else {
    w.ball.reset(20, -12);
  }
  w.clearPossession();
  m.phase = 'playing';
  m.world.restrictTouchTo = null;
}

function step(m: Match, input: InputFrame): void {
  m.step(SIM_DT, input);
  consumeEdges(input);
  if (m.phase !== 'playing') m.phase = 'playing';
}

function setMove(input: InputFrame, x: number, z: number, sprint = false): void {
  input.move.x = x;
  input.move.z = z;
  input.sprint = sprint;
}

/** Run with input until predicate is true; returns elapsed seconds (or cap). */
function until(m: Match, input: InputFrame, pred: () => boolean, cap = 4): number {
  let t = 0;
  while (t < cap) {
    step(m, input);
    t += SIM_DT;
    if (pred()) return t;
  }
  return cap;
}

/**
 * @param aiSteering measure with the human modifiers neutralised (i.e. how an AI player steers),
 *   for comparison. The tuning is restored afterwards.
 */
export function measureResponsiveness(aiSteering = false): ResponsivenessReport {
  if (aiSteering) {
    const saved = { ...MOVE };
    Object.assign(MOVE, { humanAccel: 1, humanDecel: 1, humanTurn: 1, humanPlant: 1, humanTurnSpeedLoss: 1 });
    try {
      return measureResponsiveness(false);
    } finally {
      Object.assign(MOVE, saved);
    }
  }
  const { m, id, input } = setup();
  const w = m.world;
  const h = () => w.players[id];
  const run = PLAYER.runSpeed;

  // First movement.
  isolate(m, id, false);
  setMove(input, 1, 0);
  let firstMoveSteps = 0;
  for (let i = 1; i <= 60; i++) {
    step(m, input);
    if (h().speed > 0.05) {
      firstMoveSteps = i;
      break;
    }
  }

  // Run-up.
  isolate(m, id, false);
  setMove(input, 1, 0);
  const runUp90 = until(m, input, () => h().vel.x >= run * 0.9);

  isolate(m, id, false);
  h().stamina = 1;
  setMove(input, 1, 0, true);
  const sprintTop = PLAYER.sprintSpeed;
  const sprintUp90 = until(m, input, () => h().vel.x >= sprintTop * 0.9);

  isolate(m, id, false);
  setMove(input, 1, 0);
  until(m, input, () => false, 2);
  h().stamina = 1;
  setMove(input, 1, 0, true);
  const runToSprint90 = until(m, input, () => h().vel.x >= sprintTop * 0.9);

  // Stops.
  const stop = (sprint: boolean): [number, number] => {
    isolate(m, id, false);
    h().stamina = 1;
    setMove(input, 1, 0, sprint);
    until(m, input, () => false, 2.5);
    const x0 = h().pos.x;
    setMove(input, 0, 0);
    const t = until(m, input, () => h().speed < 0.1);
    return [h().pos.x - x0, t];
  };
  const [stopRunDist, stopRunTime] = stop(false);
  const [stopSprintDist, stopSprintTime] = stop(true);

  // Turns.
  const turn = (sprint: boolean, nx: number, nz: number, need: number): number => {
    isolate(m, id, false);
    h().stamina = 1;
    setMove(input, 1, 0, sprint);
    until(m, input, () => false, 2.5);
    setMove(input, nx, nz, sprint);
    return until(m, input, () => h().vel.x * nx + h().vel.z * nz >= need);
  };
  const turn90Run = turn(false, 0, 1, run * 0.8);
  const reverseRun = turn(false, -1, 0, run * 0.8);
  const reverseSprint = turn(true, -1, 0, run * 0.8);

  // Defensive shuffle: side-step one way at jog pace, then the other.
  isolate(m, id, false);
  h().facing = 0;
  setMove(input, 0, 0.65);
  until(m, input, () => false, 1);
  setMove(input, 0, -0.65);
  const shuffleReverse = until(m, input, () => -h().vel.z >= 3);

  // Dribbling turns.
  const dribble = (nx: number, nz: number, need: number): [number, boolean] => {
    isolate(m, id, true);
    setMove(input, 1, 0);
    until(m, input, () => false, 2);
    setMove(input, nx, nz);
    let kept = true;
    const t = until(m, input, () => {
      if (w.controllerId !== null && w.controllerId !== id) kept = false;
      const bd = Math.hypot(w.ball.pos.x - h().pos.x, w.ball.pos.z - h().pos.z);
      return bd < 2 && h().vel.x * nx + h().vel.z * nz >= need;
    });
    // Still in control shortly afterwards?
    until(m, input, () => false, 0.6);
    const bd = Math.hypot(w.ball.pos.x - h().pos.x, w.ball.pos.z - h().pos.z);
    if (bd > 2.5 || h().anim === Anim.Stumble) kept = false;
    return [t, kept && t < 4];
  };
  const [dribbleTurn90, dribbleKept] = dribble(0, 1, 3.5);
  const [dribbleReverse, dribbleReverseKept] = dribble(-1, 0, 3);

  // Action latency: press, hold for 80 ms, release; measure until the ball is struck.
  const action = (btn: 'pass' | 'shoot', onPress = false): number => {
    input.passOnPress = onPress;
    isolate(m, id, true);
    h().facing = 0;
    setMove(input, 0, 0);
    until(m, input, () => w.controllerId === id, 1);
    const b = input.buttons[btn];
    let t = 0;
    const kicked = () => Math.hypot(w.ball.vel.x, w.ball.vel.z) > 4;
    b.down = true;
    b.pressed = true;
    b.held = 0;
    while (t < 0.08) {
      step(m, input);
      t += SIM_DT;
      b.held = t;
      if (kicked()) {
        input.passOnPress = false;
        b.down = false;
        return t;
      }
    }
    b.down = false;
    b.released = true;
    while (t < 2) {
      step(m, input);
      t += SIM_DT;
      if (kicked()) {
        input.passOnPress = false;
        return t;
      }
    }
    input.passOnPress = false;
    return t;
  };
  const passTapLatency = action('pass');
  const passPressLatency = action('pass', true);
  const shotTapLatency = action('shoot');
  isolate(m, id, false);
  setMove(input, 0, 0);
  input.buttons.tackle.down = true;
  input.buttons.tackle.pressed = true;
  const tackleLatency = until(m, input, () => h().anim === Anim.Tackle, 1);
  input.buttons.tackle.down = false;

  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    firstMoveSteps,
    runUp90: r(runUp90),
    sprintUp90: r(sprintUp90),
    runToSprint90: r(runToSprint90),
    stopRunDist: r(stopRunDist),
    stopRunTime: r(stopRunTime),
    stopSprintDist: r(stopSprintDist),
    stopSprintTime: r(stopSprintTime),
    turn90Run: r(turn90Run),
    reverseRun: r(reverseRun),
    reverseSprint: r(reverseSprint),
    shuffleReverse: r(shuffleReverse),
    dribbleTurn90: r(dribbleTurn90),
    dribbleKept,
    dribbleReverse: r(dribbleReverse),
    dribbleReverseKept,
    passTapLatency: r(passTapLatency),
    passPressLatency: r(passPressLatency),
    shotTapLatency: r(shotTapLatency),
    tackleLatency: r(tackleLatency),
  };
}
