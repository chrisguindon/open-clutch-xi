/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Real-browser gameplay flow for the Laws of the Game, with real keyboard input:
//   start a match → ball out → correct throw-in → try to walk/sprint with the ball (must be prevented)
//   → throw → play resumes → goal → celebration (style + gesture) → skip → kick-off → play resumes;
//   plus an AI-controlled restart, and an 11v11 (Standard rules) throw-in with assistant referees.
// Screenshots go to screenshots/rules/ for human review — automated checks can't judge whether
// animations look natural. Software rendering: frame rates here mean nothing.
//   node scripts/rules-check.mjs
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

mkdirSync('screenshots/rules', { recursive: true });
const server = await createServer({ server: { port: 5214, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 960, height: 540 },
});
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};
const errors = [];

async function open(settings) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Couldn't load texture blob/.test(m.text())) errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5214/', { waitUntil: 'load' });
  await page.evaluate((s) => localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify(s)), settings);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 120000 });
  return page;
}
const G = (page, fn, ...args) => page.evaluate(fn, ...args);
const waitFor = (page, fn, timeout = 120000) => page.waitForFunction(fn, { timeout, polling: 100 });

/** Put the ball out over the +z touchline, last touched by the away team. */
const ballOut = (page) =>
  G(page, () => {
    const m = window.__game.match,
      w = m.world;
    m.phase = 'playing';
    w.restrictTouchTo = null;
    w.secondTouchBan = null;
    w.ball.reset(2, w.pitch.width / 2 - 0.4);
    w.ball.vel.set(0, 0, 6);
    w.lastTouchTeam = 1;
    w.lastTouchId = w.players.find((p) => p.team === 1 && !p.isGK).id;
  });

const base = {
  quality: 'low',
  graphicsMode: 'manual',
  tutorialSeen: true,
  deviceProfileApplied: true,
  controlsChosen: true,
  controlScheme: 'keyboard',
  replays: 'off',
};

// --- Human flow, 5v5 (Arcade rules) -----------------------------------------------------------
{
  const page = await open({ ...base, format: '5v5' });
  await G(page, () => window.__game.startMatch('match'));
  await waitFor(page, () => window.__game.state === 'playing');
  await G(page, () => {
    window.__game.cam.cinematic = null;
  });
  check(true, '1. match started');
  await ballOut(page);
  await waitFor(page, () => window.__game.match.phase === 'restart');
  const r = await G(page, () => {
    const m = window.__game.match;
    const t = m.world.players[m.restart.takerId];
    return { type: m.restart.type, team: m.restart.team, human: t.humanControlled, held: m.world.ball.heldBy === t.id, x: t.pos.x, z: t.pos.z };
  });
  check(r.type === 'throwIn' && r.team === 0, `2–3. ball out → throw-in to the home team (${r.type}, team ${r.team})`);
  check(r.human && r.held, '3. the human player is the thrower and holds the ball');
  await page.screenshot({ path: 'screenshots/rules/01-throw-in.png' });
  // 4–5. Try to run off with the ball: hold right + sprint for a while.
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowUp');
  const t0 = await G(page, () => window.__game.match.world.time);
  await page.waitForFunction((t) => window.__game.match.world.time > t + 2, { timeout: 180000, polling: 50 }, t0).catch(() => null);
  const after = await G(page, () => {
    const m = window.__game.match;
    const t = m.world.players[m.restart.takerId];
    return { phase: m.phase, x: t.pos.x, z: t.pos.z, held: m.world.ball.heldBy === t.id };
  });
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('ShiftLeft');
  const moved = Math.hypot(after.x - r.x, after.z - r.z);
  check(
    after.phase === 'restart' && moved < 0.3 && after.held,
    `4–5. walking/sprinting with the ball is prevented (moved ${moved.toFixed(2)} m over ≥2 s of game time from t=${t0.toFixed(1)})`,
  );
  // 6–7. Throw it.
  await page.keyboard.down('Space');
  await waitFor(page, () => window.__game.match.phase === 'playing', 120000).catch(() => null);
  await page.keyboard.up('Space');
  const kind = await G(page, () => window.__game.match.world.lastKick?.kind);
  check((await G(page, () => window.__game.match.phase)) === 'playing', `6–7. legal throw executed (${kind}); play resumed`);
  // 8–9. Score.
  await G(page, () => {
    const m = window.__game.match,
      w = m.world;
    w.secondTouchBan = null;
    // Live play, whatever happened just after the throw (the ball may already be out again): goals
    // are only judged in open play. The same set-up as the smoke test's forced goal.
    m.phase = 'playing';
    w.restrictTouchTo = null;
    w.clearPossession();
    w.ball.heldBy = null; // a held ball (e.g. still in the thrower's hands) follows its holder, not the shot
    // The goal must not count as "scored directly from the throw-in" (Law 15: correctly disallowed by the
    // game). In real play another player's touch clears this; whether the receiver had touched the ball
    // yet depended on timing, which made this check flaky.
    m.lastRestart = null;
    for (const p of w.players) if (!p.isGK) p.place(0, (p.index - 2) * 3, 0);
    const L2 = w.pitch.length / 2;
    // Half a metre from the line: across it within a couple of steps, before anyone can touch it.
    w.ball.reset(L2 - 0.5, 0, 0.5);
    w.ball.vel.set(18, 0, 0);
    w.lastTouchTeam = 0;
    w.lastTouchId = w.players.find((p) => p.team === 0 && !p.isGK).id;
  });
  await waitFor(page, () => window.__game.match.phase === 'goal').catch(async (err) => {
    // Say why, so a failure here is diagnosable from the log alone.
    const st = await G(page, () => {
      const m = window.__game.match;
      const b = m.world.ball;
      return { phase: m.phase, score: [...m.score], ball: [b.pos.x, b.pos.y, b.pos.z].map((v) => +v.toFixed(2)), lastTouch: m.world.lastTouchId };
    });
    console.log('no goal; match state:', JSON.stringify(st));
    throw err;
  });
  await waitFor(page, () => window.__game.match.phaseTime > 0.9, 120000).catch(() => null);
  const cel = await G(page, () => {
    const m = window.__game.match;
    return { style: m.celebration?.style, intensity: m.celebration?.intensity, gesture: m.world.players[m.lastScorer].gesture };
  });
  check(!!cel.style && cel.gesture > 0, `8–9. goal → celebration "${cel.style}" (${cel.intensity}), scorer gesture ${cel.gesture}`);
  await page.screenshot({ path: 'screenshots/rules/02-celebration.png' });
  // 10–11. Skip and kick off.
  await page.keyboard.press('Space');
  await waitFor(page, () => window.__game.match.phase === 'kickoff', 60000).catch(() => null);
  check((await G(page, () => window.__game.match.phase)) === 'kickoff', '10. celebration skipped → kick-off');
  await page.keyboard.down('Space');
  await waitFor(page, () => window.__game.match.phase === 'playing', 120000).catch(() => null);
  await page.keyboard.up('Space');
  check((await G(page, () => window.__game.match.phase)) === 'playing', '11. kick-off taken, play resumed');
  await page.close();
}

