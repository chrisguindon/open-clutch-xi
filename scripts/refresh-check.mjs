/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Emulates a 144 Hz display (requestAnimationFrame driven at 144 Hz, WebGL draw stubbed) and checks the
// frame limiter: measured display Hz, rendered FPS in Balanced / Max / Power saver.  node scripts/refresh-check.mjs [hz]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';
const HZ = +(process.argv[2] || 144);
const server = await createServer({ server: { port: 5210, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 320, height: 180 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((hz) => {
  const period = 1000 / hz;
  let next = performance.now() + period;
  const cbs = [];
  window.requestAnimationFrame = (cb) => {
    cbs.push(cb);
    return cbs.length;
  };
  const tick = () => {
    const now = performance.now();
    const t = next;
    next += period;
    const list = cbs.splice(0);
    for (const cb of list) cb(t);
    setTimeout(tick, Math.max(0, next - performance.now()));
    void now;
  };
  setTimeout(tick, period);
}, HZ);
await page.goto('http://127.0.0.1:5210/', { waitUntil: 'load' });
await page.evaluate(() =>
  localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ quality: 'low', tutorialSeen: true, deviceProfileApplied: true })),
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
await page.evaluate(() => {
  const g = window.__game;
  g.renderer.render = () => {};
  g.diag.benchmarking = true;
});
const out = {};
if (process.env.TRACE) {
  await page.evaluate(() => {
    window.__game.settings.frameRate = 'auto';
  });
  await new Promise((r) => setTimeout(r, 2000));
  const trace = await page.evaluate(
    () =>
      new Promise((res) => {
        const g = window.__game;
        const log = [];
        const inner = g.loop;
        g.loop = (t) => {
          const before = g.sinceRender;
          const fr = g.diag.summary ? g.diag.frameMs.n : 0;
          inner(t);
          log.push([+t.toFixed(3), +(before * 1000).toFixed(3), g.diag.frameMs.n !== fr ? 'R' : '-', +(g.refreshDt * 1000).toFixed(4)]);
        };
        setTimeout(() => {
          g.loop = inner;
          res(log);
        }, 6000);
      }),
  );
  let lastR = -1;
  const odd = [];
  trace.forEach((e, i) => {
    if (e[2] === 'R') {
      if (lastR >= 0 && i - lastR !== 2) odd.push(trace.slice(Math.max(0, i - 4), i + 1));
      lastR = i;
    }
  });
  console.log('ticks', trace.length, 'odd gaps', odd.length, JSON.stringify(odd.slice(0, 2)));
  console.log(
    'tick dt histogram',
    JSON.stringify(
      trace.slice(1).reduce((h, e, i) => {
        const d = (e[0] - trace[i][0]).toFixed(2);
        h[d] = (h[d] || 0) + 1;
        return h;
      }, {}),
    ),
  );
}
for (const fr of ['auto', 'balanced', 'display', 'saver']) {
  await page.evaluate((fr) => {
    window.__game.settings.frameRate = fr;
  }, fr);
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => window.__game.diag.reset());
  const steps = [];
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 500));
    steps.push(await page.evaluate(() => window.__game.autoStep));
  }
  const s = await page.evaluate(() => window.__game.diag.summary());
  const hist = await page.evaluate(() => {
    const h = {};
    for (const v of window.__game.diag.export().frames.frameMs) {
      const k = Math.round(v * 10) / 10;
      h[k] = (h[k] || 0) + 1;
    }
    return h;
  });
  out[fr] = {
    renderedFps: s.fps,
    p95ms: s.frameMs.p95,
    displayHz: s.displayHz,
    limiterTarget: s.frameLimiter.targetFps,
    frameMsHistogram: hist,
    autoStepSamples: steps.join(''),
  };
}
console.log(`emulated display ${HZ} Hz:`, JSON.stringify(out, null, 1));
await browser.close();
await server.close();
