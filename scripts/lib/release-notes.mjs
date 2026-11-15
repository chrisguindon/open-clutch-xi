/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Release notes live in the repository as docs/releases/v<version>.md, with relative links such as
// ../../README.md, which work when the file is read in the repository. A GitHub release shows the
// same text on a page at /releases/tag/v<version>, where those links resolve to the wrong place
// (../../README.md becomes github.com/<owner>/README.md). So the published notes are a generated
// copy whose relative links point to the same files *at the release tag*:
// https://github.com/<owner>/<repo>/blob/v<version>/README.md. Never `main`, which moves on.
//
// Pure helpers (file access is passed in), unit-tested in tests/release-notes.test.ts and used by
// scripts/release-notes.mjs, scripts/check-docs.mjs and the release tool.

/** GitHub-style heading anchors of a Markdown text (the ids GitHub gives its headings). */
export function headingAnchors(markdown) {
  const slug = (h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
  const set = new Set();
  const counts = new Map();
  let inCode = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const m = !inCode && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1].replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    set.add(n ? `${base}-${n}` : base);
  }
  return set;
}

/** Joins and normalises a POSIX path; returns null if it climbs above the repository root. */
function resolvePath(fromDir, rel) {
  const parts = fromDir ? fromDir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Turns release notes into the text to publish, and checks every link.
 * @param {string} markdown the notes as kept in the repository
 * @param {object} o
 * @param {string} o.notesPath repository path of the notes, e.g. "docs/releases/v0.1.0.md"
 * @param {string} o.repoUrl e.g. "https://github.com/chrisguindon/open-clutch-xi"
 * @param {string} o.tag the release tag the links must point at, e.g. "v0.1.0"
 * @param {(path: string) => 'file' | 'dir' | null} o.kind what exists at a repository path, at that tag
 * @param {(path: string) => string | null} o.read the text of a file at that tag (for #anchors)
 * @returns {{ text: string, links: Array<{ from: string, to: string }>, problems: string[] }}
 */
export function publishedReleaseNotes(markdown, { notesPath, repoUrl, tag, kind, read }) {
  const problems = [];
  const links = [];
  const notesDir = notesPath.includes('/') ? notesPath.slice(0, notesPath.lastIndexOf('/')) : '';
  const repoPattern = new RegExp(`^${repoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:blob|tree)/([^/]+)/`);
  const anchorCache = new Map();

  /** The published form of one link target (unchanged when it's already absolute or an in-page anchor). */
  const convert = (target) => {
    if (/^(mailto:|tel:)/i.test(target) || target.startsWith('#')) return target;
    if (/^https?:\/\//i.test(target)) {
      const m = repoPattern.exec(target);
      if (m && m[1] !== tag) problems.push(`links to "${m[1]}" instead of the release tag ${tag}: ${target}`);
      return target;
    }
    const [rawPath, anchor] = target.split('#');
    let path;
    try {
      path = resolvePath(notesDir, decodeURIComponent(rawPath));
    } catch {
      path = null;
    }
    if (path === null) {
      problems.push(`link leaves the repository: ${target}`);
      return target;
    }
    const k = kind(path);
    if (!k) {
      problems.push(`missing at ${tag}: ${target} (→ ${path})`);
      return target;
    }
    if (anchor && k === 'file' && path.endsWith('.md')) {
      if (!anchorCache.has(path)) anchorCache.set(path, headingAnchors(read(path) ?? ''));
      if (!anchorCache.get(path).has(anchor.toLowerCase())) problems.push(`missing heading at ${tag}: ${target}`);
    }
    const url = `${repoUrl}/${k === 'dir' ? 'tree' : 'blob'}/${tag}/${path.split('/').map(encodeURIComponent).join('/')}${anchor ? `#${anchor}` : ''}`;
    links.push({ from: target, to: url });
    return url;
  };

  // Rewrite links outside code: [text](target "title") and reference definitions [id]: target.
  const out = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const ref = /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/.exec(line);
    if (ref) {
      out.push(ref[1] + convert(ref[2]) + ref[3]);
      continue;
    }
    // Leave inline code spans alone: split on backticks and only convert outside them.
    const pieces = line.split(/(`[^`]*`)/);
    out.push(pieces.map((p, i) => (i % 2 ? p : p.replace(/(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (_m, a, t, b) => a + convert(t) + b))).join(''));
  }
  return { text: out.join('\n'), links, problems };
}