// --- AI-controlled restart (menu attract match) ---------------------------------------------
{
  const page = await open({ ...base, format: '5v5' });
  await ballOut(page);
  await waitFor(page, () => window.__game.match.phase === 'restart');
  const t = await G(page, () => window.__game.match.world.time);
  // Judge by the moment play resumed, not by a later read: in this AI-only match the ball can go out
  // again within milliseconds, which made a second phase check flaky.
  const resumed = await waitFor(page, () => window.__game.match.phase === 'playing', 180000)
    .then(() => true)
    .catch(() => false);
  const dt = await G(page, (t0) => window.__game.match.world.time - t0, t);
  check(resumed && dt < 4, `AI took the throw-in after ${dt.toFixed(1)} s of game time`);
  await page.close();
}

// --- 11v11 Standard rules: assistants flag the throw-in --------------------------------------
{
  const page = await open({ ...base, format: '11v11' });
  await G(page, () => window.__game.startMatch('match'));
  await waitFor(page, () => window.__game.state === 'playing');
  await G(page, () => {
    window.__game.cam.cinematic = null;
  });
  await ballOut(page);
  await waitFor(page, () => window.__game.match.phase === 'stoppage');
  await waitFor(page, () => window.__game.match.phaseTime > 0.3, 60000).catch(() => null);
  const sig = await G(page, () => {
    const o = window.__game.match.officials;
    return {
      rules: window.__game.match.rules.name,
      ar: o.assistants.map((a) => a.signal),
      ref: o.referee.signal,
      log: o.log.map((l) => `${l.who}:${l.signal}`),
    };
  });
  check(
    sig.rules === 'standard' && sig.log.includes('assistant:throwIn') && sig.log.includes('referee:point'),
    `11v11 Standard: assistant flags the throw-in, referee points (${sig.log.join(', ')})`,
  );
  await page.screenshot({ path: 'screenshots/rules/03-officials-11v11.png' });
  await page.close();
}

check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
