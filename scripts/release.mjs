/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Release automation for maintainers, in two steps that fit squash-merged pull requests:
//
//   node scripts/release.mjs status
//   node scripts/release.mjs prepare 0.2.0    (make release-prepare VERSION=0.2.0)
//   node scripts/release.mjs publish 0.2.0    (make release-publish VERSION=0.2.0)
//
// prepare: checks the repository (clean, except that the new release notes may be uncommitted, and a
//   browser is available for the browser checks); prepares the release files in a temporary copy
//   (version, the changelog's Unreleased section moved under the new version, final
//   docs/releases/v<version>.md) and runs the full release check on that copy. Only if it
//   passes does it write those exact files into the working tree, commit on a release/v<version>
//   branch, push it and open a pull request ("chore(release): <version>"). A failure changes nothing.
//   A dry run does everything up to and including the release check, then stops before writing.
// publish (after that pull request is merged): checks main is the merged release; creates and pushes the
//   annotated tag; builds the reproducible artefacts from the tag; creates a draft GitHub release with
//   them; offers to publish it; prints the release.json lines for a site that hosts the game.
//
// Options: --dry-run (run every check, including the full release check, but change nothing), --yes (don't ask before each remote or
// irreversible step), --skip-check (prepare without the full release check; not recommended).
// It never force-pushes, never moves or deletes a tag, and stops at the first problem.
// Needs: git, npm, and the GitHub CLI (gh) logged in (`gh auth login`).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { NO_BROWSER_HELP, locateChrome } from './lib/chrome.mjs';
import { compareVersions, finaliseNotes, isDraftNotes, parseVersion, releaseJsonSnippet, rollChangelog } from './lib/release-lib.mjs';

const root = new URL('..', import.meta.url).pathname;
const [command, versionArg, ...rest] = process.argv.slice(2);
const flags = new Set([versionArg, ...rest].filter((a) => a?.startsWith('--')));
const dryRun = flags.has('--dry-run');
const assumeYes = flags.has('--yes') || process.env.YES === '1';
const skipCheck = flags.has('--skip-check');
const version = versionArg?.startsWith('--') ? undefined : versionArg;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const pkg = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repoUrl = (pkg().repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
const project = pkg().name;

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
const step = (msg) => console.log(`\n▶ ${msg}`);
const ok = (msg) => console.log(`✓ ${msg}`);

/** Runs a command and returns its output; stops the release if it fails. */
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' && cmd === npm });
  if (r.status !== 0 && !opts.allowFail) fail(`${cmd} ${args.join(' ')} failed${r.stderr ? `:\n${r.stderr.trim()}` : ''}`);
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}
const git = (...args) => sh('git', args).out;

