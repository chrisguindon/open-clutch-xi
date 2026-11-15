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
 * Optional, per-site presentation settings: a small `site-config.json` placed next to `index.html` by
 * whoever hosts the game. The released game ships without one and looks complete on its own.
 *
 * It lets a site add touches of its own **without rebuilding the game**:
 * - up to three extra panels on the stadium's advertising boards (plain text in the site's colours);
 * - a creator portrait for the About screen, with its alt text and a licence note.
 *
 * Example:
 * ```json
 * {
 *   "boardPanels": [{ "text": "example", "accentText": ".org", "bg": "#0b1530", "fg": "#f1f5f9", "accent": "#60a5fa" }],
 *   "creatorPortrait": { "src": "assets/site/portrait.jpg", "alt": "The site's creator", "note": "The portrait is not covered by the open-source licence." }
 * }
 * ```
 *
 * The file is untrusted input (anyone hosting the game writes it, and a missing file may come back as the
 * page itself on single-page hosts), so it's validated strictly: wrong types, long text, unknown colours
 * or paths outside `assets/` are dropped, never half-applied. It can't change gameplay, rules or saved
 * data; text is always escaped where it's shown. See docs/development/hosting.md.
 */

/** One extra board panel: `text`, then optional `accentText` in the accent colour with an underline. */
export interface BoardPanel {
  text: string;
  accentText?: string;
  bg: string;
  fg: string;
  accent?: string;
}

export interface CreatorPortrait {
  /** Path inside the site, under `assets/` (jpg, png or webp). */
  src: string;
  alt: string;
  /** Shown with the credits, for example the portrait's licence. */
  note?: string;
}

export interface SiteConfig {
  boardPanels: BoardPanel[];
  creatorPortrait: CreatorPortrait | null;
}

/** File name, relative to the page. */
export const SITE_CONFIG_FILE = 'site-config.json';
export const MAX_BOARD_PANELS = 3;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const PANEL_TEXT = /^[\p{L}\p{N} .,&'!+-]{1,24}$/u;
const ASSET = /^assets\/[a-z0-9_/-]+\.(jpe?g|png|webp)$/;

export const emptySiteConfig = (): SiteConfig => ({ boardPanels: [], creatorPortrait: null });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const shortText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Validates a parsed site-config file. Anything invalid is dropped; the result is always usable. */
export function parseSiteConfig(raw: unknown): SiteConfig {
  const out = emptySiteConfig();
  if (!isObj(raw)) return out;
  if (Array.isArray(raw.boardPanels)) {
    for (const p of raw.boardPanels.slice(0, MAX_BOARD_PANELS)) {
      if (!isObj(p) || typeof p.text !== 'string' || !PANEL_TEXT.test(p.text)) continue;
      if (typeof p.bg !== 'string' || !COLOR.test(p.bg) || typeof p.fg !== 'string' || !COLOR.test(p.fg)) continue;
      const panel: BoardPanel = { text: p.text, bg: p.bg, fg: p.fg };
      if (p.accentText !== undefined) {
        if (typeof p.accentText !== 'string' || !PANEL_TEXT.test(p.accentText) || (p.text + p.accentText).length > 24) continue;
        panel.accentText = p.accentText;
      }
      if (p.accent !== undefined) {
        if (typeof p.accent !== 'string' || !COLOR.test(p.accent)) continue;
        panel.accent = p.accent;
      }
      out.boardPanels.push(panel);
    }
  }
  const c = raw.creatorPortrait;
  if (isObj(c) && typeof c.src === 'string' && ASSET.test(c.src) && !c.src.includes('..') && shortText(c.alt, 80)) {
    out.creatorPortrait = { src: c.src, alt: c.alt };
    if (shortText(c.note, 200)) out.creatorPortrait.note = c.note;
  }
  return out;
}

/**
 * Loads `site-config.json` if the site has one. Never throws and never delays start-up for long: a
 * missing, slow or invalid file just means no site extras.
 */
export async function loadSiteConfig(base: string, timeoutMs = 2000): Promise<SiteConfig> {
  if (typeof fetch !== 'function') return emptySiteConfig();
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    const res = await fetch(base + SITE_CONFIG_FILE, { signal: ctrl?.signal, cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return emptySiteConfig();
    return parseSiteConfig(await res.json());
  } catch {
    return emptySiteConfig();
  } finally {
    clearTimeout(timer);
  }
}
