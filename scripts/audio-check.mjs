/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Audio check: loads the CC0 samples in a real browser, plays every sound, then repeats with the
// sample files blocked to prove the synthesised fallback still works. Also measures output level
// per sound through an AnalyserNode tap on the master bus.
//   node scripts/audio-check.mjs
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';

const server = await createServer({ server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(blockSamples) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r) => (blockSamples && r.url().includes('/assets/audio/') ? r.abort() : r.continue()));
  await page.goto('http://127.0.0.1:5198/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
  const loaded = await page.evaluate(async () => {
    const a = window.__game.audio;
    a.unlock();
    return a.loadSamples('/assets/audio/');
  });
  // Tap the master bus to measure what each sound actually outputs.
  await page.evaluate(() => {
    const a = window.__game.audio,
      ctx = a.ctx;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    a.master.connect(an);
    window.__an = an;
    window.__rms = () => {
      const d = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(d);
      let m = 0;
      for (const v of d) m += v * v;
      return Math.sqrt(m / d.length);
    };
    window.__peak = () => {
      const d = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(d);
      let m = 0;
      for (const v of d) m = Math.max(m, Math.abs(v));
      return m;
    };
  });
  const levels = {};
  for (const [name, call] of [
    ['kick', 'kick(0.9, 0.3)'],
    ['whistle', "whistle('short')"],
    ['final', "whistle('final')"],
    ['roar', 'roar(1)'],
    ['ooh', 'ooh()'],
    ['groan', 'groan()'],
    ['applause', 'applause()'],
    ['cheer', 'cheer()'],
  ]) {
    await page.evaluate((c) => {
      new Function('a', `a.${c}`)(window.__game.audio);
    }, call);
    let peak = 0;
    for (let i = 0; i < 12; i++) {
      await sleep(60);
      peak = Math.max(peak, await page.evaluate(() => window.__peak()));
    }
    levels[name] = +peak.toFixed(3);
    await sleep(300);
  }
  await sleep(7000); // let one-shot tails die away
  // The menu's attract loop sets crowd intensity every frame; take control of it for the measurement.
  await page.evaluate(() => {
    const a = window.__game.audio;
    a.startCrowd();
    a.__set = a.setCrowdIntensity.bind(a);
    a.setCrowdIntensity = () => {};
    a.__set(0.15);
  });
  let bedLow = 0,
    bedHigh = 0;
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__game.audio.update(0.1));
    await sleep(50);
  }
  for (let i = 0; i < 10; i++) {
    await sleep(60);
    bedLow += (await page.evaluate(() => window.__rms())) / 10;
  }
  const mixCalm = await page.evaluate(() => {
    const a = window.__game.audio;
    return {
      amb: +(a.ambGain?.gain.value ?? 0).toFixed(2),
      lowpassHz: Math.round(a.ambFilter?.frequency.value ?? 0),
      synth: +a.crowdGain.gain.value.toFixed(2),
    };
  });
  await page.evaluate(() => window.__game.audio.__set(1));
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__game.audio.update(0.1));
    await sleep(50);
  }
  for (let i = 0; i < 10; i++) {
    await sleep(60);
    bedHigh += (await page.evaluate(() => window.__rms())) / 10;
  }
  const mixExcited = await page.evaluate(() => {
    const a = window.__game.audio;
    return {
      amb: +(a.ambGain?.gain.value ?? 0).toFixed(2),
      lowpassHz: Math.round(a.ambFilter?.frequency.value ?? 0),
      synth: +a.crowdGain.gain.value.toFixed(2),
    };
  });
  await page.close();
  return {
    blockSamples,
    loaded,
    levels,
    crowdBedRms: { calm: +bedLow.toFixed(3), excited: +bedHigh.toFixed(3) },
    mix: { calm: mixCalm, excited: mixExcited },
    errors,
  };
}
try {
  console.log(JSON.stringify(await run(false)));
  console.log(JSON.stringify(await run(true)));
} finally {
  await browser.close();
  await server.close();
}
