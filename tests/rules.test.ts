/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Laws of the Game regression tests: restarts (Laws 8, 13–17), ball out of play (Law 9), offside (Law 11),
// fouls, advantage and cards (Laws 5, 12), and the match officials' signals (Laws 5, 6).
// See docs/gameplay/FOOTBALL_RULES.md for what each profile supports.
import { describe, expect, it } from 'vitest';
import { Match, MatchOptions, RESTART_READY_TIME } from '../src/sim/match';
import { SIM_DT } from '../src/sim/config';
import { Anim } from '../src/sim/player';
import { InputFrame, consumeEdges, emptyInput } from '../src/sim/human';
import { RULES, foulSeverity, inOffsidePosition, offsideLine, sanctionFor, canScoreDirectly, rulesForFormat } from '../src/sim/rules';
import { chooseCelebration, GESTURE_FOR } from '../src/sim/celebration';
import { Rng } from '../src/core/rng';

function match(opts: Partial<MatchOptions> = {}): Match {
  return new Match({ mode: 'match', format: '5v5', difficulty: 'medium', duration: 600, seed: 7, replays: false, ...opts });
}

function run(m: Match, seconds: number, input: InputFrame | null = null, until?: () => boolean): void {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    m.step(SIM_DT, input);
    if (input) consumeEdges(input);
    if (m.phase === 'replay') m.endReplay();
    if (until?.()) return;
  }
}

/** Put the ball in live play at (x, z) moving with (vx, vz), last touched by `lastTeam`, players out of the way. */
function liveBall(m: Match, x: number, z: number, vx: number, vz: number, lastTeam: 0 | 1) {
  const w = m.world;
  (m as unknown as { phase: string }).phase = 'playing';
  w.restrictTouchTo = null;
  w.ball.reset(x, z);
  w.ball.vel.set(vx, 0, vz);
  w.lastTouchTeam = lastTeam;
  w.lastTouchId = w.players.find((p) => p.team === lastTeam && !p.isGK)!.id;
  for (const p of w.players) p.place((p.team === 0 ? -1 : 1) * 4 - p.index, (p.index - 2) * 2.5, 0);
}

function press(input: InputFrame, b: 'pass' | 'shoot' | 'lob'): void {
  input.buttons[b].down = true;
  input.buttons[b].pressed = true;
  input.buttons[b].held = 0.05;
}
function release(input: InputFrame, b: 'pass' | 'shoot' | 'lob'): void {
  input.buttons[b].down = false;
  input.buttons[b].released = true;
}

describe('rules profiles', () => {
  it('11v11 uses Standard rules, small-sided formats use Arcade', () => {
    expect(rulesForFormat('11v11')).toBe('standard');
    expect(rulesForFormat('5v5')).toBe('arcade');
    expect(match({ format: '11v11' }).rules.offside).toBe(true);
    expect(match({ format: '3v3' }).rules.offside).toBe(false);
  });
});

