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
 * Site metadata: the page title and the link-preview tags in `index.html`.
 *
 * The game is a static web app that anyone may host, so the parts of the page that describe *a
 * particular site* (its title, description and public URL) are kept apart from the game. They live
 * between two markers in `index.html`:
 *
 * ```html
 * <!-- site-meta -->  …title, description, Open Graph and Twitter tags…  <!-- /site-meta -->
 * ```
 *
 * At build time `vite.config.ts` fills the block with {@link renderSiteMeta}. A host can later replace
 * the whole block in the built `index.html` with its own tags, without rebuilding the game: that is the
 * supported way to customise a deployment (see docs/development/hosting.md). The markers are a stable
 * contract between releases.
 *
 * Absolute URLs (canonical link, `og:url`, `og:image`) are only written when a site URL is known
 * (the `SITE_URL` build variable). The released build has none: a canonical URL pointing at someone
 * else's site would be wrong for every other host.
 *
 * Nothing here affects gameplay or saved data: storage keys never depend on the site or the brand.
 * Plain TypeScript with no browser or Vite globals, because vite.config.ts runs it in Node.
 */

/** Opening and closing markers of the replaceable metadata block in `index.html`. */
export const SITE_META_START = '<!-- site-meta -->';
export const SITE_META_END = '<!-- /site-meta -->';

/** What a site says about itself. */
export interface SiteMeta {
  /** Page title and the name shown in link previews. */
  title: string;
  /** One-sentence description for search results and link previews. */
  description: string;
  /** Public URL of the site, ending in `/`, or empty when unknown (no absolute URLs are written). */
  siteUrl: string;
  /** Social preview image, relative to the site root (1200×630). */
  socialImage: string;
}

/** Escapes a value for an HTML attribute or text node. */
export function escapeHtmlAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Checks a site URL: empty, or an absolute `https://` (or `http://localhost`) URL ending in `/`.
 * @throws Error describing the problem, so a misconfigured build fails instead of shipping bad links.
 */
export function checkSiteUrl(url: string): string {
  if (url === '') return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`SITE_URL is not a URL: ${url}`);
  }
  const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (u.protocol !== 'https:' && !local) throw new Error(`SITE_URL must use https: ${url}`);
  if (!url.endsWith('/')) throw new Error(`SITE_URL must end with "/": ${url}`);
  if (u.search || u.hash) throw new Error(`SITE_URL must not have a query or fragment: ${url}`);
  return url;
}

/**
 * The tags that go between {@link SITE_META_START} and {@link SITE_META_END}, one per line, indented
 * for the `<head>`. Every value is escaped.
 */
export function renderSiteMeta(meta: SiteMeta, indent = '    '): string {
  const e = escapeHtmlAttr;
  const url = checkSiteUrl(meta.siteUrl);
  const lines = [
    `<title>${e(meta.title)}</title>`,
    `<meta name="description" content="${e(meta.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${e(meta.title)}" />`,
    `<meta property="og:title" content="${e(meta.title)}" />`,
    `<meta property="og:description" content="${e(meta.description)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${e(meta.title)}" />`,
    `<meta name="twitter:description" content="${e(meta.description)}" />`,
  ];
  if (url) {
    const image = new URL(meta.socialImage, url).href;
    lines.push(
      `<link rel="canonical" href="${e(url)}" />`,
      `<meta property="og:url" content="${e(url)}" />`,
      `<meta property="og:image" content="${e(image)}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta name="twitter:image" content="${e(image)}" />`,
    );
  }
  return lines.map((l) => indent + l).join('\n');
}

/**
 * Replaces the metadata block in an HTML page.
 * @throws Error if the page doesn't contain exactly one block.
 */
export function replaceSiteMeta(html: string, meta: SiteMeta): string {
  const start = html.indexOf(SITE_META_START);
  const end = html.indexOf(SITE_META_END);
  if (start < 0 || end < start || html.indexOf(SITE_META_START, start + 1) >= 0) {
    throw new Error('index.html must contain exactly one <!-- site-meta --> … <!-- /site-meta --> block');
  }
  return html.slice(0, start + SITE_META_START.length) + '\n' + renderSiteMeta(meta) + '\n    ' + html.slice(end);
}
