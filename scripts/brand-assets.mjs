/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Regenerates the raster brand images from their sources, so a rename
// never needs an image editor:
//   public/apple-touch-icon.png  ← public/favicon.svg (180×180)
//   public/social-card.jpg       ← a 1200×630 screenshot of the game's menu (logo from src/brand.ts)
//   node scripts/brand-assets.mjs            (needs Chrome or Chromium for the social card)
// Software rendering: the screenshot shows the real menu, not real-device performance.
import sharp from 'sharp';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';

await sharp('public/favicon.svg', { density: 400 }).resize(180, 180).png().toFile('public/apple-touch-icon.png');
console.log('✓ public/apple-touch-icon.png');

const server = await createServer({ server: { port: 5219, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5219/', { waitUntil: 'load' });
  // A returning keyboard player's menu (no first-launch chooser, no offers) over the attract-mode match.
  await page.evaluate(() =>
    localStorage.setItem(
      'floodlight-fc-settings-v1',
      JSON.stringify({
        controlScheme: 'keyboard',
        controlsChosen: true,
        bindingsVersion: 2,
        graphicsMode: 'auto',
        quality: 'medium',
        tutorialSeen: true,
        difficulty: 'easy',
      }),
    ),
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'menu' && document.querySelector('.menu:not([hidden]) .logo'), { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 4000)); // let the stadium and players settle
  const png = await page.screenshot({ type: 'png' });
  await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toFile('public/social-card.jpg');
  console.log('✓ public/social-card.jpg');
} finally {
  await browser.close();
  await server.close();
}
