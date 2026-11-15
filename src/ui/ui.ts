/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { BRAND } from '../brand';
import { SQUAD_LABELS, SquadMix } from '../render/characters/squad';
import { ACHIEVEMENTS } from '../game/achievements';
import type { PlayerProgress } from '../game/progress';
import type { CupRecord } from '../game/tournament/record';
import type { SiteConfig } from '../game/siteConfig';
import { champion, nextPlayerFixture, type CupFormat } from '../game/tournament/cup';
import { cupFinishedHtml, cupHubHtml, cupSetupHtml, fixtureLabel } from './cupScreen';
import { MAX_IMPORT_BYTES, applySaveFile, exportSaveData, readSaveFile, resetAllData, resetProgress, type SaveFile } from '../game/saveData';
import { download, stamp } from '../game/diagnostics';
import { TeamIdentity } from '../sim/teams';
import { NATIONS, REGIONS, nationByCode } from '../sim/nations';
import { resolveKits } from '../render/matchView';
import { Difficulty, GameMode, MatchFormat } from '../sim/config';
import { Match, TeamStats } from '../sim/match';
import {
  KEY_ACTION_HELP,
  KEY_ACTION_LABELS,
  KeyAction,
  Settings,
  bindingConflicts,
  keyLabel,
  loadKeyboardLayout,
  DEFAULT_BINDINGS,
  DEFAULT_KBM_BINDINGS,
  DEFAULT_PAD_BINDINGS,
  PAD_ACTION_LABELS,
  PAD_BUTTON_LABELS,
  PAD_BUTTON_LABELS_PS,
  PadAction,
  activeBindings,
  ControlScheme,
} from '../game/settings';

/**
 * What the UI may ask of the game (implemented by `Game`). Keeping the UI behind this small interface
 * means menus never reach into the simulation or renderer directly.
 */
export interface UIHost {
  settings: Settings;
  startMatch(mode: GameMode): void;
  startTutorial(): void;
  tutorialAction(a: 'retry' | 'skip' | 'restart' | 'exit'): void;
  resume(): void;
  restart(): void;
  quitToMenu(): void;
  applySettings(changed: keyof Settings | 'all'): void;
  captureKey(cb: (code: string) => void, mouse?: boolean): void;
  capturePadButton(cb: (button: number) => void): void;
  cancelCapture(): void;
  click(): void;
  gamepadName(): string | null;
  /** Current adaptive graphics state, for the settings screen. */
  graphicsStatus?(): string;
  /** The player's local record, for the Records screen. */
  readonly progress: PlayerProgress;
  /** Saved data was imported or reset: reload so every part of the game starts from it. */
  reloadSavedData(): void;
  /** Presentation extras from the hosting site (creator portrait), if it provides any. */
  readonly siteConfig: SiteConfig;
  /** The XI Nations Cup record (the cup in progress and past cups). */
  readonly cup: CupRecord;
  /** Start a new cup with the player's chosen team and match settings. */
  startCup(format: CupFormat): void;
  /** Play the player's next cup match. */
  playCupMatch(): void;
  /** Abandon the cup in progress (or clear a finished one). */
  abandonCup(): void;
}

/** Everything the in-match HUD shows, gathered by the game once per frame. */
export interface HudData {
  teams: [TeamIdentity, TeamIdentity];
  colors: [string, string];
  score: [number, number];
  clock: string;
  player: { name: string; role: string; stamina: number } | null;
  power: { label: string; value: number } | null;
  hint: string | null;
  fps: number | null;
  pens: Array<{ team: 0 | 1; scored: boolean }> | null;
  replay: boolean;
}

/** Positions for the minimap, in pitch metres. */
export interface MinimapData {
  length: number;
  width: number;
  players: Array<{ x: number; z: number; team: 0 | 1; human: boolean; gk: boolean }>;
  ball: { x: number; z: number };
  colors: [string, string];
}

type Screen =
  'loading' | 'menu' | 'setup' | 'settings' | 'howto' | 'about' | 'chooser' | 'pause' | 'fulltime' | 'tutorialOffer' | 'records' | 'cup' | 'error' | 'none';

const el = <T extends HTMLElement = HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

const DIFF_DESC: Record<Difficulty, string> = {
  beginner: 'New to football games? Relaxed opponents and lots of space to learn.',
  easy: 'Forgiving opponents who give you time on the ball.',
  medium: 'Balanced, competitive football.',
  hard: 'Smart pressing, tight marking and clinical finishing.',
};
const FORMAT_DESC: Record<MatchFormat, string> = {
  '3v3': 'Fast arcade action on a compact pitch. Goals galore. Arcade rules: no offside or cards.',
  '5v5': 'The sweet spot: tactics, space and pace. Arcade rules: no offside or cards.',
  '11v11': 'Full-size pitch, full teams, Standard rules: offside, cards and assistant referees.',
};

/** DOM-based user interface. Kept framework-free: the UI is small and this keeps the bundle lean. */
export class UI {
  readonly root: HTMLElement;
  private screens = new Map<Screen, HTMLElement>();
  private current: Screen = 'none';
  private previous: Screen = 'menu';
  private hudEl: HTMLElement;
  private bannerEl: HTMLElement;
  /** Screen-reader announcements of match events and referee decisions (visually hidden). */
  private liveEl: HTMLElement;
  private bannerTimer = 0;
  private tutorialEl: HTMLElement;
  private playerLabelEl: HTMLElement;
  private playerLabelText = '';
  private toastEl: HTMLElement | null = null;
  private minimapCanvas: HTMLCanvasElement;
  private settingsTab: 'game' | 'graphics' | 'audio' | 'controls' | 'data' = 'game';
  /** Saved-data tab: a pending destructive action awaiting confirmation, a checked import, and a message. */
  private dataConfirm: 'progress' | 'all' | null = null;
  private pendingImport: { file: SaveFile; summary: string } | null = null;
  private dataMessage: { text: string; error: boolean } | null = null;
  private lastScore = '';
  private hudRefs: Record<string, HTMLElement> = {};
  private pauseFrom: 'match' | null = null;

