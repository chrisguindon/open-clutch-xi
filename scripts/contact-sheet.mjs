/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Tile screenshots into one sheet: node scripts/contact-sheet.mjs out.png cols a.png b.png ...
import sharp from 'sharp';
const [out, colsArg, ...files] = process.argv.slice(2);
const cols = +colsArg,
  W = 640,
  H = 360;
const rows = Math.ceil(files.length / cols);
const tiles = await Promise.all(files.map((f) => sharp(f).resize(W, H).toBuffer()));
await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: '#000' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * W, top: Math.floor(i / cols) * H })))
  .png()
  .toFile(out);
console.log(out);
