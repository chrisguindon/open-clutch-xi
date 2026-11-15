/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Production check: serves a built site with the headers from the hosting policy (hosting/headers.json:
// CSP, MIME types, caching) and verifies it loads with no CSP violations, failed requests or console
// errors; opens team selection (flags), starts a match and confirms the 3D characters and textures loaded.
//   npm run build && node scripts/prod-check.mjs
//   PROD_DIR=<built site> node scripts/prod-check.mjs   check another build, e.g. an assembled deployment
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';
import { headersFor, loadHostingPolicy } from './lib/hosting.mjs';

const policy = loadHostingPolicy();
const root = process.env.PROD_DIR || 'dist';
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
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (existsSync(join(root, path)) && statSync(join(root, path)).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(join(root, path))) path = policy.spaFallback.to; // single-page fallback
    const p = join(root, path);
    res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream', ...headersFor(policy, path) });
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
