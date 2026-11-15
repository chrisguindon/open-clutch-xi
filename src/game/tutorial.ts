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
import { InputFrame } from '../sim/human';
import { Settings, KeyAction } from './settings';
import { bindHtml, controlAvailable } from '../ui/ui';

/** Control labels for the current scheme, and whether a control exists at all (touch lacks a few). */
interface Keys {
  (a: KeyAction): string;
  has: (a: KeyAction) => boolean;
}

interface Step {
  /** Short name shown after the step number ("Passing"). */
  name: string;
  text: (k: Keys) => string;
  /** Some steps need a control that not every scheme has (touch has no skill-move button). */
  available?: (k: Keys) => boolean;
  /** The step needs the human team to be able to get the ball. */
  needsBall: boolean;
  /** Put the game in a valid starting state for this step (on entering the step and on Retry only). */
  setup?: (t: Tutorial) => void;
  /** Returns true when complete. */
  check: (t: Tutorial, dt: number, input: InputFrame) => boolean;
}

export type TutorialEvent = 'retry' | 'skip' | 'restart';

/**
 * Interactive tutorial played on the practice pitch. Each step watches real gameplay (movement,
 * simulation events) to advance.
 *
 * Reliability: every step starts from a valid state (`setup`, applied once on entry and on
 * Retry — never repeatedly during play), and a watchdog recovers from impossible states only after
 * they persist: the ball frozen or stranded out of reach, the player unable to move, or play not
 * running. Retry / Skip / Restart are available at any time.
 */
export class Tutorial {
  index = 0;
  private progress = 0;
  private doneTimer = 0;
  private finishedTimer = 0;
  private flags = { pass: false, shot: false, goal: false, skill: false };
  /** Watchdog timers (s). */
  private stranded = 0;
  private immobile = 0;
  private notPlaying = 0;
  /** Seconds the ball has been out of the player's reach (drives the "where's the ball" hint). */
  private outOfReach = 0;
  /** Seconds the ball has sat still with nobody on the player's team controlling it. */
  private idle = 0;
  /** Whether the "where's the ball" hint is showing. */
  private hinting = false;
  /** Recoveries performed (diagnostics / tests). */
  recoveries: string[] = [];
  /** Every lesson. The ones available for the current control scheme are in {@link steps}. */
  readonly allSteps: Step[] = [
    {
      name: 'Movement',
      text: (k) =>
        k.has('left') && k('up') !== k('left')
          ? `Move your player with ${k('up')} ${k('left')} ${k('down')} ${k('right')} — the ball stays at your feet.`
          : `Move your player with the ${k('up')} — the ball stays at your feet.`,
      needsBall: false,
      check: (t, dt, i) => {
        if (Math.hypot(i.move.x, i.move.z) > 0.3) t.progress += dt;
        return t.progress > 1.6;
      },
    },
    {
      name: 'Sprint',
      text: (k) =>
        k('sprint').includes('edge')
          ? `Push the joystick all the way to the edge to sprint. Sprinting knocks the ball further ahead — faster but riskier.`
          : `Hold ${k('sprint')} while moving to sprint. Sprinting knocks the ball further ahead — faster but riskier.`,
      needsBall: false,
      // Fresh legs: an exhausted player can't sprint, which used to make this step impossible.
      setup: (t) => {
        const h = t.match.human;
        if (h) h.stamina = 1;
      },
      check: (t, dt, i) => {
        const h = t.match.human;
        if (i.sprint && h && h.speed > 5.8) t.progress += dt;
        return t.progress > 1.0;
      },
    },
    {
      name: 'Passing',
      text: (k) => `Push towards a teammate (a white ring marks the target) and press ${k('pass')} to pass.`,
      needsBall: true,
      setup: (t) => t.ballToHuman(),
      check: (t) => t.flags.pass,
    },
    {
      name: 'Shooting',
      text: (k) => `Run at goal and press ${k('shoot')} to shoot. Steer ${k('left')}/${k('right')} as you shoot to pick a corner.`,
      needsBall: true,
      setup: (t) => t.ballToHuman(),
      check: (t) => t.flags.shot,
    },
    {
      name: 'Score!',
      text: (k) =>
        `Now beat the keeper. Mid-power shots towards the corners curl in.${k.has('reset') ? ` Press ${k('reset')} to get the ball back any time.` : ''}`,
      needsBall: true,
      setup: (t) => t.ballToHuman(),
      check: (t) => t.flags.goal,
    },
    {
      name: 'Skill move',
      text: (k) => `Press ${k('skill')} with a direction to cut and burst past a defender (push backwards for a drag-back).`,
      // Touch controls have no skill-move button, so on touch this step is left out (not failed).
      available: (k) => k.has('skill'),
      needsBall: true,
      setup: (t) => t.ballToHuman(),
      check: (t) => t.flags.skill,
    },
  ];

