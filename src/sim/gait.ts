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
 * Gait: how fast a running player's legs cycle at a given speed.
 *
 * A footballer's planted foot doesn't move over the grass. For that to look true on screen, the
 * legs must cycle at exactly the rate where one full stride (left step + right step) covers the
 * distance the player travels: cadence = speed ÷ stride length. Get it wrong and the feet "skate"
 * (legs too slow) or "moonwalk" (legs too fast).
 *
 * The simulation owns the gait phase, because dribble touches are timed to the feet
 * (`touchFoot` in `world.ts`). The renderer blends its idle, walk, jog and sprint clips with the
 * same {@link gaitWeights}, so the legs on screen are the ones the simulation timed the touches to.
 * The stride lengths below were measured from those clips; `tests/gait.test.ts` re-measures the
 * clip files and fails if they drift apart.
 *
 * Everything here is pure and deterministic: no randomness, no allocation per call.
 */

/**
 * Speeds (m/s) at which each style plays on its own: idle, walk, jog, sprint. Between two keys the
 * styles blend linearly. The walk and jog keys sit near the speeds the clips were animated for
 * (about 1.0 and 5.1 m/s), so neither is played far from its natural tempo.
 */
export const GAIT_KEYS = [0.15, 1.3, 4.6, 7.8] as const;

/**
 * Distance covered by one full stride cycle (two steps), in metres, for each style in
 * {@link GAIT_KEYS}. Measured from how far the planted foot travels backwards per cycle in each clip.
 * Idle has no stride; it uses the walk value so cadence fades smoothly to a stop.
 */
export const STRIDE_LENGTH = [1.3, 1.3, 4.8, 5.2] as const;

/** Below this speed (m/s) the legs stop cycling and the player stands. */
export const GAIT_MIN_SPEED = GAIT_KEYS[0];

/**
 * Blend weights for idle / walk / jog / sprint at a speed, written into `out` (which is returned).
 * Weights are non-negative and sum to 1.
 * @param speed Ground speed in m/s.
 */
export function gaitWeights(speed: number, out: [number, number, number, number]): [number, number, number, number] {
  out[0] = out[1] = out[2] = out[3] = 0;
  if (speed <= GAIT_KEYS[0]) out[0] = 1;
  else if (speed >= GAIT_KEYS[3]) out[3] = 1;
  else {
    let i = 0;
    while (speed > GAIT_KEYS[i + 1]) i++;
    const f = (speed - GAIT_KEYS[i]) / (GAIT_KEYS[i + 1] - GAIT_KEYS[i]);
    out[i] = 1 - f;
    out[i + 1] = f;
  }
  return out;
}

const scratch: [number, number, number, number] = [0, 0, 0, 0];

/** Stride length (metres per full cycle) of the blended gait at a speed in m/s. */
export function strideLength(speed: number): number {
  const w = gaitWeights(speed, scratch);
  return w[0] * STRIDE_LENGTH[0] + w[1] * STRIDE_LENGTH[1] + w[2] * STRIDE_LENGTH[2] + w[3] * STRIDE_LENGTH[3];
}

/**
 * Full stride cycles per second at a speed (m/s), chosen so the planted foot stays still on the
 * grass. Zero below {@link GAIT_MIN_SPEED}. About 1.0 Hz walking, 1.0 Hz jogging (longer strides),
 * 1.5 Hz sprinting.
 */
export function cadence(speed: number): number {
  return speed > GAIT_MIN_SPEED ? speed / strideLength(speed) : 0;
}
