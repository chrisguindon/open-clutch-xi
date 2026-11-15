/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Cross-platform `VAR=value command …` for npm scripts (Windows shells don't support that syntax).
//   node scripts/run-with-env.mjs METRICS=1 vitest run tests/tools/metrics-report.test.ts
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const env = { ...process.env };
while (args.length && /^[A-Z_][A-Z0-9_]*=/.test(args[0])) {
  const [k, ...v] = args.shift().split('=');
  env[k] = v.join('=');
}
if (!args.length) {
  console.error('usage: run-with-env.mjs VAR=value command [args…]');
  process.exit(2);
}
const r = spawnSync(args[0], args.slice(1), { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
