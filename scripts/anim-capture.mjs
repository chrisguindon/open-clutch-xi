/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Animation review: captures frame sequences of live play in close-up (carrier and nearest defender),
// and a goalkeeper sequence, into screenshots/anim/. Usage: node scripts/anim-capture.mjs [tag]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const tag = process.argv[2] || 'after';
const OUT = `screenshots/anim/${tag}`;
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5195, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 640, height: 400 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://127.0.0.1:5195/', { waitUntil: 'load' });
await page.evaluate(() =>
  localStorage.setItem(
    'floodlight-fc-settings-v1',
    JSON.stringify({ quality: 'medium', tutorialSeen: true, adaptiveQuality: false, dynamicResolution: false, format: '5v5', replays: 'off' }),
  ),
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 90000 });
await page.evaluate(() => [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.offsetParent).click());
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 90000 });
await page.evaluate(() => {
  const g = window.__game;
  g.state = 'paused';
  document.getElementById('ui').style.display = 'none';
  g.match.setHuman(null);
});
// Advance until someone is dribbling with an opponent nearby.
async function advance(sec) {
  await page.evaluate((sec) => {
    const g = window.__game,
      m = g.match;
    for (let i = 0; i < Math.round(sec * 120); i++) {
      g.prev.copyFrom(g.cur);
      m.step(1 / 120, null);
      g.cur.capture(m);
    }
  }, sec);
}
async function follow(id) {
  await page.evaluate((id) => {
    const g = window.__game;
    g.match.lastScorer = id;
    g.cam.cinematic = { kind: 'celebrate', t: 2.2 };
    g.cam.cut();
  }, id);
}
await advance(8);
let found = false;
for (let k = 0; k < 60 && !found; k++) {
  await advance(0.5);
  found = await page.evaluate(() => {
    const w = window.__game.match.world,
      c = w.controller;
    if (!c || c.isGK || c.speed < 2.5) return false;
    return w.players.some((o) => o.team !== c.team && Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z) < 4);
  });
}
const carrier = await page.evaluate(() => window.__game.match.world.controllerId);
for (let f = 0; f < 8; f++) {
  await follow(carrier);
  await sleep(500);
  await page.screenshot({ path: `${OUT}/dribble-${f}.png` });
  await advance(0.09);
}
// Goalkeeper: wait for a shot.
for (let k = 0; k < 200; k++) {
  const shot = await page.evaluate(() => {
    const m = window.__game.match;
    return !!m.sit.threat[0] || !!m.sit.threat[1];
  });
  if (shot) break;
  await advance(0.25);
}
const gk = await page.evaluate(() => {
  const m = window.__game.match;
  const t = m.sit.threat[0] ? 0 : 1;
  return m.world.players.find((p) => p.isGK && p.team === t).id;
});
for (let f = 0; f < 6; f++) {
  await follow(gk);
  await sleep(500);
  await page.screenshot({ path: `${OUT}/keeper-${f}.png` });
  await advance(0.08);
}
await browser.close();
await server.close();
console.log('done', OUT);
