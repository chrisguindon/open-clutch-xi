/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// The platform-independent hosting policy (hosting/headers.json): which HTTP headers each path should
// be served with. Used by the production check's local server, and by tests that keep the policy strict.
// Any static host can apply the same rules in its own configuration format.
import { readFileSync } from 'node:fs';

/** Reads hosting/headers.json (relative to the repository root, or the given path). */
export function loadHostingPolicy(path = new URL('../../hosting/headers.json', import.meta.url)) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Converts a rule pattern such as `/assets/*.glb` to a regular expression (`*` = any characters). */
export function patternToRegExp(pattern) {
  return new RegExp(
    '^' +
      pattern
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
  );
}

/** All headers for a URL path, applying matching rules in order (later rules override earlier ones). */
export function headersFor(policy, path) {
  const out = {};
  for (const rule of policy.rules) if (patternToRegExp(rule.for).test(path)) Object.assign(out, rule.headers);
  return out;
}
