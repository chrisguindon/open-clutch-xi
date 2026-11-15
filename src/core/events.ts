/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/** Tiny typed event emitter used to decouple simulation from presentation (audio, UI, effects). */
export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private handlers: { [K in keyof Events]?: Array<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    (this.handlers[type] ??= []).push(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): void {
    const list = this.handlers[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (const fn of list.slice()) fn(payload);
  }

  clear(): void {
    this.handlers = {};
  }
}