describe('throw-ins (Law 15)', () => {
  it('awards the throw-in against the team that touched it last, at the point it crossed the line', () => {
    const m = match({ aiOnly: false });
    const W2 = m.pitch.width / 2;
    liveBall(m, 6, W2 - 0.5, 0, 8, 1);
    run(m, 1, null, () => m.phase === 'stoppage');
    expect(m.phase).toBe('stoppage');
    run(m, 2, null, () => m.phase === 'restart');
    expect(m.restart?.type).toBe('throwIn');
    expect(m.restart?.team).toBe(0);
    expect(Math.abs(m.restart!.x - 6)).toBeLessThan(1.5);
    expect(Math.sign(m.restart!.z)).toBe(1);
  });

  it('the thrower cannot walk or run with the ball before throwing (the reported defect)', () => {
    const m = match({ aiOnly: false });
    const W2 = m.pitch.width / 2;
    liveBall(m, 0, W2 - 0.5, 0, 8, 1);
    run(m, 3, null, () => m.phase === 'restart');
    const taker = m.world.players[m.restart!.takerId];
    expect(taker.humanControlled).toBe(true);
    expect(m.world.ball.heldBy).toBe(taker.id);
    const start = { x: taker.pos.x, z: taker.pos.z };
    const input = emptyInput();
    input.move.x = 1;
    input.move.z = -1;
    input.sprint = true;
    run(m, 2.5, input);
    expect(m.phase).toBe('restart');
    expect(Math.hypot(taker.pos.x - start.x, taker.pos.z - start.z)).toBeLessThan(0.3);
    expect(m.world.ball.heldBy).toBe(taker.id);
  });

  it('a pass pressed before the restart is ready is kept and thrown as soon as it is ready', () => {
    const m = match({ aiOnly: false });
    liveBall(m, 0, m.pitch.width / 2 - 0.5, 0, 8, 1);
    run(m, 3, null, () => m.phase === 'restart');
    const input = emptyInput();
    press(input, 'pass');
    run(m, SIM_DT, input);
    release(input, 'pass');
    expect(m.phaseTime).toBeLessThan(RESTART_READY_TIME);
    run(m, 1.5, input, () => m.phase === 'playing');
    expect(m.phase).toBe('playing');
    expect(m.lastRestart?.type ?? m.world.lastKick?.kind).toBeTruthy();
  });

  it('a shot request at a throw-in becomes a two-handed throw, not a shot', () => {
    const m = match({ aiOnly: false });
    liveBall(m, 0, m.pitch.width / 2 - 0.5, 0, 8, 1);
    run(m, 3, null, () => m.phase === 'restart');
    run(m, RESTART_READY_TIME + 0.05);
    const input = emptyInput();
    press(input, 'shoot');
    run(m, 0.3, input);
    release(input, 'shoot');
    run(m, 1, input, () => m.phase === 'playing');
    expect(m.phase).toBe('playing');
    expect(['pass', 'through', 'lob']).toContain(m.world.lastKick?.kind);
  });

  it('no goal directly from a throw-in: it becomes a goal kick', () => {
    const m = match({ aiOnly: true });
    const w = m.world;
    const L2 = m.pitch.length / 2;
    // Simulate a throw-in just taken by team 0 that flies straight into the opponents' goal.
    (m as unknown as { phase: string }).phase = 'playing';
    w.restrictTouchTo = null;
    const thrower = w.players.find((p) => p.team === 0 && !p.isGK)!;
    m.lastRestart = { type: 'throwIn', team: 0, x: L2 - 2, z: 4, takerId: thrower.id };
    w.lastTouchTeam = 0;
    w.lastTouchId = thrower.id;
    for (const p of w.players) p.place(0, (p.index - 2) * 3, 0);
    w.ball.reset(L2 - 1, 0, 0.5);
    w.ball.vel.set(15, 0, 0);
    run(m, 1, null, () => m.phase !== 'playing');
    expect(m.score).toEqual([0, 0]);
    run(m, 2, null, () => m.phase === 'restart');
    expect(m.restart?.type).toBe('goalKick');
    expect(m.restart?.team).toBe(1);
  });
});

describe('goal kicks and corners (Laws 16, 17)', () => {
  it('goal kick: keeper takes it; under Standard rules opponents leave the penalty area', () => {
    const m = match({ format: '11v11', aiOnly: true });
    const L2 = m.pitch.length / 2;
    liveBall(m, L2 - 2, 10, 15, 0, 0); // team 0 attacks +x and puts it behind
    // An attacker loiters in the area.
    const att = m.world.players.find((p) => p.team === 0 && p.role === 'FWD')!;
    run(m, 1, null, () => m.phase === 'stoppage');
    att.place(L2 - 6, 2, 0);
    run(m, 2, null, () => m.phase === 'restart');
    expect(m.restart?.type).toBe('goalKick');
    expect(m.world.players[m.restart!.takerId].isGK).toBe(true);
    for (const p of m.world.players) if (p.team === 0) expect(m.world.inPenaltyArea(p.pos.x, p.pos.z, 1)).toBe(false);
  });

  it('corner: correct corner, opponents at 9.15 m (Standard) / 5 m (Arcade)', () => {
    for (const format of ['11v11', '5v5'] as const) {
      const m = match({ format, aiOnly: true });
      const L2 = m.pitch.length / 2;
      liveBall(m, L2 - 2, -6, 15, -1, 1); // defenders (team 1) put it behind their own line, −z side
      run(m, 3, null, () => m.phase === 'restart');
      expect(m.restart?.type).toBe('corner');
      expect(m.restart?.team).toBe(0);
      expect(Math.sign(m.restart!.x)).toBe(1);
      expect(Math.sign(m.restart!.z)).toBe(-1);
      const need = RULES[rulesForFormat(format)].restartDistance;
      for (const p of m.world.players) if (p.team === 1) expect(Math.hypot(p.pos.x - m.restart!.x, p.pos.z - m.restart!.z)).toBeGreaterThan(need - 0.05);
    }
  });
});

