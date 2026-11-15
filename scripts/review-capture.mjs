/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Review tool: captures screenshots across screens, modes, cameras and moments, plus render diagnostics.
// Fast-forwards the simulation in-page (no rendering) so software GL doesn't bottleneck capture.
// Usage: node scripts/review-capture.mjs  → screenshots/review/*.png and screenshots/review/diag.json
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = process.argv[2] ? `screenshots/${process.argv[2]}` : 'screenshots/review';
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5196, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const diag = {};

async function boot(settings) {
  await page.goto('http://127.0.0.1:5196/', { waitUntil: 'load' });
  await page.evaluate(
    (s) => localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ tutorialSeen: true, adaptiveQuality: false, dynamicResolution: false, ...s })),
    settings,
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 90000 });
}
async function shot(name, wait = 1800) {
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('📸', name);
}
async function click(sel) {
  await page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null).click(), sel);
}
/** Fast-forward the simulation by `sec` seconds without rendering. */
async function ff(sec, opts = {}) {
  await page.evaluate(
    (sec, opts) => {
      const g = window.__game,
        m = g.match;
      if (opts.ai) m.setHuman(null);
      const n = Math.round(sec * 120);
      for (let i = 0; i < n; i++) {
        g.prev.copyFrom(g.cur);
        m.step(1 / 120, null);
        if (m.phase === 'replay') m.endReplay();
        g.cur.capture(m);
      }
      g.cam.cut();
    },
    sec,
    opts,
  );
}
async function start(mode, settings) {
  await boot(settings);
  await click(mode === 'match' ? '.menu [data-action=play]' : `.menu [data-action=${mode}]`);
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 90000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.cam.cinematic = g.mode === 'penalties' ? g.cam.cinematic : null;
    g.cam.cut();
  });
}
async function cam(mode) {
  await page.evaluate((mode) => {
    const g = window.__game;
    g.cam.cinematic = null;
    g.cam.mode = mode;
    g.cam.cut();
  }, mode);
}
async function cine(c, subjectHuman = true) {
  await page.evaluate(
    (c, sh) => {
      const g = window.__game;
      if (sh) g.match.lastScorer = g.match.humanId ?? g.match.world.controllerId ?? 1;
      g.cam.cinematic = c;
      g.cam.cut();
    },
    c,
    subjectHuman,
  );
}
async function renderInfo(label) {
  diag[label] = await page.evaluate(() => {
    const g = window.__game,
      r = g.renderer.renderer;
    r.info.autoReset = false;
    r.info.reset();
    g.renderer.render(g.cam.camera);
    const i = {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      points: r.info.render.points,
      lines: r.info.render.lines,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      programs: r.info.programs?.length,
    };
    r.info.autoReset = true;
    let meshes = 0,
      skinned = 0,
      instanced = 0,
      lights = 0;
    g.renderer.scene.traverse((o) => {
      if (o.isSkinnedMesh) skinned++;
      else if (o.isInstancedMesh) instanced++;
      else if (o.isMesh) meshes++;
      if (o.isLight) lights++;
    });
    return { ...i, meshes, skinned, instanced, lights, pixelRatio: r.getPixelRatio(), perf: g.perf };
  });
}
/** Measure pure simulation cost per step (CPU), no rendering. */
async function simCost(label) {
  diag[label] = await page.evaluate(() => {
    const g = window.__game,
      m = g.match;
    const t0 = performance.now();
    for (let i = 0; i < 1200; i++) {
      m.step(1 / 120, null);
      if (m.phase === 'replay') m.endReplay();
    }
    const ms = (performance.now() - t0) / 1200;
    const t1 = performance.now();
    for (let i = 0; i < 200; i++)
      g.view.render(g.prev, g.cur, 0.5, 1 / 60, { humanId: m.humanId, passTarget: null, penAim: null, time: i / 60, showIndicator: true }, g.cam.camera, 0, 0);
    const viewMs = (performance.now() - t1) / 200;
    return { msPerSimStep: +ms.toFixed(4), msViewUpdate: +viewMs.toFixed(3), players: m.world.players.length };
  });
}

