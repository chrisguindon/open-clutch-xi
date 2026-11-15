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
import * as THREE from 'three';
import { CameraRig, INTRO_LENGTH } from '../src/render/camera';
import { PITCHES } from '../src/sim/config';

const DT = 1 / 60;
function rig(format: '5v5' | '11v11' = '5v5') {
  const c = new CameraRig(PITCHES[format], 16 / 9);
  c.setPitch(PITCHES[format]);
  return c;
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('camera presentation guarantees', () => {
  it('never places a low cinematic camera inside a player', () => {
    const c = rig();
    const scorer = v(10, 0, 2);
    // Team-mates crowd around the scorer on the orbit radius.
    const players: THREE.Vector3[] = [scorer];
    for (let k = 0; k < 10; k++) players.push(v(10 + Math.sin(k * 0.63) * 5.4, 0, 2 + Math.cos(k * 0.63) * 5.4));
    c.cinematic = { kind: 'celebrate', t: 0 };
    c.cut();
    for (let i = 0; i < 600; i++) {
      c.update(DT, { ball: v(12, 0.11, 0), ballVel: v(0, 0, 0), focus: null, attackDir: 1, subject: scorer, players });
      const p = c.camera.position;
      if (p.y < 2.2) for (const q of players) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(0.85);
    }
  });

  it('rises above a player who hides the ball from a low camera', () => {
    const c = rig();
    const ball = v(20, 0.11, 0);
    c.cinematic = { kind: 'penShoot' }; // low camera behind the penalty taker
    c.cut();
    const free = { ball, ballVel: v(0, 0, 0), focus: null, attackDir: 1, players: [] as THREE.Vector3[] };
    for (let i = 0; i < 120; i++) c.update(DT, free);
    const baseY = c.camera.position.y;
    // Put a defender on the camera→ball line.
    const cp = c.camera.position.clone();
    const blocker = cp.clone().lerp(ball, 0.5).setY(0);
    for (let i = 0; i < 240; i++) c.update(DT, { ...free, players: [blocker] });
    expect(c.camera.position.y).toBeGreaterThan(baseY + 1.2);
  });

  it('keeps broadcast zoom bounded and widens for spread-out play', () => {
    const c = rig();
    const ball = v(0, 0.11, 0);
    const compact = [v(1, 0, 1), v(-1, 0, 0), v(2, 0, -1), v(0, 0, 2)];
    const wide = [v(-20, 0, 0), v(20, 0, 0), v(0, 0, 5), v(10, 0, -5)];
    c.cut();
    for (let i = 0; i < 600; i++) c.update(DT, { ball, ballVel: v(0, 0, 0), focus: null, attackDir: 1, players: compact });
    const tight = c.camera.fov;
    for (let i = 0; i < 600; i++) c.update(DT, { ball, ballVel: v(0, 0, 0), focus: null, attackDir: 1, players: wide });
    expect(c.camera.fov).toBeGreaterThan(tight + 3);
    expect(tight).toBeGreaterThanOrEqual(29);
    expect(c.camera.fov).toBeLessThanOrEqual(40);
  });

  it('runs the intro line-up shot then lands on the broadcast position', () => {
    const c = rig();
    const lineup = [v(-8, 0, -6), v(-14, 0, 4), v(-4, 0, 3), v(-20, 0, 0)];
    c.cinematic = { kind: 'intro', t: 0 };
    c.cut();
    let minY = Infinity;
    for (let t = 0; t < INTRO_LENGTH; t += DT) {
      c.update(DT, { ball: v(0, 0.11, 0), ballVel: v(0, 0, 0), focus: null, attackDir: 1, lineup, players: lineup });
      if (t < 2.5) minY = Math.min(minY, c.camera.position.y);
    }
    expect(minY).toBeLessThan(2.5); // low, player-height shot
    expect(c.camera.position.y).toBeGreaterThan(8); // ended high on the broadcast gantry
  });
});
