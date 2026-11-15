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
import { Sky } from 'three/addons/objects/Sky.js';
import { PitchConfig } from '../sim/config';
import type { TimeOfDay } from './stadium';
import { createSky, floodlightTowers } from './stadium';

/**
 * Lighting environment per time of day:
 * - Day / dusk: physically based atmospheric sky (three.js Sky) with a matching sun.
 * - Night: dark sky with stars; floodlight panels baked into the environment map.
 * A PMREM environment map gives every PBR material (kits, skin, posts, ball, boards) believable
 * reflections and highlights — the main difference between "flat" and "lit" in visual review.
 */
export interface EnvironmentSetup {
  envMap: THREE.Texture;
  envIntensity: number;
  sky: THREE.Object3D;
  /** Direction towards the sun / key floodlight (unit, world space). */
  keyDir: THREE.Vector3;
  dispose(): void;
}

/** CC0 turf textures (ambientCG Grass005) for the pitch: colour, normal and roughness. */
export interface SurfaceTextures {
  color: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
}

/** Load the turf textures. Rejects if they fail; the caller then uses the procedural grass instead. */
export async function loadSurfaceTextures(): Promise<SurfaceTextures> {
  const base = (import.meta.env?.BASE_URL ?? './') + 'assets/';
  const loader = new THREE.TextureLoader();
  const load = async (f: string, srgb: boolean) => {
    const t = await loader.loadAsync(base + f);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const [color, normal, rough] = await Promise.all([load('grass_color.webp', true), load('grass_normal.webp', false), load('grass_rough.webp', false)]);
  return { color, normal, rough };
}

const SUN: Record<TimeOfDay, { elevation: number; azimuth: number }> = {
  day: { elevation: 48, azimuth: 205 },
  dusk: { elevation: 4.5, azimuth: 250 },
  night: { elevation: -10, azimuth: 0 },
};

/**
 * The Sky addon outputs physical radiance meant for a much lower exposure; scale it to our tone-mapping
 * range and cap the sun's glow so bloom doesn't wash out the frame when the camera faces it.
 */
function tameSky(sky: Sky, gain: number, cap: number): void {
  const m = sky.material as THREE.ShaderMaterial;
  m.fragmentShader = m.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    `texColor *= ${gain.toFixed(3)}; texColor = texColor / (1.0 + max(max(texColor.r, texColor.g), texColor.b) / ${cap.toFixed(2)});
     gl_FragColor = vec4( texColor, 1.0 );`,
  );
  m.needsUpdate = true;
}

/**
 * Build the lighting environment for a time of day: sky, sun or key-floodlight direction and an
 * environment map for reflections. Call `dispose()` on the result when the match ends.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer, tod: TimeOfDay, pitch: PitchConfig): EnvironmentSetup {
  const envScene = new THREE.Scene();
  const disposables: Array<{ dispose(): void }> = [];
  let sky: THREE.Object3D;
  const keyDir = new THREE.Vector3();

  if (tod === 'night') {
    sky = createSky('night');
    // Environment: dark gradient dome, dim stand ring, green bounce from the pitch and four bright floodlight panels.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {},
        vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vD; void main(){
        float h = vD.y;
        vec3 sky = mix(vec3(0.03,0.05,0.10), vec3(0.005,0.01,0.03), clamp(h,0.0,1.0));
        vec3 stands = vec3(0.045,0.045,0.05);
        vec3 pitchBounce = vec3(0.05,0.12,0.04);
        vec3 c = h > 0.32 ? sky : h > -0.02 ? stands : pitchBounce;
        gl_FragColor = vec4(c, 1.0);
      }`,
      }),
    );
    envScene.add(dome);
    disposables.push(dome.geometry, dome.material as THREE.Material);
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(22) });
    const lampGeo = new THREE.PlaneGeometry(7, 3);
    disposables.push(lampMat, lampGeo);
    for (const t of floodlightTowers(pitch)) {
      const p = new THREE.Mesh(lampGeo, lampMat);
      p.position.copy(t).normalize().multiplyScalar(40);
      p.lookAt(0, 0, 0);
      envScene.add(p);
    }
    keyDir.set(0.25, 0.92, 0.3).normalize();
  } else {
    const s = new Sky();
    s.scale.setScalar(900); // within the camera far plane (1200)
    const u = s.material.uniforms;
    u.turbidity.value = tod === 'day' ? 4.5 : 8;
    u.rayleigh.value = tod === 'day' ? 1.6 : 2.8;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = tod === 'day' ? 0.8 : 0.9;
    const sun = SUN[tod];
    keyDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sun.elevation), THREE.MathUtils.degToRad(sun.azimuth));
    u.sunPosition.value.copy(keyDir);
    tameSky(s, tod === 'day' ? 0.6 : 0.45, tod === 'day' ? 6 : 3);
    sky = s;
    // Environment: the same sky plus a green ground plane for bounce light.
    const envSky = new Sky();
    envSky.scale.setScalar(100);
    for (const k of Object.keys(u))
      (envSky.material.uniforms as Record<string, { value: unknown }>)[k].value = (u as Record<string, { value: unknown }>)[k].value;
    tameSky(envSky, tod === 'day' ? 0.6 : 0.45, 2.5);
    envSky.material.uniforms.showSunDisc.value = 0;
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 24), new THREE.MeshBasicMaterial({ color: tod === 'day' ? 0x2e5a22 : 0x1e3014 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    envScene.add(ground);
    disposables.push(ground.geometry, ground.material as THREE.Material, envSky.geometry, envSky.material);
    if (tod === 'dusk') {
      // Floodlights already on at dusk.
      const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(10) });
      disposables.push(lampMat);
      for (const t of floodlightTowers(pitch)) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.5), lampMat);
        p.position.copy(t).normalize().multiplyScalar(40);
        p.lookAt(0, 0, 0);
        envScene.add(p);
        disposables.push(p.geometry);
      }
    }
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  for (const d of disposables) d.dispose();
  return {
    envMap: rt.texture,
    envIntensity: tod === 'night' ? 0.55 : tod === 'dusk' ? 0.6 : 0.5,
    sky,
    keyDir,
    dispose: () => {
      rt.dispose();
      sky.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
    },
  };
}
