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
import { CameraRig, CAMERA_TUNING_DEFAULTS } from '../src/render/camera';
import { PITCHES } from '../src/sim/config';
// Scripted play: dribble 5 m/s → 20 m/s pass → receiver dribble → 28 m/s shot; player switch at the pass.
function ballAt(t: number): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const p = new THREE.Vector3(),
    v = new THREE.Vector3();
  const focus = new THREE.Vector3();
  if (t < 2) {
    p.set(-15 + 5 * t, 0.11, -4);
    v.set(5, 0, 0);
    focus.copy(p);
  } else if (t < 3.2) {
    const u = t - 2;
    p.set(-5 + 16 * u, 0.11, -4 + 8 * u);
    v.set(16, 0, 8);
    focus.set(14, 0, 6);
  } else if (t < 5) {
    const u = t - 3.2;
    p.set(14.2 + 4.5 * u, 0.11, 5.6 - 1 * u);
    v.set(4.5, 0, -1);
    focus.copy(p);
  } else if (t < 5.6) {
    const u = t - 5;
    p.set(22.3 + 26 * u, 0.11 + 3 * u, 3.8 - 6 * u);
    v.set(26, 3, -6);
    focus.set(22, 0, 3.8);
  } else {
    p.set(33, 1.9, 0.2);
    v.set(0, 0, 0);
    focus.set(24, 0, 3);
  }
  return [p, v, focus];
}

function evaluate(mode: 'broadcast' | 'dynamic') {
  const cam = new CameraRig(PITCHES['5v5'], 16 / 9);
  cam.setPitch(PITCHES['5v5']);
  Object.assign(cam.tune, CAMERA_TUNING_DEFAULTS);
  cam.mode = mode;
  const players = [new THREE.Vector3(-8, 0, 2), new THREE.Vector3(5, 0, -6), new THREE.Vector3(10, 0, 8)];
  let t = 0;
  const dt = 1 / 60;
  cam.cut();
  let maxNdc = 0,
    jerk = 0;
  const lastV = new THREE.Vector3(),
    lastA = new THREE.Vector3(),
    lastP = new THREE.Vector3();
  while (t < 6.5) {
    t += dt;
    const [b, v, f] = ballAt(t);
    cam.update(dt, { ball: b, ballVel: v, focus: f, attackDir: 1, players });
    const cp = cam.camera.position;
    if (t > 0.5) {
      cam.camera.updateMatrixWorld();
      const s = b.clone().project(cam.camera);
      maxNdc = Math.max(maxNdc, Math.abs(s.x), Math.abs(s.y));
      const vv = cp.clone().sub(lastP).divideScalar(dt),
        aa = vv.clone().sub(lastV).divideScalar(dt);
      if (t > 0.6) jerk += aa.clone().sub(lastA).length() * dt;
      lastA.copy(aa);
      lastV.copy(vv);
    }
    lastP.copy(cp);
  }
  return { maxNdc, jerk };
}

describe('camera follows passes, shots and player switches smoothly', () => {
  // Earlier baseline: the dynamic camera lost the ball off-screen (|ndc| 1.57) with jerk ≈106 on a pass + switch.
  for (const mode of ['broadcast', 'dynamic'] as const) {
    it(`${mode}: ball stays well inside the frame and motion is smooth`, () => {
      const r = evaluate(mode);
      expect(r.maxNdc).toBeLessThan(0.7);
      expect(r.jerk).toBeLessThan(15);
    });
  }
});
