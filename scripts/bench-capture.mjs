/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Runs the in-game benchmark (?bench) in headless Chromium and saves the report.
//   node scripts/bench-capture.mjs <tag> [quality] [format]   → screenshots/bench/<tag>.json
// NOTE: headless Chromium uses SwiftShader (software GL). Per-system JS timings are meaningful CPU
// numbers; frame rates and "GPU" behaviour are not representative of real hardware.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const [tag = 'run', quality = 'high', format = '5v5'] = process.argv.slice(2);
mkdirSync('screenshots/bench', { recursive: true });
const server = await createServer({ server: { port: 5202, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
  defaultViewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto('http://127.0.0.1:5202/', { waitUntil: 'load' });
await page.evaluate(
  (q, f) => localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ quality: q, format: f, tutorialSeen: true, timeOfDay: 'night' })),
  quality,
  format,
);
await page.goto('http://127.0.0.1:5202/?bench', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__benchReport, { timeout: 1500000, polling: 2000 });
const report = await page.evaluate(() => window.__benchReport);
writeFileSync(`screenshots/bench/${tag}.json`, JSON.stringify(report, null, 1));
const rows = report.results.map((r) => {
  const s = r.summary,
    S = s.sectionsMs;
  return [
    r.variant.padEnd(22),
    s.fps.toFixed(1).padStart(5),
    s.jsFrameMs.toFixed(2).padStart(6),
    S.sim.mean.toFixed(2).padStart(5),
    S.ai.mean.toFixed(2).padStart(5),
    S.anim.mean.toFixed(2).padStart(5),
    S.scene.mean.toFixed(2).padStart(5),
    S.shadow.mean.toFixed(2).padStart(6),
    S.render.mean.toFixed(2).padStart(6),
    S.ui.mean.toFixed(2).padStart(5),
    S.camera.mean.toFixed(2).padStart(5),
    String(s.drawCalls).padStart(5),
    String(Math.round(s.triangles / 1000)).padStart(5) + 'k',
    s.heap ? s.heap.allocMBps.toFixed(1).padStart(5) : '  n/a',
  ].join(' ');
});
console.log('variant                  fps  JSms   sim    ai  anim scene shadow render    ui   cam calls  tris alloc');
console.log(rows.join('\n'));
await browser.close();
await server.close();
