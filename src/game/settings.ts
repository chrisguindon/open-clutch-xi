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
 * Player settings: their shape and defaults, control schemes and bindings, first-launch device
 * profiles, and loading saved settings with **migrations**. Saved data may come from any older
 * version of the game, so `loadSettings` upgrades it step by step and never throws away a player's
 * own choices. Change the format only with a test in tests/settings-migration.test.ts. Storage
 * itself (and what happens when it's unavailable or corrupt) is in src/game/storage.ts.
 */

import { defaultHomeCode } from '../sim/nations';
import { Difficulty, MatchFormat } from '../sim/config';
import type { TimeOfDay } from '../render/stadium';
import type { SquadMix } from '../render/characters/squad';
import { STORAGE_KEYS, hasStored, isRecord, readJson, writeJson } from './storage';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type CameraMode = 'broadcast' | 'dynamic' | 'tactical';

export type KeyAction =
  'up' | 'down' | 'left' | 'right' | 'sprint' | 'shoot' | 'pass' | 'through' | 'lob' | 'tackle' | 'switch' | 'skill' | 'pause' | 'camera' | 'reset';

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  sprint: 'Sprint',
  pass: 'Pass · Standing tackle',
  shoot: 'Shoot · Slide tackle',
  through: 'Through ball · Switch player',
  lob: 'Lob / cross · Jockey',
  skill: 'Skill move',
  switch: 'Switch player',
  tackle: 'Tackle (extra key)',
  pause: 'Pause',
  camera: 'Cycle camera',
  reset: 'Reset ball (practice)',
};

/** What each action does, shown next to the binding (attacking · defending). */
export const KEY_ACTION_HELP: Record<KeyAction, string> = {
  up: 'Movement is relative to the camera.',
  down: '',
  left: '',
  right: '',
  sprint: 'Hold while moving. Sprinting knocks the ball further ahead.',
  pass: 'Attacking: pass to the team-mate you are facing. Defending: standing tackle.',
  shoot: 'Attacking: shoot (Advanced: hold for power). Defending: slide tackle.',
  through: 'Attacking: pass into space ahead of a runner. Defending: switch to the best-placed player.',
  lob: 'Attacking: lofted pass or cross. Defending: hold to jockey (contain without diving in).',
  skill: 'With a direction: cut and burst; backwards for a drag-back.',
  switch: 'Switch to the player nearest the ball.',
  tackle: 'Standing tackle; with Sprint held, a slide tackle.',
  pause: '',
  camera: 'Broadcast · Dynamic · Tactical',
  reset: 'Practice only: bring the ball back.',
};

/** Defaults: the most frequent action (pass) on the thumb, the rest on adjacent home-row keys. */
export const DEFAULT_BINDINGS: Record<KeyAction, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  pass: ['Space'],
  shoot: ['KeyJ'],
  through: ['KeyK'],
  lob: ['KeyL'],
  skill: ['KeyE'],
  switch: ['KeyQ'],
  tackle: ['KeyF'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC'],
  reset: ['KeyR'],
};

/**
 * Keyboard & mouse defaults. Mouse buttons are binding codes like keys: Mouse0 = left,
 * Mouse1 = middle, Mouse2 = right, Mouse3/4 = back/forward side buttons. The middle button is never the
 * only way to do something (through ball is also on Q).
 */
export const DEFAULT_KBM_BINDINGS: Record<KeyAction, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Mouse0'],
  pass: ['Mouse2'],
  through: ['KeyQ', 'Mouse1'], // Q first: hints show the first binding, and the middle button is never required
  lob: ['Space'],
  switch: ['KeyE'],
  skill: ['KeyF'],
  tackle: ['KeyX'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC'],
  reset: ['KeyR'],
};

/** Controller actions that can be remapped (Standard Gamepad button indices). */
export type PadAction = 'pass' | 'shoot' | 'lob' | 'through' | 'switch' | 'skill' | 'tackle' | 'sprint';
export const PAD_ACTION_LABELS: Record<PadAction, string> = {
  pass: 'Pass · Standing tackle',
  shoot: 'Shoot · Slide tackle',
  lob: 'Lob / cross · Jockey',
  through: 'Through ball · Switch player',
  switch: 'Switch player',
  skill: 'Skill move',
  tackle: 'Tackle',
  sprint: 'Sprint',
};
export const DEFAULT_PAD_BINDINGS: Record<PadAction, number[]> = {
  pass: [0],
  shoot: [1],
  lob: [2],
  through: [3],
  switch: [4],
  skill: [5],
  tackle: [6],
  sprint: [7],
};
/** Xbox names (PlayStation in the hint) for Standard Gamepad button indices. */
export const PAD_BUTTON_LABELS = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'View',
  'Menu',
  'L-Stick',
  'R-Stick',
  'D-Up',
  'D-Down',
  'D-Left',
  'D-Right',
  'Home',
];
export const PAD_BUTTON_LABELS_PS = [
  'Cross',
  'Circle',
  'Square',
  'Triangle',
  'L1',
  'R1',
  'L2',
  'R2',
  'Create',
  'Options',
  'L3',
  'R3',
  'D-Up',
  'D-Down',
  'D-Left',
  'D-Right',
  'PS',
];

