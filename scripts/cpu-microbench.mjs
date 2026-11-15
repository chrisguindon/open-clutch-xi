/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Deterministic CPU micro-benchmark of a production build (no real-time noise):
//   A) the game's per-frame JS work with the WebGL submit stubbed out (600 frames, fixed 1/60 s step)
//   B) the JS cost of the real render submit, measured one frame at a time with gaps so the
//      (software) GPU can drain — this isolates command encoding from GPU execution
//   C) draw calls / triangles per frame, D) bytes allocated per frame (sampling heap profiler)
//   node scripts/cpu-microbench.mjs <distDir> <label> [quality] [format]
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';

const [dir = 'dist', label = 'current', quality = 'high', format = '5v5'] = process.argv.slice(2);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};
const server = http
  .createServer((req, res) => {
    let p = join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  })
  .listen(5205, '127.0.0.1');
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 640, height: 360 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto('http://127.0.0.1:5205/', { waitUntil: 'load' });
await page.evaluate(
  (q, f) =>
    localStorage.setItem(
      'floodlight-fc-settings-v1',
      JSON.stringify({
        quality: q,
        format: f,
        tutorialSeen: true,
        timeOfDay: 'night',
        adaptiveQuality: false,
        dynamicResolution: false,
        frameRate: 'display',
        deviceProfileApplied: true,
      }),
    ),
  quality,
  format,
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu' && window.__game.view, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
// Stop the game's own rAF loop; we drive frames manually.
await page.evaluate(() => {
  window.requestAnimationFrame = () => 0;
});
await new Promise((r) => setTimeout(r, 300));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 120; i++) g.frame(1 / 60);
});
// D) allocation during A.
const cdp = await page.createCDPSession();
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const A = await page.evaluate(() => {
  const g = window.__game,
    r = g.renderer;
  const orig = r.render;
  r.render = () => {};
  const N = 600,
    t0 = performance.now();
  for (let i = 0; i < N; i++) g.frame(1 / 60);
  const ms = (performance.now() - t0) / N;
  r.render = orig;
  return ms;
});
const { profile } = await cdp.send('HeapProfiler.stopSampling');
let bytes = 0;
(function walk(n) {
  bytes += n.selfSize;
  n.children.forEach(walk);
})(profile.head);
// B/C) real render submits, one at a time.
const samples = [];
let info = null;
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => {
    const g = window.__game,
      rr = g.renderer.renderer;
    rr.info.autoReset = false;
    rr.info.reset();
    const t0 = performance.now();
    g.frame(1 / 60);
    const total = performance.now() - t0;
    return { total, calls: rr.info.render.calls, tris: rr.info.render.triangles };
  });
  samples.push(s.total);
  info = s;
  await sleep(120);
}
samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const res = {
  label,
  quality,
  format,
  frameJsNoGlMs: +A.toFixed(3),
  frameJsWithSubmitMedianMs: +median.toFixed(3),
  renderSubmitMs: +(median - A).toFixed(3),
  drawCalls: info.calls,
  triangles: info.tris,
  allocKBPerFrame: +(bytes / 600 / 1024).toFixed(1),
};
console.log(JSON.stringify(res));
await browser.close();
server.close();
