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
import { chooseClearance, evaluatePass } from '../src/sim/ai/evaluate';
import { runAudit } from '../src/dev/aiAudit';
import { makeMatch, clearPitch } from './helpers';

/** Scenario harness: an empty 5v5 pitch with chosen players placed by hand. */
function setup() {
  const m = makeMatch({ format: '5v5', seed: 3, aiOnly: true });
  (m as unknown as { phase: string }).phase = 'playing';
  m.world.restrictTouchTo = null;
  const w = m.world;
  const mine = w.players.filter((p) => p.team === 0 && !p.isGK);
  const theirs = w.players.filter((p) => p.team === 1 && !p.isGK);
  return { m, w, mine, theirs, dir: w.attackDir(0) };
}

describe('AI pass evaluation (scenarios)', () => {
  it('a through ball into space a defender reaches first is rated risky; into open space it is safe', () => {
    const { m, w, mine, theirs, dir } = setup();
    const [passer, runner] = mine;
    const [def] = theirs;
    clearPitch(m, [passer.id, runner.id, def.id]);
    passer.place(0, 0, 0);
    runner.place(dir * 8, 6, 0);
    w.ball.reset(passer.pos.x + dir * 0.5, 0);
    // Target 10 m ahead of the runner; the defender stands 2 m from that spot.
    const tx = dir * 18,
      tz = 6;
    def.place(tx + dir * 1, tz + 1.5, 0);
    const covered = evaluatePass(w, passer, runner, tx, tz, 0.25);
    def.place(dir * 25, -15, 0);
    const open = evaluatePass(w, passer, runner, tx, tz, 0.25);
    expect(covered.success).toBeLessThan(0.65);
    expect(open.success).toBeGreaterThan(0.85);
    expect(open.success - covered.success).toBeGreaterThan(0.25);
  });

  it('a pass to a team-mate with a marker at their shoulder is riskier than to a free one', () => {
    const { m, w, mine, theirs, dir } = setup();
    const [passer, mate] = mine;
    const [def] = theirs;
    clearPitch(m, [passer.id, mate.id, def.id]);
    passer.place(0, 0, 0);
    mate.place(dir * 12, 0, 0);
    w.ball.reset(passer.pos.x + dir * 0.5, 0);
    def.place(dir * 13, 0.8, 0);
    const marked = evaluatePass(w, passer, mate, mate.pos.x, mate.pos.z, 0.25).success;
    def.place(dir * 24, 15, 0);
    const free = evaluatePass(w, passer, mate, mate.pos.x, mate.pos.z, 0.25).success;
    expect(marked).toBeLessThan(free);
    expect(free).toBeGreaterThan(0.85);
  });
});

describe('AI clearances (scenarios)', () => {
  it('never clears towards its own goal, and avoids the opponent standing in front', () => {
    const { m, w, mine, theirs, dir } = setup();
    const [carrier] = mine;
    clearPitch(m, [carrier.id, ...theirs.map((t) => t.id)]);
    const fromX = -dir * 22,
      fromZ = 0;
    carrier.place(fromX, fromZ, 0);
    // Opponents camped straight up the middle.
    theirs.forEach((t, i) => t.place(fromX + dir * (20 + i * 4), (i - 1.5) * 2, 0));
    const c = chooseClearance(w, 0, fromX, fromZ);
    expect((c.x - fromX) * dir).toBeGreaterThan(0);
    expect(Math.abs(c.z)).toBeGreaterThan(8); // goes wide, not into the crowd in the middle
  });

  it('every sampled clearance from anywhere in our half goes forwards', () => {
    const { w, dir } = setup();
    for (let x = -30; x <= 0; x += 6) {
      for (let z = -18; z <= 18; z += 6) {
        const fromX = dir * x;
        const c = chooseClearance(w, 0, fromX, z);
        expect((c.x - fromX) * dir).toBeGreaterThan(0);
      }
    }
  });
});

