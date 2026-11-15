/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Packages the static web build as release artefacts. It does NOT tag, publish or upload anything.
//   npm run release:package                 build, then package into release/
//   npm run release:package -- --no-build   package the existing dist/
//   npm run release:package -- --no-source  skip the source archive
//   npm run release:package -- --source-only  only (re)write the source archive and SHA256SUMS
// SOURCE_COMMIT and SOURCE_DATE_EPOCH override what git reports (release:check packages a clean copy
// that has no history of its own).
//
// Produces, for version V (package.json):
//   release/open-clutch-xi-vV-web.tar.gz     the playable static site plus licence, notices, hosting policy
//   release/open-clutch-xi-vV-source.tar.gz  the committed source at HEAD (git archive)
//   release/SHA256SUMS                       checksums of both, in `sha256sum -c` format
//
// The web archive contains one folder, open-clutch-xi-vV-web/, with:
//   site/                  the files to serve (the web root)
//   LICENSE, NOTICE.md     licence and third-party notices
//   hosting/headers.json   recommended HTTP headers (security policy, caching, MIME types)
//   HOSTING.md             how to host it (docs/development/hosting.md)
//   release-manifest.json  version, source commit and the SHA-256 of every other file
//
// Reproducible: built without SITE_URL, entries sorted, fixed owner/permissions, and every timestamp set
// to the last commit's time (or SOURCE_DATE_EPOCH). Building the same commit twice gives identical bytes.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createTar } from './lib/tar.mjs';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const base = `${pkg.name}-v${version}`;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

const hasHead = spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root }).status === 0;
const commit = process.env.SOURCE_COMMIT || (hasHead ? git('rev-parse', 'HEAD') : null);
const dirty = process.env.SOURCE_COMMIT ? false : hasHead ? git('status', '--porcelain').length > 0 : null;
const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? (hasHead ? git('log', '-1', '--format=%ct') : 0));
const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const web = `${base}-web.tar.gz`;
const src = `${base}-source.tar.gz`;

/** Checksums of this version's archives that exist, in `sha256sum -c` format. */
function writeSums() {
  const sums = [web, src].filter((n) => existsSync(join(outDir, n))).map((n) => [n, sha256(readFileSync(join(outDir, n)))]);
  writeFileSync(join(outDir, 'SHA256SUMS'), sums.map(([n, h]) => `${h}  ${n}\n`).join(''));
  for (const [n, h] of sums) console.log(`✓ ${n}\n  sha256 ${h}`);
}
function writeSource() {
  // The committed source only (uncommitted changes are not in a source release).
  if (!hasHead) throw new Error('no commit to archive: the source archive needs a Git commit');
  execFileSync('git', ['archive', '--format=tar.gz', `--prefix=${base}/`, '-o', join(outDir, src), 'HEAD'], { cwd: root });
}
if (args.includes('--source-only')) {
  writeSource();
  writeSums();
  process.exit(0);
}

if (!args.includes('--no-build')) {
  // Released builds name no site: hosts add their own URL (see src/siteMeta.ts).
  const env = { ...process.env };
  delete env.SITE_URL;
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html is missing: run the build first');
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

const files = [];
for (const abs of walk(dist)) files.push({ path: `site/${relative(dist, abs).split('\\').join('/')}`, data: readFileSync(abs) });
files.push({ path: 'LICENSE', data: readFileSync(join(root, 'LICENSE')) });
files.push({ path: 'NOTICE.md', data: readFileSync(join(root, 'NOTICE.md')) });
files.push({ path: 'hosting/headers.json', data: readFileSync(join(root, 'hosting/headers.json')) });
files.push({ path: 'HOSTING.md', data: readFileSync(join(root, 'docs/development/hosting.md')) });

// Guard against leaking private information into a public artefact.
const PRIVATE = [/\/home\/[a-z]/i, /\/Users\/[a-z]/i, /[A-Z]:\\Users\\/i, /\.local\/agent-history/];
for (const f of files) {
  if (/\.(js|css|html|json|txt|md|svg)$/.test(f.path)) {
    const text = f.data.toString('utf8');
    const hit = PRIVATE.find((re) => re.test(text));
    if (hit) throw new Error(`${f.path} contains a private path (${hit}); refusing to package`);
  }
  if (/\.map$/.test(f.path)) throw new Error(`${f.path}: source maps are not shipped`);
}

const manifest = {
  format: 1,
  project: pkg.name,
  version,
  sourceCommit: commit,
  sourceDirty: dirty,
  sourceDateEpoch: epoch,
  siteRoot: 'site',
  files: Object.fromEntries(files.map((f) => [f.path, sha256(f.data)]).sort(([a], [b]) => (a < b ? -1 : 1))),
};
files.push({ path: 'release-manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });

const tar = createTar(
  files.map((f) => ({ path: `${base}-web/${f.path}`, data: f.data })),
  epoch,
);
writeFileSync(join(outDir, web), gzipSync(tar, { level: 9 }));
if (!args.includes('--no-source') && hasHead) writeSource();
writeSums();
console.log(
  `  ${files.length} files in the web archive; source commit ${commit ?? 'unknown'}${dirty ? ' (working tree has uncommitted changes: not releasable)' : ''}`,
);
console.log('Nothing was tagged, uploaded or published.');