/** Runs a command that changes something (locally or remotely), or just shows it in a dry run. */
function act(cmd, args, opts = {}) {
  if (dryRun) {
    console.log(`  (dry run) ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    return { ok: true, out: '' };
  }
  return sh(cmd, args, opts);
}

/** Asks before a remote or irreversible step. Typing the version is required, so a stray Enter can't do it. */
async function confirm(question) {
  if (dryRun || assumeYes) return true;
  if (!process.stdin.isTTY) fail(`${question}\n  No terminal to ask in: re-run with --yes to confirm.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\n? ${question}\n  Type ${version} to continue, anything else to stop: `)).trim();
  rl.close();
  if (answer !== version) fail('Stopped. Nothing further was done.');
  return true;
}

function requireVersion() {
  if (!version || !parseVersion(version)) fail(`usage: node scripts/release.mjs ${command} <version>   (an exact version such as 0.2.0)`);
}

/**
 * Common preconditions: tools, the right branch, a clean tree in sync with origin, a free tag.
 * `allowUncommitted` lists files that may be new or changed (prepare: the release notes, which go into
 * the release commit, so writing them doesn't need a pull request of its own).
 */
function preflight({ wantVersionAtLeast = true, resumeTagAtHead = false, allowUncommitted = [] } = {}) {
  step('Checking the repository');
  if (!sh('gh', ['--version'], { allowFail: true }).ok) fail('the GitHub CLI (gh) is needed: https://cli.github.com/');
  if (!sh('gh', ['auth', 'status'], { allowFail: true }).ok) {
    if (dryRun) console.log('! gh is not logged in (gh auth login): the real run would stop here, before changing anything.');
    else fail('log in to GitHub first: gh auth login');
  }
  if (!repoUrl.startsWith('https://github.com/')) fail('package.json has no GitHub repository URL');
  if (!sh('git', ['remote', 'get-url', 'origin'], { allowFail: true }).ok)
    fail('this repository has no "origin" remote (see docs/development/github-setup.md)');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') fail(`switch to main first (you're on ${branch})`);
  const uncommitted = git('status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((f) => !allowUncommitted.includes(f));
  if (uncommitted.length)
    fail(
      `commit or stash your changes first: the working tree must be clean${allowUncommitted.length ? ` (only ${allowUncommitted.join(', ')} may be uncommitted)` : ''}\n  ${uncommitted.join('\n  ')}`,
    );
  sh('git', ['fetch', '--quiet', '--tags', 'origin']);
  const [behind, ahead] = git('rev-list', '--left-right', '--count', 'origin/main...HEAD').split(/\s+/).map(Number);
  if (behind > 0) fail(`main is ${behind} commit(s) behind origin/main${ahead ? ` and ${ahead} ahead` : ''}: pull first`);
  if (ahead > 0) {
    // Unpushed commits are a normal state before a release; a dry run checks them, a real run needs them on GitHub.
    if (dryRun) console.log(`! main has ${ahead} commit(s) not yet on GitHub: the real run needs them pushed first (git push).`);
    else fail(`main has ${ahead} commit(s) not yet on GitHub: push them first, so the release branch and tag build on what GitHub has`);
  }
  const localTag = sh('git', ['rev-parse', '-q', '--verify', `refs/tags/v${version}^{commit}`], { allowFail: true });
  const remoteTag = sh('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/v${version}`], { allowFail: true }).ok;
  if (localTag.ok || remoteTag) {
    // A publish interrupted after pushing the tag may continue, but only from exactly that commit.
    if (resumeTagAtHead && localTag.ok && localTag.out === git('rev-parse', 'HEAD')) {
      ok(`tag v${version} already points at this commit: continuing an interrupted publish`);
      return true;
    }
    fail(`tag v${version} already exists${remoteTag ? ' on GitHub' : ''}: releases are never moved or reused`);
  }
  const current = pkg().version;
  if (wantVersionAtLeast && compareVersions(version, current) < 0) fail(`${version} is lower than the current version ${current}`);
  ok(`main is clean and in sync with origin; v${version} is free (current version ${current})`);
  return false;
}

/**
 * Prepares the release files in a temporary copy of the working tree, so nothing in the real working
 * tree changes until they are validated. Returns the copy's path and the formatted contents to write.
 */
function prepareCopy(date) {
  const tmp = mkdtempSync(join(tmpdir(), 'open-clutch-xi-release-'));
  const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
  for (const f of files) if (existsSync(join(root, f))) cpSync(join(root, f), join(tmp, f), { recursive: true });
  // The same edits the release commit will contain.
  const notesRel = join('docs', 'releases', `v${version}.md`);
  writeFileSync(join(tmp, 'CHANGELOG.md'), rollChangelog(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version, date, repoUrl));
  writeFileSync(join(tmp, notesRel), finaliseNotes(readFileSync(join(root, notesRel), 'utf8')));
  for (const f of ['package.json', 'package-lock.json']) {
    const json = JSON.parse(readFileSync(join(root, f), 'utf8'));
    json.version = version;
    if (f === 'package-lock.json' && json.packages?.['']) json.packages[''].version = version;
    writeFileSync(join(tmp, f), JSON.stringify(json, null, 2) + '\n');
  }
  // Format exactly as the project's checks expect (using this repository's tools and the copy's config).
  const prettier = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier');
  const r = spawnSync(prettier, ['--write', 'CHANGELOG.md', notesRel, 'package.json'], { cwd: tmp, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`formatting the release files failed:\n${r.stderr}`);
  spawnSync('git', ['init', '-q'], { cwd: tmp }); // release:check lists the copy's files with git
  const changed = ['package.json', 'package-lock.json', 'CHANGELOG.md', notesRel];
  return { tmp, changed, contents: new Map(changed.map((f) => [f, readFileSync(join(tmp, f))])) };
}

async function prepare() {
  requireVersion();
  // The release notes may be written just before preparing, without committing them: they go into the
  // release commit with the version and changelog, so a release needs only one pull request.
  const notesRel = `docs/releases/v${version}.md`;
  preflight({ allowUncommitted: [notesRel] });
  if (!existsSync(join(root, notesRel))) fail(`write the release notes first: ${notesRel} (copy an earlier one; no need to commit it)`);
  const branch = `release/v${version}`;
  if (sh('git', ['rev-parse', '-q', '--verify', `refs/heads/${branch}`], { allowFail: true }).ok) fail(`branch ${branch} already exists`);
  if (!skipCheck && !locateChrome()) fail(`${NO_BROWSER_HELP}\n  Nothing was changed.`);

  // The same steps run in a dry run and a real run, up to and including the full release check: only
  // writing the validated files into the working tree, committing, pushing and the pull request differ.
  step(`Preparing ${version} in a temporary copy (your working tree is not touched yet)`);
  const date = new Date().toISOString().slice(0, 10);
  const prepared = prepareCopy(date);
  ok(`version ${version}, changelog [${version}] - ${date}, final release notes`);
  let passed = true;
  if (skipCheck) console.log('\n! Skipping the release check (--skip-check): the release files are not validated.');
  else {
    step('Running the full release check on the prepared files (clean copy, every check, browser flows, reproducible artefacts)');
    passed = sh('node', ['scripts/release-check.mjs', '--from', prepared.tmp], { inherit: true, allowFail: true }).ok;
  }
  rmSync(prepared.tmp, { recursive: true, force: true });
  if (!passed) fail('the release check failed. Nothing in your working tree was changed and no branch was created: fix the problem and run this again.');
  if (!skipCheck) ok('release check passed on the prepared release');

  step(`Writing the validated files and committing on ${branch}`);
  if (dryRun) for (const f of prepared.changed) console.log(`  (dry run) would write ${f} (validated above)`);
  act('git', ['switch', '-c', branch]);
  if (!dryRun) for (const [f, data] of prepared.contents) writeFileSync(join(root, f), data);
  act('git', ['add', ...prepared.changed]);
  act('git', ['commit', '-m', `chore(release): ${version}`]);
  ok(`committed "chore(release): ${version}"`);

  await confirm(`Push ${branch} to GitHub and open a pull request?`);
  act('git', ['push', '-u', 'origin', branch]);
  const body = `Release ${version}.\n\n- Version set to ${version}\n- CHANGELOG.md: Unreleased moved under [${version}] - ${date}\n- Release notes: docs/releases/v${version}.md\n\nThe release check passed locally on exactly these files${skipCheck ? ' (skipped)' : ''}. After merging (squash), run:\n\n    make release-publish VERSION=${version}\n`;
  act('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `chore(release): ${version}`, '--body', body]);
  if (dryRun)
    console.log(
      `\nDry run complete: the prepared release passed${skipCheck ? ' (validation skipped)' : ' the full release check'}, and nothing was changed.\nRun without DRY_RUN=1 to write the same files, commit, push and open the pull request.`,
    );
  else
    console.log(
      `\nNext: review and squash-merge the pull request, then run on an up-to-date main:\n  git switch main && git pull\n  make release-publish VERSION=${version}`,
    );
}

async function publish() {
  requireVersion();
  const resuming = preflight({ wantVersionAtLeast: false, resumeTagAtHead: true });
  if (resuming && sh('gh', ['release', 'view', `v${version}`], { allowFail: true }).ok)
    fail(`a GitHub release v${version} already exists: finish or delete it on GitHub (${repoUrl}/releases)`);
  step('Checking main is the merged release');
  if (pkg().version !== version) fail(`package.json says ${pkg().version}: merge the "chore(release): ${version}" pull request first`);
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm').test(changelog))
    fail(`CHANGELOG.md has no dated [${version}] section`);
  const notesFile = join('docs', 'releases', `v${version}.md`);
  if (!existsSync(join(root, notesFile)) || isDraftNotes(readFileSync(join(root, notesFile), 'utf8')))
    fail(`${notesFile} is missing or still marked as a draft`);
  const commit = git('rev-parse', 'HEAD');
  ok(`main (${commit.slice(0, 7)}) is release ${version}`);

  if (!resuming) {
    await confirm(`Create and push the tag v${version} on ${commit.slice(0, 7)}? A published tag is permanent.`);
    act('git', ['tag', '-a', `v${version}`, '-m', `Open Clutch XI ${version}`]);
    act('git', ['push', 'origin', `v${version}`]);
    ok(`tag v${version} pushed`);
  } else act('git', ['push', 'origin', `v${version}`]); // no-op if GitHub already has it

  step('Building the release artefacts from the tag');
  act(npm, ['run', 'release:package'], { inherit: true });
  act('node', ['scripts/generate-sbom.mjs', '--out', join('release', `${project}-${version}.cdx.json`)], { inherit: true });
  const web = join('release', `${project}-v${version}-web.tar.gz`);
  const src = join('release', `${project}-v${version}-source.tar.gz`);
  const sbom = join('release', `${project}-${version}.cdx.json`);
  let webSha = '<sha256 of the web archive>';
  if (!dryRun) {
    // Verify the checksums file against the archives, and that the manifest names this commit.
    const sums = readFileSync(join(root, 'release', 'SHA256SUMS'), 'utf8')
      .trim()
      .split('\n');
    for (const line of sums) {
      const [hash, name] = line.split(/\s+/);
      if (
        createHash('sha256')
          .update(readFileSync(join(root, 'release', name)))
          .digest('hex') !== hash
      )
        fail(`checksum mismatch for ${name}`);
      if (name.endsWith('-web.tar.gz')) webSha = hash;
    }
    const manifest = JSON.parse(sh('tar', ['-xzOf', web, `${project}-v${version}-web/release-manifest.json`]).out);
    if (manifest.sourceCommit !== commit || manifest.sourceDirty !== false || manifest.version !== version)
      fail('the web archive was not built from the clean, tagged commit');
  }
  ok('artefacts built and verified (SHA256SUMS, manifest names the tagged commit)');

  // The published notes: links point at the tag, not relative paths (which break on the release page)
  // and not main. Built from the tag itself, and every link checked there; stops on a broken link.
  step('Building the release notes for GitHub (links pointing at the tag)');
  const publishedNotes = join('release', `release-notes-v${version}.md`);
  if (!sh('node', ['scripts/release-notes.mjs', version, ...(dryRun ? ['--check'] : [])], { inherit: true, allowFail: true }).ok) {
    fail(
      `docs/releases/v${version}.md has broken links: fix them in a pull request, then run this again (the tag is already pushed; it carries on from there)`,
    );
  }
  ok('every link in the release notes resolves at the tag');

  step('Creating the GitHub release (draft)');
  act('gh', [
    'release',
    'create',
    `v${version}`,
    '--draft',
    '--verify-tag',
    '--title',
    `Open Clutch XI ${version}`,
    '--notes-file',
    publishedNotes,
    web,
    src,
    join('release', 'SHA256SUMS'),
    sbom,
  ]);
  ok(`draft release v${version} created with the web archive, source archive, SHA256SUMS and SBOM`);

  let published = false;
  if (assumeYes || dryRun) console.log('\n  The release stays a draft: publish it on GitHub when you are ready (or re-run without --yes to be asked).');
  else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (
      await rl.question(`\n? Publish the release now (visible to everyone)? Type ${version} to publish, anything else to keep the draft: `)
    ).trim();
    rl.close();
    if (answer === version) {
      sh('gh', ['release', 'edit', `v${version}`, '--draft=false']);
      published = true;
      ok(`release v${version} published: ${repoUrl}/releases/tag/v${version}`);
    }
  }
  if (!published) console.log(`\nReview the draft and publish it: ${repoUrl}/releases`);
  console.log(
    `\nFor a site that hosts the game (e.g. the maintainer's fc.chrisguindon.com), once the release is published,\nput this in its release.json, then run its \`npm run verify\`:\n\n${releaseJsonSnippet(project, version, repoUrl, webSha)}\n`,
  );
  console.log('Note: sites can download release files only while the repository is public.');
}

function status() {
  const p = pkg();
  const tags = sh('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { allowFail: true }).out.split('\n').filter(Boolean);
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const unreleased = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|^\[Unreleased\]:)/m.exec(changelog)?.[1].trim() ?? '';
  const entries = (unreleased.match(/^- /gm) ?? []).length;
  console.log(`Version in package.json: ${p.version}`);
  console.log(`Latest tag: ${tags[0] ?? 'none yet'}`);
  console.log(`Unreleased changelog entries: ${entries}`);
  console.log(`Remote: ${sh('git', ['remote', 'get-url', 'origin'], { allowFail: true }).out || 'none (add origin first)'}`);
  console.log(
    `\nTo release, write docs/releases/v<version>.md (no need to commit it), then:\n  make release-prepare VERSION=<version>   (opens a pull request)\n  make release-publish VERSION=<version>   (after merging it)\nAdd DRY_RUN=1 to either to see every step without changing anything.`,
  );
}

if (command === 'prepare') await prepare();
else if (command === 'publish') await publish();
else if (command === 'status' || !command) status();
else fail(`unknown command "${command}". Use: status, prepare <version>, publish <version>`);
