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
 * The game's identity, in one place. Nothing else in the code should spell out the name:
 * the UI, the stadium boards, file names of exports and the default HTML metadata (through vite.config.ts
 * and src/siteMeta.ts) all read it from here. Where a particular site is hosted is not part of the brand:
 * hosts set it with the SITE_URL build variable or by replacing the page's metadata block.
 * Renaming the game means editing this file, `package.json`, the logo assets and the
 * docs — not hunting through the source.
 *
 * Deliberately **not** derived from the brand: saved-data keys (src/game/storage.ts) and achievement ids.
 * They must survive a rename, or players would lose their settings and progress.
 *
 * Plain constants only (no browser or Vite globals), because vite.config.ts imports this file in Node.
 */
export const BRAND = {
  /** The canonical display name. */
  name: 'Open Clutch XI',
  /**
   * The logo's two lines, for layouts that need a shorter arrangement: the name is split, never changed.
   * The second line is the emphasised "XI" (football's starting eleven).
   */
  logoLines: ['Open Clutch', 'XI'] as const,
  /** Short line under the logo. */
  tagline: 'Free 3D football in your browser',
  /** One-sentence description for metadata and link previews. */
  description: 'A free, open-source 3D football game for the browser. Pick a national team and play — no download, no account.',
  maintainer: 'Christopher Guindon',
  maintainerUrl: 'https://www.chrisguindon.com/about/',
  contact: 'info@chrisguindon.com',
  /** Prefix for files the game lets players download (exports, diagnostics). Lowercase, no spaces. */
  filePrefix: 'open-clutch-xi',
  /** Text on the stadium's advertising boards. */
  boardText: 'OPEN CLUTCH XI',
} as const;