export type ControlScheme = 'keyboard' | 'keyboardMouse' | 'controller' | 'touch';

/** The keyboard (and mouse) bindings in use for the chosen control scheme. */
export function activeBindings(s: Pick<Settings, 'controlScheme' | 'bindings' | 'kbmBindings'>): Record<KeyAction, string[]> {
  return s.controlScheme === 'keyboardMouse' ? s.kbmBindings : s.bindings;
}

/** Earlier defaults — used to detect players who never customised them (migration). */
export const LEGACY_BINDINGS_V1: Record<KeyAction, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Space'],
  pass: ['KeyJ'],
  through: ['KeyK'],
  lob: ['KeyI'],
  tackle: ['KeyL'],
  switch: ['KeyQ'],
  skill: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC'],
  reset: ['KeyR'],
};
export const BINDINGS_VERSION = 2;

export function sameBindings(a: Record<KeyAction, string[]>, b: Record<KeyAction, string[]>): boolean {
  return (Object.keys(b) as KeyAction[]).every((k) => (a[k] ?? []).join(',') === b[k].join(','));
}

/** Actions that may share a key without conflict (none — every key does one thing). */
export function bindingConflicts(bindings: Record<KeyAction, string[]>, code: string, except: KeyAction): KeyAction[] {
  return (Object.keys(bindings) as KeyAction[]).filter((a) => a !== except && bindings[a].includes(code));
}

export interface Settings {
  /**
   * 'auto' (recommended): the game picks and keeps adjusting quality for this device; `quality` holds the
   * level it last settled on (the next start-up begins there). 'manual': `quality` is the player's preset.
   */
  graphicsMode: 'auto' | 'manual';
  quality: Quality;
  /** Manual mode: allow stepping below the chosen preset when the frame rate can't be held. */
  adaptiveQuality: boolean;
  dynamicResolution: boolean;
  camera: CameraMode;
  timeOfDay: TimeOfDay;
  masterVolume: number;
  sfxVolume: number;
  crowdVolume: number;
  mouseAim: boolean;
  autoSwitch: boolean;
  minimap: boolean;
  replays: 'off' | 'best' | 'all';
  reduceMotion: boolean;
  vibration: boolean;
  /** Keyboard-only layout (also used for the controller and touch schemes' keyboard fallback). */
  bindings: Record<KeyAction, string[]>;
  /** Keyboard & mouse layout (its own set, so customising one never changes the other). */
  kbmBindings: Record<KeyAction, string[]>;
  padBindings: Record<PadAction, number[]>;
  /** How the player chose to play (first-launch screen / Settings → Controls). All devices keep working. */
  controlScheme: ControlScheme;
  /** False until the player picked (or skipped) the "How would you like to play?" screen. */
  controlsChosen: boolean;
  touchSize: 'small' | 'normal' | 'large';
  touchLeftHanded: boolean;
  format: MatchFormat;
  /** New players start on Easy; a returning player's choice is always kept. */
  difficulty: Difficulty;
  minutes: number;
  /** Team composition on screen: women, men or mixed squads. Appearance only (never gameplay). */
  squad: SquadMix;
  /** Last selected national teams (codes, e.g. 'BRA'). */
  homeTeam: string;
  awayTeam: string;
  tutorialSeen: boolean;
  /**
   * Frame-rate limit. 'balanced' renders at an even divisor of the display refresh closest to 60 Hz
   * (60 on 60/120 Hz, 72 on 144 Hz…); 'display' renders every refresh; 'saver' targets ~30 fps.
   */
  frameRate: 'auto' | 'balanced' | 'display' | 'saver';
  /** True once the player picked a frame rate themselves (otherwise defaults may be migrated). */
  frameRateChosen: boolean;
  /** On-screen touch controls: shown automatically on touch devices, or forced on/off. */
  touchControls: 'auto' | 'on' | 'off';
  /** Set once the first-launch device profile (quality/frame rate) has been applied. */
  deviceProfileApplied: boolean;
  /** 'responsive': ordinary passes fire on press. 'charged': passes fire on release, hold for power. */
  passControl: 'responsive' | 'charged';
  /**
   * 'simple': passes and shots fire on press (assisted power), contextual defending, assisted switching.
   * 'advanced': hold-to-charge shots (and passes if Passing = Charged), full manual control.
   */
  controls: 'simple' | 'advanced';
  /** Key-binding scheme version (migration). */
  bindingsVersion: number;
  /** A returning player still on the untouched pre-Phase-5 keys: offer (don't force) the new layout. */
  offerNewControls: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  graphicsMode: 'auto',
  quality: 'high',
  adaptiveQuality: true,
  dynamicResolution: true,
  camera: 'broadcast',
  timeOfDay: 'night',
  masterVolume: 0.8,
  sfxVolume: 0.9,
  crowdVolume: 0.7,
  mouseAim: false,
  autoSwitch: true,
  minimap: true,
  replays: 'best',
  reduceMotion: false,
  vibration: true,
  bindings: DEFAULT_BINDINGS,
  kbmBindings: DEFAULT_KBM_BINDINGS,
  padBindings: DEFAULT_PAD_BINDINGS,
  controlScheme: 'keyboard',
  controlsChosen: false,
  touchSize: 'normal',
  touchLeftHanded: false,
  format: '5v5',
  difficulty: 'easy',
  minutes: 4,
  squad: 'mixed',
  homeTeam: 'BRA',
  awayTeam: 'FRA',
  tutorialSeen: false,
  frameRate: 'auto',
  frameRateChosen: false,
  touchControls: 'auto',
  deviceProfileApplied: false,
  passControl: 'responsive',
  controls: 'simple',
  bindingsVersion: BINDINGS_VERSION,
  offerNewControls: false,
};

