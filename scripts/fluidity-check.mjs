/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Fluidity check in a real browser (headless Chromium, software GL):
// - injects irregular frame timing by jittering requestAnimationFrame timestamps,
// - drives the movement-lab player with real key presses,
// - records every rendered frame (frame dt, rendered player x, ball, camera) and checks smoothness,
// - reads the diagnostics overlay summary (input processing delay, frame stats) and screenshots it.
//   node scripts/fluidity-check.mjs [outDir]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = `screenshots/${process.argv[2] || 'fluidity'}`;
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5201, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: +(process.env.W || 640), height: +(process.env.H || 360) },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
// Irregular frame timing: each rAF timestamp is offset by a random 0–20 ms (so frame deltas vary
// frame to frame), and ~3% of frames stall for real (busy-wait 40–90 ms) like a GC pause or background app.
await page.evaluateOnNewDocument(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      if (Math.random() < 0.03) {
        const until = performance.now() + 40 + Math.random() * 50;
        while (performance.now() < until) {
          /* stall */
        }
      }
      cb(t + Math.random() * 20);
    });
});
await page.goto('http://127.0.0.1:5201/?lab&diag', { waitUntil: 'load' });
await page.evaluate(
  (q) =>
    localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ quality: q, tutorialSeen: true, adaptiveQuality: false, dynamicResolution: false })),
  process.env.Q || 'low',
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'playing' && window.__game.match, { timeout: 120000 });
await sleep(1500);
// Record every rendered frame.
// NORENDER=1 skips only the WebGL draw (software GL here takes ~160 ms/frame); everything else per frame
// (input, fixed-step sim, interpolation, camera, scene update, HUD) runs at real rAF rate.
await page.evaluate((noRender) => {
  const g = window.__game;
  window.__rec = [];
  const orig = g.renderer.render.bind(g.renderer);
  g.renderer.render = (cam) => {
    const id = g.match.humanId;
    window.__rec.push({ t: g.time, dt: g.lastDt, x: g.view.playerPos[id].x, z: g.view.playerPos[id].z, bx: g.view.ballPos.x, cx: cam.position.x });
    if (!noRender) orig(cam);
  };
  document.querySelector('.lab [data-a=free]').click();
}, !!process.env.NORENDER);
await sleep(800);
await page.evaluate(() => {
  window.__rec.length = 0;
});
await page.keyboard.down('ArrowRight');
await sleep(5000);
const keyUpTime = await page.evaluate(() => window.__game.time);
await page.keyboard.up('ArrowRight');
await sleep(800);
const rec = await page.evaluate(() => window.__rec);
// Input processing delay: tap direction keys at random intervals.
for (let i = 0; i < 12; i++) {
  const k = i % 2 ? 'ArrowUp' : 'ArrowDown';
  await page.keyboard.down(k);
  await sleep(120 + Math.random() * 120);
  await page.keyboard.up(k);
  await sleep(150 + Math.random() * 200);
}
if (!process.env.NORENDER) await page.screenshot({ path: `${OUT}/lab-diag.png` });
const summary = await page.evaluate(() => window.__game.diag.summary());
// The lab's in-browser responsiveness measurement.
await page.evaluate(() => document.querySelector('.lab [data-a=measure]').click());
await sleep(1500);
const labMeasure = await page.evaluate(() => document.querySelector('.lab-out').textContent);

// Analyse the run: steady-state on-screen speed per frame vs simulated speed.
let back = 0,
  maxDev = 0,
  n = 0,
  devSum = 0;
// Steady running: from 0.8 s after the key went down until just before it was released (game time).
const steady = rec.filter((r, i) => i > 0 && r.t - rec[0].t > 0.8 && r.t < keyUpTime - 0.02);
for (let i = 1; i < rec.length; i++) if (rec[i].x < rec[i - 1].x - 1e-4 && rec[i].t < keyUpTime) back++;
for (const r of steady) {
  const i = rec.indexOf(r);
  const dx = r.x - rec[i - 1].x;
  if (r.dt < 0.003) continue;
  const v = dx / r.dt;
  const dev = Math.abs(v - 5.9) / 5.9;
  maxDev = Math.max(maxDev, dev);
  devSum += dev;
  n++;
}
const dts = rec.map((r) => r.dt * 1000).sort((a, b) => a - b);
const result = {
  frames: rec.length,
  rec: process.env.DUMP ? rec : undefined,
  frameDtMs: { min: +dts[0].toFixed(1), p50: +dts[Math.floor(dts.length / 2)].toFixed(1), max: +dts[dts.length - 1].toFixed(1) },
  backwardsSteps: back,
  onScreenSpeedDeviation: { mean: +(devSum / Math.max(1, n)).toFixed(4), max: +maxDev.toFixed(4), frames: n },
  diag: summary,
  labMeasure,
  errors,
};
writeFileSync(`${OUT}/fluidity.json`, JSON.stringify(result, null, 1));
console.log(
  JSON.stringify(
    {
      ...result,
      diag: {
        fps: summary.fps,
        frameMs: summary.frameMs,
        simStepsPerSec: summary.simStepsPerSec,
        interpolation: summary.interpolation,
        input: summary.input,
        camera: summary.camera,
      },
    },
    null,
    1,
  ),
);
await browser.close();
await server.close();
