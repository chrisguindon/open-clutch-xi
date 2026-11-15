/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Documentation checks:
//   - the community health files exist and start with a heading
//   - every relative link in every Markdown file points to an existing file, and #anchors to an existing heading
//   - the README links to the playable game, CLAUDE.md defers to AGENTS.md
//   node scripts/check-docs.mjs              internal links only (fast, offline; used in CI)
//   node scripts/check-docs.mjs --external   also checks external https links (needs network; may be flaky)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { headingAnchors } from './lib/release-notes.mjs';

const root = new URL('..', import.meta.url).pathname;
const problems = [];
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.md'));

const REQUIRED = ['README.md', 'NOTICE.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'GOVERNANCE.md', 'CHANGELOG.md', 'AGENTS.md', 'CLAUDE.md'];
for (const f of REQUIRED) {
  if (!existsSync(join(root, f))) problems.push(`missing ${f}`);
  else if (
    !/^#\s+\S/m.test(
      readFileSync(join(root, f), 'utf8')
        .split('\n')
        .find((l) => l.trim()) ?? '',
    )
  )
    problems.push(`${f} should start with a "# " heading`);
}
if (!existsSync(join(root, 'LICENSE'))) problems.push('missing LICENSE');

const anchorsCache = new Map();
/** GitHub-style heading anchors of a Markdown file (shared with the release-notes check). */
function anchors(file) {
  if (!anchorsCache.has(file)) anchorsCache.set(file, headingAnchors(readFileSync(file, 'utf8')));
  return anchorsCache.get(file);
}

const external = new Set();
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
  const links = [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g), ...text.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1]);
  for (const link of links) {
    if (/^https?:\/\//.test(link)) {
      external.add(link);
      continue;
    }
    if (/^(mailto:|#$)/.test(link)) continue;
    const [path, anchor] = link.split('#');
    const target = path ? normalize(join(dirname(join(root, f)), decodeURIComponent(path))) : join(root, f);
    if (path && !existsSync(target)) {
      problems.push(`${f}: broken link → ${link}`);
      continue;
    }
    if (anchor && target.endsWith('.md') && statSync(target).isFile() && !anchors(target).has(anchor.toLowerCase()))
      problems.push(`${f}: missing anchor → ${link}`);
  }
}

const readme = readFileSync(join(root, 'README.md'), 'utf8');
if (!readme.includes('https://github.com/chrisguindon/open-clutch-xi'))
  problems.push('README.md should link to the source repository (https://github.com/chrisguindon/open-clutch-xi)');
if (existsSync(join(root, 'CLAUDE.md')) && !readFileSync(join(root, 'CLAUDE.md'), 'utf8').includes('AGENTS.md'))
  problems.push('CLAUDE.md should refer to AGENTS.md (single source of agent instructions)');

if (process.argv.includes('--external')) {
  for (const url of external) {
    if (url.includes('github.com/OWNER/')) continue;
    try {
      const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
      if (r.status >= 400 && r.status !== 405 && r.status !== 403) problems.push(`external link ${r.status}: ${url}`);
    } catch (e) {
      problems.push(`external link failed (${e.name}): ${url}`);
    }
  }
}

console.log(
  `checked ${files.length} Markdown files (${external.size} external links${process.argv.includes('--external') ? ' checked' : ' not checked; use --external'})`,
);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ documentation checks passed');
