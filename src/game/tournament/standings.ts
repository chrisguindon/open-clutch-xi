/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/**
 * Group tables for the XI Nations Cup. Teams are ranked by, in order:
 * 1. points (3 for a win, 1 for a draw);
 * 2. goal difference;
 * 3. goals scored;
 * 4. head-to-head points in the matches between the teams still level;
 * 5. a drawing of lots, made deterministic by the tournament's seed (the same cup always ranks the
 *    same way, and nobody can reload to change it).
 * Real competitions use similar criteria; the exact order here is the game's own (documented in
 * docs/gameplay/tournament.md and shown on the standings screen).
 */

import { hashSeed, type Tournament } from './cup';

export interface TableRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/** The criteria, in words, for the standings screen. */
export const TIEBREAKERS = ['Points', 'Goal difference', 'Goals scored', 'Points in matches between the tied teams', 'Drawing of lots'] as const;

function rows(t: Tournament, g: number, among?: ReadonlySet<string>): Map<string, TableRow> {
  const out = new Map<string, TableRow>();
  for (const team of t.groups[g])
    if (!among || among.has(team)) out.set(team, { team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });
  for (const f of t.fixtures) {
    if (f.stage !== 'group' || f.group !== g || !f.result) continue;
    const h = out.get(f.home),
      a = out.get(f.away);
    if (!h || !a) continue; // head-to-head: only matches between the tied teams count
    const { home, away } = f.result;
    h.played++;
    a.played++;
    h.goalsFor += home;
    h.goalsAgainst += away;
    a.goalsFor += away;
    a.goalsAgainst += home;
    const [winner, loser] = home > away ? [h, a] : away > home ? [a, h] : [null, null];
    if (winner && loser) {
      winner.won++;
      winner.points += 3;
      loser.lost++;
    } else {
      h.drawn++;
      a.drawn++;
      h.points++;
      a.points++;
    }
  }
  return out;
}

/** The ranked table of group `g` (index 0 = group A), from the results so far. */
export function groupTable(t: Tournament, g: number): TableRow[] {
  const table = [...rows(t, g).values()];
  const main = (x: TableRow, y: TableRow) => y.points - x.points || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor;
  table.sort(main);
  // Resolve each run of teams level on the first three criteria with head-to-head points, then lots.
  const out: TableRow[] = [];
  for (let i = 0; i < table.length;) {
    let j = i + 1;
    while (j < table.length && main(table[i], table[j]) === 0) j++;
    const tied = table.slice(i, j);
    if (tied.length > 1) {
      const h2h = rows(t, g, new Set(tied.map((r) => r.team)));
      const lots = (team: string) => hashSeed(t.seed, `lots-${g}-${team}`);
      tied.sort((x, y) => h2h.get(y.team)!.points - h2h.get(x.team)!.points || lots(x.team) - lots(y.team));
    }
    out.push(...tied);
    i = j;
  }
  return out;
}
