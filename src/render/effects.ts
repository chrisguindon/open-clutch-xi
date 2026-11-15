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
import { glowTexture } from './textures';
import { Rng } from '../core/rng';

/** Ring + chevron marking the human-controlled player. */
export class ControlIndicator {
  readonly group = new THREE.Group();
  private ring: THREE.Mesh;
  private arrow: THREE.Mesh;
  private chevron: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;

  constructor(color: string) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    const ringGeo = new THREE.RingGeometry(0.55, 0.68, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, this.mat);
    this.ring.position.y = 0.02;
    this.ring.renderOrder = 2;
    const arrowGeo = new THREE.BufferGeometry();
    arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1.05, -0.2, 0, 0.72, 0.2, 0, 0.72], 3));
    arrowGeo.computeVertexNormals();
    this.arrow = new THREE.Mesh(arrowGeo, this.mat);
    this.arrow.position.y = 0.02;
    const chevGeo = new THREE.ConeGeometry(0.14, 0.26, 3);
    chevGeo.rotateX(Math.PI);
    this.chevron = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
    this.chevron.renderOrder = 10;
    this.group.add(this.ring, this.arrow, this.chevron);
  }

  setColor(c: string): void {
    this.mat.color.set(c);
    (this.chevron.material as THREE.MeshBasicMaterial).color.set(c);
  }

  update(x: number, z: number, facing: number, time: number, visible: boolean, sprint: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    this.group.position.set(x, 0, z);
    this.arrow.rotation.y = Math.PI / 2 - facing;
    const pulse = 1 + Math.sin(time * 6) * 0.05;
    this.ring.scale.setScalar(pulse * (sprint ? 1.1 : 1));
    this.chevron.position.y = 2.25 + Math.sin(time * 4) * 0.06;
    this.chevron.rotation.y = time * 2;
  }
}

/** Faint marker under the teammate a pass would go to. */
export class TargetMarker {
  readonly mesh: THREE.Mesh;
  constructor(color: string) {
    const g = new THREE.RingGeometry(0.42, 0.5, 32);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    this.mesh.position.y = 0.02;
    this.mesh.visible = false;
  }
  update(x: number | null, z: number, time: number): void {
    this.mesh.visible = x !== null;
    if (x === null) return;
    this.mesh.position.set(x, 0.02, z);
    this.mesh.scale.setScalar(1 + Math.sin(time * 8) * 0.08);
  }
}

/** Ground circle under a high ball so players can judge where it will land. */
export class BallMarker {
  readonly mesh: THREE.Mesh;
  constructor() {
    const g = new THREE.RingGeometry(0.18, 0.26, 24);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
  }
  update(x: number, y: number, z: number): void {
    const show = y > 1.0;
    this.mesh.visible = show;
    if (!show) return;
    this.mesh.position.set(x, 0.025, z);
    this.mesh.scale.setScalar(1 + Math.min(4, y * 0.35));
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.6 - y * 0.04);
  }
}

