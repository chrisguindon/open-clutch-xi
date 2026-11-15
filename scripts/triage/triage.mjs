/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Deterministic issue triage (no AI service). Reads an issue created from the repository's issue forms and
// suggests labels: an area from the form's answers, and `status:needs-info` when a required answer is
// missing or too thin to act on. Issue text is untrusted input: it is only *read* to choose from a fixed
// list of labels, and never executed, echoed into comments or interpolated into shell commands.
//
// Used by .github/workflows/triage.yml; tested in tests/triage.test.ts.

/** Parse GitHub issue-form markdown ("### Question\n\nanswer") into { question: answer }. */
export function parseForm(body) {
  const out = {};
  const parts = String(body ?? '')
    .split(/^### /m)
    .slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const q = (nl < 0 ? part : part.slice(0, nl)).trim();
    const a = (nl < 0 ? '' : part.slice(nl + 1)).trim();
    out[q] = a === '_No response_' ? '' : a;
  }
  return out;
}

const AREA_BY_TOPIC = [
  [/AI opponents|AI team-mates|Goalkeepers/i, 'area:ai'],
  [/Movement|dribbling|Passing|Shooting|Defending|tackling|Penalties|Difficulty|Camera/i, 'area:gameplay'],
];
const AREA_BY_TEXT = [
  [/\b(offside|throw-?in|corner|goal kick|free kick|referee|card|foul|restart)\b/i, 'area:gameplay'],
  [/\b(fps|frame ?rate|stutter|lag|slow|performance|cpu|gpu)\b/i, 'area:performance'],
  [/\b(keyboard|mouse|controller|gamepad|touch|joystick|binding|remap)\b/i, 'area:controls'],
  [/\b(animation|celebration|render|graphics|shadow|texture)\b/i, 'area:graphics'],
  [/\b(screen reader|focus|contrast|colou?r ?blind|keyboard navigation)\b/i, 'area:accessibility'],
];

/** Minimum length for a free-text answer that a maintainer can act on. */
const THIN = 15;

/**
 * Suggest labels for an issue. Returns labels to add (never removes maintainers' labels).
 * @param {{ title?: string, body?: string, labels?: string[] }} issue
 */
export function triage(issue) {
  const labels = new Set(issue.labels ?? []);
  const form = parseForm(issue.body);
  const add = new Set();
  const hasArea = [...labels].some((l) => l.startsWith('area:'));
  if (!hasArea) {
    const topic = form['Mostly about'] ?? '';
    for (const [re, area] of AREA_BY_TOPIC) if (re.test(topic)) add.add(area);
    if (!add.size) {
      const text = `${issue.title ?? ''}\n${Object.values(form).join('\n') || issue.body || ''}`;
      for (const [re, area] of AREA_BY_TEXT) {
        if (re.test(text)) {
          add.add(area);
          break; // one area from free text; maintainers refine
        }
      }
    }
  }
  // Missing information: required free-text answers that are empty or too short to act on.
  const required = labels.has('bug')
    ? ["What's the bug?", 'Steps to reproduce', 'Expected behaviour', 'Actual behaviour']
    : labels.has('enhancement')
      ? ['Problem or opportunity', 'Proposed improvement']
      : [];
  const thin = required.filter((q) => (form[q] ?? '').replace(/\s+/g, ' ').trim().length < THIN);
  if (required.length && thin.length) add.add('status:needs-info');
  for (const l of labels) add.delete(l);
  return { add: [...add].sort(), thin };
}

/** Modules to look at for each area (planning comment). */
export const MODULES = {
  'area:gameplay': ['src/sim/match.ts', 'src/sim/rules.ts', 'docs/gameplay/FOOTBALL_RULES.md'],
  'area:ai': ['src/sim/ai/teamBrain.ts', 'src/sim/ai/evaluate.ts', 'docs/gameplay/ai-and-difficulty.md'],
  'area:physics': ['src/sim/ball.ts', 'src/sim/world.ts'],
  'area:graphics': ['src/render/', 'docs/gameplay/animation.md'],
  'area:controls': ['src/input/input.ts', 'src/game/settings.ts', 'docs/gameplay/controls.md'],
  'area:accessibility': ['src/ui/ui.ts', 'src/ui/styles.css'],
  'area:performance': ['src/game/adaptive.ts', 'src/render/renderer.ts', 'docs/development/performance.md'],
  'area:testing': ['tests/', 'docs/development/testing.md'],
  'area:documentation': ['docs/', 'README.md'],
  'area:infrastructure': ['.github/', 'scripts/', 'package.json'],
};

/**
 * The plan skeleton posted when a maintainer adds `plan:requested`. Built only from labels (trusted), never
 * from issue text, so it can't be used to inject content.
 */
export function planComment(labels) {
  const areas = labels.filter((l) => l.startsWith('area:'));
  const modules = [...new Set(areas.flatMap((a) => MODULES[a] ?? []))];
  return [
    '### Implementation plan (to be completed before any coding)',
    '',
    'A maintainer requested a plan. Whoever plans (a person, or Copilot when a maintainer asks it) fills this in. **Coding starts only after a maintainer adds `plan:approved`.**',
    '',
    '- **Problem:** what is wrong or missing, and how to reproduce or observe it',
    `- **Relevant modules:** ${modules.length ? modules.map((m) => `\`${m}\``).join(', ') : '_(add an `area:` label)_'}`,
    '- **Proposed solution:** the smallest change that fixes the root cause',
    '- **Tests:** which tests prove it (deterministic where possible)',
    '- **Security:** untrusted input, permissions, secrets — or "none"',
    '- **Performance:** hot paths, allocations, frame budget — or "none"',
    '- **Accessibility:** keyboard, controller, touch, screen readers, colour — or "none"',
    '- **Licensing:** new dependencies or assets and their licences — or "none"',
    '- **Outstanding questions:** for the maintainer',
    '',
    '_Posted by the planning workflow. AI-assisted work stays the responsibility of the person who submits it (see AGENTS.md)._',
  ].join('\n');
}
