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
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Display-space grade (tint, saturation, gentle S-curve, vignette), appended to three's OutputPass
 * shader so tone mapping, colour-space output and grading happen in ONE full-screen pass.
 */
const GRADE_GLSL = /* glsl */ `
  {
    vec3 col = gl_FragColor.rgb * uTint;
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, uSat);
    col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
    vec2 d = vUv - 0.5;
    col *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
    gl_FragColor.rgb = clamp(col, 0.0, 1.0);
  }
`;
/** Colour grade per time of day (tint, saturation, contrast, vignette), applied in the final pass. */
/** Only HDR values brighter than this (white is 1.0) bloom: lamps and flares, not lit surfaces. */
export const BLOOM_THRESHOLD = 1.6;
const BLOOM_RADIUS = 0.35;

export type GradeName = 'day' | 'dusk' | 'night';
const GRADES: Record<GradeName, { tint: [number, number, number]; sat: number; contrast: number; vignette: number }> = {
  day: { tint: [1.0, 1.0, 0.985], sat: 1.05, contrast: 0.1, vignette: 0.18 },
  dusk: { tint: [1.03, 0.99, 0.95], sat: 1.08, contrast: 0.12, vignette: 0.28 },
  night: { tint: [0.98, 1.0, 1.03], sat: 1.04, contrast: 0.14, vignette: 0.3 },
};
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Quality } from '../game/settings';

/**
 * One graphics quality level: render resolution, shadows, post-processing, MSAA, crowd size and fill
 * lights. The adaptive controller moves between these (src/game/adaptive.ts).
 */
export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  post: boolean;
  bloom: boolean;
  ao: boolean;
  msaa: number;
  crowd: number;
  /** Floodlight fill lights at night/dusk (3 = one per tower; 1 = a single combined fill). */
  fills: number;
  /** Light shafts through the haze. */
  haze: boolean;
}

/** The four presets, Low to Ultra. New visual cost must be added here so adaptive quality can remove it. */
export const QUALITY: Record<Quality, QualityPreset> = {
  // Crowd fans are billboards (2 triangles each), so even Low can afford a full-looking stadium.
  // Every preset renders through the composer (MSAA in the render target + one tone-map/grade pass).
  low: { pixelRatio: 1, shadows: false, shadowSize: 512, post: true, bloom: false, ao: false, msaa: 4, crowd: 4000, fills: 1, haze: false },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, post: true, bloom: true, ao: false, msaa: 4, crowd: 9000, fills: 1, haze: false },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, post: true, bloom: true, ao: false, msaa: 4, crowd: 16000, fills: 3, haze: true },
  ultra: { pixelRatio: 2, shadows: true, shadowSize: 4096, post: true, bloom: true, ao: true, msaa: 4, crowd: 24000, fills: 3, haze: true },
};

