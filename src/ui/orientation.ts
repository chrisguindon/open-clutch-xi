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
 * Phones play in landscape. Held upright, a phone shows a full-screen "rotate your phone" screen that
 * covers the game and blocks it, until the phone is turned sideways again.
 *
 * Why a full screen rather than a hint: in portrait the pitch is a thin strip behind the touch
 * controls, so the game isn't really playable. The old notice was a small floating box ("for the best
 * experience") that let the match carry on underneath and passed taps through to the controls. Players
 * found it confusing.
 *
 * - **Who is blocked:** phone-sized touch screens (shorter side under {@link PHONE_SHORT_SIDE} CSS px)
 *   held in portrait. Tablets have room to play upright, and desktops with a mouse are never blocked,
 *   even in a tall, narrow window.
 * - **Which way up:** the screen's own orientation when the browser reports it, otherwise the window's
 *   shape. So the on-screen keyboard or the address bar changing the window's height can't flip it.
 * - **The match:** rotating to portrait during play pauses it; returning to landscape resumes it, but
 *   only if this screen paused it (a match you had paused yourself stays paused).
 *
 * The rules are pure functions (tests/orientation.test.ts); {@link OrientationGuard} applies them to the
 * page. `scripts/orientation-check.mjs` checks the whole behaviour in a real browser.
 */

/** Below this shorter screen side (CSS px) a touch screen counts as a phone. Tablets start around 744. */
export const PHONE_SHORT_SIDE = 600;

export interface ScreenFacts {
  /** Window size in CSS px. */
  width: number;
  height: number;
  /** The primary pointer is a finger (`(pointer: coarse)`), and the device has touch. */
  touch: boolean;
  /** `screen.orientation.type` when the browser provides it ("portrait-primary", …), else null. */
  orientationType: string | null;
  /** The screen's own size in CSS px, when known (it doesn't change with the address bar or keyboard). */
  screenWidth?: number;
  screenHeight?: number;
}

/** Whether the device is held in portrait. */
export function isPortrait(s: ScreenFacts): boolean {
  if (s.orientationType) return s.orientationType.startsWith('portrait');
  return s.height > s.width;
}

/** Whether play must be blocked by the rotate screen: a phone-sized touch screen held in portrait. */
export function shouldBlockForOrientation(s: ScreenFacts): boolean {
  if (!s.touch || !isPortrait(s)) return false;
  // The screen's size is stable; the window's isn't (address bar, keyboard). Use the smaller of the
  // two shorter sides, so a phone always counts as a phone.
  const shortSide = Math.min(s.width, s.height, ...(s.screenWidth && s.screenHeight ? [Math.min(s.screenWidth, s.screenHeight)] : []));
  return shortSide < PHONE_SHORT_SIDE;
}

/** What the game should do when blocking starts or stops. */
export type OrientationAction = 'pause' | 'resume' | null;

/**
 * Pause when blocking starts during live play; resume when it stops, only if this paused the match.
 * @param state the game's state ('playing', 'paused', 'menu', …)
 * @param pausedByOrientation whether the current pause was caused by the rotate screen
 */
export function orientationAction(blocked: boolean, state: string, pausedByOrientation: boolean): OrientationAction {
  if (blocked) return state === 'playing' ? 'pause' : null;
  return pausedByOrientation && state === 'paused' ? 'resume' : null;
}

/** The facts about the current screen, from the browser. */
export function readScreenFacts(): ScreenFacts {
  const touch = (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return {
    width: innerWidth,
    height: innerHeight,
    touch,
    orientationType: typeof screen !== 'undefined' && screen.orientation ? screen.orientation.type : null,
    screenWidth: typeof screen !== 'undefined' ? screen.width : undefined,
    screenHeight: typeof screen !== 'undefined' ? screen.height : undefined,
  };
}

/**
 * Shows the rotate screen when {@link shouldBlockForOrientation} says so, and makes the rest of the
 * game inert (no taps, no keyboard focus) while it's up. Calls `onChange(blocked)` whenever that
 * changes, so the game can pause and resume. It watches every event that can change the answer:
 * rotation, window resizes (including the address bar), and the visual viewport.
 */
export class OrientationGuard {
  readonly element: HTMLElement;
  private message: HTMLElement;
  private blocked = false;

  constructor(
    private gameRoot: HTMLElement,
    private onChange: (blocked: boolean) => void,
  ) {
    const el = document.createElement('div');
    el.className = 'orientation-screen';
    el.hidden = true;
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'orientation-title');
    el.setAttribute('aria-describedby', 'orientation-text');
    el.tabIndex = -1;
    el.innerHTML = `<div class="orientation-box">
        <svg class="orientation-phone" viewBox="0 0 64 64" width="96" height="96" aria-hidden="true">
          <rect x="22" y="8" width="20" height="36" rx="3.5" fill="none" stroke="currentColor" stroke-width="3"/>
          <circle cx="32" cy="39" r="1.8" fill="currentColor"/>
          <path d="M14 50 a20 20 0 0 0 26 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          <path d="M37 52 l4 4 l-5 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h2 id="orientation-title">Turn your phone sideways</h2>
        <p id="orientation-text">This game is played in landscape. Rotate your phone to continue.</p>
        <p class="orientation-paused" hidden>Your match is paused and will carry on when you rotate back.</p>
      </div>`;
    // Swallow every touch, click and key press that reaches the screen itself (the game behind it is
    // also inert), and stop the page from scrolling or zooming underneath.
    for (const type of ['touchstart', 'touchmove', 'pointerdown', 'click', 'contextmenu'] as const) {
      el.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
    document.body.appendChild(el);
    this.element = el;
    this.message = el.querySelector('.orientation-paused')!;

    const update = () => this.update();
    addEventListener('resize', update);
    addEventListener('orientationchange', update);
    screen.orientation?.addEventListener?.('change', update);
    window.visualViewport?.addEventListener('resize', update);
    matchMedia('(orientation: portrait)').addEventListener?.('change', update);
    this.update();
  }

  /** Whether the rotate screen is up. */
  get isBlocking(): boolean {
    return this.blocked;
  }

  /** Show or hide the "your match is paused" line. */
  setMatchPaused(paused: boolean): void {
    this.message.hidden = !paused;
  }

  /** Re-checks the screen and shows or hides the rotate screen. */
  update(facts: ScreenFacts = readScreenFacts()): void {
    const blocked = shouldBlockForOrientation(facts);
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.element.hidden = !blocked;
    // inert: nothing behind the screen can be tapped, clicked or focused, including the touch controls.
    this.gameRoot.inert = blocked;
    if (blocked) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.element.focus({ preventScroll: true });
    }
    this.onChange(blocked);
  }
}
