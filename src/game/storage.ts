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
 * Local-first persistence: the one place that touches `localStorage`.
 *
 * Everything the game remembers lives in the player's own browser. Nothing is sent anywhere (see
 * docs/architecture/persistence.md). Callers own their data shape, version and migrations. This module
 * only gives them three guarantees:
 *
 * - **Storage can be missing.** Private windows, blocked site data and some embedded browsers throw on
 *   any `localStorage` access. We fall back to an in-memory store, so the game still works for the
 *   session; it just won't remember anything afterwards.
 * - **Corrupt data never crashes the game.** Unparseable JSON is treated as "nothing saved". The raw
 *   text is kept once under `<key>:corrupt`, so a player (or a bug report) can still recover it.
 * - **Every key is listed.** {@link STORAGE_KEYS} names everything the game may write, so a future
 *   "reset all data" or export can't miss one.
 */

/** Every key the game writes. Keep the `-vN` suffix: it changes only for a migration-free fresh start. */
export const STORAGE_KEYS = {
  /**
   * Settings. The key's original name is kept on purpose: it is an
   * identifier, not branding, and changing it would reset every returning player's settings.
   */
  settings: 'floodlight-fc-settings-v1',
  /** Statistics, match history and achievements (src/game/progress.ts). Brand-neutral by design. */
  progress: 'player-progress-v1',
  /** The XI Nations Cup in progress and past cups (src/game/tournament/record.ts). Brand-neutral by design. */
  tournament: 'tournament-v1',
  /** Movement-lab tuning (developer tool, `?lab`). */
  devTuning: 'floodlight-fc-tuning-v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** The subset of the Web Storage API we use, so tests and the memory fallback can stand in for it. */
interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();
const memoryStore: KeyValueStore = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

/**
 * The live backend, looked up on every call rather than cached: tests replace `localStorage`, and a
 * browser can start refusing storage mid-session (quota, settings change).
 */
function backend(): KeyValueStore {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    return ls ?? memoryStore;
  } catch {
    return memoryStore; // merely reading `localStorage` throws when site data is blocked
  }
}

/** True when a value was saved under `key` before (used to tell a first launch from a returning player). */
export function hasStored(key: StorageKey): boolean {
  try {
    return backend().getItem(key) !== null;
  } catch {
    return memoryStore.getItem(key) !== null;
  }
}

/**
 * Read and parse a stored JSON value. Returns `undefined` when nothing is saved, storage is unavailable,
 * or the text is corrupt. The result is `unknown` on purpose: callers must validate it before trusting
 * it, because players (and older versions of the game) can leave anything there.
 */
export function readJson(key: StorageKey): unknown {
  let raw: string | null;
  try {
    raw = backend().getItem(key);
  } catch {
    raw = memoryStore.getItem(key);
  }
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    keepCorruptCopy(key, raw);
    return undefined;
  }
}

/** Save a value as JSON. Returns false when it couldn't be persisted (it's then kept for this session only). */
export function writeJson(key: StorageKey, value: unknown): boolean {
  const text = JSON.stringify(value);
  try {
    backend().setItem(key, text);
    return true;
  } catch {
    memoryStore.setItem(key, text); // quota exceeded or storage blocked: remember it until the tab closes
    return false;
  }
}

/** Forget a stored value. */
export function remove(key: StorageKey): void {
  memoryStore.removeItem(key);
  try {
    backend().removeItem(key);
  } catch {
    /* storage unavailable: nothing persisted to remove */
  }
}

/**
 * Keep the stored text of `key` as a recovery copy before the game replaces it with fresh data, for
 * records that parsed as JSON but failed validation (wrong shape, from a newer version, hand-edited).
 */
export function keepRecoveryCopy(key: StorageKey): void {
  try {
    const raw = backend().getItem(key);
    if (raw !== null) keepCorruptCopy(key, raw);
  } catch {
    /* storage unavailable: nothing to keep */
  }
}

/** Forget a value *and* its recovery copy (used by the player-facing resets: nothing is left behind). */
export function forget(key: StorageKey): void {
  remove(key);
  try {
    backend().removeItem(`${key}:corrupt`);
  } catch {
    /* storage unavailable: nothing persisted */
  }
}

function keepCorruptCopy(key: StorageKey, raw: string): void {
  try {
    const store = backend();
    // Keep the first corrupt copy only, so a later bad write can't overwrite the evidence.
    if (store.getItem(`${key}:corrupt`) === null) store.setItem(`${key}:corrupt`, raw);
  } catch {
    /* best effort */
  }
}

/** A plain JSON object (not null, not an array): the shape every stored record must have. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
