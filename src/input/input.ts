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
 * Reads the keyboard, mouse, Gamepad API and touch controls and merges them into one InputFrame per
 * display frame (see src/sim/human.ts). Bindings use physical key positions (`KeyboardEvent.code`),
 * so WASD sits in the same place on any layout. Press and release *edges* accumulate until a
 * simulation step consumes them, so a tap shorter than one frame is never lost. Menu navigation
 * (UICommand) is reported separately from gameplay input.
 */

import { TouchAction, TouchControls } from './touch';
import { ActionName, InputFrame, emptyInput } from '../sim/human';
import { KeyAction, PadAction, Settings, activeBindings } from '../game/settings';

const ACTIONS: ActionName[] = ['shoot', 'pass', 'through', 'lob', 'tackle', 'switch', 'skill'];

/** Standard Gamepad API button layout (Xbox naming; PlayStation equivalents in brackets). */
export const PAD = {
  A: 0, // Cross
  B: 1, // Circle
  X: 2, // Square
  Y: 3, // Triangle
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export type UICommand = 'pause' | 'camera' | 'reset' | 'confirm' | 'back' | 'navUp' | 'navDown' | 'navLeft' | 'navRight';

/**
 * Unifies keyboard, gamepad and mouse into a device-agnostic InputFrame.
 * Edge flags (pressed/released) accumulate until the simulation consumes them so that
 * quick taps are never lost regardless of frame rate vs. simulation rate.
 */
export class InputManager {
  readonly frame: InputFrame = emptyInput();
  private keys = new Set<string>();
  /** Keys pressed since the last poll: a tap shorter than one frame still registers. */
  private tapped = new Set<string>();
  /** Diagnostics hook: a gameplay input changed (timestamp in the performance.now() timebase). */
  onGameplayInput: ((t: number) => void) | null = null;
  /** On-screen touch controls (merged into the same InputFrame as keyboard / gamepad). */
  touch: TouchControls | null = null;
  touchActive = false;
  /** Earliest gameplay input event time since the last poll (performance.now() timebase). */
  private eventT: number | null = null;
  private lastMoveDir = { x: 0, z: 0 };
  /** What changed in the last poll, with the real input timestamp (for latency diagnostics). */
  readonly events = { t: 0, moveChanged: false, presses: [] as string[], releases: [] as string[] };
  private stampEvent(t: number): void {
    if (this.eventT === null || t < this.eventT) this.eventT = t;
  }
  private padSig = '';
  private prevDown: Record<ActionName, boolean> = { shoot: false, pass: false, through: false, lob: false, tackle: false, switch: false, skill: false };
  private holdStart: Record<ActionName, number> = { shoot: 0, pass: 0, through: 0, lob: 0, tackle: 0, switch: 0, skill: 0 };
  private padPrev: boolean[] = [];
  private mouse = { x: 0, y: 0, inside: false };
  private uiListeners: Array<(c: UICommand) => void> = [];
  private captureCb: ((code: string) => void) | null = null;
  /** Rebinding: also accept mouse buttons (keyboard & mouse layout). */
  private captureMouse = false;
  private padCaptureCb: ((button: number) => void) | null = null;
  gamepadName: string | null = null;
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';
  /** When false (menus), gameplay keys don't affect the frame. */
  gameplayActive = false;

  constructor(
    private settings: Settings,
    private target: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    // Capture phase, so a click used to rebind never also presses the UI button underneath.
    window.addEventListener('mousedown', this.onCaptureMouse, true);
    // Right / middle click on the pitch are game buttons when bound: no context menu, no autoscroll.
    target.addEventListener('contextmenu', (e) => {
      if (this.usesMouse()) e.preventDefault();
    });
    target.addEventListener('auxclick', (e) => {
      if (this.usesMouse()) e.preventDefault();
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadName = (e as GamepadEvent).gamepad?.id ?? this.gamepadName;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadName = null;
    });
  }

  setSettings(s: Settings): void {
    this.settings = s;
  }

  onUI(cb: (c: UICommand) => void): () => void {
    this.uiListeners.push(cb);
    return () => {
      this.uiListeners = this.uiListeners.filter((x) => x !== cb);
    };
  }

  private emitUI(c: UICommand): void {
    for (const l of this.uiListeners.slice()) l(c);
  }

  /** Capture the next key press (for rebinding); `mouse` also accepts a mouse button. */
  captureNextKey(cb: (code: string) => void, mouse = false): void {
    this.captureCb = cb;
    this.captureMouse = mouse;
  }

  /** Capture the next controller button press (for remapping). */
  captureNextPadButton(cb: (button: number) => void): void {
    this.padCaptureCb = cb;
  }

  cancelCapture(): void {
    this.captureCb = null;
    this.padCaptureCb = null;
  }

  private bindings(): Record<KeyAction, string[]> {
    return activeBindings(this.settings);
  }

  /** True when any gameplay action is on a mouse button. */
  usesMouse(): boolean {
    const b = this.bindings();
    for (const k in b) if (b[k as KeyAction].some((c) => c.startsWith('Mouse'))) return true;
    return false;
  }

  private bound(action: KeyAction, code: string): boolean {
    return this.bindings()[action]?.includes(code) ?? false;
  }

  private onCaptureMouse = (e: MouseEvent): void => {
    if (!this.captureCb || !this.captureMouse) return;
    e.preventDefault();
    e.stopPropagation();
    // Swallow the click that follows this press too.
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.addEventListener('contextmenu', swallow, { capture: true, once: true });
    setTimeout(() => {
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('contextmenu', swallow, true);
    }, 500);
    const cb = this.captureCb;
    this.captureCb = null;
    cb(`Mouse${e.button}`);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.captureCb) {
      e.preventDefault();
      const cb = this.captureCb;
      this.captureCb = null;
      cb(e.code);
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    this.lastDevice = 'keyboard';
    if (!e.repeat) {
      // In menus the UI treats 'pause' as "back".
      if (this.bound('pause', e.code)) this.emitUI('pause');
      if (this.bound('camera', e.code)) this.emitUI('camera');
      if (this.bound('reset', e.code)) this.emitUI('reset');
    }
    if (this.gameplayActive) {
      // Prevent page scrolling with arrows/space during play.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    }
    if (!e.repeat && this.gameplayActive) {
      this.onGameplayInput?.(e.timeStamp || performance.now());
      this.stampEvent(e.timeStamp || performance.now());
    }
    this.keys.add(e.code);
    this.tapped.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.gameplayActive && this.keys.has(e.code)) {
      this.onGameplayInput?.(e.timeStamp || performance.now());
      this.stampEvent(e.timeStamp || performance.now());
    }
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private onMouseMove = (e: MouseEvent): void => {
    const r = this.target.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.mouse.inside = true;
  };

  /** Mouse buttons are binding codes (Mouse0–4) handled like keys — only on the game canvas, never on UI. */
  private onMouseDown = (e: MouseEvent): void => {
    if (!this.gameplayActive) return;
    const code = `Mouse${e.button}`;
    if (e.button === 1 && this.usesMouse()) e.preventDefault(); // no autoscroll
    this.lastDevice = 'keyboard';
    this.onGameplayInput?.(e.timeStamp || performance.now());
    this.stampEvent(e.timeStamp || performance.now());
    this.keys.add(code);
    this.tapped.add(code);
  };

  private onMouseUp = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    if (this.gameplayActive && this.keys.has(code)) {
      this.onGameplayInput?.(e.timeStamp || performance.now());
      this.stampEvent(e.timeStamp || performance.now());
    }
    this.keys.delete(code);
  };

  /** Mouse position in normalised device coordinates (for aim ray casting). */
  get mouseNDC(): { x: number; y: number } | null {
    return this.settings.mouseAim && this.mouse.inside ? { x: this.mouse.x, y: this.mouse.y } : null;
  }

  private activePad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /**
   * Sample all devices. `fwd` and `right` are the camera's ground-plane axes so that
   * "up" always moves away from the camera.
   */
  poll(fwd: { x: number; z: number }, right: { x: number; z: number }): InputFrame {
    const f = this.frame;
    const now = performance.now() / 1000;
    const k = this.keys;
    const tapped = this.tapped;
    const kb = this.bindings();
    const any = (a: KeyAction) => kb[a].some((c) => k.has(c) || tapped.has(c));
    const pb = this.settings.padBindings;
    let mx = (any('right') ? 1 : 0) - (any('left') ? 1 : 0);
    let my = (any('up') ? 1 : 0) - (any('down') ? 1 : 0);
    let sprint = any('sprint');
    const padDown: boolean[] = [];

    const pad = this.activePad();
    if (pad) {
      for (let i = 0; i < pad.buttons.length; i++) padDown[i] = pad.buttons[i].pressed || pad.buttons[i].value > 0.4;
      const ax = pad.axes[0] ?? 0,
        ay = pad.axes[1] ?? 0;
      const mag = Math.hypot(ax, ay);
      const dead = 0.18;
      if (mag > dead) {
        const scaled = Math.min(1, (mag - dead) / (1 - dead));
        mx += (ax / mag) * scaled;
        my += (-ay / mag) * scaled;
        this.lastDevice = 'gamepad';
      }
      if (padDown[PAD.LEFT]) mx -= 1;
      if (padDown[PAD.RIGHT]) mx += 1;
      if (padDown[PAD.UP]) my += 1;
      if (padDown[PAD.DOWN]) my -= 1;
      if (pb.sprint.some((i) => padDown[i])) sprint = true;
      if (padDown.some(Boolean)) this.lastDevice = 'gamepad';
      const edge = (i: number) => padDown[i] && !this.padPrev[i];
      // Remapping: the next pressed button is captured and does nothing else.
      let real: boolean[] | null = null;
      if (this.padCaptureCb) {
        const i = padDown.findIndex((d, j) => d && !this.padPrev[j]);
        if (i >= 0) {
          const cb = this.padCaptureCb;
          this.padCaptureCb = null;
          real = padDown.slice();
          padDown.fill(false);
          cb(i);
        }
      }
      // UI edges from the pad.
      if (edge(PAD.START)) this.emitUI('pause');
      if (edge(PAD.BACK)) this.emitUI('camera');
      if (edge(PAD.A)) this.emitUI('confirm');
      if (edge(PAD.B)) this.emitUI('back');
      if (edge(PAD.UP)) this.emitUI('navUp');
      if (edge(PAD.DOWN)) this.emitUI('navDown');
      if (edge(PAD.LEFT)) this.emitUI('navLeft');
      if (edge(PAD.RIGHT)) this.emitUI('navRight');
      if (edge(PAD.RS)) this.emitUI('reset');
      this.padPrev = real ?? padDown;
      this.gamepadName = pad.id;
      if (this.gameplayActive && this.onGameplayInput) {
        // Coarse change signature (quantised stick + buttons) to timestamp pad input for diagnostics.
        const sig = `${Math.round(ax * 8)},${Math.round(ay * 8)},${padDown.map((d) => (d ? 1 : 0)).join('')}`;
        if (sig !== this.padSig) {
          this.padSig = sig;
          this.onGameplayInput(pad.timestamp || performance.now());
          this.stampEvent(pad.timestamp || performance.now());
        }
      }
    }

    if (this.touch && this.touchActive) {
      const t = this.touch;
      if (t.lastEventT) {
        this.stampEvent(t.lastEventT);
        t.lastEventT = 0;
      }
      if (t.move.x !== 0 || t.move.y !== 0) {
        mx += t.move.x;
        my += t.move.y;
      }
      if (t.sprint) sprint = true;
    }
    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    if (!this.gameplayActive) {
      mx = 0;
      my = 0;
      sprint = false;
    }
    f.move.x = right.x * mx + fwd.x * my;
    f.move.z = right.z * mx + fwd.z * my;
    f.sprint = sprint;
    f.passOnPress = this.settings.controls === 'simple' || this.settings.passControl === 'responsive';
    f.shotOnPress = this.settings.controls === 'simple';
    f.defendScheme =
      this.touch && this.touchActive && !this.keys.size && this.lastDevice !== 'gamepad' ? 'direct' : this.lastDevice === 'gamepad' ? 'pad' : 'keys';

    // Latency diagnostics: what changed this poll, stamped with the real input event time.
    const ev = this.events;
    ev.t = this.eventT ?? now * 1000;
    ev.presses.length = 0;
    ev.releases.length = 0;
    {
      const l = Math.hypot(f.move.x, f.move.z),
        pl = Math.hypot(this.lastMoveDir.x, this.lastMoveDir.z);
      let changed = false;
      if (l > 0.2 && pl <= 0.2) changed = true;
      else if (l > 0.2 && pl > 0.2) changed = (f.move.x * this.lastMoveDir.x + f.move.z * this.lastMoveDir.z) / (l * pl) < Math.cos((35 * Math.PI) / 180);
      ev.moveChanged = changed;
      this.lastMoveDir.x = f.move.x;
      this.lastMoveDir.z = f.move.z;
    }
    for (const a of ACTIONS) {
      let down = any(a) || pb[a as PadAction].some((i) => padDown[i]);
      if (this.touch && this.touchActive && a !== 'skill' && this.touch.isDown(a as TouchAction)) down = true;
      if (!this.gameplayActive) down = false;
      const b = f.buttons[a];
      const prev = this.prevDown[a];
      if (down && !prev) {
        ev.presses.push(a);
        b.pressed = true;
        this.holdStart[a] = now;
      }
      if (!down && prev) {
        ev.releases.push(a);
        b.released = true;
        b.held = now - this.holdStart[a];
      } else if (down) {
        b.held = now - this.holdStart[a];
      }
      b.down = down;
      this.prevDown[a] = down;
    }
    tapped.clear();
    this.touch?.endPoll();
    this.eventT = null;
    return f;
  }

  /** Rumble the controller if supported (Chrome's vibrationActuator). */
  vibrate(strong: number, weak: number, ms: number): void {
    if (!this.settings.vibration) return;
    const pad = this.activePad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
    try {
      pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => undefined);
    } catch {
      /* unsupported */
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousedown', this.onCaptureMouse, true);
  }
}
