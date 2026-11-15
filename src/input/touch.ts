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
 * Touch controls for phones and tablets — designed for thumbs rather than copied from the keyboard:
 * - Left half: a floating virtual joystick that appears where the thumb lands. Pushing it to the
 *   rim sprints (no separate sprint button).
 * - Right: three large contextual buttons. Attacking: Shoot (hold to charge), Pass, Through ball.
 *   Defending: Tackle, Switch player, Slide.
 * - A pause button. Gestures are blocked from scrolling / zooming the page during play.
 * Same game rules as every other device: these only produce the standard InputFrame actions.
 */
export type TouchAction = 'shoot' | 'pass' | 'through' | 'tackle' | 'switch' | 'lob';

const RADIUS = 56; // px: joystick throw
const DEAD = 0.12;
const SPRINT_AT = 0.92;

export class TouchControls {
  readonly el: HTMLElement;
  /** Joystick vector in screen space (x right, y up), magnitude 0..1. */
  readonly move = { x: 0, y: 0 };
  sprint = false;
  /** Whether the human's team is defending (switches button labels / actions). */
  defending = false;
  private down = new Set<TouchAction>();
  private tapped = new Set<TouchAction>();
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private base: HTMLElement;
  private knob: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private visible = false;
  onPause: (() => void) | null = null;
  /** Timestamp of the latest touch input (for latency diagnostics; consumed by the input poll). */
  lastEventT = 0;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'touch';
    el.hidden = true;
    el.innerHTML = `
      <div class="touch-stick-zone"><div class="touch-base"><div class="touch-knob"></div></div></div>
      <div class="touch-buttons">
        <button class="tb tb-a" data-slot="0"><span></span></button>
        <button class="tb tb-b" data-slot="1"><span></span></button>
        <button class="tb tb-c" data-slot="2"><span></span></button>
      </div>
      <button class="touch-pause" aria-label="Pause">❚❚</button>`;
    parent.appendChild(el);
    this.el = el;
    this.base = el.querySelector('.touch-base')!;
    this.knob = el.querySelector('.touch-knob')!;
    this.buttons = [...el.querySelectorAll<HTMLButtonElement>('.tb')];
    const zone = el.querySelector<HTMLElement>('.touch-stick-zone')!;
    zone.addEventListener('pointerdown', (e) => this.stickStart(e));
    zone.addEventListener('pointermove', (e) => this.stickMove(e));
    zone.addEventListener('pointerup', (e) => this.stickEnd(e));
    zone.addEventListener('pointercancel', (e) => this.stickEnd(e));
    for (const b of this.buttons) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        const a = this.actionFor(+b.dataset.slot!);
        this.lastEventT = e.timeStamp || performance.now();
        this.down.add(a);
        this.tapped.add(a);
        b.classList.add('on');
      });
      const up = (e: PointerEvent) => {
        e.preventDefault();
        for (const a of ['shoot', 'pass', 'through', 'tackle', 'switch', 'lob'] as TouchAction[]) if (this.slotOf(a) === +b.dataset.slot!) this.down.delete(a);
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
    el.querySelector('.touch-pause')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onPause?.();
    });
    // No page scroll / pinch-zoom / double-tap zoom while the controls are up.
    el.addEventListener(
      'touchstart',
      (e) => {
        if (this.visible) e.preventDefault();
      },
      { passive: false },
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        if (this.visible) e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('gesturestart', (e) => {
      if (this.visible) e.preventDefault();
    });
    this.relabel();
  }

  /** Touch-capable device with a coarse pointer (phone / tablet). */
  static isTouchDevice(): boolean {
    return (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  /** Player preferences: button size and a mirrored (left-handed) layout. */
  setPrefs(size: 'small' | 'normal' | 'large', leftHanded: boolean): void {
    this.el.classList.toggle('size-small', size === 'small');
    this.el.classList.toggle('size-large', size === 'large');
    this.el.classList.toggle('left-handed', leftHanded);
  }

  show(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.el.hidden = !on;
    if (!on) this.reset();
  }

  private reset(): void {
    this.down.clear();
    this.tapped.clear();
    this.stickId = null;
    this.move.x = this.move.y = 0;
    this.sprint = false;
    this.base.classList.remove('active');
    for (const b of this.buttons) b.classList.remove('on');
  }

  setDefending(d: boolean): void {
    if (d === this.defending) return;
    this.defending = d;
    // Release anything held across the switch so a held "shoot" doesn't become a held "tackle".
    this.down.clear();
    for (const b of this.buttons) b.classList.remove('on');
    this.relabel();
  }

  private actionFor(slot: number): TouchAction {
    return (this.defending ? ['tackle', 'switch', 'lob'] : ['shoot', 'pass', 'through'])[slot] as TouchAction;
  }
  private slotOf(a: TouchAction): number {
    return ({ shoot: 0, tackle: 0, pass: 1, switch: 1, through: 2, lob: 2 } as Record<TouchAction, number>)[a];
  }
  private relabel(): void {
    const labels = this.defending ? ['Tackle', 'Switch', 'Slide'] : ['Shoot', 'Pass', 'Through'];
    this.buttons.forEach((b, i) => {
      b.querySelector('span')!.textContent = labels[i];
    });
  }

  /** Held this frame (or tapped since the last poll). Defending "lob" = slide tackle, per the standard mapping. */
  isDown(a: TouchAction): boolean {
    return this.down.has(a) || this.tapped.has(a);
  }
  endPoll(): void {
    this.tapped.clear();
  }

  private stickStart(e: PointerEvent): void {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.origin.x = e.clientX;
    this.origin.y = e.clientY;
    this.base.style.left = `${e.clientX}px`;
    this.base.style.top = `${e.clientY}px`;
    this.base.classList.add('active');
    this.stickMove(e);
  }
  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    this.lastEventT = e.timeStamp || performance.now();
    let dx = (e.clientX - this.origin.x) / RADIUS,
      dy = (e.clientY - this.origin.y) / RADIUS;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    const mag = Math.min(1, m);
    // Dead zone with a rescaled response so small thumb movements still give fine control.
    const k = mag < DEAD ? 0 : (mag - DEAD) / (1 - DEAD) / Math.max(mag, 1e-6);
    this.move.x = dx * k;
    this.move.y = -dy * k;
    this.sprint = mag >= SPRINT_AT;
    this.knob.style.transform = `translate(${dx * RADIUS}px, ${dy * RADIUS}px)`;
    this.knob.classList.toggle('sprint', this.sprint);
  }
  private stickEnd(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.move.x = this.move.y = 0;
    this.sprint = false;
    this.knob.style.transform = '';
    this.knob.classList.remove('sprint');
    this.base.classList.remove('active');
  }
}
