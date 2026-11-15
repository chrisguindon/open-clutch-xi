/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// The release tool (scripts/release.mjs, `make release-prepare` / `make release-publish`): its text edits,
// and a full prepare → merge → publish run in a throwaway copy of this repository, pushing to a local
// bare repository and with a fake `gh` that only records what it was asked to do. Nothing touches the
// network or this repository.
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
// @ts-expect-error -- plain JavaScript build helper without type declarations
import { compareVersions, finaliseNotes, isDraftNotes, parseVersion, releaseJsonSnippet, rollChangelog } from '../scripts/lib/release-lib.mjs';

const REPO = 'https://github.com/example/open-clutch-xi';

describe('release helpers', () => {
  it('accepts exact versions only, and orders them', () => {
    expect(parseVersion('0.2.0')?.text).toBe('0.2.0');
    for (const bad of ['latest', '^0.2.0', 'v0.2.0', '0.2', '01.2.3', '']) expect(parseVersion(bad), bad).toBeNull();
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  const changelog = `# Changelog\n\nIntro.\n\n## [Unreleased]\n\n### Added\n- A thing.\n\n## [0.1.0] - 2026-11-20\n\n- First.\n\n[Unreleased]: ${REPO}/compare/v0.1.0...HEAD\n[0.1.0]: ${REPO}/releases/tag/v0.1.0\n`;

  it('moves Unreleased under the new version and updates the links', () => {
    const out = rollChangelog(changelog, '0.2.0', '2026-12-01', REPO);
    expect(out).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-12-01\n\n### Added\n- A thing.\n\n## [0.1.0] - 2026-11-20');
    expect(out).toContain(`[Unreleased]: ${REPO}/compare/v0.2.0...HEAD\n[0.2.0]: ${REPO}/releases/tag/v0.2.0\n[0.1.0]:`);
  });

  it('refuses an empty Unreleased section or a version already released', () => {
    const empty = rollChangelog(changelog, '0.2.0', '2026-12-01', REPO);
    expect(() => rollChangelog(empty, '0.3.0', '2026-12-02', REPO)).toThrow(/empty/);
    expect(() => rollChangelog(changelog, '0.1.0', '2026-12-01', REPO)).toThrow(/already/);
    expect(() => rollChangelog('# Changelog\n', '0.2.0', '2026-12-01', REPO)).toThrow(/Unreleased/);
  });

  it('turns draft release notes into final ones', () => {
    const draft = '# Open Clutch XI 0.2.0: draft release notes\n\n> **Draft.** Nothing has been released.\n> More draft text.\n\nThe notes.\n';
    expect(isDraftNotes(draft)).toBe(true);
    const final = finaliseNotes(draft);
    expect(final).toBe('# Open Clutch XI 0.2.0\n\nThe notes.\n');
    expect(isDraftNotes(final)).toBe(false);
    expect(finaliseNotes(final)).toBe(final);
  });

  it('prints the release.json lines for a hosting site', () => {
    const json = JSON.parse(releaseJsonSnippet('open-clutch-xi', '0.2.0', REPO, 'a'.repeat(64)));
    expect(json).toEqual({
      project: 'open-clutch-xi',
      version: '0.2.0',
      artifact: 'open-clutch-xi-v0.2.0-web.tar.gz',
      url: `${REPO}/releases/download/v0.2.0/open-clutch-xi-v0.2.0-web.tar.gz`,
      sha256: 'a'.repeat(64),
    });
  });
});

describe.skipIf(process.platform === 'win32')('release tool end to end (local copy, fake GitHub)', () => {
  it('prepares, then publishes a release, and refuses to publish it twice', () => {
    const root = resolve('.');
    const tmp = mkdtempSync(join(tmpdir(), 'release-tool-'));
    try {
      const bare = join(tmp, 'origin.git'),
        work = join(tmp, 'work'),
        bin = join(tmp, 'bin'),
        ghLog = join(tmp, 'gh.log');
      const run = (cmd: string, args: string[], cwd = work) => execFileSync(cmd, args, { cwd, encoding: 'utf8' });
      // The fixture is built from the files in the current directory, not from its Git history: during
      // `npm run release:check` the tests run in a clean copy that has no commits at all. Generated,
      // private and installed folders are left out; node_modules is linked.
      const SKIP = /^(\.git|node_modules|dist|release|\.local|\.cache|screenshots|test-results|coverage|asset-src)$/;
      cpSync(root, work, {
        recursive: true,
        filter: (src) => {
          const rel = relative(root, src);
          return rel === '' || (!SKIP.test(rel.split(sep)[0]) && !rel.startsWith(join('tools', 'lint', 'node_modules')));
        },
      });
      symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'));
      // Release notes for the new version, written here (the test doesn't depend on any particular
      // notes file existing): a draft, as a maintainer would leave them.
      writeFileSync(join(work, 'docs/releases/v9.9.9.md'), '# Open Clutch XI 9.9.9: draft release notes\n\n> **Draft.** Not released yet.\n\nThe notes.\n');
      run('git', ['init', '-q', '-b', 'main']);
      run('git', ['config', 'user.name', 'Release Test']);
      run('git', ['config', 'user.email', 'release-test@localhost']);
      run('git', ['config', 'core.hooksPath', '/dev/null']);
      run('git', ['add', '-A']);
      run('git', ['commit', '-q', '-m', 'chore: fixture']);
      run('git', ['init', '-q', '--bare', bare], tmp);
      run('git', ['remote', 'add', 'origin', bare]);
      run('git', ['push', '-q', '-u', 'origin', 'main']);
      // A fake gh: records its arguments, is "logged in", and remembers created releases.
      execFileSync('mkdir', ['-p', bin]);
      writeFileSync(
        join(bin, 'gh'),
        `#!/bin/sh\necho "$*" >> "${ghLog}"\ncase "$1 $2" in\n  "release view") grep -q "release create $3 " "${ghLog}" && exit 0; exit 1;;\nesac\nexit 0\n`,
      );
      chmodSync(join(bin, 'gh'), 0o755);
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SOURCE_DATE_EPOCH: '1700000000' };
      const release = (...args: string[]) => spawnSync('node', ['scripts/release.mjs', ...args], { cwd: work, encoding: 'utf8', env });

      // Without a browser, prepare stops before changing anything (no files, no branch).
      const noBrowser = spawnSync('node', ['scripts/release.mjs', 'prepare', '9.9.9', '--yes'], {
        cwd: work,
        encoding: 'utf8',
        env: { ...env, CHROME_PATH: join(tmp, 'no-such-browser') },
      });
      expect(noBrowser.status).not.toBe(0);
      expect(noBrowser.stderr).toMatch(/No Chrome|browsers:install/);
      expect(run('git', ['status', '--porcelain'])).toBe('');
      expect(run('git', ['branch', '--list', 'release/*'])).toBe('');

      // A dry run prepares and reports, but writes, commits and pushes nothing.
      const dry = release('prepare', '9.9.9', '--dry-run', '--skip-check');
      expect(dry.status, dry.stderr + dry.stdout).toBe(0);
      expect(dry.stdout).toMatch(/would write CHANGELOG\.md/);
      expect(run('git', ['status', '--porcelain'])).toBe('');
      expect(run('git', ['branch', '--list', 'release/*'])).toBe('');
      expect(existsSync(ghLog) ? readFileSync(ghLog, 'utf8') : '').not.toMatch(/pr create/);

      // prepare: version, changelog, notes, branch, push, pull request.
      const prep = release('prepare', '9.9.9', '--yes', '--skip-check');
      expect(prep.status, prep.stderr + prep.stdout).toBe(0);
      expect(JSON.parse(readFileSync(join(work, 'package.json'), 'utf8')).version).toBe('9.9.9');
      expect(readFileSync(join(work, 'CHANGELOG.md'), 'utf8')).toMatch(/^## \[9\.9\.9\] - \d{4}-\d{2}-\d{2}$/m);
      expect(isDraftNotes(readFileSync(join(work, 'docs/releases/v9.9.9.md'), 'utf8'))).toBe(false);
      expect(run('git', ['branch', '--list', 'release/v9.9.9'], bare)).toContain('release/v9.9.9');
      expect(readFileSync(ghLog, 'utf8')).toMatch(/pr create .*--title chore\(release\): 9\.9\.9/);

      // The pull request is squash-merged.
      run('git', ['switch', '-q', 'main']);
      run('git', ['merge', '-q', '--squash', 'release/v9.9.9']);
      run('git', ['commit', '-q', '-m', 'chore(release): 9.9.9']);
      run('git', ['push', '-q', 'origin', 'main']);

      // publish: tag, artefacts from the tag, draft release with every file, release.json lines.
      const pub = release('publish', '9.9.9', '--yes');
      expect(pub.status, pub.stderr + pub.stdout).toBe(0);
      expect(run('git', ['tag', '--list'], bare)).toContain('v9.9.9');
      const log = readFileSync(ghLog, 'utf8');
      expect(log).toMatch(/release create v9\.9\.9 --draft --verify-tag/);
      for (const f of ['open-clutch-xi-v9.9.9-web.tar.gz', 'open-clutch-xi-v9.9.9-source.tar.gz', 'SHA256SUMS', 'open-clutch-xi-9.9.9.cdx.json']) {
        expect(log).toContain(f);
        expect(existsSync(join(work, 'release', f)), f).toBe(true);
      }
      const sha = readFileSync(join(work, 'release/SHA256SUMS'), 'utf8').match(/^([0-9a-f]{64}) {2}open-clutch-xi-v9\.9\.9-web\.tar\.gz$/m)![1];
      expect(pub.stdout).toContain(`"sha256": "${sha}"`);
      expect(log).not.toMatch(/--draft=false/); // --yes never publishes: that stays a human decision

      // Publishing the same version again is refused.
      const again = release('publish', '9.9.9', '--yes');
      expect(again.status).not.toBe(0);
      expect(again.stderr).toMatch(/already exists/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 180_000);
});