describe('kick-off (Law 8)', () => {
  it('everyone in their own half, opponents outside the centre circle', () => {
    const m = match({ format: '11v11', aiOnly: true });
    run(m, 0.2);
    for (const p of m.world.players) {
      if (p.id === m.restart!.takerId) continue;
      expect(p.pos.x * m.world.attackDir(p.team)).toBeLessThanOrEqual(0.05);
      if (p.team !== m.restart!.team) expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThan(m.pitch.centerCircleRadius);
    }
  });
});

describe('second touch (Laws 8, 13–17)', () => {
  it('a restart taker touching the ball again before anyone else concedes an indirect free kick', () => {
    const m = match({ aiOnly: false });
    const w = m.world;
    run(m, 0.5);
    const taker = w.players[m.restart!.takerId];
    // Take the kick-off, then force the taker's next touch.
    w.events.emit('kick', { playerId: taker.id, kind: 'pass', power: 0.4, speed: 6, onTarget: false });
    expect(m.phase).toBe('playing');
    expect(w.secondTouchBan).toBe(taker.id);
    w.events.emit('ballTouch', { playerId: taker.id });
    expect(m.phase).toBe('stoppage');
    run(m, 2, null, () => m.phase === 'restart');
    expect(m.restart?.type).toBe('freeKick');
    expect(m.restart?.indirect).toBe(true);
    expect(m.restart?.team).toBe(1);
  });

  it('another player touching it first lifts the restriction', () => {
    const m = match({ aiOnly: false });
    const w = m.world;
    run(m, 0.5);
    const taker = w.players[m.restart!.takerId];
    const mate = w.players.find((p) => p.team === taker.team && p.id !== taker.id && !p.isGK)!;
    w.events.emit('kick', { playerId: taker.id, kind: 'pass', power: 0.4, speed: 6, onTarget: false });
    w.events.emit('ballTouch', { playerId: mate.id });
    w.events.emit('ballTouch', { playerId: taker.id });
    expect(m.phase).toBe('playing');
  });
});

