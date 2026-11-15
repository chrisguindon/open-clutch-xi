/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { describe, expect, it } from 'vitest';
import { Ball, BallContact, groundPassSpeed, groundTravelTime, predictBall } from '../src/sim/ball';
import { BALL, PITCHES, SIM_DT } from '../src/sim/config';
import { Vec3 } from '../src/core/math';

const pitch = PITCHES['5v5'];

function run(ball: Ball, seconds: number, contacts?: BallContact[]) {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) ball.step(SIM_DT, contacts);
}

describe('ball physics', () => {
  it('falls under gravity, bounces with energy loss and comes to rest', () => {
    const b = new Ball(pitch);
    b.reset(0, 0, 3);
    const contacts: BallContact[] = [];
    run(b, 0.5, contacts);
    expect(b.pos.y).toBeLessThan(3);
    run(b, 6, contacts);
    const bounces = contacts.filter((c) => c.type === 'bounce');
    expect(bounces.length).toBeGreaterThan(1);
    // Each bounce weaker than the previous.
    for (let i = 1; i < bounces.length; i++) expect(bounces[i].strength).toBeLessThan(bounces[i - 1].strength);
    expect(b.pos.y).toBeCloseTo(BALL.radius, 3);
    expect(b.grounded).toBe(true);
  });

  it('rolls to a stop due to friction', () => {
    const b = new Ball(pitch);
    b.reset(-20, 0);
    b.vel.set(10, 0, 0);
    run(b, 10);
    expect(b.speed).toBeLessThan(0.01);
    expect(b.pos.x).toBeGreaterThan(-20 + 10);
    expect(b.pos.x).toBeLessThan(-20 + 40);
  });

  it('groundPassSpeed delivers the ball the requested distance', () => {
    for (const dist of [6, 12, 20, 30]) {
      const v0 = groundPassSpeed(dist, 4);
      const b = new Ball(pitch);
      b.reset(-30, 0);
      b.vel.set(v0, 0, 0);
      // Step until speed drops to the target end speed.
      let t = 0;
      while (b.speed > 4 && t < 10) {
        b.step(SIM_DT);
        t += SIM_DT;
      }
      expect(Math.abs(b.pos.x - (-30 + dist))).toBeLessThan(0.5);
      const tt = groundTravelTime(v0, dist);
      expect(Math.abs(tt - t)).toBeLessThan(0.1);
    }
  });

  it('sidespin curls the ball (Magnus effect)', () => {
    const straight = new Ball(pitch);
    straight.reset(0, 0, 1);
    straight.vel.set(25, 5, 0);
    const curled = new Ball(pitch);
    curled.reset(0, 0, 1);
    curled.vel.set(25, 5, 0);
    curled.spin.set(0, 30, 0);
    run(straight, 0.8);
    run(curled, 0.8);
    expect(Math.abs(straight.pos.z)).toBeLessThan(0.01);
    expect(Math.abs(curled.pos.z)).toBeGreaterThan(0.8);
  });

  it('topspin makes the ball dip compared to no spin', () => {
    const a = new Ball(pitch);
    a.reset(0, 0, 0.2);
    a.vel.set(25, 6, 0);
    const b = new Ball(pitch);
    b.reset(0, 0, 0.2);
    b.vel.set(25, 6, 0);
    b.spin.set(0, 0, -20); // forward rotation about -z when moving +x
    run(a, 0.5);
    run(b, 0.5);
    expect(b.pos.y).toBeLessThan(a.pos.y);
  });

  it('rebounds off the goal post', () => {
    const b = new Ball(pitch);
    const L2 = pitch.length / 2,
      gw = pitch.goalWidth / 2;
    b.reset(L2 - 5, gw, 1);
    b.vel.set(20, 0, 0);
    const contacts: BallContact[] = [];
    run(b, 0.6, contacts);
    expect(contacts.some((c) => c.type === 'post')).toBe(true);
    expect(b.vel.x).toBeLessThan(0);
  });

  it('is stopped by the net after crossing the goal line', () => {
    const b = new Ball(pitch);
    const L2 = pitch.length / 2;
    b.reset(L2 - 6, 0.5, 0.8);
    b.vel.set(28, 0, 0.5);
    const contacts: BallContact[] = [];
    run(b, 2, contacts);
    expect(contacts.some((c) => c.type === 'net')).toBe(true);
    expect(b.pos.x).toBeGreaterThan(L2);
    expect(b.pos.x).toBeLessThan(L2 + pitch.goalDepth);
    expect(b.speed).toBeLessThan(3);
  });

  it('predictor matches the simulation closely for free flight', () => {
    const b = new Ball(pitch);
    b.reset(-10, 0, 0.5);
    b.vel.set(15, 6, 3);
    b.spin.set(0, 10, 0);
    const out = new Float32Array(30 * 3);
    predictBall(b.pos, b.vel, b.spin, 30, 0.05, out);
    run(b, 1.0);
    const i = 19; // t = 1.0s
    const p = new Vec3(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    expect(p.distanceTo(b.pos)).toBeLessThan(0.4);
  });
});