  constructor(
    container: HTMLElement,
    private host: UIHost,
  ) {
    this.root = container;
    this.hudEl = el(`<div class="hud" hidden>
      <div class="scoreboard">
        <div class="team"><span class="swatch" data-r="sw0"></span><img class="sb-flag" data-r="f0" alt="" hidden><span data-r="t0">HOM</span></div>
        <div class="score" data-r="score">0 <span style="opacity:.4">-</span> 0</div>
        <div class="team"><span data-r="t1">AWY</span><img class="sb-flag" data-r="f1" alt="" hidden><span class="swatch" data-r="sw1"></span></div>
        <div class="clock" data-r="clock">00'</div>
      </div>
      <div class="pens" data-r="pens" hidden></div>
      <div class="player-card" data-r="card"><div class="prole" data-r="prole"></div><div class="pname" data-r="pname"></div><div class="stamina"><div data-r="stam"></div></div></div>
      <div class="power" data-r="power" hidden><div class="label" data-r="plabel">Power</div><div class="bar"><div data-r="pbar"></div></div></div>
      <div class="minimap" data-r="mini"><canvas width="200" height="128"></canvas></div>
      <div class="hud-hint" data-r="hint" hidden></div>
      <div class="letterbox" data-r="letterbox"><i></i><i></i></div>
      <div class="replay-tag" data-r="replay" hidden>REPLAY</div>
      <div class="replay-skip" data-r="skip" hidden>Press any action to skip</div>
      <div class="fps" data-r="fps" hidden></div>
    </div>`);
    this.hudEl.querySelectorAll<HTMLElement>('[data-r]').forEach((n) => {
      this.hudRefs[n.dataset.r!] = n;
    });
    this.minimapCanvas = this.hudEl.querySelector('canvas')!;
    this.bannerEl = el('<div class="banner" hidden></div>');
    this.liveEl = el('<div class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>');
    document.body.append(this.liveEl);
    // role="status": instructions and recovery notes ("The ball is over there…") are read out as they change.
    this.tutorialEl = el('<div class="tutorial" role="status" aria-live="polite" hidden></div>');
    this.root.append(this.hudEl, this.bannerEl, this.tutorialEl);
    // The controlled player's name, floating above them. Decorative for screen readers: the HUD already
    // names the controlled player in text.
    this.playerLabelEl = el('<div class="player-label" aria-hidden="true" hidden></div>');
    this.root.append(this.playerLabelEl);
    // The tutorial card isn't a mounted screen, so it needs its own click handling: without this its
    // Retry / Skip / Restart / Exit buttons did nothing (only the pause-menu copies worked), which left
    // players with no visible way out of a lesson they couldn't finish.
    this.tutorialEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (b) {
        this.host.click();
        this.handleAction(b.dataset.action!, b);
      }
    });
    this.buildLoading();
    loadKeyboardLayout(() => {
      if (this.current === 'settings') this.showSettings();
    });
  }

  // ---------------------------------------------------------------------------
  // Screen management
  // ---------------------------------------------------------------------------

  private setScreen(s: Screen): void {
    if (this.current !== s && this.current !== 'none') this.previous = this.current;
    this.current = s;
    for (const [k, node] of this.screens) node.hidden = k !== s;
    if (s !== 'none') {
      const node = this.screens.get(s);
      const first = node?.querySelector<HTMLElement>('button.primary, button');
      first?.focus({ preventScroll: true });
    }
  }

  get screen(): Screen {
    return this.current;
  }

  private mount(s: Screen, node: HTMLElement): void {
    this.screens.get(s)?.remove();
    this.screens.set(s, node);
    node.hidden = this.current !== s;
    this.root.appendChild(node);
    node.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (b) {
        this.host.click();
        this.handleAction(b.dataset.action!, b);
      }
    });
  }

  private buildLoading(): void {
    this.mount(
      'loading',
      el(`<div class="screen loading">
      ${logoHtml(false)}
      <div class="progress"><div data-r="bar"></div></div>
      <div class="status" data-r="status">Warming up…</div>
    </div>`),
    );
    this.setScreen('loading');
  }

  setLoading(progress: number, status: string): void {
    const n = this.screens.get('loading')!;
    (n.querySelector('[data-r=bar]') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    (n.querySelector('[data-r=status]') as HTMLElement).textContent = status;
  }

  showError(message: string): void {
    this.mount(
      'error',
      el(`<div class="screen dim"><div class="panel error-box">
      <h2>Can't start the game</h2><p>${escapeHtml(message)}</p>
      <p style="color:var(--muted)">${escapeHtml(BRAND.name)} needs a browser with WebGL2 (recent Chrome, Edge, Firefox or Safari) and hardware acceleration enabled.</p>
    </div></div>`),
    );
    this.setScreen('error');
  }

  showMenu(): void {
    const s = this.host.settings;
    if (!s.controlsChosen) {
      this.showChooser(false);
      return;
    }
    const pad = this.host.gamepadName();
    const home = teamOf(s.homeTeam),
      away = teamOf(s.awayTeam);
    const offer = s.offerNewControls
      ? `<div class="notice">New, simpler keyboard controls: <b>Space</b> pass · <b>J</b> shoot · <b>K</b> through · <b>L</b> lob.
      <button class="btn small" data-action="newControls">Use new controls</button><button class="btn small ghost" data-action="keepControls">Keep mine</button></div>`
      : '';
    this.mount(
      'menu',
      el(`<div class="screen menu">
      ${logoHtml(true)}
      ${offer}
      <div class="match-card">
        <button class="team-pick" data-action="setup" data-side="home" title="Choose your team">${flagImg(home)}<span class="tname">${escapeHtml(home.name)}</span><span class="tside">You</span></button>
        <div class="vs">VS</div>
        <button class="team-pick" data-action="setup" data-side="away" title="Choose the opponent">${flagImg(away)}<span class="tname">${escapeHtml(away.name)}</span><span class="tside">Computer</span></button>
      </div>
      <nav class="menu-nav">
        <button class="btn primary big" data-action="play">Kick Off<small>${s.format} · ${cap(s.difficulty)} · ${s.minutes} min</small></button>
        ${this.cupMenuButton()}
        <div class="menu-row">
          <button class="btn" data-action="setup">Teams &amp; options</button>
          <button class="btn" data-action="penalties">Penalty shootout</button>
        </div>
        <div class="menu-row">
          <button class="btn" data-action="practice">Practice</button>
          <button class="btn" data-action="tutorial">Tutorial</button>
          <button class="btn" data-action="records">Records</button>
        </div>
        <div class="menu-row">
          <button class="btn" data-action="howto">How to play</button>
          <button class="btn" data-action="settings">Settings</button>
          <button class="btn" data-action="about">About</button>
        </div>
      </nav>
      <div class="footer"><span class="pill">${pad ? 'Controller: ' + escapeHtml(pad.slice(0, 40)) : 'Keyboard · controller · touch'}</span><span class="spacer"></span>
        <span class="byline">${escapeHtml(BRAND.name)} — by <a href="${BRAND.maintainerUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(BRAND.maintainer)}</a>${sourceLink(' · ')}</span></div>
    </div>`),
    );
    this.hide();
    this.setScreen('menu');
  }

  private teamSide: 'home' | 'away' = 'home';
  private teamRegion = 'All';
  private teamQuery = '';

  /** Team selection: large flags, search, regional filter, kit previews (with automatic away kits). */
  private showSetup(side?: 'home' | 'away'): void {
    if (side) this.teamSide = side;
    const s = this.host.settings;
    const home = teamOf(s.homeTeam),
      away = teamOf(s.awayTeam);
    const [hk, ak] = resolveKits(home, away);
    const seg = (key: string, values: Array<[string, string]>, cur: string) =>
      `<div class="seg">${values.map(([v, l]) => `<button class="btn ${v === cur ? 'on' : ''}" data-action="opt" data-key="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const sideCard = (t: TeamIdentity, k: ReturnType<typeof resolveKits>[0], sd: 'home' | 'away', label: string) => `
      <button class="side-card ${this.teamSide === sd ? 'active' : ''}" data-action="teamSide" data-side="${sd}">
        ${flagImg(t, 'big')}<div class="side-info"><span class="tside">${label}</span><span class="tname">${escapeHtml(t.name)}</span><span class="tcode">${t.short}${sd === 'away' && k.shirt !== t.primary ? ' · away kit' : ''}</span></div>${kitSvg(k)}
      </button>`;
    this.mount(
      'setup',
      el(`<div class="screen dim setup"><div class="panel team-select">
      <div class="ts-head"><h2>Choose teams</h2><div class="ts-sides">
        ${sideCard(home, hk, 'home', 'You')}<div class="vs">VS</div>${sideCard(away, ak, 'away', 'Computer')}
      </div></div>
      <div class="ts-tools">
        <span class="ts-picking">Picking: <b>${this.teamSide === 'home' ? 'your team' : 'the opponent'}</b></span>
        <input class="ts-search interactive" type="search" placeholder="Search countries…" value="${escapeHtml(this.teamQuery)}" aria-label="Search countries">
        <div class="seg ts-regions">${['All', ...REGIONS].map((r) => `<button class="btn ${r === this.teamRegion ? 'on' : ''}" data-action="region" data-v="${r}">${r === 'North & Central America' ? 'N & C America' : r}</button>`).join('')}</div>
        <button class="btn" data-action="randomTeam" title="Random team">Random</button>
      </div>
      <div class="ts-grid" role="listbox" aria-label="National teams">${this.teamGrid()}</div>
      <div class="ts-options">
        <div class="option-row"><label>Difficulty</label><div>${seg(
          'difficulty',
          [
            ['beginner', 'Beginner'],
            ['easy', 'Easy'],
            ['medium', 'Medium'],
            ['hard', 'Hard'],
          ],
          s.difficulty,
        )}<div class="desc">${DIFF_DESC[s.difficulty]}</div></div></div>
        <div class="option-row"><label>Players</label><div>${seg(
          'format',
          [
            ['3v3', '3 v 3'],
            ['5v5', '5 v 5'],
            ['11v11', '11 v 11'],
          ],
          s.format,
        )}<div class="desc">${FORMAT_DESC[s.format]}</div></div></div>
        <div class="option-row"><label>Teams</label><div>${seg(
          'squad',
          (Object.keys(SQUAD_LABELS) as SquadMix[]).map((k) => [k, SQUAD_LABELS[k]]),
          s.squad,
        )}<div class="desc">Women, men, or both in every team. Everyone has the same abilities: how a player looks never changes how they play.</div></div></div>
        <div class="option-row"><label>Length</label><div>${seg(
          'minutes',
          [
            ['2', '2 min'],
            ['4', '4 min'],
            ['6', '6 min'],
            ['8', '8 min'],
          ],
          String(s.minutes),
        )}</div></div>
        <div class="option-row"><label>Kick-off</label><div>${seg(
          'timeOfDay',
          [
            ['night', 'Night'],
            ['dusk', 'Dusk'],
            ['day', 'Day'],
          ],
          s.timeOfDay,
        )}</div></div>
      </div>
      <div class="row end" style="margin-top:14px"><button class="btn" data-action="back">Back</button><button class="btn" data-action="penalties">Penalties</button><button class="btn primary" data-action="play">Kick Off</button></div>
    </div></div>`),
    );
    const input = this.screens.get('setup')!.querySelector<HTMLInputElement>('.ts-search')!;
    input.addEventListener('input', () => {
      this.teamQuery = input.value;
      this.screens.get('setup')!.querySelector('.ts-grid')!.innerHTML = this.teamGrid();
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    this.setScreen('setup');
  }

  private teamGrid(): string {
    const s = this.host.settings;
    const q = this.teamQuery.trim().toLowerCase();
    const list = NATIONS.filter(
      (n) => (this.teamRegion === 'All' || n.region === this.teamRegion) && (!q || n.name.toLowerCase().includes(q) || n.short.toLowerCase().includes(q)),
    );
    if (!list.length) return '<div class="ts-empty">No countries match.</div>';
    const picked = this.teamSide === 'home' ? s.homeTeam : s.awayTeam;
    return list
      .map(
        (
          n,
        ) => `<button class="team-tile ${n.short === picked ? 'on' : ''} ${n.short === (this.teamSide === 'home' ? s.awayTeam : s.homeTeam) ? 'other' : ''}" data-action="pickTeam" data-code="${n.short}" role="option" aria-selected="${n.short === picked}">
      ${flagImg(n)}<span class="tile-name">${escapeHtml(n.name)}</span><span class="tile-kit"><i style="background:${n.primary}"></i><i style="background:${n.secondary}"></i><i style="background:${n.shorts}"></i></span></button>`,
      )
      .join('');
  }

  /** About / credits: the project story, attribution, licences. */
  private showAbout(): void {
    const base = import.meta.env?.BASE_URL ?? './';
    // A creator portrait appears only when the hosting site provides one (site-config.json); the game
    // itself shows the creator's initials.
    const portrait = this.host.siteConfig.creatorPortrait;
    const initials = BRAND.maintainer
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 3);
    const picture = portrait
      ? `<img src="${escapeHtml(base + portrait.src)}" alt="${escapeHtml(portrait.alt)}">`
      : `<div class="portrait-fallback" role="img" aria-label="${escapeHtml(BRAND.maintainer)}">${escapeHtml(initials)}</div>`;
    this.mount(
      'about',
      el(`<div class="screen dim about"><div class="panel about-panel">
      <h2>About ${escapeHtml(BRAND.name)}</h2>
      <div class="about-grid">
        <div class="portrait">${picture}</div>
        <div>
          <p>${escapeHtml(BRAND.name)} started as a weekend experiment in AI-assisted software development: my nephews were visiting, they love football games, so we set out to build our own — in the browser, free for anyone to play. The name grew from one of my nephews\u2019 ideas: <em>open</em> for open source, <em>clutch</em> for the big moments, and <em>XI</em> for football\u2019s starting eleven.</p>
          <p>Most of its code was written with AI assistance and reviewed by a person, so you may well find bugs or odd choices: they're an invitation to explore, report and improve.</p>
          <p class="byline-big">Created by <a href="${escapeHtml(BRAND.maintainerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(BRAND.maintainer)}</a>${sourceLink(' · ')}</p>
        </div>
      </div>
      <details class="credits"><summary>Credits &amp; licences</summary>
        <p>3D characters &amp; animations: Quaternius (CC0). Turf textures: ambientCG (CC0). Crowd and match sounds: Freesound contributors (CC0). Flags: flag-icons (MIT). Font: Inter (SIL OFL). Engine: three.js (MIT). Teams, kits, names and sponsors are generic or fictional — no official crests, kits or player likenesses.</p>
        <p>${escapeHtml(BRAND.name)} is open source under the <a href="https://www.eclipse.org/legal/epl-2.0/" target="_blank" rel="noopener noreferrer">Eclipse Public License 2.0</a> — a personal project, not affiliated with the Eclipse Foundation. <a href="${base}NOTICE.txt" target="_blank" rel="noopener">Licences and notices</a>. ${typeof __REPO_URL__ === 'string' && __REPO_URL__ ? `<a href="${__REPO_URL__}" target="_blank" rel="noopener noreferrer">Source code on GitHub</a> — contributions welcome.` : ''}${portrait?.note ? ` ${escapeHtml(portrait.note)}` : ''}</p>
        <p class="version">Version ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}</p>
      </details>
      <div class="row end" style="margin-top:16px"><button class="btn primary" data-action="back">Back</button></div>
    </div></div>`),
    );
    // A portrait that fails to load falls back to the initials. (Listener, not an inline onerror
    // attribute: the Content-Security-Policy forbids inline handlers.)
    const img = this.screens.get('about')!.querySelector<HTMLImageElement>('.portrait img');
    img?.addEventListener('error', () => {
      const d = document.createElement('div');
      d.className = 'portrait-fallback';
      d.textContent = initials;
      d.setAttribute('role', 'img');
      d.setAttribute('aria-label', BRAND.maintainer);
      img.replaceWith(d);
    });
    this.setScreen('about');
  }

  private showSettings(): void {
    const s = this.host.settings;
    const tab = this.settingsTab;
    const toggle = (key: keyof Settings, label: string, hint = '') =>
      `<div class="setting"><div>${label}${hint ? `<span class="hint">${hint}</span>` : ''}</div><div class="switch interactive ${s[key] ? 'on' : ''}" role="switch" tabindex="0" aria-checked="${!!s[key]}" data-action="toggle" data-key="${key}"></div></div>`;
    const seg = (key: keyof Settings, label: string, values: Array<[string, string]>, hint = '') =>
      `<div class="setting"><div>${label}${hint ? `<span class="hint">${hint}</span>` : ''}</div><div class="seg">${values.map(([v, l]) => `<button class="btn ${String(s[key]) === v ? 'on' : ''}" data-action="set" data-key="${key}" data-v="${v}">${l}</button>`).join('')}</div></div>`;
    const range = (key: keyof Settings, label: string) =>
      `<div class="setting"><div>${label}</div><input type="range" min="0" max="1" step="0.05" value="${s[key]}" data-range="${key}" class="interactive"></div>`;
    let body: string;
    if (tab === 'game') {
      body =
        seg(
          'camera',
          'Camera',
          [
            ['broadcast', 'Broadcast'],
            ['dynamic', 'Dynamic'],
            ['tactical', 'Tactical'],
          ],
          'Press C in a match to cycle cameras.',
        ) +
        toggle('autoSwitch', 'Assisted player switching', 'Automatically switch to the best-placed defender.') +
        seg(
          'replays',
          'Goal replays',
          [
            ['off', 'Off'],
            ['best', 'Best goals'],
            ['all', 'All goals'],
          ],
          'Replays can always be skipped with any button.',
        ) +
        toggle('minimap', 'Show minimap') +
        toggle('vibration', 'Controller vibration') +
        toggle('reduceMotion', 'Reduce motion', 'Disables camera shake and FOV kicks.') +
        seg(
          'touchControls',
          'Touch controls',
          [
            ['auto', 'Auto'],
            ['on', 'On'],
            ['off', 'Off'],
          ],
          'On-screen joystick and buttons. Auto shows them on touch screens.',
        );
    } else if (tab === 'graphics') {
      const auto = s.graphicsMode === 'auto';
      const gfx: Array<[string, string]> = [
        ['auto', 'Auto'],
        ['low', 'Low'],
        ['medium', 'Medium'],
        ['high', 'High'],
        ['ultra', 'Ultra'],
      ];
      const status = this.host.graphicsStatus?.() ?? '';
      body =
        `<div class="setting"><div>Graphics quality<span class="hint">${auto ? 'Recommended. The game measures your device and keeps adjusting resolution, effects and frame rate to stay smooth.' : 'A fixed preset. Ultra adds ambient occlusion and higher resolution shadows.'}${status ? `<br><span class="gfx-status">${escapeHtml(status)}</span>` : ''}</span></div><div class="seg">${gfx.map(([v, l]) => `<button class="btn ${(auto ? v === 'auto' : v === s.quality) ? 'on' : ''}" data-action="set" data-key="graphics" data-v="${v}">${l}</button>`).join('')}</div></div>` +
        seg(
          'frameRate',
          'Frame rate',
          [
            ['auto', 'Auto'],
            ['display', 'Max'],
            ['balanced', '60'],
            ['saver', '30'],
          ],
          "Auto: up to ~165 fps, evenly paced (144 on a 144 Hz screen, 120 on 240 Hz), lowered only if your device can't keep up (never below 30). Max renders every display refresh (most fluid, most power). 60 / 30 save power.",
        ) +
        toggle('dynamicResolution', 'Dynamic resolution', 'Render at a slightly lower resolution when needed to hold the frame rate.') +
        (auto ? '' : toggle('adaptiveQuality', 'Adaptive quality', 'Step below your preset if the frame rate stays low even at reduced resolution.')) +
        seg('timeOfDay', 'Time of day', [
          ['night', 'Night'],
          ['dusk', 'Dusk'],
          ['day', 'Day'],
        ]);
    } else if (tab === 'audio') {
      body = range('masterVolume', 'Master volume') + range('sfxVolume', 'Effects') + range('crowdVolume', 'Crowd');
    } else if (tab === 'data') {
      body = this.savedDataTab();
    } else {
      const scheme = s.controlScheme;
      const kb = activeBindings(s);
      const kbm = scheme === 'keyboardMouse';
      const removable = (a: KeyAction) => kb[a].length > 1;
      const padName = this.host.gamepadName();
      const schemes: Array<[ControlScheme, string]> = [
        ['keyboard', 'Keyboard'],
        ['keyboardMouse', 'Keyboard &amp; mouse'],
        ['controller', 'Controller'],
      ];
      if (s.controlScheme === 'touch' || TOUCH_CAPABLE()) schemes.push(['touch', 'Touch']);
      const keyRows = (Object.keys(KEY_ACTION_LABELS) as KeyAction[])
        .map(
          (a) =>
            `<div class="setting key-row"><div>${KEY_ACTION_LABELS[a]}${KEY_ACTION_HELP[a] ? `<span class="hint">${KEY_ACTION_HELP[a]}</span>` : ''}</div><div class="keys">${kb[a].map((c, i) => `<span class="kbd${removable(a) ? ' removable' : ''}" ${removable(a) ? `data-action="unbind" data-key="${a}" data-i="${i}" title="Remove this binding"` : ''}>${keyLabel(c)}</span>`).join('') || '<span class="kbd empty">—</span>'}<button class="btn" style="padding:4px 10px" data-action="rebind" data-key="${a}" title="Replace the main binding">Change</button>${kb[a].length < 2 ? `<button class="btn" style="padding:4px 8px" data-action="rebindAlt" data-key="${a}" title="Add an alternative">+</button>` : ''}</div></div>`,
        )
        .join('');
      const padRows = (Object.keys(PAD_ACTION_LABELS) as PadAction[])
        .map(
          (a) =>
            `<div class="setting key-row"><div>${PAD_ACTION_LABELS[a]}</div><div class="keys">${s.padBindings[a].map((i) => `<span class="kbd">${padLabel(i)}</span>`).join('') || '<span class="kbd empty">—</span>'}<button class="btn" style="padding:4px 10px" data-action="rebindPad" data-key="${a}" ${padName ? '' : 'disabled title="Connect a controller first"'}>Change</button></div></div>`,
        )
        .join('');
      body =
        `<div class="setting"><div>How you play<span class="hint">Picks the layout shown in hints and edited below. Every device keeps working whichever you choose.</span></div><div class="seg">${schemes.map(([v, l]) => `<button class="btn ${scheme === v ? 'on' : ''}" data-action="set" data-key="controlScheme" data-v="${v}">${l}</button>`).join('')}</div></div>` +
        seg(
          'controls',
          'Control style',
          [
            ['simple', 'Simple'],
            ['advanced', 'Advanced'],
          ],
          'Simple: passes and shots go the instant you press, with assisted power. Advanced: hold to charge shots (and passes, if Passing is set to Charged).',
        ) +
        (s.controls === 'advanced'
          ? seg(
              'passControl',
              'Passing',
              [
                ['responsive', 'On press'],
                ['charged', 'Charged'],
              ],
              'Charged: release to pass, hold longer for a firmer ball.',
            )
          : '');
      if (scheme === 'controller') {
        body +=
          `<h3 class="keys-head">Controller buttons</h3>` +
          (padName
            ? `<p class="pad-note">Connected: ${escapeHtml(padName)}. Movement: left stick or D-pad. Menu pauses, View changes camera.</p>`
            : '<p class="pad-note">Have a controller? Connect it to play — press any button on it once it is plugged in or paired.</p>') +
          `<div class="keys-table">${padRows}</div><div class="row end" style="margin-top:12px"><button class="btn" data-action="resetPad">Reset controller buttons</button></div>`;
      } else if (scheme === 'touch') {
        body +=
          seg('touchSize', 'Button size', [
            ['small', 'Small'],
            ['normal', 'Normal'],
            ['large', 'Large'],
          ]) + toggle('touchLeftHanded', 'Left-handed layout', 'Buttons on the left, joystick on the right.');
      } else {
        body +=
          `<h3 class="keys-head">${kbm ? 'Keyboard &amp; mouse layout' : 'Keyboard layout'}</h3>` +
          (kbm
            ? `<p class="pad-note">Click <b>Change</b>, then press a key or click a mouse button. Mouse buttons work on the pitch only, never on menus.</p>`
            : '') +
          `<div class="keys-table">${keyRows}</div><div class="row end" style="margin-top:12px"><button class="btn" data-action="resetKeys">Reset ${kbm ? 'keyboard &amp; mouse' : 'keyboard'} to defaults</button></div>` +
          (kbm ? toggle('mouseAim', 'Aim with the mouse', 'Optional: shots and passes go towards the cursor instead of the direction you are moving.') : '');
      }
      body += `<div class="row" style="margin-top:14px"><button class="btn" data-action="chooser">How would you like to play?…</button></div>`;
    }
    const tabBtn = (t: string, l: string) => `<button class="btn ${tab === t ? 'on' : ''}" data-action="tab" data-v="${t}">${l}</button>`;
    const node = el(`<div class="screen dim settings"><div class="panel">
      <h2>Settings</h2>
      <div class="tabs">${tabBtn('game', 'Game')}${tabBtn('graphics', 'Graphics')}${tabBtn('audio', 'Audio')}${tabBtn('controls', 'Controls')}${tabBtn('data', 'Saved data')}</div>
      <div>${body}</div>
      <div class="row end" style="margin-top:20px"><button class="btn primary" data-action="back">Done</button></div>
    </div></div>`);
    node.querySelector<HTMLInputElement>('input[data-import]')?.addEventListener('change', (e) => void this.importChosenFile(e.target as HTMLInputElement));
    node.querySelectorAll<HTMLInputElement>('input[data-range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        (this.host.settings as unknown as Record<string, number>)[inp.dataset.range!] = parseFloat(inp.value);
        this.host.applySettings(inp.dataset.range as keyof Settings);
      });
    });
    node.querySelectorAll<HTMLElement>('.switch').forEach((sw) =>
      sw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          sw.click();
        }
      }),
    );
    const prev = this.current;
    this.mount('settings', node);
    if (prev !== 'settings') this.setScreen('settings');
    else node.hidden = false;
  }

  /** First launch (and Settings → Controls): "How would you like to play?" Skippable; remembered. */
  showChooser(fromSettings: boolean): void {
    const s = this.host.settings;
    const pad = this.host.gamepadName();
    const card = (v: ControlScheme, title: string, desc: string, disabled = false) =>
      `<button class="choice ${s.controlsChosen && s.controlScheme === v ? 'on' : ''}" data-action="choose" data-v="${v}" data-from="${fromSettings ? 'settings' : 'menu'}" ${disabled ? 'disabled' : ''}><span class="ctitle">${title}</span><span class="cdesc">${desc}</span></button>`;
    const node = el(`<div class="screen dim chooser"><div class="panel">
      <h2>How would you like to play?</h2>
      <p class="sub">You can change this any time in Settings → Controls.</p>
      <div class="choices">
        ${card('keyboard', 'Keyboard only', 'WASD or arrows to move · Space pass · J shoot · K through ball · L lob')}
        ${card('keyboardMouse', 'Keyboard &amp; mouse', 'WASD to move · Left click shoot · Right click pass · Space lob · Q (or middle click) through ball')}
        ${card('controller', 'Controller', pad ? `Connected: ${escapeHtml(pad)}` : 'Have a controller? Connect it to play.', !pad)}
      </div>
      <div class="row end" style="margin-top:16px">${fromSettings ? '<button class="btn" data-action="back">Back</button>' : '<button class="btn ghost" data-action="chooseSkip">Skip</button>'}</div>
    </div></div>`);
    this.mount('chooser', node);
    this.setScreen('chooser');
    // A controller plugged in while this screen is open becomes selectable straight away.
    const onPad = () => {
      if (this.current === 'chooser') this.showChooser(fromSettings);
    };
    window.addEventListener('gamepadconnected', onPad, { once: true });
  }

  /**
   * Settings → Saved data: what is stored and where, plus export, import and the two resets. Destructive
   * actions always ask for confirmation in words first; nothing is changed by a single click.
   */
  private savedDataTab(): string {
    const msg = this.dataMessage
      ? `<p class="data-msg ${this.dataMessage.error ? 'error' : ''}" role="${this.dataMessage.error ? 'alert' : 'status'}">${escapeHtml(this.dataMessage.text)}</p>`
      : '';
    const confirmBox = (text: string, yes: string, action: string) =>
      `<div class="confirm" role="alertdialog" aria-label="Confirm"><p>${text}</p><div class="row"><button class="btn danger" data-action="${action}">${yes}</button><button class="btn" data-action="dataCancel">Cancel</button></div></div>`;
    const confirm = this.pendingImport
      ? confirmBox(
          `Import <b>${escapeHtml(this.pendingImport.summary)}</b>? This replaces what is saved in this browser now.`,
          'Yes, import',
          'dataImportConfirm',
        )
      : this.dataConfirm === 'progress'
        ? confirmBox(
            'Delete your statistics, match history and achievements? Your settings stay. This can’t be undone.',
            'Yes, reset records',
            'dataResetConfirm',
          )
        : this.dataConfirm === 'all'
          ? confirmBox(
              'Delete everything this game has saved in this browser: settings, controls, records and achievements? This can’t be undone.',
              'Yes, reset everything',
              'dataResetConfirm',
            )
          : '';
    return `<div class="saved-data">
      <p class="desc">Your settings, records and achievements are saved <b>in this browser only</b>. There is no account and nothing is sent anywhere. Clearing your browser's site data deletes them, so export a backup if you want to keep them or move them to another browser.</p>
      ${msg}${confirm}
      <div class="setting"><div>Back up<span class="hint">Download a file with your settings and records.</span></div><div><button class="btn" data-action="dataExport">Export saved data</button></div></div>
      <div class="setting"><div>Restore<span class="hint">Load a file exported from this game. You'll see what it contains before anything changes.</span></div><div><label class="btn file-btn">Import saved data…<input type="file" accept="application/json,.json" data-import class="sr-only"></label></div></div>
      <div class="setting"><div>Reset records<span class="hint">Statistics, match history and achievements. Settings stay.</span></div><div><button class="btn" data-action="dataResetProgress">Reset records…</button></div></div>
      <div class="setting"><div>Reset everything<span class="hint">Settings, controls, records and achievements.</span></div><div><button class="btn" data-action="dataResetAll">Reset everything…</button></div></div>
    </div>`;
  }

  /** Read and check a chosen import file; nothing is applied until the player confirms. */
  private async importChosenFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.dataConfirm = null;
    this.pendingImport = null;
    if (file.size > MAX_IMPORT_BYTES) {
      this.dataMessage = { text: 'That file is too large to be a saved-data file.', error: true };
    } else {
      const result = readSaveFile(await file.text());
      if (result.ok) {
        this.pendingImport = { file: result.file, summary: result.summary };
        this.dataMessage = null;
      } else this.dataMessage = { text: result.error, error: true };
    }
    this.showSettings();
  }

  /**
   * How to Play: a quick start (move, pass, shoot) for the player's own input method first, then the
   * full reference for that method only, folded away. Young players read three cards, not a table;
   * controls for devices they aren't using are never shown (they can switch in Settings → Controls).
   */
  private showHowTo(): void {
    const st = this.host.settings;
    const scheme = st.controlScheme;
    const b = activeBindings(st);
    const keys = (a: KeyAction, n = 1) =>
      b[a]
        .slice(0, n)
        .map((c) => `<kbd>${escapeHtml(keyLabel(c))}</kbd>`)
        .join(' or ');
    const p = (a: PadAction) =>
      st.padBindings[a].map((i) => `<kbd>${escapeHtml(`${PAD_BUTTON_LABELS[i] ?? i} / ${PAD_BUTTON_LABELS_PS[i] ?? i}`)}</kbd>`).join(' ') || '—';
    const simple = st.controls === 'simple';
    const moveKeys = [b.up[0], b.left[0], b.down[0], b.right[0]].map((c) => `<kbd>${escapeHtml(keyLabel(c))}</kbd>`).join('');
    const quick: Record<ControlScheme, { device: string; move: string; pass: string; shoot: string }> = {
      keyboard: {
        device: 'Keyboard',
        move: `${moveKeys} to run. Hold ${keys('sprint')} to sprint.`,
        pass: `${keys('pass')} passes to the team-mate you're facing.`,
        shoot: `${keys('shoot')} shoots at goal. Steer while shooting to pick a corner.`,
      },
      keyboardMouse: {
        device: 'Keyboard and mouse',
        move: `${moveKeys} to run. Hold ${keys('sprint')} to sprint.`,
        pass: `${keys('pass', 2)} passes to the team-mate you're facing.`,
        shoot: `${keys('shoot', 2)} shoots at goal. Steer while shooting to pick a corner.`,
      },
      controller: {
        device: 'Controller',
        move: `<kbd>Left stick</kbd> to run. Hold ${p('sprint')} to sprint.`,
        pass: `${p('pass')} passes to the team-mate you're facing.`,
        shoot: `${p('shoot')} shoots at goal. Steer while shooting to pick a corner.`,
      },
      touch: {
        device: 'Touch',
        move: 'Drag the <b>joystick</b> on the left. Push it to the edge to sprint.',
        pass: 'Tap <b>Pass</b> to pass to the team-mate you\u2019re facing.',
        shoot: 'Tap <b>Shoot</b> to shoot at goal. Steer while shooting to pick a corner.',
      },
    };
    const q = quick[scheme];
    // Small, decorative pictures (text alternatives are the card titles and texts next to them).
    const icon = {
      move: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="6" fill="currentColor"/><path d="M24 4l5 7h-10zM24 44l-5-7h10zM4 24l7-5v10zM44 24l-7 5V19z" fill="currentColor" opacity=".7"/></svg>',
      pass: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="10" cy="34" r="5" fill="currentColor"/><circle cx="38" cy="14" r="5" fill="currentColor" opacity=".7"/><path d="M15 31l17-12" stroke="currentColor" stroke-width="3" stroke-dasharray="4 4" fill="none"/><circle cx="25" cy="24" r="3.5" fill="#fff"/></svg>',
      shoot:
        '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 12h32v22" stroke="currentColor" stroke-width="3" fill="none"/><path d="M8 12v22" stroke="currentColor" stroke-width="3"/><path d="M12 42l20-20" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".7"/><circle cx="33" cy="21" r="3.5" fill="#fff"/></svg>',
    };
    const card = (n: number, title: string, svg: string, text: string) =>
      `<li class="qs-card"><span class="qs-step" aria-hidden="true">${n}</span>${svg}<h3>${title}</h3><p>${text}</p></li>`;
    const reference: Record<ControlScheme, string> = {
      keyboard: '',
      keyboardMouse: '',
      controller: `<table class="ctl">
          <tr><th scope="col">Button</th><th scope="col">Attacking</th><th scope="col">Defending</th></tr>
          <tr><td><kbd>Left stick</kbd></td><td colspan="2">Move · ${p('sprint')} sprint</td></tr>
          <tr><td>${p('pass')}</td><td>Pass</td><td>Jockey (hold)</td></tr>
          <tr><td>${p('shoot')}</td><td>Shoot</td><td>Tackle</td></tr>
          <tr><td>${p('lob')}</td><td>Lob / cross</td><td>Slide tackle</td></tr>
          <tr><td>${p('through')}</td><td>Through ball</td><td>—</td></tr>
          <tr><td>${p('switch')}</td><td colspan="2">Switch player</td></tr>
          <tr><td>${p('skill')}</td><td colspan="2">Skill move</td></tr>
          <tr><td>Menu · View</td><td colspan="2">Pause · Camera</td></tr>
        </table>`,
      touch: `<p class="ctl-note">Left thumb: joystick (push to the edge to sprint). Right thumb: <b>Shoot</b>, <b>Pass</b> and <b>Through</b>. When the other team has the ball they become <b>Tackle</b>, <b>Switch</b> and <b>Slide</b>.</p>`,
    };
    const keyTable = `<table class="ctl">
          <tr><th scope="col">Key</th><th scope="col">Attacking</th><th scope="col">Defending</th></tr>
          <tr><td>${moveKeys}</td><td colspan="2">Move (arrows work too)</td></tr>
          <tr><td>${keys('sprint')}</td><td colspan="2">Sprint (hold)</td></tr>
          <tr><td>${keys('pass', scheme === 'keyboardMouse' ? 2 : 1)}</td><td>Pass</td><td>Standing tackle</td></tr>
          <tr><td>${keys('shoot', scheme === 'keyboardMouse' ? 2 : 1)}</td><td>Shoot${simple ? '' : ' (hold for power)'}</td><td>Slide tackle</td></tr>
          <tr><td>${keys('through')}</td><td>Through ball</td><td>Switch player</td></tr>
          <tr><td>${keys('lob')}</td><td>Lob / cross</td><td>Jockey (hold)</td></tr>
          <tr><td>${keys('skill')}</td><td>Skill move</td><td>—</td></tr>
          <tr><td>${keys('switch')} · ${keys('camera')} · ${keys('pause')}</td><td colspan="2">Switch player · Camera · Pause</td></tr>
        </table><p class="ctl-note">${simple ? 'Simple controls: passes and shots happen instantly.' : 'Advanced controls: hold shoot (and pass, if Charged) for power.'}</p>`;
    reference.keyboard = reference.keyboardMouse = keyTable;
    this.mount(
      'howto',
      el(`<div class="screen dim howto"><div class="panel">
      <h2>How to Play</h2>
      <p class="qs-device">Showing controls for: <b>${q.device}</b>. Change it in Settings → Controls.</p>
      <ol class="quick-start">
        ${card(1, 'Move', icon.move, q.move)}
        ${card(2, 'Pass', icon.pass, q.pass)}
        ${card(3, 'Shoot', icon.shoot, q.shoot)}
      </ol>
      <p class="qs-goal">Score more goals than the computer before the clock runs out. When the other team has the ball, run at the player with it and tackle.</p>
      <details class="qs-more"><summary>All ${escapeHtml(q.device.toLowerCase())} controls</summary>${reference[scheme]}</details>
      <details class="qs-more"><summary>Tips</summary><div class="tips">
        <b>Aiming:</b> shots go towards goal automatically. Steer left or right while shooting to pick a corner.<br>
        <b>Passing:</b> the pass goes to the team-mate you're pushing towards (a white ring shows who).<br>
        <b>Dribbling:</b> jogging keeps the ball close; sprinting knocks it further ahead (faster, but easier to steal).<br>
        <b>Defending:</b> stay goal-side, jockey to contain, and time your tackle. Clip the player before the ball and it's a foul.<br>
        <b>Penalties:</b> aim the reticle (outside the frame misses) and release at 60–80% power. In goal, watch the shooter's run-up and dive as the ball is struck.
      </div></details>
      <div class="row end" style="margin-top:20px"><button class="btn" data-action="tutorial">Start tutorial</button><button class="btn primary" data-action="back">Back</button></div>
    </div></div>`),
    );
    this.setScreen('howto');
  }

  /**
   * Offer the interactive tutorial once. On first launch it comes straight after the controls chooser
   * ('welcome': the moment someone has just said how they play); a player who skipped the chooser is
   * asked at their first Kick Off instead ('kickoff'). Either way it is one click to decline, it is
   * never asked again, and the Tutorial button stays on the menu.
   */
  showTutorialOffer(context: 'welcome' | 'kickoff' = 'kickoff'): void {
    const decline =
      context === 'welcome'
        ? '<button class="btn center" data-action="tutorialLater">Not now</button>'
        : '<button class="btn center" data-action="skipTutorial">Skip — just play</button>';
    this.mount(
      'tutorialOffer',
      el(`<div class="screen dim"><div class="panel" style="text-align:center;max-width:480px">
      <h2>Welcome to ${escapeHtml(BRAND.name)}</h2>
      <p style="color:var(--muted);line-height:1.6">New here? Take the 60-second interactive tutorial to learn moving, passing, shooting and skills on the training pitch. You can find it on the menu any time.</p>
      <div class="modal-actions"><button class="btn primary center" data-action="tutorial">Start tutorial</button>${decline}</div>
    </div></div>`),
    );
    this.setScreen('tutorialOffer');
  }

  showPause(mode: GameMode): void {
    this.pauseFrom = 'match';
    this.mount(
      'pause',
      el(`<div class="screen dim pause"><div class="panel">
      <h2>Paused</h2>
      <nav>
        <button class="btn primary" data-action="resume">Resume</button>
        <button class="btn" data-action="restart">Restart ${mode === 'penalties' ? 'shootout' : mode === 'practice' ? 'practice' : 'match'}</button>
        <button class="btn" data-action="settings">Settings</button>
        <button class="btn" data-action="howto">How to play</button>
        ${mode === 'practice' && this.tutorialActive ? '<button class="btn" data-action="tutRetry">Retry tutorial step</button><button class="btn" data-action="tutSkip">Skip tutorial step</button><button class="btn" data-action="tutRestart">Restart tutorial</button><button class="btn" data-action="tutExit">Exit tutorial</button>' : ''}
        <button class="btn" data-action="quit">Quit to menu</button>
      </nav>
    </div></div>`),
    );
    this.setScreen('pause');
  }

  /**
   * The full-time screen: result, goal timeline, statistics, a suggested next step, and the actions.
   * @param goals - the match's goals in order, with scorer names already resolved (own goals marked).
   * @param difficulty - used only to suggest the next step (e.g. try a harder level after a win).
   */
  showFullTime(
    teams: [TeamIdentity, TeamIdentity],
    score: [number, number],
    winner: 0 | 1 | null,
    stats: [TeamStats, TeamStats],
    mode: GameMode,
    goals: Array<{ team: 0 | 1; scorer: string; minute: number; ownGoal: boolean }> = [],
    difficulty?: Difficulty,
    /** Names of achievements this match unlocked: shown quietly here, never during play. */
    unlocked: string[] = [],
    /** In a cup match: what happens next (a shootout, or back to the cup) and a line explaining it. */
    cup?: { next: 'penalties' | 'hub'; note: string },
  ): void {
    const total = Math.max(1e-6, stats[0].possession + stats[1].possession);
    const poss0 = Math.round((stats[0].possession / total) * 100);
    const row = (label: string, a: string | number, b: string | number) => `<tr><td>${a}</td><td>${label}</td><td>${b}</td></tr>`;
    const pct = (s: TeamStats) => (s.passes ? Math.round((s.passesCompleted / s.passes) * 100) : 0);
    const title = winner === null ? 'Honours even' : winner === 0 ? `${teams[0].name} win!` : `${teams[1].name} win`;
    const statsRows =
      mode === 'penalties'
        ? ''
        : `<table class="stats">
        ${row('Possession', poss0 + '%', 100 - poss0 + '%')}
        ${row('Shots', stats[0].shots, stats[1].shots)}
        ${row('On target', stats[0].shotsOnTarget, stats[1].shotsOnTarget)}
        ${row('Pass accuracy', pct(stats[0]) + '%', pct(stats[1]) + '%')}
        ${row('Tackles won', stats[0].tackles, stats[1].tackles)}
        ${row('Saves', stats[0].saves, stats[1].saves)}
        ${row('Corners', stats[0].corners, stats[1].corners)}
        ${row('Fouls', stats[0].fouls, stats[1].fouls)}
      </table>`;
    this.mount(
      'fulltime',
      el(`<div class="screen dim fulltime"><div class="panel final" style="width:min(560px,94vw)">
      <div style="color:var(--muted);letter-spacing:.3em;font-size:12px;font-weight:800">${mode === 'penalties' ? 'SHOOTOUT OVER' : 'FULL TIME'}</div>
      <div class="winner">${title}</div>
      <div class="big-score">${flagImg(teams[0])}<span>${teams[0].short}</span><span class="n">${score[0]}</span><span style="opacity:.4">–</span><span class="n">${score[1]}</span><span>${teams[1].short}</span>${flagImg(teams[1])}</div>
      ${goalTimeline(goals, teams)}
      ${statsRows}
      ${unlocked.length ? `<ul class="ft-achievements" aria-label="Achievements unlocked">${unlocked.map((n) => `<li><span aria-hidden="true">★</span> Achievement unlocked: <b>${escapeHtml(n)}</b></li>`).join('')}</ul>` : ''}
      ${mode === 'match' ? nextStepHint(winner, difficulty) : ''}
      ${cup ? `<p class="cup-note" role="status">${escapeHtml(cup.note)}</p>` : ''}
      <div class="modal-actions ft-actions">${
        cup
          ? cup.next === 'penalties'
            ? '<button class="btn primary center" data-action="cupPlay">Take the penalty shootout</button>'
            : '<button class="btn primary center" data-action="cup">Continue the cup</button><button class="btn center" data-action="quit">Main menu</button>'
          : '<button class="btn primary center" data-action="restart">Rematch</button><button class="btn center" data-action="changeTeams">Change teams</button><button class="btn center" data-action="quit">Main menu</button>'
      }</div>
    </div></div>`),
    );
    this.setScreen('fulltime');
    if (unlocked.length) this.liveEl.textContent = `Achievement unlocked: ${unlocked.join(', ')}.`;
  }

  /** The cup button on the main menu: start one, or continue with the next opponent named. */
  private cupMenuButton(): string {
    const t = this.host.cup.active;
    const next = t ? nextPlayerFixture(t) : null;
    const opp = t && next ? nationByCode(next.home === t.team ? next.away : next.home)?.name : null;
    const sub = !t ? 'Groups, knockouts, a trophy' : next ? `Continue · ${fixtureLabel(next)} v ${opp ?? ''}` : champion(t) ? 'See how it ended' : 'Continue';
    return `<button class="btn big cup-btn" data-action="cup">${escapeHtml(BRAND.tournamentName)}<small>${escapeHtml(sub)}</small></button>`;
  }

  private cupFormat: CupFormat = 'short16';
  private cupConfirmAbandon = false;

  /** The XI Nations Cup: setup when no cup is active, the hub during one, the result once it's over. */
  showCup(): void {
    const t = this.host.cup.active;
    const html = !t
      ? cupSetupHtml(this.host.settings, this.cupFormat, this.host.cup)
      : champion(t)
        ? cupFinishedHtml(t)
        : cupHubHtml(t, this.cupConfirmAbandon);
    this.mount('cup', el(html));
    this.setScreen('cup');
  }

  /**
   * Records: the player's statistics, every achievement (locked ones included, with their conditions)
   * and recent matches. Plain words and numbers, readable by young players and screen readers.
   */
  showRecords(): void {
    const p = this.host.progress;
    const st = p.stats;
    const card = (label: string, value: string | number) => `<li><span class="rv">${escapeHtml(String(value))}</span><span class="rl">${label}</span></li>`;
    const best = st.biggestWin ? `${st.biggestWin.for}–${st.biggestWin.against}` : '—';
    const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const name = (code: string) => escapeHtml(nationByCode(code)?.name ?? code);
    const achievements = ACHIEVEMENTS.map((a) => {
      const u = p.achievements[a.id];
      return `<li class="${u ? 'got' : ''}"><span class="badge" aria-hidden="true">${u ? '★' : '☆'}</span><span><b>${escapeHtml(a.name)}</b><span class="desc">${escapeHtml(a.description)}</span></span><span class="when">${u ? `Unlocked ${date(u.unlockedAt)}` : 'Not yet'}</span></li>`;
    }).join('');
    const unlockedCount = Object.keys(p.achievements).length;
    const history = p.history.length
      ? `<table class="history"><caption class="sr-only">Recent matches</caption><tr><th scope="col">Date</th><th scope="col">Match</th><th scope="col">Score</th><th scope="col">Result</th></tr>${p.history
          .slice(0, 10)
          .map(
            (h) =>
              `<tr><td>${date(h.finishedAt)}</td><td>${name(h.team)} v ${name(h.opponent)}${h.mode === 'penalties' ? ' (penalties)' : ` · ${escapeHtml(h.format)} · ${cap(h.difficulty)}`}</td><td>${h.goalsFor}–${h.goalsAgainst}</td><td>${h.result === 'win' ? 'Won' : h.result === 'loss' ? 'Lost' : 'Draw'}</td></tr>`,
          )
          .join('')}</table>`
      : '<p class="desc">No matches yet. Play a match to the final whistle and it will appear here.</p>';
    this.mount(
      'records',
      el(`<div class="screen dim records"><div class="panel">
      <h2>Records</h2>
      <h3>Your matches</h3>
      <ul class="record-cards">
        ${card('Played', st.played)}${card('Won', st.won)}${card('Drawn', st.drawn)}${card('Lost', st.lost)}
        ${card('Goals scored', st.goalsFor)}${card('Goals conceded', st.goalsAgainst)}${card('Clean sheets', st.cleanSheets)}
        ${card('Biggest win', best)}${card('Most goals in a match', st.mostGoalsInMatch)}
        ${card('Shootouts won', st.shootoutsWon)}${card('Shootouts lost', st.shootoutsLost)}${card('Penalties saved', st.penaltySaves)}
      </ul>
      <h3>Achievements <span class="desc">${unlockedCount} of ${ACHIEVEMENTS.length}</span></h3>
      <ul class="achievements">${achievements}</ul>
      <h3>Recent matches</h3>
      ${history}
      <p class="desc privacy-note">Your records are saved in this browser only, never sent anywhere. Clearing your browser's site data deletes them. Back them up or reset them in Settings → Saved data.</p>
      <div class="row end" style="margin-top:16px"><button class="btn primary" data-action="back">Back</button></div>
    </div></div>`),
    );
    this.setScreen('records');
  }

  hide(): void {
    this.setScreen('none');
  }

  private handleAction(action: string, node: HTMLElement): void {
    const s = this.host.settings;
    switch (action) {
      case 'play':
        this.host.startMatch('match');
        break;
      case 'practice':
        this.host.startMatch('practice');
        break;
      case 'penalties':
        this.host.startMatch('penalties');
        break;
      case 'setup':
        this.showSetup((node.dataset.side as 'home' | 'away' | undefined) ?? undefined);
        break;
      case 'about':
        this.showAbout();
        break;
      case 'changeTeams':
        this.host.quitToMenu();
        this.showSetup('home');
        break;
      case 'teamSide':
        this.showSetup(node.dataset.side as 'home' | 'away');
        break;
      case 'region':
        this.teamRegion = node.dataset.v!;
        this.showSetup();
        break;
      case 'pickTeam':
      case 'randomTeam': {
        const code = action === 'randomTeam' ? NATIONS[Math.floor(Math.random() * NATIONS.length)].short : node.dataset.code!;
        const mine = this.teamSide === 'home' ? 'homeTeam' : 'awayTeam';
        const other = this.teamSide === 'home' ? 'awayTeam' : 'homeTeam';
        if (s[other] === code) s[other] = s[mine]; // picking the other side's team swaps them
        s[mine] = code;
        this.host.applySettings(mine);
        // After choosing your team, move straight on to the opponent.
        if (this.teamSide === 'home' && action === 'pickTeam') this.teamSide = 'away';
        this.showSetup();
        break;
      }
      case 'settings':
        this.showSettings();
        break;
      case 'howto':
        this.showHowTo();
        break;
      case 'tutorial':
        s.tutorialSeen = true;
        this.host.applySettings('tutorialSeen');
        this.host.startTutorial();
        break;
      case 'tutRetry':
        this.host.tutorialAction('retry');
        break;
      case 'tutSkip':
        this.host.tutorialAction('skip');
        break;
      case 'tutRestart':
        this.host.tutorialAction('restart');
        break;
      case 'tutExit':
        this.host.tutorialAction('exit');
        break;
      case 'records':
        this.showRecords();
        break;
      case 'cup':
        this.cupConfirmAbandon = false;
        this.showCup();
        break;
      case 'cupFormat':
        this.cupFormat = node.dataset.v as CupFormat;
        this.showCup();
        break;
      case 'cupTeam':
        this.showSetup('home');
        break;
      case 'cupStart':
        this.host.startCup(this.cupFormat);
        this.showCup();
        this.liveEl.textContent = `${BRAND.tournamentName} started.`;
        break;
      case 'cupPlay':
        this.host.playCupMatch();
        break;
      case 'cupAbandon':
        this.cupConfirmAbandon = true;
        this.showCup();
        break;
      case 'cupAbandonCancel':
        this.cupConfirmAbandon = false;
        this.showCup();
        break;
      case 'cupAbandonConfirm':
      case 'cupNew':
        this.cupConfirmAbandon = false;
        this.host.abandonCup();
        this.showCup();
        break;
      case 'dataExport':
        download(`${BRAND.filePrefix}-player-data-${stamp()}.json`, JSON.parse(exportSaveData()));
        this.dataMessage = { text: 'Saved data exported. Keep the file somewhere safe.', error: false };
        this.showSettings();
        break;
      case 'dataResetProgress':
      case 'dataResetAll':
        this.pendingImport = null;
        this.dataMessage = null;
        this.dataConfirm = action === 'dataResetAll' ? 'all' : 'progress';
        this.showSettings();
        break;
      case 'dataCancel':
        this.dataConfirm = null;
        this.pendingImport = null;
        this.dataMessage = null;
        this.showSettings();
        break;
      case 'dataResetConfirm':
        if (this.dataConfirm === 'all') resetAllData();
        else if (this.dataConfirm === 'progress') resetProgress();
        this.dataConfirm = null;
        this.host.reloadSavedData();
        break;
      case 'dataImportConfirm':
        if (this.pendingImport) applySaveFile(this.pendingImport.file);
        this.pendingImport = null;
        this.host.reloadSavedData();
        break;
      case 'tutorialLater':
        s.tutorialSeen = true;
        this.host.applySettings('tutorialSeen');
        this.showMenu();
        break;
      case 'skipTutorial':
        s.tutorialSeen = true;
        this.host.applySettings('tutorialSeen');
        this.host.startMatch('match');
        break;
      case 'resume':
        this.host.resume();
        break;
      case 'restart':
        this.host.restart();
        break;
      case 'quit':
        this.host.quitToMenu();
        break;
      case 'back':
        this.back();
        break;
      case 'opt': {
        const key = node.dataset.key!;
        const v = node.dataset.v!;
        (s as unknown as Record<string, unknown>)[key] = key === 'minutes' ? Number(v) : v;
        this.host.applySettings(key as keyof Settings);
        this.showSetup();
        break;
      }
      case 'tab':
        this.settingsTab = node.dataset.v as typeof this.settingsTab;
        this.showSettings();
        break;
      case 'toggle': {
        const key = node.dataset.key as keyof Settings;
        (s as unknown as Record<string, unknown>)[key] = !s[key];
        this.host.applySettings(key);
        this.showSettings();
        break;
      }
      case 'set': {
        if (node.dataset.key === 'graphics') {
          // One control for Auto + the presets: picking a preset switches to manual (handled by the host).
          if (node.dataset.v === 'auto') {
            s.graphicsMode = 'auto';
            this.host.applySettings('graphicsMode');
          } else {
            s.quality = node.dataset.v as Settings['quality'];
            this.host.applySettings('quality');
          }
          this.showSettings();
          break;
        }
        const key = node.dataset.key as keyof Settings;
        (s as unknown as Record<string, unknown>)[key] = node.dataset.v;
        this.host.applySettings(key);
        this.showSettings();
        break;
      }
      case 'rebind':
      case 'rebindAlt': {
        const a = node.dataset.key as KeyAction;
        const alt = action === 'rebindAlt';
        const keys = node.parentElement!;
        if (!alt) keys.querySelectorAll('.kbd').forEach((k) => k.remove());
        const kbm = s.controlScheme === 'keyboardMouse';
        keys.prepend(el(`<span class="kbd capture">${kbm ? 'Press a key or click a mouse button…' : 'Press a key…'} (Esc cancels)</span>`));
        this.host.captureKey((code) => {
          if (code !== 'Escape') {
            const msg = applyBinding(activeBindings(s), a, code, alt);
            this.host.applySettings('bindings');
            if (msg) this.toast(msg, 3.5);
          }
          this.showSettings();
        }, kbm);
        break;
      }
      case 'unbind': {
        const a = node.dataset.key as KeyAction;
        const i = Number(node.dataset.i);
        const kb = activeBindings(s);
        if (kb[a].length > 1) {
          kb[a].splice(i, 1);
          this.host.applySettings('bindings');
        }
        this.showSettings();
        break;
      }
      case 'newControls':
        s.bindings = structuredClone(DEFAULT_BINDINGS);
        s.offerNewControls = false;
        s.controls = 'simple';
        this.host.applySettings('bindings');
        this.toast('New controls on: Space pass · J shoot · K through · L lob', 4);
        this.showMenu();
        break;
      case 'keepControls':
        s.offerNewControls = false;
        this.host.applySettings('offerNewControls');
        this.showMenu();
        break;
      case 'resetKeys':
        if (s.controlScheme === 'keyboardMouse') s.kbmBindings = structuredClone(DEFAULT_KBM_BINDINGS);
        else s.bindings = structuredClone(DEFAULT_BINDINGS);
        this.host.applySettings('bindings');
        this.showSettings();
        break;
      case 'resetPad':
        s.padBindings = structuredClone(DEFAULT_PAD_BINDINGS);
        this.host.applySettings('padBindings');
        this.showSettings();
        break;
      case 'rebindPad': {
        const a = node.dataset.key as PadAction;
        const keys = node.parentElement!;
        keys.querySelectorAll('.kbd').forEach((k) => k.remove());
        keys.prepend(el('<span class="kbd capture">Press a controller button… (Esc cancels)</span>'));
        const cancel = (e: KeyboardEvent) => {
          if (e.code === 'Escape') {
            this.host.cancelCapture();
            this.showSettings();
          }
        };
        window.addEventListener('keydown', cancel, { once: true });
        this.host.capturePadButton((btn) => {
          window.removeEventListener('keydown', cancel);
          const msg = applyPadBinding(s.padBindings, a, btn);
          this.host.applySettings('padBindings');
          if (msg) this.toast(msg, 3.5);
          this.showSettings();
        });
        break;
      }
      case 'chooser':
        this.showChooser(true);
        break;
      case 'choose': {
        s.controlScheme = node.dataset.v as ControlScheme;
        s.controlsChosen = true;
        this.host.applySettings('controlScheme');
        if (node.dataset.from === 'settings') this.showSettings();
        else if (!s.tutorialSeen) this.showTutorialOffer('welcome');
        else this.showMenu();
        break;
      }
      case 'chooseSkip':
        s.controlsChosen = true;
        this.host.applySettings('controlsChosen');
        this.showMenu();
        break;
    }
  }

  /** Back navigation (Esc / gamepad B in menus). Returns true when handled. */
  back(): boolean {
    switch (this.current) {
      case 'chooser':
        // From Settings: back to Settings. On first launch, Esc / B = Skip (keyboard; asked once only).
        if (this.previous === 'settings') {
          this.showSettings();
          return true;
        }
        this.host.settings.controlsChosen = true;
        this.host.applySettings('controlsChosen');
        this.showMenu();
        return true;
      case 'setup':
      case 'howto':
      case 'settings':
      case 'about':
      case 'records':
      case 'cup':
        if (this.pauseFrom === 'match' && this.previous === 'pause') {
          this.setScreen('pause');
        } else if (this.pauseFrom === 'match' && (this.current === 'settings' || this.current === 'howto')) {
          this.setScreen('pause');
        } else {
          this.showMenu();
        }
        return true;
      case 'tutorialOffer':
        this.showMenu();
        return true;
      case 'pause':
        this.host.resume();
        return true;
      default:
        return false;
    }
  }

  clearPauseContext(): void {
    this.pauseFrom = null;
  }

  /** Gamepad / keyboard focus navigation inside menus. */
  navigate(dir: 'up' | 'down' | 'left' | 'right'): void {
    const node = this.screens.get(this.current);
    if (!node) return;
    const items = Array.from(node.querySelectorAll<HTMLElement>('button, .switch, input[type=range]')).filter((e) => e.offsetParent !== null);
    if (!items.length) return;
    const active = document.activeElement as HTMLElement | null;
    if (active instanceof HTMLInputElement && active.type === 'range' && (dir === 'left' || dir === 'right')) {
      active.value = String(Math.max(0, Math.min(1, parseFloat(active.value) + (dir === 'right' ? 0.1 : -0.1))));
      active.dispatchEvent(new Event('input'));
      return;
    }
    let i = active ? items.indexOf(active) : -1;
    i = dir === 'up' || dir === 'left' ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
    items[i].focus();
  }

  confirm(): void {
    const a = document.activeElement as HTMLElement | null;
    if (a && this.screens.get(this.current)?.contains(a)) a.click();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  showHud(show: boolean, minimap: boolean): void {
    this.hudEl.hidden = !show;
    this.minimapWanted = minimap;
    this.hudRefs.mini.hidden = !minimap;
  }

  /** Cache of last-written HUD values: the DOM is only touched when something actually changes. */
  private hudCache = new Map<string, string>();
  private setText(key: string, el: HTMLElement, v: string): void {
    if (this.hudCache.get(key) === v) return;
    this.hudCache.set(key, v);
    el.textContent = v;
  }
  private setHtml(key: string, el: HTMLElement, v: string): void {
    if (this.hudCache.get(key) === v) return;
    this.hudCache.set(key, v);
    el.innerHTML = v;
  }
  private setStyle(key: string, el: HTMLElement, prop: 'width' | 'background', v: string): void {
    if (this.hudCache.get(key) === v) return;
    this.hudCache.set(key, v);
    el.style[prop] = v;
  }
  private setHidden(key: string, el: HTMLElement, hidden: boolean): void {
    const v = hidden ? '1' : '0';
    if (this.hudCache.get(key) === v) return;
    this.hudCache.set(key, v);
    el.hidden = hidden;
  }

  updateHud(d: HudData): void {
    const r = this.hudRefs;
    this.setText('t0', r.t0, d.teams[0].short);
    this.setText('t1', r.t1, d.teams[1].short);
    // Flags (only touch the DOM when the team changes).
    for (const i of [0, 1] as const) {
      const f = d.teams[i].flag ? BASE + d.teams[i].flag : '';
      if (this.hudCache.get(`f${i}`) !== f) {
        this.hudCache.set(`f${i}`, f);
        const img = r[`f${i}`] as HTMLImageElement;
        img.hidden = !f;
        if (f) img.src = f;
      }
    }
    this.setStyle('sw0', r.sw0, 'background', d.colors[0]);
    this.setStyle('sw1', r.sw1, 'background', d.colors[1]);
    const sc = `${d.score[0]} <span style="opacity:.4">-</span> ${d.score[1]}`;
    if (sc !== this.lastScore) {
      if (this.lastScore) {
        r.score.classList.remove('flash');
        void r.score.offsetWidth;
        r.score.classList.add('flash');
      }
      r.score.innerHTML = sc;
      this.lastScore = sc;
    }
    this.setText('clock', r.clock, d.clock);
    // Replays are clean footage: no player card / minimap / power bar over the action.
    this.setHidden('card', r.card, !d.player || d.replay);
    this.setHidden('mini', r.mini, d.replay || !this.minimapWanted);
    if (d.player) {
      this.setText('pname', r.pname, d.player.name);
      this.setText('prole', r.prole, d.player.role);
      this.setStyle('stam', r.stam, 'width', `${Math.round(d.player.stamina * 50) * 2}%`);
    }
    this.setHidden('power', r.power, !d.power || d.replay);
    if (d.power) {
      this.setText('plabel', r.plabel, d.power.label);
      this.setStyle('pbar', r.pbar, 'width', `${Math.round(d.power.value * 100)}%`);
    }
    this.setHidden('hint', r.hint, !d.hint);
    if (d.hint) this.setHtml('hintHtml', r.hint, d.hint);
    this.setHidden('replay', r.replay, !d.replay);
    if (d.replay !== this.wasReplay) {
      this.wasReplay = d.replay;
      r.letterbox.classList.toggle('on', d.replay);
      this.wipe();
    }
    this.setHidden('skip', r.skip, !d.replay);
    this.setHidden('fps', r.fps, d.fps === null || d.replay);
    if (d.fps !== null) this.setText('fpsText', r.fps, `${d.fps} FPS`);
    this.setHidden('pens', r.pens, !d.pens);
    if (d.pens) {
      const rows = [0, 1].map((t) => {
        const kicks = d.pens!.filter((k) => k.team === t);
        const dots: string[] = [];
        for (let i = 0; i < Math.max(5, kicks.length); i++) {
          const k = kicks[i];
          dots.push(`<span class="dot ${k ? (k.scored ? 'g' : 'm') : ''}"></span>`);
        }
        return `<div class="prow"><span>${d.teams[t].short}</span>${dots.join('')}</div>`;
      });
      this.setHtml('pensHtml', r.pens, rows.join(''));
    }
  }

  resetHud(): void {
    this.lastScore = '';
    this.hudCache.clear();
  }

  drawMinimap(m: MinimapData): void {
    const c = this.minimapCanvas;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const W = c.width,
      H = c.height;
    const pad = 6;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(34, 94, 46, 0.85)';
    ctx.fillRect(pad, pad, W - pad * 2, H - pad * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    ctx.beginPath();
    ctx.moveTo(W / 2, pad);
    ctx.lineTo(W / 2, H - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 10, 0, Math.PI * 2);
    ctx.stroke();
    const sx = (x: number) => pad + ((x + m.length / 2) / m.length) * (W - pad * 2);
    const sz = (z: number) => pad + ((z + m.width / 2) / m.width) * (H - pad * 2);
    for (const p of m.players) {
      ctx.beginPath();
      ctx.fillStyle = m.colors[p.team];
      ctx.arc(sx(p.x), sz(p.z), p.human ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = p.human ? 2 : 1;
      ctx.strokeStyle = p.human ? '#fde047' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(sx(m.ball.x), sz(m.ball.z), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  banner(text: string, sub: string | undefined, kind: 'goal' | 'info' | 'big', duration = 1.8): void {
    this.bannerEl.className = `banner ${kind}`;
    this.bannerEl.innerHTML = `<span class="text">${escapeHtml(text)}</span>${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ''}`;
    this.bannerEl.hidden = false;
    this.bannerTimer = duration;
    // Decisions are also announced in words (not only by colour or animation).
    this.liveEl.textContent = sub ? `${text}. ${sub}` : text;
  }

  private wasReplay = false;
  /** Minimap visibility chosen by the mode / settings (showHud); replays hide it on top of that. */
  private minimapWanted = true;
  /** Broadcast stinger: a fast diagonal wipe that hides the cut into / out of a replay. */
  wipe(): void {
    const w = el('<div class="wipe"><i></i><i></i><span>REPLAY</span></div>');
    this.root.append(w);
    setTimeout(() => w.remove(), 900);
  }

  private lineupEl: HTMLElement | null = null;
  private lineupTimer = 0;
  /** Broadcast-style starting line-ups shown over the intro dolly. */
  showLineups(m: Match, clubs: [TeamIdentity, TeamIdentity], duration: number): void {
    this.hideLineups();
    const side = (t: 0 | 1) => {
      const c = clubs[t];
      const rows = m.world.players
        .filter((p) => p.team === t)
        .map((p, i) => `<li style="animation-delay:${0.15 + i * 0.07}s"><b>${p.number}</b><span>${escapeHtml(p.name)}</span><em>${p.role}</em></li>`)
        .join('');
      return `<div class="lineup ${t ? 'away' : 'home'}" style="--club:${c.primary};--club2:${c.secondary}">
        <header><i></i><span>${escapeHtml(c.name)}</span></header><ol>${rows}</ol></div>`;
    };
    this.lineupEl = el(`<div class="lineups">${side(0)}${side(1)}</div>`);
    this.root.append(this.lineupEl);
    this.lineupTimer = duration;
  }

  hideLineups(): void {
    this.lineupEl?.remove();
    this.lineupEl = null;
    this.lineupTimer = 0;
  }

  clearBanner(): void {
    this.bannerEl.hidden = true;
    this.bannerTimer = 0;
  }

  /** Set by the game while the tutorial runs (pause menu shows tutorial controls). */
  tutorialActive = false;

  /**
   * Show the controlled player's name at a screen position (percent of the viewport), or hide it with
   * null. `opacity` fades a brief name out (see src/ui/playerLabel.ts). Called every frame: it only
   * touches the DOM text when the name changes, and moves the label with a transform (cheap, no layout).
   */
  playerLabel(text: string | null, xPct: number, yPct: number, opacity = 1): void {
    const e = this.playerLabelEl;
    if (!text) {
      if (!e.hidden) e.hidden = true;
      return;
    }
    if (text !== this.playerLabelText) {
      this.playerLabelText = text;
      e.textContent = text;
    }
    if (e.hidden) e.hidden = false;
    e.style.transform = `translate(-50%, -100%) translate(${xPct.toFixed(2)}vw, ${yPct.toFixed(2)}vh)`;
    const o = opacity >= 1 ? '' : opacity.toFixed(2);
    if (e.style.opacity !== o) e.style.opacity = o;
  }

  tutorial(step: string | null, msg = '', done = false): void {
    if (!step) {
      this.tutorialEl.hidden = true;
      return;
    }
    this.tutorialEl.hidden = false;
    this.tutorialEl.innerHTML = `<div class="card"><div class="step">${step}</div><div class="msg ${done ? 'done' : ''}">${msg}</div>
      <div class="tut-actions"><button class="tut-btn" data-action="tutRetry">Retry step</button><button class="tut-btn" data-action="tutSkip">Skip step</button><button class="tut-btn" data-action="tutRestart">Restart</button><button class="tut-btn" data-action="tutExit">Exit tutorial</button></div></div>`;
  }

  toast(msg: string, seconds = 2.5): void {
    this.toastEl?.remove();
    const t = el(`<div class="toast">${escapeHtml(msg)}</div>`);
    this.root.appendChild(t);
    this.toastEl = t;
    setTimeout(() => {
      if (this.toastEl === t) {
        t.remove();
        this.toastEl = null;
      }
    }, seconds * 1000);
  }

  update(dt: number): void {
    if (this.lineupEl && (this.lineupTimer -= dt) <= 0) {
      const e = this.lineupEl;
      this.lineupEl = null;
      e.classList.add('out');
      setTimeout(() => e.remove(), 400);
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.hidden = true;
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Escape text for insertion into HTML. Use it for anything not written by us: team names, key labels
 * from the keyboard layout, messages, imported data. The UI is built from template strings, so this
 * is what keeps it safe from HTML injection.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Key codes as `<kbd>` labels on the player's own keyboard layout, joined with "/". */
export function keyHtml(codes: string[]): string {
  return codes.map((c) => `<kbd>${keyLabel(c)}</kbd>`).join('/');
}

/** Display name of a standard-layout controller button. */
export function padLabel(i: number): string {
  return PAD_BUTTON_LABELS[i] ?? `Button ${i}`;
}

const PAD_FIXED: Partial<Record<KeyAction, string>> = {
  up: 'L-Stick',
  down: 'L-Stick',
  left: 'L-Stick',
  right: 'L-Stick',
  pause: 'Menu',
  camera: 'View',
  reset: 'R-Stick',
};
/**
 * Touch controls (src/input/touch.ts): a joystick (pushed to the edge to sprint), three action buttons
 * labelled Shoot / Pass / Through when attacking (Tackle / Switch / Slide when defending) and a pause
 * button. Anything not listed here (skill moves, lob while attacking, ball reset, camera) has no touch
 * control, so hints and the tutorial must not mention it: see {@link controlAvailable}.
 */
const TOUCH_LABELS: Partial<Record<KeyAction, string>> = {
  up: 'Joystick',
  down: 'Joystick',
  left: 'Joystick',
  right: 'Joystick',
  sprint: 'Joystick to the edge',
  shoot: 'Shoot',
  pass: 'Pass',
  through: 'Through',
  tackle: 'Tackle',
  switch: 'Switch',
  pause: '❚❚',
};

/** Whether the player's control scheme has a control for an action (touch lacks a few). */
export function controlAvailable(s: Pick<Settings, 'controlScheme'>, a: KeyAction): boolean {
  return s.controlScheme !== 'touch' || a in TOUCH_LABELS;
}

/**
 * The button / key for an action in the player's chosen control scheme (for hints and the tutorial).
 * Check {@link controlAvailable} first: an action with no control returns an empty string.
 */
export function bindHtml(s: Settings, a: KeyAction): string {
  if (s.controlScheme === 'touch') {
    const label = TOUCH_LABELS[a];
    return label ? `<kbd>${label}</kbd>` : '';
  }
  if (s.controlScheme === 'controller') {
    const fixed = PAD_FIXED[a];
    if (fixed) return `<kbd>${fixed}</kbd>`;
    const i = s.padBindings[a as PadAction]?.[0];
    if (i !== undefined) return `<kbd>${padLabel(i)}</kbd>`;
  }
  return keyHtml(activeBindings(s)[a].slice(0, 1));
}

/**
 * Bind `code` to action `a` (main key, or alternative when `alt`). A key does one thing only: if
 * another action used it, that action takes over `a`'s previous main key instead (a swap), so no
 * action is ever left without a key. Returns a message describing any swap.
 */
export function applyBinding(bindings: Record<KeyAction, string[]>, a: KeyAction, code: string, alt: boolean): string | null {
  const previous = bindings[a][0];
  const others = bindingConflicts(bindings, code, a);
  if (bindings[a].includes(code)) return null;
  // An alternative key may not take another action's only key (there's no freed key to swap in).
  const stranded = others.find((o) => bindings[o].length === 1);
  if (alt && stranded) return `${keyLabel(code)} is the only key for ${KEY_ACTION_LABELS[stranded]} — change that first.`;
  if (alt) bindings[a] = [bindings[a][0], code].filter(Boolean) as string[];
  else bindings[a] = [code, ...bindings[a].slice(1).filter((c) => c !== code)];
  const moved: string[] = [];
  for (const o of others) {
    bindings[o] = bindings[o].filter((c) => c !== code);
    if (!bindings[o].length && previous && !alt) {
      bindings[o] = [previous];
      moved.push(`${KEY_ACTION_LABELS[o]} moved to ${keyLabel(previous)}`);
    } else if (!bindings[o].length) moved.push(`${KEY_ACTION_LABELS[o]} has no key now`);
    else moved.push(`${keyLabel(code)} removed from ${KEY_ACTION_LABELS[o]}`);
  }
  return moved.length ? `${keyLabel(code)} → ${KEY_ACTION_LABELS[a]}. ${moved.join('; ')}.` : null;
}

/** "12' Novak · 54' Rahman (o.g.)" per team, so a player can see how the result happened. */
function goalTimeline(goals: Array<{ team: 0 | 1; scorer: string; minute: number; ownGoal: boolean }>, teams: [TeamIdentity, TeamIdentity]): string {
  if (!goals.length) return '';
  const side = (t: 0 | 1) =>
    goals
      .filter((g) => g.team === t)
      .map((g) => `${g.minute}′ ${escapeHtml(g.scorer)}${g.ownGoal ? ' (o.g.)' : ''}`)
      .join(' · ') || '—';
  return `<div class="ft-goals" aria-label="Goals"><div><b>${escapeHtml(teams[0].short)}</b> ${side(0)}</div><div><b>${escapeHtml(teams[1].short)}</b> ${side(1)}</div></div>`;
}

/** One gentle suggestion for what to try next (never pushy, never a timer or streak). */
function nextStepHint(winner: 0 | 1 | null, difficulty?: Difficulty): string {
  const next: Partial<Record<Difficulty, string>> = { beginner: 'Easy', easy: 'Medium', medium: 'Hard' };
  const text =
    winner === 0 && difficulty && next[difficulty]
      ? `Well played! Ready for a bigger challenge? Try ${next[difficulty]} difficulty.`
      : winner === 1
        ? // Device-neutral on purpose: jockeying is a different button per control scheme (and absent on touch).
          'Tip: when defending, stay between the attacker and your goal, and tackle when the ball leaves their feet.'
        : '';
  return text ? `<p class="ft-hint">${text}</p>` : '';
}

/** Remap a controller action: a button does one thing, so the previous owner gets this action's old button. */
export function applyPadBinding(pad: Record<PadAction, number[]>, a: PadAction, btn: number): string | null {
  if (pad[a].includes(btn)) return null;
  const previous = pad[a][0];
  const owner = (Object.keys(pad) as PadAction[]).find((o) => o !== a && pad[o].includes(btn));
  pad[a] = [btn];
  if (!owner) return null;
  pad[owner] = previous !== undefined ? [previous] : [];
  return `${padLabel(btn)} → ${PAD_ACTION_LABELS[a]}. ${PAD_ACTION_LABELS[owner]} moved to ${previous !== undefined ? padLabel(previous) : 'nothing'}.`;
}

/** "Open source" link to the repository (empty until the repository URL is configured). */
/**
 * The game's logo from the brand definition: the words of the first line stacked, with the emphasised
 * "XI" beside them. The visible letters are decorative (`aria-hidden`); screen readers get the full
 * name once. Only the menu's copy is a heading, so the page never has two top-level headings.
 */
function logoHtml(menu: boolean): string {
  const [words, emphasis] = BRAND.logoLines;
  const tag = menu ? 'h1' : 'div';
  return `<div class="logo"><${tag} class="mark"${menu ? '' : ' role="img"'} aria-label="${escapeHtml(BRAND.name)}"><span class="l1" aria-hidden="true">${words
    .split(' ')
    .map((w) => `<span>${escapeHtml(w)}</span>`)
    .join(
      '',
    )}</span><span class="l2" aria-hidden="true">${escapeHtml(emphasis)}</span></${tag}><span class="tag">${escapeHtml(BRAND.tagline)}</span>${menu ? '<span class="beam"></span>' : ''}</div>`;
}

function sourceLink(prefix: string): string {
  return typeof __REPO_URL__ === 'string' && __REPO_URL__
    ? `${prefix}<a href="${__REPO_URL__}" target="_blank" rel="noopener noreferrer">Open source on GitHub</a>`
    : '';
}

const TOUCH_CAPABLE = () => typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches;

const BASE = import.meta.env?.BASE_URL ?? './';
function teamOf(code: string): TeamIdentity {
  return nationByCode(code) ?? NATIONS[0];
}
function flagImg(t: TeamIdentity, size = ''): string {
  return t.flag
    ? `<img class="flag ${size}" src="${BASE}${t.flag}" alt="${escapeHtml(t.name)} flag" loading="lazy" decoding="async">`
    : `<span class="flag ${size}" style="background:${t.primary}"></span>`;
}
let kitId = 0;
/** Small SVG shirt + shorts preview in the kit's colours and pattern (generic design). */
export function kitSvg(k: { shirt: string; secondary: string; shorts: string; socks: string; trim: string; pattern: string }): string {
  const id = `kit${kitId++}`;
  const pat: Record<string, string> = {
    stripes: `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${k.shirt}"/><rect width="4" height="8" fill="${k.secondary}"/></pattern>`,
    hoops: `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${k.shirt}"/><rect width="8" height="4" fill="${k.secondary}"/></pattern>`,
    checks: `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${k.shirt}"/><rect width="4" height="4" fill="${k.secondary}"/><rect x="4" y="4" width="4" height="4" fill="${k.secondary}"/></pattern>`,
    halves: `<linearGradient id="${id}" x1="0" x2="1"><stop offset="0.5" stop-color="${k.secondary}"/><stop offset="0.5" stop-color="${k.shirt}"/></linearGradient>`,
    sash: `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0.42" stop-color="${k.shirt}"/><stop offset="0.42" stop-color="${k.secondary}"/><stop offset="0.58" stop-color="${k.secondary}"/><stop offset="0.58" stop-color="${k.shirt}"/></linearGradient>`,
  };
  const body = pat[k.pattern] ? `url(#${id})` : k.shirt;
  const sleeve = k.pattern === 'sleeves' ? k.secondary : body;
  return `<svg class="kit" viewBox="0 0 64 72" aria-hidden="true"><defs>${pat[k.pattern] ?? ''}</defs>
    <path d="M14 10 L2 22 L10 30 L16 25 Z" fill="${sleeve}" stroke="rgba(0,0,0,.35)"/><path d="M50 10 L62 22 L54 30 L48 25 Z" fill="${sleeve}" stroke="rgba(0,0,0,.35)"/>
    <path d="M14 10 Q24 6 26 6 Q32 12 38 6 Q40 6 50 10 L48 48 L16 48 Z" fill="${body}" stroke="rgba(0,0,0,.35)"/>
    <path d="M26 6 Q32 12 38 6" fill="none" stroke="${k.trim}" stroke-width="2.5"/>
    <path d="M16 50 L48 50 L47 64 L34 64 L32 58 L30 64 L17 64 Z" fill="${k.shorts}" stroke="rgba(0,0,0,.35)"/>
    <rect x="18" y="66" width="10" height="5" rx="1" fill="${k.socks}"/><rect x="36" y="66" width="10" height="5" rx="1" fill="${k.socks}"/></svg>`;
}
