/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Reproducible release validation. It does NOT commit, tag, push, deploy or publish anything.
//   npm run release:check              validate the working tree in a clean copy (fresh `npm ci`)
//   npm run release:check -- --here    validate in place (faster; uses the existing node_modules)
//   npm run release:check -- --no-browser   skip the headless-browser checks
//
// Steps:
//   1. version consistency
//   2. clean copy and install
//   3. npm run ci (format, lint, types, tests, build, licence / repo / docs / GitHub checks)
//   4. browser smoke test and rules flow
//   5. production-build check
//   6. release artefacts (web and source archives, SHA256SUMS), packaged twice to prove reproducibility
//   7. SBOM
//   8. npm audit (runtime dependencies)
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const here = args.includes('--here');
const browser = !args.includes('--no-browser');
const failures = [];
const step = (name, fn) => {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    failures.push(name);
  }
};
const run = (cmd, argv, cwd) => {
  const r = spawnSync(cmd, argv, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} exited with ${r.status}`);
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// 1. One authoritative version: package.json. Everything else must agree.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const v = pkg.version;
step(`version ${v} is consistent`, () => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  if (lock.version !== v || lock.packages[''].version !== v) throw new Error(`package-lock.json has ${lock.version}`);
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  if (!changelog.includes(`[${v}]`) && !changelog.includes('[Unreleased]')) throw new Error('CHANGELOG.md has neither this version nor Unreleased');
  if (!existsSync(join(root, 'docs/releases', `v${v}.md`))) throw new Error(`docs/releases/v${v}.md is missing`);
  // The About screen reads the version from package.json at build time (vite.config.ts → __APP_VERSION__).
  if (!readFileSync(join(root, 'vite.config.ts'), 'utf8').includes('__APP_VERSION__')) throw new Error('vite.config.ts no longer injects __APP_VERSION__');
});

// 2. Clean copy of what would be committed (tracked + untracked, not ignored), then a fresh install.
let dir = root;
if (!here) {
  step('clean copy and fresh install', () => {
    dir = mkdtempSync(join(tmpdir(), 'floodlight-release-'));
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const f of files) if (existsSync(join(root, f))) cpSync(join(root, f), join(dir, f), { recursive: true });
    run('git', ['init', '-q'], dir);
    run(npm, ['ci', '--no-audit', '--no-fund'], dir);
    run(npm, ['ci', '--prefix', 'tools/lint', '--no-audit', '--no-fund'], dir);
  });
}

step('npm run ci', () => run(npm, ['run', 'ci'], dir));
if (browser) {
  step('browser smoke test', () => run('node', ['scripts/browser-smoke.mjs'], dir));
  step('browser rules flow', () => run('node', ['scripts/rules-check.mjs'], dir));
  step('production build check', () => run('node', ['scripts/prod-check.mjs'], dir));
}
step('release artefacts are reproducible', () => {
  // Package the validated copy twice (the second time from a fresh build) and compare the bytes. The
  // copy has no Git history, so the source commit and timestamp come from this repository.
  const head = spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const env = {
    ...process.env,
    SOURCE_COMMIT: head,
    SOURCE_DATE_EPOCH: execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8' }).trim(),
  };
  const pack = () => {
    const r = spawnSync('node', ['scripts/package-web.mjs', '--no-source'], { cwd: dir, stdio: 'inherit', env });
    if (r.status !== 0) throw new Error('packaging failed');
    return readFileSync(join(dir, 'release', 'SHA256SUMS'), 'utf8');
  };
  const first = pack();
  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  if (pack() !== first) throw new Error('two builds of the same source gave different archives');
  if (dir !== root) cpSync(join(dir, 'release', `${pkg.name}-v${v}-web.tar.gz`), join(root, 'release', `${pkg.name}-v${v}-web.tar.gz`));
  // The source archive is the committed HEAD of this repository (uncommitted changes are not included).
  run('node', ['scripts/package-web.mjs', '--source-only'], root);
});
step('SBOM', () => run('node', ['scripts/generate-sbom.mjs', '--out', join(root, 'release', `${pkg.name}-${v}.cdx.json`)], dir));
step('npm audit (runtime dependencies)', () => run(npm, ['audit', '--omit=dev', '--audit-level=moderate'], dir));

if (!here && dir !== root) rmSync(dir, { recursive: true, force: true });
console.log(
  failures.length ? `\n✗ release validation failed: ${failures.join(', ')}` : `\n✓ release ${v} validated. Nothing was committed, tagged, pushed or published.`,
);
process.exit(failures.length ? 1 : 0);
