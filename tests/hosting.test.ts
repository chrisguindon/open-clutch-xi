/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Hosting independence: the game is a static app any host can serve. These tests guard the pieces hosts
// rely on: the recommended header policy stays strict, the replaceable site-metadata block keeps its
// contract, release archives round-trip safely, and no hosting-platform configuration creeps back in.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SITE_META_END, SITE_META_START, checkSiteUrl, renderSiteMeta, replaceSiteMeta } from '../src/siteMeta';
// @ts-expect-error -- plain JavaScript build helpers without type declarations
import { headersFor, loadHostingPolicy, patternToRegExp } from '../scripts/lib/hosting.mjs';
// @ts-expect-error -- plain JavaScript build helpers without type declarations
import { createTar, readTar } from '../scripts/lib/tar.mjs';

type Headers = Record<string, string>;
const policy = loadHostingPolicy() as { rules: { for: string; headers: Headers }[]; spaFallback: { to: string } };
const csp = (headersFor(policy, '/') as Headers)['Content-Security-Policy'];
const meta = { title: 'Open Clutch XI', description: 'A free game.', siteUrl: '', socialImage: 'social-card.jpg' };

describe('recommended headers (hosting/headers.json)', () => {
  it('keeps the Content-Security-Policy strict', () => {
    const d = Object.fromEntries(
      csp
        .split(';')
        .map((p) => p.trim().split(/\s+/))
        .map(([k, ...v]) => [k, v]),
    );
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]); // never 'unsafe-eval' or 'unsafe-inline' scripts
    expect(d['frame-ancestors']).toEqual(["'self'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'none'"]);
    expect(csp).not.toMatch(/https?:/); // no third-party hosts
  });

  it('sends the security headers on every path', () => {
    for (const path of ['/', '/index.html', '/static/index.js', '/assets/player.glb', '/NOTICE.txt']) {
      const h = headersFor(policy, path) as Headers;
      expect(h['Content-Security-Policy']).toBe(csp);
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
      expect(h['Referrer-Policy']).toBeTruthy();
      expect(h['Permissions-Policy']).toMatch(/camera=\(\)/);
    }
  });

  it('caches hashed bundles forever, game assets for a day, and always revalidates the page', () => {
    expect((headersFor(policy, '/static/three-abc.js') as Headers)['Cache-Control']).toMatch(/immutable/);
    expect((headersFor(policy, '/assets/flags/fr.svg') as Headers)['Cache-Control']).toMatch(/max-age=86400/);
    expect((headersFor(policy, '/assets/flags/fr.svg') as Headers)['Content-Type']).toBe('image/svg+xml');
    expect((headersFor(policy, '/assets/player.glb') as Headers)['Content-Type']).toBe('model/gltf-binary');
    expect((headersFor(policy, '/index.html') as Headers)['Cache-Control']).toMatch(/max-age=0/);
    expect(policy.spaFallback.to).toBe('/index.html');
  });

  it('matches patterns literally apart from *', () => {
    expect(patternToRegExp('/assets/*.glb').test('/assets/xglb')).toBe(false);
    expect(patternToRegExp('/assets/*.glb').test('/assets/a/b.glb')).toBe(true);
  });
});

describe('site metadata block (src/siteMeta.ts)', () => {
  it('index.html has exactly one block for hosts to replace', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html.split(SITE_META_START).length).toBe(2);
    expect(html.split(SITE_META_END).length).toBe(2);
    expect(html).not.toMatch(/<title>|og:url|rel="canonical"/); // all site-specific tags live in the block
  });

  it('writes no absolute URLs without a site URL, so released builds suit any host', () => {
    const out = renderSiteMeta(meta);
    expect(out).toContain('<title>Open Clutch XI</title>');
    expect(out).not.toMatch(/canonical|og:url|og:image|twitter:image|https?:/);
  });

  it('adds canonical and absolute preview URLs for a configured site', () => {
    const out = renderSiteMeta({ ...meta, siteUrl: 'https://games.example.org/play/' });
    expect(out).toContain('<link rel="canonical" href="https://games.example.org/play/" />');
    expect(out).toContain('<meta property="og:image" content="https://games.example.org/play/social-card.jpg" />');
  });

  it('escapes values and rejects unsafe site URLs', () => {
    expect(renderSiteMeta({ ...meta, title: '"><script>' })).toContain('&quot;&gt;&lt;script&gt;');
    for (const bad of ['http://example.org/', 'https://example.org', 'javascript:alert(1)/', 'https://e.org/?x=1/', 'not a url']) {
      expect(() => checkSiteUrl(bad), bad).toThrow();
    }
    expect(checkSiteUrl('http://localhost:8888/')).toBe('http://localhost:8888/');
  });

  it('replaces the block in a built page and refuses pages without exactly one block', () => {
    const page = `<head>\n    ${SITE_META_START}\n    <title>old</title>\n    ${SITE_META_END}\n</head>`;
    const out = replaceSiteMeta(page, { ...meta, title: 'My Site' });
    expect(out).toContain('<title>My Site</title>');
    expect(out).not.toContain('old');
    expect(() => replaceSiteMeta('<head></head>', meta)).toThrow();
    expect(() => replaceSiteMeta(page + page, meta)).toThrow();
  });
});

describe('release archives (scripts/lib/tar.mjs)', () => {
  const files = [
    { path: 'pkg/site/index.html', data: Buffer.from('<html></html>') },
    { path: 'pkg/' + 'deep/'.repeat(25) + 'long-file-name.txt', data: Buffer.alloc(1300, 7) },
    { path: 'pkg/LICENSE', data: Buffer.from('EPL') },
  ];

  it('round-trips files, sorted, with identical bytes for identical input', () => {
    const a = createTar(files, 1700000000) as Buffer;
    expect(createTar([...files].reverse(), 1700000000)).toEqual(a);
    const back = readTar(a) as { path: string; data: Buffer }[];
    expect(back.map((f) => f.path)).toEqual([...files.map((f) => f.path)].sort());
    for (const f of files) expect(back.find((b) => b.path === f.path)!.data).toEqual(f.data);
  });

  it('refuses paths that could escape the extraction folder', () => {
    expect(() => createTar([{ path: '../evil', data: Buffer.from('x') }], 0)).toThrow();
    const tar = createTar([{ path: 'ok/file', data: Buffer.from('x') }], 0) as Buffer;
    tar.write('../evil\0\0\0', 0, 'utf8'); // tamper with the name: the checksum no longer matches
    expect(() => readTar(tar)).toThrow();
  });
});

describe('hosting independence', () => {
  it('contains no hosting-platform deploy configuration', () => {
    for (const f of ['netlify.toml', '.netlify', 'vercel.json', '_redirects', 'public/_redirects', 'public/_headers']) expect(existsSync(f), f).toBe(false);
  });
});