/** Fading ribbon behind fast-moving balls. */
export class BallTrail {
  readonly mesh: THREE.Mesh;
  private points: THREE.Vector3[] = [];
  private readonly n = 24;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private alpha: Float32Array;
  private strength = 0;
  private side = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private toCam = new THREE.Vector3();

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3);
    this.alpha = new Float32Array(this.n * 2);
    const idx: number[] = [];
    for (let i = 0; i < this.n - 1; i++) {
      const a = i * 2,
        b = a + 1,
        c = a + 2,
        d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0xfff2c0) } },
      vertexShader:
        'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }',
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.n; i++) this.points.push(new THREE.Vector3());
  }

  reset(p: THREE.Vector3): void {
    for (const q of this.points) q.copy(p);
    this.strength = 0;
  }

  update(p: THREE.Vector3, speed: number, cam: THREE.Camera, dt: number): void {
    const last = this.points.pop()!;
    last.copy(p);
    this.points.unshift(last);
    const target = speed > 17 ? Math.min(1, (speed - 17) / 10) : 0;
    this.strength += (target - this.strength) * Math.min(1, dt * (target > this.strength ? 12 : 4));
    this.mesh.visible = this.strength > 0.02;
    if (!this.mesh.visible) return;
    const camPos = cam.position;
    const side = this.side,
      dir = this.dir,
      toCam = this.toCam;
    for (let i = 0; i < this.n; i++) {
      const a = this.points[i];
      const b = this.points[Math.min(this.n - 1, i + 1)];
      dir.copy(a).sub(b);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      toCam.copy(camPos).sub(a);
      side.copy(dir).cross(toCam).normalize();
      const w = 0.09 * (1 - i / this.n);
      const o = i * 6,
        P = this.pos;
      P[o] = a.x + side.x * w;
      P[o + 1] = a.y + side.y * w;
      P[o + 2] = a.z + side.z * w;
      P[o + 3] = a.x - side.x * w;
      P[o + 4] = a.y - side.y * w;
      P[o + 5] = a.z - side.z * w;
      const al = (1 - i / this.n) * 0.65 * this.strength;
      this.alpha[i * 2] = al;
      this.alpha[i * 2 + 1] = al;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

/** Confetti burst + fireworks for goals. */
export class Celebration {
  readonly group = new THREE.Group();
  private confetti: THREE.InstancedMesh;
  private cPos: Float32Array;
  private cVel: Float32Array;
  private cRot: Float32Array;
  private cLife: Float32Array;
  private readonly cCount = 700;
  private sparks: THREE.Points;
  private sPos: Float32Array;
  private sVel: Float32Array;
  private sLife: Float32Array;
  private sCol: Float32Array;
  private readonly sCount = 1400;
  private sNext = 0;
  private rng = new Rng(3);
  private dummy = new THREE.Object3D();
  private fireworkTimer = 0;
  private fireworksLeft = 0;
  private fwCenter = new THREE.Vector3();
  private colors: THREE.Color[] = [new THREE.Color('#fff')];

  constructor() {
    const g = new THREE.PlaneGeometry(0.12, 0.07);
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
    this.confetti = new THREE.InstancedMesh(g, m, this.cCount);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.confetti.frustumCulled = false;
    this.cPos = new Float32Array(this.cCount * 3);
    this.cVel = new Float32Array(this.cCount * 3);
    this.cRot = new Float32Array(this.cCount * 3);
    this.cLife = new Float32Array(this.cCount);
    const col = new THREE.Color();
    for (let i = 0; i < this.cCount; i++) {
      col.setHSL(this.rng.next(), 0.85, 0.6);
      this.confetti.setColorAt(i, col);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.confetti.setMatrixAt(i, this.dummy.matrix);
    }
    this.group.add(this.confetti);

    const sg = new THREE.BufferGeometry();
    this.sPos = new Float32Array(this.sCount * 3);
    this.sVel = new Float32Array(this.sCount * 3);
    this.sLife = new Float32Array(this.sCount);
    this.sCol = new Float32Array(this.sCount * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3));
    const sm = new THREE.PointsMaterial({
      size: 0.9,
      map: glowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.sparks = new THREE.Points(sg, sm);
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  /** Launch confetti from behind the goal and schedule fireworks. */
  burst(goalX: number, colors: string[]): void {
    this.colors = colors.map((c) => new THREE.Color(c));
    const col = new THREE.Color();
    for (let i = 0; i < this.cCount; i++) {
      const s = Math.sign(goalX) || 1;
      this.cPos[i * 3] = goalX + s * (3 + this.rng.next() * 6);
      this.cPos[i * 3 + 1] = 2 + this.rng.next() * 10;
      this.cPos[i * 3 + 2] = (this.rng.next() - 0.5) * 30;
      this.cVel[i * 3] = -s * (2 + this.rng.next() * 5);
      this.cVel[i * 3 + 1] = 4 + this.rng.next() * 7;
      this.cVel[i * 3 + 2] = (this.rng.next() - 0.5) * 5;
      this.cRot[i * 3] = this.rng.next() * 6;
      this.cRot[i * 3 + 1] = this.rng.next() * 6;
      this.cRot[i * 3 + 2] = this.rng.next() * 6;
      this.cLife[i] = 4 + this.rng.next() * 3;
      const base = this.rng.chance(0.7) ? this.colors[i % this.colors.length] : col.setHSL(this.rng.next(), 0.9, 0.6);
      this.confetti.setColorAt(i, base);
    }
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
    this.fwCenter.set(goalX * 1.25, 0, 0);
    this.fireworksLeft = 7;
    this.fireworkTimer = 0.2;
  }

  /** Remove all confetti and fireworks immediately (e.g. when a replay starts: the replay shows the past). */
  clear(): void {
    this.cLife.fill(0);
    this.sLife.fill(0);
    for (let i = 0; i < this.sCount; i++) this.sPos[i * 3 + 1] = -100; // dead sparks are parked below ground
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.fireworksLeft = 0;
    this.confetti.visible = false;
    this.sparks.visible = false;
  }

  private firework(x: number, y: number, z: number): void {
    const c = this.colors[Math.floor(this.rng.next() * this.colors.length)] ?? new THREE.Color('#fff');
    const n = 160;
    for (let k = 0; k < n; k++) {
      const i = this.sNext;
      this.sNext = (this.sNext + 1) % this.sCount;
      const u = this.rng.next() * 2 - 1,
        th = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 9 + this.rng.next() * 3;
      this.sPos[i * 3] = x;
      this.sPos[i * 3 + 1] = y;
      this.sPos[i * 3 + 2] = z;
      this.sVel[i * 3] = r * Math.cos(th) * sp;
      this.sVel[i * 3 + 1] = u * sp;
      this.sVel[i * 3 + 2] = r * Math.sin(th) * sp;
      this.sLife[i] = 1.3 + this.rng.next() * 0.6;
      const w = this.rng.chance(0.25) ? 1 : 0;
      this.sCol[i * 3] = w ? 1 : c.r;
      this.sCol[i * 3 + 1] = w ? 1 : c.g;
      this.sCol[i * 3 + 2] = w ? 1 : c.b;
    }
  }

  update(dt: number): void {
    // Confetti.
    let any = false;
    for (let i = 0; i < this.cCount; i++) {
      if (this.cLife[i] <= 0) continue;
      any = true;
      this.cLife[i] -= dt;
      const o = i * 3;
      this.cVel[o + 1] -= 4.5 * dt;
      // Air drag & flutter.
      this.cVel[o] *= 1 - dt * 0.9;
      this.cVel[o + 2] *= 1 - dt * 0.9;
      if (this.cVel[o + 1] < -1.6) this.cVel[o + 1] = -1.6;
      this.cPos[o] += this.cVel[o] * dt + Math.sin(this.cRot[o] * 3) * dt * 0.4;
      this.cPos[o + 1] += this.cVel[o + 1] * dt;
      this.cPos[o + 2] += this.cVel[o + 2] * dt;
      this.cRot[o] += dt * 5;
      this.cRot[o + 1] += dt * 3;
      if (this.cPos[o + 1] < 0.03) {
        this.cPos[o + 1] = 0.03;
        this.cVel[o] = this.cVel[o + 2] = 0;
      }
      this.dummy.position.set(this.cPos[o], this.cPos[o + 1], this.cPos[o + 2]);
      this.dummy.rotation.set(this.cRot[o], this.cRot[o + 1], this.cRot[o + 2]);
      this.dummy.scale.setScalar(this.cLife[i] > 0 ? Math.min(1, this.cLife[i]) : 0);
      this.dummy.updateMatrix();
      this.confetti.setMatrixAt(i, this.dummy.matrix);
    }
    if (any) this.confetti.instanceMatrix.needsUpdate = true;
    this.confetti.visible = any;

    // Fireworks.
    if (this.fireworksLeft > 0) {
      this.fireworkTimer -= dt;
      if (this.fireworkTimer <= 0) {
        this.fireworksLeft--;
        this.fireworkTimer = 0.25 + this.rng.next() * 0.35;
        this.firework(this.fwCenter.x + (this.rng.next() - 0.5) * 10, 22 + this.rng.next() * 12, (this.rng.next() - 0.5) * 40);
      }
    }
    let sparks = false;
    for (let i = 0; i < this.sCount; i++) {
      if (this.sLife[i] <= 0) continue;
      sparks = true;
      const o = i * 3;
      this.sLife[i] -= dt;
      this.sVel[o + 1] -= 6 * dt;
      this.sVel[o] *= 1 - dt * 1.2;
      this.sVel[o + 1] *= 1 - dt * 1.2;
      this.sVel[o + 2] *= 1 - dt * 1.2;
      this.sPos[o] += this.sVel[o] * dt;
      this.sPos[o + 1] += this.sVel[o + 1] * dt;
      this.sPos[o + 2] += this.sVel[o + 2] * dt;
      if (this.sLife[i] <= 0) {
        this.sPos[o + 1] = -100;
      } else {
        const f = Math.min(1, this.sLife[i]);
        this.sCol[o] *= 0.995 + 0.005 * f;
        this.sCol[o + 1] *= 0.995;
        this.sCol[o + 2] *= 0.995;
      }
    }
    this.sparks.visible = sparks;
    if (sparks) {
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.color.needsUpdate = true;
    }
  }
}

/** Little puffs of grass/dust for slides and powerful kicks. */
export class TurfParticles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private readonly n = 300;
  private next = 0;
  private rng = new Rng(9);

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 3).fill(-100);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x5f8f3a, size: 0.07, transparent: true, opacity: 0.9 }));
    this.points.frustumCulled = false;
  }

  emit(x: number, z: number, count: number, spread = 1): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = x + (this.rng.next() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = 0.05;
      this.pos[i * 3 + 2] = z + (this.rng.next() - 0.5) * 0.3;
      this.vel[i * 3] = (this.rng.next() - 0.5) * 3 * spread;
      this.vel[i * 3 + 1] = 1 + this.rng.next() * 2.5;
      this.vel[i * 3 + 2] = (this.rng.next() - 0.5) * 3 * spread;
      this.life[i] = 0.5 + this.rng.next() * 0.5;
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 9.8 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < 0.02 || this.life[i] <= 0) {
        this.pos[o + 1] = -100;
        this.life[i] = 0;
      }
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
}