export type DeviceClass = 'mobile' | 'tablet' | 'laptop-igpu' | 'desktop';

/** Rough device classification for first-launch defaults (never overrides a player's own choices). */
export function classifyDevice(gpu: string): DeviceClass {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const minSide = Math.min(screen.width, screen.height);
  if (coarse && minSide < 600) return 'mobile';
  if (coarse) return 'tablet';
  const g = gpu.toLowerCase();
  const integrated =
    /intel|iris|uhd|hd graphics|mali|adreno|powervr|apple gpu|llvmpipe|swiftshader/.test(g) || (/radeon/.test(g) && /graphics$|vega \d+ graphics/.test(g));
  return integrated ? 'laptop-igpu' : 'desktop';
}

/** Quality / frame-rate defaults for a device class. */
export function profileFor(c: DeviceClass): Pick<Settings, 'quality' | 'frameRate' | 'dynamicResolution' | 'adaptiveQuality'> {
  switch (c) {
    case 'mobile':
      return { quality: 'low', frameRate: 'balanced', dynamicResolution: true, adaptiveQuality: true };
    case 'tablet':
      return { quality: 'low', frameRate: 'balanced', dynamicResolution: true, adaptiveQuality: true };
    case 'laptop-igpu':
      return { quality: 'medium', frameRate: 'auto', dynamicResolution: true, adaptiveQuality: true };
    default:
      return { quality: 'high', frameRate: 'auto', dynamicResolution: true, adaptiveQuality: true };
  }
}

/**
 * Keep only the stored fields whose JSON type matches the default's, and only bindings that are lists
 * of key codes or controller buttons. Saved data can be hand-edited, truncated, or written by an older
 * version, and one wrong type (say `"minutes": "four"`) must not break a match: an invalid field falls back to its
 * default instead. Migrations run on the raw record *before* this, because some old formats (the
 * boolean `replays`) are exactly the "wrong" types they convert.
 */
/**
 * String settings that must be one of a fixed set: a stored value outside the set (a typo, or a value
 * from a newer version) falls back to the default instead of reaching game code that can't handle it.
 */
const ALLOWED: Partial<Record<keyof Settings, readonly string[]>> = {
  difficulty: ['beginner', 'easy', 'medium', 'hard'],
  format: ['3v3', '5v5', '11v11'],
  squad: ['mixed', 'women', 'men'],
  timeOfDay: ['night', 'dusk', 'day'],
  quality: ['low', 'medium', 'high', 'ultra'],
  camera: ['broadcast', 'dynamic', 'tactical'],
};

const isBindingCode = (c: unknown): boolean => typeof c === 'string' || (typeof c === 'number' && Number.isInteger(c) && c >= 0);

export function sanitizeSettings(stored: Record<string, unknown>): Partial<Settings> {
  const clean: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS) as Array<[string, unknown]>) {
    const value = stored[key];
    if (value === undefined || typeof value !== typeof fallback) continue;
    const allowed = ALLOWED[key as keyof Settings];
    if (allowed && !allowed.includes(value as string)) continue;
    if (isRecord(fallback)) {
      if (!isRecord(value)) continue;
      // Bindings: action → key codes (strings) or controller buttons (numbers). Drop any other entry.
      clean[key] = Object.fromEntries(Object.entries(value).filter(([, codes]) => Array.isArray(codes) && codes.every(isBindingCode)));
    } else clean[key] = value;
  }
  return clean as Partial<Settings>;
}

