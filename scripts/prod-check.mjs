/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Production check: serves dist/ with the headers from netlify.toml (CSP, MIME types, caching) and
// verifies the built site loads with no CSP violations, failed requests or console errors; opens team
// selection (flags), starts a match and confirms the 3D characters and textures loaded.
//   npm run build && node scripts/prod-check.mjs
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';

const toml = readFileSync('netlify.toml', 'utf8');
const csp = toml.match(/Content-Security-Policy = "([^"]+)"/)[1];
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain',
};
const server = http
  .createServer((req, res) => {
    let p = join('dist', decodeURIComponent(req.url.split('?')[0]));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) p = 'dist/index.html'; // SPA fallback, as in netlify.toml
    res.writeHead(200, {
      'Content-Type': types[extname(p)] ?? 'application/octet-stream',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(readFileSync(p));
  })
  .listen(5212, '127.0.0.1');
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1200, height: 630 },
});
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text());
});
page.on('pageerror', (e) => problems.push('pageerror: ' + e));
page.on('requestfailed', (r) => problems.push('failed: ' + r.url()));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`);
});
await page.evaluateOnNewDocument(() => {
  document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation', e.violatedDirective, e.blockedURI));
});
await page.goto('http://127.0.0.1:5212/', { waitUntil: 'load' });
await page.evaluate(() =>
  localStorage.setItem(
    'floodlight-fc-settings-v1',
    JSON.stringify({ quality: 'medium', tutorialSeen: true, deviceProfileApplied: true, homeTeam: 'CAN', awayTeam: 'MAR' }),
  ),
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'screenshots/social-card.png' }); // source for public/social-card.jpg
const meta = await page.evaluate(() => ({
  title: document.title,
  desc: document.querySelector('meta[name=description]')?.content,
  og: document.querySelector('meta[property="og:image"]')?.content,
  icon: document.querySelector('link[rel=icon]')?.href,
}));
await page.evaluate(() => document.querySelector('.menu [data-action=setup]').click());
await page.waitForSelector('.team-tile img');
await new Promise((r) => setTimeout(r, 1500));
const flags = await page.evaluate(() => [...document.querySelectorAll('.team-tile img')].filter((i) => i.complete && i.naturalWidth > 0).length);
await page.evaluate(() => [...document.querySelectorAll('.setup [data-action=play]')].find((e) => e.offsetParent).click());
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));
const game = await page.evaluate(() => ({
  characters: !!window.__game.characters,
  surface: !!window.__game.surface,
  teams: window.__game.clubs.map((c) => c.short),
}));
console.log(JSON.stringify({ meta, flagsLoaded: flags, game, problems }, null, 1));
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
