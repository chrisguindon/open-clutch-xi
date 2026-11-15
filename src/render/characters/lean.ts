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
 * Body lean: how far a running footballer tilts when speeding up, braking and turning.
 *
 * A runner who changes velocity must lean into the change or fall over: the push from the ground
 * has to pass through the body's centre of mass. Physics gives the angle as atan(a / g), for an
 * acceleration a. Footballers visibly lean forward to burst away, sit back to stop, and bank into
 * a curved run. The recorded clips only know running in a straight line at a steady speed, so this
 * small layer adds the lean from the simulated acceleration ({@link PoseInput.accFwd},
 * `accLat`). The simulation decides the motion; this only shows it.
 *
 * Pure and allocation-free: results are written into a caller-owned object.
 */

/** Gravity, m/s². */
const G = 9.81;

/**
 * Share of the physical lean angle shown. Clips already lean a little, and the simulation's turns
 * are sharper than real ones, so the full angle looks exaggerated.
 */
export const LEAN_SHARE = { forward: 0.35, side: 0.55 } as const;

/** Largest lean shown, radians: forward 0.2 (≈11°), back 0.18, sideways 0.3 (≈17°). */
export const LEAN_LIMIT = { forward: 0.2, back: 0.18, side: 0.3 } as const;

/** Speed (m/s) at which sideways lean reaches full strength: walkers turn on the spot, not bank. */
export const BANK_FULL_SPEED = 4;

/** Lean angles in radians. `pitch` > 0 tilts forward; `roll` > 0 tilts towards the model's left. */
export interface Lean {
  pitch: number;
  roll: number;
}

/**
 * Target lean for an acceleration, written into `out` (which is returned).
 * @param accFwd Forward acceleration, m/s² (negative when braking).
 * @param accLat Lateral acceleration, m/s² (positive towards the model's left).
 * @param speed Ground speed, m/s.
 */
export function bodyLean(accFwd: number, accLat: number, speed: number, out: Lean): Lean {
  const pitch = Math.atan(accFwd / G) * LEAN_SHARE.forward;
  out.pitch = Math.max(-LEAN_LIMIT.back, Math.min(LEAN_LIMIT.forward, pitch));
  const bank = Math.min(1, speed / BANK_FULL_SPEED);
  const roll = Math.atan(accLat / G) * LEAN_SHARE.side * bank;
  out.roll = Math.max(-LEAN_LIMIT.side, Math.min(LEAN_LIMIT.side, roll));
  return out;
}