export function loadSettings(): Settings {
  const stored = readJson(STORAGE_KEYS.settings);
  if (stored === undefined) return { ...structuredClone(DEFAULT_SETTINGS), homeTeam: defaultHomeCode(), awayTeam: defaultHomeCode() === 'FRA' ? 'BRA' : 'FRA' };
  if (!isRecord(stored)) return structuredClone(DEFAULT_SETTINGS);
  // Migrate the older boolean replay setting (before sanitising, which would drop it as the wrong type).
  const replays = stored.replays === true ? 'best' : stored.replays === false ? 'off' : undefined;
  const parsed = sanitizeSettings(stored);
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    // Difficulty: the default changed from Medium to Easy for *new* players. A saved record without a
    // difficulty comes from a version whose default was Medium, so it keeps Medium.
    ...(stored.difficulty === undefined ? { difficulty: 'medium' as const } : {}),
    ...parsed,
    ...(replays ? { replays } : {}),
    bindings: { ...structuredClone(DEFAULT_BINDINGS), ...(parsed.bindings ?? {}) },
    kbmBindings: { ...structuredClone(DEFAULT_KBM_BINDINGS), ...(parsed.kbmBindings ?? {}) },
    padBindings: { ...structuredClone(DEFAULT_PAD_BINDINGS), ...(parsed.padBindings ?? {}) },
    // returning players already know how they play — don't show the first-launch chooser.
    // Players who used "Mouse aiming" (left click shoots, right click passes) move to keyboard & mouse
    // with their own keys kept and those two clicks added.
    ...(!parsed.controlScheme
      ? {
          controlsChosen: true,
          controlScheme: parsed.mouseAim ? ('keyboardMouse' as const) : ('keyboard' as const),
          ...(parsed.mouseAim ? { kbmBindings: migrateMouseAim({ ...structuredClone(DEFAULT_BINDINGS), ...(parsed.bindings ?? {}) }) } : {}),
        }
      : {}),
    // returning players keep their keys (never changed silently). If they are still on the old
    // defaults, the menu offers the new layout once; customised bindings are left alone.
    ...(!parsed.bindingsVersion
      ? {
          bindingsVersion: BINDINGS_VERSION,
          offerNewControls: !!parsed.bindings && sameBindings(parsed.bindings, LEGACY_BINDINGS_V1),
          controls: 'advanced' as const, // returning players keep hold-to-charge shooting they're used to
        }
      : {}),
    // Auto graphics is the default. Players who had turned adaptive quality off chose a fixed
    // preset, so they stay on it (manual).
    ...(!parsed.graphicsMode ? { graphicsMode: parsed.adaptiveQuality === false ? ('manual' as const) : ('auto' as const) } : {}),
    // Migration: 'balanced' was the default (not a choice) and capped 240 Hz screens at 60 fps.
    ...(parsed.frameRate === 'balanced' && !parsed.frameRateChosen ? { frameRate: 'auto' as const } : {}),
  };
}

function migrateMouseAim(keys: Record<KeyAction, string[]>): Record<KeyAction, string[]> {
  const b = structuredClone(keys);
  b.shoot = ['Mouse0', ...b.shoot.filter((c) => !c.startsWith('Mouse'))];
  b.pass = ['Mouse2', ...b.pass.filter((c) => !c.startsWith('Mouse'))];
  return b;
}

/** True if the player has saved settings before (first-launch defaults must not override them). */
export function hasStoredSettings(): boolean {
  return hasStored(STORAGE_KEYS.settings);
}

/** Save settings. If storage is unavailable (private mode) they last for this session only. */
export function saveSettings(s: Settings): void {
  writeJson(STORAGE_KEYS.settings, s);
}

/** Human-readable key name for UI. */
let layoutMap: { get(code: string): string | undefined } | null = null;
/** Use the player's real keyboard layout for key names where the browser exposes it (Chromium Keyboard Map API). */
export function loadKeyboardLayout(onReady: () => void): void {
  const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<{ get(code: string): string | undefined }> } }).keyboard;
  kb?.getLayoutMap?.()
    .then((m) => {
      layoutMap = m;
      onReady();
    })
    .catch(() => undefined);
}

export function keyLabel(code: string): string {
  // Bindings use physical key positions (KeyboardEvent.code), so WASD stays in the same place on
  // AZERTY / QWERTZ / Dvorak; the label shows what is printed on the player's keyboard when known.
  const printed = layoutMap?.get(code);
  if (printed && printed.length === 1 && printed !== ' ') return printed.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    Enter: 'Enter',
    Tab: 'Tab',
    Mouse0: 'Left click',
    Mouse1: 'Middle click',
    Mouse2: 'Right click',
    Mouse3: 'Mouse back',
    Mouse4: 'Mouse forward',
  };
  return map[code] ?? code;
}
