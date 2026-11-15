/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Captures the player journey as a brand-new player sees it, for UX reviews
// (docs/gameplay/EXPERIENCE_REVIEW.md): first launch → controls chooser → menu → team selection →
// how to play → settings (incl. saved data) → kick-off → playing → pause → full time → records; desktop
// and phone sizes (the phone run uses touch, so How to Play shows touch controls).
// Screenshots only — whether the game is enjoyable can only be judged by people.
//   node scripts/journey-capture.mjs   → screenshots/journey/
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = 'screenshots/journey';
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5216, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function journey(label, viewport, touch) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  await page.setViewport({ ...viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const shot = async (name) => {
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${label}-${name}.png` });
    console.log(`📸 ${label}-${name}`);
  };
  const click = async (sel) => {
    const h = await page.waitForSelector(sel, { visible: true, timeout: 30000 });
    await h.click();
    await sleep(300);
  };
  await page.goto('http://127.0.0.1:5216/', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && ['menu'].includes(window.__game.state), { timeout: 120000 });
  await sleep(1500);
  await shot('01-first-launch');
  if (await page.$('.chooser:not([hidden])')) {
    await click('.choice[data-v=keyboard]');
    // First launch offers the tutorial straight after the chooser.
    await shot('01b-tutorial-offer');
    await click('[data-action=tutorialLater]').catch(() => null);
  }
  await shot('02-menu');
  await click('.menu [data-action=setup]');
  await shot('03-team-select');
  await page.keyboard.press('Escape');
  await sleep(300);
  await click('.menu [data-action=howto]').catch(() => null);
  await shot('04-how-to-play');
  await page.keyboard.press('Escape');
  await sleep(300);
  await click('.menu [data-action=settings]').catch(() => null);
  for (const tab of ['game', 'graphics', 'audio', 'controls', 'data']) {
    await click(`.settings [data-action=tab][data-v=${tab}]`).catch(() => null);
    await shot(`05-settings-${tab}`);
  }
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.evaluate(() => {
    const s = window.__game.settings;
    s.tutorialSeen = false; // also show the Kick Off offer (for players who skipped the chooser)
    s.quality = 'low';
    s.graphicsMode = 'manual';
  });
  await click('.menu [data-action=play]');
  await sleep(800);
  await shot('06-after-kick-off-press');
  // A first-time player may be offered the tutorial; skip it to reach a match.
  const offer = await page.$('.screen:not([hidden]) [data-action=skipTutorial], .screen:not([hidden]) [data-action=noTutorial]');
  if (offer) await offer.click();
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 }).catch(() => null);
  await sleep(1500);
  await shot('07-kick-off');
  await page.evaluate(() => {
    window.__game.cam.cinematic = null;
  });
  await page.waitForFunction(() => window.__game.match.world.time > 6, { timeout: 180000, polling: 100 }).catch(() => null);
  await shot('08-playing');
  await page.keyboard.press('Escape');
  await sleep(600);
  await shot('09-pause');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const m = window.__game.match;
    m.score[0] = 2;
    m.score[1] = 1;
    m.clock = m.options.duration - 0.2;
  });
  await page.waitForFunction(() => window.__game.state === 'fulltime', { timeout: 180000 }).catch(() => null);
  await sleep(1500);
  await shot('10-full-time');
  // After the final whistle the match is in the local record: Records shows it.
  await click('.fulltime [data-action=quit]').catch(() => null);
  await page.waitForFunction(() => window.__game.state === 'menu', { timeout: 60000 }).catch(() => null);
  await click('.menu [data-action=records]').catch(() => null);
  await shot('11-records');
  await page.close();
}

await journey('desktop', { width: 1280, height: 720 }, false);
await journey('phone', { width: 844, height: 390 }, true);
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
await server.close();
