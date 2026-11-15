/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { AI_PROFILES, BALL, Difficulty, FORMATIONS, GameMode, MatchFormat, PITCHES, PLAYERS_PER_TEAM, Role, TeamId } from './config';
import { World, WorldEvents } from './world';
import { Anim, KickRequest, Player, PlayerCommand, emptyCommand } from './player';
import { TeamBrain } from './ai/teamBrain';
import { Situation } from './ai/situation';
import { RestartInfo, RestartType, TacticalContext } from './ai/tactics';
import { InputFrame, chargeToPower, humanCommand, humanSwitchPressed } from './human';
import { playerName } from './teams';
import { Emitter } from '../core/events';
import { Rng } from '../core/rng';
import { clamp, hyp } from '../core/math';
import {
  RULES,
  RulesProfile,
  RulesProfileName,
  Sanction,
  canScoreDirectly,
  foulSeverity,
  inOffsidePosition,
  offsideExemptRestart,
  offsideLine,
  rulesForFormat,
  sanctionFor,
} from './rules';
import { Officials } from './officials';
import { Celebration, CelebrationStyle, GESTURE_FOR, Gesture, chooseCelebration, dejectedGesture, teammateGesture } from './celebration';

/** Optional sim profiling (performance overlay / benchmark): accumulated AI decision time in ms. */
/**
 * Penalty-shootout tuning per difficulty (validated with src/dev/penaltySim.ts; see docs/gameplay/ai-and-difficulty.md).
 *  humanDive / aiDive — keeper dive speed & reach multipliers
 *  tellHonesty        — how often the AI shooter's run-up tell points the right way
 *  punishEarly        — chance the AI shooter switches side when the human keeper commits early
 *  aiRead             — chance the AI keeper reads the human's side
 *  humanAim / overhit — human shot scatter (m) and extra scatter when over-hit
 */
export const PEN_TUNING = {
  humanDive: { beginner: 1.55, easy: 1.45, medium: 1.2, hard: 1.0 },
  aiDive: { beginner: 1.0, easy: 1.08, medium: 1.15, hard: 1.16 },
  /** AI keeper reaction after the strike (s). */
  aiDelay: { beginner: 0.15, easy: 0.13, medium: 0.1, hard: 0.093 },
  tellHonesty: { beginner: 0.92, easy: 0.85, medium: 0.62, hard: 0.5 },
  punishEarly: { beginner: 0.1, easy: 0.2, medium: 0.4, hard: 0.6 },
  aiRead: { beginner: 0.2, easy: 0.3, medium: 0.45, hard: 0.48 },
  humanAim: { beginner: 0.04, easy: 0.06, medium: 0.16, hard: 0.24 },
  overhit: { beginner: 0.35, easy: 0.45, medium: 0.7, hard: 0.95 },
} as const;

export const SIM_PROFILE = { enabled: false, aiMs: 0 };

export type Phase = 'kickoff' | 'playing' | 'stoppage' | 'restart' | 'goal' | 'replay' | 'fullTime' | 'penReady' | 'penRunup' | 'penFlight' | 'penResult';

export interface MatchOptions {
  mode: GameMode;
  format: MatchFormat;
  difficulty: Difficulty;
  /** Match length in real seconds. */
  duration: number;
  seed?: number;
  /** Goal replays: off, only standout goals, or every goal. `true`/`false` map to 'best'/'off'. */
  replays?: boolean | ReplayMode;
  /** Automatically switch to the best-placed defender. */
  autoSwitch?: boolean;
  /** Both teams AI-controlled (attract mode / tests). */
  aiOnly?: boolean;
  teamNames?: [string, string];
  /** Rules profile; defaults to Standard for 11v11 and Arcade for 3v3 / 5v5 (see src/sim/rules.ts). */
  rules?: RulesProfileName;
}

/**
 * Where a restart is in its life cycle (Law 8 / 9). The ball is dead from 'outOfPlay' until the restart
 * is taken; only the taker may then play it, once, after the stage reaches 'ready'.
 */
export type RestartStage = 'live' | 'outOfPlay' | 'decision' | 'positioning' | 'ready' | 'none';

/** Players get this long to take position before a restart may be taken. */
export const RESTART_READY_TIME = 0.4;
/** How long an advantage has to materialise before the original foul is penalised (Law 5.3). */
export const ADVANTAGE_WINDOW = 2.5;
/**
 * Law 15.2 / 16.2 and the 2026/27 countdown protocol: the five-second countdown is only for a restart the
 * referee judges *deliberately* delayed. Here that means either:
 *  - time-wasting: the taker's team is level or ahead late in the match (75'+) and hasn't taken it after
 *    COUNTDOWN_TIME_WASTING seconds; or
 *  - an obvious stall: COUNTDOWN_OBVIOUS seconds without taking it, whatever the score.
 * Before that, the referee gives a hurry-up cue (allowed by the protocol), which also helps a newcomer
 * who simply doesn't know what to press. Normal restarts never get a countdown.
 */
export const HURRY_UP_AFTER = 5;
export const COUNTDOWN_TIME_WASTING = 6;
export const COUNTDOWN_OBVIOUS = 15;
export const COUNTDOWN_LENGTH = 5;

export type ReplayMode = 'off' | 'best' | 'all';

export interface TeamStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  passes: number;
  passesCompleted: number;
  tackles: number;
  saves: number;
  fouls: number;
  corners: number;
  possession: number;
}

const newStats = (): TeamStats => ({
  goals: 0,
  shots: 0,
  shotsOnTarget: 0,
  passes: 0,
  passesCompleted: 0,
  tackles: 0,
  saves: 0,
  fouls: 0,
  corners: 0,
  possession: 0,
});

export interface PenaltyKick {
  team: TeamId;
  scored: boolean;
  /** Stopped by the goalkeeper (rather than missing the target). */
  saved: boolean;
}

export interface MatchEvents extends WorldEvents {
  /** scorerId: who is credited (for an own goal, the defender); celebrantId: who leads the celebration. */
  goal: { team: TeamId; scorerId: number | null; celebrantId?: number | null; ownGoal: boolean; score: [number, number] };
  whistle: { kind: 'short' | 'long' | 'final' };
  phase: { phase: Phase; prev: Phase };
  banner: { text: string; sub?: string; kind: 'goal' | 'info' | 'big' };
  cut: Record<string, never>;
  /** The human-controlled player kicked the ball (emitted before control moves to a pass receiver). */
  humanKick: { playerId: number; kind: string };
  switched: { playerId: number };
  fullTime: { score: [number, number]; winner: TeamId | null };
  nearMiss: { team: TeamId };
  penalty: { team: TeamId; scored: boolean; kicks: PenaltyKick[] };
  card: { playerId: number; team: TeamId; card: 'yellow' | 'red' };
  offside: { playerId: number; team: TeamId };
  advantage: { team: TeamId; outcome: 'playing' | 'calledBack' | 'stands' };
  /** Plain-language description of every referee decision (HUD announcements, screen readers, tests). */
  decision: { text: string };
}

/** Pause after the ball goes out before the restart is set up. */
export const OUT_DELAY = 0.55;
/** Goal celebration length (skippable with any action after a short moment). */
export const GOAL_CELEBRATION = 2.2;
const CELEBRATION_SKIPPABLE_AFTER = 0.6;
/** Human restart takers who don't act get help from the AI after this long. */
const HUMAN_RESTART_TIMEOUT = 8;

/**
 * Owns the World and runs a game mode on top of it: rules (goals, out of play, fouls),
 * restarts, the match clock, statistics, AI brains and human control/switching.
 */
export class Match {
  readonly world: World;
  readonly events = new Emitter<MatchEvents>();
  readonly sit = new Situation();
  readonly brains: [TeamBrain, TeamBrain];
  readonly stats: [TeamStats, TeamStats] = [newStats(), newStats()];
  readonly score: [number, number] = [0, 0];
  readonly options: Required<MatchOptions>;

  phase: Phase = 'kickoff';
  phaseTime = 0;
  /** Elapsed match time in real seconds. */
  clock = 0;
  restart: RestartInfo | null = null;
  /** Human-controlled player (team 0), or null when AI-only. */
  humanId: number | null = null;
  /** Player leading the current celebration (never an own-goal scorer). */
  lastScorer: number | null = null;
  /** Player credited with the last goal (for an own goal, the defender who put it in). */
  lastGoalScorer: number | null = null;
  /**
   * Every goal of the match in order, for the full-time summary. `team` is the team credited with the goal;
   * `scorerId` is the player who put the ball in (for an own goal, a player of the other team).
   */
  readonly goalLog: Array<{ team: TeamId; scorerId: number | null; minute: number; ownGoal: boolean }> = [];
  lastGoalTeam: TeamId | null = null;
  /** Whether the last goal deserves an automatic replay under the current replay mode. */
  replayWorthy = false;
  readonly rules: RulesProfile;
  readonly officials: Officials;
  /** Cautions and sendings-off so far. */
  readonly cards = new Map<number, { yellow: number; red: boolean }>();
  /** The restart just taken, until a player other than the taker touches the ball (direct-goal rules). */
  lastRestart: RestartInfo | null = null;
  private advantage: { restart: RestartInfo; team: TeamId; t: number; sanction: Sanction; offenderId: number; text: string } | null = null;
  private pendingSanctions: Array<{ playerId: number; sanction: Sanction }> = [];
  /** Team whose players' offside positions were frozen at their latest touch, and who was offside then. */
  private offsideTeam: TeamId | null = null;
  readonly offsideCandidates = new Set<number>();
  /** The current goal celebration (chosen from match context). */
  celebration: Celebration | null = null;
  private lastCelebration: [CelebrationStyle | null, CelebrationStyle | null] = [null, null];
  private bufferedRestartKick: KickRequest | null = null;
  /** Seconds left on the referee's throw-in countdown (Standard rules), or null. */
  countdown: number | null = null;
  private hurryUpGiven = false;
  /** Defenders forming a wall at the current free kick. */
  private wallIds: number[] = [];

  // Penalty shootout state.
  penKicks: PenaltyKick[] = [];
  penShooterTeam: TeamId = 0;
  penAim = { z: 0, y: 1 };
  penPower = 0;
  private penPlan: { delay: number; z: number; height: number } | null = null;
  private penKickRequested = false;
  private penOutcome: 'goal' | 'saved' | 'missed' | null = null;
  private penEarlyDiveHandled = false;
  /** Result of the last penalty (for UI / diagnostics / simulations). */
  lastPenaltyOutcome: 'goal' | 'saved' | 'missed' | null = null;
  /** Side the AI shooter's run-up "tells" (−1 / 0 / 1); honest more often on easier difficulties. */
  private penTell = 0;

