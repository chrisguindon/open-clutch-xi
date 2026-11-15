/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// XI Nations Cup screens: results in words, accessible tables, and the knockout simplification stated.
import { describe, expect, it } from 'vitest';
import { advance, createTournament, nextPlayerFixture, recordResult, type Fixture } from '../src/game/tournament/cup';
import { cupHubHtml, fixtureLabel, groupTableHtml, resultInWords } from '../src/ui/cupScreen';
import { NATIONS } from '../src/sim/nations';
import { BRAND } from '../src/brand';

const catalogue = NATIONS.map((n) => ({ code: n.short, region: n.region ?? 'Other' }));
const t0 = advance(createTournament({ catalogue, team: 'CAN', format: 'short16', seed: 5, settings: { format: '5v5', difficulty: 'easy', minutes: 4 } }));

describe('cup screens', () => {
  it('describes results in words from the player’s side, including shootouts', () => {
    const f: Fixture = {
      id: 'QF-1',
      stage: 'QF',
      round: 1,
      home: 'BRA',
      away: 'CAN',
      result: { home: 2, away: 2, shootout: { home: 3, away: 4 }, byPlayer: true },
    };
    expect(resultInWords(f, 'CAN')).toBe('Drew 2–2, won 4–3 on penalties');
    expect(resultInWords({ ...f, result: { home: 0, away: 1, byPlayer: true } }, 'CAN')).toBe('Won 1–0');
    expect(resultInWords({ ...f, result: { home: 3, away: 1, byPlayer: true } }, 'CAN')).toBe('Lost 1–3');
    expect(resultInWords({ ...f, result: undefined }, 'CAN')).toBe('Not played yet');
    expect(fixtureLabel(f)).toBe('Quarter-final');
  });

  it('group tables have a caption, header cells and mark the player’s team in words', () => {
    const g = t0.groups.findIndex((x) => x.includes('CAN'));
    const html = groupTableHtml(t0, g);
    expect(html).toMatch(/<caption>Group [A-D]<\/caption>/);
    expect(html).toContain('scope="col"');
    expect(html).toContain('(you)');
  });

  it('the hub names the next opponent and, in knockouts, says level matches go to penalties (a game simplification)', () => {
    let t = t0;
    expect(cupHubHtml(t)).toContain(BRAND.tournamentName);
    expect(cupHubHtml(t)).toContain('Play match');
    for (let f = nextPlayerFixture(t); f && f.stage === 'group'; f = nextPlayerFixture(t))
      t = recordResult(t, f.id, f.home === 'CAN' ? { home: 3, away: 0 } : { home: 0, away: 3 });
    const html = cupHubHtml(t);
    expect(html).toContain('Quarter-final');
    expect(html).toMatch(/penalty shootout/);
    expect(html).toMatch(/game simplification/);
  });
});
