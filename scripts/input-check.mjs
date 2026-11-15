/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Verifies the real-input diagnostics in a browser: plays with real key presses (direction changes,
// passes, shots, switches) and reads the F3 tracker; checks benchmark validity flags (focus loss mid-run);
// and runs the guided CPU check.  node scripts/input-check.mjs
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';
mkdirSync('screenshots/input', { recursive: true });
const server = await createServer({ server: { port: 5209, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 480, height: 270 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://127.0.0.1:5209/', { waitUntil: 'load' });
await page.evaluate(() =>
  localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ quality: 'low', tutorialSeen: true, format: '5v5', deviceProfileApplied: true })),
);
await page.goto('http://127.0.0.1:5209/?diag', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
await page.evaluate(() => [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.offsetParent).click());
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
await page.evaluate(() => {
  const g = window.__game;
  g.cam.cinematic = null;
  g.match.phase = 'playing';
  g.match.world.restrictTouchTo = null;
  g.diag.reset();
});
for (let i = 0; i < 10; i++) {
  const k = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'][i % 4];
  await page.keyboard.down(k);
  await sleep(500);
  await page.keyboard.up(k);
  await sleep(150);
  // Give the human the ball, then pass / shoot / switch.
  await page.evaluate(() => {
    const g = window.__game,
      w = g.match.world,
      h = g.match.human;
    w.ball.reset(h.footX(0.5), h.footZ(0.5));
    w.clearPossession();
    g.match.phase = 'playing';
  });
  await sleep(250);
  await page.keyboard.down(i % 2 ? 'KeyK' : 'KeyJ');
  await sleep(70);
  await page.keyboard.up(i % 2 ? 'KeyK' : 'KeyJ');
  await sleep(500);
  await page.keyboard.press('KeyQ');
  await sleep(300);
}
const live = await page.evaluate(() => window.__game.diag.summary());
console.log(
  'bindings pass/shoot/switch:',
  await page.evaluate(() => [window.__game.settings.bindings.pass, window.__game.settings.bindings.shoot, window.__game.settings.bindings.switch]),
);
console.log('display', live.displayHz, 'limiter', JSON.stringify(live.frameLimiter), 'validity', JSON.stringify(live.validity));
console.log(
  'inputActions',
  JSON.stringify(live.inputActions, (k, v) => (k === 'note' ? undefined : v)),
);
// Benchmark validity: a blur mid-run must be flagged, and the game must not pause.
await page.goto('http://127.0.0.1:5209/?bench=quick', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.bench?.running, { timeout: 120000 });
await sleep(4000);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
const stateAfterBlur = await page.evaluate(() => window.__game.state);
await page.waitForFunction(() => !!window.__benchReport, { timeout: 1500000, polling: 2000 });
const rep = await page.evaluate(() =>
  window.__benchReport.results.map((r) => ({
    v: r.variant,
    valid: r.summary.validity.valid,
    live: r.summary.validity.liveFramePct,
    warn: r.summary.validity.warnings,
    fl: r.summary.frameLimiter,
    hz: r.summary.displayHz,
  })),
);
await page.screenshot({ path: 'screenshots/input/bench-validity.png' });
console.log('state after blur during benchmark:', stateAfterBlur);
console.log(
  rep.map((r) => `${r.valid ? ' ' : '!'} ${r.v.padEnd(32)} live ${r.live}% limiter ${r.fl.setting}->${r.fl.targetFps} ${r.warn.join('; ')}`).join('\n'),
);
writeFileSync('screenshots/input/input-check.json', JSON.stringify({ live, bench: rep, errors }, null, 1));
console.log('errors', errors);
await browser.close();
await server.close();
