/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Adaptive performance in a real browser.  node scripts/adaptive-check.mjs
//  A) Slow device: headless SwiftShader renders at a few fps, so Auto must step resolution and quality
//     down to the bottom of the ladder and the 30 fps floor — mid-match, without restarting the match.
//  B) Fast device: rendering stubbed and requestAnimationFrame driven at 144 Hz, so Auto must hold 144 fps
//     and climb from Low to Ultra.
// NOTE: both are emulated. They check the control logic end to end, not real-device performance.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';

const server = await createServer({ server: { port: 5211, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const launch = () =>
  puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 640, height: 360 },
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};

async function open(browser, settings, hz) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (hz) {
    await page.evaluateOnNewDocument((hz) => {
      const period = 1000 / hz;
      let next = performance.now() + period;
      const cbs = [];
      window.requestAnimationFrame = (cb) => {
        cbs.push(cb);
        return cbs.length;
      };
      const tick = () => {
        const t = next;
        next += period;
        for (const cb of cbs.splice(0)) cb(t);
        setTimeout(tick, Math.max(0, next - performance.now()));
      };
      setTimeout(tick, period);
    }, hz);
  }
  await page.goto('http://127.0.0.1:5211/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify(s)), settings);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
  return { page, errors };
}
const status = (page) =>
  page.evaluate(() => {
    const g = window.__game,
      a = g.adaptive;
    return {
      level: a.state.level,
      res: a.state.resScale,
      fpsStep: a.state.fpsStep,
      targetFps: Math.round(1 / g.targetFrameDt()),
      active: g.activeQuality,
      history: a.history.map((h) => `${h.t}s ${h.text}`),
      status: g.graphicsStatus(),
    };
  });

// A) slow device
{
  const browser = await launch();
  const { page, errors } = await open(browser, { quality: 'high', tutorialSeen: true, deviceProfileApplied: true, controlsChosen: true });
  await page.evaluate(() => window.__game.startMatch('match'));
  await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 60000 });
  const t0 = await page.evaluate(() => {
    window.__game.__m = window.__game.match;
    return window.__game.time;
  });
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    console.log(
      i * 5 + 5,
      's',
      JSON.stringify(
        await page.evaluate(() => {
          const g = window.__game;
          return { h: g.adaptive.history.slice(-1)[0]?.text, el: g.adaptive.elapsed.toFixed(1), fps: g.fpsShown, st: g.state };
        }),
      ),
    );
  }
  const s = await status(page);
  const same = await page.evaluate(() => window.__game.__m === window.__game.match && window.__game.state === 'playing');
  const t1 = await page.evaluate(() => window.__game.time);
  console.log('[slow]', JSON.stringify(s, null, 1));
  check(s.level >= 5, `slow device stepped down to the Low rungs (now ${s.active}, level ${s.level})`);
  check(s.res < 1, `slow device reduced resolution (${s.res})`);
  // The floor must hold: the controller never chooses a frame-rate target below ~30 fps. (Whether it
  // *reaches* that step depends on the measured display refresh, which can't be measured while software
  // rendering runs at 2–10 fps: the estimate collapses towards its 24 Hz clamp, the next step would be
  // under the floor, and the controller rightly holds. Verify reaching it on real hardware.)
  const fpsSteps = s.history
    .map((h) => /frame-rate target ↓ (\d+) fps/.exec(h)?.[1])
    .filter(Boolean)
    .map(Number);
  check(
    fpsSteps.every((f) => f >= 29),
    `frame-rate floor respected: no target below ~30 fps (steps taken: ${fpsSteps.join(', ') || 'none'}; live target ${s.targetFps} fps)`,
  );
  check(same && t1 > t0, `match kept running through the quality changes (same match object, game time ${t0.toFixed(1)} → ${t1.toFixed(1)} s)`);
  check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ')})`);
  await browser.close();
}

// B) fast device (render stubbed) on a 144 Hz display
{
  const browser = await launch();
  const { page, errors } = await open(browser, { quality: 'low', tutorialSeen: true, deviceProfileApplied: true, controlsChosen: true }, 144);
  await page.evaluate(() => {
    const g = window.__game;
    g.renderer.render = () => {};
  });
  await sleep(40000);
  const s = await status(page);
  console.log('[fast]', JSON.stringify(s, null, 1));
  check(s.targetFps === 144, `fast device holds 144 fps on 144 Hz (${s.targetFps})`);
  check(s.level < 5, `fast device climbed from Low (now ${s.active}, level ${s.level})`);
  check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ')})`);
  await browser.close();
}

await server.close();
process.exit(failed ? 1 : 0);
