/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// The rotate screen for phones in portrait (src/ui/orientation.ts), in a real browser:
//   node scripts/orientation-check.mjs → screenshots/orientation/*.png
// An emulated phone is turned between portrait and landscape (viewport and screen orientation), with
// real taps: the screen covers everything and blocks taps; a running match pauses and resumes; a match
// paused by the player stays paused; the address bar resizing the window doesn't flip it; tablets and
// desktop windows are never blocked. Emulation only: rotation on a real phone still needs checking.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = 'screenshots/orientation';
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5217, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (page, fn, arg, timeout = 30000) =>
  page.waitForFunction(fn, { timeout, polling: 100 }, arg).then(
    () => true,
    () => false,
  );

/** Opens the game with the given viewport; returns the page. */
async function open(viewport, coarse) {
  const page = await browser.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.setViewport(viewport);
  // (Chrome's mobile + touch emulation makes `(pointer: coarse)` match; Puppeteer can't emulate it alone.)
  await page.goto('http://127.0.0.1:5217/', { waitUntil: 'load' });
  await page.evaluate((touch) => {
    localStorage.setItem(
      'floodlight-fc-settings-v1',
      JSON.stringify({
        quality: 'low',
        format: '5v5',
        tutorialSeen: true,
        controlsChosen: true,
        deviceProfileApplied: true,
        replays: 'off',
        controlScheme: touch ? 'touch' : 'keyboard',
      }),
    );
  }, coarse);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 180000 });
  return page;
}
const screenState = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.orientation-screen');
    const r = el && !el.hidden ? el.getBoundingClientRect() : null;
    const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      visible: !!r,
      covers: !!r && r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight,
      onTop: !!el && el.contains(top),
      inert: document.getElementById('app').inert,
      pausedLine: !!el && !el.querySelector('.orientation-paused').hidden,
      state: window.__game.state,
      time: window.__game.match?.world.time ?? 0,
    };
  });
const phonePortrait = { width: 390, height: 844, isMobile: true, hasTouch: true, isLandscape: false, deviceScaleFactor: 1 };
const phoneLandscape = { width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true, deviceScaleFactor: 1 };
const rotate = async (page, vp) => {
  await page.setViewport(vp);
  await sleep(400);
};
const tapCentreOf = async (page, selector) => {
  const box = await page.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (box) await page.touchscreen.tap(box.x, box.y);
  return !!box;
};

