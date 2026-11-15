/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/**
 * Builds the stadium: stands, floodlight towers, advertising boards, sky and lighting for each time
 * of day. Geometry is statically batched (few draw calls), and the crowd is drawn as instanced
 * billboards animated in the vertex shader. The stand layout is shared with the camera, which must
 * stay inside the bowl.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PitchConfig } from '../sim/config';
import { Rng } from '../core/rng';
import type { SurfaceTextures } from './environment';
import { adBoardTexture, crowdAtlas, glowTexture, grassDetailTexture, netTexture, pitchPatternTexture, seatsTexture } from './textures';

/** Kick-off time: changes the sky, lighting, floodlights and colour grade (a player setting). */
export type TimeOfDay = 'night' | 'day' | 'dusk';

/** Everything the stadium builder needs: pitch size, crowd size (from the quality preset) and look. */
export interface StadiumOptions {
  pitch: PitchConfig;
  crowdCount: number;
  timeOfDay: TimeOfDay;
  homeColor: string;
  awayColor: string;
  shadows: boolean;
  /** Photo-scanned turf textures (optional; falls back to procedural detail). */
  surface?: SurfaceTextures | null;
  /** Direction towards the sun / key floodlight. */
  keyDir?: THREE.Vector3;
  /** Light shafts / haze around floodlights. */
  haze?: boolean;
  /** Number of floodlight fill lights (3 = per tower, 1 = combined). Default 3. */
  fillLights?: number;
}

/** Stand geometry shared by the stadium builder and the camera (which must stay inside the bowl). */
export interface StadiumLayout {
  gap: number;
  tiers: number;
  stepD: number;
  stepH: number;
  baseY: number;
  sideFront: number;
  sideBack: number;
  endFront: number;
  endBack: number;
  roofY: number;
}

/** Stand geometry for a pitch size. Pure, so the camera can keep inside the same bowl the builder draws. */
export function stadiumLayout(p: PitchConfig): StadiumLayout {
  const gap = 6.5;
  const tiers = Math.round(14 + p.length / 12);
  const stepD = 0.85,
    stepH = 0.48,
    baseY = 0.6;
  const depth = tiers * stepD;
  return {
    gap,
    tiers,
    stepD,
    stepH,
    baseY,
    sideFront: p.width / 2 + gap,
    sideBack: p.width / 2 + gap + depth,
    endFront: p.length / 2 + gap,
    endBack: p.length / 2 + gap + depth,
    roofY: baseY + tiers * stepH + 9,
  };
}

/** Height of the seating surface at a horizontal distance `d` behind the stand front. */
export function seatHeightAt(l: StadiumLayout, d: number): number {
  if (d <= 0) return 0;
  return l.baseY + Math.min(l.tiers, Math.ceil(d / l.stepD)) * l.stepH;
}

interface NetPanel {
  geo: THREE.BufferGeometry;
  rest: Float32Array;
  disp: Float32Array;
  vel: Float32Array;
  /** Local axis along which vertices are displaced. */
  normal: THREE.Vector3;
  side: 1 | -1;
  pinned: Uint8Array;
}

/**
 * Builds the whole stadium environment and exposes the few animated parts
 * (nets, LED boards, crowd excitement, corner flags).
 */