  private commands: PlayerCommand[] = [];
  private pendingRestart: RestartInfo | null = null;
  private pendingPassTeam: TeamId | null = null;
  private pendingPasser: number | null = null;
  private lastSwitchTime = 0;
  private stepCount = 0;
  private practiceOutTimer = 0;
  private winnerTeam: TeamId | null = null;

  constructor(opts: MatchOptions) {
    this.options = {
      seed: 1234,
      replays: true,
      autoSwitch: true,
      aiOnly: false,
      teamNames: ['Home', 'Away'],
      rules: rulesForFormat(opts.format),
      ...opts,
    };
    const o = this.options;
    if (!o.rules) o.rules = rulesForFormat(o.format);
    const pitchFormat: MatchFormat = o.mode === 'penalties' ? '11v11' : o.format;
    this.world = new World(PITCHES[pitchFormat], new Rng(o.seed));
    this.rules = RULES[o.rules];
    this.officials = new Officials(this.world.pitch.length, this.world.pitch.width, this.rules.assistants && o.mode === 'match');
    // Both teams use the same formation. (Previously, the home side — the player's — had 2-1-1 against
    // the opponents' 1-2-1 in 5v5, which lost 2–14 over 24 equal-skill AI matches: an unfair handicap.)
    const formations = FORMATIONS[o.format];
    const formation = formations[formations.length > 1 ? 1 : 0];
    this.brains = [new TeamBrain(0, AI_PROFILES[o.aiOnly ? o.difficulty : 'medium'], formation), new TeamBrain(1, AI_PROFILES[o.difficulty], formation)];
    this.createPlayers();
    this.wireEvents();
    if (!o.aiOnly) {
      const first = this.world.players.find((p) => p.team === 0 && !p.isGK);
      if (first) this.setHuman(first.id);
    }
    if (o.mode === 'penalties') this.setupPenalty();
    else if (o.mode === 'practice') this.setupPractice();
    else this.setupKickoff(0);
  }

  get pitch() {
    return this.world.pitch;
  }

  get human(): Player | null {
    return this.humanId === null ? null : this.world.players[this.humanId];
  }

  /** Displayed match minute (0..90). */
  get minute(): number {
    return Math.min(90, (this.clock / this.options.duration) * 90);
  }

  get winner(): TeamId | null {
    return this.winnerTeam;
  }

