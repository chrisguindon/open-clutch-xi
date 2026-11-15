/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Types for triage.mjs (used by tests/triage.test.ts).
export function parseForm(body: string | undefined): Record<string, string>;
export function triage(issue: { title?: string; body?: string; labels?: string[] }): { add: string[]; thin: string[] };
export const MODULES: Record<string, string[]>;
export function planComment(labels: string[]): string;