  constructor(
    readonly match: Match,
    private settings: Settings,
    private show: (step: string | null, msg?: string, done?: boolean) => void,
  ) {
    const ev = match.events;
    // 'humanKick' is emitted by the match before control moves to a pass receiver.
    ev.on('humanKick', (e) => {
      if (e.kind === 'pass' || e.kind === 'through' || e.kind === 'lob') this.flags.pass = true;
      if (e.kind === 'shot' || e.kind === 'chip' || e.kind === 'header') this.flags.shot = true;
    });
    ev.on('goal', (e) => {
      if (e.team === 0) this.flags.goal = true;
    });
    ev.on('skill', (e) => {
      if (match.world.players[e.playerId].team === 0) this.flags.skill = true;
    });
    this.steps = this.allSteps.filter((st) => st.available?.(this.keys) ?? true);
    this.scheme = settings.controlScheme;
    this.enterStep();
  }

  /** The lessons for the current control scheme, in order. */
  steps: Step[];
  private scheme: Settings['controlScheme'];

  /** "Step 3 / 6 · Passing", numbered within the lessons available to this player. */
  title(i = this.index): string {
    return `Step ${i + 1} / ${this.steps.length} · ${this.steps[i].name}`;
  }

  /** Steps skipped since the last restart. Completing with skips doesn't count as completing the tutorial. */
  skippedSteps = 0;

  get finished(): boolean {
    return this.index >= this.steps.length;
  }

  private readonly keys: Keys = Object.assign((a: KeyAction) => bindHtml(this.settings, a), {
    has: (a: KeyAction) => controlAvailable(this.settings, a),
  });

  /** Give the ball to the controlled player (step setup / recovery only). */
  ballToHuman(): void {
    const m = this.match;
    m.practiceReset(); // also lifts any ball freeze and resumes play
    const h = m.human;
    if (h) {
      h.noControl = 0;
      h.stamina = Math.max(h.stamina, 0.6);
    }
  }

  private changeScheme(): void {
    this.scheme = this.settings.controlScheme;
    const current = this.steps[this.index];
    this.steps = this.allSteps.filter((st) => st.available?.(this.keys) ?? true);
    // Stay on the same lesson if it still applies; otherwise continue with the next one that does.
    const kept = current ? this.steps.indexOf(current) : -1;
    if (kept >= 0) this.index = kept;
    else if (current) this.index = this.steps.findIndex((st) => this.allSteps.indexOf(st) > this.allSteps.indexOf(current));
    if (this.index < 0) this.index = this.steps.length;
    this.render();
  }

  private enterStep(): void {
    this.progress = 0;
    this.flags = { pass: false, shot: false, goal: false, skill: false };
    this.stranded = this.immobile = this.notPlaying = this.outOfReach = this.idle = 0;
    this.hinting = false;
    if (!this.finished) this.steps[this.index].setup?.(this);
    this.render();
  }

  private render(note?: string): void {
    if (this.finished) {
      this.show(
        'Tutorial complete',
        this.keys.has('lob')
          ? `You're ready! Through balls (${this.keys('through')}) and lobs (${this.keys('lob')}) unlock defences. When defending, ${this.keys('pass')} tackles, ${this.keys('shoot')} slides and ${this.keys('through')} switches player. Press ${this.keys('pause')} and quit to play a match.`
          : `You're ready! ${this.keys('through')} plays a through ball into space. When the other team has the ball, the buttons become Tackle, Switch and Slide. Press ${this.keys('pause')} and quit to play a match.`,
        true,
      );
      return;
    }
    const s = this.steps[this.index];
    this.show(this.title(), (note ? `<span class="tut-note">${note}</span> ` : '') + s.text(this.keys));
  }

