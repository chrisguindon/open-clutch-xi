/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Player visibility and HUD layout on phones and desktops:  node scripts/mobile-hud-check.mjs
// For each viewport (phones in landscape, a phone in portrait, a tablet, desktops) it starts a match,
// freezes a crowded moment (team-mates and opponents tight around the controlled player, the ball at
// their feet), then measures what is on screen and checks that:
//   - the controlled player's name never covers the ball, the controlled player or nearby players;
//   - on touch screens the name is shown in the HUD instead of over the pitch;
//   - HUD panels and touch controls don't overlap each other, and stay inside the safe area;
//   - text stays readable; switching players updates the name.
// Screenshots: screenshots/mobile-hud/<viewport>.png. Emulation only: not a real-device test.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = 'screenshots/mobile-hud';
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [
  { name: 'phone-small-landscape', width: 667, height: 375, touch: true }, // iPhone SE class
  { name: 'phone-landscape', width: 844, height: 390, touch: true }, // iPhone 13/14 class
  { name: 'phone-large-landscape', width: 915, height: 412, touch: true }, // Pixel 7 class
  { name: 'phone-portrait', width: 390, height: 844, touch: true, portrait: true },
  { name: 'tablet-landscape', width: 1180, height: 820, touch: true },
  { name: 'laptop', width: 1366, height: 768, touch: false },
  { name: 'desktop', width: 1920, height: 1080, touch: false },
];
const report = process.argv.includes('--report'); // print measurements, don't fail (for investigations)

