/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Mobile / touch check with device emulation (NOT a substitute for real devices):
// emulates a phone in landscape with touch, starts a match by tapping, drives the virtual joystick
// and buttons with real touch events, and checks the page never scrolls or zooms.
//   node scripts/mobile-check.mjs → screenshots/mobile/*.png
import { createServer } from 'vite';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';
mkdirSync('screenshots/mobile', { recursive: true });
const server = await createServer({ server: { port: 5208, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const dev = KnownDevices['iPhone 13 landscape'] ?? KnownDevices['iPhone X landscape'];
await page.emulate(dev);
await page.emulateMediaFeatures([{ name: 'pointer', value: 'coarse' }]).catch(() => {});
await page.goto('http://127.0.0.1:5208/', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear()); // first launch → device profile
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 180000 });
const profile = await page.evaluate(() => ({
  quality: window.__game.settings.quality,
  frameRate: window.__game.settings.frameRate,
  coarse: matchMedia('(pointer: coarse)').matches,
}));
await page.screenshot({ path: 'screenshots/mobile/00-menu.png' });
// Tap "Play".
const box = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.offsetParent);
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.touchscreen.tap(box.x, box.y);
await page
  .waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 })
  .catch(async () => {
    // The first-time tutorial offer may appear: skip it.
    await page.evaluate(() => [...document.querySelectorAll('[data-action=skipTutorial]')].find((e) => e.offsetParent)?.click());
    await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
  });
await page.evaluate(() => {
  const g = window.__game;
  g.cam.cinematic = null;
  g.match.phase = 'playing';
  g.match.world.restrictTouchTo = null;
});
await new Promise((r) => setTimeout(r, 1500));
const touchVisible = await page.evaluate(() => !document.querySelector('.touch').hidden);
// Drag the joystick to the right (left half of the screen).
const vw = dev.viewport.width,
  vh = dev.viewport.height;
const x0 = await page.evaluate(() => window.__game.match.human.pos.x);
const cdp = await page.createCDPSession();
const tp = (type, x, y, id = 1) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id }] });
await tp('touchStart', vw * 0.2, vh * 0.7);
for (let i = 1; i <= 6; i++) await tp('touchMove', vw * 0.2 + i * 8, vh * 0.7);
await new Promise((r) => setTimeout(r, 1500));
const mid = await page.evaluate(() => ({ x: window.__game.match.human.pos.x, move: { ...window.__game.input.frame.move } }));
await page.screenshot({ path: 'screenshots/mobile/01-joystick.png' });
await tp('touchEnd');
// Tap the pass button.
const btn = await page.evaluate(() => {
  const r = document.querySelector('.tb-b').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: document.querySelector('.tb-b').textContent };
});
await page.touchscreen.tap(btn.x, btn.y);
await new Promise((r) => setTimeout(r, 1000));
const scroll = await page.evaluate(() => ({ scrollY: window.scrollY, scale: window.visualViewport?.scale ?? 1 }));
await page.screenshot({ path: 'screenshots/mobile/02-after-pass.png' });
console.log(
  JSON.stringify({ profile, touchVisible, humanMovedRight: +(mid.x - x0).toFixed(2), moveVector: mid.move, passButton: btn.label, scroll, errors }, null, 1),
);
await browser.close();
await server.close();
