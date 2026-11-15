/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { appendFileSync, mkdirSync } from 'fs';
import { Match, MatchOptions } from '../src/sim/match';
import { SIM_DT } from '../src/sim/config';
import { InputFrame, consumeEdges } from '../src/sim/human';

export function makeMatch(opts: Partial<MatchOptions> = {}): Match {
  return new Match({
    mode: 'match',
    format: '3v3',
    difficulty: 'medium',
    duration: 120,
    seed: 42,
    replays: false,
    ...opts,
  });
}

/** Advance a match by `seconds` with optional per-step input. */
export function runFor(m: Match, seconds: number, input: InputFrame | null = null, until?: () => boolean): void {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    m.step(SIM_DT, input);
    if (input) consumeEdges(input);
    if (m.phase === 'replay') m.endReplay();
    if (until && until()) return;
  }
}

/** Place every non-relevant player far away so a scenario is clean. */
export function clearPitch(m: Match, keep: number[]): void {
  const w = m.world;
  for (const p of w.players) {
    if (keep.includes(p.id)) continue;
    p.place(p.team === 0 ? -w.pitch.length / 2 + 2 : w.pitch.length / 2 - 2, (p.id % 2 ? 1 : -1) * (w.pitch.width / 2 - 1), 0);
  }
}

/** Append a line to test-results/summary.log (vitest hides console output of passing tests). */
export function summary(...parts: unknown[]): void {
  const line = parts.map(String).join(' ');
  try {
    mkdirSync('test-results', { recursive: true });
    appendFileSync('test-results/summary.log', line + '\n');
  } catch {
    /* ignore */
  }
}