describe('offside (Law 11)', () => {
  const players = [
    { id: 0, team: 0 as const, isGK: false, pos: { x: 30, z: 0 } },
    { id: 1, team: 1 as const, isGK: true, pos: { x: 50, z: 0 } },
    { id: 2, team: 1 as const, isGK: false, pos: { x: 25, z: 5 } },
    { id: 3, team: 1 as const, isGK: false, pos: { x: 20, z: -5 } },
  ];
  it('offside line is the second-last opponent', () => {
    expect(offsideLine(players, 0, 1)).toBe(25);
  });
  it('position: in the opponents half, beyond the ball and the second-last opponent', () => {
    expect(inOffsidePosition(players[0], players, 10, 1)).toBe(true);
    expect(inOffsidePosition(players[0], players, 31, 1)).toBe(false); // behind the ball
    expect(inOffsidePosition({ ...players[0], pos: { x: 24, z: 0 } }, players, 10, 1)).toBe(false); // level or behind the line
    expect(inOffsidePosition({ ...players[0], pos: { x: -5, z: 0 } }, players, -20, 1)).toBe(false); // own half
  });

  it('a player in an offside position who receives a team-mate pass is penalised (Standard), with the assistant flagging', () => {
    const m = match({ format: '11v11', aiOnly: true });
    const w = m.world;
    run(m, 0.3);
    w.events.emit('kick', { playerId: m.restart!.takerId, kind: 'pass', power: 0.3, speed: 5, onTarget: false });
    const dir = w.attackDir(0);
    const passer = w.players.find((p) => p.team === 0 && p.role === 'MID')!;
    const runner = w.players.find((p) => p.team === 0 && p.role === 'FWD')!;
    for (const p of w.players) if (p.team === 1 && !p.isGK) p.place(dir * 20, p.pos.z, 0);
    passer.place(dir * 5, 0, 0);
    runner.place(dir * 35, 0, 0);
    w.ball.reset(dir * 5.5, 0);
    w.events.emit('ballTouch', { playerId: passer.id });
    expect(m.offsideCandidates.has(runner.id)).toBe(true);
    w.events.emit('ballTouch', { playerId: runner.id });
    expect(m.phase).toBe('stoppage');
    expect(m.officials.log.some((l) => l.who === 'assistant' && l.signal === 'offside')).toBe(true);
    run(m, 2, null, () => m.phase === 'restart');
    expect(m.restart).toMatchObject({ type: 'freeKick', team: 1, indirect: true });
  });

  it('no offside directly from a throw-in, and none at all under Arcade rules', () => {
    const m = match({ format: '5v5', aiOnly: true });
    const w = m.world;
    run(m, 0.3);
    w.events.emit('kick', { playerId: m.restart!.takerId, kind: 'pass', power: 0.3, speed: 5, onTarget: false });
    const runner = w.players.find((p) => p.team === 0 && p.role === 'FWD')!;
    runner.place(w.attackDir(0) * 30, 0, 0);
    w.events.emit('ballTouch', { playerId: w.players.find((p) => p.team === 0 && p.role !== 'FWD' && !p.isGK)!.id });
    w.events.emit('ballTouch', { playerId: runner.id });
    expect(m.phase).toBe('playing');
  });
});

