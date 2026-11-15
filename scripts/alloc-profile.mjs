/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Allocation profile of live play (attract-mode AI match) using Chrome's sampling heap profiler.
//   node scripts/alloc-profile.mjs  → top allocation sites by bytes
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';
const server = await createServer({ server: { port: 5203, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 480, height: 270 },
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5203/', { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ quality: 'high', tutorialSeen: true, format: '5v5' })));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
// Start a real match (AI only) so gameplay code paths run.
await page.evaluate(() => [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.offsetParent).click());
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
await page.evaluate(() => {
  window.__game.match.setHuman(null);
  window.__game.cam.cinematic = null;
});
await new Promise((r) => setTimeout(r, 3000));
const cdp = await page.createCDPSession();
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const frames0 = await page.evaluate(() => window.__game.stepCount);
// Deterministic: drive 600 frames manually at 1/60 s with the WebGL submit stubbed.
await page.evaluate(() => {
  window.requestAnimationFrame = () => 0;
});
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  const g = window.__game;
  const o = g.renderer.render;
  g.renderer.render = () => {};
  for (let i = 0; i < 600; i++) g.frame(1 / 60);
  g.renderer.render = o;
});
const { profile } = await cdp.send('HeapProfiler.stopSampling');
const frames1 = await page.evaluate(() => window.__game.stepCount);
const sites = new Map();
(function walk(n, stack) {
  const f = n.callFrame;
  const name = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-1)[0]}:${f.lineNumber + 1}`;
  const self = n.selfSize;
  if (self) sites.set(name, (sites.get(name) ?? 0) + self);
  for (const c of n.children) walk(c, stack);
})(profile.head, []);
const total = [...sites.values()].reduce((a, b) => a + b, 0);
console.log('sim steps during sample:', frames1 - frames0, ' sampled bytes:', (total / 1048576).toFixed(1), 'MB');
for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log((v / 1024).toFixed(0).padStart(7), 'KB ', k);
await browser.close();
await server.close();