try {
  // ---------------- Menus ----------------
  await boot({ quality: 'high', format: '5v5' });
  await shot('00-menu', 4000);
  await click('[data-action=setup]');
  await shot('01-setup', 600);
  await click('[data-action=back]');
  await click('[data-action=settings]');
  await click('[data-action=tab][data-v=graphics]');
  await shot('02-settings-graphics', 600);
  await click('[data-action=back]');
  await click('[data-action=howto]');
  await shot('03-howto', 600);

  // ---------------- 5v5 night, high ----------------
  await start('match', { quality: 'high', format: '5v5', timeOfDay: 'night' });
  await renderInfo('5v5-high-kickoff');
  await shot('10-5v5-kickoff-broadcast');
  await ff(14, { ai: true });
  await shot('11-5v5-play-broadcast-a');
  await ff(9);
  await shot('12-5v5-play-broadcast-b');
  await cam('dynamic');
  await shot('13-5v5-dynamic');
  await cam('tactical');
  await shot('14-5v5-tactical');
  await cam('broadcast');
  await ff(11);
  await shot('15-5v5-play-broadcast-c');
  // Close-up of the ball carrier (or nearest player) mid-play.
  await page.evaluate(() => {
    const g = window.__game;
    const m = g.match;
    m.lastScorer = m.world.controllerId ?? m.world.players[1].id;
    g.cam.cinematic = { kind: 'celebrate', t: 1.5 };
    g.cam.cut();
  });
  await shot('16-5v5-closeup-carrier');
  // Animation sequence: step in small increments while a close cinematic follows the carrier.
  for (let k = 0; k < 6; k++) {
    await ff(0.12);
    await page.evaluate(() => {
      const g = window.__game;
      const m = g.match;
      m.lastScorer = m.world.controllerId ?? m.lastScorer;
    });
    await shot(`17-anim-seq-${k}`, 700);
  }
  await renderInfo('5v5-high-closeup');
  await simCost('5v5-cost');

  // Replay-style angles of goalmouth action.
  await cine({ kind: 'replay', angle: 1, t: 0 });
  await shot('18-5v5-behind-goal-angle');
  await cine({ kind: 'replay', angle: 0, t: 0 });
  await shot('19-5v5-low-tracking-angle');

  // ---------------- Goal sequence ----------------
  await cam('broadcast');
  await page.evaluate(() => {
    const g = window.__game,
      m = g.match,
      w = m.world;
    m.setHuman(w.players.find((p) => p.team === 0 && !p.isGK).id);
    m.phase = 'playing';
    w.restrictTouchTo = null;
    w.clearPossession();
    const gk = w.players.find((p) => p.isGK && p.team === 1);
    gk.place(w.pitch.length / 2 - 1, 2.6, Math.PI);
    const h = m.human;
    h.place(w.pitch.length / 2 - 14, 1, 0);
    w.ball.reset(w.pitch.length / 2 - 12.5, -0.5, 0.11);
    w.ball.vel.set(27, 3.2, -0.6);
    w.ball.spin.set(0, -8, 0);
    w.lastTouchTeam = 0;
    w.lastTouchId = h.id;
    w.lastKick = { playerId: h.id, team: 0, kind: 'shot', time: w.time, receiver: null, fromX: 0, fromZ: 0, onTarget: true };
    w.events.emit('kick', { playerId: h.id, kind: 'shot', power: 1, speed: 27, onTarget: true });
  });
  await shot('20-goal-shot-trail', 900);
  await page.waitForFunction(() => window.__game.match.phase === 'goal', { timeout: 60000 }).catch(() => {});
  await shot('21-goal-banner', 1200);
  await page.waitForFunction(() => window.__game.match.phaseTime > 1.8, { timeout: 120000 }).catch(() => {});
  await shot('22-goal-celebration', 200);
  await page.waitForFunction(() => !!window.__game.replay, { timeout: 180000 }).catch(() => {});
  await shot('23-replay', 1500);
  await page.evaluate(() => {
    const r = window.__game.replay;
    if (r) r.pos = r.frames.length - 30;
  });
  await shot('24-replay-late', 1200);

  // ---------------- 3v3 day, 11v11 dusk ----------------
  await start('match', { quality: 'high', format: '3v3', timeOfDay: 'day' });
  await ff(12, { ai: true });
  await shot('30-3v3-day-broadcast');
  await cam('dynamic');
  await shot('31-3v3-day-dynamic');
  await start('match', { quality: 'high', format: '11v11', timeOfDay: 'dusk' });
  await renderInfo('11v11-high');
  await ff(15, { ai: true });
  await shot('32-11v11-dusk-broadcast');
  await cam('tactical');
  await shot('33-11v11-dusk-tactical');
  await simCost('11v11-cost');

  // ---------------- Low quality ----------------
  await start('match', { quality: 'low', format: '5v5', timeOfDay: 'night' });
  await ff(10, { ai: true });
  await shot('34-5v5-low-quality');

  // ---------------- Penalties ----------------
  await start('penalties', { quality: 'high' });
  await shot('40-pen-shoot', 2500);
  await page.evaluate(() => {
    const m = window.__game.match;
    m.penAim.z = 2.6;
    m.penAim.y = 1.9;
    m.penPower = 0.75;
    m.phase = 'penRunup';
  });
  await shot('41-pen-runup', 700);
  await page
    .waitForFunction(() => window.__game.match.phase === 'penKeep' || (window.__game.match.phase === 'penReady' && window.__game.match.restart.team === 1), {
      timeout: 200000,
    })
    .catch(() => {});
  await shot('42-pen-keeper-view', 1500);

  // ---------------- Practice + pause + full-time ----------------
  await start('practice', { quality: 'high' });
  await shot('50-practice', 1500);
  await start('match', { quality: 'high', format: '5v5' });
  await page.keyboard.press('Escape');
  await shot('51-pause', 800);
  await click('[data-action=resume]');
  await page.evaluate(() => {
    const m = window.__game.match;
    m.clock = m.options.duration - 0.2;
    m.phase = 'playing';
    m.world.restrictTouchTo = null;
  });
  await page.waitForFunction(() => window.__game.state === 'fulltime', { timeout: 200000 }).catch(() => {});
  await shot('52-fulltime', 800);
} catch (e) {
  console.error('capture failed', e);
  errors.push(String(e));
} finally {
  diag.errors = errors;
  writeFileSync(`${OUT}/diag.json`, JSON.stringify(diag, null, 2));
  await browser.close();
  await server.close();
}