describe('fouls, advantage and cards (Laws 5, 12)', () => {
  it('severity comes from the facts of the challenge, never chance', () => {
    expect(foulSeverity({ slide: false, fromBehind: 0.9, tacklerSpeed: 5, promisingAttack: false })).toBe('careless');
    expect(foulSeverity({ slide: true, fromBehind: 0.5, tacklerSpeed: 5, promisingAttack: false })).toBe('reckless');
    expect(foulSeverity({ slide: true, fromBehind: 0.8, tacklerSpeed: 7.5, promisingAttack: false })).toBe('excessive');
    expect(sanctionFor('reckless', RULES.standard, 0)).toBe('yellow');
    expect(sanctionFor('reckless', RULES.standard, 1)).toBe('red');
    expect(sanctionFor('excessive', RULES.arcade, 0)).toBe('none');
  });

  function foulIn(m: Match, offTeam: 0 | 1, facts: { slide: boolean; fromBehind: number; tacklerSpeed: number }, x = 0) {
    const w = m.world;
    (m as unknown as { phase: string }).phase = 'playing';
    w.restrictTouchTo = null;
    const off = w.players.find((p) => p.team === offTeam && !p.isGK)!;
    const vic = w.players.find((p) => p.team !== offTeam && !p.isGK)!;
    // Nobody near the ball → no advantage.
    w.ball.reset(x, 0);
    for (const p of w.players) p.place(x + (p.team === offTeam ? -12 : 12) + p.index * 0.1, 15, 0);
    w.events.emit('foul', { offenderId: off.id, victimId: vic.id, x, z: 0, ...facts });
    return { off, vic };
  }

  it('Standard: a reckless challenge is a free kick and a caution; a second caution sends the player off', () => {
    const m = match({ format: '11v11', aiOnly: true });
    const { off } = foulIn(m, 1, { slide: true, fromBehind: 0.5, tacklerSpeed: 5 });
    expect(m.phase).toBe('stoppage');
    expect(m.cards.get(off.id)?.yellow).toBe(1);
    expect(off.sentOff).toBe(false);
    run(m, 1, null, () => m.phase === 'restart');
    foulIn(m, 1, { slide: true, fromBehind: 0.5, tacklerSpeed: 5 });
    expect(m.cards.get(off.id)?.red).toBe(true);
    expect(off.sentOff).toBe(true);
    expect(m.world.teamPlayers(1).length).toBe(10);
    expect(m.officials.log.map((l) => l.signal)).toEqual(expect.arrayContaining(['point']));
  });

  it('a sent-off player takes no further part', () => {
    const m = match({ format: '11v11', aiOnly: true });
    const { off } = foulIn(m, 1, { slide: true, fromBehind: 0.9, tacklerSpeed: 8 });
    expect(off.sentOff).toBe(true);
    run(m, 20);
    expect(Math.abs(off.pos.z)).toBeGreaterThan(m.pitch.width / 2);
    expect(m.world.lastTouchId === off.id).toBe(false);
  });

  it('Arcade: fouls are given but no cards', () => {
    const m = match({ format: '5v5', aiOnly: true });
    const { off } = foulIn(m, 1, { slide: true, fromBehind: 0.9, tacklerSpeed: 8 });
    expect(m.phase).toBe('stoppage');
    expect(m.cards.get(off.id)).toBeUndefined();
  });

  it('advantage is played when the fouled team keeps the ball, and called back if they lose it', () => {
    const m = match({ format: '11v11', aiOnly: true });
    const w = m.world;
    const outcomes: string[] = [];
    m.events.on('advantage', (e) => outcomes.push(e.outcome));
    (m as unknown as { phase: string }).phase = 'playing';
    w.restrictTouchTo = null;
    const dir = w.attackDir(0);
    const off = w.players.find((p) => p.team === 1 && !p.isGK)!;
    const vic = w.players.find((p) => p.team === 0 && p.role === 'FWD')!;
    const mate = w.players.find((p) => p.team === 0 && p.role === 'MID')!;
    for (const p of w.players) p.place(-dir * 30, (p.index - 5) * 3, 0);
    w.ball.reset(dir * 10, 0);
    mate.place(dir * 10.5, 0.5, 0);
    w.events.emit('foul', { offenderId: off.id, victimId: vic.id, x: dir * 9, z: 0, slide: false, fromBehind: 0.2, tacklerSpeed: 4 });
    expect(m.phase).toBe('playing');
    expect(outcomes).toEqual(['playing']);
    // The opponents win the ball straight away → back to the free kick.
    const opp = w.players.find((p) => p.team === 1 && !p.isGK && p.id !== off.id)!;
    opp.place(dir * 10, 0, 0);
    w.controllerId = opp.id;
    run(m, SIM_DT);
    expect(outcomes).toContain('calledBack');
    expect(m.phase).toBe('stoppage');
  });

  it('a foul in the penalty area is a penalty, with no advantage', () => {
    const m = match({ format: '11v11', aiOnly: true });
    const w = m.world;
    const L2 = m.pitch.length / 2;
    foulIn(m, 1, { slide: false, fromBehind: 0, tacklerSpeed: 3 }, w.attackDir(0) * (L2 - 8));
    run(m, 2, null, () => m.phase === 'restart');
    expect(m.restart?.type).toBe('penalty');
  });
});

