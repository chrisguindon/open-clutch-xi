/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// GitHub Actions entry point for triage.mjs. Reads the event from GITHUB_EVENT_PATH and calls the REST API
// with the workflow's GITHUB_TOKEN (issues: write). Modes:
//   node scripts/triage/run.mjs triage   — add suggested labels to a new or edited issue
//   node scripts/triage/run.mjs plan     — post the plan skeleton when `plan:requested` is added
// Only labels that exist in .github/labels.yml are ever added.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { planComment, triage } from './triage.mjs';

const mode = process.argv[2];
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const repo = process.env.GITHUB_REPOSITORY;
const issue = event.issue;
const known = new Set(parse(readFileSync(new URL('../../.github/labels.yml', import.meta.url), 'utf8')).map((l) => l.name));
const api = (path, body) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) throw new Error(`GitHub API ${path}: ${r.status}`);
  });

const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
if (mode === 'triage') {
  if (issue.pull_request) process.exit(0);
  const { add } = triage({ title: issue.title, body: issue.body, labels });
  const ok = add.filter((l) => known.has(l));
  if (ok.length) await api(`/issues/${issue.number}/labels`, { labels: ok });
  console.log(ok.length ? `added labels: ${ok.join(', ')}` : 'no labels to add');
} else if (mode === 'plan') {
  if (event.label?.name !== 'plan:requested') process.exit(0);
  await api(`/issues/${issue.number}/comments`, { body: planComment(labels) });
  console.log('posted plan skeleton');
} else {
  console.error('usage: run.mjs triage|plan');
  process.exit(2);
}
