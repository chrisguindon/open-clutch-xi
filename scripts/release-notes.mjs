/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Builds the release notes to publish on GitHub and checks every link (see scripts/lib/release-notes.mjs).
//   npm run release:notes -- 0.1.0              → release/release-notes-v0.1.0.md
//   npm run release:notes -- 0.1.0 --check      only check, write nothing
//   npm run release:notes -- 0.1.0 --worktree   check against the working tree, not the tag
//
// Where the notes and link targets are read from:
//   - the tag v<version>, when it exists: exactly what the release contains (used when publishing, and
//     to correct the notes of a published release);
//   - otherwise the working tree (before a release is tagged, e.g. in npm run release:check).
// Either way the links point at the tag, https://github.com/<owner>/<repo>/blob/v<version>/…, never main.
// Exits with 1 if any link is broken. Nothing is published.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publishedReleaseNotes } from './lib/release-notes.mjs';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: node scripts/release-notes.mjs <version> [--check] [--worktree]');
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repoUrl = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
if (!repoUrl.startsWith('https://github.com/')) {
  console.error('package.json has no GitHub repository URL');
  process.exit(2);
}
const tag = `v${version}`;
const notesPath = `docs/releases/${tag}.md`;
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
const useTag = !args.includes('--worktree') && git('rev-parse', '-q', '--verify', `refs/tags/${tag}`).status === 0;

/** What exists at a repository path, in the tag or the working tree. */
const kind = useTag
  ? (path) => {
      const r = git('cat-file', '-t', `${tag}:${path}`);
      return r.status !== 0 ? null : r.stdout.trim() === 'tree' ? 'dir' : 'file';
    }
  : (path) => (existsSync(join(root, path)) ? (statSync(join(root, path)).isDirectory() ? 'dir' : 'file') : null);
const read = useTag
  ? (path) => {
      const r = git('show', `${tag}:${path}`);
      return r.status === 0 ? r.stdout : null;
    }
  : (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);

const notes = read(notesPath);
if (notes === null) {
  console.error(`✗ ${notesPath} not found ${useTag ? `at ${tag}` : 'in the working tree'}`);
  process.exit(1);
}
const { text, links, problems } = publishedReleaseNotes(notes, { notesPath, repoUrl, tag, kind, read });
console.log(`Release notes for ${tag} (read from ${useTag ? `the tag ${tag}` : 'the working tree'}; links point at ${tag})`);
for (const l of links) console.log(`  ✓ ${l.from} → ${l.to}`);
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`✗ ${problems.length} broken link(s) in ${notesPath}`);
  process.exit(1);
}
if (!args.includes('--check')) {
  mkdirSync(join(root, 'release'), { recursive: true });
  const out = join('release', `release-notes-${tag}.md`);
  writeFileSync(join(root, out), text);
  console.log(`✓ ${links.length} link(s) checked; published notes written to ${out}`);
} else console.log(`✓ ${links.length} link(s) checked`);
