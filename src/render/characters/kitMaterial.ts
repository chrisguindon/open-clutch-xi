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
import type { BodyFit } from './assets';

/** Shirt designs the kit shader can draw (generic patterns, never copies of real kits). */
export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'sleeves' | 'checks';

/** One player's kit colours and pattern, resolved for this match (home or change kit, keeper or outfield). */
export interface KitSpec {
  shirt: string;
  shirt2: string;
  trim: string;
  shorts: string;
  socks: string;
  boots: string;
  pattern: KitPattern;
  keeper: boolean;
  gloves: string;
}

const PATTERN_ID: Record<KitPattern, number> = { solid: 0, stripes: 1, hoops: 2, halves: 3, sash: 4, sleeves: 5, checks: 6 };

/**
 * Football kit applied by shader to the CC0 base body. Garment regions are classified per
 * fragment from the bind-pose position (calibrated to the skeleton: knee 0.54 m, hip 0.97 m,
 * shoulder 1.455 m), so boundaries are smooth and independent of the texture layout.
 * Garments get kit colours, patterns, trims, a fabric micro-normal, a little volume, and
 * the player's name and number on the back from a per-team atlas.
 *
 * **Several bodies, one set of boundaries.** The numbers below are calibrated to the reference body. For
 * any other body, `fitBody()` first maps its bind position into the reference body's space: heights
 * piecewise-linearly between matching landmarks (ankle, knee, hip, shoulder, neck, top of head), and the
 * arms sideways by the difference in shoulder width. For the reference body the mapping is the identity,
 * so its kit is unchanged.
 */
const FIT_GLSL = /* glsl */ `
  uniform float uFitFrom[7];
  uniform float uFitTo[7];
  uniform float uArmShift;
  uniform float uArmFrom;
  vec3 fitBody(vec3 p) {
    float y = p.y;
    for (int i = 0; i < 6; i++) {
      if (p.y <= uFitFrom[i + 1] || i == 5) {
        float t = (p.y - uFitFrom[i]) / max(1e-4, uFitFrom[i + 1] - uFitFrom[i]);
        y = mix(uFitTo[i], uFitTo[i + 1], t);
        break;
      }
    }
    // Arms: shift outwards (or inwards) from just inside the shoulder joint, and only at chest height
    // and above, so the torso and hips keep their own width.
    float ax = abs(p.x);
    float armWeight = smoothstep(uArmFrom - 0.07, uArmFrom, ax) * smoothstep(uFitTo[4] - 0.25, uFitTo[4] - 0.13, y);
    float x = sign(p.x) * (ax + uArmShift * armWeight);
    return vec3(x, y, p.z);
  }
`;

const REGION_GLSL = /* glsl */ `
  // 0 skin, 1 shirt, 2 shorts, 3 socks, 4 boots, 5 gloves
  float kitRegion(vec3 p, float keeper) {
    float ax = abs(p.x);
    if (p.y < 0.135) return 4.0;
    if (p.y < 0.475 && ax < 0.3) return 3.0;
    float neckY = 1.485 - (p.z > 0.0 ? max(0.0, 0.055 - ax) * 1.6 : 0.0);
    float sleeveEnd = keeper > 0.5 ? 0.665 : 0.385;
    if (keeper > 0.5 && ax > 0.665 && p.y > 1.25) return 5.0;
    if (ax >= 0.19 && ax < sleeveEnd && p.y > 1.3) return 1.0;
    if (ax < 0.25 && p.y >= 0.985 && p.y < neckY) return 1.0;
    if (ax < 0.3 && p.y > 0.655 && p.y < 1.03) return 2.0;
    return 0.0;
  }
`;

export interface KitUniforms {
  uShirt: { value: THREE.Color };
  uShirt2: { value: THREE.Color };
  uTrim: { value: THREE.Color };
  uShorts: { value: THREE.Color };
  uSocks: { value: THREE.Color };
  uBoots: { value: THREE.Color };
  uGloves: { value: THREE.Color };
  uPattern: { value: number };
  uKeeper: { value: number };
  uAtlas: { value: THREE.Texture | null };
  uCell: { value: THREE.Vector2 };
  uCrest: { value: THREE.Vector2 };
  uFitFrom: { value: number[] };
  uFitTo: { value: number[] };
  uArmShift: { value: number };
  uArmFrom: { value: number };
  uChestY: { value: number };
}

