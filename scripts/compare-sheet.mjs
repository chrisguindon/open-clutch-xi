/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Labelled before/after sheet: node scripts/compare-sheet.mjs out.png beforeDir afterDir name1 name2 ...
import sharp from 'sharp';
import { existsSync } from 'node:fs';
const [out, before, after, ...names] = process.argv.slice(2);
const W = 640,
  H = 360,
  LH = 26;
const label = (t) =>
  Buffer.from(
    `<svg width="${W}" height="${LH}"><rect width="100%" height="100%" fill="#0b1020"/><text x="10" y="18" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#e5e7eb">${t}</text></svg>`,
  );
const tiles = [];
let row = 0;
for (const n of names) {
  for (const [col, dir, tag] of [
    [0, before, process.env.BEFORE_LABEL || 'BEFORE'],
    [1, after, process.env.AFTER_LABEL || 'AFTER'],
  ]) {
    const f = `${dir}/${n}.png`;
    const img = existsSync(f)
      ? await sharp(f).resize(W, H).toBuffer()
      : await sharp({ create: { width: W, height: H, channels: 3, background: '#222' } })
          .png()
          .toBuffer();
    tiles.push({ input: label(`${tag} · ${n}${existsSync(f) ? '' : ' (no capture)'}`), left: col * W, top: row * (H + LH) });
    tiles.push({ input: img, left: col * W, top: row * (H + LH) + LH });
  }
  row++;
}
await sharp({ create: { width: W * 2, height: row * (H + LH), channels: 3, background: '#000' } })
  .composite(tiles)
  .png()
  .toFile(out);
console.log(out);
