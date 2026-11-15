/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// One-time setup after creating the GitHub repository: replaces the placeholder repository URL everywhere
// (package.json, README, issue chooser links, docs) so the game's About screen and docs link to the source.
//   node scripts/set-repo-url.mjs https://github.com/<owner>/<repo>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLACEHOLDER = 'https://github.com/OWNER/open-clutch-xi';
const url = (process.argv[2] ?? '').replace(/\.git$/, '').replace(/\/$/, '');
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url)) {
  console.error('usage: node scripts/set-repo-url.mjs https://github.com/<owner>/<repo>');
  process.exit(2);
}
const root = new URL('..', import.meta.url).pathname;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(md|ya?ml|json|ts|mjs)$/.test(f) && f !== 'scripts/set-repo-url.mjs' && !f.includes('check-github-config'));
let changed = 0;
for (const f of files) {
  const p = root + f;
  const s = readFileSync(p, 'utf8');
  if (s.includes(PLACEHOLDER)) {
    writeFileSync(p, s.split(PLACEHOLDER).join(url));
    changed++;
    console.log(`updated ${f}`);
  }
}
// NOTICE.md changed: regenerate its served plain-text copy.
execFileSync('node', ['scripts/check-licenses.mjs', '--write'], { cwd: root, stdio: 'inherit' });
console.log(`${changed} files updated. Review, then commit when you're ready, e.g. "chore: set repository URL".`);
