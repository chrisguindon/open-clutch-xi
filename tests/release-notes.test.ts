/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Published release notes (scripts/lib/release-notes.mjs): relative links become links to the files at
// the release tag, and every target is checked there.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JavaScript build helper without type declarations
import { headingAnchors, publishedReleaseNotes } from '../scripts/lib/release-notes.mjs';

const REPO = 'https://github.com/chrisguindon/open-clutch-xi';
const files: Record<string, string> = {
  'README.md': '# Open Clutch XI\n\n## Play locally\n',
  LICENSE: 'EPL',
  'docs/development/known-issues.md': '# Known issues\n\n## Mobile\n\n## Mobile\n',
  'docs/gameplay/FOOTBALL_RULES.md': '# Rules\n',
};
const dirs = new Set(['docs', 'docs/development', 'docs/gameplay']);
const kind = (p: string) => (p in files ? 'file' : dirs.has(p) ? 'dir' : null);
const read = (p: string) => files[p] ?? null;
const publish = (md: string, tag = 'v0.1.0') => publishedReleaseNotes(md, { notesPath: 'docs/releases/v0.1.0.md', repoUrl: REPO, tag, kind, read });

describe('published release notes', () => {
  it('point relative links at the files at the release tag', () => {
    const r = publish('See the [README](../../README.md), [rules](../gameplay/FOOTBALL_RULES.md) and [licence](../../LICENSE).');
    expect(r.problems).toEqual([]);
    expect(r.text).toBe(
      `See the [README](${REPO}/blob/v0.1.0/README.md), [rules](${REPO}/blob/v0.1.0/docs/gameplay/FOOTBALL_RULES.md) and [licence](${REPO}/blob/v0.1.0/LICENSE).`,
    );
  });

  it('keep anchors, use tree/ for folders, and leave external, mailto and in-page links alone', () => {
    const r = publish('[a](../development/known-issues.md#mobile) [b](../development/) [c](https://example.org/x) [d](mailto:x@example.org) [e](#highlights)');
    expect(r.problems).toEqual([]);
    expect(r.text).toContain(`[a](${REPO}/blob/v0.1.0/docs/development/known-issues.md#mobile)`);
    expect(r.text).toContain(`[b](${REPO}/tree/v0.1.0/docs/development)`);
    expect(r.text).toContain('[c](https://example.org/x) [d](mailto:x@example.org) [e](#highlights)');
  });

  it('rewrite reference-style links but not code', () => {
    const r = publish('Read [the rules][r].\n\n[r]: ../gameplay/FOOTBALL_RULES.md\n\n`[x](../../README.md)`\n\n```\n[y](../../README.md)\n```');
    expect(r.text).toContain(`[r]: ${REPO}/blob/v0.1.0/docs/gameplay/FOOTBALL_RULES.md`);
    expect(r.text).toContain('`[x](../../README.md)`');
    expect(r.text).toContain('[y](../../README.md)');
  });

  it('report links whose target or heading is missing at the tag', () => {
    expect(publish('[x](../development/nope.md)').problems[0]).toMatch(/missing at v0\.1\.0/);
    expect(publish('[x](../../README.md#no-such-heading)').problems[0]).toMatch(/missing heading/);
    expect(publish('[x](../../../outside.md)').problems[0]).toMatch(/leaves the repository/);
  });

  it('report GitHub links to main (or another version) instead of the release tag', () => {
    const r = publish(`[x](${REPO}/blob/main/README.md) [y](${REPO}/blob/v0.1.0/README.md)`);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/"main" instead of the release tag v0\.1\.0/);
  });

  it('heading anchors follow GitHub, including duplicates', () => {
    expect([...headingAnchors('# Known issues\n## Mobile\n## Mobile\n```\n# not a heading\n```\n## `npm run ci`')]).toEqual([
      'known-issues',
      'mobile',
      'mobile-1',
      'npm-run-ci',
    ]);
  });
});
