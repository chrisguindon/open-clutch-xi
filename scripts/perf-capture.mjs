/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Performance + visual capture: render statistics (draw calls, triangles, shader programs before/after
// the first goal), CPU costs and a few screenshots. Usage: node scripts/perf-capture.mjs [tag]
// Output: screenshots/perf/<tag>/*.png and perf.json. Note: software GL — GPU timings are NOT meaningful.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const tag = process.argv[2] || 'after';
const OUT = `screenshots/perf/${tag}`;
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5194, host: '127.0.0.1' }, logLevel: 'error' });
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
const result = { errors };

async function start(format, quality, timeOfDay = 'night') {
  await page.goto('http://127.0.0.1:5194/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify(s)), {
    tutorialSeen: true,
    adaptiveQuality: false,
    dynamicResolution: false,
    quality,
    format,
    timeOfDay,
    replays: 'off',
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 90000 });
  await page.evaluate(() => [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.offsetParent).click());
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 90000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.cam.cinematic = null;
    g.cam.cut();
  });
}
async function ff(sec) {
  await page.evaluate((sec) => {
    const g = window.__game,
      m = g.match;
    m.setHuman(null);
    for (let i = 0; i < Math.round(sec * 120); i++) {
      g.prev.copyFrom(g.cur);
      m.step(1 / 120, null);
      if (m.phase === 'replay') m.endReplay();
      g.cur.capture(m);
    }
    g.cam.cut();
  }, sec);
}
async function stats() {
  return page.evaluate(() => {
    const g = window.__game,
      r = g.renderer.renderer;
    r.info.autoReset = false;
    r.info.reset();
    g.renderer.render(g.cam.camera);
    const s = {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      programs: r.info.programs?.length ?? 0,
      textures: r.info.memory.textures,
      geometries: r.info.memory.geometries,
    };
    r.info.autoReset = true;
    return s;
  });
}
async function cpu() {
  return page.evaluate(() => {
    const g = window.__game,
      m = g.match;
    const t0 = performance.now();
    for (let i = 0; i < 1200; i++) {
      m.step(1 / 120, null);
      if (m.phase === 'replay') m.endReplay();
    }
    const sim = (performance.now() - t0) / 1200;
    const t1 = performance.now();
    for (let i = 0; i < 200; i++)
      g.view.render(g.prev, g.cur, 0.5, 1 / 60, { humanId: m.humanId, passTarget: null, penAim: null, time: i / 60, showIndicator: true }, g.cam.camera, 0, 0);
    return { msPerSimStep: +sim.toFixed(4), msViewUpdate: +((performance.now() - t1) / 200).toFixed(3) };
  });
}

try {
  for (const q of ['high', 'low']) {
    await start('5v5', q);
    result[`5v5-${q}`] = await stats();
  }
  await start('5v5', 'high');
  await ff(12);
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/broadcast.png` });
  await page.evaluate(() => {
    const g = window.__game;
    g.cam.mode = 'dynamic';
    g.cam.cut();
  });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/dynamic.png` });
  await page.evaluate(() => {
    const g = window.__game;
    g.match.lastScorer = g.match.world.controllerId ?? 1;
    g.cam.cinematic = { kind: 'celebrate', t: 1.2 };
    g.cam.cut();
  });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/crowd-closeup.png` });
  // Shader programs before and after the first goal (should not grow if precompilation works).
  const before = (await stats()).programs;
  await page.evaluate(() => {
    const g = window.__game,
      m = g.match,
      w = m.world;
    g.cam.cinematic = null;
    g.cam.mode = 'broadcast';
    m.phase = 'playing';
    w.restrictTouchTo = null;
    w.clearPossession();
    const gk = w.players.find((p) => p.isGK && p.team === 1);
    gk.place(w.pitch.length / 2 - 1, 3, Math.PI);
    w.ball.reset(w.pitch.length / 2 - 4, 0, 0.5);
    w.ball.vel.set(26, 0.5, 0);
    w.lastTouchTeam = 0;
    w.lastTouchId = w.players.find((p) => p.team === 0 && !p.isGK).id;
    w.events.emit('kick', { playerId: w.lastTouchId, kind: 'shot', power: 1, speed: 26, onTarget: true });
  });
  await page.waitForFunction(() => window.__game.match.phase === 'goal', { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/goal.png` });
  const after = (await stats()).programs;
  result.programsBeforeGoal = before;
  result.programsAfterGoal = after;
  result['5v5-cpu'] = await cpu();
  await start('11v11', 'high', 'dusk');
  result['11v11-high'] = await stats();
  await ff(10);
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/11v11.png` });
  result['11v11-cpu'] = await cpu();
} catch (e) {
  errors.push(String(e));
} finally {
  writeFileSync(`${OUT}/perf.json`, JSON.stringify(result, null, 2));
  await browser.close();
  await server.close();
  console.log(JSON.stringify(result, null, 2));
}