/**
 * WebGL2 renderer with a configurable post-processing chain.
 * WebGL2 is used rather than WebGPU because the game relies on onBeforeCompile shader hooks
 * (grass, crowd, flags) and the classic post-processing stack, which are mature and
 * universally supported on WebGL2; this scene is far from GPU-bound on either backend.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  preset: QualityPreset = QUALITY.high;
  private camera: THREE.Camera | null = null;
  bloomStrength = 0.38;
  private grade: OutputPass | null = null;
  private gradeName: GradeName = 'night';
  /** CPU ms spent in the shadow-map pass during the last render(). */
  shadowMs = 0;
  /** Dynamic resolution multiplier applied on top of the preset's pixel ratio (0.6–1). */
  resolutionScale = 1;

  constructor(readonly container: HTMLElement) {
    const canvas = document.createElement('canvas');
    // No default-framebuffer MSAA: every preset renders through the composer, whose render target does
    // the multisampling. (Previously both were multisampled — wasted memory bandwidth on every frame.)
    const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    canvas.className = 'game-canvas';
    container.appendChild(canvas);
    this.scene.fog = new THREE.Fog(0x0a1020, 140, 420);
    // Time the shadow pass (it runs inside the main scene render).
    const sm = this.renderer.shadowMap as unknown as { render: (...a: unknown[]) => void };
    const origShadow = sm.render.bind(sm);
    sm.render = (...a: unknown[]) => {
      const t = performance.now();
      origShadow(...a);
      this.shadowMs += performance.now() - t;
    };
  }

  /** Render statistics for the profiler (draw calls / triangles across every pass of a frame). */
  statsSource(): import('../game/diagnostics').RenderStatsSource {
    const r = this.renderer;
    return {
      gl: r.getContext() as WebGL2RenderingContext,
      info: () => ({ calls: r.info.render.calls, triangles: r.info.render.triangles }),
      resetInfo: () => {
        r.info.autoReset = false;
        r.info.reset();
      },
      display: () => {
        const size = r.getDrawingBufferSize(new THREE.Vector2());
        return {
          devicePixelRatio: window.devicePixelRatio,
          pixelRatio: Math.round(r.getPixelRatio() * 100) / 100,
          internalWidth: size.x,
          internalHeight: size.y,
          cssWidth: this.container.clientWidth,
          cssHeight: this.container.clientHeight,
          resolutionScale: this.resolutionScale,
        };
      },
    };
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Benchmark overrides layered on top of the quality preset (undefined = use the preset). */
  overrides: { post?: boolean; bloom?: boolean; ao?: boolean; msaa?: number; pixelRatio?: number; shadows?: boolean } = {};
  private qualityName: Quality = 'high';

  /** Re-apply the current quality with the benchmark overrides (rebuilds the post chain; recompiles if shadows change). */
  applyOverrides(): void {
    const hadShadows = this.renderer.shadowMap.enabled;
    if (this.camera) this.applyQuality(this.qualityName, this.camera);
    if (hadShadows !== this.renderer.shadowMap.enabled) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m))
          m.forEach((x) => {
            x.needsUpdate = true;
          });
        else if (m) m.needsUpdate = true;
      });
    }
  }

  applyQuality(q: Quality, camera: THREE.Camera): void {
    this.qualityName = q;
    const o = this.overrides;
    this.preset = {
      ...QUALITY[q],
      ...(o.post !== undefined ? { post: o.post } : {}),
      ...(o.bloom !== undefined ? { bloom: o.bloom } : {}),
      ...(o.ao !== undefined ? { ao: o.ao } : {}),
      ...(o.msaa !== undefined ? { msaa: o.msaa } : {}),
      ...(o.pixelRatio !== undefined ? { pixelRatio: o.pixelRatio } : {}),
      ...(o.shadows !== undefined ? { shadows: o.shadows } : {}),
    };
    this.camera = camera;
    const r = this.renderer;
    r.setPixelRatio(this.targetPixelRatio());
    r.shadowMap.enabled = this.preset.shadows;
    r.shadowMap.needsUpdate = true;
    this.composer?.dispose();
    this.composer = null;
    this.gtao = null;
    this.bloom = null;
    this.grade = null;
    if (this.preset.post) {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        samples: this.preset.msaa,
      });
      const composer = new EffectComposer(r, rt);
      this.renderPass = new RenderPass(this.scene, camera);
      composer.addPass(this.renderPass);
      if (this.preset.ao) {
        const w = this.container.clientWidth,
          h = this.container.clientHeight;
        this.gtao = new GTAOPass(this.scene, camera, w, h);
        this.gtao.output = GTAOPass.OUTPUT.Default;
        this.gtao.blendIntensity = 0.8;
        composer.addPass(this.gtao);
      }
      if (this.preset.bloom) {
        // Bloom works on the HDR image before tone mapping, where a sunlit pitch, white lines and lit
        // advertising boards all exceed 1.0. The old threshold (0.86) made all of those glow: halos round
        // the boards at night and a milky veil over the pitch by day. A threshold above white means only
        // things meant to shine (floodlight lamps and their flares) bloom; a smaller radius keeps it tight.
        this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), this.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
        composer.addPass(this.bloom);
      }
      this.grade = createGradeOutputPass();
      composer.addPass(this.grade);
      this.applyGrade();
      this.composer = composer;
    }
    this.resize();
  }

  private readonly coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  private targetPixelRatio(): number {
    // Phones/tablets have DPR 2–3: rendering at exactly 1× looks soft there, so touch devices get a
    // modest floor (dynamic resolution still scales down if the device can't keep up).
    const cap = this.coarse ? Math.max(this.preset.pixelRatio, 1.3) : this.preset.pixelRatio;
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap) * this.resolutionScale);
  }

  /** Change the dynamic resolution scale (cheap: resizes render targets, no rebuild). */
  setResolutionScale(k: number): void {
    const v = Math.max(0.6, Math.min(1, k));
    if (Math.abs(v - this.resolutionScale) < 1e-3) return;
    this.resolutionScale = v;
    this.renderer.setPixelRatio(this.targetPixelRatio());
    this.resize();
  }

  setGrade(name: GradeName): void {
    this.gradeName = name;
    this.applyGrade();
  }

  private applyGrade(): void {
    if (!this.grade) return;
    const g = GRADES[this.gradeName],
      u = this.grade.material.uniforms;
    (u.uTint.value as THREE.Vector3).set(...g.tint);
    u.uSat.value = g.sat;
    u.uContrast.value = g.contrast;
    u.uVignette.value = g.vignette;
  }

  setExposure(e: number): void {
    this.renderer.toneMappingExposure = e;
  }

  setBloom(strength: number): void {
    this.bloomStrength = strength;
    if (this.bloom) this.bloom.strength = strength;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth),
      h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.gtao?.setSize(w, h);
  }

  render(camera: THREE.Camera): void {
    this.shadowMs = 0;
    if (this.composer && this.renderPass) {
      if (this.camera !== camera) {
        this.renderPass.camera = camera;
        if (this.gtao) this.gtao.camera = camera;
        this.camera = camera;
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  dispose(): void {
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

/** three's OutputPass (tone mapping + sRGB) with the colour grade folded into the same shader. */
function createGradeOutputPass(): OutputPass {
  const pass = new OutputPass();
  const m = pass.material as THREE.RawShaderMaterial;
  Object.assign(m.uniforms, {
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1.05 },
    uContrast: { value: 0.1 },
    uVignette: { value: 0.25 },
  });
  const fs = m.fragmentShader;
  const end = fs.lastIndexOf('}');
  m.fragmentShader =
    fs.slice(0, end).replace('varying vec2 vUv;', 'varying vec2 vUv;\nuniform vec3 uTint; uniform float uSat, uContrast, uVignette;') + GRADE_GLSL + '}';
  m.needsUpdate = true;
  return pass;
}
