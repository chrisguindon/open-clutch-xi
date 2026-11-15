/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Plays the whole tutorial in a real browser with real key presses (no state edits, no shortcuts):
// a scripted player reads the game the way a person looks at the screen and holds / taps keys.
// Then a second pass makes the mistakes playtesters make, with real clicks and key presses: restart,
// skip, pressing Switch while carrying the ball, losing the ball (one simulated deflection, the only
// state edit), getting it back with the reset key, scoring and checking the camera returns to play,
// retry, exit and re-entry. Exits 1 if any check fails.
// The WebGL draw is stubbed (software GL is too slow); everything else runs for real.
//   node scripts/tutorial-check.mjs
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome } from './lib/chrome.mjs';
mkdirSync('screenshots/ui', { recursive: true });
const server = await createServer({ server: { port: 5213, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5213/', { waitUntil: 'load' });
await page.evaluate(() =>
  localStorage.setItem('floodlight-fc-settings-v1', JSON.stringify({ quality: 'low', deviceProfileApplied: true, tutorialSeen: false })),
);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.state === 'menu', { timeout: 180000 });
// Start the tutorial from the menu like a player would.
await page.evaluate(() => document.querySelector('.menu [data-action=tutorial]').click());
await page.waitForFunction(() => window.__game.state === 'playing' && !document.querySelector('.tutorial').hidden, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'screenshots/ui/tutorial-step1.png' });
await page.evaluate(() => {
  window.__game.renderer.render = () => {};
  window.__game.cam.cinematic = null;
});

const held = new Set();
const setKeys = async (want) => {
  for (const k of [...held])
    if (!want.has(k)) {
      await page.keyboard.up(k);
      held.delete(k);
    }
  for (const k of want)
    if (!held.has(k)) {
      await page.keyboard.down(k);
      held.add(k);
    }
};
const tap = async (k) => {
  await page.keyboard.down(k);
  await new Promise((r) => setTimeout(r, 70));
  await page.keyboard.up(k);
};
const t0 = Date.now();
let lastTitle = '',
  cool = 0;
const log = [];
while (Date.now() - t0 < 240000) {
  const s = await page.evaluate(() => {
    const g = window.__game,
      m = g.match,
      w = m.world,
      h = m.human;
    const title = document.querySelector('.tutorial .step')?.textContent ?? '';
    const mates = w.players.filter((p) => p.team === 0 && p.id !== h.id && !p.isGK).map((p) => [p.pos.x, p.pos.z]);
    return {
      title,
      done: /complete/i.test(title),
      hx: h.pos.x,
      hz: h.pos.z,
      bx: w.ball.pos.x,
      bz: w.ball.pos.z,
      has: w.controllerId === h.id,
      dir: w.attackDir(0),
      L2: w.pitch.length / 2,
      mates,
      cam: g.cam.mode,
    };
  });
  if (s.title !== lastTitle) {
    log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s.title}`);
    lastTitle = s.title;
  }
  if (s.done) break;
  // Broadcast camera: screen right = +x, screen up = −z (world). Map a world direction to arrow keys.
  const keysFor = (dx, dz) => {
    const k = new Set();
    if (dx > 0.3) k.add('KeyD');
    if (dx < -0.3) k.add('KeyA');
    if (dz < -0.3) k.add('KeyW');
    if (dz > 0.3) k.add('KeyS');
    return k;
  };
  const toward = (x, z) => {
    const dx = x - s.hx,
      dz = z - s.hz,
      l = Math.hypot(dx, dz) || 1;
    return keysFor(dx / l, dz / l);
  };
  let want = new Set();
  const goalX = s.dir * s.L2;
  if (!s.has) want = toward(s.bx, s.bz);
  else if (/Movement/.test(s.title)) want = toward(s.hx + s.dir * 5, 0);
  else if (/Sprint/.test(s.title)) {
    want = toward(s.hx + s.dir * 5, 0);
    want.add('ShiftLeft');
  } else if (/Passing/.test(s.title)) {
    const m = s.mates.sort((a, b) => Math.hypot(a[0] - s.hx, a[1] - s.hz) - Math.hypot(b[0] - s.hx, b[1] - s.hz))[0];
    want = m ? toward(m[0], m[1]) : new Set();
    if (cool <= 0) {
      await setKeys(want);
      await tap('Space');
      cool = 8;
    }
  } else if (/Shoot|Score/.test(s.title)) {
    want = toward(goalX, 0);
    if (Math.abs(goalX - s.hx) < 18 && cool <= 0) {
      await setKeys(want);
      await tap('KeyJ');
      cool = 8;
    }
  } else if (/Skill/.test(s.title)) {
    want = toward(s.hx + s.dir * 5, 2);
    if (cool <= 0) {
      await setKeys(want);
      await tap('KeyE');
      cool = 8;
    }
  }
  cool--;
  await setKeys(want);
  await new Promise((r) => setTimeout(r, 60));
}
await setKeys(new Set());
const result = await page.evaluate(() => ({
  title: document.querySelector('.tutorial .step')?.textContent,
  recoveries: window.__game.tutorial?.recoveries ?? [],
}));
await page.screenshot({ path: 'screenshots/ui/tutorial-complete.png' });
console.log(log.join('\n'));
console.log(
  JSON.stringify({ completed: /complete/i.test(result.title ?? ''), recoveries: result.recoveries, errors, seconds: ((Date.now() - t0) / 1000).toFixed(0) }),
);

// --- Second pass: mistakes and recovery ------------------------------------------------------------
const checks = [];
const check = (ok, what) => checks.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
const ui = () =>
  page.evaluate(() => {
    const g = window.__game,
      m = g.match,
      w = m.world,
      h = m.human;
    return {
      title: document.querySelector('.tutorial .step')?.textContent ?? '',
      msg: document.querySelector('.tutorial .msg')?.textContent ?? '',
      phase: m.phase,
      human: m.humanId,
      ctrl: w.controllerId,
      dist: h ? Math.hypot(w.ball.pos.x - h.pos.x, w.ball.pos.z - h.pos.z) : 99,
      cinematic: g.cam.cinematic?.kind ?? null,
      time: w.time,
      state: g.state,
    };
  });
/** Wait for a condition in game time (robust to slow software rendering). */
const until = (fn, timeout = 120000) =>
  page.waitForFunction(fn, { timeout, polling: 50 }).then(
    () => true,
    () => false,
  );
const gameWait = async (sec) => {
  const t = (await ui()).time;
  await until(`window.__game.match.world.time > ${t + sec}`);
};
const click = (action) => page.click(`.tutorial [data-action=${action}]`);
await setKeys(new Set());

// The finished card hides itself after a while; the pause menu (Esc) has the tutorial controls too.
await tap('Escape');
check(await until(() => window.__game.state === 'paused'), 'Esc pauses the tutorial');
await page.click('.pause [data-action=tutRestart]');
check(
  await until(() => /Step 1 \/ \d · Movement/.test(document.querySelector('.tutorial .step')?.textContent ?? '')),
  'Pause menu → Restart tutorial returns to step 1',
);
await click('tutSkip');
await click('tutSkip');
check(/Passing/.test((await ui()).title), 'Skip button moves to the next step (twice → Passing)');
check(await until(() => window.__game.match.world.controllerId === window.__game.match.humanId), 'Passing starts with the ball at the player’s feet');

// Pressing Switch while carrying the ball must not hand it to an AI team-mate.
const carrier = (await ui()).human;
await tap('KeyQ');
await gameWait(1);
const afterSwitch = await ui();
check(
  afterSwitch.human === carrier && afterSwitch.ctrl === carrier,
  `Switch while carrying keeps the ball with the controlled player (${JSON.stringify({ carrier, human: afterSwitch.human, ctrl: afterSwitch.ctrl })})`,
);

// Lose the ball: a simulated deflection leaves it 10 m behind, out of the team-mates' reach. The human
// starts from the centre spot so the scenario doesn't depend on where earlier lessons ended (a ball
// "lost" next to a team-mate is rightly picked up by them, and then no hint is due).
await page.evaluate(() => {
  const m = window.__game.match,
    w = m.world,
    h = m.human,
    L2 = w.pitch.length / 2;
  h.place(0, 0, 0);
  for (const p of w.players) if (p.team === 0 && p.id !== h.id) p.place(w.attackDir(0) * (L2 - 4), (p.index - 1) * 6, 0);
  w.clearPossession();
  w.ball.reset(-10 * w.attackDir(0), 0);
});
const hinted = await until(() => /The ball is over there/.test(document.querySelector('.tutorial .msg')?.textContent ?? ''));
check(hinted && /press R/.test((await ui()).msg), `Losing the ball shows where it is and how to get it back ("${(await ui()).msg.slice(0, 80)}")`);
await tap('KeyR');
await gameWait(0.6);
check((await ui()).dist < 2.5, 'The reset key (R) brings the ball back');
check(await until(() => window.__game.match.world.controllerId === window.__game.match.humanId), 'The player controls the returned ball');
await tap('Space');
check(
  await until(() => /Shooting/.test(document.querySelector('.tutorial .step')?.textContent ?? ''), 30000),
  'Passing completes after the recovery (real Space press)',
);

// Retry keeps the step and gives the ball back.
await click('tutRetry');
check(/Shooting/.test((await ui()).title), 'Retry stays on the step');
check(await until(() => window.__game.match.world.controllerId === window.__game.match.humanId), 'Retry gives the ball back');

// Score with real keys, then check the camera leaves the celebration shot when play resumes.
await click('tutSkip'); // → Score!
let scored = false;
const tScore = Date.now();
while (!scored && Date.now() - tScore < 120000) {
  const st = await page.evaluate(() => {
    const m = window.__game.match,
      w = m.world,
      h = m.human;
    return {
      phase: m.phase,
      has: w.controllerId === h.id,
      hx: h.pos.x,
      hz: h.pos.z,
      bx: w.ball.pos.x,
      bz: w.ball.pos.z,
      gx: w.attackDir(0) * (w.pitch.length / 2),
      gk: w.players.find((p) => p.isGK && p.team === 1),
    };
  });
  if (st.phase === 'goal') {
    scored = true;
    break;
  }
  const keysTo = (x, z) => {
    const k = new Set();
    const dx = x - st.hx,
      dz = z - st.hz,
      l = Math.hypot(dx, dz) || 1;
    if (dx / l > 0.3) k.add('KeyD');
    if (dx / l < -0.3) k.add('KeyA');
    if (dz / l < -0.3) k.add('KeyW');
    if (dz / l > 0.3) k.add('KeyS');
    return k;
  };
  if (!st.has) await setKeys(keysTo(st.bx, st.bz));
  else {
    // Aim at the far corner from the keeper.
    const corner = st.gk && st.gk.pos.z > 0 ? -2.5 : 2.5;
    await setKeys(keysTo(st.gx, corner));
    if (Math.abs(st.gx - st.hx) < 14) await tap('KeyJ');
  }
  await new Promise((r) => setTimeout(r, 60));
}
await setKeys(new Set());
check(scored, 'A goal can be scored with real key presses');
if (scored) {
  await until(() => window.__game.match.phase === 'playing');
  await gameWait(0.3);
  const after = await ui();
  check(after.cinematic !== 'celebrate', `After the goal the camera follows play again, not the scorer (cinematic: ${after.cinematic})`);
}

// Exit to the menu, then re-enter from the menu.
await click('tutExit');
check(await until(() => window.__game.state === 'menu'), 'Exit returns to the menu');
await page.evaluate(() => document.querySelector('.menu [data-action=tutorial]').click());
check(
  await until(() => window.__game.state === 'playing' && /Step 1/.test(document.querySelector('.tutorial .step')?.textContent ?? '')),
  'The tutorial can be started again from the menu (step 1)',
);
await page.evaluate(() => {
  delete window.__game.renderer.render;
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: 'screenshots/ui/tutorial-reentered.png' });
console.log(checks.join('\n'));
const failed = checks.some((c) => c.startsWith('FAIL')) || errors.length > 0 || !/complete/i.test(result.title ?? '');
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
