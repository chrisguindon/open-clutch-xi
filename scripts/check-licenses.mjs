/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Licence audit (CI and local):
//   node scripts/check-licenses.mjs          check everything (exit 1 on problems)
//   node scripts/check-licenses.mjs --write  also (re)generate the licence texts in NOTICE.md and public/NOTICE.txt
//
// 1. Every project source file starts with the Eclipse-style EPL-2.0 licence header.
// 2. Dependency licences (from package-lock.json) are on an allow-list. Runtime dependencies end up in the
//    shipped game, so their list is stricter than build-only tools' list.
// 3. Every file shipped from public/ is accounted for in docs/governance/third-party-assets.md.
// 4. NOTICE.md (canonical) and its served copy public/NOTICE.txt contain the bundled components' licence texts.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const problems = [];
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// 1. Licence headers (Eclipse style: copyright line, EPL-2.0 sentence, SPDX identifier), in the comment
//    syntax of each format. See docs/development/CODING_STANDARDS.md#licence-headers.
//    Deliberately not headed: JSON (comments are invalid), generated files (public/NOTICE.txt, the SBOM),
//    third-party files (public/assets/**), Markdown, and data-only GitHub forms (.github/ISSUE_TEMPLATE,
//    DISCUSSION_TEMPLATE, release.yml).
// If the copyright holder changes, update COPYRIGHT_HOLDER and the headers together. "and others" may follow once others contribute.
const COPYRIGHT_HOLDER = 'Christopher Guindon';
const COPYRIGHT_LINE = new RegExp(`Copyright \\(c\\) \\d{4}(?:[-, ]+\\d{4})* ${COPYRIGHT_HOLDER}(?: and others)?$`, 'm');
const sourceFiles = [
  ...walk(join(root, 'src')),
  ...walk(join(root, 'tests')),
  ...walk(join(root, 'scripts')),
  ...walk(join(root, '.github', 'workflows')),
  join(root, '.github', 'dependabot.yml'),
  join(root, '.github', 'labels.yml'),
  join(root, '.githooks', 'commit-msg'),
  join(root, 'tools', 'lint', 'eslint.config.mjs'),
  join(root, 'vite.config.ts'),
  join(root, 'index.html'),
].filter((f) => ['.ts', '.mts', '.mjs', '.js', '.sh', '.css', '.html', '.yml', ''].includes(extname(f)) && !f.includes('/fixtures/'));
for (const f of sourceFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const rel = relative(root, f);
  if (lines.slice(1).some((l, i) => i < 3 && l.startsWith('#!'))) problems.push(`shebang must be the first line: ${rel}`);
  const head = lines.slice(0, 14).join('\n');
  const missing = [
    !COPYRIGHT_LINE.test(head) && `"Copyright (c) <year> ${COPYRIGHT_HOLDER}"`,
    !head.includes('Eclipse Public License 2.0') && 'the EPL-2.0 sentence',
    !head.includes('https://www.eclipse.org/legal/epl-2.0/') && 'the EPL-2.0 URL',
    !head.includes('SPDX-License-Identifier: EPL-2.0') && 'SPDX-License-Identifier: EPL-2.0',
  ].filter(Boolean);
  if (missing.length) problems.push(`licence header incomplete (${missing.join(', ')}): ${rel}`);
}

