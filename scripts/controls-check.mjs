/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Controls in a real browser with real (CDP) mouse and keyboard input:
//  - first launch shows "How would you like to play?"; the choice is remembered; Skip works
//  - keyboard & mouse: left / right / middle click on the pitch press shoot / pass / through;
//    clicks on menus never press game buttons; the context menu is suppressed on the pitch
//  - rebinding by clicking a mouse button (and the click doesn't also press the UI underneath)
//  - controller (emulated Standard Gamepad): chooser enables it, remap by pressing a button, button works in play
// The controller is EMULATED (navigator.getGamepads overridden) — not a real device test.
//   node scripts/controls-check.mjs
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';
mkdirSync('screenshots/controls', { recursive: true });
const server = await createServer({ server: { port: 5213, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const URL = 'http://127.0.0.1:5213/';
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 960, height: 540 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};
const errors = [];

async function newPage(fakePad) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Couldn't load texture blob/.test(m.text())) errors.push(m.text());
  });
  if (fakePad) {
    await page.evaluateOnNewDocument(() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
      const pad = { id: 'Emulated Standard Gamepad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
      window.__pad = { pad, on: false };
      navigator.getGamepads = () => [window.__pad.on ? pad : null, null, null, null];
      window.__press = (i, down) => {
        buttons[i].pressed = down;
        buttons[i].value = down ? 1 : 0;
        pad.timestamp = performance.now();
      };
    });
  }
  return page;
}
async function waitMenu(page) {
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
  await sleep(300);
}
const visible = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return !!e && !!e.offsetParent;
  }, sel);
const clickSel = async (page, sel) => {
  const h = await page.waitForSelector(sel, { visible: true, timeout: 20000 });
  await h.click();
  await sleep(250);
};
/** Collect the gameplay presses the input layer produces. */
const hookPresses = (page) =>
  page.evaluate(() => {
    const g = window.__game;
    window.__presses = [];
    const inner = g.input.poll.bind(g.input);
    g.input.poll = (a, b) => {
      const f = inner(a, b);
      window.__presses.push(...g.input.events.presses);
      return f;
    };
  });
const presses = (page) =>
  page.evaluate(() => {
    const p = window.__presses.slice();
    window.__presses.length = 0;
    return p;
  });

// 1) First launch: chooser, keyboard & mouse, remembered.
{
  const page = await newPage(false);
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && document.querySelector('.chooser') && document.querySelector('.chooser').offsetParent, { timeout: 120000 });
  await page.screenshot({ path: 'screenshots/controls/01-chooser.png' });
  check(true, 'first launch shows "How would you like to play?"');
  check(
    await page.evaluate(() => document.querySelector('.choice[data-v=controller]').disabled),
    'Controller option disabled with "connect it" hint when no controller is connected',
  );
  await clickSel(page, '.choice[data-v=keyboardMouse]');
  const s1 = await page.evaluate(() => ({ scheme: window.__game.settings.controlScheme, chosen: window.__game.settings.controlsChosen }));
  check(s1.scheme === 'keyboardMouse' && s1.chosen, `choosing Keyboard & mouse is saved (${JSON.stringify(s1)})`);
  // First launch: the tutorial is offered right after the chooser; "Not now" goes to the menu, once.
  check(await visible(page, '[data-action=tutorialLater]'), 'after choosing, the tutorial is offered (welcome)');
  await clickSel(page, '[data-action=tutorialLater]');
  check(
    (await visible(page, '.menu')) && (await page.evaluate(() => window.__game.settings.tutorialSeen)),
    '"Not now" goes to the menu and the offer is not repeated',
  );
  await page.reload({ waitUntil: 'load' });
  await waitMenu(page);
  check(!(await visible(page, '.chooser')) && (await visible(page, '.menu')), 'choice is remembered: no chooser on the next visit');

  // Clicks on the menu never press game buttons.
  await hookPresses(page);
  await page.mouse.click(480, 300, { button: 'right' });
  await page.mouse.click(30, 30);
  await sleep(300);
  check((await presses(page)).length === 0, 'mouse clicks on menus do not press game buttons');

  // 2) In play: left / right / middle click.
  await page.evaluate(() => {
    const s = window.__game.settings;
    s.quality = 'low';
    s.graphicsMode = 'manual';
    s.tutorialSeen = true;
  });
  await page.evaluate(() => window.__game.startMatch('match'));
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.cam.cinematic = null;
    g.match.phase = 'playing';
    g.match.world.restrictTouchTo = null;
  });
  await sleep(500);
  await presses(page);
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const clickAndRead = async (button) => {
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button });
    await sleep(220);
    await page.mouse.up({ button });
    await sleep(1500);
    return presses(page);
  };
  const L = await clickAndRead('left'),
    R = await clickAndRead('right'),
    M = await clickAndRead('middle');
  check(L.includes('shoot'), `left click → shoot (${L})`);
  check(R.includes('pass'), `right click → pass (${R})`);
  check(M.includes('through'), `middle click → through ball (${M}) — also on Q, never middle-only`);
  const ctx = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    c.dispatchEvent(e);
    return e.defaultPrevented;
  });
  check(ctx, 'context menu suppressed on the pitch');
  await page.keyboard.press('KeyQ');
  await sleep(1500);
  check((await presses(page)).includes('through'), 'Q → through ball (keyboard alternative to middle click)');

  // 3) Rebind by clicking: Skill → right click (pass takes Skill's old key, F).
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.state === 'paused', { timeout: 20000 });
  await clickSel(page, '.pause [data-action=settings]');
  await clickSel(page, '.settings [data-action=tab][data-v=controls]');
  await page.screenshot({ path: 'screenshots/controls/02-kbm-settings.png' });
  await clickSel(page, '[data-action=rebind][data-key=skill]');
  // Right-click on top of the "Done" button: it must bind, not close settings.
  const done = await page.$('.settings [data-action=back]');
  const db = await done.boundingBox();
  await page.mouse.click(db.x + db.width / 2, db.y + db.height / 2, { button: 'right' });
  await sleep(400);
  const kb = await page.evaluate(() => ({
    skill: window.__game.settings.kbmBindings.skill,
    pass: window.__game.settings.kbmBindings.pass,
    keys: window.__game.settings.bindings.pass,
  }));
  check(kb.skill[0] === 'Mouse2' && kb.pass.includes('KeyF'), `rebind by right click: Skill → Right click, Pass → F (${JSON.stringify(kb)})`);
  check(kb.keys[0] === 'Space', 'keyboard-only layout untouched by keyboard & mouse changes');
  check(await visible(page, '.settings'), 'the rebinding click did not also press the button underneath');
  await page.screenshot({ path: 'screenshots/controls/03-rebound.png' });
  // Settings → Controls → chooser is reachable.
  await clickSel(page, '[data-action=chooser]');
  check(await visible(page, '.chooser'), 'chooser reachable from Settings → Controls');
  await clickSel(page, '.chooser [data-action=back]');
  check(await visible(page, '.settings'), 'Back from the chooser returns to Settings');
  await page.close();
}

