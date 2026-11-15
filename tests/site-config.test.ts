/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// site-config.json is written by whoever hosts the game, so it's untrusted: these tests check that only
// well-formed extras get through, and that the released game needs none.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { MAX_BOARD_PANELS, emptySiteConfig, loadSiteConfig, parseSiteConfig } from '../src/game/siteConfig';

const panel = { text: 'example', accentText: '.org', bg: '#0b1530', fg: '#f1f5f9', accent: '#60a5fa' };
const portrait = { src: 'assets/site/portrait.jpg', alt: 'The creator', note: 'Not covered by the open-source licence.' };

describe('site configuration', () => {
  it('accepts well-formed board panels and a portrait', () => {
    expect(parseSiteConfig({ boardPanels: [panel], creatorPortrait: portrait })).toEqual({ boardPanels: [panel], creatorPortrait: portrait });
  });

  it('drops anything malformed instead of applying part of it', () => {
    const bad = [
      { ...panel, bg: 'red' },
      { ...panel, text: '<script>alert(1)</script>' },
      { ...panel, text: 'x'.repeat(25) },
      { ...panel, accentText: 'y'.repeat(20) },
      { ...panel, accent: 'javascript:' },
      'text',
    ];
    expect(parseSiteConfig({ boardPanels: bad }).boardPanels).toEqual([]);
    for (const src of ['https://evil.example/p.jpg', '../secret.jpg', 'assets/../x.jpg', 'assets/p.svg', '/assets/p.jpg']) {
      expect(parseSiteConfig({ creatorPortrait: { ...portrait, src } }).creatorPortrait, src).toBeNull();
    }
    expect(parseSiteConfig({ creatorPortrait: { ...portrait, alt: '' } }).creatorPortrait).toBeNull();
    expect(parseSiteConfig('<!doctype html>')).toEqual(emptySiteConfig());
    expect(parseSiteConfig(null)).toEqual(emptySiteConfig());
  });

  it('keeps at most three extra panels', () => {
    expect(parseSiteConfig({ boardPanels: Array(6).fill(panel) }).boardPanels).toHaveLength(MAX_BOARD_PANELS);
  });

  describe('loading', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('ignores a missing file, an HTML fallback page and network errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })));
      expect(await loadSiteConfig('./')).toEqual(emptySiteConfig());
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
      expect(await loadSiteConfig('./')).toEqual(emptySiteConfig());
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      expect(await loadSiteConfig('./')).toEqual(emptySiteConfig());
    });
    it('reads a valid file', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ boardPanels: [panel] })));
      expect((await loadSiteConfig('./')).boardPanels).toEqual([panel]);
    });
  });

  it('the public game ships no personal assets or site config', () => {
    for (const f of ['public/assets/credits/portrait.jpg', 'public/site-config.json']) expect(existsSync(f), f).toBe(false);
  });
});