/**
 * Create one player's body material: the source body material with the kit shader added.
 * @param cell - this player's name/number cell in the team atlas (0–14)
 * @param fit - the body being dressed and the reference body the garment boundaries are calibrated to
 *   (pass the same fit twice for the reference body)
 */
export function createKitMaterial(
  source: THREE.MeshStandardMaterial,
  kit: KitSpec,
  atlas: THREE.Texture,
  cell: number,
  skinMap: THREE.Texture,
  skinTint: THREE.Color,
  fit: { body: BodyFit; reference: BodyFit },
): THREE.MeshStandardMaterial {
  const mat = source.clone();
  mat.map = skinMap;
  mat.color.copy(skinTint);
  mat.metalness = 0;
  const u: KitUniforms = {
    uShirt: { value: new THREE.Color(kit.shirt) },
    uShirt2: { value: new THREE.Color(kit.shirt2) },
    uTrim: { value: new THREE.Color(kit.trim) },
    uShorts: { value: new THREE.Color(kit.shorts) },
    uSocks: { value: new THREE.Color(kit.socks) },
    uBoots: { value: new THREE.Color(kit.boots) },
    uGloves: { value: new THREE.Color(kit.gloves) },
    uPattern: { value: PATTERN_ID[kit.pattern] },
    uKeeper: { value: kit.keeper ? 1 : 0 },
    uAtlas: { value: atlas },
    uCell: { value: new THREE.Vector2((cell % 4) * 0.25, Math.floor(cell / 4) * 0.25) },
    uCrest: { value: new THREE.Vector2(0.75, 0.75) },
    uFitFrom: { value: [...fit.body.heights] },
    uFitTo: { value: [...fit.reference.heights] },
    uArmShift: { value: fit.reference.shoulderX - fit.body.shoulderX },
    uArmFrom: { value: fit.body.shoulderX },
    uChestY: { value: fit.body.chestBadgeY },
  };
  mat.userData.kit = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uKeeper;
        varying vec3 vBind;
        ${FIT_GLSL}
        ${REGION_GLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // Everything downstream (regions, patterns, names, numbers) works in the reference body's space.
        vBind = fitBody(position);
        {
          // Garments sit slightly proud of the skin (shorts and boots more so).
          float r = kitRegion(vBind, uKeeper);
          float inflate = r == 1.0 ? 0.007 : r == 2.0 ? 0.016 : r == 3.0 ? 0.004 : r == 4.0 ? 0.01 : r == 5.0 ? 0.008 : 0.0;
          transformed += normal * inflate;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uShirt, uShirt2, uTrim, uShorts, uSocks, uBoots, uGloves;
        uniform float uPattern, uKeeper, uChestY;
        uniform sampler2D uAtlas;
        uniform vec2 uCell, uCrest;
        varying vec3 vBind;
        float kitR;
        ${REGION_GLSL}
        float kHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        vec3 shirtColour(vec3 p) {
          float ax = abs(p.x);
          bool sleeve = ax >= 0.19;
          vec3 c = uShirt;
          if (uPattern == 1.0 && !sleeve) c = mix(uShirt, uShirt2, step(0.5, fract(p.x / 0.095 + 0.25)));
          else if (uPattern == 2.0) c = mix(uShirt, uShirt2, step(0.5, fract(p.y / 0.11)));
          else if (uPattern == 3.0 && !sleeve) c = p.x > 0.0 ? uShirt : uShirt2;
          else if (uPattern == 4.0 && !sleeve && p.z > 0.0) c = mix(uShirt, uShirt2, step(abs(p.x - (p.y - 1.24) * 0.85), 0.045));
          else if (uPattern == 5.0 && sleeve) c = uShirt2;
          else if (uPattern == 6.0 && !sleeve) c = mix(uShirt, uShirt2, mod(floor(p.x / 0.075 + 20.0) + floor(p.y / 0.075), 2.0));
          // Collar band, cuffs and a side panel in the trim colour.
          float neckY = 1.485 - (p.z > 0.0 ? max(0.0, 0.055 - ax) * 1.6 : 0.0);
          float sleeveEnd = uKeeper > 0.5 ? 0.665 : 0.385;
          if (p.y > neckY - 0.022 && !sleeve) c = uTrim;
          if (sleeve && ax > sleeveEnd - 0.022) c = uTrim;
          if (!sleeve && ax > 0.205 && ax < 0.235 && p.y < 1.3) c = mix(c, uTrim, 0.85);
          return c;
        }
        vec4 sampleCell(vec2 cell, vec2 uv) {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
          return texture2D(uAtlas, cell + vec2(uv.x, 1.0 - uv.y) * 0.25);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 p = vBind;
          kitR = kitRegion(p, uKeeper);
          if (kitR == 1.0) {
            vec3 c = shirtColour(p);
            // Name and number on the back (u runs to the player's right as seen from behind).
            if (p.z < -0.02 && abs(p.x) < 0.19) {
              vec4 t = sampleCell(uCell, vec2(0.5 - p.x / 0.34, (p.y - 1.05) / 0.36));
              c = mix(c, t.rgb, t.a);
            }
            // Small number on the right chest and the club crest on the left.
            if (p.z > 0.04) {
              vec4 n = sampleCell(uCell, vec2(0.5 - (p.x + 0.085) / 0.075, (p.y - uChestY) / 0.1 * 0.75));
              c = mix(c, n.rgb, n.a);
              vec4 cr = sampleCell(uCrest, vec2(0.5 - (p.x - 0.085) / 0.075, (p.y - uChestY - 0.015) / 0.075));
              c = mix(c, cr.rgb, cr.a);
            }
            diffuseColor.rgb = c;
          } else if (kitR == 2.0) {
            vec3 c = uShorts;
            if (abs(abs(p.x) - 0.215) < 0.012) c = uTrim;
            diffuseColor.rgb = c;
          } else if (kitR == 3.0) {
            vec3 c = uSocks;
            if (p.y > 0.43 && p.y < 0.45) c = uTrim;
            diffuseColor.rgb = c;
          } else if (kitR == 4.0) {
            // Boots: dark sole and a coloured upper.
            diffuseColor.rgb = p.y < 0.025 ? vec3(0.03) : uBoots;
          } else if (kitR == 5.0) {
            diffuseColor.rgb = uGloves;
          }
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (kitR > 0.5) roughnessFactor = kitR == 4.0 ? 0.32 : kitR == 5.0 ? 0.55 : 0.68;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
          // Fabric: soften the body's muscle detail and add a fine weave.
          if (kitR > 0.5 && kitR < 4.5) {
            mapN.xy *= 0.3;
            vec2 w = vBind.xy * vec2(900.0, 900.0);
            mapN.xy += (vec2(kHash(floor(w)), kHash(floor(w) + 7.0)) - 0.5) * 0.08;
          }
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
        #else
          #include <normal_fragment_maps>
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'footballer-kit-v1';
  return mat;
}

/**
 * Per-team atlas: 4×4 cells of 256 px. Cells 0–14 hold a player's name and number
 * (name across the top quarter), cell 15 the club crest.
 */
export function createKitAtlas(
  names: string[],
  numbers: number[],
  numberColour: string,
  outline: string,
  crest: { primary: string; secondary: string; short: string },
): THREE.CanvasTexture {
  const S = 1024,
    C = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < Math.min(15, names.length); i++) {
    const x = (i % 4) * C,
      y = Math.floor(i / 4) * C;
    ctx.fillStyle = numberColour;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 6;
    ctx.font = `800 ${Math.min(40, Math.floor(420 / Math.max(6, names[i].length)))}px "Segoe UI", Helvetica, Arial, sans-serif`;
    ctx.strokeText(names[i], x + C / 2, y + 34);
    ctx.fillText(names[i], x + C / 2, y + 34);
    ctx.font = '900 168px "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.lineWidth = 10;
    ctx.strokeText(String(numbers[i]), x + C / 2, y + 150);
    ctx.fillText(String(numbers[i]), x + C / 2, y + 150);
  }
  // Crest: shield with initials.
  const cx = 3 * C + C / 2,
    cy = 3 * C + C / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 90, cy - 100);
  ctx.lineTo(cx + 90, cy - 100);
  ctx.lineTo(cx + 90, cy + 10);
  ctx.quadraticCurveTo(cx + 85, cy + 85, cx, cy + 115);
  ctx.quadraticCurveTo(cx - 85, cy + 85, cx - 90, cy + 10);
  ctx.closePath();
  ctx.fillStyle = crest.primary;
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = crest.secondary;
  ctx.stroke();
  ctx.fillStyle = crest.secondary;
  ctx.font = '900 64px "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText(crest.short, cx, cy - 5);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false; // v = 0 at the top of the canvas (cells are addressed top-down)
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
