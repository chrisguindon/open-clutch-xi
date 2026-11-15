/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Checks a commit message or pull-request title against Conventional Commits
// (https://www.conventionalcommits.org/en/v1.0.0/). Pull requests are squash-merged, so the PR title
// becomes the commit message on `main`; CI checks the title.
//
//   node scripts/check-commit-message.mjs "feat(controls): add left-handed touch layout"
//   node scripts/check-commit-message.mjs --file .git/COMMIT_EDITMSG     (as a git commit-msg hook)
//   PR_TITLE="…" node scripts/check-commit-message.mjs --env PR_TITLE      (CI: avoids shell injection)
//
// It also notes automatic AI attribution (AI co-author trailers, "Generated with <AI tool>" signatures and
// AI-tool session links) as a warning, never a failure: tools such as GitHub Copilot add them on their own,
// and blocking them made those tools hard to use. A human is still the author and committer, and is
// responsible for the change. The project documents its AI-assisted development openly (README, ADR 0008).
// Human co-authors are always welcome.
import { readFileSync } from 'node:fs';

export const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9-]*\\))?(!)?: \\S.{0,98}$`);
const AI_TOOLS = 'claude|anthropic|openai|chatgpt|copilot|gemini|cursor|codeium|devin';
/**
 * Automatic AI attribution, matched only as whole trailer or signature *lines* (so prose that mentions an
 * AI tool is fine): co-author trailers naming an AI tool or its no-reply address, "Generated with/by <AI
 * tool>" signatures (with or without an emoji or Markdown link), and AI-tool session links.
 */
const AI_ATTRIBUTION = [
  { what: 'an AI co-author trailer', re: new RegExp(`^\\s*co-authored-by:.*(\\b(${AI_TOOLS})\\b|noreply@anthropic\\.com)`, 'im') },
  { what: 'a "Generated with <AI tool>" signature', re: new RegExp(`^\\W{0,4}\\s*generated (with|by) \\[?(${AI_TOOLS})`, 'im') },
  { what: 'an AI-tool session link', re: /^.*https?:\/\/(www\.)?claude\.(ai|com)\/(code\/)?session[\w/-]*/im },
  { what: 'an AI-tool session trailer', re: new RegExp(`^\\s*(${AI_TOOLS})[- ]session(-url)?:`, 'im') },
];

/** Automatic AI attribution found in a commit message (empty = none). */
export function aiAttribution(message) {
  return AI_ATTRIBUTION.filter((a) => a.re.test(message)).map((a) => a.what);
}

/** Notes about a message that never fail a check: automatic AI attribution (see the header comment). */
export function messageWarnings(message) {
  return aiAttribution(message).map((what) => `${what} (automatic AI attribution): allowed, but you can remove it, for example when squash-merging.`);
}

/** Returns a list of problems (empty = valid). Automatic AI attribution is a warning, not a problem: see {@link messageWarnings}. */
export function checkMessage(message) {
  const problems = [];
  const lines = message
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => !l.startsWith('#'));
  const header = (lines[0] ?? '').trim();
  if (/^(Merge|Revert ")/.test(header)) return problems; // git-generated messages
  if (!HEADER.test(header)) {
    problems.push(
      `"${header}" is not a Conventional Commit header. Use "<type>(<optional scope>): <summary>", ` +
        `e.g. "fix(ai): stop clearances towards our own goal". Types: ${TYPES.join(', ')}.`,
    );
  } else if (/\.$/.test(header)) {
    problems.push('The summary should not end with a full stop.');
  }
  if (lines.length > 1 && lines[1].trim() !== '') problems.push('Leave a blank line between the header and the body.');
  return problems;
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-commit-message.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  let msg;
  if (args[0] === '--file') msg = readFileSync(args[1], 'utf8');
  else if (args[0] === '--env') msg = process.env[args[1]] ?? '';
  else msg = args.join(' ');
  for (const w of messageWarnings(msg)) console.warn(`! ${w}`);
  const problems = checkMessage(msg);
  if (problems.length) {
    console.error(problems.map((p) => `✗ ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('✓ Conventional Commit message');
}
