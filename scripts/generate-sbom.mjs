/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Software bill of materials (CycloneDX 1.5) for what ships to players:
//   - runtime npm dependencies, from package-lock.json (npm's built-in generator, offline)
//   - bundled third-party assets that npm doesn't know about (models, animations, textures, sounds, flags)
// Reproducible: the timestamp comes from SOURCE_DATE_EPOCH (or the last commit), and the serial number is
// derived from the content, so the same inputs give the same file.
//   node scripts/generate-sbom.mjs                  → release/<package name>-<version>.cdx.json
//   node scripts/generate-sbom.mjs --out <file>
//   node scripts/generate-sbom.mjs --check          → generate in memory and validate only
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bom = JSON.parse(
  execFileSync(npm, ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev', '--package-lock-only'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }),
);

// The application itself.
bom.metadata.component = {
  ...bom.metadata.component,
  type: 'application',
  description: pkg.description,
  licenses: [{ license: { id: 'EPL-2.0' } }],
  externalReferences: [
    { type: 'website', url: pkg.homepage },
    ...(pkg.repository?.url && !pkg.repository.url.includes('/OWNER/') ? [{ type: 'vcs', url: pkg.repository.url }] : []),
  ],
};
bom.metadata.supplier = { name: 'Christopher Guindon (independent project)' };

// Bundled assets (see docs/governance/third-party-assets.md and NOTICE.md).
const asset = (name, author, url, license, files) => ({
  type: 'data',
  'bom-ref': `asset:${name}`,
  name,
  author,
  licenses: [{ license: { id: license } }],
  externalReferences: [{ type: 'distribution', url }],
  properties: [{ name: 'game:files', value: files }],
});
bom.components.push(
  asset(
    'Quaternius Universal Base Characters (Standard)',
    'Quaternius',
    'https://quaternius.itch.io/universal-base-characters',
    'CC0-1.0',
    'public/assets/player.glb, hair.glb, skin_*.webp',
  ),
  asset(
    'Quaternius Universal Animation Library 1 and 2 (Standard)',
    'Quaternius',
    'https://quaternius.itch.io/universal-animation-library',
    'CC0-1.0',
    'public/assets/anims.glb',
  ),
  asset('ambientCG Grass005', 'ambientCG', 'https://ambientcg.com/view?id=Grass005', 'CC0-1.0', 'public/assets/grass_*.webp'),
  asset(
    'Freesound recordings (10 sounds)',
    'Freesound contributors (see the asset inventory)',
    'https://freesound.org',
    'CC0-1.0',
    'public/assets/audio/*.mp3',
  ),
  asset('flag-icons 7.6.0', 'Panayiotis Lipiridis and contributors', 'https://github.com/lipis/flag-icons', 'MIT', 'public/assets/flags/*.svg'),
);

// Reproducibility.
let epoch = Number(process.env.SOURCE_DATE_EPOCH);
if (!epoch) {
  try {
    epoch = Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    epoch = 0;
  }
}
bom.metadata.timestamp = new Date((epoch || 1767225600) * 1000).toISOString();
delete bom.serialNumber;
const h = createHash('sha256').update(JSON.stringify(bom)).digest('hex');
bom.serialNumber = `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;

// Validate the essentials.
const problems = [];
if (bom.bomFormat !== 'CycloneDX') problems.push('not a CycloneDX document');
for (const need of ['three', '@fontsource-variable/inter'])
  if (!bom.components.some((c) => c.name === need)) problems.push(`missing runtime component ${need}`);
for (const c of bom.components) if (!c.licenses?.length) problems.push(`component without licence: ${c.name}`);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}

const json = JSON.stringify(bom, null, 2) + '\n';
if (process.argv.includes('--check')) {
  console.log(`✓ SBOM valid: ${bom.components.length} components (CycloneDX ${bom.specVersion})`);
} else {
  const i = process.argv.indexOf('--out');
  const out = i > 0 ? process.argv[i + 1] : join(root, 'release', `${pkg.name}-${pkg.version}.cdx.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`✓ SBOM written: ${out.replace(root, '')} (${bom.components.length} components)`);
}
