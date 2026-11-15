/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Validates the files in .github/ against GitHub's documented rules, so mistakes show up in CI instead of
// as a silently ignored template:
// - issue forms and discussion forms: top-level keys, element types, unique ids, required attributes
// - issue chooser config, labels file, Dependabot config
// - workflows: explicit permissions, actions pinned to full commit SHAs, no `${{ github.event… }}`
//   expressions inside `run:` scripts (script injection)
// - the repository URL placeholder has been replaced once the code runs on GitHub
// (Full workflow semantics are checked locally with actionlint; see docs/development/github-setup.md.)
//   node scripts/check-github-config.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = new URL('..', import.meta.url).pathname;
const gh = join(root, '.github');
const problems = [];
const warnings = [];
const load = (p) => {
  try {
    return parse(readFileSync(p, 'utf8'));
  } catch (e) {
    problems.push(`${p.replace(root, '')}: invalid YAML (${e.message.split('\n')[0]})`);
    return null;
  }
};
const rel = (p) => p.replace(root, '');

// --- Issue and discussion forms (https://docs.github.com/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
const ELEMENT_TYPES = new Set(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes']);
function checkForm(p, kind) {
  const f = load(p);
  if (!f) return;
  const allowed = kind === 'issue' ? ['name', 'description', 'body', 'title', 'labels', 'assignees', 'projects', 'type'] : ['title', 'labels', 'body'];
  for (const k of Object.keys(f)) if (!allowed.includes(k)) problems.push(`${rel(p)}: unknown top-level key "${k}"`);
  if (kind === 'issue' && (!f.name || !f.description)) problems.push(`${rel(p)}: "name" and "description" are required`);
  if (!Array.isArray(f.body) || !f.body.length) return problems.push(`${rel(p)}: "body" must be a non-empty list`);
  if (!f.body.some((e) => e.type !== 'markdown')) problems.push(`${rel(p)}: needs at least one non-markdown field`);
  const ids = new Set();
  for (const [i, e] of f.body.entries()) {
    const where = `${rel(p)} body[${i}]`;
    if (!ELEMENT_TYPES.has(e.type)) problems.push(`${where}: unknown type "${e.type}"`);
    if (e.id !== undefined) {
      if (!/^[a-zA-Z0-9_-]+$/.test(e.id)) problems.push(`${where}: id "${e.id}" may only contain letters, digits, - and _`);
      if (ids.has(e.id)) problems.push(`${where}: duplicate id "${e.id}"`);
      ids.add(e.id);
    }
    const a = e.attributes ?? {};
    if (e.type === 'markdown' && !a.value) problems.push(`${where}: markdown needs attributes.value`);
    if (e.type !== 'markdown' && !a.label) problems.push(`${where}: needs attributes.label`);
    if (e.type === 'dropdown' && (!Array.isArray(a.options) || !a.options.length)) problems.push(`${where}: dropdown needs options`);
    if (e.type === 'dropdown' && new Set(a.options).size !== a.options?.length) problems.push(`${where}: duplicate dropdown options`);
    if (e.type === 'checkboxes' && !(a.options ?? []).every((o) => o.label)) problems.push(`${where}: every checkbox needs a label`);
    if (e.type === 'markdown' && e.validations) problems.push(`${where}: markdown can't have validations`);
  }
}
const issueDir = join(gh, 'ISSUE_TEMPLATE');
const issueForms = readdirSync(issueDir).filter((f) => f.endsWith('.yml') && f !== 'config.yml');
for (const f of issueForms) checkForm(join(issueDir, f), 'issue');
const discDir = join(gh, 'DISCUSSION_TEMPLATE');
if (existsSync(discDir)) for (const f of readdirSync(discDir)) checkForm(join(discDir, f), 'discussion');

const cfg = load(join(issueDir, 'config.yml'));
if (cfg) {
  if (typeof cfg.blank_issues_enabled !== 'boolean') problems.push('ISSUE_TEMPLATE/config.yml: blank_issues_enabled must be true or false');
  for (const l of cfg.contact_links ?? [])
    if (!l.name || !l.about || !/^https:\/\//.test(l.url ?? ''))
      problems.push(`ISSUE_TEMPLATE/config.yml: contact link "${l.name}" needs name, https url and about`);
}

// --- Labels: valid, unique, and every label used by a form exists
const labels = load(join(gh, 'labels.yml')) ?? [];
const labelNames = new Set();
for (const l of labels) {
  if (!l.name || !/^[0-9a-f]{6}$/i.test(String(l.color)) || !l.description)
    problems.push(`labels.yml: "${l.name}" needs name, 6-digit hex color and description`);
  if (labelNames.has(l.name)) problems.push(`labels.yml: duplicate "${l.name}"`);
  if ((l.description ?? '').length > 100) problems.push(`labels.yml: "${l.name}" description is over GitHub's 100-character limit`);
  labelNames.add(l.name);
}
for (const f of issueForms)
  for (const l of load(join(issueDir, f))?.labels ?? []) if (!labelNames.has(l)) problems.push(`ISSUE_TEMPLATE/${f}: label "${l}" is not in labels.yml`);

// --- Dependabot (https://docs.github.com/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
const dep = load(join(gh, 'dependabot.yml'));
if (dep) {
  if (dep.version !== 2) problems.push('dependabot.yml: version must be 2');
  for (const u of dep.updates ?? []) {
    if (!['npm', 'github-actions'].includes(u['package-ecosystem'])) problems.push(`dependabot.yml: unexpected ecosystem ${u['package-ecosystem']}`);
    if (!['daily', 'weekly', 'monthly'].includes(u.schedule?.interval))
      problems.push(`dependabot.yml: ${u['package-ecosystem']} ${u.directory} needs a schedule interval`);
    if (u['package-ecosystem'] === 'npm' && !existsSync(join(root, u.directory, 'package.json')))
      problems.push(`dependabot.yml: no package.json in ${u.directory}`);
  }
}

// --- Workflows: least privilege, pinned actions, no expression injection in run scripts
const wfDir = join(gh, 'workflows');
for (const f of readdirSync(wfDir).filter((x) => /\.ya?ml$/.test(x))) {
  const p = join(wfDir, f);
  const wf = load(p);
  if (!wf) continue;
  if (!('permissions' in wf)) problems.push(`workflows/${f}: set top-level "permissions" explicitly (least privilege)`);
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    if (!job['timeout-minutes']) warnings.push(`workflows/${f} job ${name}: no timeout-minutes`);
    for (const s of job.steps ?? []) {
      if (s.uses && !s.uses.startsWith('./') && !/@[0-9a-f]{40}$/.test(s.uses)) problems.push(`workflows/${f}: "${s.uses}" is not pinned to a full commit SHA`);
      if (s.run && /\$\{\{\s*github\.(event|head_ref)/.test(s.run))
        problems.push(`workflows/${f}: untrusted github.event/head_ref expression inside run: (pass it through env instead)`);
    }
  }
  const on = wf.on ?? wf[true];
  if (on && typeof on === 'object' && 'pull_request_target' in on && /actions\/checkout/.test(readFileSync(p, 'utf8')))
    problems.push(`workflows/${f}: never check out code in a pull_request_target workflow`);
}

// --- Pull request template exists
if (!existsSync(join(gh, 'pull_request_template.md'))) problems.push('missing .github/pull_request_template.md');

// --- Repository URL placeholder (replaced by scripts/set-repo-url.mjs once the GitHub repository exists)
const placeholderFiles = [join(issueDir, 'config.yml'), join(root, 'package.json'), join(root, 'README.md'), join(root, 'NOTICE.md')].filter((p) =>
  readFileSync(p, 'utf8').includes('github.com/OWNER/'),
);
if (placeholderFiles.length) {
  const msg = `repository URL placeholder still in ${placeholderFiles.map(rel).join(', ')}: run node scripts/set-repo-url.mjs https://github.com/<owner>/<repo>`;
  if (process.env.GITHUB_ACTIONS) problems.push(msg);
  else warnings.push(msg);
}

console.log(`checked ${issueForms.length} issue forms, ${labels.length} labels, Dependabot and ${readdirSync(wfDir).length} workflows`);
for (const w of warnings) console.warn(`! ${w}`);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ GitHub configuration is valid');