export class Stadium {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private nets: NetPanel[] = [];
  private boardTex: THREE.CanvasTexture | null = null;
  private crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uWave: { value: 0 } };
  private flags: THREE.Mesh[] = [];
  private flagUniforms = { uTime: { value: 0 } };
  private disposables: Array<{ dispose(): void }> = [];
  crowdMesh: THREE.Object3D | null = null;

  constructor(readonly opts: StadiumOptions) {
    const p = opts.pitch;
    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x203018, 0.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.setupLights();
    this.buildGround();
    this.buildLines();
    this.buildGoal(1);
    this.buildGoal(-1);
    // Lights, pitch, markings and goals are "core"; everything after is stadium detail (benchmark toggle).
    for (const c of this.group.children) c.userData.core = true;
    this.buildBoards();
    this.buildStands();
    this.buildFloodlights();
    this.buildCornerFlags();
    this.buildDugouts();
    this.batchStatic();
    void p;
  }

  /** Profiling: draw calls before / after static batching. */
  batchStats = { before: 0, after: 0 };

  /**
   * Static batching: merge every static mesh that shares a material (and shadow flags) into one mesh,
   * with transforms baked in. The stadium had ~120 separate draw calls (32 lamp discs alone); most of
   * it never moves. Dynamic objects (nets, flags, sprites, shader beams, instanced meshes, multi-material
   * meshes) are left alone. Static objects also stop recomputing their matrices every frame.
   */
  private batchStatic(): void {
    this.sun.target.userData.dynamic = true; // follows the action (focusShadow)
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const groups = new Map<string, THREE.Mesh[]>();
    let before = 0;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      before += Array.isArray(m.material) ? m.material.length : 1;
      if ((m as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || m.userData.dynamic) return;
      if (Array.isArray(m.material) || (m.material as THREE.ShaderMaterial).isShaderMaterial) return;
      if (m === this.crowdMesh) return;
      const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${!!m.userData.core}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    });
    for (const meshes of groups.values()) {
      if (meshes.length < 2) continue;
      const attrs = (g: THREE.BufferGeometry) => Object.keys(g.attributes).sort().join(',');
      const sig = attrs(meshes[0].geometry);
      if (meshes.some((m) => attrs(m.geometry) !== sig || m.geometry.morphAttributes.position)) continue;
      const geos = meshes.map((m) => {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        g.clearGroups();
        return g;
      });
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const first = meshes[0];
      const batch = new THREE.Mesh(merged, first.material);
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder;
      batch.userData.core = !!first.userData.core;
      batch.name = 'static-batch';
      for (const m of meshes) m.removeFromParent();
      this.group.add(batch);
      this.track(merged);
    }
    // Nothing static moves again: skip per-frame matrix recomposition.
    let after = 0;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible) after += Array.isArray(m.material) ? m.material.length : 1;
      if (o !== this.group && !o.userData.dynamic && !(o as THREE.Light).isLight && !(o as THREE.InstancedMesh).isInstancedMesh) {
        o.updateMatrix();
        o.matrixAutoUpdate = false;
      }
    });
    this.batchStats = { before, after };
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  /** Directions (unit, world) of the non-shadow floodlight fills — used for the multi-shadow decals. */
  readonly fillDirs: THREE.Vector3[] = [];

  private setupLights(): void {
    const tod = this.opts.timeOfDay;
    const p = this.opts.pitch;
    const towers = floodlightTowers(p);
    const key = this.opts.keyDir?.clone() ?? new THREE.Vector3(0.25, 0.92, 0.3).normalize();
    if (tod === 'day') {
      this.hemi.color.set(0xbfd8ff);
      this.hemi.groundColor.set(0x3a5a2a);
      this.hemi.intensity = 0.7;
      this.sun.color.set(0xfff1dc);
      this.sun.intensity = 3.0;
      this.sun.position.copy(key).multiplyScalar(90);
    } else if (tod === 'dusk') {
      this.hemi.color.set(0xffb88a);
      this.hemi.groundColor.set(0x263020);
      this.hemi.intensity = 0.6;
      this.sun.color.set(0xffb070);
      this.sun.intensity = 2.2;
      this.sun.position.copy(key).multiplyScalar(90);
    } else {
      // Night: the shadow-casting key comes from one floodlight tower.
      this.hemi.color.set(0x8ea6d8);
      this.hemi.groundColor.set(0x14200f);
      this.hemi.intensity = 0.22;
      this.sun.color.set(0xf4f6ff);
      this.sun.intensity = 2.1;
      this.sun.position.copy(towers[0]).normalize().multiplyScalar(90);
    }
    this.sun.castShadow = this.opts.shadows;
    const s = this.sun.shadow;
    s.bias = -0.0004;
    s.normalBias = 0.025;
    s.radius = 3;
    const cam = s.camera as THREE.OrthographicCamera;
    const ext = 30;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 220;
    this.group.add(this.hemi, this.sun, this.sun.target);
    // Floodlight fills from the other towers (no shadow maps; their shadows are cheap decals).
    if (tod !== 'day') {
      const intensity = tod === 'night' ? 0.85 : 0.7;
      for (const t of towers.slice(1)) this.fillDirs.push(t.clone().normalize());
      if ((this.opts.fillLights ?? 3) >= 3) {
        for (const d of this.fillDirs) {
          const fill = new THREE.DirectionalLight(0xeef2ff, intensity);
          fill.position.copy(d).multiplyScalar(90);
          this.group.add(fill);
        }
      } else {
        // One combined fill (cheaper per pixel on every lit surface); the multi-directional player
        // shadows are still drawn as decals from all towers.
        const avg = this.fillDirs.reduce((a, d) => a.add(d), new THREE.Vector3()).normalize();
        const fill = new THREE.DirectionalLight(0xeef2ff, intensity * 2.4);
        fill.position.copy(avg).multiplyScalar(90);
        this.group.add(fill);
      }
    } else {
      const sky = new THREE.DirectionalLight(0xcfe0ff, 0.35);
      sky.position.set(-key.x * 60, 50, -key.z * 60);
      this.group.add(sky);
    }
  }

  /** Keep the shadow frustum centred on the action for crisp shadows. */
  private shadowOff = new THREE.Vector3();
  focusShadow(x: number, z: number): void {
    const off = this.shadowOff.copy(this.sun.position).sub(this.sun.target.position);
    this.sun.target.position.set(x, 0, z);
    this.sun.position.copy(this.sun.target.position).add(off);
  }

  private buildGround(): void {
    const p = this.opts.pitch;
    const margin = 9;
    const L = p.length + margin * 2,
      W = p.width + margin * 2;
    const detail = this.track(grassDetailTexture());
    const stripes = Math.max(10, Math.round(p.length / 5.5));
    const pattern = this.track(pitchPatternTexture(p.length, p.width, stripes));
    const surf = this.opts.surface ?? null;
    const night = this.opts.timeOfDay === 'night' ? 1 : this.opts.timeOfDay === 'dusk' ? 0.5 : 0;
    const mat = new THREE.MeshStandardMaterial({ color: 0x4f9a3c, roughness: 0.88, metalness: 0 });
    if (surf) {
      // Photo-scanned turf (ambientCG Grass005, CC0): normal + roughness; colour is used as luminance detail.
      const tile = 3.2;
      for (const t of [surf.normal, surf.rough]) t.repeat.set(L / tile, W / tile);
      mat.normalMap = surf.normal;
      mat.normalScale.set(0.7, 0.7);
      mat.roughnessMap = surf.rough;
      mat.roughness = 1;
    }
    const pitchL = p.length,
      pitchW = p.width;
    const stripeW = p.length / stripes;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: detail };
      shader.uniforms.uPattern = { value: pattern };
      shader.uniforms.uTurf = { value: surf?.color ?? detail };
      shader.uniforms.uHasTurf = { value: surf ? 1 : 0 };
      shader.uniforms.uPitch = { value: new THREE.Vector2(pitchL, pitchW) };
      shader.uniforms.uStripeW = { value: stripeW };
      shader.uniforms.uNight = { value: night };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWPos;
          uniform sampler2D uDetail, uPattern, uTurf;
          uniform float uHasTurf, uStripeW, uNight;
          uniform vec2 uPitch;`,
        )
        .replace(
          '#include <map_fragment>',
          `
          vec2 puv = vWPos.xz / uPitch + 0.5;
          float inside = step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0);
          vec3 pat = texture2D(uPattern, clamp(vec2(puv.x, 1.0 - puv.y), 0.0, 1.0)).rgb;
          // Turf detail: two samples at different scales/rotations hide tiling.
          vec2 tuv = vWPos.xz / 3.2;
          vec2 ruv = mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz / 11.0;
          float t1 = dot(texture2D(uTurf, tuv).rgb, vec3(0.299, 0.587, 0.114));
          float t2 = dot(texture2D(uTurf, ruv).rgb, vec3(0.299, 0.587, 0.114));
          float turf = mix(t1, t2, 0.35);
          float detail = uHasTurf > 0.5 ? (turf - 0.45) * 1.1 : (texture2D(uDetail, vWPos.xz * 0.35).r - 0.5) * 0.55;
          float macro = (texture2D(uDetail, vWPos.xz * 0.023 + 0.37).r - 0.5) * 0.3;
          // Mowing stripes: blades in alternate stripes lean opposite ways, so brightness depends on the view direction.
          float parity = mod(floor(vWPos.x / uStripeW), 2.0) * 2.0 - 1.0;
          vec3 viewV = normalize(cameraPosition - vWPos);
          float lean = normalize(viewV.xz + vec2(1e-4)).x;
          float stripe = parity * (0.11 + 0.08 * lean);
          float cross = (mod(floor(vWPos.z / (uStripeW * 1.6)), 2.0) * 2.0 - 1.0) * 0.022;
          vec3 grass = diffuseColor.rgb * (1.0 + detail + macro) * (1.0 + (stripe + cross) * inside);
          float wear = clamp((pat.r - pat.b) * 3.0, 0.0, 1.0) * inside;
          grass = mix(grass, vec3(0.45, 0.42, 0.25), wear * 0.35);
          // Night: brighter under the floodlights in the middle, falling off towards the corners and the run-off.
          float r = length((vWPos.xz / uPitch) * 2.0);
          grass *= mix(1.0, 1.08 - 0.22 * smoothstep(0.55, 1.25, r), uNight);
          grass *= mix(0.84, 1.0, inside);
          diffuseColor.rgb = grass;
        `,
        );
    };
    mat.customProgramCacheKey = () => 'pitch-v3-' + (surf ? 't' : 'p');
    const geo = new THREE.PlaneGeometry(L, W, 1, 1);
    geo.rotateX(-Math.PI / 2);
    // Tangents for the normal map come from the UVs; flip V so the turf normal faces up correctly.
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.track(geo);
    this.track(mat);

    // Track / apron around the grass.
    const apronGeo = new THREE.PlaneGeometry(L + 40, W + 40);
    apronGeo.rotateX(-Math.PI / 2);
    const apron = new THREE.Mesh(apronGeo, new THREE.MeshStandardMaterial({ color: 0x23302a, roughness: 0.95 }));
    apron.position.y = -0.02;
    apron.receiveShadow = true;
    this.group.add(apron);
  }

  private buildLines(): void {
    const p = this.opts.pitch;
    const L2 = p.length / 2,
      W2 = p.width / 2;
    const lw = 0.12;
    const geos: THREE.BufferGeometry[] = [];
    const seg = (x1: number, z1: number, x2: number, z2: number) => {
      const dx = x2 - x1,
        dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const g = new THREE.PlaneGeometry(len + lw, lw);
      g.rotateX(-Math.PI / 2);
      g.rotateY(-Math.atan2(dz, dx));
      g.translate((x1 + x2) / 2, 0, (z1 + z2) / 2);
      geos.push(g);
    };
    const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n = 48) => {
      const g = new THREE.RingGeometry(r - lw / 2, r + lw / 2, n, 1, a0, a1 - a0);
      g.rotateX(-Math.PI / 2);
      g.translate(cx, 0, cz);
      geos.push(g);
    };
    const dot = (x: number, z: number, r: number) => {
      const g = new THREE.CircleGeometry(r, 20);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0, z);
      geos.push(g);
    };
    // Boundary & halfway.
    seg(-L2, -W2, L2, -W2);
    seg(-L2, W2, L2, W2);
    seg(-L2, -W2, -L2, W2);
    seg(L2, -W2, L2, W2);
    seg(0, -W2, 0, W2);
    arc(0, 0, p.centerCircleRadius, 0, Math.PI * 2, 80);
    dot(0, 0, 0.18);
    for (const s of [1, -1]) {
      const gx = s * L2;
      const pa = gx - s * p.penaltyAreaDepth;
      const pw = p.penaltyAreaWidth / 2;
      seg(gx, -pw, pa, -pw);
      seg(gx, pw, pa, pw);
      seg(pa, -pw, pa, pw);
      const ga = gx - s * p.goalAreaDepth;
      const gw = p.goalAreaWidth / 2;
      seg(gx, -gw, ga, -gw);
      seg(gx, gw, ga, gw);
      seg(ga, -gw, ga, gw);
      const spot = gx - s * p.penaltySpot;
      dot(spot, 0, 0.14);
      // Penalty arc outside the box.
      const dx = Math.abs(pa - spot);
      // Arc protrudes ~1/3 of the spot distance beyond the box (9.15 m radius on a full-size pitch).
      const r = Math.min(9.15, dx + p.penaltySpot * 0.33);
      if (r > dx) {
        const half = Math.acos(dx / r);
        const base = s > 0 ? Math.PI : 0;
        arc(spot, 0, r, base - half, base + half, 32);
      }
      // Corner arcs.
      for (const zs of [1, -1]) {
        const a0 = s > 0 ? (zs > 0 ? Math.PI / 2 : Math.PI) : zs > 0 ? 0 : -Math.PI / 2;
        // RingGeometry angles are measured in the XY plane before rotation: y → -z.
        arc(gx, zs * W2, p.cornerArcRadius, a0, a0 + Math.PI / 2, 12);
      }
    }
    const merged = mergeGeometries(geos.map((g) => g.toNonIndexed()));
    geos.forEach((g) => g.dispose());
    const mat = new THREE.MeshStandardMaterial({
      color: 0xf4f6f0,
      roughness: 0.9,
      emissive: 0xffffff,
      emissiveIntensity: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.position.y = 0.008;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.track(merged);
    this.track(mat);
  }

  private buildGoal(side: 1 | -1): void {
    const p = this.opts.pitch;
    const gx = (side * p.length) / 2;
    const gw = p.goalWidth / 2,
      gh = p.goalHeight,
      gd = p.goalDepth;
    const r = p.postRadius;
    const postMat = this.track(new THREE.MeshPhysicalMaterial({ color: 0xf8f8f8, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 }));
    const goal = new THREE.Group();
    const postGeo = this.track(new THREE.CylinderGeometry(r, r, gh + r, 16));
    for (const zs of [1, -1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(gx, (gh + r) / 2, zs * gw);
      post.castShadow = true;
      goal.add(post);
    }
    const barGeo = this.track(new THREE.CylinderGeometry(r, r, p.goalWidth + r * 2, 16));
    const bar = new THREE.Mesh(barGeo, postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(gx, gh, 0);
    bar.castShadow = true;
    goal.add(bar);
    // Rear frame (thin).
    const thin = this.track(new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5 }));
    const tr = 0.025;
    const backX = gx + side * gd;
    const mk = (len: number) => this.track(new THREE.CylinderGeometry(tr, tr, len, 8));
    for (const zs of [1, -1]) {
      const bp = new THREE.Mesh(mk(gh * 0.8), thin);
      bp.position.set(backX, gh * 0.4, zs * gw);
      goal.add(bp);
      // Top side bar from crossbar to back.
      const len = Math.hypot(gd, gh * 0.2);
      const sb = new THREE.Mesh(mk(len), thin);
      sb.position.set((gx + backX) / 2, gh * 0.9, zs * gw);
      sb.rotation.z = Math.atan2(-side * gd, -gh * 0.2);
      goal.add(sb);
      const gb = new THREE.Mesh(mk(gd), thin);
      gb.rotation.z = Math.PI / 2;
      gb.position.set((gx + backX) / 2, tr, zs * gw);
      goal.add(gb);
    }
    const bb = new THREE.Mesh(mk(p.goalWidth), thin);
    bb.rotation.x = Math.PI / 2;
    bb.position.set(backX, gh * 0.8, 0);
    goal.add(bb);

    // Nets: back, roof and two sides, each a segmented plane that can ripple.
    const netTex = this.track(netTexture());
    netTex.repeat.set(p.goalWidth * 5, gh * 5);
    const netMat = this.track(
      new THREE.MeshStandardMaterial({
        map: netTex,
        alphaMap: netTex,
        transparent: false,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        color: 0xf2f2f2,
        roughness: 0.75,
        depthWrite: true,
        alphaToCoverage: true,
      }),
    );
    const addPanel = (
      w: number,
      h: number,
      sx: number,
      sy: number,
      place: (g: THREE.BufferGeometry) => void,
      normal: THREE.Vector3,
      repeat: [number, number],
    ) => {
      const g = new THREE.PlaneGeometry(w, h, sx, sy);
      place(g);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat[0], uv.getY(i) * repeat[1]);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const rest = new Float32Array(pos.array as Float32Array);
      const n = pos.count;
      // Pin the panel edges.
      const pinned = new Uint8Array(n);
      const cols = sx + 1;
      for (let i = 0; i < n; i++) {
        const ix = i % cols,
          iy = Math.floor(i / cols);
        if (ix === 0 || ix === sx || iy === 0 || iy === sy) pinned[i] = 1;
      }
      this.nets.push({ geo: g, rest, disp: new Float32Array(n), vel: new Float32Array(n), normal, side, pinned });
      const m = new THREE.Mesh(g, netMat);
      m.userData.dynamic = true; // vertices animate (ripple)
      m.castShadow = false;
      m.receiveShadow = true;
      goal.add(m);
      this.track(g);
    };
    netTex.repeat.set(1, 1);
    const density = 6;
    // Back panel (in the plane x = backX).
    addPanel(
      p.goalWidth,
      gh * 0.8,
      16,
      8,
      (g) => {
        g.rotateY(Math.PI / 2);
        g.translate(backX, gh * 0.4, 0);
      },
      new THREE.Vector3(side, 0, 0),
      [p.goalWidth * density, gh * 0.8 * density],
    );
    // Roof (slanted from crossbar down to back top).
    const roofLen = Math.hypot(gd, gh * 0.2);
    addPanel(
      p.goalWidth,
      roofLen,
      16,
      4,
      (g) => {
        g.rotateX(-Math.PI / 2);
        g.rotateZ(side * Math.atan2(gh * 0.2, gd));
        g.translate(gx + (side * gd) / 2, gh * 0.9, 0);
      },
      new THREE.Vector3(0, 1, 0),
      [p.goalWidth * density, roofLen * density],
    );
    // Sides.
    for (const zs of [1, -1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(gd, 0);
      shape.lineTo(gd, gh * 0.8);
      shape.lineTo(0, gh);
      shape.closePath();
      const sg = new THREE.ShapeGeometry(shape);
      sg.scale(side, 1, 1);
      sg.translate(gx, 0, zs * gw);
      const uv = sg.attributes.uv as THREE.BufferAttribute;
      const pos = sg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - gx) * side * density, pos.getY(i) * density);
      const m = new THREE.Mesh(sg, netMat);
      goal.add(m);
      this.track(sg);
    }
    this.group.add(goal);
  }

  /** Push the net where the ball hit it. */
  netImpact(side: 1 | -1, x: number, y: number, z: number, strength: number): void {
    const s = Math.min(1.2, strength / 14);
    for (const n of this.nets) {
      if (n.side !== side) continue;
      const pos = n.rest;
      for (let i = 0; i < n.disp.length; i++) {
        if (n.pinned[i]) continue;
        const dx = pos[i * 3] - x,
          dy = pos[i * 3 + 1] - y,
          dz = pos[i * 3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const f = Math.exp(-d2 / 0.35);
        n.vel[i] += f * s * 4.5;
      }
    }
  }

  private updateNets(dt: number): void {
    const k = 120,
      damping = 7;
    for (const n of this.nets) {
      const pos = n.geo.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      let moving = false;
      for (let i = 0; i < n.disp.length; i++) {
        if (n.pinned[i]) continue;
        const a = -k * n.disp[i] - damping * n.vel[i];
        n.vel[i] += a * dt;
        n.disp[i] += n.vel[i] * dt;
        if (Math.abs(n.disp[i]) > 1e-4 || Math.abs(n.vel[i]) > 1e-4) moving = true;
        const d = Math.min(0.5, n.disp[i]);
        arr[i * 3] = n.rest[i * 3] + n.normal.x * d;
        arr[i * 3 + 1] = n.rest[i * 3 + 1] + n.normal.y * d;
        arr[i * 3 + 2] = n.rest[i * 3 + 2] + n.normal.z * d;
      }
      if (moving) pos.needsUpdate = true;
    }
  }

  private buildBoards(): void {
    const p = this.opts.pitch;
    const tex = this.track(adBoardTexture());
    this.boardTex = tex;
    const h = 0.9;
    const off = 3.2;
    const L2 = p.length / 2 + off,
      W2 = p.width / 2 + off;
    const mat = this.track(
      new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        // LED boards: a little self-light so they read at night, but well below the floodlights'
        // contribution (1.15 on top of the lighting made them two or three times "white", so they
        // bloomed into halos and the text blurred).
        emissiveIntensity: this.opts.timeOfDay === 'day' ? 0.12 : this.opts.timeOfDay === 'dusk' ? 0.35 : 0.45,
        roughness: 0.6,
      }),
    );
    const geos: THREE.BufferGeometry[] = [];
    const side = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const g = new THREE.BoxGeometry(len, h, 0.08);
      // Scale UVs so the texture repeats along length.
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 48));
      const ang = Math.atan2(z2 - z1, x2 - x1);
      g.rotateY(-ang);
      g.translate((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
      geos.push(g);
    };
    side(-L2, -W2, L2, -W2);
    side(L2, W2, -L2, W2);
    side(-L2, W2, -L2, -W2);
    side(L2, -W2, L2, W2);
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.track(merged);
  }

  private buildStands(): void {
    const p = this.opts.pitch;
    const rng = new Rng(77);
    const lay = stadiumLayout(p);
    const { gap, tiers, stepD, stepH } = lay;
    const seatTexHome = this.track(seatsTexture(this.opts.homeColor, '#ffffff'));
    const seatTexAway = this.track(seatsTexture(this.opts.awayColor, '#ffffff'));
    const concrete = this.track(new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.95 }));
    const crowdPositions: Array<{ x: number; y: number; z: number; rot: number; home: boolean }> = [];
    // Architectural details, instanced across all four stands.
    const parts = {
      aisle: [] as THREE.Matrix4[],
      vom: [] as THREE.Matrix4[],
      rib: [] as THREE.Matrix4[],
      fascia: [] as THREE.Matrix4[],
      pole: [] as THREE.Matrix4[],
      flag: [] as THREE.Matrix4[],
    };
    const fasciaCols: THREE.Color[] = [],
      flagCols: THREE.Color[] = [];
    const tmpO = new THREE.Object3D();
    const homeC = new THREE.Color(this.opts.homeColor),
      awayC = new THREE.Color(this.opts.awayColor);

    const buildStand = (len: number, cx: number, cz: number, rot: number, home: boolean, ribs = true) => {
      const slope = stepH / stepD;
      const depth = tiers * stepD;
      /** Stand-local placement → world matrix. */
      const place = (list: THREE.Matrix4[], x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0) => {
        const l = new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        tmpO.position.set(cx + l.x, l.y, cz + l.z);
        tmpO.rotation.set(rx, rot, 0, 'YXZ');
        tmpO.scale.set(sx, sy, sz);
        tmpO.updateMatrix();
        list.push(tmpO.matrix.clone());
      };
      // Aisles (stairs) every ~11 m, vomitory tunnels between them.
      const aisles: number[] = [];
      const nA = Math.max(2, Math.round(len / 11));
      for (let k = 0; k <= nA; k++) aisles.push(-len / 2 + 1.5 + ((len - 3) * k) / nA);
      const slopeLen = Math.hypot(depth, tiers * stepH);
      for (const a of aisles) place(parts.aisle, a, 0.6 + stepH + (depth / 2) * slope - 0.05, depth / 2, 1.1, 0.22, slopeLen, -Math.atan(slope));
      const vomTier = Math.floor(tiers * 0.4);
      const voms: number[] = [];
      for (let k = 0; k < aisles.length - 1; k += 2) voms.push((aisles[k] + aisles[k + 1]) / 2);
      const vh = 4 * stepH,
        vd = 4 * stepD;
      for (const v of voms) place(parts.vom, v, 0.6 + vomTier * stepH + vh / 2, vomTier * stepD + vd / 2, 2.6, vh, vd);
      const inGap = (sPos: number, tier: number) =>
        aisles.some((a) => Math.abs(sPos - a) < 0.65) || (tier >= vomTier && tier < vomTier + 5 && voms.some((v) => Math.abs(sPos - v) < 1.5));
      // Stepped profile extruded along the stand length.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      for (let i = 0; i < tiers; i++) {
        shape.lineTo(i * stepD, (i + 1) * stepH);
        shape.lineTo((i + 1) * stepD, (i + 1) * stepH);
      }
      shape.lineTo(tiers * stepD, 0);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, steps: 1 });
      g.translate(0, 0, -len / 2);
      // Profile depth (shape x) → local +z (away from the pitch); stand length → local x.
      g.rotateY(-Math.PI / 2);
      const tex = home ? seatTexHome : seatTexAway;
      tex.repeat.set(1 / stepD, 1 / 20);
      const seatMat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
      // ExtrudeGeometry groups: 0 = end caps, 1 = extruded side walls (the steps).
      const mesh = new THREE.Mesh(g, [concrete, seatMat]);
      mesh.position.set(cx, 0.6, cz);
      mesh.rotation.y = rot;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.track(g);
      // Back wall and roof.
      const wallH = lay.roofY;
      const wall = new THREE.Mesh(this.track(new THREE.BoxGeometry(len + 2, wallH, 0.6)), concrete);
      const back = tiers * stepD + 0.3;
      const local = new THREE.Vector3(0, wallH / 2, back);
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      wall.position.set(cx + local.x, local.y, cz + local.z);
      wall.rotation.y = rot;
      this.group.add(wall);
      const roofMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }));
      const roofDepth = back * 0.75;
      const roof = new THREE.Mesh(this.track(new THREE.BoxGeometry(len + 2, 0.4, roofDepth)), roofMat);
      const rl = new THREE.Vector3(0, wallH - 0.2, back - roofDepth / 2 + 0.3);
      rl.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      roof.position.set(cx + rl.x, rl.y, cz + rl.z);
      roof.rotation.y = rot;
      roof.rotation.x = 0;
      this.group.add(roof);
      // Roof underside light strip.
      const strip = new THREE.Mesh(this.track(new THREE.BoxGeometry(len, 0.15, 0.4)), this.track(new THREE.MeshBasicMaterial({ color: 0xfff6e0 })));
      const sl = new THREE.Vector3(0, wallH - 0.5, back - roofDepth + 0.8);
      // Fascia under the roof front edge.
      sl.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      strip.position.set(cx + sl.x, sl.y, cz + sl.z);
      strip.rotation.y = rot;
      this.group.add(strip);
      // Roof ribs (diagonal braces from the back wall), fascia beam in club colour, flags on the roof edge.
      const roofFront = back - roofDepth + 0.3;
      const ribLen = Math.hypot(roofDepth * 0.85, 3.6);
      // (Not on the camera-side stand: the broadcast gantry sits under that roof and ribs would cross the lens.)
      if (ribs)
        for (let x = -len / 2 + 2; x <= len / 2 - 2; x += 6) {
          place(parts.rib, x, wallH - 0.4 - 1.8, back - roofDepth * 0.425, 0.22, 0.32, ribLen, Math.atan2(3.6, roofDepth * 0.85));
        }
      place(parts.fascia, 0, wallH - 0.55, roofFront - 0.15, len + 2, 1.1, 0.3);
      fasciaCols.push(home ? homeC : awayC);
      for (let x = -len / 2 + 4; x <= len / 2 - 4; x += 9) {
        place(parts.pole, x, wallH + 1.6, roofFront + 0.4, 1, 1, 1);
        place(parts.flag, x, wallH + 2.6, roofFront + 0.4, 1, 1, 1);
        flagCols.push(((Math.round(x / 9) & 1) === 0) === home ? homeC : awayC);
      }
      // Crowd seat positions (skipping aisles and tunnels).
      for (let i = 0; i < tiers; i++) {
        for (let s = -len / 2 + 0.4; s < len / 2 - 0.4; s += 0.62) {
          if (inGap(s, i)) continue;
          const l = new THREE.Vector3(s + (rng.next() - 0.5) * 0.1, 0.6 + (i + 1) * stepH, (i + 0.55) * stepD);
          l.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
          crowdPositions.push({ x: cx + l.x, y: l.y, z: cz + l.z, rot, home });
        }
      }
    };
    const L2 = p.length / 2,
      W2 = p.width / 2;
    // Rotation so local +z points away from the pitch.
    buildStand(p.length + 8, 0, W2 + gap, 0, true, false);
    buildStand(p.length + 8, 0, -W2 - gap, Math.PI, false);
    buildStand(p.width + 4, L2 + gap, 0, Math.PI / 2, false);
    buildStand(p.width + 4, -L2 - gap, 0, -Math.PI / 2, true);
    this.buildCrowd(crowdPositions, rng);

    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], cols?: THREE.Color[]) => {
      const m = new THREE.InstancedMesh(this.track(geo), this.track(mat), list.length);
      list.forEach((mx, i) => {
        m.setMatrixAt(i, mx);
        if (cols) m.setColorAt(i, cols[i]);
      });
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.9 }), parts.aisle);
    inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 1 }), parts.vom);
    inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.45, metalness: 0.7 }), parts.rib);
    inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 }), parts.fascia, fasciaCols);
    inst(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.4, metalness: 0.6 }), parts.pole);
    const flagGeo = new THREE.PlaneGeometry(1.7, 1.05, 10, 2);
    flagGeo.translate(0.85, 0, 0);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 });
    const fu = this.flagUniforms;
    flagMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = fu.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
          float w = position.x / 1.7;
          float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.4;
          transformed.z += sin(uTime * 4.5 + position.x * 3.5 + ph) * 0.18 * w;
          transformed.y -= w * w * 0.12;`,
      );
    };
    flagMat.customProgramCacheKey = () => 'roof-flag';
    inst(flagGeo, flagMat, parts.flag, flagCols);
  }

  /**
   * Crowd as camera-facing billboards (2 triangles per fan) sampling a procedural sprite atlas.
   * Shirts are tinted per instance; bobbing, jumping, arms-up and Mexican waves run in the vertex shader.
   */
  private buildCrowd(positions: Array<{ x: number; y: number; z: number; rot: number; home: boolean }>, rng: Rng): void {
    const count = Math.min(this.opts.crowdCount, Math.floor(positions.length * 0.92));
    if (count <= 0) return;
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    const geo = new THREE.PlaneGeometry(0.62, 1.2);
    geo.translate(0, 0.6, 0);
    this.track(geo);
    const atlas = crowdAtlas();
    this.track(atlas.color);
    this.track(atlas.mask);
    const u = this.crowdUniforms;
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uColor: { value: atlas.color },
          uMask: { value: atlas.mask },
          uLight: { value: this.opts.timeOfDay === 'day' ? 1.0 : this.opts.timeOfDay === 'dusk' ? 0.85 : 0.9 },
        },
      ]),
      vertexShader: `
        uniform float uTime; uniform float uExcite; uniform float uWave;
        varying vec2 vUv; varying vec3 vTint; varying float vShade;
        #include <common>
        #include <fog_pars_vertex>
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sc = length(instanceMatrix[1].xyz);
          float h = hash(base.xz);
          float bob = sin(uTime * (2.0 + h * 3.0) + h * 30.0) * 0.03;
          float jump = max(0.0, sin(uTime * (7.0 + h * 4.0) + h * 20.0)) * 0.35 * uExcite * step(0.25, h);
          float wave = uWave * max(0.0, sin(atan(base.z, base.x) * 2.0 - uTime * 2.5));
          vec3 toCam = cameraPosition - base; toCam.y = 0.0;
          toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
          vec3 right = vec3(toCam.z, 0.0, -toCam.x);
          vec3 wp = base + right * position.x * sc + vec3(0.0, position.y * sc + bob + jump + wave * 0.5, 0.0);
          float variant = floor(h * 4.0);
          float armsUp = step(0.45, uExcite * step(0.3, fract(h * 7.0)) + wave * 0.8);
          vUv = vec2((variant * 2.0 + armsUp + uv.x) / 8.0, uv.y);
          #ifdef USE_INSTANCING_COLOR
            vTint = instanceColor;
          #else
            vTint = vec3(1.0);
          #endif
          vShade = 0.72 + 0.28 * fract(h * 13.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uColor; uniform sampler2D uMask; uniform float uLight;
        varying vec2 vUv; varying vec3 vTint; varying float vShade;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(uColor, vUv);
          if (c.a < 0.5) discard;
          float m = texture2D(uMask, vUv).r;
          vec3 col = mix(c.rgb, c.rgb * vTint, m) * vShade * uLight;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.uTime = u.uTime;
    mat.uniforms.uExcite = u.uExcite;
    mat.uniforms.uWave = u.uWave;
    this.track(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sv = new THREE.Vector3();
    const color = new THREE.Color();
    const home = new THREE.Color(this.opts.homeColor);
    const away = new THREE.Color(this.opts.awayColor);
    const neutral = [0xf2f2f2, 0x2b2b2b, 0x5a6b7d, 0x8a5a44, 0xd9c8a9, 0x334155, 0x6b7280];
    for (let i = 0; i < count; i++) {
      const pz = positions[i];
      const sc = 0.92 + rng.next() * 0.2;
      sv.set(sc, sc, sc);
      m4.compose(new THREE.Vector3(pz.x, pz.y - 0.15, pz.z), q, sv);
      mesh.setMatrixAt(i, m4);
      // Mostly home colours in home stands (and vice versa), with plenty of neutral clothing.
      const r = rng.next();
      if (r < 0.5) color.copy(pz.home ? home : away);
      else if (r < 0.58) color.copy(pz.home ? away : home);
      else color.set(rng.pick(neutral));
      color.offsetHSL(0, -0.05, (rng.next() - 0.5) * 0.18);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.crowdMesh = mesh;
  }

  /** Benchmark / profiling toggles. */
  setCrowdVisible(v: boolean): void {
    if (this.crowdMesh) this.crowdMesh.visible = v;
  }
  setDetailVisible(v: boolean): void {
    for (const c of this.group.children) if (!c.userData.core && c !== this.crowdMesh && !(c as THREE.Light).isLight) c.visible = v;
  }

  private buildFloodlights(): void {
    const p = this.opts.pitch;
    const night = this.opts.timeOfDay !== 'day';
    const L2 = p.length / 2 + 10,
      W2 = p.width / 2 + 12;
    const height = 28 + p.length * 0.12;
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4 }));
    // Lamp faces are deliberately brighter than white at night: they are what bloom is for.
    const dusk = this.opts.timeOfDay === 'dusk'; // (`night` above is true at dusk too)
    const lampMat = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff8ee).multiplyScalar(dusk ? 3 : night ? 6 : 0.85) }));
    const glow = this.track(glowTexture());
    const spriteMat = this.track(
      new THREE.SpriteMaterial({
        map: glow,
        color: 0xfff3dd,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // No flares in daylight: additive glow over a bright sky only whitened the corners of the view.
        opacity: dusk ? 0.45 : night ? 0.9 : 0,
      }),
    );
    const poleGeo = this.track(new THREE.CylinderGeometry(0.35, 0.6, height, 10));
    const panelGeo = this.track(new THREE.BoxGeometry(6, 3, 0.5));
    const lampGeo = this.track(new THREE.CircleGeometry(0.42, 12));
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(sx * L2, height / 2, sz * W2);
        pole.castShadow = false;
        this.group.add(pole);
        const head = new THREE.Group();
        head.position.set(sx * L2, height + 1.2, sz * W2);
        head.lookAt(0, 0, 0);
        const panel = new THREE.Mesh(panelGeo, poleMat);
        head.add(panel);
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 2; j++) {
            const lamp = new THREE.Mesh(lampGeo, lampMat);
            lamp.position.set(-2.25 + i * 1.5, -0.7 + j * 1.4, 0.26);
            head.add(lamp);
          }
        const spr = new THREE.Sprite(spriteMat);
        spr.scale.set(16, 16, 1);
        spr.position.set(0, 0, 1.2);
        head.add(spr);
        this.group.add(head);
        if (night && this.opts.haze) head.add(this.lightShaft(head.position.length()));
      }
  }

  private shaftMat: THREE.ShaderMaterial | null = null;
  /** Soft additive beam through the haze, from the lamp head towards the pitch. */
  private lightShaft(dist: number): THREE.Mesh {
    const len = dist * 0.78;
    const geo = this.track(new THREE.CylinderGeometry(3.2, 13, len, 24, 1, true));
    geo.translate(0, -len / 2, 0);
    geo.rotateX(-Math.PI / 2); // now spans z ∈ [0, len]: Object3D.lookAt aims the head's +Z at the pitch
    if (!this.shaftMat) {
      this.shaftMat = this.track(
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: { uStrength: { value: this.opts.timeOfDay === 'night' ? 0.12 : 0.05 }, uLen: { value: len } },
          vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV;
          uniform float uLen;
          void main(){
            vT = clamp(position.z / uLen, 0.0, 1.0);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
          fragmentShader: `varying float vT; varying vec3 vN; varying vec3 vV; uniform float uStrength;
          void main(){
            float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
            float a = uStrength * edge * (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, 0.05, vT);
            gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, 1.0);
          }`,
        }),
      );
    }
    const m = new THREE.Mesh(geo, this.shaftMat);
    m.renderOrder = 5;
    m.frustumCulled = false;
    return m;
  }

  private buildCornerFlags(): void {
    const p = this.opts.pitch;
    const poleGeo = this.track(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6));
    poleGeo.translate(0, 0.75, 0);
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff }));
    const flagGeo = this.track(new THREE.PlaneGeometry(0.45, 0.32, 8, 2));
    flagGeo.translate(0.225, 1.32, 0);
    const flagMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffd400, side: THREE.DoubleSide, roughness: 0.8 }));
    const fu = this.flagUniforms;
    flagMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = fu.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
          float w = position.x / 0.45;
          transformed.z += sin(uTime * 6.0 + position.x * 9.0) * 0.06 * w;`,
      );
    };
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set((sx * p.length) / 2, 0, (sz * p.width) / 2);
        pole.castShadow = true;
        this.group.add(pole);
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.copy(pole.position);
        flag.rotation.y = Math.atan2(sz, -sx) + Math.PI / 4;
        flag.castShadow = true;
        flag.userData.dynamic = true; // waves in the vertex shader (local position)
        this.group.add(flag);
        this.flags.push(flag);
      }
  }

  private buildDugouts(): void {
    const p = this.opts.pitch;
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.6 }));
    const glass = this.track(new THREE.MeshStandardMaterial({ color: 0x9fc3ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2 }));
    const z = -(p.width / 2 + 4.6);
    for (const sx of [1, -1]) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(6, 0.5, 1.4)), mat);
      base.position.y = 0.25;
      const roof = new THREE.Mesh(this.track(new THREE.BoxGeometry(6.2, 0.08, 1.8)), glass);
      roof.position.set(0, 2.1, 0.1);
      const back = new THREE.Mesh(this.track(new THREE.BoxGeometry(6.2, 2.1, 0.08)), glass);
      back.position.set(0, 1.05, -0.8);
      g.add(base, roof, back);
      g.position.set(sx * 8, 0, z);
      g.rotation.y = Math.PI;
      this.group.add(g);
    }
  }

  /** Per-frame animation of environment details. */
  update(dt: number, time: number, excitement: number, wave: number): void {
    this.updateNets(dt);
    if (this.boardTex) this.boardTex.offset.x = (time * 0.012) % 1;
    this.crowdUniforms.uTime.value = time;
    this.crowdUniforms.uExcite.value += (excitement - this.crowdUniforms.uExcite.value) * Math.min(1, dt * 3);
    this.crowdUniforms.uWave.value += (wave - this.crowdUniforms.uWave.value) * Math.min(1, dt * 1.5);
    this.flagUniforms.uTime.value = time;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

/** Sky dome with a gradient shader (night, dusk or day) and stars at night. */
/** Floodlight head positions (world), shared by the geometry, the lights and the environment map. */
export function floodlightTowers(p: PitchConfig): THREE.Vector3[] {
  const L2 = p.length / 2 + 10,
    W2 = p.width / 2 + 12;
  const h = 28 + p.length * 0.12 + 1.2;
  return [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ].map(([sx, sz]) => new THREE.Vector3(sx * L2, h, sz * W2));
}

/** A simple gradient sky dome, used at night and as the fallback when the physically based sky isn't built. */
export function createSky(tod: TimeOfDay): THREE.Mesh {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const top = tod === 'day' ? new THREE.Color(0x3d7ee0) : tod === 'dusk' ? new THREE.Color(0x26315e) : new THREE.Color(0x040816);
  const horizon = tod === 'day' ? new THREE.Color(0xcfe6ff) : tod === 'dusk' ? new THREE.Color(0xff9a5c) : new THREE.Color(0x1b2a4a);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTop: { value: top }, uHorizon: { value: horizon }, uStars: { value: tod === 'night' ? 1 : tod === 'dusk' ? 0.3 : 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform float uStars; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        vec3 cell = floor(vDir * 180.0);
        float s = step(0.9975, hash(cell)) * smoothstep(0.05, 0.4, h) * uStars;
        col += vec3(s);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
