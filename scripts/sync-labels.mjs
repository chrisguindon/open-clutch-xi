/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Creates or updates the labels in .github/labels.yml using the GitHub CLI. Maintainers only.
//   node scripts/sync-labels.mjs            dry run: prints the gh commands
//   node scripts/sync-labels.mjs --apply    runs them against the current repository (gh auth login first)
// Existing labels not in the file are left alone (nothing is deleted).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const labels = parse(readFileSync(new URL('../.github/labels.yml', import.meta.url), 'utf8'));
const apply = process.argv.includes('--apply');
for (const l of labels) {
  const args = ['label', 'create', l.name, '--color', l.color, '--description', l.description, '--force'];
  if (!apply) {
    console.log(`gh ${args.map((a) => (/\s|:/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    continue;
  }
  const r = spawnSync('gh', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!apply) console.log(`\n${labels.length} labels. Re-run with --apply to create/update them.`);
