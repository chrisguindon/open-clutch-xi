/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { KICK_TIMING, KICK_TIMING_DEFAULTS, MOVE, MOVE_DEFAULTS, MoveTuning } from '../sim/config';
import { CAMERA_TUNING_DEFAULTS, CameraTuning } from '../render/camera';
import { STORAGE_KEYS, isRecord, readJson, remove, writeJson } from '../game/storage';

/**
 * Runtime gameplay tuning (movement, kick timing, camera), adjustable in the movement lab (`?lab`)
 * without touching the source. Saved in localStorage; applied in the lab always and in normal matches
 * only when "use in matches" is ticked, so experiments never leak into play by accident.
 */
export interface StoredTuning {
  move: Partial<MoveTuning>;
  kick: Partial<typeof KICK_TIMING>;
  camera: Partial<CameraTuning>;
  useInMatches: boolean;
}

/** The lab's saved tuning, or null if none. Partial or hand-edited data is tolerated (missing groups mean defaults). */
export function loadTuning(): StoredTuning | null {
  const t = readJson(STORAGE_KEYS.devTuning);
  if (!isRecord(t)) return null;
  // Tolerate partial or hand-edited data: a missing group just means "defaults".
  const group = (v: unknown) => (isRecord(v) ? v : {});
  return { move: group(t.move), kick: group(t.kick), camera: group(t.camera), useInMatches: t.useInMatches === true };
}

/** Save the lab's tuning in this browser (src/game/storage.ts). */
export function saveTuning(t: StoredTuning): void {
  writeJson(STORAGE_KEYS.devTuning, t);
}

/** Forget the lab's tuning; the shipped defaults apply again. */
export function clearTuning(): void {
  remove(STORAGE_KEYS.devTuning);
}

/** Apply stored tuning (or defaults) to the live simulation and a camera tuning object. */
export function applyTuning(t: StoredTuning | null, camera: CameraTuning): void {
  Object.assign(MOVE, MOVE_DEFAULTS, t?.move ?? {});
  Object.assign(KICK_TIMING, KICK_TIMING_DEFAULTS, t?.kick ?? {});
  Object.assign(camera, CAMERA_TUNING_DEFAULTS, t?.camera ?? {});
}

/** Snapshot the live tuning values, ready to save. */
export function currentTuning(camera: CameraTuning, useInMatches: boolean): StoredTuning {
  return { move: { ...MOVE }, kick: { ...KICK_TIMING }, camera: { ...camera }, useInMatches };
}
