/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import * as THREE from 'three';
import { Rng } from '../core/rng';
import { BRAND } from '../brand';

/**
 * Procedurally generated textures. Everything visual is generated at runtime,
 * so the game ships with zero third-party art assets and loads instantly.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Tileable grass detail: blades and clumps at high frequency. */
export function grassDetailTexture(size = 512): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const rng = new Rng(11);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  // Soft clumps.
  for (let i = 0; i < 900; i++) {
    const x = rng.next() * size,
      y = rng.next() * size,
      r = 4 + rng.next() * 18;
    const v = 110 + rng.next() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v},${v},0.25)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
  }
  // Blades.
  for (let i = 0; i < 26000; i++) {
    const x = rng.next() * size,
      y = rng.next() * size;
    const len = 2 + rng.next() * 5;
    const a = -Math.PI / 2 + (rng.next() - 0.5) * 1.2;
    const v = Math.floor(80 + rng.next() * 120);
    ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    ctx.lineWidth = 0.8 + rng.next() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  return toTexture(c, false, true);
}

/** Whole-pitch albedo modulation: mowing stripes, subtle checker, goalmouth wear. */
export function pitchPatternTexture(length: number, width: number, stripes: number): THREE.CanvasTexture {
  const W = 1024,
    H = Math.round((1024 * width) / length);
  const [c, ctx] = canvas(W, H);
  const rng = new Rng(5);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, W, H);
  const sw = W / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.11)';
    ctx.fillRect(i * sw, 0, sw, H);
  }
  // Faint cross-mowing.
  const cross = Math.max(4, Math.round(stripes * (width / length)));
  const sh = H / cross;
  for (let i = 0; i < cross; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
    ctx.fillRect(0, i * sh, W, sh);
  }
  // Large scale colour variation.
  for (let i = 0; i < 120; i++) {
    const x = rng.next() * W,
      y = rng.next() * H,
      r = 30 + rng.next() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const d = rng.next() < 0.5 ? '255,255,255' : '0,0,0';
    g.addColorStop(0, `rgba(${d},0.05)`);
    g.addColorStop(1, `rgba(${d},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Wear in the goalmouths and centre circle (lighter, browner via the alpha channel trick: we use blue channel as wear mask).
  // Light, speckled wear in the goalmouths.
  const wear = (x: number, y: number, rx: number, ry: number) => {
    for (let i = 0; i < 220; i++) {
      const px = x + rng.gaussian() * rx,
        py = y + rng.gaussian() * ry;
      const r = 1 + rng.next() * 2.5;
      ctx.fillStyle = `rgba(150,140,60,${0.1 + rng.next() * 0.12})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  wear(W * 0.008, H / 2, W * 0.008, H * 0.04);
  wear(W * 0.992, H / 2, W * 0.008, H * 0.04);
  const t = toTexture(c, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Original ball design: white base with flowing coloured bands and accents. */
export function ballTexture(): THREE.CanvasTexture {
  const W = 1024,
    H = 512;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#f7f7f2';
  ctx.fillRect(0, 0, W, H);
  const bands = [
    { color: '#ff3b3b', phase: 0, amp: 70, y: H * 0.32, w: 26 },
    { color: '#1d4ed8', phase: 2.1, amp: 70, y: H * 0.68, w: 26 },
    { color: '#111827', phase: 4.2, amp: 55, y: H * 0.5, w: 10 },
  ];
  for (const b of bands) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = b.y + Math.sin((x / W) * Math.PI * 4 + b.phase) * b.amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Panel seams.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = (H * (i + 0.5)) / 6 + Math.sin((x / W) * Math.PI * 6 + i) * 22;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Star accents.
  ctx.fillStyle = '#f59e0b';
  for (let i = 0; i < 6; i++) {
    const x = (i + 0.5) * (W / 6),
      y = H * (i % 2 ? 0.18 : 0.82);
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 10 : 24;
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  return toTexture(c);
}

/** Net pattern with alpha (hexagonal-ish mesh). */
export function netTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(S, S);
  ctx.moveTo(S, 0);
  ctx.lineTo(0, S);
  ctx.stroke();
  const t = toTexture(c, true, true);
  return t;
}

const SPONSORS: Array<{ text: string; bg: string; fg: string; brand?: boolean }> = [
  { text: 'NOVA COLA', bg: '#b91c1c', fg: '#ffffff' },
  { text: 'PIXELWORKS', bg: '#111827', fg: '#22d3ee' },
  { text: 'ORBIT AIR', bg: '#1e3a8a', fg: '#fde047' },
  { text: 'KITE BANK', bg: '#065f46', fg: '#ffffff' },
  { text: 'LUMEN ENERGY', bg: '#f59e0b', fg: '#111827' },
  { text: BRAND.boardText, bg: '#0b1020', fg: '#ffffff' },
  { text: 'TERRA BOOTS', bg: '#7c3aed', fg: '#ffffff' },
  // The creator's site, in its own colours (one panel of nine; drawn specially below).
  { text: 'chrisguindon.com', bg: '#0b1530', fg: '#f1f5f9', brand: true },
  { text: 'QUICKSHIP', bg: '#e11d48', fg: '#fff1f2' },
];

/** Long LED advertising strip with fictional sponsors. */
export function adBoardTexture(): THREE.CanvasTexture {
  const panelW = 512,
    H = 64;
  const [c, ctx] = canvas(panelW * SPONSORS.length, H);
  SPONSORS.forEach((s, i) => {
    const x = i * panelW;
    const g = ctx.createLinearGradient(x, 0, x, H);
    g.addColorStop(0, s.bg);
    g.addColorStop(1, shade(s.bg, -30));
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, panelW, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s.brand) {
      // chrisguindon.com: clean lowercase wordmark — name in white, ".com" in the site's blue, accent rule.
      ctx.font = '800 36px "Inter Variable", Inter, "Segoe UI", Helvetica, Arial, sans-serif';
      const name = 'chrisguindon',
        dot = '.com';
      const wName = ctx.measureText(name).width,
        wDot = ctx.measureText(dot).width;
      const x0 = x + panelW / 2 - (wName + wDot) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = s.fg;
      ctx.fillText(name, x0, H / 2 + 1);
      ctx.fillStyle = '#60a5fa';
      ctx.fillText(dot, x0 + wName, H / 2 + 1);
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(x0, H - 12, wName + wDot, 3);
    } else {
      ctx.fillStyle = s.fg;
      ctx.font = 'italic 900 40px "Segoe UI", Helvetica, Arial, sans-serif';
      ctx.fillText(s.text, x + panelW / 2, H / 2 + 2);
    }
    // LED scanlines.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(x, y, panelW, 1);
  });
  const t = toTexture(c, true, true);
  return t;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

/**
 * Seating texture for stands. Laid out for ExtrudeGeometry side-wall UVs:
 * canvas x = depth across one step, canvas y = along the stand.
 */
export function seatsTexture(primary: string, secondary: string): THREE.CanvasTexture {
  const W = 64,
    H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#3b3f47';
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 8) {
    ctx.fillStyle = (y / 8) % 11 === 0 ? secondary : primary;
    ctx.fillRect(14, y + 1, 34, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(44, y + 1, 6, 6);
  }
  return toTexture(c, true, true);
}

/** Soft radial glow sprite used for floodlight flares and particles. */
export function glowTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,250,235,0.8)');
  g.addColorStop(0.5, 'rgba(255,240,210,0.18)');
  g.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

/** Simple soft blob shadow. */
export function blobTexture(): THREE.CanvasTexture {
  const S = 64;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

/** Elongated soft shadow streak (floodlight multi-shadows): dark at the feet (u = 0), fading with distance. */
export function streakTexture(): THREE.CanvasTexture {
  const W = 128,
    H = 32;
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1),
        v = (y / (H - 1)) * 2 - 1;
      const width = 0.55 + 0.45 * Math.sin((Math.min(1, u * 3) * Math.PI) / 2) * (1 - u * 0.5);
      const across = Math.max(0, 1 - (v / width) ** 2);
      const along = Math.min(1, u * 14) * (1 - u) ** 1.4;
      const a = across * along;
      const i = (y * W + x) * 4;
      img.data[i + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

/**
 * Crowd sprite atlas: 8 cells (4 body/skin variants × 2 poses: arms down / arms up).
 * Returns a colour texture (shirt drawn white so it can be tinted per fan) and a shirt mask.
 */
export function crowdAtlas(): { color: THREE.CanvasTexture; mask: THREE.CanvasTexture } {
  const CW = 64,
    CH = 128,
    N = 8;
  const [cc, c] = canvas(CW * N, CH);
  const [mc, m] = canvas(CW * N, CH);
  m.fillStyle = '#000';
  m.fillRect(0, 0, CW * N, CH);
  const skins = ['#f1c27d', '#8d5524', '#e0ac69', '#c68642'];
  const hairs = ['#2b1a10', '#111111', '#6b4423', '#d9b26f'];
  const legs = ['#1f2937', '#334155', '#1e3a8a', '#3f3f46'];
  for (let v = 0; v < 4; v++) {
    for (let pose = 0; pose < 2; pose++) {
      const ox = (v * 2 + pose) * CW;
      const cx = ox + CW / 2;
      const w = 30 + (v % 2) * 6;
      const shoulderY = 50;
      // Legs / lap (seated, mostly hidden by the row in front).
      c.fillStyle = legs[v];
      c.fillRect(cx - w / 2 + 3, 98, w - 6, 30);
      // Torso (shirt): white with soft shading so the tint keeps some form.
      const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      g.addColorStop(0, '#c9c9c9');
      g.addColorStop(0.45, '#ffffff');
      g.addColorStop(1, '#bdbdbd');
      c.fillStyle = g;
      roundRect(c, cx - w / 2, shoulderY, w, 52, 9);
      c.fill();
      m.fillStyle = '#fff';
      roundRect(m, cx - w / 2, shoulderY, w, 52, 9);
      m.fill();
      // Arms.
      const armW = 9;
      for (const sx of [-1, 1]) {
        const ax = cx + sx * (w / 2 - 2);
        if (pose === 0) {
          c.fillStyle = '#e5e5e5';
          roundRect(c, ax - armW / 2, shoulderY + 4, armW, 34, 4);
          c.fill();
          m.fillStyle = '#fff';
          roundRect(m, ax - armW / 2, shoulderY + 4, armW, 34, 4);
          m.fill();
          c.fillStyle = skins[v];
          c.beginPath();
          c.arc(ax, shoulderY + 40, 4.5, 0, Math.PI * 2);
          c.fill();
        } else {
          c.save();
          c.translate(ax, shoulderY + 6);
          c.rotate(sx * -2.6);
          c.fillStyle = '#e5e5e5';
          roundRect(c, -armW / 2, 0, armW, 26, 4);
          c.fill();
          c.fillStyle = skins[v];
          roundRect(c, -armW / 2 + 1, 24, armW - 2, 14, 4);
          c.fill();
          c.restore();
          m.save();
          m.translate(ax, shoulderY + 6);
          m.rotate(sx * -2.6);
          m.fillStyle = '#fff';
          roundRect(m, -armW / 2, 0, armW, 26, 4);
          m.fill();
          m.restore();
        }
      }
      // Neck + head.
      c.fillStyle = skins[v];
      c.fillRect(cx - 5, shoulderY - 8, 10, 10);
      c.beginPath();
      c.ellipse(cx, shoulderY - 20, 12, 14, 0, 0, Math.PI * 2);
      c.fill();
      // Shading on the face and hair cap.
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.beginPath();
      c.ellipse(cx + 4, shoulderY - 18, 7, 11, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = hairs[v];
      c.beginPath();
      c.ellipse(cx, shoulderY - 27, 12.5, 8, 0, Math.PI, Math.PI * 2);
      c.fill();
      c.fillRect(cx - 12.5, shoulderY - 28, 25, 4);
    }
  }
  const color = toTexture(cc);
  const mask = toTexture(mc, false);
  for (const t of [color, mask]) {
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { color, mask };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
