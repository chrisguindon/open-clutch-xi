/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { Match } from '../sim/match';
import { Difficulty, MatchFormat, SIM_DT, TeamId } from '../sim/config';
import { DecisionInfo, TeamBrain } from '../sim/ai/teamBrain';

/**
 * AI decision audit. Plays AI-vs-AI matches on the real simulation, pairs every AI kick with
 * the decision that produced it, follows what happened next, and counts decisions a spectator would
 * call irrational. Deterministic for a given seed list. Used by tests/ai-audit.test.ts and the report.
 */
export type Flag =
  | 'passIntercepted' // a pass / through ball / lob reached an opponent first
  | 'passMisread' // …and the AI had rated it as very likely to succeed (≥ 75%)
  | 'passOut' // a pass went out of play before anyone controlled it
  | 'longShot' // a hopeless shot: beyond 27 m, or rated below 0.07 quality
  | 'clearToOpponent' // a clearance collected by an opponent within 2.5 s
  | 'clearBackwards' // a clearance aimed towards our own goal
  | 'ownGoal'
  | 'backPassIntoDanger'; // a backwards pass in our own third that an opponent collected

/** One AI kick and how it turned out, with the decision's reasons (for spotting bad choices in bulk). */
export interface KickRecord {
  team: TeamId;
  kind: string;
  label: string;
  progress: number;
  pressure: number;
  why?: string;
  /** Pass success estimate / shot quality, when known. */
  estimate: number | null;
  shotDistance: number | null;
  backwards: boolean;
  outcome: 'teammate' | 'opponent' | 'out' | 'goal' | 'pending';
  flags: Flag[];
}

/** Totals and rates from an audit run, compared across difficulties in docs/gameplay/ai-and-difficulty.md. */
export interface AuditReport {
  matches: number;
  minutes: number;
  kicks: number;
  byKind: Record<string, number>;
  flags: Record<Flag, number>;
  /** Flags per 100 AI kicks (comparable across formats and lengths). */
  per100: Record<Flag, number>;
  passCompletion: number;
  goals: number;
  shots: number;
  examples: Partial<Record<Flag, string[]>>;
  /** Pass success estimate vs what happened: bucket → [passes, completed fraction]. */
  calibration: Record<string, [number, number]>;
  /** Passes by the decision that made them → outcomes. */
  passOutcomes: Record<string, { n: number; teammate: number; opponent: number; out: number }>;
}

const FLAGS: Flag[] = ['passIntercepted', 'passMisread', 'passOut', 'longShot', 'clearToOpponent', 'clearBackwards', 'ownGoal', 'backPassIntoDanger'];
const PASSES = new Set(['pass', 'through', 'lob']);

function parseNum(why: string | undefined, key: string): number | null {
  if (!why) return null;
  const m = new RegExp(`${key} (-?[0-9.]+)`).exec(why);
  return m ? Number(m[1]) : null;
}

/**
 * Play AI-vs-AI matches headlessly on the given seeds and classify every kick (misread passes, hopeless
 * shots, clearances to an opponent…). Deterministic for the same seeds. Run it with `npm run report:ai`.
 */