  /** Current restart stage (controls, AI, HUD and tests read this). */
  get restartStage(): RestartStage {
    switch (this.phase) {
      case 'playing':
        return 'live';
      case 'stoppage':
        return this.phaseTime < 0.25 ? 'outOfPlay' : 'decision';
      case 'restart':
      case 'kickoff':
        return this.phaseTime < RESTART_READY_TIME ? 'positioning' : 'ready';
      default:
        return 'none';
    }
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  private createPlayers(): void {
    const o = this.options;
    const roles: Record<TeamId, Role[]> = { 0: [], 1: [] };
    if (o.mode === 'practice') {
      roles[0] = ['MID', 'MID', 'FWD'];
      roles[1] = ['GK'];
    } else if (o.mode === 'penalties') {
      roles[0] = ['GK', 'FWD'];
      roles[1] = ['GK', 'FWD'];
    } else {
      const n = PLAYERS_PER_TEAM[o.format];
      for (const t of [0, 1] as TeamId[]) roles[t] = this.brains[t].formation.slots.slice(0, n).map((s) => s.role);
    }
    let id = 0;
    for (const t of [0, 1] as TeamId[]) {
      roles[t].forEach((role, i) => {
        const num = role === 'GK' ? 1 : i + (role === 'FWD' ? 8 : 2);
        const p = new Player(id++, t, role, num, playerName(t, i), i);
        this.world.players.push(p);
        this.commands.push(emptyCommand());
      });
    }
    // Practice partners use slots from the attacking formation.
    if (o.mode === 'practice') {
      this.brains[0].formation = {
        name: 'practice',
        slots: [
          { role: 'MID', fx: 0.1, fz: 0 },
          { role: 'MID', fx: 0.25, fz: -0.55 },
          { role: 'FWD', fx: 0.4, fz: 0.5 },
        ],
      };
      this.brains[1].formation = { name: 'gk', slots: [{ role: 'GK', fx: -0.95, fz: 0 }] };
    }
    if (o.mode === 'penalties') {
      const f = {
        name: 'pen',
        slots: [
          { role: 'GK' as Role, fx: -0.95, fz: 0 },
          { role: 'FWD' as Role, fx: 0, fz: 0 },
        ],
      };
      this.brains[0].formation = f;
      this.brains[1].formation = f;
    }
  }

  private wireEvents(): void {
    const w = this.world.events;
    const forward = <K extends keyof WorldEvents>(k: K) => w.on(k, (e) => this.events.emit(k, e as MatchEvents[K]));
    (['kick', 'touch', 'control', 'bounce', 'post', 'net', 'deflect', 'tackle', 'foul', 'save', 'skill'] as const).forEach(forward);

    w.on('kick', (e) => {
      const p = this.world.players[e.playerId];
      const s = this.stats[p.team];
      if (e.kind === 'shot' || e.kind === 'header' || e.kind === 'chip') {
        if (this.phase === 'playing' || this.phase === 'restart') {
          s.shots++;
          if (e.onTarget) s.shotsOnTarget++;
        }
        this.pendingPassTeam = null;
      } else if (e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob') {
        s.passes++;
        this.pendingPassTeam = p.team;
        this.pendingPasser = p.id;
      }
      // Restart taken.
      if ((this.phase === 'restart' || this.phase === 'kickoff') && this.restart && e.playerId === this.restart.takerId) {
        this.world.restrictTouchTo = null;
        // The ball is in play once kicked (or thrown) and clearly moves. The taker may not touch it again
        // until another player has (Laws 8, 13–17).
        this.lastRestart = this.restart;
        this.world.secondTouchBan = e.playerId;
        this.setPhase('playing');
        // Offside is judged when the ball is played — except directly from a goal kick, throw-in or corner.
        this.offsideCandidates.clear();
        this.offsideTeam = p.team;
        if (this.rules.offside && !offsideExemptRestart(this.restart.type)) this.snapshotOffside(p);
      }
      if (p.id === this.humanId) this.events.emit('humanKick', { playerId: p.id, kind: e.kind });
      // Auto-switch to the receiver of a human pass.
      if (p.id === this.humanId && this.world.lastKick?.receiver != null) {
        const r = this.world.players[this.world.lastKick.receiver];
        if (r && r.team === p.team && !r.isGK) this.setHuman(r.id);
      }
      if (this.phase === 'penRunup') {
        // The kick is taken: the keeper may now touch the ball. (restrictTouchTo stayed on the shooter
        // for the whole flight in earlier versions, so keepers could never save a penalty.)
        this.world.restrictTouchTo = null;
        this.setPhase('penFlight');
        this.penKeeperReact();
      }
    });
    w.on('ballTouch', (e) => this.onBallTouch(e.playerId));
    w.on('control', (e) => {
      const p = this.world.players[e.playerId];
      if (this.pendingPassTeam !== null) {
        if (p.team === this.pendingPassTeam && p.id !== this.pendingPasser) this.stats[p.team].passesCompleted++;
        this.pendingPassTeam = null;
      }
      // Human takes over whichever teammate wins the ball.
      if (!this.options.aiOnly && p.team === 0 && !p.isGK && this.phase === 'playing') this.setHuman(p.id);
    });
    w.on('tackle', (e) => {
      if (e.won) this.stats[this.world.players[e.tacklerId].team].tackles++;
    });
    w.on('save', (e) => {
      const g = this.world.players[e.keeperId];
      if (this.phase === 'playing') this.stats[g.team].saves++;
      const lk = this.world.lastKick;
      if (this.phase === 'playing' && lk && lk.team !== g.team && (lk.kind === 'shot' || lk.kind === 'header' || lk.kind === 'chip'))
        this.react(lk.playerId, Gesture.HandsOnHead, 1.4);
    });
    w.on('foul', (e) => {
      if (this.phase !== 'playing') return;
      const w = this.world;
      const off = w.players[e.offenderId];
      const victimTeam: TeamId = off.team === 0 ? 1 : 0;
      this.stats[off.team].fouls++;
      const pen = w.inPenaltyArea(e.x, e.z, off.team);
      const type: RestartType = pen ? 'penalty' : 'freeKick';
      const dir = w.attackDir(victimTeam);
      const x = pen ? dir * (this.pitch.length / 2 - this.pitch.penaltySpot) : clamp(e.x, -this.pitch.length / 2 + 1, this.pitch.length / 2 - 1);
      const z = pen ? 0 : clamp(e.z, -this.pitch.width / 2 + 1, this.pitch.width / 2 - 1);
      // Law 12: the referee judges the challenge from its facts — never at random.
      const severity = foulSeverity({ slide: e.slide, fromBehind: e.fromBehind, tacklerSpeed: e.tacklerSpeed, promisingAttack: false });
      let sanction = sanctionFor(severity, this.rules, this.cards.get(off.id)?.yellow ?? 0);
      // There is no substitute keeper, so a keeper is never sent off (documented simplification).
      if (off.isGK && sanction === 'red') sanction = (this.cards.get(off.id)?.yellow ?? 0) >= 1 ? 'none' : 'yellow';
      const restart: RestartInfo = { type, team: victimTeam, x, z, takerId: -1 };
      const text = `${pen ? 'Penalty' : 'Free kick'} to ${this.teamName(victimTeam)} — foul by ${off.name}`;
      // Law 5.3: play on when stopping play would punish the fouled team. Not for penalty-area fouls here.
      if (!pen && this.rules.advantage && this.advantageAvailable(victimTeam)) {
        this.advantage = { restart, team: victimTeam, t: 0, sanction, offenderId: off.id, text };
        this.officials.refSignal('advantage', dir, 0, 1.8);
        this.events.emit('advantage', { team: victimTeam, outcome: 'playing' });
        this.events.emit('banner', { text: 'ADVANTAGE', sub: `Foul by ${off.name} — play on`, kind: 'info' });
        this.events.emit('decision', { text: `Advantage to ${this.teamName(victimTeam)} after a foul by ${off.name}` });
        return;
      }
      this.callFoul(restart, off.id, sanction, text);
    });
  }

  teamName(t: TeamId): string {
    return this.options.teamNames[t];
  }

  /** The fouled team keeps the ball in a promising position: a team-mate is nearest the ball, past halfway-ish. */
  private advantageAvailable(team: TeamId): boolean {
    const w = this.world;
    const ball = w.ball;
    let best: Player | null = null;
    let bd = Infinity;
    for (const p of w.players) {
      if (p.sentOff || p.anim === Anim.Fallen || p.anim === Anim.Stumble) continue;
      const d = hyp(p.pos.x - ball.pos.x, p.pos.z - ball.pos.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return !!best && best.team === team && bd < 3 && ball.pos.x * w.attackDir(team) > -this.pitch.length * 0.1;
  }

  private callFoul(restart: RestartInfo, offenderId: number, sanction: Sanction, text: string): void {
    const pen = restart.type === 'penalty';
    this.stopPlay(restart, pen ? 'PENALTY!' : 'FOUL', pen ? 'big' : 'info', text);
    if (sanction !== 'none') this.applySanction(offenderId, sanction);
  }

  /** Show a card (Law 12.3 / 12.4). A second caution is a sending-off. */
  private applySanction(playerId: number, sanction: Sanction): void {
    if (sanction === 'none') return;
    const p = this.world.players[playerId];
    if (p.sentOff) return;
    const rec = this.cards.get(p.id) ?? { yellow: 0, red: false };
    this.cards.set(p.id, rec);
    if (sanction === 'yellow') {
      rec.yellow++;
      this.officials.refSignal('yellow', 0, 0, 1.8, true);
      this.events.emit('card', { playerId: p.id, team: p.team, card: 'yellow' });
      this.events.emit('banner', { text: 'YELLOW CARD', sub: `${p.name} (#${p.number}), ${this.teamName(p.team)}`, kind: 'info' });
      this.events.emit('decision', { text: `Yellow card for ${p.name}, ${this.teamName(p.team)}` });
      if (rec.yellow < 2) return;
    }
    rec.red = true;
    if (sanction === 'yellow') this.officials.refSignal('red', 0, 0, 1.8, true);
    else this.officials.refSignal('red', 0, 0, 2, true);
    this.events.emit('card', { playerId: p.id, team: p.team, card: 'red' });
    this.events.emit('banner', { text: 'RED CARD', sub: `${p.name} (#${p.number}) is sent off`, kind: 'big' });
    this.events.emit('decision', { text: `Red card: ${p.name}, ${this.teamName(p.team)}, is sent off` });
    this.sendOff(p);
  }

  /** The player leaves the pitch for the rest of the match; the team plays on with one fewer. */
  private sendOff(p: Player): void {
    const w = this.world;
    p.sentOff = true;
    p.humanControlled = false;
    p.place((p.team === 0 ? -1 : 1) * (3 + p.index * 0.8), -(this.pitch.width / 2 + 4), Math.PI / 2);
    p.vel.set(0, 0);
    this.brains[p.team].removePlayer(p.id);
    this.commands[p.id] = emptyCommand();
    if (w.secondTouchBan === p.id) w.secondTouchBan = null;
    if (this.humanId === p.id) {
      const next = w.teamPlayers(p.team).find((q) => !q.isGK);
      this.setHuman(next ? next.id : null);
    }
  }

  /** Every ball contact during live play: second-touch and offside offences (Laws 13–17, 11). */
  private onBallTouch(id: number): void {
    if (this.phase !== 'playing') return;
    const w = this.world;
    const p = w.players[id];
    if (w.secondTouchBan !== null) {
      if (w.secondTouchBan === id) {
        this.secondTouchOffence(p);
        return;
      }
      w.secondTouchBan = null;
    }
    if (this.lastRestart && this.lastRestart.takerId !== id) this.lastRestart = null;
    if (!this.rules.offside) return;
    // Offence: a player who was in an offside position when a team-mate last played the ball becomes
    // involved by playing it. A touch by an opponent resets everything (Law 11.2, simplified: any touch).
    if (this.offsideTeam === p.team && this.offsideCandidates.has(id)) {
      this.offsideOffence(p);
      return;
    }
    this.snapshotOffside(p);
  }

  /** Freeze who is in an offside position at the moment `toucher` plays the ball. */
  private snapshotOffside(toucher: Player): void {
    const w = this.world;
    const dir = w.attackDir(toucher.team);
    this.offsideTeam = toucher.team;
    this.offsideCandidates.clear();
    for (const q of w.players) {
      if (q.team !== toucher.team || q.id === toucher.id || q.sentOff) continue;
      if (inOffsidePosition(q, w.players, w.ball.pos.x, dir)) this.offsideCandidates.add(q.id);
    }
  }

  private offsideOffence(p: Player): void {
    const def: TeamId = p.team === 0 ? 1 : 0;
    this.events.emit('offside', { playerId: p.id, team: p.team });
    this.officials.flag('offside', p.pos.x, p.pos.x, p.pos.z, 2.2);
    this.stopPlay(
      { type: 'freeKick', team: def, x: this.clampX(p.pos.x), z: this.clampZ(p.pos.z), takerId: -1, indirect: true },
      'OFFSIDE',
      'info',
      `${p.name} was offside — indirect free kick to ${this.teamName(def)}`,
    );
  }

  private secondTouchOffence(p: Player): void {
    const opp: TeamId = p.team === 0 ? 1 : 0;
    this.world.secondTouchBan = null;
    this.stopPlay(
      { type: 'freeKick', team: opp, x: this.clampX(p.pos.x), z: this.clampZ(p.pos.z), takerId: -1, indirect: true },
      'SECOND TOUCH',
      'info',
      `${p.name} touched the restart twice — indirect free kick to ${this.teamName(opp)}`,
    );
  }

  private clampX(x: number): number {
    return clamp(x, -this.pitch.length / 2 + 1, this.pitch.length / 2 - 1);
  }

  private clampZ(z: number): number {
    return clamp(z, -this.pitch.width / 2 + 1, this.pitch.width / 2 - 1);
  }

  private setPhase(phase: Phase): void {
    const prev = this.phase;
    this.bufferedRestartKick = null;
    this.countdown = null;
    this.hurryUpGiven = false;
    if (phase !== 'restart') this.wallIds = [];
    this.phase = phase;
    this.phaseTime = 0;
    this.events.emit('phase', { phase, prev });
  }

  setHuman(id: number | null): void {
    if (this.humanId !== null) this.world.players[this.humanId].humanControlled = false;
    this.humanId = id;
    if (id !== null) {
      this.world.players[id].humanControlled = true;
      this.events.emit('switched', { playerId: id });
    }
    this.lastSwitchTime = this.world.time;
  }

  private kickoffPositions(kicking: TeamId): void {
    const w = this.world;
    const L2 = this.pitch.length / 2,
      W2 = this.pitch.width / 2;
    const R = this.pitch.centerCircleRadius;
    for (const t of [0, 1] as TeamId[]) {
      const dir = w.attackDir(t);
      const slots = this.brains[t].formation.slots;
      for (const p of w.teamPlayers(t)) {
        const s = slots[p.index] ?? slots[0];
        let x = clamp(s.fx, -0.95, -0.1) * L2 * dir;
        let z = s.fz * W2 * 0.7;
        if (t !== kicking) {
          const d = hyp(x, z);
          if (d < R + 1) {
            const k = (R + 1) / Math.max(d, 0.01);
            x *= k;
            z *= k;
            if (Math.abs(x) < 1) x = -dir * (R + 1);
          }
        }
        p.place(x, z, dir > 0 ? 0 : Math.PI);
      }
    }
  }

  setupKickoff(kicking: TeamId): void {
    const w = this.world;
    w.ball.reset(0, 0);
    w.clearPossession();
    w.possessionTeam = kicking;
    w.lastTouchTeam = null;
    this.kickoffPositions(kicking);
    const dir = w.attackDir(kicking);
    const team = w.teamPlayers(kicking).filter((p) => !p.isGK);
    const taker = team.slice().sort((a, b) => hyp(a.pos.x, a.pos.z) - hyp(b.pos.x, b.pos.z))[0];
    taker.place(-dir * 0.5, 0, dir > 0 ? 0 : Math.PI);
    const mate = team.find((p) => p.id !== taker.id);
    if (mate) mate.place(-dir * 4, mate.pos.z > 0 ? 6 : -6, dir > 0 ? 0 : Math.PI);
    for (const p of w.players) p.mood = 0;
    this.restart = { type: 'kickoff', team: kicking, x: 0, z: 0, takerId: taker.id };
    w.restrictTouchTo = taker.id;
    if (kicking === 0 && !this.options.aiOnly) this.setHuman(taker.id);
    this.brains[0].resetMemory();
    this.brains[1].resetMemory();
    this.lastRestart = null;
    w.secondTouchBan = null;
    this.setPhase('kickoff');
    this.events.emit('cut', {});
  }

  private setupPractice(): void {
    const w = this.world;
    const L2 = this.pitch.length / 2;
    w.players.forEach((p) => {
      if (p.isGK) p.place(L2 - 1, 0, Math.PI);
      else p.place(-L2 * 0.1 + p.index * 4, (p.index - 1) * 7, 0);
    });
    const h = this.human!;
    w.ball.reset(h.pos.x + 1, h.pos.z);
    w.possessionTeam = 0;
    this.setPhase('playing');
    this.events.emit('cut', {});
  }

  /** Practice: bring the ball back to the controlled player. */
  practiceReset(): void {
    if (this.options.mode !== 'practice') return;
    const h = this.human;
    if (!h) return;
    const w = this.world;
    w.ball.reset(h.footX(0.9), h.footZ(0.9));
    w.clearPossession();
    // Goals and stoppages freeze the ball (restrictTouchTo = -1) until a restart is taken. Practice has
    // no restarts, so the reset must lift the freeze — otherwise, after any goal in practice or the
    // tutorial, the ball sat at the player's feet but could never be played again (a former soft-lock).
    w.restrictTouchTo = null;
    this.practiceOutTimer = 0;
    if (this.phase !== 'playing') this.setPhase('playing');
  }

  // ---------------------------------------------------------------------------
  // Main step
  // ---------------------------------------------------------------------------

  step(dt: number, input: InputFrame | null): void {
    if (this.phase === 'replay') return;
    const w = this.world;
    this.phaseTime += dt;
    this.stepCount++;

    for (const c of this.commands) {
      c.move.set(0, 0);
      c.sprint = false;
      c.face?.set(0, 0);
      c.kick = null;
      c.tackle = null;
      c.skill = null;
      c.dive = null;
    }

    if (this.stepCount % 2 === 1) this.sit.update(w);

    if (this.options.mode === 'penalties') {
      this.stepPenalties(dt, input);
      return;
    }

    const ctxPhase: TacticalContext['phase'] =
      this.phase === 'playing'
        ? 'play'
        : this.phase === 'restart'
          ? 'restart'
          : this.phase === 'kickoff'
            ? 'kickoff'
            : this.phase === 'stoppage'
              ? 'restart'
              : 'idle';
    const restartCtx = this.phase === 'stoppage' ? this.pendingRestart : this.restart;
    // Human restart takers who stall get help from the AI after a while.
    // Arcade: a human taker who stalls gets help from the AI. Standard: a throw-in is instead subject to the
    // referee's five-second countdown (Law 15.2), handled in applyLaws.
    const countdownApplies = this.rules.name === 'standard' && this.restart?.type === 'throwIn';
    const humanStalled =
      (this.phase === 'restart' || this.phase === 'kickoff') && this.phaseTime > HUMAN_RESTART_TIMEOUT && !(countdownApplies && this.phase === 'restart');
    const humanForAI = humanStalled ? null : this.humanId;
    const practice = this.options.mode === 'practice';
    const tAi = SIM_PROFILE.enabled ? performance.now() : 0;
    for (const t of [0, 1] as TeamId[]) {
      const ctx: TacticalContext = { phase: ctxPhase, restart: restartCtx, humanId: humanForAI, practice };
      this.brains[t].think(w, this.sit, ctx, dt, this.commands);
    }
    if (SIM_PROFILE.enabled) SIM_PROFILE.aiMs += performance.now() - tAi;

    if (this.phase === 'goal' || this.phase === 'fullTime') this.celebrationCommands();
    // Any action skips the celebration.
    if (this.phase === 'goal' && input && this.phaseTime > CELEBRATION_SKIPPABLE_AFTER && anyAction(input)) {
      this.finishCelebration();
      return;
    }

    // Human control.
    const h = this.human;
    if (h && input && !humanStalled) {
      const canAct = this.phase === 'playing' || this.phase === 'restart' || this.phase === 'kickoff';
      if (canAct) {
        humanCommand(w, h, input, this.commands[h.id]);
        if (this.phase !== 'playing' && this.restart?.takerId !== h.id) {
          this.commands[h.id].kick = null;
        }
        if (this.phase === 'kickoff' && this.restart?.takerId === h.id) {
          // Kick-off taker can't wander off: only passes are allowed.
          this.commands[h.id].move.set(0, 0);
          if (this.commands[h.id].kick?.kind === 'shot') this.commands[h.id].kick = null;
        }
        const defending = !!w.controller && w.controller.team !== h.team;
        if (humanSwitchPressed(input, defending) && this.phase === 'playing') this.manualSwitch(input);
        this.receiveAssist(h, input);
      }
    }
    if (this.phase === 'playing' && !this.options.aiOnly) this.keepHumanOnCarrier();
    if (this.phase === 'playing' && !this.options.aiOnly && this.options.autoSwitch) this.autoSwitch();
    if ((this.phase === 'restart' || this.phase === 'kickoff') && this.restart) this.holdRestart(this.restart, input);
    for (const p of w.players) {
      if (!p.sentOff) continue;
      const c = this.commands[p.id];
      c.move.set(0, 0);
      c.kick = null;
      c.tackle = null;
      c.sprint = false;
    }
    for (const p of w.players) {
      if (p.gestureTime > 0) {
        p.gestureTime -= dt;
        if (p.gestureTime <= 0) {
          p.gestureTime = 0;
          p.gesture = Gesture.None;
        }
      }
    }

    w.step(dt, this.commands);
    this.applyLaws(dt);
    if (this.options.mode === 'match') this.updateOfficials(dt);
  }

  /**
   * While a restart is pending (Laws 8, 13–17): the taker can't run with the ball — a human taker turns to
   * aim instead — and may only play it once the restart is ready; opponents keep their distance. This is
   * what stops a player carrying a throw-in (or dribbling a corner) around the pitch.
   */
  private holdRestart(r: RestartInfo, input: InputFrame | null): void {
    const w = this.world;
    const taker = w.players[r.takerId];
    if (!taker) return;
    const cmd = this.commands[taker.id];
    if (taker.humanControlled && input) {
      const mx = cmd.move.x,
        mz = cmd.move.z;
      if (mx * mx + mz * mz > 0.04) cmd.face?.set(mx, mz);
    }
    cmd.move.set(0, 0);
    cmd.sprint = false;
    cmd.skill = null;
    cmd.tackle = null;
    // A kick requested while players are still taking position is remembered and taken as soon as the
    // restart is ready, so an early press is never lost.
    if (this.restartStage !== 'ready') {
      if (cmd.kick && taker.humanControlled) this.bufferedRestartKick = cmd.kick;
      cmd.kick = null;
    } else if (!cmd.kick && this.bufferedRestartKick) {
      cmd.kick = this.bufferedRestartKick;
    }
    if (cmd.kick) this.bufferedRestartKick = null;
    if (cmd.kick && r.type === 'throwIn' && cmd.kick.kind !== 'pass' && cmd.kick.kind !== 'through' && cmd.kick.kind !== 'lob') {
      // A throw-in is thrown, two-handed from overhead (Law 15): shots become a long throw.
      cmd.kick = { ...cmd.kick, kind: 'lob', power: Math.min(cmd.kick.power, 0.7), height: undefined, curl: 0 };
    }
    this.enforceRestartDistances(r);
    for (const id of this.wallIds) {
      const c = this.commands[id];
      c.move.set(0, 0);
      c.sprint = false;
      c.face?.set(r.x - w.players[id].pos.x, r.z - w.players[id].pos.z);
    }
  }

  /** Opponents keep the Law distance from a restart; goal kicks clear the area; kick-offs keep halves. */
  private enforceRestartDistances(r: RestartInfo): void {
    const w = this.world;
    const L2 = this.pitch.length / 2;
    const minD = r.type === 'throwIn' ? this.rules.throwInDistance : r.type === 'penalty' || r.type === 'kickoff' ? 0 : this.rules.restartDistance;
    const dir = w.attackDir(r.team);
    for (const p of w.players) {
      if (p.sentOff) continue;
      if (r.type === 'kickoff') {
        // Law 8: everyone in their own half; opponents outside the centre circle.
        const d = w.attackDir(p.team);
        if (p.id !== r.takerId && p.pos.x * d > -0.3) p.pos.x = -d * 0.3;
        if (p.team !== r.team) {
          const rr = hyp(p.pos.x, p.pos.z);
          const R = this.pitch.centerCircleRadius + 0.3;
          if (rr < R) {
            const k = R / Math.max(rr, 0.01);
            p.pos.set(rr > 0.01 ? p.pos.x * k : -d * R, rr > 0.01 ? p.pos.z * k : 0);
          }
        }
        continue;
      }
      if (p.team === r.team) continue;
      if (minD > 0) {
        const dx = p.pos.x - r.x,
          dz = p.pos.z - r.z;
        const d = hyp(dx, dz);
        if (d < minD) {
          const nx = d > 0.01 ? dx / d : dir,
            nz = d > 0.01 ? dz / d : 0;
          p.pos.set(r.x + nx * minD, r.z + nz * minD);
        }
      }
      if (r.type === 'goalKick' && this.rules.goalKickClearsArea && w.inPenaltyArea(p.pos.x, p.pos.z, r.team)) {
        p.pos.x = -dir * (L2 - this.pitch.penaltyAreaDepth - 0.5);
      }
    }
  }

  /** Would a referee see this restart as deliberately delayed? (See COUNTDOWN_* above.) */
  private deliberateDelay(): boolean {
    const r = this.restart;
    if (!r) return false;
    const other: TeamId = r.team === 0 ? 1 : 0;
    const timeWasting = this.minute >= 75 && this.score[r.team] >= this.score[other] && this.phaseTime > COUNTDOWN_TIME_WASTING;
    return timeWasting || this.phaseTime > COUNTDOWN_OBVIOUS;
  }

  /**
   * A defensive wall for direct free kicks within shooting range (Law 13: 9.15 m from the ball). Two or
   * three defenders stand in the line between the ball and the middle of the goal.
   */
  private formWall(r: RestartInfo): void {
    this.wallIds = [];
    if (r.type !== 'freeKick' || r.indirect) return;
    const w = this.world;
    const dir = w.attackDir(r.team);
    const goalX = (dir * this.pitch.length) / 2;
    const dist = hyp(goalX - r.x, r.z);
    if (dist > 30) return;
    const n = this.options.format === '3v3' ? 1 : dist < 22 ? 3 : 2;
    const d = this.rules.restartDistance;
    const ux = (goalX - r.x) / dist,
      uz = -r.z / dist;
    const defenders = w.players
      .filter((p) => p.team !== r.team && !p.isGK && !p.sentOff)
      .sort((a, b) => hyp(a.pos.x - r.x, a.pos.z - r.z) - hyp(b.pos.x - r.x, b.pos.z - r.z));
    for (let i = 0; i < Math.min(n, defenders.length); i++) {
      const off = (i - (n - 1) / 2) * 0.75;
      const p = defenders[i];
      p.place(r.x + ux * d - uz * off, r.z + uz * d + ux * off, Math.atan2(-uz, -ux));
      this.wallIds.push(p.id);
    }
  }

  private updateOfficials(dt: number): void {
    const w = this.world;
    // Law 13: the referee keeps an arm raised for an indirect free kick until another player touches the
    // ball (or it goes out of play).
    const ifk =
      (this.phase === 'stoppage' && this.pendingRestart?.indirect) ||
      (this.phase === 'restart' && this.restart?.indirect) ||
      (this.phase === 'playing' && this.lastRestart?.indirect);
    const ref = this.officials.referee;
    if (ifk && (ref.signal === 'none' || ref.signal === 'indirect')) this.officials.refSignal('indirect', 0, 0, 0.3);
    const plusTeam: TeamId = w.attackDir(0) > 0 ? 0 : 1;
    const minusTeam: TeamId = plusTeam === 0 ? 1 : 0;
    this.officials.update(dt, {
      ballX: w.ball.pos.x,
      ballZ: w.ball.pos.z,
      pitchLength: this.pitch.length,
      pitchWidth: this.pitch.width,
      offsideLinePlusX: offsideLine(w.players, plusTeam, 1),
      offsideLineMinusX: -offsideLine(w.players, minusTeam, -1),
      live: this.phase === 'playing',
    });
  }

  /** Short, respectful reactions: hands on head after a near miss or a save. */
  private react(playerId: number, gesture: Gesture, seconds: number): void {
    const p = this.world.players[playerId];
    if (!p || p.mood !== 0) return;
    p.gesture = gesture;
    p.gestureTime = seconds;
  }

  private celebrationCommands(): void {
    const w = this.world;
    const scorer = this.lastScorer !== null ? w.players[this.lastScorer] : null;
    for (const p of w.players) {
      const c = this.commands[p.id];
      c.kick = null;
      c.tackle = null;
      if (this.phase === 'fullTime') {
        c.move.set(0, 0);
        continue;
      }
      if (p.mood === 1 && scorer) {
        const style = this.celebration?.style ?? 'cornerRun';
        if (p.id === scorer.id) {
          // Corner runs head for the flag; the others take a few steps towards the crowd and stop to
          // celebrate on the spot (arms up, fist pump, "yes"); a restrained scorer jogs back.
          const L2 = this.pitch.length / 2,
            W2 = this.pitch.width / 2;
          let tx = Math.sign(scorer.pos.x || 1) * (L2 - 2),
            tz = Math.sign(scorer.pos.z || 1) * (W2 - 1);
          let runFor = 2.4;
          if (style === 'restrained') {
            tx = 0;
            tz = scorer.pos.z * 0.5;
            runFor = 99;
          } else if (style !== 'cornerRun') runFor = style === 'huddle' ? 0.3 : 0.9;
          const dx = tx - p.pos.x,
            dz = tz - p.pos.z;
          const d = hyp(dx, dz);
          if (d > 1.5 && this.phaseTime < runFor) {
            const pace = style === 'restrained' ? 0.45 : 1;
            c.move.set((dx / d) * pace, (dz / d) * pace);
            c.sprint = style === 'cornerRun';
          } else c.move.set(0, 0);
        } else {
          // Team-mates: everyone joins a huddle; otherwise the nearest few join and the rest applaud.
          const dx = scorer.pos.x - p.pos.x,
            dz = scorer.pos.z - p.pos.z;
          const d = hyp(dx, dz);
          const joins = !p.isGK && (style === 'huddle' || d < 18);
          if (joins && d > 2.2) c.move.set(dx / d, dz / d);
          else c.move.set(0, 0);
          c.sprint = joins && d > 6;
        }
      } else if (p.mood === 2) {
        c.move.scale(0.2);
        c.sprint = false;
      }
    }
  }

  /**
   * Pass-receive assistance: the intended receiver of a pass runs onto the ball automatically
   * for a moment after the pass (while the player releases the stick), and keeps a gentle pull
   * towards the ball afterwards unless the player steers clearly elsewhere.
   */
  private receiveAssist(h: Player, input: InputFrame): void {
    const w = this.world;
    const lk = w.lastKick;
    if (!lk || lk.receiver !== h.id || !this.sit.loose || w.time - lk.time > 3 || lk.team !== h.team) return;
    const cmd = this.commands[h.id];
    const ix = this.sit.interceptX[h.id],
      iz = this.sit.interceptZ[h.id];
    const dx = ix - h.pos.x,
      dz = iz - h.pos.z;
    const d = hyp(dx, dz);
    if (d < 0.3) return;
    const tx = dx / d,
      tz = dz / d;
    const early = w.time - lk.time < 0.45;
    const ml = hyp(input.move.x, input.move.z);
    const agree = ml > 0 ? (input.move.x * tx + input.move.z * tz) / ml : 1;
    if (early || ml < 0.25 || (d < 3 && agree > -0.3)) {
      // Run onto the ball.
      cmd.move.set(tx * Math.min(1, d / 1.2 + 0.3), tz * Math.min(1, d / 1.2 + 0.3)).clampLength(1);
      cmd.sprint = cmd.sprint || d > 4;
    } else if (agree > -0.2) {
      cmd.move.set(input.move.x * 0.6 + tx * 0.5, input.move.z * 0.6 + tz * 0.5).clampLength(1);
    }
  }

  private manualSwitch(input: InputFrame): void {
    const w = this.world;
    // While our team has the ball, the controlled player *is* the ball carrier (see keepHumanOnCarrier),
    // so there is nobody useful to switch to. Switching away used to hand the ball to an AI team-mate,
    // leaving the player watching someone else keep it, with no hint about what had happened (one cause of
    // a stuck tutorial). A keeper holding the ball doesn't count: the human never controls keepers.
    const ctrl = w.controller;
    if (ctrl && ctrl.team === 0 && !ctrl.isGK) return;
    const cur = this.human;
    const ball = w.ball;
    let best: Player | null = null;
    let bestScore = Infinity;
    const ml = hyp(input.move.x, input.move.z);
    for (const p of w.players) {
      if (p.team !== 0 || p.isGK || p.sentOff || p.id === this.humanId) continue;
      let s = this.sit.interceptTime[p.id];
      if (!Number.isFinite(s)) s = hyp(p.pos.x - ball.pos.x, p.pos.z - ball.pos.z) / 7;
      if (ml > 0.3 && cur) {
        const dx = p.pos.x - cur.pos.x,
          dz = p.pos.z - cur.pos.z;
        const d = hyp(dx, dz) || 1;
        const cos = (dx * input.move.x + dz * input.move.z) / (d * ml);
        s -= cos * 1.2;
      }
      if (s < bestScore) {
        bestScore = s;
        best = p;
      }
    }
    if (best) this.setHuman(best.id);
  }

  /**
   * Invariant: when an outfield player of the human's team controls the ball in open play, the human
   * controls that player. The 'control' event normally does this as possession changes; this check also
   * covers any path that bypasses it (possession gained during a phase change, a switch at the wrong
   * moment), so the player can never be left controlling someone without the ball while an AI team-mate
   * keeps it.
   */
  private keepHumanOnCarrier(): void {
    const ctrl = this.world.controller;
    if (ctrl && ctrl.team === 0 && !ctrl.isGK && !ctrl.sentOff && ctrl.id !== this.humanId) this.setHuman(ctrl.id);
  }

  private autoSwitch(): void {
    const w = this.world;
    const h = this.human;
    if (!h || w.time - this.lastSwitchTime < 1.2) return;
    const ctrl = w.controller;
    if (ctrl && ctrl.team === 0) return;
    let best: Player | null = null;
    let bt = Infinity;
    for (const p of w.players) {
      if (p.team !== 0 || p.isGK || p.sentOff) continue;
      const t = this.sit.interceptTime[p.id];
      if (t < bt) {
        bt = t;
        best = p;
      }
    }
    const ht = this.sit.interceptTime[h.id];
    if (best && best.id !== h.id && bt + 1.4 < ht && h.intent < 0.2) this.setHuman(best.id);
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------

  /** Laws 9, 10 and the referee's running decisions: goals, ball out of play, advantage, full time. */
  private applyLaws(dt: number): void {
    const w = this.world;
    const ball = w.ball;
    const L2 = this.pitch.length / 2,
      W2 = this.pitch.width / 2;
    const r = BALL.radius;
    const practice = this.options.mode === 'practice';

    if (this.phase === 'playing') {
      if (!practice) {
        this.clock += dt;
        if (w.possessionTeam !== null) this.stats[w.possessionTeam].possession += dt;
      }
      // Goal?
      const gw = this.pitch.goalWidth / 2;
      if (Math.abs(ball.pos.x) > L2 + r && Math.abs(ball.pos.z) < gw && ball.pos.y < this.pitch.goalHeight) {
        if (!canScoreDirectly(this.lastRestart)) {
          // Laws 13.2 / 15.1: no goal directly from a throw-in or an indirect free kick. Into the
          // opponents' goal → goal kick; into the thrower's own goal → corner (ballOut decides from the
          // last touch, which is still the restart taker's team).
          this.events.emit('decision', {
            text: `No goal: a goal can't be scored directly from ${this.lastRestart!.type === 'throwIn' ? 'a throw-in' : 'an indirect free kick'}`,
          });
          this.ballOut(false);
          return;
        }
        const team: TeamId = ball.pos.x > 0 ? (w.attackDir(0) > 0 ? 0 : 1) : w.attackDir(0) > 0 ? 1 : 0;
        this.onGoal(team);
        return;
      }
      // Advantage: if the fouled team loses the ball within the window, go back to the original foul;
      // otherwise the advantage stands and any card is shown at the next stoppage.
      if (this.advantage) {
        const a = this.advantage;
        a.t += dt;
        const ctrl = w.controller;
        if (ctrl && ctrl.team !== a.team && a.t < ADVANTAGE_WINDOW) {
          this.advantage = null;
          this.events.emit('advantage', { team: a.team, outcome: 'calledBack' });
          this.callFoul(a.restart, a.offenderId, a.sanction, `${a.text} (advantage didn't materialise)`);
          return;
        }
        if (a.t >= ADVANTAGE_WINDOW) {
          this.advantage = null;
          if (a.sanction !== 'none') this.pendingSanctions.push({ playerId: a.offenderId, sanction: a.sanction });
          this.events.emit('advantage', { team: a.team, outcome: 'stands' });
        }
      }
      // Out of play?
      const outSide = Math.abs(ball.pos.z) > W2 + r;
      const outEnd = Math.abs(ball.pos.x) > L2 + r;
      if (outSide || outEnd) {
        if (practice) {
          this.practiceOutTimer += dt;
          if (this.practiceOutTimer > 0.8) {
            this.practiceOutTimer = 0;
            this.practiceReset();
          }
          return;
        }
        this.ballOut(outSide);
        return;
      }
      if (practice && ball.heldBy !== null && w.holdTime > 1.2) {
        // Keeper in practice rolls the ball back out to the player.
        const h = this.human!;
        w.ball.heldBy = null;
        w.ball.pos.set(h.footX(1.2), BALL.radius, h.footZ(1.2));
        w.ball.vel.set(0, 0, 0);
        w.clearPossession();
      }
      // Full time.
      if (!practice && this.clock >= this.options.duration) {
        const shotInFlight = w.lastKick && (w.lastKick.kind === 'shot' || w.lastKick.kind === 'header') && w.time - w.lastKick.time < 1.5;
        if (!shotInFlight) this.endMatch();
      }
    } else if (this.phase === 'stoppage') {
      this.clock += dt * 0.5;
      if (!practice && this.clock >= this.options.duration && this.phaseTime > 0.8) {
        this.endMatch();
        return;
      }
      if (this.phaseTime > OUT_DELAY && this.pendingRestart) this.beginRestart(this.pendingRestart);
    } else if (this.phase === 'restart') {
      this.clock += dt * 0.5;
      if (this.restart?.type === 'throwIn' && ball.heldBy === null && this.phaseTime > 0.2 && w.restrictTouchTo !== null) {
        // Throw-in ball should be held by the taker.
        ball.heldBy = this.restart.takerId;
      }
      // Law 15.2 (2026/27): a *deliberately* delayed throw-in gets a visible five-second countdown, then goes
      // to the opponents. (AI takers never delay, and goal kicks are always taken by the AI keeper.)
      const r = this.restart;
      if (r && r.type === 'throwIn' && this.rules.name === 'standard' && w.players[r.takerId]?.humanControlled) {
        if (this.countdown === null) {
          if (!this.hurryUpGiven && this.phaseTime > HURRY_UP_AFTER) {
            this.hurryUpGiven = true;
            this.officials.refSignal('whistle', 0, 0, 1.2);
            this.events.emit('banner', { text: 'TAKE THE THROW-IN', sub: 'Press pass to throw', kind: 'info' });
            this.events.emit('decision', { text: 'The referee asks for the throw-in to be taken' });
          }
          if (this.deliberateDelay()) {
            this.countdown = COUNTDOWN_LENGTH;
            this.officials.refSignal('indirect', 0, 0, COUNTDOWN_LENGTH);
            this.events.emit('whistle', { kind: 'short' });
            this.events.emit('banner', { text: 'TIME-WASTING', sub: 'Five-second countdown', kind: 'info' });
            this.events.emit('decision', { text: 'The referee judges the throw-in deliberately delayed and starts a five-second countdown' });
          }
        } else {
          this.countdown -= dt;
          if (this.countdown <= 0) {
            const other: TeamId = r.team === 0 ? 1 : 0;
            this.countdown = null;
            this.stopPlay(
              { type: 'throwIn', team: other, x: r.x, z: r.z, takerId: -1 },
              'THROW-IN',
              'info',
              `Throw-in awarded to ${this.teamName(other)}: not taken within five seconds`,
            );
            return;
          }
        }
      }
    } else if (this.phase === 'goal') {
      if (this.phaseTime > (this.celebration?.duration ?? GOAL_CELEBRATION)) this.finishCelebration();
    }
  }

  get replayMode(): ReplayMode {
    const r = this.options.replays;
    return r === true ? 'best' : r === false ? 'off' : r;
  }

  /** End the goal celebration: replay (if enabled and worthy) or straight to the kick-off. */
  finishCelebration(): void {
    if (this.phase !== 'goal') return;
    if (this.options.mode === 'practice') {
      this.clearMoods();
      this.setPhase('playing');
      this.practiceReset();
    } else if (this.replayWorthy) {
      this.setPhase('replay');
    } else {
      this.afterGoal();
    }
  }

  private ballOut(side: boolean): void {
    const w = this.world;
    const ball = w.ball;
    const L2 = this.pitch.length / 2,
      W2 = this.pitch.width / 2;
    const last = w.lastTouchTeam ?? 0;
    const other: TeamId = last === 0 ? 1 : 0;
    // Shots that just miss excite the crowd.
    if (
      w.lastKick &&
      (w.lastKick.kind === 'shot' || w.lastKick.kind === 'header' || w.lastKick.kind === 'chip') &&
      w.time - w.lastKick.time < 3 &&
      !side &&
      Math.abs(ball.pos.z) < this.pitch.goalWidth * 1.4
    ) {
      this.events.emit('nearMiss', { team: w.lastKick.team });
      this.react(w.lastKick.playerId, Gesture.HandsOnHead, 1.6);
    }
    if (side) {
      // The assistant on that side flags the direction of the throw-in.
      this.officials.flag('throwIn', ball.pos.x, w.attackDir(other), 0);
      this.stopPlay(
        { type: 'throwIn', team: other, x: clamp(ball.pos.x, -L2 + 1, L2 - 1), z: Math.sign(ball.pos.z) * (W2 - 0.3), takerId: -1 },
        'THROW-IN',
        'info',
      );
      return;
    }
    const endSide = Math.sign(ball.pos.x);
    // Team defending this end.
    const defending: TeamId = w.attackDir(0) === endSide ? 1 : 0;
    const attacking: TeamId = defending === 0 ? 1 : 0;
    if (last === defending) {
      this.officials.flag('corner', ball.pos.x, endSide, Math.sign(ball.pos.z || 1));
      this.stats[attacking].corners++;
      this.stopPlay({ type: 'corner', team: attacking, x: endSide * (L2 - 0.4), z: Math.sign(ball.pos.z || 1) * (W2 - 0.4), takerId: -1 }, 'CORNER', 'info');
    } else {
      this.officials.flag('goalKick', ball.pos.x, -endSide, 0);
      this.stopPlay(
        {
          type: 'goalKick',
          team: defending,
          x: endSide * (L2 - this.pitch.goalAreaDepth),
          z: Math.sign(ball.pos.z || 1) * this.pitch.goalAreaWidth * 0.25,
          takerId: -1,
        },
        'GOAL KICK',
        'info',
      );
    }
  }

  private stopPlay(r: RestartInfo, text: string, kind: 'info' | 'big', decision?: string): void {
    const w = this.world;
    this.pendingRestart = r;
    w.restrictTouchTo = -1;
    w.secondTouchBan = null;
    w.clearPossession();
    this.advantage = null;
    this.lastRestart = null;
    this.offsideCandidates.clear();
    this.setPhase('stoppage');
    this.events.emit('whistle', { kind: 'short' });
    const sub = decision ?? this.describeRestart(r);
    this.events.emit('banner', { text, kind, sub });
    this.events.emit('decision', { text: sub });
    // The referee points the way the restart goes (or raises an arm for an indirect free kick).
    this.officials.refSignal(r.indirect ? 'indirect' : 'point', w.attackDir(r.team), 0, 1.6, this.officials.referee.signal === 'none' ? false : true);
    // Cautions held back while advantage was played are shown at this stoppage.
    for (const ps of this.pendingSanctions.splice(0)) this.applySanction(ps.playerId, ps.sanction);
  }

  private describeRestart(r: RestartInfo): string {
    const team = this.teamName(r.team);
    switch (r.type) {
      case 'throwIn':
        return `Throw-in to ${team}`;
      case 'corner':
        return `Corner kick to ${team}`;
      case 'goalKick':
        return `Goal kick to ${team}`;
      case 'penalty':
        return `Penalty kick to ${team}`;
      case 'kickoff':
        return `Kick-off: ${team}`;
      default:
        return `${r.indirect ? 'Indirect' : 'Direct'} free kick to ${team}`;
    }
  }

  private beginRestart(r: RestartInfo): void {
    const w = this.world;
    const ball = w.ball;
    this.pendingRestart = null;
    // Choose the taker.
    let taker: Player | undefined;
    if (r.type === 'goalKick') taker = w.players.find((p) => p.team === r.team && p.isGK);
    if (!taker) {
      const cands = w.players.filter((p) => p.team === r.team && !p.isGK && !p.sentOff);
      cands.sort((a, b) => hyp(a.pos.x - r.x, a.pos.z - r.z) - hyp(b.pos.x - r.x, b.pos.z - r.z));
      // Penalties: the most attacking player takes it.
      if (r.type === 'penalty') cands.sort((a, b) => (b.role === 'FWD' ? 1 : 0) - (a.role === 'FWD' ? 1 : 0));
      taker = cands[0];
    }
    if (!taker) return;
    r.takerId = taker.id;
    const dir = w.attackDir(r.team);
    let cut = hyp(taker.pos.x - r.x, taker.pos.z - r.z) > 6;
    ball.reset(r.x, r.z);
    w.clearPossession();
    const face = r.type === 'throwIn' ? (r.z > 0 ? -Math.PI / 2 : Math.PI / 2) : dir > 0 ? 0 : Math.PI;
    if (r.type === 'throwIn') {
      taker.place(r.x, r.z, face);
      ball.heldBy = taker.id;
      w.holdStyle = 'throw';
    } else {
      taker.place(r.x - Math.cos(face) * 0.6, r.z - Math.sin(face) * 0.6, face);
    }
    if (r.type === 'penalty') {
      cut = true;
      // Clear the box: everyone else outside the area, keeper on the line.
      const L2 = this.pitch.length / 2;
      const goalX = dir * L2;
      let k = 0;
      for (const p of w.players) {
        if (p.id === taker.id || p.sentOff) continue;
        if (p.isGK && p.team !== r.team) {
          p.place(goalX - dir * 0.3, 0, dir > 0 ? Math.PI : 0);
          continue;
        }
        if (p.isGK) continue;
        const side = k % 2 === 0 ? 1 : -1;
        p.place(goalX - dir * (this.pitch.penaltyAreaDepth + 1.5 + (k >> 2)), side * (2 + (k >> 1) * 2.5), dir > 0 ? 0 : Math.PI);
        k++;
      }
    }
    this.restart = r;
    // Opponents to the Law distance from the restart (and out of the area at a goal kick).
    this.enforceRestartDistances(r);
    this.formWall(r);
    w.restrictTouchTo = taker.id;
    w.possessionTeam = r.team;
    if (r.team === 0 && !this.options.aiOnly && !taker.isGK) this.setHuman(taker.id);
    this.setPhase('restart');
    if (cut) this.events.emit('cut', {});
  }

  private onGoal(team: TeamId): void {
    const w = this.world;
    this.score[team]++;
    this.stats[team].goals++;
    const ownGoal = w.lastTouchTeam !== null && w.lastTouchTeam !== team;
    // The goal is credited to the player who touched it last — for an own goal, the unlucky defender (shown as
    // "o.g."). The celebration is led by a player of the team that benefits: never by the own-goal scorer.
    const goalScorer = w.lastTouchId;
    let scorer = goalScorer;
    if (scorer !== null && w.players[scorer].team !== team) {
      const att = w.players.filter((p) => p.team === team && !p.isGK && !p.sentOff);
      att.sort((a, b) => a.pos.distanceTo(w.players[goalScorer!].pos) - b.pos.distanceTo(w.players[goalScorer!].pos));
      scorer = att[0]?.id ?? null;
    }
    this.lastScorer = scorer;
    this.lastGoalScorer = goalScorer;
    this.goalLog.push({ team, scorerId: goalScorer, minute: Math.floor(this.minute), ownGoal });
    this.lastGoalTeam = team;
    // Standout goals (long range, headers, chips, curlers) get an automatic replay in 'best' mode.
    const lk = w.lastKick;
    const goalX = (w.attackDir(team) * this.pitch.length) / 2;
    const dist = lk ? hyp(goalX - lk.fromX, lk.fromZ) : 0;
    const special = !!lk && lk.team === team && (lk.kind === 'header' || lk.kind === 'chip' || dist > this.pitch.length * 0.28);
    const mode = this.replayMode;
    this.replayWorthy = mode === 'all' || (mode === 'best' && special && !ownGoal);
    for (const p of w.players) {
      if (p.sentOff) continue;
      p.mood = p.team === team ? 1 : 2;
      const n = this.score[0] + this.score[1];
      p.gesture = p.team === team ? teammateGesture(p.id, n) : dejectedGesture(p.id, n);
      p.gestureTime = 0;
    }
    // Celebration from the match context (score, time, own goal) — see src/sim/celebration.ts.
    const other: TeamId = team === 0 ? 1 : 0;
    this.celebration = chooseCelebration(
      {
        minute: this.minute,
        scoreFor: this.score[team],
        scoreAgainst: this.score[other],
        ownGoal,
        previous: this.lastCelebration[team],
        practice: this.options.mode === 'practice',
      },
      w.rng,
    );
    this.lastCelebration[team] = this.celebration.style;
    if (scorer !== null) w.players[scorer].gesture = GESTURE_FOR[this.celebration.style];
    // A subdued consolation: team-mates don't celebrate, they head back for the kick-off.
    if (this.celebration.intensity === 'subdued') for (const p of w.players) if (p.team === team && p.id !== scorer) p.mood = 0;
    w.restrictTouchTo = -1;
    w.secondTouchBan = null;
    w.clearPossession();
    this.pendingPassTeam = null;
    this.advantage = null;
    this.lastRestart = null;
    this.offsideCandidates.clear();
    this.officials.clearSignals();
    this.officials.refSignal('goal', 0, 0, 2);
    for (const ps of this.pendingSanctions.splice(0)) this.applySanction(ps.playerId, ps.sanction);
    this.setPhase('goal');
    this.events.emit('whistle', { kind: 'long' });
    // The own-goal scorer reacts with dismay (respectful, brief), never with a celebration.
    if (ownGoal && goalScorer !== null) {
      const og = w.players[goalScorer];
      og.mood = 2;
      og.gesture = Gesture.HandsOnHead;
      og.gestureTime = 0;
    }
    this.events.emit('goal', { team, scorerId: goalScorer, celebrantId: scorer, ownGoal, score: [this.score[0], this.score[1]] });
  }

  /** Called by the presentation layer when the goal replay finished (or immediately when replays are off). */
  endReplay(): void {
    if (this.phase === 'replay') this.afterGoal();
  }

  private afterGoal(): void {
    this.clearMoods();
    if (this.options.mode === 'match' && this.clock >= this.options.duration) {
      this.endMatch();
      return;
    }
    const conceded: TeamId = this.lastGoalTeam === 0 ? 1 : 0;
    this.setupKickoff(conceded);
  }

  private clearMoods(): void {
    for (const p of this.world.players) {
      p.mood = 0;
      p.gesture = Gesture.None;
      p.gestureTime = 0;
    }
  }

  private endMatch(): void {
    const w = this.world;
    this.winnerTeam = this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : null;
    for (const p of w.players) {
      p.mood = this.winnerTeam === null ? 0 : p.team === this.winnerTeam ? 1 : 2;
      // Winners raise their arms; losers are dejected; a draw is a handshake-neutral moment.
      p.gesture = p.mood === 1 ? Gesture.ArmsUp : Gesture.None;
    }
    this.officials.refSignal('whistle', 0, 0, 2);
    w.restrictTouchTo = -1;
    this.setPhase('fullTime');
    this.events.emit('whistle', { kind: 'final' });
    this.events.emit('fullTime', { score: [this.score[0], this.score[1]], winner: this.winnerTeam });
  }

  // ---------------------------------------------------------------------------
  // Penalty shootout
  // ---------------------------------------------------------------------------

  private setupPenalty(): void {
    const w = this.world;
    const shooterTeam = this.penShooterTeam;
    const keeperTeam: TeamId = shooterTeam === 0 ? 1 : 0;
    // Everyone shoots at the +x goal.
    w.dirOverride = shooterTeam === 0 ? [1, -1] : [-1, 1];
    const L2 = this.pitch.length / 2;
    const spotX = L2 - this.pitch.penaltySpot;
    const shooter = w.players.find((p) => p.team === shooterTeam && !p.isGK)!;
    const keeper = w.players.find((p) => p.team === keeperTeam && p.isGK)!;
    w.ball.reset(spotX, 0);
    w.clearPossession();
    shooter.place(spotX - 2.6, -0.9, 0.3);
    keeper.place(L2 - 0.2, 0, Math.PI);
    // Idle players wait near the centre circle.
    let k = 0;
    for (const p of w.players) {
      if (p.id === shooter.id || p.id === keeper.id) continue;
      p.place(-2 + k * 1.5, 8 + k * 1.2, -Math.PI / 2);
      k++;
    }
    for (const p of w.players) p.mood = 0;
    w.restrictTouchTo = shooter.id;
    this.restart = { type: 'penalty', team: shooterTeam, x: spotX, z: 0, takerId: shooter.id };
    this.penAim = { z: 0, y: 1 };
    this.penPower = 0;
    this.penPlan = null;
    this.penKickRequested = false;
    this.penOutcome = null;
    if (!this.options.aiOnly) this.setHuman(shooterTeam === 0 ? shooter.id : keeper.id);
    // Penalty difficulty: the human keeper gets more forgiving dives on easier levels; the AI keeper
    // gets slightly better on harder ones.
    const humanKeeper = keeperTeam === 0 && !this.options.aiOnly;
    keeper.diveBoost = humanKeeper ? PEN_TUNING.humanDive[this.options.difficulty] : PEN_TUNING.aiDive[this.options.difficulty];
    this.penTell = 0;
    this.penEarlyDiveHandled = false;
    const round = Math.floor(this.penKicks.length / 2) + 1;
    this.setPhase('penReady');
    this.events.emit('cut', {});
    this.events.emit('banner', {
      text: shooterTeam === 0 ? 'YOUR KICK' : 'YOU ARE IN GOAL',
      sub: `Round ${round}${round > 5 ? ' · Sudden death' : ''}`,
      kind: 'info',
    });
  }

  private stepPenalties(dt: number, input: InputFrame | null): void {
    const w = this.world;
    const r = this.restart!;
    const shooter = w.players[r.takerId];
    const keeper = w.players.find((p) => p.isGK && p.team !== r.team)!;
    const L2 = this.pitch.length / 2;
    const gw = this.pitch.goalWidth / 2,
      gh = this.pitch.goalHeight;
    const humanShoots = r.team === 0 && !this.options.aiOnly;
    const humanKeeps = r.team === 1 && !this.options.aiOnly;

    // Idle players face the action.
    for (const p of w.players) {
      if (p.id !== shooter.id && p.id !== keeper.id) this.commands[p.id].face?.set(w.ball.pos.x - p.pos.x, w.ball.pos.z - p.pos.z);
    }
    const kc = this.commands[keeper.id];
    kc.face?.set(-1, 0);

    if (this.phase === 'penReady') {
      if (humanShoots && input) {
        // Aim reticle moves with the stick; hold shoot to charge, release to take the kick.
        // The reticle can leave the frame: poor aim misses (the goal frame is drawn for reference).
        this.penAim.z = clamp(this.penAim.z + input.move.z * dt * 4.5, -gw - 0.9, gw + 0.9);
        this.penAim.y = clamp(this.penAim.y + input.move.x * dt * 2.2, 0.15, gh + 0.9);
        const b = input.buttons.shoot;
        if (b.down) this.penPower = chargeToPower(b.held, 0.1);
        if (b.released || input.buttons.pass.released) {
          this.penPower = chargeToPower(b.released ? b.held : input.buttons.pass.held, 0.25);
          this.setPhase('penRunup');
        }
      } else if (!humanShoots && this.phaseTime > 1.6) {
        const side = w.rng.chance(0.5) ? 1 : -1;
        this.penAim.z = w.rng.chance(0.15) ? w.rng.range(-0.6, 0.6) : side * w.rng.range(gw * 0.45, gw - 0.35);
        this.penAim.y = w.rng.chance(0.6) ? w.rng.range(0.25, 0.8) : w.rng.range(1.0, gh - 0.2);
        this.penPower = w.rng.range(0.55, 0.85);
        // Run-up "tell": the shooter's body opens towards a side — honest more often on easier levels.
        const aimSide = Math.abs(this.penAim.z) < 0.6 ? 0 : Math.sign(this.penAim.z);
        this.penTell = w.rng.next() < PEN_TUNING.tellHonesty[this.options.difficulty] ? aimSide || (w.rng.chance(0.5) ? 1 : -1) : w.rng.chance(0.5) ? 1 : -1;
        this.setPhase('penRunup');
      }
    }
    if (this.phase === 'penRunup' || this.phase === 'penReady') {
      // Human keeper may dive early (gamble).
      if (humanKeeps && input && this.phase === 'penRunup') this.humanKeeperDive(keeper, input);
    }
    if (this.phase === 'penRunup') {
      const sc = this.commands[shooter.id];
      const b = w.ball.pos;
      const dx = b.x - 0.5 - shooter.pos.x,
        dz = b.z - shooter.pos.z;
      const d = hyp(dx, dz);
      sc.move.set(dx / (d || 1), dz / (d || 1)).scale(0.75);
      // AI shooters' body language: shoulders open towards the tell side as they approach.
      sc.face?.set(1, humanShoots ? 0 : this.penTell * 0.45);
      // A human keeper who commits clearly before the strike may be sent the wrong way.
      if (humanKeeps && keeper.anim === Anim.Dive && !this.penEarlyDiveHandled && d > 0.9 + 0.15 * Math.max(1.5, shooter.speed)) {
        this.penEarlyDiveHandled = true;
        if (w.rng.next() < PEN_TUNING.punishEarly[this.options.difficulty]) {
          this.penAim.z = -keeper.diveDir * w.rng.range(gw * 0.4, gw - 0.5);
        }
      }
      if (d < 0.9 && !this.penKickRequested) {
        this.penKickRequested = true;
        let z = this.penAim.z,
          y = this.penAim.y;
        if (humanShoots) {
          // Human penalty accuracy: a little scatter by difficulty, much more when over-hit (> 85% power),
          // which also lifts the ball. Deterministic per match seed.
          const diff = this.options.difficulty;
          const over = Math.max(0, this.penPower - 0.85) / 0.15;
          const sigma = PEN_TUNING.humanAim[diff] + over * PEN_TUNING.overhit[diff];
          z += w.rng.gaussian() * sigma;
          y += Math.abs(w.rng.gaussian()) * sigma * 0.6 + over * 0.35;
        }
        sc.kick = {
          kind: 'shot',
          power: this.penPower,
          dir: { x: L2 - b.x, z: z - b.z },
          height: y,
          // AI penalty accuracy is the same on every level (difficulty lives in the keeper assistance,
          // tells and reactions) — a sloppier AI shooter made saving *harder*, not easier.
          error: humanShoots ? 0 : 0.035,
        };
      }
    }
    if (this.phase === 'penFlight') {
      if (humanKeeps && input) this.humanKeeperDive(keeper, input);
      if (this.penPlan) {
        this.penPlan.delay -= dt;
        if (this.penPlan.delay <= 0 && keeper.anim !== Anim.Dive) {
          if (Math.abs(this.penPlan.z) < 0.2) {
            kc.move.set(0, 0);
          } else {
            kc.dive = { z: this.penPlan.z, height: this.penPlan.height };
          }
          this.penPlan = null;
        }
      }
      // Outcome.
      const ball = w.ball;
      if (ball.pos.x > L2 + BALL.radius && Math.abs(ball.pos.z) < gw && ball.pos.y < gh) this.penOutcome = 'goal';
      else if (ball.heldBy !== null || w.lastTouchId === keeper.id) this.penOutcome = this.penOutcome ?? 'saved';
      if (
        this.penOutcome === 'goal' ||
        this.phaseTime > 2.6 ||
        (ball.speed < 1 && this.phaseTime > 0.8) ||
        ball.pos.x > L2 + 1.5 ||
        Math.abs(ball.pos.z) > this.pitch.width / 2
      ) {
        this.resolvePenalty(this.penOutcome === 'goal');
      }
    }
    if (this.phase === 'penResult') {
      if (this.phaseTime > 2.4) this.nextPenalty();
    }
    if (this.phase === 'fullTime') this.celebrationCommands();

    w.step(dt, this.commands);
    // A ball that ends up in the net after a parry still counts.
    if (this.phase === 'penResult' && !this.penKicks[this.penKicks.length - 1]?.scored) {
      const ball = w.ball;
      if (ball.pos.x > L2 + BALL.radius && Math.abs(ball.pos.z) < gw && ball.pos.y < gh && this.phaseTime < 1.5) {
        const last = this.penKicks[this.penKicks.length - 1];
        last.scored = true;
        this.score[last.team]++;
        this.events.emit('banner', { text: 'GOAL!', kind: 'goal' });
        this.events.emit('goal', { team: last.team, scorerId: shooter.id, ownGoal: false, score: [this.score[0], this.score[1]] });
      }
    }
  }

  private humanKeeperDive(keeper: Player, input: InputFrame): void {
    if (keeper.anim === Anim.Dive) return;
    const b = input.buttons;
    const act = b.shoot.pressed || b.pass.pressed || b.lob.pressed || b.through.pressed || b.tackle.pressed;
    const c = this.commands[keeper.id];
    if (act) {
      const z = input.move.z;
      if (Math.abs(z) < 0.3) {
        keeper.vy = 3.2;
        keeper.y = 0.01; // jump up in the middle
        keeper.setAnim(Anim.Hold, 0.6);
      } else {
        // Dive height is automatic once the ball is struck (choose the side; the keeper goes to the
        // ball's height). Before the strike: a mid-height dive, or high with Sprint held.
        const auto = this.phase === 'penFlight' ? clamp((this.penAim.y - 0.25) / 1.9, 0.15, 1) : input.sprint ? 0.85 : 0.4;
        c.dive = { z: Math.sign(z), height: auto };
      }
    } else {
      c.move.set(0, input.move.z * 0.5);
    }
  }

  private penKeeperReact(): void {
    if (this.restart?.team === 1 && !this.options.aiOnly) return; // human keeper
    const w = this.world;
    const prof = AI_PROFILES[this.options.difficulty];
    const read = w.rng.next() < PEN_TUNING.aiRead[this.options.difficulty];
    void prof;
    const aimZ = this.penAim.z;
    let z: number;
    if (read) z = Math.abs(aimZ) < 0.6 ? 0 : Math.sign(aimZ);
    else z = w.rng.pick([-1, 0.0, 1]);
    this.penPlan = { delay: PEN_TUNING.aiDelay[this.options.difficulty], z, height: clamp((this.penAim.y - 0.3) / 1.8, 0, 1) };
  }

  /** Take the human penalty: aim (z across the goal, y height at the goal line) and power 0..1. Same path as releasing the button. */
  takePenalty(z: number, y: number, power: number): void {
    if (this.phase !== 'penReady' || this.restart?.team !== 0) return;
    this.penAim.z = z;
    this.penAim.y = y;
    this.penPower = power;
    this.setPhase('penRunup');
  }

  /** What a keeper can observe (for simulations and UI cues). */
  penaltyInfo(): { timeToStrike: number; aimSide: number; tellSide: number } {
    const r = this.restart;
    if (!r || r.type !== 'penalty') return { timeToStrike: Infinity, aimSide: 0, tellSide: 0 };
    const shooter = this.world.players[r.takerId];
    const b = this.world.ball.pos;
    const d = Math.max(0, hyp(b.x - 0.5 - shooter.pos.x, b.z - shooter.pos.z) - 0.9);
    const sp = Math.max(1.5, shooter.speed);
    return {
      timeToStrike: this.phase === 'penRunup' ? d / sp : this.phase === 'penReady' ? Infinity : 0,
      aimSide: Math.abs(this.penAim.z) < 0.6 ? 0 : Math.sign(this.penAim.z),
      tellSide: this.penTell,
    };
  }

  private resolvePenalty(scored: boolean): void {
    const team = this.restart!.team;
    const w = this.world;
    const savedBy = !scored && w.lastTouchId !== null && w.players[w.lastTouchId].isGK && w.players[w.lastTouchId].team !== team;
    const kick: PenaltyKick = { team, scored, saved: savedBy };
    this.penKicks.push(kick);
    if (scored) this.score[team]++;
    const shooter = w.players[this.restart!.takerId];
    for (const p of w.players) {
      if (p.team === team) p.mood = scored ? 1 : 2;
      else p.mood = scored ? 2 : 1;
    }
    this.lastPenaltyOutcome = scored ? 'goal' : savedBy ? 'saved' : 'missed';
    this.setPhase('penResult');
    this.events.emit('penalty', { team, scored, kicks: this.penKicks.slice() });
    if (scored) {
      this.events.emit('goal', { team, scorerId: shooter.id, ownGoal: false, score: [this.score[0], this.score[1]] });
      this.events.emit('banner', { text: 'GOAL!', kind: 'goal' });
    } else {
      const saved = w.lastTouchId !== null && w.players[w.lastTouchId].isGK && w.players[w.lastTouchId].team !== team;
      this.events.emit('banner', { text: saved ? 'SAVED!' : 'MISSED!', kind: 'big' });
      if (saved) this.stats[w.players[w.lastTouchId!].team].saves++;
    }
  }

  /** Whether the shootout is decided given kicks so far. */
  static shootoutDecided(kicks: PenaltyKick[]): TeamId | null | 'continue' {
    const taken: [number, number] = [0, 0];
    const goals: [number, number] = [0, 0];
    for (const k of kicks) {
      taken[k.team]++;
      if (k.scored) goals[k.team]++;
    }
    const regulation = 5;
    if (taken[0] <= regulation && taken[1] <= regulation) {
      const rem0 = regulation - taken[0],
        rem1 = regulation - taken[1];
      if (goals[0] > goals[1] + rem1) return 0;
      if (goals[1] > goals[0] + rem0) return 1;
      if (taken[0] === regulation && taken[1] === regulation) return goals[0] === goals[1] ? 'continue' : goals[0] > goals[1] ? 0 : 1;
      return 'continue';
    }
    // Sudden death: decided after equal numbers of kicks.
    if (taken[0] === taken[1] && goals[0] !== goals[1]) return goals[0] > goals[1] ? 0 : 1;
    return 'continue';
  }

  private nextPenalty(): void {
    const res = Match.shootoutDecided(this.penKicks);
    if (res !== 'continue') {
      this.winnerTeam = res;
      for (const p of this.world.players) p.mood = res === null ? 0 : p.team === res ? 1 : 2;
      this.setPhase('fullTime');
      this.events.emit('whistle', { kind: 'final' });
      this.events.emit('fullTime', { score: [this.score[0], this.score[1]], winner: res });
      return;
    }
    this.penShooterTeam = this.penShooterTeam === 0 ? 1 : 0;
    this.setupPenalty();
  }
}

function anyAction(f: InputFrame): boolean {
  const b = f.buttons;
  return b.shoot.pressed || b.pass.pressed || b.through.pressed || b.lob.pressed || b.tackle.pressed || b.switch.pressed || b.skill.pressed;
}
