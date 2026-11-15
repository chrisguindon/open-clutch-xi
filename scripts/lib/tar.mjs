/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// A tiny, deterministic tar writer (POSIX ustar), so release archives are byte-for-byte reproducible on
// any operating system without extra tools: entries are sorted, and every file gets the same owner,
// permissions and timestamp. Only regular files are written; directories are implied by the paths.
// Gzip it with zlib, whose output is also deterministic (its header carries no time).

const BLOCK = 512;

function field(buf, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new Error(`tar field too long: ${value}`);
  bytes.copy(buf, offset);
}
const octal = (n, length) => n.toString(8).padStart(length - 1, '0') + '\0';

/** Splits a path into ustar `prefix` and `name` (name ≤ 100 bytes, prefix ≤ 155 bytes). */
function splitPath(path) {
  if (Buffer.byteLength(path) <= 100) return ['', path];
  const cut = path.lastIndexOf('/', path.length - 1);
  for (let i = cut; i > 0; i = path.lastIndexOf('/', i - 1)) {
    const prefix = path.slice(0, i),
      name = path.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return [prefix, name];
  }
  throw new Error(`path too long for a tar archive: ${path}`);
}

/**
 * Builds an uncompressed tar archive.
 * @param {{ path: string, data: Buffer }[]} files Relative paths using `/`.
 * @param {number} mtime Seconds since 1970 for every entry (use SOURCE_DATE_EPOCH for reproducibility).
 * @returns {Buffer}
 */
export function createTar(files, mtime) {
  const parts = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (f.path.startsWith('/') || f.path.split('/').includes('..')) throw new Error(`unsafe path: ${f.path}`);
    const h = Buffer.alloc(BLOCK);
    const [prefix, name] = splitPath(f.path);
    field(h, 0, 100, name);
    field(h, 100, 8, octal(0o644, 8));
    field(h, 108, 8, octal(0, 8));
    field(h, 116, 8, octal(0, 8));
    field(h, 124, 12, octal(f.data.length, 12));
    field(h, 136, 12, octal(mtime, 12));
    h.fill(0x20, 148, 156); // checksum is computed with its own field as spaces
    field(h, 156, 1, '0');
    field(h, 257, 6, 'ustar\0');
    field(h, 263, 2, '00');
    field(h, 345, 155, prefix);
    let sum = 0;
    for (const b of h) sum += b;
    field(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    parts.push(h, f.data, Buffer.alloc((BLOCK - (f.data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // end-of-archive marker
  return Buffer.concat(parts);
}

/**
 * Reads the regular files of a ustar archive (as written by {@link createTar}). Rejects anything else:
 * links, devices, absolute paths and `..` segments, so extracting can never write outside its folder.
 * @param {Buffer} tar
 * @returns {{ path: string, data: Buffer }[]}
 */
export function readTar(tar) {
  const out = [];
  let o = 0;
  const str = (a, b) => tar.toString('utf8', a, b).replace(/\0.*$/s, '');
  while (o + BLOCK <= tar.length) {
    const h = tar.subarray(o, o + BLOCK);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (sum !== parseInt(str(o + 148, o + 156).trim(), 8)) throw new Error('tar header checksum mismatch');
    const type = str(o + 156, o + 157) || '0';
    const name = str(o, o + 100),
      prefix = str(o + 345, o + 500);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(str(o + 124, o + 136).trim(), 8);
    if (type !== '0' && type !== '5') throw new Error(`unsupported tar entry type ${type} for ${path}`);
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe path in archive: ${path}`);
    o += BLOCK;
    if (type === '0') out.push({ path, data: Buffer.from(tar.subarray(o, o + size)) });
    o += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