export function runAudit(opts: { seeds: number[]; format: MatchFormat; difficulty: Difficulty; seconds: number }): AuditReport {
  const records: KickRecord[] = [];
  let goals = 0;
  const prevExplain = TeamBrain.explain;
  const prevHook = TeamBrain.decisionInfo;
  TeamBrain.explain = true;
  try {
    for (const seed of opts.seeds) {
      const m = new Match({ mode: 'match', format: opts.format, difficulty: opts.difficulty, duration: opts.seconds, seed, replays: false, aiOnly: true });
      const w = m.world;
      const pendingDecision = new Map<number, DecisionInfo>();
      let open: { rec: KickRecord; t: number } | null = null;
      const close = (outcome: KickRecord['outcome'], controllerTeam?: TeamId) => {
        if (!open) return;
        const r = open.rec,
          dt = w.time - open.t;
        r.outcome = outcome;
        if (PASSES.has(r.kind)) {
          if (outcome === 'opponent') {
            r.flags.push('passIntercepted');
            if ((r.estimate ?? 0) >= 0.75) r.flags.push('passMisread');
            if (r.backwards && r.progress < -0.33) r.flags.push('backPassIntoDanger');
          }
          if (outcome === 'out') r.flags.push('passOut');
        }
        if (r.kind === 'clear' && outcome === 'opponent' && dt < 2.5 && controllerTeam !== undefined) r.flags.push('clearToOpponent');
        open = null;
      };
      TeamBrain.decisionInfo = (d) => {
        if (d.kick) pendingDecision.set(d.playerId, d);
      };
      m.events.on('kick', (e) => {
        close('pending');
        const p = w.players[e.playerId];
        const pd = pendingDecision.get(e.playerId);
        pendingDecision.delete(e.playerId);
        // Only the decision that produced this kick (same kind, just made) — not a stale one.
        const d = pd && pd.kick?.kind === e.kind && w.time - pd.time < 1.2 ? pd : undefined;
        const dirSign = w.attackDir(p.team);
        const dirX = d?.kick?.dir.x ?? 0;
        const rec: KickRecord = {
          team: p.team,
          kind: e.kind,
          label: d?.label ?? (p.isGK ? 'keeper' : 'restart/reflex'),
          progress: d?.progress ?? (w.ball.pos.x * dirSign) / (w.pitch.length / 2),
          pressure: d?.pressure ?? 99,
          why: d?.why,
          estimate: parseNum(d?.why, 'success') ?? parseNum(d?.why, 'quality'),
          shotDistance: e.kind === 'shot' ? Math.hypot((dirSign * w.pitch.length) / 2 - w.ball.pos.x, w.ball.pos.z) : null,
          backwards: dirX * dirSign < -0.2 * Math.hypot(dirX, d?.kick?.dir.z ?? 0),
          outcome: 'pending',
          flags: [],
        };
        if (e.kind === 'shot' && d && ((rec.shotDistance ?? 0) > 27 || (rec.estimate ?? 1) < 0.07)) rec.flags.push('longShot');
        if (e.kind === 'clear' && d && rec.backwards) rec.flags.push('clearBackwards');
        records.push(rec);
        open = { rec, t: w.time };
      });
      m.events.on('control', (e) => {
        if (!open) return;
        const p = w.players[e.playerId];
        if (p.id === w.lastKick?.playerId && w.time - open.t < 0.3) return; // the kicker's own follow-through
        close(p.team === open.rec.team ? 'teammate' : 'opponent', p.team);
      });
      m.events.on('phase', (e) => {
        if (e.phase === 'stoppage' || e.phase === 'restart') close('out');
      });
      m.events.on('goal', (e) => {
        goals++;
        if (open && e.ownGoal) open.rec.flags.push('ownGoal');
        close('goal');
      });
      const steps = Math.round(opts.seconds / SIM_DT) + 600;
      for (let i = 0; i < steps && m.phase !== 'fullTime'; i++) {
        m.step(SIM_DT, null);
        if (m.phase === 'replay') m.endReplay();
      }
      close('pending');
    }
  } finally {
    TeamBrain.explain = prevExplain;
    TeamBrain.decisionInfo = prevHook;
  }
  const flags = Object.fromEntries(FLAGS.map((f) => [f, 0])) as Record<Flag, number>;
  const examples: AuditReport['examples'] = {};
  const byKind: Record<string, number> = {};
  for (const r of records) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    for (const f of r.flags) {
      flags[f]++;
      const ex = (examples[f] ??= []);
      if (ex.length < 4) ex.push(`${r.label} @${r.progress.toFixed(2)} pressure ${r.pressure.toFixed(1)}m ${r.why ?? ''}`);
    }
  }
  const passes = records.filter((r) => PASSES.has(r.kind) && r.outcome !== 'pending' && r.outcome !== 'goal');
  const completed = passes.filter((r) => r.outcome === 'teammate').length;
  const n = Math.max(1, records.length);
  const passOutcomes: AuditReport['passOutcomes'] = {};
  for (const r of passes) {
    const k = `${r.label}/${r.kind}`;
    const o = (passOutcomes[k] ??= { n: 0, teammate: 0, opponent: 0, out: 0 });
    o.n++;
    if (r.outcome === 'teammate' || r.outcome === 'opponent' || r.outcome === 'out') o[r.outcome]++;
  }
  const calibration: Record<string, [number, number]> = {};
  for (const [lo, hi] of [
    [0, 0.5],
    [0.5, 0.7],
    [0.7, 0.85],
    [0.85, 0.95],
    [0.95, 1.01],
  ]) {
    const b = passes.filter((r) => r.estimate !== null && r.estimate >= lo && r.estimate < hi);
    calibration[`${lo}-${Math.min(1, hi)}`] = [b.length, b.length ? +(b.filter((r) => r.outcome === 'teammate').length / b.length).toFixed(2) : 0];
  }
  return {
    matches: opts.seeds.length,
    minutes: (opts.seeds.length * opts.seconds) / 60,
    kicks: records.length,
    byKind,
    flags,
    per100: Object.fromEntries(FLAGS.map((f) => [f, +((flags[f] / n) * 100).toFixed(2)])) as Record<Flag, number>,
    passCompletion: passes.length ? +(completed / passes.length).toFixed(3) : 0,
    goals,
    shots: byKind.shot ?? 0,
    examples,
    calibration,
    passOutcomes,
  };
}
