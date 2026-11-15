/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Compares the baked pose sampler with three.js's AnimationMixer for every clip (src/dev/animCompare.ts),
// so the allocation-free sampler is shown to pose characters the same way. Prints, per clip, the largest
// bone-rotation difference in degrees.
//   node scripts/anim-compare.mjs [frames]   ('frames' samples a few fixed times per clip)
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';
const server = await createServer({ server: { port: 5207, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto('http://127.0.0.1:5207/', { waitUntil: 'load' });
console.log(
  JSON.stringify(
    await page.evaluate(async (mode) => {
      if (mode === 'frames') globalThis.__times = (d) => [0, 4 / 30, d * 0.37, d * 0.71];
      return (await import('/src/dev/animCompare.ts')).compareAnimations();
    }, process.argv[2]),
    null,
    1,
  ),
);
await browser.close();
await server.close();
