/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Public-repository hygiene. Checks every file that is (or would be) committed — tracked files plus new
// files not ignored by .gitignore — and the commit history, for things that shouldn't be published:
//   - profiling exports (the game's F3/benchmark/CPU-check JSON, Chrome traces, CPU profiles, heap snapshots)
//   - generated output (dist/, screenshots/, test results, logs, release/) and unexpectedly large files
//   - hosting-platform deploy configuration (netlify.toml and similar) and private .local/ files
//   - private filesystem paths (home directories) and secrets (tokens, private keys)
//   - email addresses other than the project's public contacts and licence-notice authors
//   - AI-vendor signatures or co-author trailers written into files (in commit messages they are only reported)
//   node scripts/check-repo-hygiene.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { checkMessage, messageWarnings } from './check-commit-message.mjs';

const root = new URL('..', import.meta.url).pathname;
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
const problems = [];

const PROFILING = [
  // In-game exports (F3 panel, ?bench, CPU check, saved player data). Both the current file prefix
  // (BRAND.filePrefix in src/brand.ts) and the previous one; add the new prefix here after a rename.
  /(^|\/)(floodlight|open-clutch-xi)-(benchmark|perf|cpucheck|player-data)-[^/]*\.json$/,
  /\.(cpuprofile|heapsnapshot|heapprofile|heaptimeline|trace)$/i,
  /(^|\/)Trace-[^/]*\.json(\.gz)?$/, // Chrome DevTools performance recordings
  /(^|\/)benchmark\//,
];
const GENERATED = [/^dist\//, /^screenshots\//, /^test-results\//, /^coverage\//, /(^|\/)node_modules\//, /\.log$/, /^\.vite\//, /^asset-src\//];
// The public project is independent of any hosting platform: deploy configuration belongs to the sites
// that host it (see docs/development/hosting.md). Private working files and release output stay local.
const HOSTING = [/(^|\/)netlify\.toml$/, /(^|\/)\.netlify\//, /(^|\/)vercel\.json$/, /(^|\/)\.vercel\//, /(^|\/)_redirects$/];
const PRIVATE = [/^\.local\//, /^release\//];
const BINARY = /\.(png|jpe?g|webp|glb|mp3|woff2?|ico|gif|mp4|webm)$/i;
const MAX_BYTES = 3 * 1024 * 1024;

// Patterns are assembled from pieces so this file doesn't match itself.
const HOME = new RegExp(['(/home/[a-z][\\w.-]+/', '|/Users/[A-Za-z][\\w.-]+/', '|[A-Za-z]:\\\\Users\\\\', '|/tmp/claude-)'].join(''));
const SECRETS = [
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', new RegExp('-----BEGIN ' + '(RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY')],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['API key', /\bsk-(ant-)?[A-Za-z0-9_-]{32,}/],
  ['Netlify token', /\bnfp_[A-Za-z0-9]{30,}/],
  ['credential assignment', /\b(api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9/+_-]{16,}['"]/i],
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Public project contact; addresses that appear inside third-party licence notices; generic placeholders.
// (git@github.com is GitHub's SSH host in remote URLs, not a person's address.)
const EMAIL_OK = new Set(['info@chrisguindon.com', 'arseny.kapoulkine@gmail.com', 'noreply@github.com', 'git@github.com']);
const EMAIL_OK_FILES = /^(LICENSE|CODE_OF_CONDUCT\.md|NOTICE\.md|public\/NOTICE\.txt|public\/assets\/flags\/LICENSE-flag-icons\.txt)$/;
// The commit-message checker and its tests must contain example trailers, signatures and the AI vendor's
// no-reply address in order to reject them. Exempt exactly those two files, nothing else.
const AI_FIXTURE_FILES = /^(scripts\/check-commit-message\.mjs|tests\/commit-message\.test\.ts)$/;
const AI_SIGNATURE = new RegExp(
  ['co-authored-by:.*\\b(claude|anthropic|openai|chatgpt|copilot|gemini)\\b', '|generated with \\[?(claude|chatgpt|copilot)'].join(''),
  'i',
);

for (const f of files) {
  if (PROFILING.some((r) => r.test(f))) problems.push(`profiling export or personal data file: ${f}`);
  if (GENERATED.some((r) => r.test(f))) problems.push(`generated file (should be ignored): ${f}`);
  if (HOSTING.some((r) => r.test(f))) problems.push(`hosting-platform configuration (belongs in the deploying site's own repository): ${f}`);
  if (PRIVATE.some((r) => r.test(f))) problems.push(`private working file or release output: ${f}`);
  let size;
  try {
    size = statSync(root + f).size;
  } catch {
    continue; // deleted in the working tree
  }
  if (size > MAX_BYTES) problems.push(`large file (${(size / 1048576).toFixed(1)} MB): ${f}`);
  if (BINARY.test(f) || f === 'package-lock.json' || f === 'tools/lint/package-lock.json') continue;
  const text = readFileSync(root + f, 'utf8');
  if (f === 'scripts/check-repo-hygiene.mjs') continue;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    if (HOME.test(line)) problems.push(`private filesystem path at ${at}`);
    for (const [what, re] of SECRETS) if (re.test(line)) problems.push(`possible ${what} at ${at}`);
    if (AI_SIGNATURE.test(line) && !AI_FIXTURE_FILES.test(f)) problems.push(`AI-vendor signature or co-author trailer at ${at}`);
    if (!EMAIL_OK_FILES.test(f) && !AI_FIXTURE_FILES.test(f))
      for (const m of line.match(EMAIL) ?? [])
        if (!EMAIL_OK.has(m.toLowerCase()) && !/@(example\.(com|org)|users\.noreply\.github\.com)$/.test(m)) problems.push(`email address ${m} at ${at}`);
  });
}

// Commit history: messages follow Conventional Commits, and automatic AI attribution (co-author trailers,
// signatures or session links that tools such as GitHub Copilot add on their own) is reported. Both are
// warnings only: early history may predate the rules, and AI tools add trailers by themselves.
let commits = [];
try {
  commits = git('log', '--format=%H%x1f%B%x1e')
    .split('\x1e')
    .map((c) => c.trim())
    .filter(Boolean);
} catch {
  /* no commits yet */
}
let nonConventional = 0;
const aiTrailers = [];
for (const c of commits) {
  const [sha, msg] = c.split('\x1f');
  if (checkMessage(msg ?? '').length) nonConventional++;
  if (messageWarnings(msg ?? '').length) aiTrailers.push(sha.slice(0, 8));
}

console.log(`checked ${files.length} files and ${commits.length} commits`);
if (nonConventional) console.warn(`! ${nonConventional} commit message(s) don't follow Conventional Commits (squash-merge titles are checked in CI)`);
if (aiTrailers.length)
  console.warn(
    `! ${aiTrailers.length} commit(s) carry automatic AI attribution (allowed; can be removed when squash-merging): ${aiTrailers.slice(0, 5).join(', ')}${aiTrailers.length > 5 ? ', …' : ''}`,
  );
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ repository hygiene check passed');
