/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { Match } from '../src/sim/match';
import { InputFrame } from '../src/sim/human';

/**
 * A scripted "player" that drives the tutorial with ordinary inputs only (stick, buttons) — no
 * teleports or state edits. It reads the game state like a person would look at the screen.
 */
export class TutorialBot {
  private hold = 0;
  private holding: 'shoot' | 'pass' | null = null;
  private cool = 0;
  constructor(private m: Match) {}

  act(stepTitle: string, input: InputFrame, dt: number): void {
    const m = this.m,
      w = m.world,
      h = m.human;
    for (const k of Object.keys(input.buttons) as Array<keyof InputFrame['buttons']>) {
      input.buttons[k].down = false;
    }
    input.move.x = 0;
    input.move.z = 0;
    input.sprint = false;
    if (!h) return;
    this.cool = Math.max(0, this.cool - dt);
    const ball = w.ball;
    const dir = w.attackDir(0);
    const goalX = (dir * w.pitch.length) / 2;
    const hasBall = w.controllerId === h.id;
    const toward = (x: number, z: number) => {
      const dx = x - h.pos.x,
        dz = z - h.pos.z,
        l = Math.hypot(dx, dz) || 1;
      input.move.x = dx / l;
      input.move.z = dz / l;
    };
    // Holding a charge?
    if (this.holding) {
      const b = input.buttons[this.holding];
      this.hold += dt;
      if (this.hold < 0.35) {
        b.down = true;
        b.held = this.hold;
        if (this.holding === 'shoot') toward(goalX, Math.sign(h.pos.z || 1) * -2);
        return;
      }
      b.down = false;
      b.released = true;
      b.held = this.hold;
      this.holding = null;
      this.cool = 0.6;
      return;
    }
    if (!hasBall) {
      toward(ball.pos.x, ball.pos.z);
      return;
    }
    const press = (k: 'pass' | 'shoot' | 'skill') => {
      const b = input.buttons[k];
      b.down = true;
      b.pressed = true;
      if (k !== 'skill') {
        this.holding = k;
        this.hold = 0;
      }
      this.cool = 0.6;
    };
    if (/Movement/.test(stepTitle)) {
      toward(h.pos.x + dir * 5, 0);
      return;
    }
    if (/Sprint/.test(stepTitle)) {
      toward(h.pos.x + dir * 5, 0);
      input.sprint = true;
      return;
    }
    if (/Passing/.test(stepTitle)) {
      const mate = w.players.filter((p) => p.team === 0 && p.id !== h.id && !p.isGK).sort((a, b) => a.pos.distanceTo(h.pos) - b.pos.distanceTo(h.pos))[0];
      if (mate) toward(mate.pos.x, mate.pos.z);
      if (this.cool <= 0) press('pass');
      return;
    }
    if (/Shoot|Score/.test(stepTitle)) {
      const dGoal = Math.abs(goalX - h.pos.x);
      toward(goalX, 0);
      if (dGoal < 18 && this.cool <= 0) press('shoot');
      return;
    }
    if (/Skill/.test(stepTitle)) {
      toward(h.pos.x + dir * 5, 2);
      if (this.cool <= 0) press('skill');
      return;
    }
    toward(h.pos.x + dir * 5, 0);
  }
}