  /** Recovery controls (also reachable from the pause menu). */
  handle(e: TutorialEvent): void {
    if (e === 'restart') {
      this.index = 0;
      this.skippedSteps = 0;
      this.doneTimer = 0;
      this.finishedTimer = 0;
      this.enterStep();
      return;
    }
    if (this.finished) return;
    if (e === 'skip') {
      this.doneTimer = 0;
      this.skippedSteps++;
      this.index++;
      this.enterStep();
      return;
    }
    if (e === 'retry') {
      this.doneTimer = 0;
      this.enterStep();
    }
  }

  update(dt: number, input: InputFrame): void {
    // The player switched input method (picked up a controller, changed scheme in the pause menu):
    // redraw the instructions with the right controls, and recompute which lessons apply.
    if (this.settings.controlScheme !== this.scheme) this.changeScheme();
    if (this.finished) {
      this.finishedTimer += dt;
      if (this.finishedTimer > 12) this.show(null);
      return;
    }
    if (this.doneTimer > 0) {
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) {
        this.index++;
        this.enterStep();
      }
      return;
    }
    this.watchdog(dt, input);
    const s = this.steps[this.index];
    if (s.check(this, dt, input)) {
      this.show(this.title(), 'Nice! ✔', true);
      this.doneTimer = 1.1;
    }
  }

  /**
   * Detect states in which the current step can't be completed and recover — only after they persist,
   * so normal play (a loose ball, a brief tackle) is never interrupted.
   */
  private watchdog(dt: number, input: InputFrame): void {
    const m = this.match,
      w = m.world,
      h = m.human;
    const step = this.steps[this.index];
    // Play not running (e.g. stuck in a stoppage) for 3 s.
    if (m.phase !== 'playing' && m.phase !== 'goal') this.notPlaying += dt;
    else this.notPlaying = 0;
    if (this.notPlaying > 3) {
      this.recover('play resumed', () => this.ballToHuman());
      return;
    }
    if (!h) return;
    // Ball frozen (no one may touch it) during live play — never valid in practice.
    if (m.phase === 'playing' && w.restrictTouchTo !== null) {
      this.recover('ball released', () => this.ballToHuman());
      return;
    }
    // Lessons that need the ball. Explicit states, checked in order:
    //  1. ours: the player controls the ball (or will: the match keeps the human on the team's carrier);
    //  2. out of reach for a moment: say where the ball is and how to get it back (a hint, not a takeover);
    //  3. stranded: far away and not coming back, or left idle with nobody on our team near it: return
    //     it to the player's feet and say so. Touch has no "reset ball" control, so it returns sooner.
    if (step.needsBall) {
      const ball = w.ball;
      const d = Math.hypot(ball.pos.x - h.pos.x, ball.pos.z - h.pos.z);
      const ours = w.controller?.team === 0 && !w.controller.isGK;
      const rolling = Math.hypot(ball.vel.x, ball.vel.z) > 1.5;
      if (!ours && ball.heldBy === null && d > 14 && !rolling) this.stranded += dt;
      else this.stranded = 0;
      if (!ours && ball.heldBy === null && !rolling) this.idle += dt;
      else this.idle = 0;
      if (!ours && d > 6) this.outOfReach += dt;
      else this.outOfReach = 0;
      const canReset = this.keys.has('reset');
      if (this.stranded > 4 || this.idle > (canReset ? 8 : 5)) {
        this.recover('ball returned to you', () => this.ballToHuman());
        return;
      }
      if (this.outOfReach > 2.5 && !this.hinting) {
        this.hinting = true;
        this.render(
          canReset
            ? `The ball is over there: run to it, or press ${this.keys('reset')} to bring it back.`
            : 'The ball is over there: run to it. It comes back to you if it stays out of reach.',
        );
      } else if (this.outOfReach === 0 && this.hinting) {
        this.hinting = false;
        this.render();
      }
    }
    // Pushing the stick but unable to move (stuck action / collision) for 1.5 s.
    const pushing = Math.hypot(input.move.x, input.move.z) > 0.5;
    if (pushing && h.speed < 0.3 && m.phase === 'playing') this.immobile += dt;
    else this.immobile = 0;
    if (this.immobile > 1.5) {
      this.recover('player freed', () => {
        h.place(h.pos.x, h.pos.z, h.facing);
        h.noControl = 0;
      });
    }
  }

  private recover(what: string, fix: () => void): void {
    fix();
    this.hinting = false;
    this.outOfReach = this.idle = 0;
    this.recoveries.push(`${this.steps[this.index] ? this.title() : 'done'}: ${what}`);
    this.stranded = this.immobile = this.notPlaying = 0;
    this.render(`(${what})`);
  }
}
