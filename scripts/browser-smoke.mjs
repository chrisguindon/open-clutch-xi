/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Browser smoke test: boots the game in headless Chromium, navigates menus, plays,
// and fails on console errors. Screenshots go to ./screenshots.
//
// Usage: node scripts/browser-smoke.mjs [--url http://localhost:5173] [--chrome /usr/bin/chromium]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const executablePath = arg('--chrome', findChrome());
if (!executablePath) {
  console.error('No Chromium found. Pass --chrome /path/to/chrome or set CHROME_PATH.');
  process.exit(2);
}
let url = arg('--url', null);
let server = null;
if (!url) {
  server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = 'http://127.0.0.1:5199/';
}
mkdirSync('screenshots', { recursive: true });

const QUALITY = process.env.QUALITY || 'low';
const W = Number(process.env.WIDTH || 960),
  H = Number(process.env.HEIGHT || 540);
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    `--window-size=${W},${H}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: W, height: H },
});
const errors = [];
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (process.env.VERBOSE) console.log('[console]', m.type(), m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `screenshots/${name}.png` });
  console.log('📸', name);
};
const state = () =>
  page.evaluate(() => {
    const g = window.__game;
    if (!g) return null;
    const m = g.match;
    return { state: g.state, phase: m?.phase, score: m ? [...m.score] : null, clock: m?.clock, mode: g.mode, human: m?.humanId };
  });
/** Click an element inside the currently visible screen. */
const click = async (sel) => {
  await page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null), { timeout: 20000 }, sel);
  await page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null).click(), sel);
};
/** Wait for game time to advance by `sec` seconds (robust to slow software rendering). */
const gameWait = async (sec) => {
  const t0 = await page.evaluate(() => window.__game.time);
  await page.waitForFunction((t, s) => window.__game.time >= t + s, { timeout: 120000, polling: 50 }, t0, sec);
};
const key = async (code, ms = 80) => {
  await page.keyboard.down(code);
  await sleep(ms);
  await page.keyboard.up(code);
};

try {
  await page.goto(url, { waitUntil: 'load' });
  // Settings: low quality for fast software rendering, tutorial seen.
  await page.evaluate((q) => {
    localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ quality: q, tutorialSeen: true, adaptiveQuality: false, dynamicResolution: false }));
  }, QUALITY);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 60000 });
  await sleep(2500);
  await shot('01-menu');

  // Match setup screen.
  await click('[data-action=setup]');
  await sleep(500);
  await shot('02-setup');
  await click('[data-action=opt][data-v="3v3"]');
  await sleep(200);
  await click('[data-action=play]');
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 30000 });
  await gameWait(1.5);
  await shot('03-kickoff-intro');
  // Kick off with a pass.
  await key('KeyJ', 120);
  await gameWait(1.5);
  console.log('after kickoff', await state());
  // Run forward and try to shoot.
  await page.keyboard.down('KeyD');
  await gameWait(1.2);
  await shot('04-play');
  await page.keyboard.down('ShiftLeft');
  await gameWait(1.2);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.down('Space');
  await gameWait(0.5);
  await shot('05-charging');
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  await gameWait(1.2);
  await shot('06-after-shot');
  // Switch player and cycle cameras.
  await key('KeyQ');
  await key('KeyC');
  await gameWait(1.2);
  await shot('07-dynamic-camera');
  await key('KeyC');
  await gameWait(1.2);
  await shot('08-tactical-camera');
  await key('KeyC');
  // Let AI play for a while.
  await gameWait(6.0);
  console.log('mid-match', await state());
  await shot('09-midmatch');
  // Pause menu.
  await key('Escape');
  await gameWait(0.5);
  await shot('10-pause');
  const paused = await state();
  if (paused.state !== 'paused') throw new Error('Pause did not work: ' + JSON.stringify(paused));
  await click('[data-action=resume]');
  await sleep(300);
  // Force a goal to test the celebration + replay pipeline.
  await page.evaluate(() => {
    const m = window.__game.match;
    const w = m.world;
    m.phase = 'playing';
    w.restrictTouchTo = null;
    w.clearPossession();
    w.ball.heldBy = null; // a held ball (a keeper's catch, a throw-in) follows its holder, not the shot
    // If a throw-in or indirect free kick was just taken and nobody else has touched the ball, the game
    // correctly refuses a goal straight from it (Laws 13 and 15). Clear it: this check is about the
    // celebration and replay, and the race made it flaky.
    m.lastRestart = null;
    // Keeper out of the way so the shot can't be saved.
    const gk = w.players.find((p) => p.isGK && p.team === 1);
    gk.place(w.pitch.length / 2 - 3, w.pitch.width / 2 - 2, Math.PI);
    // Clear the shot path too: where real-time AI play leaves the defenders varies between runs, and a
    // defender standing in front of goal deflected the ball out (a corner instead of a goal).
    for (const p of w.players) if (p !== gk && Math.abs(p.pos.x - w.pitch.length / 2) < 12) p.place(0, p.pos.z, 0);
    w.ball.reset(w.pitch.length / 2 - 3, 0.5, 0.6);
    w.ball.vel.set(14, 0.2, 0);
    w.lastTouchTeam = 0;
    w.lastTouchId = m.humanId;
  });
  await gameWait(0.7);
  await shot('11-goal');
  await gameWait(2.0);
  await shot('12-celebration');
  await page.waitForFunction(() => !!window.__game.replay, { timeout: 8000 }).catch(() => null);
  await gameWait(1.5);
  await shot('13-replay');
  console.log('after goal', await state());
  // Restart after the goal: either still at kick-off or already back in play (slow software GL can miss the kick-off frames).
  // (Play may already have moved on to another stoppage/restart; restart flow itself is covered by tests/flow.test.ts.)
  await page.waitForFunction(
    () => {
      const m = window.__game.match;
      return m.score[0] + m.score[1] > 0 && m.phase !== 'goal' && m.phase !== 'replay' && !window.__game.replay;
    },
    // Generous: game time advances at most 0.1 s per rendered frame, and software rendering can drop to
    // a few frames per second, so a 6 s celebration plus a replay can take well over 20 s of real time.
    { timeout: 120000 },
  );
  console.log('back to kickoff', await state());

  // Fast-forward to full time.
  await page.evaluate(() => {
    window.__game.match.clock = window.__game.match.options.duration - 0.5;
    window.__game.match.phase = 'playing';
    window.__game.match.world.restrictTouchTo = null;
  });
  // A hang guard, not a timing assumption: full time needs several seconds of game time (more if a goal
  // is scored first), and under load software rendering can run at ~1 fps with ≤0.1 s of game time per frame.
  await page.waitForFunction(() => window.__game.state === 'fulltime', { timeout: 240000 });
  await gameWait(0.6);
  await shot('14-fulltime');

  // Penalty shootout.
  await click('[data-action=quit]');
  await page.waitForFunction(() => window.__game.state === 'menu', { timeout: 20000 });
  await click('[data-action=penalties]');
  await page.waitForFunction(() => window.__game.state === 'playing' && window.__game.mode === 'penalties', { timeout: 20000 });
  await gameWait(1.2);
  await page.keyboard.down('KeyD');
  await sleep(300);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('Space');
  await gameWait(0.45);
  await shot('15-penalty-aim');
  await page.keyboard.up('Space');
  await gameWait(1.4);
  await shot('16-penalty-result');
  await gameWait(3.0);
  await shot('17-penalty-keeper');
  console.log('penalties', await state());

  // Practice + settings.
  await key('Escape');
  await sleep(300);
  await click('[data-action=quit]');
  await page.waitForFunction(() => window.__game.state === 'menu', { timeout: 20000 });
  await click('[data-action=practice]');
  await gameWait(2.5);
  await shot('18-practice');
  await key('Escape');
  await sleep(300);
  await click('[data-action=settings]');
  await sleep(400);
  await shot('19-settings');
  await click('[data-action=tab][data-v=controls]');
  await sleep(300);
  await shot('20-controls');
  await click('[data-action=back]');
  await sleep(300);
  await click('[data-action=quit]');
  await sleep(1500);
  await click('[data-action=howto]');
  await sleep(400);
  await shot('21-howto');

  // First-launch tutorial offer, then the interactive tutorial.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('floodlight-fc-settings-v1'));
    s.tutorialSeen = false;
    localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 60000 });
  await click('.menu [data-action=play]');
  await sleep(400);
  await shot('22-tutorial-offer');
  await click('[data-action=tutorial]');
  await page.waitForFunction(() => window.__game.state === 'playing' && window.__game.mode === 'practice', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.tutorial').hidden, { timeout: 10000 });
  await page.keyboard.down('KeyD');
  await gameWait(2.5);
  await page.keyboard.up('KeyD');
  await gameWait(1.5);
  const step = await page.evaluate(() => document.querySelector('.tutorial .step')?.textContent);
  console.log('tutorial step now:', step);
  await shot('23-tutorial');
  if (!step || !/Step 2/.test(step)) throw new Error('Tutorial did not advance past movement: ' + step);
} catch (e) {
  console.error('❌ Smoke test failed:', e);
  await shot('error').catch(() => {});
  errors.push(String(e));
} finally {
  await browser.close();
  await server?.close();
}

const real = errors.filter((e) => !/GPU stall|swiftshader|WebGL.*performance/i.test(e));
if (real.length) {
  console.error(`❌ ${real.length} console error(s):`);
  for (const e of real.slice(0, 20)) console.error('  -', e);
  process.exit(1);
}
console.log('✅ Browser smoke test passed with no console errors');