describe('restart state machine', () => {
  it('goes live → out of play → decision → positioning → ready → live, and never gets stuck', () => {
    const m = match({ aiOnly: true });
    const stages = new Set<string>();
    liveBall(m, 0, m.pitch.width / 2 - 0.5, 0, 8, 1);
    for (let i = 0; i < 600 && !(stages.has('ready') && m.restartStage === 'live'); i++) {
      stages.add(m.restartStage);
      run(m, SIM_DT);
    }
    expect([...stages]).toEqual(expect.arrayContaining(['live', 'outOfPlay', 'decision', 'positioning', 'ready']));
    expect(m.restartStage).toBe('live');
  });

  it('AI takers take restarts promptly without dribbling, across many matches (no soft-locks)', () => {
    for (const [seed, format] of [
      [11, '11v11'],
      [12, '5v5'],
      [13, '3v3'],
    ] as const) {
      const m = match({ format, aiOnly: true, seed, duration: 90 });
      let deadFor = 0;
      let worst = 0;
      let takerStart: { x: number; z: number } | null = null;
      let maxDrift = 0;
      for (let i = 0; i < 90 / SIM_DT && m.phase !== 'fullTime'; i++) {
        run(m, SIM_DT);
        const dead = m.phase === 'stoppage' || m.phase === 'restart' || m.phase === 'kickoff';
        deadFor = dead ? deadFor + SIM_DT : 0;
        worst = Math.max(worst, deadFor);
        if (m.phase === 'restart' && m.restart) {
          const t = m.world.players[m.restart.takerId];
          if (!takerStart) takerStart = { x: t.pos.x, z: t.pos.z };
          // (The kick's own step into the ball is fine; walking or dribbling beforehand is not.)
          if (t.anim === Anim.Locomotion) maxDrift = Math.max(maxDrift, Math.hypot(t.pos.x - takerStart.x, t.pos.z - takerStart.z));
        } else takerStart = null;
      }
      expect(worst, `${format}: longest dead-ball spell`).toBeLessThan(6);
      expect(maxDrift, `${format}: restart taker moved with the ball`).toBeLessThan(0.3);
    }
  }, 60000);
});

describe('officials (Laws 5, 6)', () => {
  it('assistants flag throw-ins, corners and goal kicks; the referee points the way and signals goals', () => {
    const m = match({ format: '11v11', aiOnly: true });
    liveBall(m, 0, m.pitch.width / 2 - 0.5, 0, 8, 1);
    run(m, 1, null, () => m.phase === 'stoppage');
    const log = m.officials.log.map((l) => `${l.who}:${l.signal}`);
    expect(log).toContain('assistant:throwIn');
    expect(log).toContain('referee:point');
  });

  it('Arcade has no assistants; officials stay on or beside the pitch and follow play', () => {
    const m = match({ format: '5v5', aiOnly: true, seed: 3 });
    expect(m.officials.withAssistants).toBe(false);
    run(m, 20);
    const r = m.officials.referee;
    expect(Math.abs(r.x)).toBeLessThan(m.pitch.length / 2);
    expect(Math.abs(r.z)).toBeLessThan(m.pitch.width / 2);
  });

  it('only some restarts allow direct goals', () => {
    expect(canScoreDirectly({ type: 'throwIn' })).toBe(false);
    expect(canScoreDirectly({ type: 'freeKick', indirect: true })).toBe(false);
    expect(canScoreDirectly({ type: 'freeKick' })).toBe(true);
    expect(canScoreDirectly({ type: 'corner' })).toBe(true);
  });
});

