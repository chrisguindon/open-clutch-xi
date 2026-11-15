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
//   node scripts/release-check.mjs --from <dir>   validate the files in <dir> instead of this working
//                                     tree (used by scripts/release.mjs to check a prepared release
//                                     before touching the working tree)
//
// Steps:
//   1. version consistency
//   2. clean copy and install
//   3. npm run ci (format, lint, types, tests, build, licence / repo / docs / GitHub checks)
//   3b. release notes: every link resolves (as it will be published, pointing at the tag)
//   4. browser smoke test and rules flow
//   5. production-build check
//   6. release artefacts (web and source archives, SHA256SUMS), packaged twice to prove reproducibility
//   7. SBOM
//   8. npm audit (runtime dependencies)
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_BROWSER_HELP, locateChrome } from './lib/chrome.mjs';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const here = args.includes('--here');
const browser = !args.includes('--no-browser');
const fromIdx = args.indexOf('--from');
// Where the files to validate come from: this working tree, or a prepared copy.
const source = fromIdx >= 0 ? args[fromIdx + 1] : root;
if (fromIdx >= 0 && (!source || !existsSync(join(source, 'package.json')))) {
  console.error('usage: node scripts/release-check.mjs --from <directory with the files to validate>');
  process.exit(2);
}
if (fromIdx >= 0 && here) {
  console.error('--from and --here cannot be combined');
  process.exit(2);
}
// The browser checks run inside the clean copy, which has no .cache/browsers/: find the browser here,
// once, and hand it to every step. Stop now, not after the install and tests, if there is none.
if (browser) {
  const chrome = locateChrome();
  if (!chrome) {
    console.error(`✗ ${NO_BROWSER_HELP}
  (Or skip the browser checks with --no-browser, which is not enough for a release.)`);
    process.exit(2);
  }
  process.env.CHROME_PATH = chrome;
  console.log(`Browser for the browser checks: ${chrome}`);
}
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
const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
const v = pkg.version;
step(`version ${v} is consistent`, () => {
  const lock = JSON.parse(readFileSync(join(source, 'package-lock.json'), 'utf8'));
  if (lock.version !== v || lock.packages[''].version !== v) throw new Error(`package-lock.json has ${lock.version}`);
  const changelog = readFileSync(join(source, 'CHANGELOG.md'), 'utf8');
  if (!changelog.includes(`[${v}]`) && !changelog.includes('[Unreleased]')) throw new Error('CHANGELOG.md has neither this version nor Unreleased');
  if (!existsSync(join(source, 'docs/releases', `v${v}.md`))) throw new Error(`docs/releases/v${v}.md is missing`);
  // The About screen reads the version from package.json at build time (vite.config.ts → __APP_VERSION__).
  if (!readFileSync(join(source, 'vite.config.ts'), 'utf8').includes('__APP_VERSION__')) throw new Error('vite.config.ts no longer injects __APP_VERSION__');
});

// 2. Clean copy of what would be committed (tracked + untracked, not ignored), then a fresh install.
let dir = root;
if (!here) {
  step('clean copy and fresh install', () => {
    dir = mkdtempSync(join(tmpdir(), 'floodlight-release-'));
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: source, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    for (const f of files) if (existsSync(join(source, f))) cpSync(join(source, f), join(dir, f), { recursive: true });
    run('git', ['init', '-q'], dir);
    run(npm, ['ci', '--no-audit', '--no-fund'], dir);
    run(npm, ['ci', '--prefix', 'tools/lint', '--no-audit', '--no-fund'], dir);
  });
}

step('npm run ci', () => run(npm, ['run', 'ci'], dir));
// The notes published on GitHub get absolute links to the release tag; check each target exists.
step(`release notes links (docs/releases/v${v}.md)`, () => run('node', ['scripts/release-notes.mjs', v, '--check'], dir));
if (browser) {
  step('browser smoke test', () => run('node', ['scripts/browser-smoke.mjs'], dir));
  step('browser rules flow', () => run('node', ['scripts/rules-check.mjs'], dir));
  // Builds first, so this check stands on its own (it used to fail as a side effect when `npm run ci`
  // stopped before its build step, which hid the real failure).
  step('production build check', () => {
    run(npm, ['run', 'build'], dir);
    run('node', ['scripts/prod-check.mjs'], dir);
  });
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