const server = await createServer({ server: { port: 5216, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok && !report) failed = true;
};
const overlap = (a, b, pad = 0) => !!a && !!b && a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const inside = (pt, r) => !!r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.touch, hasTouch: vp.touch, deviceScaleFactor: 1 });
  if (vp.touch) await page.emulateMediaFeatures([{ name: 'pointer', value: 'coarse' }]).catch(() => {});
  await page.goto('http://127.0.0.1:5216/', { waitUntil: 'load' });
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
  }, vp.touch);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 180000 });
  await page.evaluate(() => window.__game.startMatch('match'));
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
  // Let the pre-match intro (line-ups, title, camera fly-in) finish: it lasts INTRO_LENGTH (6.4 s).
  await page.waitForFunction(() => !window.__game.cam.cinematic && window.__game.match.phase !== 'kickoff', { timeout: 120000, polling: 200 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  // A crowded moment: the controlled player on the ball near the centre, everyone else close by.
  // The simulation is then frozen (rendering continues), so the measurements are stable.
  const setUp = () =>
    page.evaluate(() => {
      const g = window.__game,
        m = g.match,
        w = m.world;
      g.cam.cinematic = null;
      m.phase = 'playing';
      w.restrictTouchTo = null;
      const h = m.human;
      const dir = w.attackDir(h.team);
      h.place(0, 0, dir > 0 ? 0 : Math.PI);
      w.ball.reset(dir * 0.6, 0);
      const spots = [
        [2.2, 1.5],
        [-1.8, 2.4],
        [1.4, -2.2],
        [3.4, -0.6],
        [-2.6, -1.6],
        [4.2, 2.6],
        [-3.8, 0.8],
        [0.6, 3.4],
      ];
      let i = 0;
      for (const p of w.players) {
        if (p.id === h.id || p.isGK) continue;
        const [x, z] = spots[i++ % spots.length];
        p.place(x * dir, z, 0);
      }
      if (!m.__frozen) {
        m.__frozen = true;
        m.__step = m.step;
        m.step = () => {};
      }
    });
  await setUp();
  await new Promise((r) => setTimeout(r, 1800)); // camera settles on the frozen scene

  const measure = () =>
    page.evaluate(() => {
      const g = window.__game,
        m = g.match,
        w = m.world,
        cam = g.cam.camera;
      const v = cam.position.clone();
      const toScreen = (x, y, z) => {
        v.set(x, y, z).project(cam);
        return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (0.5 - v.y * 0.5) * innerHeight };
      };
      const rect = (sel) => {
        const e = document.querySelector(sel);
        if (!e || e.hidden || e.closest('[hidden]') || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') return null;
        const r = e.getBoundingClientRect();
        return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      };
      const h = m.human;
      const feet = toScreen(h.pos.x, 0, h.pos.z),
        head = toScreen(h.pos.x, 1.8, h.pos.z);
      const bodyH = Math.max(4, feet.y - head.y);
      const body = { x: feet.x - bodyH * 0.25, y: head.y, w: bodyH * 0.5, h: bodyH };
      const ball = toScreen(w.ball.pos.x, 0.11, w.ball.pos.z);
      const others = w.players.filter((p) => p.id !== h.id && Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z) < 5).map((p) => toScreen(p.pos.x, 1.0, p.pos.z));
      const labelEl = document.querySelector('.player-label');
      return {
        touchUi: document.body.classList.contains('touch-ui'),
        rotateNotice: matchMedia('(orientation: portrait) and (pointer: coarse)').matches,
        body,
        ball,
        others,
        label: rect('.player-label'),
        labelText: labelEl && !labelEl.hidden ? labelEl.textContent : null,
        labelFont: labelEl ? parseFloat(getComputedStyle(labelEl).fontSize) : 0,
        cardName: rect('.player-card') ? document.querySelector('.player-card .pname').textContent : null,
        cardFont:
          parseFloat(getComputedStyle(document.querySelector('.player-card .pname')).fontSize) *
          (document.querySelector('.player-card').getBoundingClientRect().width / document.querySelector('.player-card').offsetWidth || 1),
        humanName: m.world.players[m.humanId].name,
        scoreboard: rect('.scoreboard'),
        card: rect('.player-card'),
        minimap: rect('.minimap'),
        hint: rect('.hud-hint'),
        buttons: rect('.touch-buttons'),
        buttonRects: [...document.querySelectorAll('.touch-buttons .tb')]
          .map((b) => b.getBoundingClientRect())
          .filter((r) => r.width)
          .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })),
        stick: rect('.touch-base'),
        pause: rect('.touch-pause'),
        vw: innerWidth,
        vh: innerHeight,
      };
    });
  // On touch screens the name appears briefly when play starts; measure normal play after it fades.
  if (vp.touch && !vp.portrait)
    await page.waitForFunction(() => document.querySelector('.player-label').hidden, { timeout: 30000, polling: 100 }).catch(() => {});
  const s = await measure();
  await page.screenshot({ path: `${OUT}/${vp.name}.png` });
  if (report) console.log(vp.name, JSON.stringify(s));

  console.log(`\n${vp.name} (${vp.width}×${vp.height}, ${vp.touch ? 'touch' : 'mouse/keyboard'})`);
  if (vp.portrait) {
    // Portrait isn't a supported orientation on phones: the game asks to rotate. It must still render cleanly.
    check(s.rotateNotice, 'portrait phone shows the "rotate to landscape" notice');
    check(!overlap(s.label, { x: s.ball.x - 6, y: s.ball.y - 6, w: 12, h: 12 }), 'no name covers the ball');
  } else {
    const ballBox = { x: s.ball.x - 5, y: s.ball.y - 5, w: 10, h: 10 };
    check(!overlap(s.label, ballBox, 2), `the name never covers the ball (${s.label ? 'label shown' : 'no floating label'})`);
    check(!overlap(s.label, s.body, 1), 'the name never covers the controlled player');
    const covered = s.label ? s.others.filter((p) => inside(p, s.label)).length : 0;
    check(covered === 0, `the name covers no nearby player (${covered} of ${s.others.length} covered)`);
    if (s.touchUi) {
      check(s.label === null, 'touch screens: no name floating over the pitch during play');
      check(!!s.cardName && s.cardName.includes(s.humanName), `touch screens: the controlled player is named in the HUD ("${s.cardName}")`);
    } else {
      check(
        s.label !== null && !!s.labelText && s.labelText.includes(s.humanName),
        `mouse/keyboard: the controlled player's name is shown near them ("${s.labelText}")`,
      );
      check(s.labelFont >= 12, `name text is readable (${s.labelFont}px)`);
    }
    check(s.cardFont >= 11, `HUD name text is readable (${s.cardFont.toFixed(1)}px)`);
    const panels = [
      ['scoreboard', s.scoreboard],
      ['player card', s.card],
      ['minimap', s.minimap],
      ['hint', s.hint],
      ['touch buttons', s.buttons],
      ['pause button', s.pause],
    ].filter(([, r]) => r);
    const clashes = [];
    for (let i = 0; i < panels.length; i++)
      for (let j = i + 1; j < panels.length; j++) if (overlap(panels[i][1], panels[j][1])) clashes.push(`${panels[i][0]}/${panels[j][0]}`);
    check(clashes.length === 0, `HUD panels and touch controls don't overlap${clashes.length ? ` (${clashes.join(', ')})` : ''}`);
    const out = panels.filter(([, r]) => r.x < 0 || r.y < 0 || r.x + r.w > s.vw + 0.5 || r.y + r.h > s.vh + 0.5).map(([n]) => n);
    check(out.length === 0, `everything fits on screen${out.length ? ` (${out.join(', ')} cut off)` : ''}`);
    if (s.buttonRects.length) {
      const hit = s.buttonRects.some((b) => inside(s.ball, b) || overlap(s.body, b));
      check(!hit, 'touch buttons cover neither the ball nor the controlled player');
    }

    // Switching to another player updates who is named.
    const before = s.humanName;
    const after = await page.evaluate(() => {
      const m = window.__game.match;
      const other = m.world.players.find((p) => p.team === m.human.team && p.id !== m.humanId && !p.isGK);
      m.setHuman(other.id);
      return other.name;
    });
    // The name appears (on touch screens only briefly) without covering the ball or nearby players.
    await page
      .waitForFunction(
        (name) => {
          const l = document.querySelector('.player-label');
          return !l.hidden && l.textContent.includes(name) && document.querySelector('.player-card .pname').textContent.includes(name);
        },
        { timeout: 20000, polling: 50 },
        after,
      )
      .catch(() => {});
    const s2 = await measure();
    await page.screenshot({ path: `${OUT}/${vp.name}-switch.png` });
    const shown = s2.touchUi ? s2.cardName : s2.labelText;
    check(after !== before && !!shown && shown.includes(after), `switching players names the new player ("${shown}")`);
    check(!!s2.labelText && s2.labelText.includes(after), `after a switch the new player's name appears over the pitch ("${s2.labelText}")`);
    check(!overlap(s2.label, { x: s2.ball.x - 5, y: s2.ball.y - 5, w: 10, h: 10 }, 2), "that name doesn't cover the ball");
    if (s2.touchUi) {
      // Game time runs slower than the clock under software rendering, so wait for the state, not a delay.
      const gone = await page
        .waitForFunction(() => document.querySelector('.player-label').hidden, { timeout: 30000, polling: 100 })
        .then(
          () => true,
          () => false,
        );
      check(gone, 'touch screens: the name over the pitch disappears again by itself');
    }
  }
  check(errors.length === 0, `no page errors${errors.length ? ` (${errors[0]})` : ''}`);
  await page.close();
}

await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
