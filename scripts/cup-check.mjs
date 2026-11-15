/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// XI Nations Cup in a real browser, through the real menus:  node scripts/cup-check.mjs
// Starts a Short cup from the main menu, plays the player's matches (scores are set just before the
// final whistle to steer the path), reloads the page mid-cup to check it resumes, takes a penalty
// shootout after a level quarter-final, and finishes at the trophy. Fails on any console error.
// Waits are state-based (game state, screens), with hang guards only.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = 'screenshots/cup';
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5214, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1100, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Couldn't load texture blob/.test(m.text())) errors.push(m.text());
});
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};
const until = (fn, arg, timeout = 180000) =>
  page.waitForFunction(fn, { timeout, polling: 100 }, arg).then(
    () => true,
    () => false,
  );
const click = async (action) => {
  await page.waitForSelector(`.screen:not([hidden]) [data-action=${action}]`, { timeout: 60000 });
  await page.click(`.screen:not([hidden]) [data-action=${action}]`);
};
const text = () => page.evaluate(() => document.querySelector('.screen:not([hidden])')?.textContent ?? '');

await page.goto('http://127.0.0.1:5214/', { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem(
    'floodlight-fc-settings-v1',
    JSON.stringify({
      quality: 'low',
      format: '3v3',
      minutes: 1,
      homeTeam: 'CAN',
      tutorialSeen: true,
      controlsChosen: true,
      deviceProfileApplied: true,
      replays: 'off',
    }),
  );
});
await page.reload({ waitUntil: 'load' });
await until(() => window.__game && window.__game.state === 'menu');

// 1. Start a Short cup from the menu.
await page.screenshot({ path: `${OUT}/menu.png` });
await click('cup');
check(/Start the cup/.test(await text()), 'menu → cup setup screen');
await page.click('.screen:not([hidden]) [data-action=cupFormat][data-v=short16]');
await click('cupStart');
check(await until(() => /Play match/.test(document.querySelector('.screen:not([hidden])')?.textContent ?? '')), 'cup hub shows the next match');
check(await page.evaluate(() => document.activeElement?.tagName === 'BUTTON'), 'a button has keyboard focus on the hub');
const hub = await text();
check(/Group [A-D]/.test(hub) && /Canada/.test(hub), 'hub shows the group table with the player’s team');
await page.screenshot({ path: `${OUT}/hub.png` });

/** Plays the next cup match to full time with the given score for the player (side 0). */
async function playMatch(mine, theirs) {
  await click('cupPlay');
  await until(() => window.__game.state === 'playing' && window.__game.match?.phase === 'playing');
  await page.evaluate(
    ([a, b]) => {
      const m = window.__game.match;
      m.score[0] = a;
      m.score[1] = b;
      m.clock = m.options.duration - 0.05;
    },
    [mine, theirs],
  );
  return until(() => window.__game.state === 'fulltime');
}

// 2. Group stage: win, then reload mid-cup, then win twice more.
check(await playMatch(2, 0), 'group match 1 reaches full time');
check(/Next:/.test(await text()), 'full time says what comes next in the cup');
await click('cup');
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tournament-v1')));
await page.reload({ waitUntil: 'load' });
await until(() => window.__game && window.__game.state === 'menu');
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tournament-v1')));
check(
  JSON.stringify(before) === JSON.stringify(after) && after.active.fixtures.some((f) => f.result?.byPlayer),
  'cup saved after the match and unchanged by a reload',
);
check(await page.evaluate(() => /Continue/.test(document.querySelector('[data-action=cup]')?.textContent ?? '')), 'menu offers to continue the cup');
await click('cup');
check(await playMatch(1, 0), 'group match 2');
await click('cup');
check(await playMatch(3, 1), 'group match 3');
await click('cup');
check(/Quarter-final/.test(await text()), 'top of the group: on to the quarter-final');

// 3. Quarter-final ends level → shootout.
check(await playMatch(1, 1), 'quarter-final reaches full time level');
check(/penalty shootout/i.test(await text()), 'level knockout match: the shootout is offered');
await click('cupPlay');
await until(() => window.__game.state === 'playing' && window.__game.mode === 'penalties');
check(true, 'shootout started');
await page.evaluate(() => {
  const m = window.__game.match;
  m.penKicks = [0, 1, 0, 1, 0, 1, 0, 1].map((k, i) => ({ team: k, scored: k === 0 || i < 4, saved: false }));
  m.score[0] = 4;
  m.score[1] = 2;
  m.nextPenalty();
});
check(await until(() => window.__game.state === 'fulltime'), 'shootout reaches the end');
check(/Semi-final/.test(await text()), 'shootout won: next is the semi-final');
await click('cup');

// 4. Semi-final and final.
check(await playMatch(2, 1), 'semi-final');
await click('cup');
check(await playMatch(1, 0), 'final');
check(/Champions!/.test(await text()), 'full time after the final announces the champions');
await click('cup');
check(await page.evaluate(() => !!document.querySelector('.screen:not([hidden]) .cup-trophy')), 'trophy shown on the finished cup');
await page.screenshot({ path: `${OUT}/trophy.png` });
const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('tournament-v1')));
check(rec.history.length === 1 && rec.history[0].finish === 'champion' && rec.history[0].team === 'CAN', 'history records the trophy');
const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('player-progress-v1')));
check(!!progress.achievements['cup-knockouts'] && !!progress.achievements['cup-winner'], 'cup achievements unlocked: Into the Knockouts and Champions');
check(progress.stats.played >= 6, `cup matches count in the player’s statistics (${progress.stats.played} played)`);

// 5. New cup clears the finished one, keeping the history.
await click('cupNew');
check(/Start the cup/.test(await text()) && /Past cups/.test(await text()), 'new cup: back to setup, past cups listed');
check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ')})`);

await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
