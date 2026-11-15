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
 * Export, import and reset of everything the game saves, so players own their data: they can back it
 * up, move it to another browser by hand, or wipe it. No server is involved.
 *
 * The export file is plain JSON (documented in docs/architecture/persistence.md):
 *
 * ```json
 * { "format": "football-game-save", "version": 1, "exportedAt": "2026-11-15T10:00:00.000Z",
 *   "data": { "settings": { … }, "progress": { … } } }
 * ```
 *
 * Imports are treated as untrusted input: size-limited, parsed as JSON only (never evaluated), checked
 * field by field, and applied all-or-nothing. The `format` string is deliberately brand-neutral so files
 * keep importing after a rename.
 */
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings';
import { parseProgress, type PlayerProgress } from './progress';
import { STORAGE_KEYS, forget, isRecord, readJson, writeJson } from './storage';

/** Identifies an export file. Brand-neutral and permanent, so files from before a rename still import. */
export const SAVE_FORMAT = 'football-game-save';
/** Export file version. A newer file is refused with a clear message rather than misread. */
export const SAVE_VERSION = 1;
/** Real exports are a few kilobytes; anything near this is not a save file. */
export const MAX_IMPORT_BYTES = 256 * 1024;

/** The export file's shape (see the module comment for an example). */
export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_VERSION;
  exportedAt: string;
  data: { settings?: Partial<Settings>; progress?: PlayerProgress };
}

/** The current saved data as an export file (pretty-printed so people can read it). */
export function exportSaveData(now = new Date()): string {
  const file: SaveFile = { format: SAVE_FORMAT, version: SAVE_VERSION, exportedAt: now.toISOString(), data: {} };
  const settings = readJson(STORAGE_KEYS.settings);
  if (isRecord(settings)) file.data.settings = sanitizeSettings(settings);
  const progress = parseProgress(readJson(STORAGE_KEYS.progress));
  if (progress) file.data.progress = progress;
  return JSON.stringify(file, null, 2);
}

/** A checked import file and a summary to confirm, or a reason it was refused. */
export type ImportResult = { ok: true; file: SaveFile; summary: string } | { ok: false; error: string };

/**
 * Check an import file without applying it. Rejects (with a message a player can understand) anything
 * too big, not JSON, of another format, from a newer version, or with invalid contents.
 */
export function readSaveFile(text: string): ImportResult {
  if (new Blob([text]).size > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too large to be a saved-data file.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn’t a saved-data file (it isn’t valid JSON).' };
  }
  if (!isRecord(raw) || raw.format !== SAVE_FORMAT) return { ok: false, error: 'That file isn’t a saved-data file from this game.' };
  if (typeof raw.version !== 'number' || raw.version > SAVE_VERSION) return { ok: false, error: 'That file comes from a newer version of the game.' };
  if (raw.version !== SAVE_VERSION || !isRecord(raw.data)) return { ok: false, error: 'That saved-data file is damaged.' };
  const known = new Set(['settings', 'progress']);
  if (Object.keys(raw.data).some((k) => !known.has(k))) return { ok: false, error: 'That saved-data file contains unexpected data.' };
  const file: SaveFile = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : '',
    data: {},
  };
  if (raw.data.settings !== undefined) {
    if (!isRecord(raw.data.settings)) return { ok: false, error: 'The settings in that file are damaged.' };
    // Settings are sanitised field by field (an unusable value falls back to its default), exactly as
    // when they are loaded from storage.
    file.data.settings = sanitizeSettings(raw.data.settings);
  }
  if (raw.data.progress !== undefined) {
    const progress = parseProgress(raw.data.progress);
    if (!progress) return { ok: false, error: 'The statistics and achievements in that file are damaged.' };
    file.data.progress = progress;
  }
  if (!file.data.settings && !file.data.progress) return { ok: false, error: 'That saved-data file is empty.' };
  const p = file.data.progress;
  const summary = [
    file.data.settings ? 'settings' : null,
    p
      ? `${p.stats.played} match${p.stats.played === 1 ? '' : 'es'} and ${Object.keys(p.achievements).length} achievement${Object.keys(p.achievements).length === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(' and ');
  return { ok: true, file, summary };
}

/** Apply a checked file (from {@link readSaveFile}): replaces what it contains, keeps the rest. */
export function applySaveFile(file: SaveFile): void {
  if (file.data.settings) writeJson(STORAGE_KEYS.settings, { ...structuredClone(DEFAULT_SETTINGS), ...file.data.settings });
  if (file.data.progress) writeJson(STORAGE_KEYS.progress, file.data.progress);
}

/** Forget statistics, match history and achievements (settings stay). */
export function resetProgress(): void {
  forget(STORAGE_KEYS.progress);
}

/** Forget everything the game has saved in this browser: settings, progress, developer tuning and recovery copies. */
export function resetAllData(): void {
  for (const key of Object.values(STORAGE_KEYS)) forget(key);
}
