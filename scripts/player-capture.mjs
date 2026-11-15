/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Player benchmark capture: poses one footballer through every animation state and photographs it.
//   node scripts/player-capture.mjs [tag]   → screenshots/player/<tag>/*.png
//   SQUAD=women|men|mixed picks the body (Teams setting); Q and TOD set quality and time of day.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const tag = process.argv[2] || 'after';
const OUT = `screenshots/player/${tag}`;
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5191, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 560, height: 560 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text());
});
await page.goto('http://127.0.0.1:5191/', { waitUntil: 'load' });
await page.evaluate(
  (q, tod, squad) =>
    localStorage.setItem(
      'floodlight-fc-settings-v1',
      JSON.stringify({ quality: q, tutorialSeen: true, adaptiveQuality: false, dynamicResolution: false, format: '5v5', timeOfDay: tod, squad }),
    ),
  process.env.Q || 'medium',
  process.env.TOD || 'night',
  process.env.SQUAD || 'men',
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
await page.evaluate(() => [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.offsetParent).click());
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
await page.evaluate(() => {
  const g = window.__game;
  g.state = 'paused';
  document.getElementById('ui').style.display = 'none';
});

// [name, anim, animTime, speed, mood, y, gaitPhase, view(front|back|side), isGK, ballY, gesture]
const poses = [
  ['idle-front', 0, 0, 0, 0, 0, 0, 'front'],
  ['idle-back', 0, 0, 0, 0, 0, 0, 'back'],
  ['walk', 0, 0, 1.8, 0, 0, 1.57, 'side'],
  ['jog', 0, 0, 4.2, 0, 0, 1.57, 'side'],
  ['sprint', 0, 0, 7.8, 0, 0, 1.57, 'side'],
  ['kick-windup', 1, 0.12, 2, 0, 0, 0, 'side'],
  ['kick-strike', 1, 0.22, 2, 0, 0, 0, 'side'],
  ['pass', 2, 0.16, 2, 0, 0, 0, 'front'],
  ['tackle', 3, 0.15, 3, 0, 0, 0, 'side'],
  ['slide', 4, 0.45, 6, 0, 0, 0, 'side'],
  ['header', 10, 0.14, 0, 0, 0.4, 0, 'side'],
  ['throw', 8, 0.2, 0, 0, 0, 0, 'side'],
  ['stumble', 5, 0.2, 2, 0, 0, 0, 'side'],
  ['fallen', 14, 0.6, 0, 0, 0, 0, 'side'],
  ['celebrate', 0, 0, 0, 1, 0, 0, 'front'],
  ['airplane', 0, 0, 5, 1, 0, 1.0, 'front'],
  ['dejected', 0, 0, 0, 2, 0, 0, 'front'],
  ['gk-ready', 13, 0, 0, 0, 0, 0, 'front', 1, 1.2],
  ['gk-dive', 6, 0.4, 2, 0, 0.5, 0, 'front', 1],
  ['gk-hold', 7, 0.3, 0, 0, 0, 0, 'front', 1, 1.05],
  // Celebration and reaction gestures (codes from src/sim/celebration.ts), held long enough to blend in.
  ['g-arms-up', 0, 0, 0, 1, 0, 0, 'front', 0, null, 1],
  ['g-fist-pump', 0, 0, 0, 1, 0, 0, 'front', 0, null, 2],
  ['g-restrained', 0, 0, 0, 1, 0, 0, 'front', 0, null, 5],
  ['g-point-sky', 0, 0, 0, 1, 0, 0, 'front', 0, null, 13],
  ['g-applaud', 0, 0, 0, 1, 0, 0, 'front', 0, null, 11],
  ['g-hands-on-head', 0, 0, 0, 2, 0, 0, 'front', 0, null, 10],
  ['g-hands-on-hips', 0, 0, 0, 2, 0, 0, 'front', 0, null, 12],
  ['g-corner-run', 0, 0, 5, 1, 0, 1.0, 'front', 0, null, 3],
  ['g-arms-up-side', 0, 0, 0, 1, 0, 0, 'side', 0, null, 1],
  ['g-fist-pump-side', 0, 0, 0, 1, 0, 0, 'side', 0, null, 2],
];
// ONLY=g- captures just the poses whose names start with that prefix.
for (const [name, anim, t, speed, mood, y, gait, view, gk, ballY, gesture] of poses.filter((p) => !process.env.ONLY || p[0].startsWith(process.env.ONLY))) {
  await page.evaluate(
    (anim, t, speed, mood, y, gait, view, gk, ballY, gesture) => {
      const g = window.__game,
        m = g.match,
        w = m.world;
      const pid = gk ? w.players.find((p) => p.isGK && p.team === 0).id : w.players.find((p) => p.team === 0 && p.role === 'FWD').id;
      const S = 18; // P_STRIDE in src/game/frames.ts
      // Park everyone else far away.
      for (const f of [g.prev, g.cur]) {
        for (const p of w.players) {
          const o = p.id * S;
          if (p.id === pid) continue;
          f.players[o] = -30;
          f.players[o + 2] = 18 + p.id;
          f.players[o + 6] = 0;
          f.players[o + 4] = 0;
        }
        const o = pid * S;
        f.players[o] = 0;
        f.players[o + 1] = y;
        f.players[o + 2] = 0;
        f.players[o + 3] = 0;
        f.players[o + 4] = anim;
        f.players[o + 5] = t;
        f.players[o + 6] = speed;
        f.players[o + 8] = mood;
        f.players[o + 9] = 1;
        f.players[o + 10] = 0;
        f.players[o + 11] = speed;
        f.players[o + 12] = 0;
        f.players[o + 13] = gait;
        f.players[o + 14] = 10;
        f.players[o + 15] = 1;
        f.players[o + 16] = -1;
        f.players[o + 17] = gesture; // PF.Gesture
        f.ball[0] = ballY ? 0.5 : 1.5;
        f.ball[1] = ballY ?? 0.11;
        f.ball[2] = ballY ? 0 : 0.6;
      }
      m.lastScorer = pid;
      // Celebrate-camera orbit angle a = t*0.35 + 0.8: front (+x) a=π/2, back a=−π/2, side (+z) a=0.
      const a = view === 'front' ? Math.PI / 2 : view === 'back' ? -Math.PI / 2 : 0;
      g.cam.cinematic = { kind: 'celebrate', t: (a - 0.8) / 0.35 };
      g.cam.cut();
    },
    anim,
    t,
    speed,
    mood,
    y,
    gait,
    view,
    gk ?? 0,
    ballY ?? null,
    gesture ?? 0,
  );
  await new Promise((r) => setTimeout(r, 2600));
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
await browser.close();
await server.close();
console.log('done', OUT);