// 4) Skip on first launch.
{
  const page = await newPage(false);
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.chooser')?.offsetParent, { timeout: 120000 });
  await clickSel(page, '[data-action=chooseSkip]');
  const s = await page.evaluate(() => ({ scheme: window.__game.settings.controlScheme, chosen: window.__game.settings.controlsChosen }));
  check(s.scheme === 'keyboard' && s.chosen && (await visible(page, '.menu')), `Skip → keyboard, remembered (${JSON.stringify(s)})`);
  await page.close();
}

// 5) Controller (emulated).
{
  const page = await newPage(true);
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.chooser')?.offsetParent, { timeout: 120000 });
  await page.evaluate(() => {
    window.__pad.on = true;
    const e = new Event('gamepadconnected');
    e.gamepad = window.__pad.pad;
    window.dispatchEvent(e);
  });
  await page.waitForFunction(() => !document.querySelector('.choice[data-v=controller]').disabled, { timeout: 5000 }).catch(() => null);
  check(await page.evaluate(() => !document.querySelector('.choice[data-v=controller]').disabled), 'Controller option enabled once a controller connects');
  await clickSel(page, '.choice[data-v=controller]');
  await page.evaluate(() => {
    window.__game.ui.showSettings();
  });
  await clickSel(page, '.settings [data-action=tab][data-v=controls]');
  await clickSel(page, '[data-action=rebindPad][data-key=shoot]');
  await page.evaluate(() => window.__press(3, true));
  await sleep(1500);
  await page.evaluate(() => window.__press(3, false));
  await sleep(1500);
  const pb = await page.evaluate(() => window.__game.settings.padBindings);
  check(pb.shoot[0] === 3 && pb.through[0] === 1, `remap Shoot → Y; Through ball takes B (${JSON.stringify({ shoot: pb.shoot, through: pb.through })})`);
  await page.screenshot({ path: 'screenshots/controls/04-pad-settings.png' });
  check(await visible(page, '.settings'), 'remap press did not also act on the menu');
  await page.evaluate(() => {
    const s = window.__game.settings;
    s.quality = 'low';
    s.graphicsMode = 'manual';
    s.tutorialSeen = true;
    window.__game.ui.hide();
    window.__game.startMatch('match');
  });
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.cam.cinematic = null;
    g.match.phase = 'playing';
    g.match.world.restrictTouchTo = null;
  });
  await hookPresses(page);
  await sleep(300);
  await presses(page);
  await page.evaluate(() => window.__press(3, true));
  await sleep(2500);
  await page.evaluate(() => window.__press(3, false));
  await sleep(2500);
  const pp = await presses(page);
  check(pp.includes('shoot'), 'remapped Y shoots in play');
  const hint = await page.evaluate(() => {
    const h = document.querySelector('.hud-hint');
    return h ? h.textContent : '';
  });
  console.log('     hud hint:', hint);
  await page.close();
}

check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
