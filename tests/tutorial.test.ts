/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { Tutorial } from '../src/game/tutorial';
import { DEFAULT_SETTINGS } from '../src/game/settings';
import { emptyInput, consumeEdges, InputFrame } from '../src/sim/human';
import { SIM_DT } from '../src/sim/config';
import { TutorialBot } from './tutorialBot';
import { summary } from './helpers';
import { celebrationShotEnds } from '../src/render/camera';
import type { Settings } from '../src/game/settings';

function setup(seed = 1, scheme: Settings['controlScheme'] = 'keyboard') {
  const m = new Match({ mode: 'practice', format: '5v5', difficulty: 'easy', duration: 9999, seed, replays: false, autoSwitch: true });
  const shown: string[] = [];
  let title = '';
  const settings = { ...structuredClone(DEFAULT_SETTINGS), controlScheme: scheme };
  const t = new Tutorial(m, settings, (s, msg) => {
    if (s) {
      title = s;
      shown.push(`${s}|${msg ?? ''}`);
    }
  });
  return { m, t, shown, settings, title: () => title };
}
/** Advance one 60 Hz frame: bot decides, sim runs two 120 Hz steps, tutorial updates. */
function frame(m: Match, t: Tutorial, input: InputFrame, decide?: () => void) {
  decide?.();
  for (let k = 0; k < 2; k++) {
    m.step(SIM_DT, input);
    consumeEdges(input);
  }
  t.update(1 / 60, input);
}

describe('tutorial', () => {
  it('can be completed from start to finish with ordinary inputs (5 seeds)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { m, t, title } = setup(seed);
      const bot = new TutorialBot(m);
      const input = emptyInput();
      let time = 0;
      while (!t.finished && time < 90) {
        frame(m, t, input, () => bot.act(title(), input, 1 / 60));
        time += 1 / 60;
      }
      summary(
        'tutorial',
        `seed ${seed}: ${t.finished ? 'completed' : 'NOT completed'} in ${time.toFixed(1)}s, recoveries: ${t.recoveries.join('; ') || 'none'}`,
      );
      expect(t.finished).toBe(true);
    }
  });

  it('regression: after a goal in practice the ball can be played again (was frozen forever)', () => {
    const { m } = setup();
    const w = m.world;
    // Score: put the ball in the net.
    w.ball.reset(w.attackDir(0) * (w.pitch.length / 2 + 0.6), 0);
    const input = emptyInput();
    for (let i = 0; i < 120 * 3; i++) {
      m.step(SIM_DT, input);
      consumeEdges(input);
    }
    expect(m.phase).toBe('playing');
    expect(w.restrictTouchTo).toBe(null);
    // The human can take control of the ball now at their feet.
    for (let i = 0; i < 60; i++) {
      m.step(SIM_DT, input);
      consumeEdges(input);
    }
    expect(w.controllerId).toBe(m.humanId);
  });

  it('recovers when the ball is stranded out of reach (but not instantly)', () => {
    const { m, t } = setup();
    t.handle('skip');
    t.handle('skip'); // → Passing (needs the ball)
    const input = emptyInput();
    const w = m.world;
    const h = m.human!;
    w.clearPossession();
    w.ball.reset(h.pos.x - 25 * w.attackDir(0), Math.sign(h.pos.z || 1) * -15);
    for (let i = 0; i < 60 * 2; i++) frame(m, t, input);
    expect(t.recoveries.length).toBe(0); // 2 s: still normal play
    for (let i = 0; i < 60 * 4; i++) frame(m, t, input);
    expect(t.recoveries.some((r) => /ball returned/.test(r))).toBe(true);
    const d = Math.hypot(w.ball.pos.x - m.human!.pos.x, w.ball.pos.z - m.human!.pos.z);
    expect(d).toBeLessThan(2);
  });

  it('recovers a frozen ball immediately and a stalled phase after 3 s', () => {
    const { m, t } = setup();
    const input = emptyInput();
    m.world.restrictTouchTo = -1;
    frame(m, t, input);
    expect(m.world.restrictTouchTo).toBe(null);
    expect(t.recoveries.some((r) => /ball released/.test(r))).toBe(true);
    m.phase = 'stoppage';
    for (let i = 0; i < 60 * 4; i++) frame(m, t, input);
    expect(m.phase).toBe('playing');
  });

  it('frees an immobilised player who keeps pushing the stick', () => {
    const { m, t } = setup();
    const input = emptyInput();
    const h = m.human!;
    h.fooled = 30; // e.g. stuck in a wrong-footed state far longer than normal
    input.move.x = 1;
    for (let i = 0; i < 60 * 2.2; i++) frame(m, t, input);
    expect(t.recoveries.some((r) => /player freed/.test(r))).toBe(true);
    expect(h.fooled).toBe(0);
  });

  it('missed actions do not complete the wrong step: a missed shot completes Shooting but not Score', () => {
    const { m, t } = setup();
    t.handle('skip');
    t.handle('skip');
    t.handle('skip'); // → Shooting
    expect(t.title()).toMatch(/Shooting/);
    m.events.emit('humanKick', { playerId: m.humanId!, kind: 'shot' });
    const input = emptyInput();
    for (let i = 0; i < 90; i++) frame(m, t, input);
    expect(t.title()).toMatch(/Score/);
    for (let i = 0; i < 120; i++) frame(m, t, input); // no goal → stays on Score
    expect(t.title()).toMatch(/Score/);
  });

  it('a pass counts even though control moves to the receiver', () => {
    const { m, t } = setup();
    t.handle('skip');
    t.handle('skip');
    const input = emptyInput();
    for (let i = 0; i < 30; i++) frame(m, t, input);
    const before = m.humanId;
    input.buttons.pass.pressed = true;
    input.buttons.pass.down = true;
    frame(m, t, input);
    input.buttons.pass.down = false;
    input.buttons.pass.released = true;
    input.buttons.pass.held = 0.1;
    for (let i = 0; i < 100; i++) frame(m, t, input);
    expect(m.humanId).not.toBe(before);
    expect(t.title()).toMatch(/Shooting/);
  });

  it('retry / skip / restart move between steps and reset the step state', () => {
    const { m, t } = setup();
    t.handle('skip');
    expect(t.index).toBe(1);
    m.human!.stamina = 0;
    t.handle('retry'); // sprint step setup restores stamina
    expect(m.human!.stamina).toBe(1);
    for (let i = 0; i < 5; i++) t.handle('skip');
    expect(t.finished).toBe(true);
    t.handle('restart');
    expect(t.index).toBe(0);
    expect(t.finished).toBe(false);
  });
});

