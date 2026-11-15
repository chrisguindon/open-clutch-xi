/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Lighting matrix: every time of day × every camera (plus a close-up), for before/after comparisons.
//   node scripts/lighting-capture.mjs [folder] [quality]  → screenshots/<folder>/<tod>-<camera>.png
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const OUT = `screenshots/${process.argv[2] || 'lighting'}`;
const Q = process.argv[3] || 'high';
const TODS = (process.env.TODS || 'night,dusk,day').split(',');
mkdirSync(OUT, { recursive: true });
// DIST=<dir> serves a production build statically (e.g. an older build for before/after comparisons).
let server;
if (process.env.DIST) {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.glb': 'model/gltf-binary',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
  };
  const srv = http
    .createServer((req, res) => {
      let p = path.join(process.env.DIST, decodeURIComponent(req.url.split('?')[0]));
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(p));
    })
    .listen(5197, '127.0.0.1');
  server = { close: () => srv.close() };
} else {
  server = await createServer({ server: { port: 5197, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
}
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (const tod of TODS) {
    await page.goto('http://127.0.0.1:5197/', { waitUntil: 'load' });
    await page.evaluate((s) => localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify(s)), {
      tutorialSeen: true,
      adaptiveQuality: false,
      dynamicResolution: false,
      quality: Q,
      format: process.env.FORMAT || '5v5',
      timeOfDay: tod,
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
    await page.evaluate(() => [...document.querySelectorAll('.menu [data-action=play]')].find((e) => e.offsetParent).click());
    await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 120000 });
    await page.evaluate(() => {
      const g = window.__game,
        m = g.match;
      m.setHuman(null);
      for (let i = 0; i < 120 * 12; i++) {
        g.prev.copyFrom(g.cur);
        m.step(1 / 120, null);
        if (m.phase === 'replay') m.endReplay();
        g.cur.capture(m);
      }
      g.state = 'paused';
    });
    for (const camMode of ['broadcast', 'dynamic', 'tactical', 'closeup']) {
      await page.evaluate((c) => {
        const g = window.__game,
          m = g.match;
        if (c === 'closeup') {
          m.lastScorer = m.world.controllerId ?? m.world.players[1].id;
          g.cam.cinematic = { kind: 'celebrate', t: 1.5 };
        } else {
          g.cam.cinematic = null;
          g.cam.mode = c;
        }
        g.cam.cut();
      }, camMode);
      await sleep(2200);
      await page.screenshot({ path: `${OUT}/${tod}-${camMode}.png` });
      console.log('📸', tod, camMode);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
