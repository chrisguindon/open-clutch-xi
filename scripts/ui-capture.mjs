/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// UI screenshots: menu (incl. new-controls offer), team selection, about, controls, match with the
// advertising boards, penalties (shooter + keeper cues), full time, phone layouts.
//   node scripts/ui-capture.mjs → screenshots/ui/*.png
import { createServer } from 'vite';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';
const OUT = 'screenshots/ui';
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5214, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
async function open(settings, device) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  if (device) {
    await page.emulate(device);
    await page.emulateMediaFeatures([{ name: 'pointer', value: 'coarse' }]).catch(() => {});
  }
  await page.goto('http://127.0.0.1:5214/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify(s)), {
    quality: 'medium',
    deviceProfileApplied: true,
    tutorialSeen: true,
    bindingsVersion: 2,
    ...settings,
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 180000 });
  await sleep(1200);
  return page;
}
const click = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.offsetParent).click(), sel);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` }).then(() => console.log('📸', name));
try {
  let p = await open({ homeTeam: 'ARG', awayTeam: 'BRA' });
  await shot(p, '01-menu');
  await click(p, '.menu [data-action=setup]');
  await sleep(1500);
  await shot(p, '02-team-select');
  await click(p, '.setup [data-action=region][data-v="Africa"]');
  await sleep(800);
  await shot(p, '03-team-select-africa');
  await click(p, '.setup [data-action=back]');
  await click(p, '.menu [data-action=about]');
  await sleep(800);
  await shot(p, '04-about');
  await click(p, '.about [data-action=back]');
  await click(p, '.menu [data-action=howto]');
  await sleep(600);
  await shot(p, '05-controls-help');
  await click(p, '.howto [data-action=back]');
  await click(p, '.menu [data-action=settings]');
  await click(p, '[data-action=tab][data-v=controls]');
  await sleep(600);
  await shot(p, '06-settings-controls');
  await p.close();
  // Returning player on the old default keys: one-time offer.
  p = await open({
    bindingsVersion: undefined,
    bindings: {
      up: ['KeyW', 'ArrowUp'],
      down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      sprint: ['ShiftLeft', 'ShiftRight'],
      shoot: ['Space'],
      pass: ['KeyJ'],
      through: ['KeyK'],
      lob: ['KeyI'],
      tackle: ['KeyL'],
      switch: ['KeyQ'],
      skill: ['KeyE'],
      pause: ['Escape', 'KeyP'],
      camera: ['KeyC'],
      reset: ['KeyR'],
    },
  });
  await shot(p, '07-menu-new-controls-offer');
  await p.close();
  // Match: Spain v Portugal (kit clash → Portugal away kit); wait for the board panel to scroll past.
  p = await open({ homeTeam: 'ESP', awayTeam: 'POR', format: '5v5' });
  await click(p, '.menu [data-action=play]');
  await p.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
  await p.evaluate(() => {
    const g = window.__game;
    g.cam.cinematic = null;
    g.cam.cut();
  });
  await sleep(2500);
  await shot(p, '08-match-esp-por');
  await p.evaluate(() => {
    const g = window.__game,
      m = g.match;
    m.clock = m.options.duration - 0.3;
    m.phase = 'playing';
    m.world.restrictTouchTo = null;
  });
  await p.waitForFunction(() => window.__game.state === 'fulltime', { timeout: 60000 });
  await sleep(800);
  await shot(p, '09-full-time');
  await p.close();
  // Penalties: shooter view with reticle, then keeper view with cue.
  p = await open({ homeTeam: 'MAR', awayTeam: 'CRO' });
  await click(p, '.menu [data-action=penalties]');
  await p.waitForFunction(() => window.__game.state === 'playing' && window.__game.match.phase === 'penReady', { timeout: 120000 });
  await sleep(1800);
  await p.keyboard.down('KeyD');
  await sleep(250);
  await p.keyboard.up('KeyD');
  await p.keyboard.down('KeyJ');
  await sleep(500);
  await shot(p, '10-penalty-aim');
  await p.keyboard.up('KeyJ');
  await p.waitForFunction(() => window.__game.match.restart?.team === 1 && window.__game.match.phase === 'penRunup', { timeout: 60000 });
  await p.waitForFunction(() => window.__game.match.penaltyInfo().timeToStrike < 0.3 || window.__game.match.phase === 'penFlight', {
    timeout: 20000,
    polling: 'raf',
  });
  await shot(p, '11-penalty-keeper-cue');
  await p.close();
  // Phone (landscape): menu + team select + touch controls in play.
  const phone = KnownDevices['iPhone 13 landscape'] ?? KnownDevices['iPhone X landscape'];
  p = await open({ homeTeam: 'JPN', awayTeam: 'KOR', quality: 'low' }, phone);
  await shot(p, '12-phone-menu');
  await click(p, '.menu [data-action=setup]');
  await sleep(1200);
  await shot(p, '13-phone-team-select');
  await click(p, '.setup [data-action=play]');
  await p.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
  await p.evaluate(() => {
    window.__game.cam.cinematic = null;
  });
  await sleep(2500);
  await shot(p, '14-phone-match');
  await p.close();
} finally {
  console.log('errors', errors);
  await browser.close();
  await server.close();
}