/** Press a button for one frame (press edge plus release), like a real tap. */
function tap(input: InputFrame, b: keyof InputFrame['buttons']) {
  input.buttons[b].pressed = true;
  input.buttons[b].down = true;
}
function release(input: InputFrame, b: keyof InputFrame['buttons']) {
  input.buttons[b].down = false;
}
const lastText = (shown: string[]) => shown[shown.length - 1] ?? '';
/** Put the AI team-mates near the opponents' goal, out of range of a ball behind the player. */
function awayFromMates(m: Match) {
  const L2 = m.pitch.length / 2;
  for (const p of m.world.players) if (p.team === 0 && p.id !== m.humanId) p.place(m.world.attackDir(0) * (L2 - 4), (p.index - 1) * 6, 0);
}

describe('tutorial: playtest regressions (lost possession, camera, switching, instructions)', () => {
  it('after a goal in practice play resumes without a kick-off, so the celebration camera must end then', () => {
    // The camera used to leave its celebration shot only at a kick-off. Practice and the tutorial never
    // have one, so after scoring the camera kept orbiting the scorer while the ball was elsewhere.
    const { m } = setup();
    const phases: string[] = [];
    m.events.on('phase', (e) => phases.push(e.phase));
    m.world.ball.reset(m.world.attackDir(0) * (m.pitch.length / 2 + 0.6), 0);
    const input = emptyInput();
    for (let i = 0; i < 120 * 8 && m.phase !== 'playing'; i++) {
      m.step(SIM_DT, input);
      consumeEdges(input);
    }
    for (let i = 0; i < 120 * 8; i++) {
      m.step(SIM_DT, input);
      consumeEdges(input);
    }
    expect(phases).toContain('goal');
    expect(phases).not.toContain('kickoff');
    const afterGoal = phases[phases.indexOf('goal') + 1];
    expect(afterGoal).toBe('playing');
    expect(celebrationShotEnds(afterGoal)).toBe(true);
    expect(celebrationShotEnds('kickoff')).toBe(true);
    expect(celebrationShotEnds('replay')).toBe(false); // the replay sets its own shot
    expect(celebrationShotEnds('goal')).toBe(false);
  });

  it('pressing Switch while carrying the ball keeps the ball and the controlled player together', () => {
    const { m, t } = setup();
    t.handle('skip');
    t.handle('skip'); // Passing: ball at the player's feet
    const input = emptyInput();
    for (let i = 0; i < 40; i++) frame(m, t, input);
    expect(m.world.controllerId).toBe(m.humanId);
    const carrier = m.humanId;
    tap(input, 'switch');
    frame(m, t, input);
    release(input, 'switch');
    for (let i = 0; i < 60; i++) frame(m, t, input);
    expect(m.humanId).toBe(carrier);
    expect(m.world.controllerId).toBe(carrier);
  });

  it('if an AI team-mate ever ends up with the ball, control moves to them (no watching someone else keep it)', () => {
    const { m, t } = setup();
    t.handle('skip');
    t.handle('skip');
    const input = emptyInput();
    for (let i = 0; i < 30; i++) frame(m, t, input);
    const mate = m.world.players.find((p) => p.team === 0 && p.id !== m.humanId && !p.isGK)!;
    m.world.ball.reset(mate.footX(0.4), mate.footZ(0.4));
    m.world.clearPossession();
    for (let i = 0; i < 60 && m.world.controllerId !== mate.id; i++) frame(m, t, input);
    expect(m.world.controllerId).toBe(mate.id);
    expect(m.humanId).toBe(mate.id);
  });

  it('losing the ball: a hint says where it is and how to get it back, then it is returned, and the lesson completes', () => {
    const { m, t, shown } = setup();
    t.handle('skip');
    t.handle('skip'); // Passing
    const input = emptyInput();
    const w = m.world;
    // The ball runs away from the player and stops 10 m off (not far enough for the old watchdog), where
    // no team-mate can fetch it within the hint's 2.5 s (if one does, control moves to them: also fine).
    const h = m.human!;
    awayFromMates(m);
    w.clearPossession();
    w.ball.reset(h.pos.x - 10 * w.attackDir(0), h.pos.z);
    for (let i = 0; i < 60 * 3; i++) frame(m, t, input);
    expect(lastText(shown)).toMatch(/The ball is over there: run to it, or press <kbd>R<\/kbd> to bring it back/);
    for (let i = 0; i < 60 * 7; i++) frame(m, t, input);
    expect(t.recoveries.some((r) => /Passing: ball returned/.test(r))).toBe(true);
    expect(Math.hypot(w.ball.pos.x - m.human!.pos.x, w.ball.pos.z - m.human!.pos.z)).toBeLessThan(2);
    // …and the lesson can still be completed, once the player has the returned ball under control.
    for (let i = 0; i < 60 && m.world.controllerId !== m.humanId; i++) frame(m, t, input);
    expect(m.world.controllerId).toBe(m.humanId);
    tap(input, 'pass');
    frame(m, t, input);
    release(input, 'pass');
    input.buttons.pass.released = true;
    input.buttons.pass.held = 0.1;
    for (let i = 0; i < 120; i++) frame(m, t, input);
    expect(t.title()).toMatch(/Shooting/);
  });

  it('an unexpected goal during a lesson resumes play with the ball at the player’s feet, on the same lesson', () => {
    const { m, t } = setup();
    t.handle('skip');
    t.handle('skip'); // Passing
    const input = emptyInput();
    m.world.ball.reset(m.world.attackDir(0) * (m.pitch.length / 2 + 0.6), 0);
    for (let i = 0; i < 60 * 10; i++) frame(m, t, input);
    expect(m.phase).toBe('playing');
    expect(t.title()).toMatch(/Passing/);
    expect(m.world.restrictTouchTo).toBe(null);
    const h = m.human!;
    expect(Math.hypot(m.world.ball.pos.x - h.pos.x, m.world.ball.pos.z - h.pos.z)).toBeLessThan(3);
  });

  it('ball out of play comes straight back (practice has no restarts)', () => {
    const { m, t } = setup();
    t.handle('skip');
    t.handle('skip');
    const input = emptyInput();
    m.world.clearPossession();
    m.world.ball.reset(0, m.pitch.width / 2 + 2);
    for (let i = 0; i < 60 * 2; i++) frame(m, t, input);
    expect(Math.abs(m.world.ball.pos.z)).toBeLessThan(m.pitch.width / 2);
    expect(m.phase).toBe('playing');
  });

  it('touch: lessons and instructions only use controls a touch screen has', () => {
    const { t, shown } = setup(1, 'touch');
    expect(t.steps.map((s) => s.name)).toEqual(['Movement', 'Sprint', 'Passing', 'Shooting', 'Score!']); // no skill button on touch
    expect(t.title()).toBe('Step 1 / 5 · Movement');
    expect(lastText(shown)).toMatch(/Joystick/);
    for (let i = 0; i < t.steps.length; i++) {
      const text = lastText(shown);
      expect(text, t.title()).not.toMatch(/<kbd>(R|J|K|L|Space|W|A|S|D|L-Shift)<\/kbd>/);
      t.handle('skip');
    }
    expect(t.finished).toBe(true);
    expect(lastText(shown)).toMatch(/Tackle, Switch and Slide/);
  });

  it('touch: without a reset button, a lost ball is returned automatically and the hint says so', () => {
    const { m, t, shown } = setup(1, 'touch');
    t.handle('skip');
    t.handle('skip');
    const input = emptyInput();
    const h = m.human!;
    awayFromMates(m);
    m.world.clearPossession();
    m.world.ball.reset(h.pos.x - 10 * m.world.attackDir(0), h.pos.z);
    for (let i = 0; i < 60 * 3; i++) frame(m, t, input);
    expect(lastText(shown)).toMatch(/It comes back to you if it stays out of reach/);
    for (let i = 0; i < 60 * 3; i++) frame(m, t, input);
    expect(t.recoveries.some((r) => /ball returned/.test(r))).toBe(true);
  });

  it('changing input method mid-lesson redraws the instructions with the new controls', () => {
    const { t, shown, settings } = setup();
    t.handle('skip');
    t.handle('skip'); // Passing, keyboard: "press Space"
    expect(lastText(shown)).toMatch(/<kbd>Space<\/kbd>/);
    settings.controlScheme = 'controller';
    t.update(1 / 60, emptyInput());
    expect(lastText(shown)).not.toMatch(/<kbd>Space<\/kbd>/);
    expect(lastText(shown)).toMatch(/<kbd>A<\/kbd>/);
  });

  it('switching to touch on the skill lesson moves on, because touch has no skill button', () => {
    const { t, settings } = setup();
    for (let i = 0; i < 5; i++) t.handle('skip'); // Skill move
    expect(t.title()).toMatch(/Skill move/);
    settings.controlScheme = 'touch';
    t.update(1 / 60, emptyInput());
    expect(t.finished).toBe(true);
  });

  it('completes despite AI interference and lost balls (the ball is knocked away at random, 6 seeds)', () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const { m, t, title } = setup(seed);
      const bot = new TutorialBot(m);
      const input = emptyInput();
      let time = 0;
      let nextKnock = 4;
      while (!t.finished && time < 180) {
        frame(m, t, input, () => bot.act(title(), input, 1 / 60));
        time += 1 / 60;
        if (time > nextKnock) {
          // Simulates losing the ball: a deflection sends it 15–30 m away.
          nextKnock = time + 6 + (seed % 3);
          const w = m.world;
          w.clearPossession();
          const a = seed * 1.7 + time;
          w.ball.vel.set(Math.cos(a) * 14, 0, Math.sin(a) * 14);
        }
      }
      summary(
        'tutorial',
        `interference seed ${seed}: ${t.finished ? 'completed' : 'NOT completed'} in ${time.toFixed(1)}s, recoveries: ${t.recoveries.length}`,
      );
      expect(t.finished, `seed ${seed}`).toBe(true);
    }
  });
});
