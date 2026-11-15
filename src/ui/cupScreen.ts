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
 * The XI Nations Cup screens as HTML strings: starting a cup, the hub (next match, group tables, the
 * player's results, the bracket) and the finished cup with its trophy. Pure functions of the cup record,
 * so they can be tested without a browser; `UI.showCup` mounts them and handles the buttons.
 *
 * Accessibility: every table has a caption and header cells, results are written in words as well as
 * numbers ("won 2–1"), the player's team is marked with text (not only colour), and every action is a
 * real button. The trophy is decorative (`aria-hidden`); its meaning is in the heading.
 */

import { BRAND } from '../brand';
import { nationByCode } from '../sim/nations';
import {
  KNOCKOUTS,
  STAGE_NAMES,
  champion,
  currentStage,
  groupLetter,
  nextPlayerFixture,
  playerFinish,
  type CupFormat,
  type Fixture,
  type Tournament,
} from '../game/tournament/cup';
import { TIEBREAKERS, groupTable } from '../game/tournament/standings';
import type { CupRecord } from '../game/tournament/record';
import type { Settings } from '../game/settings';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const name = (code: string) => esc(nationByCode(code)?.name ?? code);
const flag = (code: string) => {
  const n = nationByCode(code);
  return n ? `<img class="cup-flag" src="${BASE}${n.flag}" alt="" aria-hidden="true" width="20" height="15">` : '';
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Base URL for game files (relative, so the game works from any folder). */
const BASE = import.meta.env?.BASE_URL ?? './';

/** Format choices, with their shape in words. */
export const CUP_FORMATS: Array<{ id: CupFormat; label: string; detail: string }> = [
  { id: 'short16', label: 'Short', detail: '16 teams · 4 groups · quarter-finals · up to 6 matches' },
  { id: 'classic32', label: 'Classic', detail: '32 teams · 8 groups · round of 16 · up to 7 matches' },
];

/** "Group B · Matchday 2" or "Semi-final". */
export function fixtureLabel(f: Fixture): string {
  return f.stage === 'group' ? `Group ${groupLetter(f.group ?? 0)} · Matchday ${f.round}` : STAGE_NAMES[f.stage];
}

/** A result from the player's point of view, in words: "Won 2–1", "Drew 1–1, won 4–3 on penalties". */
export function resultInWords(f: Fixture, team: string): string {
  const r = f.result;
  if (!r) return 'Not played yet';
  const mine = f.home === team;
  const [a, b] = mine ? [r.home, r.away] : [r.away, r.home];
  const base = a > b ? `Won ${a}–${b}` : a < b ? `Lost ${a}–${b}` : `Drew ${a}–${b}`;
  if (!r.shootout) return base;
  const [pa, pb] = mine ? [r.shootout.home, r.shootout.away] : [r.shootout.away, r.shootout.home];
  return `${base}, ${pa > pb ? 'won' : 'lost'} ${pa}–${pb} on penalties`;
}

function scoreText(f: Fixture): string {
  if (!f.result) return 'v';
  const pens = f.result.shootout ? ` <span class="cup-pens">(${f.result.shootout.home}–${f.result.shootout.away} pens)</span>` : '';
  return `${f.result.home}–${f.result.away}${pens}`;
}

/** Group table: position, team, played, W, D, L, goal difference, points. Top two highlighted (they go through). */
export function groupTableHtml(t: Tournament, g: number): string {
  const rows = groupTable(t, g)
    .map((r, i) => {
      const me = r.team === t.team;
      const gd = r.goalsFor - r.goalsAgainst;
      return `<tr class="${i < 2 ? 'through' : ''}${me ? ' me' : ''}"><td>${i + 1}</td><th scope="row">${flag(r.team)}${name(r.team)}${me ? ' <span class="you">(you)</span>' : ''}</th><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${gd > 0 ? '+' : ''}${gd}</td><td><b>${r.points}</b></td></tr>`;
    })
    .join('');
  return `<table class="cup-table"><caption>Group ${groupLetter(g)}</caption><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col" title="Played">P</th><th scope="col" title="Won">W</th><th scope="col" title="Drawn">D</th><th scope="col" title="Lost">L</th><th scope="col" title="Goal difference">GD</th><th scope="col" title="Points">Pts</th></tr>${rows}</table>`;
}

/** The knockout rounds created so far, round by round. */
function bracketHtml(t: Tournament): string {
  const rounds = KNOCKOUTS[t.format]
    .map((stage) => {
      const fx = t.fixtures.filter((f) => f.stage === stage);
      if (!fx.length) return `<li><h4>${STAGE_NAMES[stage]}</h4><p class="desc">To be decided</p></li>`;
      return `<li><h4>${STAGE_NAMES[stage]}</h4><ul>${fx
        .map(
          (f) =>
            `<li class="${f.home === t.team || f.away === t.team ? 'me' : ''}">${flag(f.home)}${name(f.home)} <b>${scoreText(f)}</b> ${name(f.away)}${flag(f.away)}</li>`,
        )
        .join('')}</ul></li>`;
    })
    .join('');
  return `<ol class="cup-bracket">${rounds}</ol>`;
}

/** Setup: choose the format and your team. Match settings come from Teams & options. */
export function cupSetupHtml(s: Settings, format: CupFormat, record: CupRecord): string {
  const options = CUP_FORMATS.map(
    (f) =>
      `<button class="btn opt${f.id === format ? ' on' : ''}" data-action="cupFormat" data-v="${f.id}" aria-pressed="${f.id === format}"><b>${f.label}</b><small>${f.detail}</small></button>`,
  ).join('');
  const history = record.history.length
    ? `<h3>Past cups</h3><ul class="cup-history">${record.history
        .slice(0, 5)
        .map(
          (h) =>
            `<li>${flag(h.team)}${name(h.team)}: ${h.finish === 'champion' ? '<b>Champions</b>' : `out in the ${STAGE_NAMES[h.finish].toLowerCase()}`} · won by ${name(h.champion)}</li>`,
        )
        .join('')}</ul>`
    : '';
  return `<div class="screen dim cup"><div class="panel">
    <h2>${esc(BRAND.tournamentName)}</h2>
    <p class="desc">A fictional international tournament: group stage, then knockouts. Play your team's matches; the other results are decided as each round is played.</p>
    <h3>Format</h3>
    <div class="cup-formats">${options}</div>
    <h3>Your team</h3>
    <p>${flag(s.homeTeam)}<b>${name(s.homeTeam)}</b> <button class="btn small" data-action="cupTeam">Change team</button></p>
    <p class="desc">Every match: ${esc(s.format)} · ${cap(s.difficulty)} · ${s.minutes} min. Change these in Teams &amp; options before you start; they stay the same for the whole cup.</p>
    ${history}
    <div class="row end" style="margin-top:16px"><button class="btn" data-action="back">Back</button><button class="btn primary" data-action="cupStart">Start the cup</button></div>
  </div></div>`;
}

/** Hub: next match, tables, results so far, bracket. */
export function cupHubHtml(t: Tournament, confirmAbandon = false): string {
  const next = nextPlayerFixture(t);
  const stage = currentStage(t);
  const mine = t.fixtures.filter((f) => f.home === t.team || f.away === t.team);
  const myGroup = t.groups.findIndex((g) => g.includes(t.team));
  const opponent = next ? (next.home === t.team ? next.away : next.home) : null;
  const nextCard = next
    ? `<div class="cup-next"><div class="desc">Next match · ${esc(fixtureLabel(next))}</div><div class="cup-vs">${flag(t.team)}<b>${name(t.team)}</b> <span>v</span> <b>${name(opponent!)}</b>${flag(opponent!)}</div>
       ${next.stage !== 'group' ? '<p class="desc">Level at full time? It goes straight to a penalty shootout. (A game simplification: the Laws of the Game allow extra time first.)</p>' : ''}</div>`
    : '';
  const results = mine.length
    ? `<table class="cup-results"><caption>Your matches</caption><tr><th scope="col">Round</th><th scope="col">Opponent</th><th scope="col">Result</th></tr>${mine
        .map((f) => {
          const opp = f.home === t.team ? f.away : f.home;
          return `<tr><td>${esc(fixtureLabel(f))}</td><td>${flag(opp)}${name(opp)}</td><td>${esc(resultInWords(f, t.team))}</td></tr>`;
        })
        .join('')}</table>`
    : '';
  const otherGroups = t.groups.map((_, g) => (g === myGroup ? '' : groupTableHtml(t, g))).join('');
  const abandon = confirmAbandon
    ? `<div class="notice" role="alertdialog" aria-label="Abandon the cup?">Abandon this cup? Its results will be lost (your match statistics are kept). <button class="btn small" data-action="cupAbandonConfirm">Yes, abandon</button><button class="btn small ghost" data-action="cupAbandonCancel">Keep playing</button></div>`
    : '';
  return `<div class="screen dim cup"><div class="panel wide">
    <h2>${esc(BRAND.tournamentName)} <span class="desc">${stage ? esc(STAGE_NAMES[stage]) : ''} · ${t.format === 'short16' ? 'Short' : 'Classic'}</span></h2>
    ${nextCard}
    ${abandon}
    <div class="row end"><button class="btn" data-action="quit">Main menu</button><button class="btn ghost" data-action="cupAbandon">Abandon cup</button>${next ? '<button class="btn primary" data-action="cupPlay">Play match</button>' : ''}</div>
    <div class="cup-grid">
      <section>${groupTableHtml(t, myGroup)}<p class="desc small">The top two go through. Ties: ${TIEBREAKERS.join(', then ').toLowerCase()}.</p>${results}</section>
      <section><h3>Knockouts</h3>${bracketHtml(t)}</section>
    </div>
    <details class="cup-groups"><summary>All groups</summary><div class="cup-grid">${otherGroups}</div></details>
  </div></div>`;
}

/** A simple original trophy: a silver cup on a dark base with "XI" on it. Decorative. */
export function trophySvg(): string {
  return `<svg class="cup-trophy" viewBox="0 0 120 150" width="120" height="150" aria-hidden="true">
    <defs><linearGradient id="silver" x1="0" x2="1"><stop offset="0" stop-color="#9aa6b8"/><stop offset=".45" stop-color="#f1f5f9"/><stop offset="1" stop-color="#7c8799"/></linearGradient></defs>
    <path d="M30 14h60v20c0 26-13 44-30 46-17-2-30-20-30-46z" fill="url(#silver)"/>
    <path d="M30 22H16c0 18 8 28 18 30M90 22h14c0 18-8 28-18 30" fill="none" stroke="url(#silver)" stroke-width="6" stroke-linecap="round"/>
    <rect x="54" y="80" width="12" height="22" fill="url(#silver)"/>
    <rect x="34" y="102" width="52" height="12" rx="3" fill="url(#silver)"/>
    <rect x="26" y="114" width="68" height="26" rx="4" fill="#0f1b33" stroke="#3b82f6" stroke-width="2"/>
    <text x="60" y="133" text-anchor="middle" font-family="Inter, sans-serif" font-weight="900" font-size="16" fill="#e2e8f0">XI</text>
  </svg>`;
}

/** The finished cup: champion, the player's finish, the trophy if they won it. */
export function cupFinishedHtml(t: Tournament): string {
  const champ = champion(t)!;
  const finish = playerFinish(t);
  const won = finish === 'champion';
  const heading = won ? `${name(t.team)} win the ${esc(BRAND.tournamentName)}!` : `${name(champ)} win the ${esc(BRAND.tournamentName)}`;
  const yours = won
    ? 'Champions!'
    : `Your team, ${name(t.team)}, went out in the ${STAGE_NAMES[(finish ?? 'group') as Exclude<typeof finish, 'champion' | null>].toLowerCase()}.`;
  const final = t.fixtures.find((f) => f.stage === 'F')!;
  return `<div class="screen dim cup"><div class="panel ${won ? 'cup-won' : ''}">
    ${won ? trophySvg() : ''}
    <h2 role="status">${heading}</h2>
    <p>${yours}</p>
    <p class="desc">Final: ${name(final.home)} ${scoreText(final)} ${name(final.away)}</p>
    <h3>Knockouts</h3>${bracketHtml(t)}
    <div class="row end" style="margin-top:16px"><button class="btn" data-action="quit">Main menu</button><button class="btn primary" data-action="cupNew">New cup</button></div>
  </div></div>`;
}
