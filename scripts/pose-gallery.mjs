/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Dev tool: renders each animation state of the procedural player rig to screenshots/pose-*.png.
// Usage: node scripts/pose-gallery.mjs (needs Chrome or Chromium; set CHROME_PATH if it isn't found).
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';
const server = await createServer({ root: process.cwd(), server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 640, height: 400 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e));
await page.goto('http://127.0.0.1:5197/', { waitUntil: 'load' });
await page.evaluate(() =>
  localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ quality: 'medium', tutorialSeen: true, adaptiveQuality: false, format: '3v3' })),
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 60000 });
await page.evaluate(() => {
  [...document.querySelectorAll('[data-action=play]')].find((e) => e.offsetParent).click();
});
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const poses = [
  ['run', 0, 0, 7, 0, 0],
  ['kick-windup', 1, 0.1, 2, 0, 0],
  ['kick-follow', 1, 0.24, 2, 0, 0],
  ['pass', 2, 0.15, 2, 0, 0],
  ['tackle', 3, 0.15, 3, 0, 0],
  ['slide', 4, 0.4, 5, 0, 0],
  ['header', 10, 0.14, 0, 0, 0],
  ['throw', 8, 0.15, 0, 0, 0],
  ['celebrate', 0, 0, 0, 1, 0],
  ['airplane', 0, 0, 5, 1, 0],
  ['dejected', 0, 0, 0, 2, 0],
  ['dive-gk', 6, 0.45, 2, 0, 1],
  ['gk-ready', 13, 0, 0, 0, 0],
  ['fallen', 14, 0.6, 0, 0, 0],
];
await page.evaluate(() => {
  const g = window.__game;
  g.state = 'paused';
  document.getElementById('ui').style.display = 'none';
});
for (const [name, anim, t, speed, mood, isGk] of poses) {
  await page.evaluate(
    (anim, t, speed, mood, isGk) => {
      const g = window.__game;
      const m = g.match;
      const pid = isGk ? m.world.players.find((p) => p.isGK && p.team === 1).id : m.humanId;
      const S = 17;
      for (const f of [g.prev, g.cur]) {
        const o = pid * S;
        f.players[o + 4] = anim;
        f.players[o + 5] = t;
        f.players[o + 6] = speed;
        f.players[o + 8] = mood;
        f.players[o + 9] = 1;
        f.players[o + 1] = anim === 6 ? 0.4 : 0;
        f.players[o + 0] = 0;
        f.players[o + 2] = 0;
        f.players[o + 3] = 0.6;
        f.players[o + 10] = 0;
      }
      m.lastScorer = pid;
      g.cam.cinematic = { kind: 'celebrate', t: 2.6 };
      g.cam.cut();
    },
    anim,
    t,
    speed,
    mood,
    isGk,
  );
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: `screenshots/pose-${name}.png` });
}
await browser.close();
await server.close();