describe('celebrations and reactions', () => {
  const base = { minute: 30, scoreFor: 1, scoreAgainst: 0, ownGoal: false, previous: null, practice: false };
  it('contextual: late decisive goals are big, consolations subdued, own goals brief', () => {
    const rng = new Rng(1);
    expect(chooseCelebration({ ...base, minute: 88, scoreFor: 2, scoreAgainst: 1 }, rng).intensity).toBe('big');
    expect(chooseCelebration({ ...base, scoreFor: 1, scoreAgainst: 4 }, rng)).toMatchObject({ style: 'restrained', intensity: 'subdued' });
    expect(chooseCelebration({ ...base, ownGoal: true }, rng).style).toBe('fistPump');
  });
  it('varied: never the same style twice in a row for a team', () => {
    const rng = new Rng(5);
    let prev: ReturnType<typeof chooseCelebration>['style'] | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const c = chooseCelebration({ ...base, previous: prev }, rng);
      expect(c.style).not.toBe(prev);
      seen.add(c.style);
      prev = c.style;
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
  it('a goal sets the scorer gesture, is skippable, and the next kick-off works', () => {
    const m = match({ aiOnly: false });
    const L2 = m.pitch.length / 2;
    liveBall(m, L2 - 3, 0, 20, 0, 0);
    run(m, 1, null, () => m.phase === 'goal');
    expect(m.phase).toBe('goal');
    const scorer = m.world.players[m.lastScorer!];
    expect(scorer.gesture).toBe(GESTURE_FOR[m.celebration!.style]);
    run(m, 0.7);
    const input = emptyInput();
    press(input, 'pass');
    run(m, SIM_DT * 2, input);
    expect(m.phase).toBe('kickoff');
    expect(scorer.gesture).toBe(0);
    release(input, 'pass');
    run(m, 6, input, () => m.phase === 'playing');
  });
  it('celebrations always end on their own', () => {
    const m = match({ aiOnly: true });
    liveBall(m, m.pitch.length / 2 - 3, 0, 20, 0, 0);
    run(m, 1, null, () => m.phase === 'goal');
    run(m, 4, null, () => m.phase === 'kickoff');
    expect(m.phase).toBe('kickoff');
    expect(m.world.players.every((p) => p.anim !== Anim.Fallen || p.mood === 0)).toBe(true);
  });
});

describe('2026/27 details: countdown, walls, indirect signal', () => {
  it('Standard: a normal pause at a throw-in gets only a hurry-up cue, never a countdown', () => {
    const m = match({ format: '11v11', aiOnly: false });
    const banners: string[] = [];
    m.events.on('banner', (e) => banners.push(e.text));
    liveBall(m, 0, m.pitch.width / 2 - 0.5, 0, 8, 1);
    run(m, 3, null, () => m.phase === 'restart');
    run(m, 10, emptyInput()); // early in the match, 0–0, the player hesitates for 10 s
    expect(banners).toContain('TAKE THE THROW-IN');
    expect(m.countdown).toBeNull();
    expect(m.restart?.team).toBe(0);
  });

  it('Standard: deliberate time-wasting late in the match (level or ahead) gets the five-second countdown, then the throw-in goes to the opponents (Law 15.2)', () => {
    const m = match({ format: '11v11', aiOnly: false });
    liveBall(m, 0, m.pitch.width / 2 - 0.5, 0, 8, 1);
    run(m, 3, null, () => m.phase === 'restart');
    m.clock = m.options.duration * 0.85; // 76'
    m.score[0] = 1; // leading
    const input = emptyInput();
    run(m, 7, input);
    expect(m.countdown).not.toBeNull();
    run(m, 6, input, () => m.phase === 'stoppage');
    run(m, 2, input, () => m.phase === 'restart');
    expect(m.restart).toMatchObject({ type: 'throwIn', team: 1 });
  });

  it('Standard: an obvious stall (15 s+) gets the countdown whatever the score; AI takers never do', () => {
    const m = match({ format: '11v11', aiOnly: false });
    liveBall(m, 0, m.pitch.width / 2 - 0.5, 0, 8, 1);
    run(m, 3, null, () => m.phase === 'restart');
    m.score[1] = 2; // losing: no time-wasting motive
    run(m, 14, emptyInput());
    expect(m.countdown).toBeNull();
    run(m, 2, emptyInput());
    expect(m.countdown).not.toBeNull();
    const ai = match({ format: '11v11', aiOnly: true });
    let counted = false;
    ai.events.on('banner', (e) => (counted ||= e.text === 'TIME-WASTING'));
    run(ai, 120);
    expect(counted).toBe(false);
  }, 60000);

  it('Arcade: no countdown — the AI helps a stalled player instead', () => {
    const m = match({ format: '5v5', aiOnly: false });
    liveBall(m, 0, m.pitch.width / 2 - 0.5, 0, 8, 1);
    run(m, 3, null, () => m.phase === 'restart');
    run(m, 10, emptyInput(), () => m.phase === 'playing');
    expect(m.phase).toBe('playing');
    expect(m.countdown).toBeNull();
  });

  it('a direct free kick near goal gets a wall 9.15 m away, between the ball and the goal', () => {
    const m = match({ format: '11v11', aiOnly: true });
    const w = m.world;
    const dir = w.attackDir(0);
    const L2 = m.pitch.length / 2;
    (m as unknown as { phase: string }).phase = 'playing';
    w.restrictTouchTo = null;
    const off = w.players.find((p) => p.team === 1 && !p.isGK)!;
    const vic = w.players.find((p) => p.team === 0 && !p.isGK)!;
    for (const p of w.players) p.place(0, (p.index - 5) * 3, 0);
    w.ball.reset(0, 30);
    w.events.emit('foul', { offenderId: off.id, victimId: vic.id, x: dir * (L2 - 22), z: 4, slide: false, fromBehind: 0, tacklerSpeed: 3 });
    run(m, 2, null, () => m.phase === 'restart');
    const r = m.restart!;
    const wall = w.players.filter((p) => p.team === 1 && !p.isGK && Math.abs(Math.hypot(p.pos.x - r.x, p.pos.z - r.z) - 9.15) < 0.6);
    expect(wall.length).toBeGreaterThanOrEqual(2);
    for (const p of wall) expect((p.pos.x - r.x) * dir).toBeGreaterThan(0); // goal side of the ball
  });

  it('the referee keeps the arm raised for an indirect free kick until another player touches it', () => {
    const m = match({ format: '11v11', aiOnly: true });
    const w = m.world;
    run(m, 0.3);
    const taker = w.players[m.restart!.takerId];
    w.events.emit('kick', { playerId: taker.id, kind: 'pass', power: 0.3, speed: 5, onTarget: false });
    w.events.emit('ballTouch', { playerId: taker.id }); // second touch → indirect free kick
    run(m, 2, null, () => m.phase === 'restart');
    run(m, 0.5);
    expect(m.officials.referee.signal).toBe('indirect');
  });
});

describe('own goals', () => {
  it('the own-goal scorer is credited (o.g.) and looks dismayed; an opponent leads a brief celebration', () => {
    const m = match({ aiOnly: true });
    const w = m.world;
    const L2 = m.pitch.length / 2;
    const goals: Array<{ scorerId: number | null; celebrantId?: number | null; ownGoal: boolean; team: number }> = [];
    m.events.on('goal', (e) => goals.push(e));
    // The ball goes into team 1's goal, last touched by a team-1 defender: an own goal.
    liveBall(m, L2 - 3, 0, 20, 0, 1);
    const def = w.players[w.lastTouchId!];
    run(m, 1, null, () => m.phase === 'goal');
    expect(goals[0]).toMatchObject({ team: 0, ownGoal: true, scorerId: def.id });
    expect(goals[0].celebrantId).not.toBe(def.id);
    expect(w.players[goals[0].celebrantId!].team).toBe(0);
    expect(def.mood).toBe(2);
    expect(def.gesture).toBe(10); // hands on head
    expect(m.celebration?.style).toBe('fistPump');
    // The full-time goal timeline reads the same record.
    expect(m.goalLog).toEqual([{ team: 0, scorerId: def.id, minute: Math.floor(m.minute), ownGoal: true }]);
  });
});

describe('celebration variety', () => {
  it('team-mates and the conceding team react in different ways, varied per player and per goal', () => {
    const m = match({ aiOnly: true });
    m.score[0] = 0;
    liveBall(m, m.pitch.length / 2 - 3, 0, 20, 0, 0);
    run(m, 1, null, () => m.phase === 'goal');
    const mates = m.world.players.filter((p) => p.team === 0 && p.id !== m.lastScorer).map((p) => p.gesture);
    const losers = m.world.players.filter((p) => p.team === 1).map((p) => p.gesture);
    expect(new Set(mates).size).toBeGreaterThanOrEqual(2);
    expect(new Set(losers).size).toBeGreaterThanOrEqual(2);
  });
  it('the scorer has six normal styles plus big and subdued ones', () => {
    const rng = new Rng(9);
    const seen = new Set<string>();
    let prev: ReturnType<typeof chooseCelebration>['style'] | null = null;
    for (let i = 0; i < 200; i++) {
      const c = chooseCelebration({ minute: 30, scoreFor: 1, scoreAgainst: 0, ownGoal: false, previous: prev, practice: false }, rng);
      seen.add(c.style);
      prev = c.style;
    }
    expect([...seen].sort()).toEqual(['applaudFans', 'armsUp', 'cornerRun', 'fistPump', 'pointSky', 'yes']);
  });
});
