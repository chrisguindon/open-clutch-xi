/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Pure helpers for scripts/release.mjs: version checks and the text edits a release makes. No Git, no
// network, no file system: everything here is unit-tested (tests/release-tool.test.ts).

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

/** Parses "1.2.3" or "1.2.3-rc.1"; null if it isn't an exact semantic version. */
export function parseVersion(v) {
  const m = SEMVER.exec(String(v ?? '').trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, text: m[0] } : null;
}

/** Negative if a < b, 0 if equal, positive if a > b (a pre-release sorts before its release). */
export function compareVersions(a, b) {
  const x = parseVersion(a),
    y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * Moves the "## [Unreleased]" section of a Keep a Changelog file under a new "## [version] - date"
 * heading, leaves an empty Unreleased section, and updates the compare links at the bottom.
 * @throws if there is no Unreleased section, it's empty, or the version is already listed.
 */
export function rollChangelog(text, version, date, repoUrl) {
  if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(text)) throw new Error(`CHANGELOG.md already has a [${version}] section`);
  const start = text.search(/^## \[Unreleased\][^\n]*\n/m);
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  const headingEnd = text.indexOf('\n', start) + 1;
  const nextRel = text.slice(headingEnd).search(/^## \[/m);
  const linksRel = text.slice(headingEnd).search(/^\[Unreleased\]: /m);
  const endRel = [nextRel, linksRel].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b), text.length - headingEnd);
  const body = text.slice(headingEnd, headingEnd + endRel).trim();
  if (!body) throw new Error('the Unreleased section of CHANGELOG.md is empty: nothing to release');
  const before = text.slice(0, start);
  const after = text.slice(headingEnd + endRel);
  let out = `${before}## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n\n${after.replace(/^\n+/, '')}`;
  // Links: Unreleased compares from this tag; the new version links to its release.
  const link = new RegExp('^\\[Unreleased\\]: .*$', 'm');
  const unreleased = `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`;
  const versionLink = `[${version}]: ${repoUrl}/releases/tag/v${version}`;
  out = link.test(out) ? out.replace(link, `${unreleased}\n${versionLink}`) : `${out.trimEnd()}\n\n${unreleased}\n${versionLink}\n`;
  return out;
}

/**
 * Turns draft release notes into final ones: removes a leading "> **Draft.** …" note and a
 * ": draft release notes" / " — draft" suffix in the title. Returns the text unchanged otherwise.
 */
export function finaliseNotes(text) {
  const lines = text.split('\n');
  if (lines[0]) lines[0] = lines[0].replace(/:\s*draft release notes\s*$/i, '').replace(/\s+[—-]\s+draft\s*$/i, '');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^>\s*\*\*Draft\.\*\*/.test(lines[i])) {
      while (i + 1 < lines.length && lines[i + 1].startsWith('>')) i++; // the rest of the quote block
      if (lines[i + 1] === '') i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/** True if release notes still look like a draft. */
export const isDraftNotes = (text) => /^>\s*\*\*Draft\.\*\*/m.test(text) || /draft release notes/i.test(text.split('\n')[0] ?? '');

/** The lines to paste into the deployment's release.json for a published release. */
export function releaseJsonSnippet(project, version, repoUrl, sha256) {
  const artifact = `${project}-v${version}-web.tar.gz`;
  return JSON.stringify({ project, version, artifact, url: `${repoUrl}/releases/download/v${version}/${artifact}`, sha256 }, null, 2);
}
