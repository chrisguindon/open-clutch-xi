/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Replay review: scores a long-range goal with replays on and captures frames through the replay.
// Usage: node scripts/replay-capture.mjs  → screenshots/replay/*.png
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = `screenshots/${process.argv[2] || 'replay'}`;
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5192, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 800, height: 450 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e));
await page.goto('http://127.0.0.1:5192/', { waitUntil: 'load' });
await page.evaluate(
  (q) =>
    localStorage.setItem(
      'floodlight-fc-settings-v1',
      JSON.stringify({ quality: q, tutorialSeen: true, adaptiveQuality: false, dynamicResolution: false, format: '5v5', replays: 'all' }),
    ),
  process.env.Q || 'medium',
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 90000 });
await page.evaluate(() => [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.offsetParent).click());
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 90000 });
// Build up some footage, then a long shot into the corner.
await page.evaluate(() => {
  const g = window.__game,
    m = g.match,
    w = m.world;
  g.cam.cinematic = null;
  m.setHuman(null);
  m.phase = 'playing';
  w.restrictTouchTo = null;
  const sh = w.players.find((p) => p.team === 0 && p.role === 'MID');
  const L2 = w.pitch.length / 2;
  sh.place(L2 - 22, 4, 0);
  w.ball.reset(sh.footX(0.5), 4);
  w.clearPossession();
  for (let i = 0; i < 120; i++) {
    g.prev.copyFrom(g.cur);
    m.step(1 / 120, null);
    g.cur.capture(m);
    if (i % 2 === 0) g.replayBuf.push(m);
  }
  const gk = w.players.find((p) => p.isGK && p.team === 1);
  gk.place(L2 - 0.5, -2.5, Math.PI);
  w.ball.reset(L2 - 21, 3.5, 0.11);
  w.ball.vel.set(25, 4.2, -2.2);
  w.ball.spin.set(0, -10, 0);
  w.lastTouchTeam = 0;
  w.lastTouchId = sh.id;
  w.lastKick = { playerId: sh.id, team: 0, kind: 'shot', time: w.time, receiver: null, fromX: L2 - 21, fromZ: 3.5, onTarget: true };
});
// Live celebration (confetti) before the replay starts.
await page.waitForFunction(() => window.__game.match.phase === 'goal', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}/goal-live.png` });
await page.waitForFunction(() => !!window.__game.replay, { timeout: 120000 });
const confettiDuringReplay = await page.evaluate(() => window.__game.view.celebration.group.children.some((c) => c.visible));
console.log('confetti/fireworks visible during replay:', confettiDuringReplay);
for (let k = 0; k < 6; k++) {
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${OUT}/replay-${k}.png` });
}
await browser.close();
await server.close();
console.log('done');