// --- A phone ---
{
  console.log('\nPhone (390×844), held upright then turned');
  const page = await open(phonePortrait, true);
  let s = await screenState(page);
  check(s.visible && s.covers && s.onTop, 'upright at the menu: the rotate screen covers the whole screen, on top of everything');
  check(s.inert, 'the game behind it is inert (no taps, no keyboard focus)');
  await page.screenshot({ path: `${OUT}/phone-portrait-menu.png` });
  // Try to start a match by tapping where the Kick Off button is: nothing must happen.
  const kickOff = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.getClientRects().length);
    const r = b?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });
  if (kickOff) await page.touchscreen.tap(kickOff.x, kickOff.y);
  await page.keyboard.press('Enter');
  await sleep(800);
  check((await screenState(page)).state === 'menu', 'taps and key presses don’t reach the game (still on the menu)');

  await rotate(page, phoneLandscape);
  s = await screenState(page);
  check(!s.visible && !s.inert, 'turned sideways: the rotate screen disappears by itself and the game works again');
  check(await tapCentreOf(page, '.menu [data-action=play]'), 'Kick Off can be tapped in landscape');
  check(await until(page, () => window.__game.state === 'playing', undefined, 120000), 'the match starts');
  await until(page, () => !window.__game.cam.cinematic && window.__game.match.phase !== 'kickoff', undefined, 120000);
  await sleep(1000);

  // Turn upright during the match.
  const t0 = (await screenState(page)).time;
  await rotate(page, phonePortrait);
  s = await screenState(page);
  check(s.visible && s.covers && s.onTop && s.inert, 'upright during the match: the rotate screen covers the game');
  check(s.state === 'paused', `the match pauses (state ${s.state})`);
  check(s.pausedLine, 'the screen says the match is paused and will carry on');
  await page.screenshot({ path: `${OUT}/phone-portrait-match.png` });
  await sleep(1500);
  const t1 = (await screenState(page)).time;
  check(Math.abs(t1 - (s.time ?? t1)) < 0.05 && t1 >= t0, `game time stands still while upright (${t0.toFixed(2)} → ${t1.toFixed(2)} s)`);

  // The address bar showing/hiding changes the window height, not the orientation.
  await page.setViewport({ ...phonePortrait, height: 760 });
  await sleep(300);
  s = await screenState(page);
  check(s.visible && s.state === 'paused', 'the address bar resizing the window keeps the screen up and the match paused');

  await rotate(page, phoneLandscape);
  s = await screenState(page);
  check(!s.visible && !s.inert, 'turned back: the rotate screen disappears');
  check(s.state === 'playing', `the match resumes by itself (state ${s.state})`);
  const t2 = s.time;
  await sleep(1500);
  check((await screenState(page)).time > t2, 'game time runs again');
  check(
    await page.evaluate(() => !!document.querySelector('.player-card')?.getClientRects().length && document.body.classList.contains('touch-ui')),
    'the touch HUD and player card are back',
  );
  await page.screenshot({ path: `${OUT}/phone-landscape-resumed.png` });

  // A match the player paused stays paused after turning upright and back.
  check(await tapCentreOf(page, '.touch-pause'), 'pause button tapped');
  check(await until(page, () => window.__game.state === 'paused'), 'paused by the player');
  await rotate(page, phonePortrait);
  check((await screenState(page)).visible, 'upright while paused: the rotate screen appears');
  await rotate(page, phoneLandscape);
  s = await screenState(page);
  check(!s.visible && s.state === 'paused', `turned back: a match the player paused stays paused (state ${s.state})`);
  check(page.errors.length === 0, `no page errors${page.errors.length ? ` (${page.errors[0]})` : ''}`);
  await page.close();
}

// --- A2: a match that starts while the phone is upright (not possible by tapping, but by code paths) ---
{
  console.log('\nPhone upright when a match starts');
  const page = await open(phonePortrait, true);
  await page.evaluate(() => window.__game.startMatch('match'));
  await sleep(1000);
  let s = await screenState(page);
  check(s.visible && s.state === 'paused', `the match starts paused behind the rotate screen (state ${s.state})`);
  await rotate(page, phoneLandscape);
  s = await screenState(page);
  check(!s.visible && s.state === 'playing', `turning sideways starts it (state ${s.state})`);
  await page.close();
}

// --- B: a phone opened in landscape ---
{
  console.log('\nPhone opened in landscape');
  const page = await open(phoneLandscape, true);
  const s = await screenState(page);
  check(!s.visible && !s.inert, 'no rotate screen in landscape');
  await page.close();
}

// --- C: a tablet held upright ---
{
  console.log('\nTablet (820×1180), upright');
  const page = await open({ width: 820, height: 1180, isMobile: true, hasTouch: true, isLandscape: false, deviceScaleFactor: 1 }, true);
  const s = await screenState(page);
  check(!s.visible && !s.inert, 'tablets have room to play upright: no rotate screen');
  await page.screenshot({ path: `${OUT}/tablet-portrait.png` });
  await page.close();
}

// --- D: a tall, narrow desktop window ---
{
  console.log('\nDesktop window (420×900, mouse)');
  const page = await open({ width: 420, height: 900, deviceScaleFactor: 1 }, false);
  const s = await screenState(page);
  check(!s.visible && !s.inert, 'desktop windows are never blocked, whatever their shape');
  await page.close();
}

await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