// 2. Dependency licences
const RUNTIME_OK = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'OFL-1.1', 'CC0-1.0']);
// Build / test tools only (never bundled into dist/): sharp's prebuilt libvips binaries are LGPL-3.0-or-later,
// lightningcss (used by Vite) is MPL-2.0.
const DEV_OK = new Set([
  ...RUNTIME_OK,
  'BlueOak-1.0.0',
  'MPL-2.0',
  'LGPL-3.0-or-later',
  'Apache-2.0 AND LGPL-3.0-or-later',
  'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
]);
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const runtime = [];
for (const [key, pkg] of Object.entries(lock.packages)) {
  if (!key) continue;
  const name = key.replace(/^.*node_modules\//, '');
  const lic = pkg.license ?? '(none)';
  const ok = pkg.dev ? DEV_OK.has(lic) : RUNTIME_OK.has(lic);
  if (!ok) problems.push(`licence not on the ${pkg.dev ? 'build-tool' : 'runtime'} allow-list: ${name} (${lic})`);
  if (!pkg.dev) runtime.push({ name, lic, version: pkg.version });
}

// The lint toolchain (tools/lint) is a development tool only.
const lintLock = JSON.parse(readFileSync(join(root, 'tools/lint/package-lock.json'), 'utf8'));
for (const [key, pkg] of Object.entries(lintLock.packages)) {
  if (!key) continue;
  const lic = pkg.license ?? '(none)';
  if (!DEV_OK.has(lic)) problems.push(`licence not on the build-tool allow-list: tools/lint ${key.replace(/^.*node_modules\//, '')} (${lic})`);
}

// 3. Shipped assets are inventoried
const inventory = readFileSync(join(root, 'docs/governance/third-party-assets.md'), 'utf8');
const IGNORE = new Set(['NOTICE.txt', 'robots.txt']);
for (const f of walk(join(root, 'public'))) {
  const rel = relative(join(root, 'public'), f);
  if (IGNORE.has(rel)) continue;
  const dir = rel.split('/').slice(0, -1).join('/');
  const listed =
    inventory.includes(basename(f)) ||
    // A whole folder may be listed at once (flags, credits), but not the top-level assets folder:
    // every model and texture there needs its own row with its source and licence.
    (dir && dir !== 'assets' && inventory.includes(`public/${dir}/`)) ||
    (rel.startsWith('assets/audio/') && inventory.includes(`audio/${basename(f)}`));
  if (!listed) problems.push(`shipped file not in docs/governance/third-party-assets.md: public/${rel}`);
}

// 4. Third-party licence texts (in NOTICE.md and the served NOTICE.txt)
const read = (p) => readFileSync(join(root, p), 'utf8').trim();
const sections = [
  ['three.js (bundled JavaScript)', `https://threejs.org — ${runtime.find((r) => r.name === 'three')?.version ?? ''}`, read('node_modules/three/LICENSE')],
  [
    'meshoptimizer decoder (bundled with three.js)',
    'https://github.com/zeux/meshoptimizer',
    read('node_modules/three/examples/jsm/libs/meshopt_decoder.module.js')
      .split('\n')
      .slice(0, 2)
      .map((l) => l.replace(/^\/\/ ?/, ''))
      .join('\n') + '\n\nLicensed under the MIT License (text as for three.js above, with this copyright notice).',
  ],
  ['Inter typeface (@fontsource-variable/inter)', 'https://rsms.me/inter/', read('node_modules/@fontsource-variable/inter/LICENSE')],
  ['flag-icons (public/assets/flags)', 'https://github.com/lipis/flag-icons', read('public/assets/flags/LICENSE-flag-icons.txt')],
  [
    'CC0 1.0 assets',
    'Characters and animation by Quaternius; grass texture by ambientCG; sounds from Freesound.org (see the asset inventory)',
    'These works are dedicated to the public domain under Creative Commons CC0 1.0 Universal\n(https://creativecommons.org/publicdomain/zero/1.0/). Attribution is given as a courtesy.',
  ],
];
// NOTICE.md is the canonical legal notice. Its third-party licence texts are generated between markers;
// everything else in it is hand-written. The game serves a plain-text copy of the whole file (NOTICE.txt).
const START = '<!-- third-party-licence-texts:start (generated by scripts/check-licenses.mjs --write; do not edit) -->';
const END = '<!-- third-party-licence-texts:end -->';
const generated = sections.map(([t, src, text]) => `\n### ${t}\n\n${src}\n\n\`\`\`text\n${text}\n\`\`\`\n`).join('');
const noticePath = join(root, 'NOTICE.md');
const notice = readFileSync(noticePath, 'utf8');
const a = notice.indexOf(START),
  b = notice.indexOf(END);
if (a < 0 || b < a) problems.push('NOTICE.md is missing the third-party licence text markers');
else {
  const wanted = notice.slice(0, a + START.length) + '\n' + generated + '\n' + notice.slice(b);
  const txtPath = join(root, 'public/NOTICE.txt');
  // The title comes from NOTICE.md's own heading, so a rename only edits NOTICE.md.
  const project = (/^# Notices for (.+)$/m.exec(notice)?.[1] ?? 'this project').trim();
  const txt = `${project} — NOTICE (plain-text copy of NOTICE.md from the source repository)\n\n${wanted.replace(/<!--.*?-->\n?/g, '')}`;
  if (process.argv.includes('--write')) {
    writeFileSync(noticePath, wanted);
    writeFileSync(txtPath, txt);
  } else {
    if (wanted !== notice) problems.push('NOTICE.md third-party licence texts are out of date: run node scripts/check-licenses.mjs --write');
    if (!existsSync(txtPath) || readFileSync(txtPath, 'utf8') !== txt)
      problems.push('public/NOTICE.txt is out of date: run node scripts/check-licenses.mjs --write');
  }
}
for (const old of ['THIRD_PARTY_NOTICES.md', 'public/THIRD_PARTY_NOTICES.txt'])
  if (existsSync(join(root, old))) problems.push(`${old} is obsolete: notices are consolidated in NOTICE.md (served as public/NOTICE.txt)`);

console.log(
  `checked ${sourceFiles.length} source files, ${Object.keys(lock.packages).length - 1} packages (${runtime.length} runtime: ${runtime.map((r) => `${r.name} ${r.lic}`).join(', ')})`,
);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ licence audit passed');