describe('AI decision audit (simulation regression)', () => {
  // Real AI-vs-AI matches on fixed seeds. Thresholds are set with margin over the measured results
  // (docs/gameplay/ai-and-difficulty.md); before these fixes the same audit measured 3.6 misread passes and 2.6 hopeless
  // shots per 100 kicks on Medium.
  const r = runAudit({ seeds: [201, 202, 203], format: '5v5', difficulty: 'medium', seconds: 150 });
  it('has enough events to judge', () => {
    expect(r.kicks).toBeGreaterThan(80);
  });
  it('no clearances towards our own goal, no hopeless long shots', () => {
    expect(r.flags.clearBackwards).toBe(0);
    expect(r.per100.longShot).toBeLessThan(1);
  });
  it('passes the AI rated safe are rarely intercepted', () => {
    expect(r.per100.passMisread).toBeLessThan(2.5);
  });
  it('pass success estimates are not wildly over-confident', () => {
    const [n, completed] = r.calibration['0.85-0.95'];
    if (n >= 10) expect(completed).toBeGreaterThan(0.85);
  });
});

describe('11v11 attacking (regressions for "too few chances")', () => {
  it('only the most dangerous defenders decide a pass: ten far-off defenders don’t pile up into a "hopeless" rating', () => {
    // The lane check used to multiply every defender's interception risk, so many defenders a few metres
    // off the line made any pass look hopeless and the 11v11 AI stopped passing in the attacking third.
    const m = makeMatch({ format: '11v11', seed: 4, aiOnly: true });
    const w = m.world;
    const dir = w.attackDir(0);
    const mine = w.players.filter((p) => p.team === 0 && !p.isGK);
    const theirs = w.players.filter((p) => p.team === 1 && !p.isGK);
    const [passer, receiver] = mine;
    clearPitch(m, [passer.id, receiver.id, ...theirs.map((t) => t.id)]);
    passer.place(0, 0, 0);
    receiver.place(dir * 16, 0, 0);
    w.ball.reset(passer.footX(0.5), passer.footZ(0.5));
    // Ten defenders 8–9 m either side of the lane, each a moderate risk. Measured: the old rule (every
    // risk multiplied) rated this pass 4.5%; counting only the two most dangerous rates it about 11%.
    theirs.forEach((t, i) => t.place(dir * (2 + i * 1.4), (i % 2 ? 1 : -1) * (8 + (i % 3) * 0.5), 0));
    const success = evaluatePass(w, passer, receiver, receiver.pos.x, receiver.pos.z, 0.2).success;
    expect(success).toBeGreaterThan(0.08);
  });

  it('with a team-mate on the ball near the box, attackers take distinct, onside spots in the penalty area', () => {
    const m = makeMatch({ format: '11v11', seed: 5, aiOnly: true });
    const w = m.world;
    const dir = w.attackDir(0);
    const L2 = w.pitch.length / 2;
    const brain = m.brains[0] as unknown as { boxTarget(p: unknown, c: unknown, w: unknown): { x: number; z: number } | null };
    const carrier = w.players.find((p) => p.team === 0 && p.role === 'MID')!;
    carrier.place(dir * (L2 - 22), 18, 0);
    // A deep defence, all inside the penalty area (the deepest defender 6 m from goal).
    for (const o of w.players) if (o.team === 1 && !o.isGK) o.place(dir * (L2 - 6 - (o.index % 4)), (o.index - 5) * 3, 0);
    const spots = w.players
      .filter((p) => p.team === 0 && !p.isGK && p.id !== carrier.id && p.role !== 'DEF')
      .map((p) => {
        const t = brain.boxTarget(p, carrier, w); // a shared scratch object: copy it straight away
        return t ? { ...t } : null;
      })
      .filter((t): t is { x: number; z: number } => t !== null);
    expect(spots.length).toBe(4); // near post, spot, far post, edge of the box
    const key = (t: { x: number; z: number }) => `${t.x.toFixed(1)},${t.z.toFixed(1)}`;
    expect(new Set(spots.map(key)).size).toBe(4);
    // Near post, spot and far post are inside the penalty area; the cut-back spot is at its edge.
    expect(spots.filter((t) => w.inPenaltyArea(t.x, t.z, 1)).length).toBe(3);
    // Never beyond the offside line: the deepest outfield defender (the keeper is the last opponent).
    for (const t of spots) expect(t.x * dir).toBeLessThanOrEqual(L2 - 6);
    // Too far from goal: no box runs yet (support stays with the carrier).
    carrier.place(dir * 5, 0, 0);
    expect(
      brain.boxTarget(
        w.players.find((p) => p.team === 0 && p.role === 'FWD')!,
        carrier,
        w,
      ),
    ).toBeNull();
  });
});
