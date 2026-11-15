/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Screenshots of every goal-celebration style (plus an own goal) for human review → screenshots/celebrations/.
// Automated tests check *which* celebration is chosen; only people can judge whether it looks natural.
// Software rendering in headless Chromium: poses are representative, frame rates are not.
//   node scripts/celebration-gallery.mjs
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = 'screenshots/celebrations';
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5215, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 960, height: 540 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5215/', { waitUntil: 'load' });
await page.evaluate(() =>
  localStorage.setItem(
    'floodlight-fc-settings-v1',
    JSON.stringify({
      quality: 'medium',
      graphicsMode: 'manual',
      tutorialSeen: true,
      deviceProfileApplied: true,
      controlsChosen: true,
      replays: 'off',
      format: '5v5',
    }),
  ),
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
await page.evaluate(() => window.__game.startMatch('match'));
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });

const gameWait = (s) =>
  page
    .waitForFunction((t) => window.__game.match.world.time > t, { timeout: 180000, polling: 50 }, 0)
    .then(() =>
      page
        .evaluate((s) => window.__game.match.world.time + s, s)
        .then((t) => page.waitForFunction((t) => window.__game.match.world.time > t, { timeout: 180000, polling: 50 }, t)),
    );

async function goal(style, ownGoal) {
  await page.waitForFunction(() => ['playing', 'kickoff'].includes(window.__game.match.phase), { timeout: 180000 });
  await page.evaluate(
    (style, ownGoal) => {
      const g = window.__game,
        m = g.match,
        w = m.world;
      g.cam.cinematic = null;
      m.phase = 'playing';
      w.restrictTouchTo = null;
      w.secondTouchBan = null;
      const L2 = w.pitch.length / 2,
        dir = w.attackDir(0);
      for (const p of w.players) p.place(dir * (L2 - 8) + p.index * 0.5 * -dir, (p.index - 2) * 4, 0);
      w.ball.reset(dir * (L2 - 1.5), 0, 0.4);
      w.ball.vel.set(dir * 12, 0, 0);
      const toucher = w.players.find((p) => p.team === (ownGoal ? 1 : 0) && !p.isGK);
      w.lastTouchTeam = toucher.team;
      w.lastTouchId = toucher.id;
      window.__forceStyle = style;
    },
    style,
    ownGoal,
  );
  await page.waitForFunction(() => window.__game.match.phase === 'goal', { timeout: 120000 });
  // Review captures only: hold the celebration long enough for the camera to settle on the pose.
  await page.evaluate(() => {
    window.__game.match.celebration.duration = 6;
  });
  if (style)
    await page.evaluate((style) => {
      const m = window.__game.match;
      const codes = { armsUp: 1, fistPump: 2, cornerRun: 3, huddle: 4, restrained: 5, yes: 6, pointSky: 13, applaudFans: 11 };
      m.celebration.style = style;
      m.world.players[m.lastScorer].gesture = codes[style];
    }, style);
  await gameWait(2.6); // give the celebration camera time to settle
  const info = await page.evaluate(() => {
    const m = window.__game.match;
    return { phase: m.phase, style: m.celebration?.style, scorer: m.lastGoalScorer, celebrant: m.lastScorer };
  });
  const name = ownGoal ? 'own-goal' : style;
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name} (${JSON.stringify(info)})`);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__game.match.phase !== 'goal', { timeout: 120000 });
}

for (const style of ['armsUp', 'fistPump', 'pointSky', 'applaudFans', 'yes', 'cornerRun', 'huddle', 'restrained']) await goal(style, false);
await goal(null, true);
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
await server.close();
