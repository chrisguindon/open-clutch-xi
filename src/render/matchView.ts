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
 * Binds simulation Frames to the Three.js scene. Each display frame it interpolates between the last
 * two fixed simulation steps (snapping instead of smearing when a player is teleported for a
 * restart), then poses footballers, the ball, officials and effects. It only reads Frames, never live
 * simulation objects, which is what lets replays reuse the same code.
 */

import * as THREE from 'three';
import { Match } from '../sim/match';
import { Anim } from '../sim/player';
import { TeamIdentity } from '../sim/teams';
import { FLAG_BALL, FLAG_HUMAN, FLAG_SPRINT, Frame, PF, P_STRIDE, snapAlpha } from '../game/frames';
import { Stadium, TimeOfDay, createSky } from './stadium';
import { buildEnvironment, EnvironmentSetup, SurfaceTextures } from './environment';
import { Kit, PlayerRig, PoseInput } from './playerModel';
import { CharacterAssets } from './characters/assets';
import { Footballer, PlayerVisual, Appearance, OG } from './characters/footballer';
import type { Official } from '../sim/officials';
import { KitSpec, createKitAtlas } from './characters/kitMaterial';
import { HAIR_POOLS, SquadMix, bodyFor } from './characters/squad';
import type { BodyType } from './characters/assets';
import { ballTexture, blobTexture, streakTexture } from './textures';
import { BallMarker, BallTrail, Celebration, ControlIndicator, TargetMarker, TurfParticles } from './effects';
import { QualityPreset } from './renderer';
import { BALL } from '../sim/config';
import { angleDiff, clamp, lerp } from '../core/math';

/** Per-frame presentation state from the game (not the simulation): who is controlled, aiming aids, HUD flags. */
export interface ViewState {
  humanId: number | null;
  passTarget: { x: number; z: number } | null;
  penAim: { z: number; y: number } | null;
  time: number;
  showIndicator: boolean;
}

const HAIR = ['#1b1b1b', '#3b2416', '#6b4423', '#a8742a', '#d9b26f', '#2b1a10', '#111111'];
const BOOTS = ['#111111', '#ffffff', '#f43f5e', '#22d3ee', '#facc15', '#a3e635'];

/** Pick contrasting kits: if the away primary clashes with home, swap to its secondary. */
export interface ResolvedKit {
  shirt: string;
  secondary: string;
  shorts: string;
  socks: string;
  trim: string;
  pattern: TeamIdentity['pattern'];
}

/**
 * Choose kits both teams can be told apart in: the away team switches to its change kit when the home
 * kits clash, and falls back further if that clashes too. Tested over every pairing of the 54 teams.
 */
export function resolveKits(home: TeamIdentity, away: TeamIdentity): [ResolvedKit, ResolvedKit] {
  const h: ResolvedKit = { shirt: home.primary, secondary: home.secondary, shorts: home.shorts, socks: home.socks, trim: home.trim, pattern: home.pattern };
  let a: ResolvedKit = { shirt: away.primary, secondary: away.secondary, shorts: away.shorts, socks: away.socks, trim: away.trim, pattern: away.pattern };
  if (kitsClash(h, a) && away.away) {
    // The away team changes to its away kit…
    const k = away.away;
    a = { shirt: k.primary, secondary: k.secondary, shorts: k.shorts, socks: k.socks, trim: k.trim, pattern: k.pattern };
  }
  if (kitsClash(h, a)) {
    // …and if even that clashes, an inverted plain kit.
    a = { shirt: away.secondary, secondary: away.primary, shorts: away.primary, socks: away.secondary, trim: away.primary, pattern: 'solid' };
  }
  if (kitsClash(h, a))
    a = {
      shirt: kitLum(h.shirt) > 0.5 ? '#1f2937' : '#f8fafc',
      secondary: away.primary,
      shorts: kitLum(h.shirt) > 0.5 ? '#1f2937' : '#f8fafc',
      socks: away.primary,
      trim: away.primary,
      pattern: 'solid',
    };
  return [h, a];
}

function kitLum(c: string): number {
  const k = new THREE.Color(c);
  return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
}
/**
 * Two kits clash when their shirts are close in colour AND brightness (seen from the broadcast camera,
 * brightness carries most of the separation). Shorts help a little.
 */
export function kitsClash(a: { shirt: string; shorts: string }, b: { shirt: string; shorts: string }): boolean {
  const dist = (x: string, y: string) =>
    new THREE.Color(x)
      .sub(new THREE.Color(y))
      .toArray()
      .reduce((s, v) => s + Math.abs(v), 0);
  const shirt = dist(a.shirt, b.shirt),
    lum = Math.abs(kitLum(a.shirt) - kitLum(b.shirt));
  const shorts = dist(a.shorts, b.shorts);
  return (shirt < 0.75 && lum < 0.3) || (shirt < 1.0 && lum < 0.12 && shorts < 0.6);
}

/** Pick a number colour that contrasts with the shirt. */
function contrastColour(shirt: string, secondary: string): string {
  const lum = (c: string) => {
    const k = new THREE.Color(c);
    return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
  };
  if (Math.abs(lum(shirt) - lum(secondary)) > 0.25) return secondary;
  return lum(shirt) > 0.4 ? '#111111' : '#ffffff';
}

const HAIR_COLOURS = ['#2b1a10', '#141010', '#4a2e1a', '#7a5230', '#c7a15c', '#1d140e', '#8a3b1d'];

/**
 * Deterministic player appearance: body (from the squad setting), skin tone from the team's palette,
 * hair, beard, height and build. Visual only; nothing here reaches the simulation.
 */
function appearanceFor(seed: number, skinHex: string, body: BodyType): Appearance {
  const c = new THREE.Color(skinHex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const dark = lum < 0.35;
  // Tint the base texture towards the target tone.
  const tint = dark
    ? new THREE.Color(1, 1, 1).lerp(new THREE.Color(1.15, 1.08, 1.0), clamp((lum - 0.15) * 3, 0, 1))
    : new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.86, 0.74, 0.62), clamp((0.62 - lum) * 3, 0, 1));
  const r = (k: number) => ((seed * 9301 + k * 49297) % 233280) / 233280;
  const pool = HAIR_POOLS[body];
  return {
    body,
    skin: dark ? 'dark' : 'light',
    skinTint: '#' + tint.getHexString(),
    hair: pool[Math.floor(r(1) * pool.length)],
    beard: body === 'm' && r(2) < 0.3,
    hairColour: HAIR_COLOURS[Math.floor(r(3) * HAIR_COLOURS.length)],
    height: 0.95 + r(4) * 0.09,
    build: 0.96 + r(5) * 0.08,
  };
}

/**
 * Everything drawn for a match: stadium, players, ball and effects. Consumes Frames only,
 * interpolating between the last two fixed simulation steps for smooth motion at any refresh rate.
 */
export class MatchView {
  readonly root = new THREE.Group();
  readonly stadium: Stadium;
  readonly celebration = new Celebration();
  readonly turf = new TurfParticles();
  readonly trail = new BallTrail();
  private rigs: PlayerVisual[] = [];
  private atlases: THREE.Texture[] = [];
  private ball: THREE.Mesh;
  private sky: THREE.Object3D;
  /** PMREM environment + physically based sky (null when built without a renderer, e.g. in tests). */
  readonly env: EnvironmentSetup | null = null;
  private indicator: ControlIndicator;
  private target: TargetMarker;
  private ballMarker = new BallMarker();
  private blobs: THREE.InstancedMesh;
  /** Faint secondary shadows cast by the non-shadow-mapped floodlights (null by day). */
  private streaks: THREE.InstancedMesh | null = null;
  private streakDirs: Array<{ x: number; z: number; len: number }> = [];
  /**
   * The controlled player's name label: where it should appear (world position above their head) and
   * its text, or null when hidden. Drawn by the UI as HTML, not in the 3D scene: a sprite there was
   * tone-mapped, bloomed and upscaled from a small canvas, so names came out blurred and glowing.
   */
  readonly labelAnchor = new THREE.Vector3();
  labelText: string | null = null;
  private aim: THREE.Mesh;
  private playerMat: THREE.MeshStandardMaterial;
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private blobDummy = new THREE.Object3D();
  readonly ballPos = new THREE.Vector3();
  readonly ballVel = new THREE.Vector3();
  readonly playerPos: THREE.Vector3[] = [];
  /** Home team positions (shared vectors) for the intro line-up shot. */
  readonly homeLineup: THREE.Vector3[] = [];
  readonly colors: [string, string];
  private isGK: boolean[];
  /** Pooled per-player pose inputs (no per-frame allocation). */
  private poses: PoseInput[] = [];
  private reaches: Array<{ x: number; y: number; z: number }> = [];
  private names: string[];

  // Match officials (referee, and assistants under Standard rules).
  private officialRigs: Footballer[] = [];
  private officialPoses: PoseInput[] = [];
  private officialAtlas: THREE.Texture | null = null;
  private readonly matchRef: Match;

  constructor(
    match: Match,
    readonly clubs: [TeamIdentity, TeamIdentity],
    preset: QualityPreset,
    timeOfDay: TimeOfDay,
    characters: CharacterAssets | null = null,
    gfx: { renderer: THREE.WebGLRenderer; surface: SurfaceTextures | null } | null = null,
    /** Team composition (women, men or mixed): which body each player is drawn with. */
    squad: SquadMix = 'mixed',
  ) {
    this.matchRef = match;
    const kits = resolveKits(clubs[0], clubs[1]);
    this.colors = [kits[0].shirt, kits[1].shirt];
    if (gfx) this.env = buildEnvironment(gfx.renderer, timeOfDay, match.pitch);
    this.stadium = new Stadium({
      pitch: match.pitch,
      crowdCount: preset.crowd,
      timeOfDay,
      homeColor: clubs[0].primary,
      awayColor: clubs[1].primary,
      shadows: preset.shadows,
      surface: gfx?.surface ?? null,
      keyDir: this.env?.keyDir,
      haze: preset.haze,
      fillLights: preset.fills,
    });
    this.stadium.sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
    this.root.add(this.stadium.group);
    this.sky = this.env?.sky ?? createSky(timeOfDay);
    this.root.add(this.sky);

    this.playerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 });
    this.isGK = match.world.players.map((p) => p.isGK);
    this.names = match.world.players.map((p) => `${p.number} ${p.name}`);
    // Per-team name/number atlases for the skinned footballers.
    const atlases = characters
      ? ([0, 1] as const).map((t) => {
          const ps = match.world.players.filter((p) => p.team === t);
          const k = kits[t];
          return createKitAtlas(
            ps.map((p) => p.name.split(' ').slice(-1)[0].toUpperCase()),
            ps.map((p) => p.number),
            contrastColour(k.shirt, k.secondary),
            '#00000055',
            { primary: clubs[t].primary, secondary: clubs[t].secondary, short: clubs[t].short },
          );
        })
      : null;
    if (atlases) this.atlases = atlases;
    for (const p of match.world.players) {
      const club = clubs[p.team];
      const k = kits[p.team];
      if (characters && atlases) {
        const kitSpec: KitSpec = p.isGK
          ? {
              shirt: club.keeper,
              shirt2: club.keeper,
              trim: '#111111',
              shorts: '#1f2937',
              socks: club.keeper,
              boots: '#111111',
              pattern: 'solid',
              keeper: true,
              gloves: '#f1f5f9',
            }
          : {
              shirt: k.shirt,
              shirt2: k.secondary,
              trim: k.trim,
              shorts: k.shorts,
              socks: k.socks,
              boots: club.boots,
              pattern: k.pattern,
              keeper: false,
              gloves: '#ffffff',
            };
        const look = appearanceFor(p.id * 7 + p.team * 31, club.skinTones[(p.index * 3 + p.team) % club.skinTones.length], bodyFor(squad, p.team, p.index));
        const cell = match.world.players.filter((q) => q.team === p.team).indexOf(p);
        const fb = new Footballer(characters, kitSpec, atlases[p.team], cell, look, p.id);
        fb.setShadows(preset.shadows);
        this.rigs.push(fb);
        this.reaches.push({ x: 0, y: 0, z: 0 });
        this.poses.push({
          anim: Anim.Locomotion,
          animTime: 0,
          speed: 0,
          lean: 0,
          mood: 0,
          y: 0,
          diveSide: 0,
          isGK: p.isGK,
          sprint: false,
          hasBall: false,
          gait: 0,
          fwd: 0,
          lat: 0,
          touchAge: 10,
          touchFoot: 1,
          kickFoot: -1,
          reach: null,
        });
        this.root.add(fb.root);
        this.playerPos.push(new THREE.Vector3());
        continue;
      }
      const kit: Kit = {
        shirt: p.isGK ? club.keeper : k.shirt,
        secondary: p.isGK ? '#111111' : k.secondary,
        shorts: p.isGK ? '#1f2937' : k.shorts,
        socks: p.isGK ? club.keeper : k.socks,
        skin: club.skinTones[(p.index * 3 + p.team) % club.skinTones.length],
        hair: HAIR[(p.id * 5 + 1) % HAIR.length],
        boots: BOOTS[(p.id * 3) % BOOTS.length],
        keeper: p.isGK,
        gloves: '#f8fafc',
      };
      const rig = new PlayerRig(kit, this.playerMat);
      rig.setShadows(preset.shadows);
      this.rigs.push(rig);
      this.reaches.push({ x: 0, y: 0, z: 0 });
      this.poses.push({
        anim: Anim.Locomotion,
        animTime: 0,
        speed: 0,
        lean: 0,
        mood: 0,
        y: 0,
        diveSide: 0,
        isGK: p.isGK,
        sprint: false,
        hasBall: false,
        gait: 0,
        fwd: 0,
        lat: 0,
        touchAge: 10,
        touchFoot: 1,
        kickFoot: -1,
        reach: null,
      });
      this.root.add(rig.root);
      this.playerPos.push(new THREE.Vector3());
    }
    if (characters && match.options.mode === 'match')
      this.createOfficials(match, characters, [kits[0].shirt, kits[1].shirt, clubs[0].keeper, clubs[1].keeper], preset);

    match.world.players.forEach((p, i) => {
      if (p.team === 0) this.homeLineup.push(this.playerPos[i]);
    });
    const bt = ballTexture();
    this.ball = new THREE.Mesh(
      // Rendered ~20% larger than physical size for readability at broadcast distance.
      new THREE.SphereGeometry(BALL.radius * 1.2, 32, 20),
      // Glossy PU panels: clearcoat picks up the floodlights / sun from the environment map.
      new THREE.MeshPhysicalMaterial({ map: bt, roughness: 0.45, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.18 }),
    );
    this.ball.castShadow = preset.shadows;
    this.root.add(this.ball);

    // Contact shadows (always on; they ground the players even without shadow maps).
    const blobGeo = new THREE.PlaneGeometry(1, 1);
    blobGeo.rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(
      blobGeo,
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: preset.shadows ? 0.55 : 0.9 }),
      match.world.players.length + 1,
    );
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 1;
    this.root.add(this.blobs);
    if (this.stadium.fillDirs.length) {
      // One streak per player per floodlight fill, pointing away from the light; length from its elevation.
      for (const d of this.stadium.fillDirs) {
        const h = Math.hypot(d.x, d.z);
        this.streakDirs.push({ x: -d.x / h, z: -d.z / h, len: Math.min(6, (1.75 * h) / Math.max(0.15, d.y)) });
      }
      const g = new THREE.PlaneGeometry(1, 1);
      g.translate(0.5, 0, 0); // origin at the feet end
      g.rotateX(-Math.PI / 2);
      const strength = timeOfDay === 'night' ? 0.32 : 0.2;
      this.streaks = new THREE.InstancedMesh(
        g,
        new THREE.MeshBasicMaterial({ map: streakTexture(), color: 0x000000, transparent: true, opacity: strength, depthWrite: false }),
        match.world.players.length * this.streakDirs.length,
      );
      this.streaks.frustumCulled = false;
      this.streaks.renderOrder = 1;
      this.root.add(this.streaks);
    }

    this.indicator = new ControlIndicator('#fde047');
    this.target = new TargetMarker('#ffffff');
    this.root.add(this.indicator.group, this.target.mesh, this.ballMarker.mesh, this.trail.mesh, this.celebration.group, this.turf.points);

    // Constant on-screen size regardless of camera distance.

    const aimGeo = new THREE.RingGeometry(0.16, 0.24, 28);
    aimGeo.rotateY(Math.PI / 2);
    this.aim = new THREE.Mesh(aimGeo, new THREE.MeshBasicMaterial({ color: 0xfde047, side: THREE.DoubleSide, depthTest: false, transparent: true }));
    this.aim.renderOrder = 12;
    this.aim.visible = false;
    this.root.add(this.aim);
  }

  netImpact(side: 1 | -1, x: number, y: number, z: number, s: number): void {
    this.stadium.netImpact(side, x, y, z, s);
  }

  /** Interpolated frames from the last interpolate() call, consumed by render(). */
  private ia: Frame | null = null;
  private ib: Frame | null = null;
  /** Diagnostics: interpolation factor used for the last frame. */
  lastAlpha = 0;
  /** Per-player interpolation factor (1 = snapped because the player teleported between steps). */
  private pAlpha: Float32Array = new Float32Array(0);
  /** Diagnostics: how many entities were snapped (teleported) in the last interpolate(). */
  snapsLastFrame = 0;

  /**
   * Interpolate ball and player positions between two fixed simulation steps. Must run before the
   * camera update so the camera tracks exactly what is drawn this frame. Entities that moved further
   * than physically possible in one step (restarts, resets, replays cutting) are snapped, not smeared.
   */
  interpolate(a: Frame, b: Frame, alpha: number): void {
    this.ia = a;
    this.ib = b;
    this.lastAlpha = alpha;
    let snaps = 0;
    const ba = a.ball,
      bb = b.ball;
    const jump = Math.hypot(bb[0] - ba[0], bb[1] - ba[1], bb[2] - ba[2]);
    const stepDt = Math.max(1e-3, b.time - a.time);
    // Ball can't cover more than ~45 m/s × step; allow generous slack for kicks.
    const bAlpha = snapAlpha(jump, stepDt, alpha, 60, 1.2);
    if (bAlpha !== alpha) snaps++;
    this.ballPos.set(lerp(ba[0], bb[0], bAlpha), lerp(ba[1], bb[1], bAlpha), lerp(ba[2], bb[2], bAlpha));
    // Velocity from the simulation itself (smooth regardless of frame timing).
    this.ballVel.set(lerp(ba[8], bb[8], bAlpha), lerp(ba[9], bb[9], bAlpha), lerp(ba[10], bb[10], bAlpha));
    this.ballAlpha = bAlpha;
    const A = a.players,
      Bp = b.players;
    if (this.pAlpha.length !== this.rigs.length) this.pAlpha = new Float32Array(this.rigs.length);
    for (let i = 0; i < this.rigs.length; i++) {
      const o = i * P_STRIDE;
      const d = Math.hypot(Bp[o + PF.X] - A[o + PF.X], Bp[o + PF.Z] - A[o + PF.Z]);
      const pa = snapAlpha(d, stepDt, alpha, 20, 0.8);
      if (pa !== alpha) snaps++;
      this.pAlpha[i] = pa;
      this.playerPos[i].set(lerp(A[o + PF.X], Bp[o + PF.X], pa), lerp(A[o + PF.Y], Bp[o + PF.Y], pa), lerp(A[o + PF.Z], Bp[o + PF.Z], pa));
    }
    this.snapsLastFrame = snaps;
  }
  private ballAlpha = 0;
  /** Profiling: CPU ms spent updating character animation/skeletons in the last render(). */
  animMs = 0;
  /** Benchmark toggle: skip character animation updates (poses freeze). */
  freezeAnimation = false;

  /** Benchmark toggles. */
  setSimplePlayers(on: boolean): void {
    for (const r of this.rigs) if ('simplified' in r) (r as { simplified: boolean }).simplified = on;
  }
  setCrowdVisible(v: boolean): void {
    this.stadium.setCrowdVisible(v);
  }
  setStadiumDetail(v: boolean): void {
    this.stadium.setDetailVisible(v);
    if (this.streaks) this.streaks.visible = v;
  }

  render(_a: Frame, _b: Frame, _alpha: number, dt: number, view: ViewState, camera: THREE.Camera, excitement: number, wave: number): void {
    const t = view.time;
    const a = this.ia ?? _a,
      b = this.ib ?? _b;
    if (!this.ia) this.interpolate(_a, _b, _alpha);
    // Ball.
    const ba = a.ball,
      bb = b.ball;
    this.ball.position.copy(this.ballPos);
    this.tmpQ.set(ba[3], ba[4], ba[5], ba[6]);
    this.tmpQ2.set(bb[3], bb[4], bb[5], bb[6]);
    this.ball.quaternion.slerpQuaternions(this.tmpQ, this.tmpQ2, this.ballAlpha);
    this.ballMarker.update(this.ballPos.x, this.ballPos.y, this.ballPos.z);
    this.trail.update(this.ballPos, this.ballVel.length(), camera, dt);
    this.ia = this.ib = null;

    // Players.
    let animMs = 0;
    const A = a.players,
      Bp = b.players;
    let humanIdx = -1;
    for (let i = 0; i < this.rigs.length; i++) {
      const o = i * P_STRIDE;
      const alpha = this.pAlpha[i];
      const pp = this.playerPos[i];
      const x = pp.x,
        y = pp.y,
        z = pp.z;
      const fa = A[o + PF.Facing],
        fb = Bp[o + PF.Facing];
      const facing = fa + angleDiff(fa, fb) * alpha;
      const rig = this.rigs[i];
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = Math.PI / 2 - facing;
      const flags = Bp[o + PF.Flags];
      const anim = Bp[o + PF.Anim] as Anim;
      const diveWorld = Bp[o + PF.DiveDir];
      // Velocity in model space: model +z is the facing direction, +x is the player's left.
      const vx = lerp(A[o + PF.VelX], Bp[o + PF.VelX], alpha),
        vz = lerp(A[o + PF.VelZ], Bp[o + PF.VelZ], alpha);
      const cf = Math.cos(facing),
        sf = Math.sin(facing);
      const fwd = vx * cf + vz * sf;
      const lat = vx * sf - vz * cf;
      let reach: { x: number; y: number; z: number } | null = null;
      if (this.isGK[i]) {
        const bx = this.ballPos.x - x,
          bz = this.ballPos.z - z;
        if (bx * bx + bz * bz < 3.2 * 3.2 && this.ballPos.y > 0.25) {
          reach = this.reaches[i];
          reach.x = bx * sf - bz * cf;
          reach.y = this.ballPos.y - y;
          reach.z = bx * cf + bz * sf;
        }
      }
      const ga = A[o + PF.Gait],
        gb = Bp[o + PF.Gait];
      const ps = this.poses[i];
      ps.anim = anim;
      // Interpolate action time too (when the same action continues) so clips advance smoothly at any refresh rate.
      const ta = A[o + PF.AnimTime],
        tb = Bp[o + PF.AnimTime];
      ps.animTime = A[o + PF.Anim] === anim && tb >= ta ? lerp(ta, tb, alpha) : tb;
      ps.speed = lerp(A[o + PF.Speed], Bp[o + PF.Speed], alpha);
      ps.lean = lerp(A[o + PF.Lean], Bp[o + PF.Lean], alpha);
      ps.mood = Bp[o + PF.Mood];
      ps.y = y;
      ps.diveSide = -diveWorld * Math.cos(facing);
      ps.sprint = (flags & FLAG_SPRINT) !== 0;
      ps.hasBall = (flags & FLAG_BALL) !== 0;
      ps.gait = Math.abs(gb - ga) < 3 ? lerp(ga, gb, alpha) : gb;
      ps.fwd = fwd;
      ps.lat = lat;
      const tga = A[o + PF.TouchAge],
        tgb = Bp[o + PF.TouchAge];
      ps.touchAge = tgb >= tga ? lerp(tga, tgb, alpha) : tgb;
      ps.touchFoot = Bp[o + PF.TouchFoot];
      ps.kickFoot = Bp[o + PF.KickFoot];
      ps.gesture = Bp[o + PF.Gesture];
      ps.reach = reach;
      const tAnim = performance.now();
      if ('frozen' in rig) (rig as { frozen: boolean }).frozen = this.freezeAnimation;
      if (!this.freezeAnimation || 'frozen' in rig) rig.update(ps, dt, camera.position.distanceTo(this.playerPos[i]));
      animMs += performance.now() - tAnim;
      if (flags & FLAG_HUMAN) humanIdx = i;
      // Contact shadow.
      const lying = anim === Anim.Slide || anim === Anim.Fallen || anim === Anim.Dive;
      const s = (lying ? 1.6 : 1.0) * Math.max(0.4, 1 - y * 0.4);
      this.blobDummy.position.set(x, 0.015, z);
      this.blobDummy.scale.set(s, 1, s);
      this.blobDummy.rotation.set(0, Math.PI / 2 - facing, 0);
      this.blobDummy.updateMatrix();
      this.blobs.setMatrixAt(i, this.blobDummy.matrix);
      if (this.streaks) {
        const k = lying ? 0.45 : Math.max(0.2, 1 - y * 0.5);
        for (let j = 0; j < this.streakDirs.length; j++) {
          const sd = this.streakDirs[j];
          this.blobDummy.position.set(x, 0.013, z);
          this.blobDummy.rotation.set(0, Math.atan2(-sd.z, sd.x), 0);
          this.blobDummy.scale.set(sd.len * k, 1, 0.62);
          this.blobDummy.updateMatrix();
          this.streaks.setMatrixAt(i * this.streakDirs.length + j, this.blobDummy.matrix);
        }
      }
    }
    if (this.streaks) this.streaks.instanceMatrix.needsUpdate = true;
    const tOff = performance.now();
    this.updateOfficials(dt, camera);
    this.animMs = animMs + performance.now() - tOff;
    const bs = Math.max(0.15, 0.45 - this.ballPos.y * 0.05);
    this.blobDummy.position.set(this.ballPos.x, 0.016, this.ballPos.z);
    this.blobDummy.scale.set(bs, 1, bs);
    this.blobDummy.updateMatrix();
    this.blobs.setMatrixAt(this.rigs.length, this.blobDummy.matrix);
    this.blobs.instanceMatrix.needsUpdate = true;

    // Indicators.
    if (humanIdx >= 0 && view.showIndicator) {
      const p = this.playerPos[humanIdx];
      const o = humanIdx * P_STRIDE;
      this.indicator.update(p.x, p.z, Bp[o + PF.Facing], t, true, (Bp[o + PF.Flags] & FLAG_SPRINT) !== 0);
      this.labelText = this.names[humanIdx];
      this.labelAnchor.set(p.x, p.y + 2.05, p.z); // just above the head (players are about 1.8 m tall)
    } else {
      this.indicator.update(0, 0, 0, t, false, false);
      this.labelText = null;
    }
    this.target.update(view.passTarget ? view.passTarget.x : null, view.passTarget?.z ?? 0, t);

    if (view.penAim) {
      this.aim.visible = true;
      this.aim.position.set(this.stadium.opts.pitch.length / 2 + 0.05, view.penAim.y, view.penAim.z);
      this.aim.scale.setScalar(1 + Math.sin(t * 6) * 0.1);
    } else {
      this.aim.visible = false;
    }

    this.celebration.update(dt);
    this.turf.update(dt);
    this.stadium.update(dt, t, excitement, wave);
    this.stadium.focusShadow(this.ballPos.x * 0.7, this.ballPos.z * 0.5);
    this.sky.position.copy(camera.position).setY(0);
  }

  /**
   * The referee (and assistants under Standard rules) use the same characters, in a kit picked to contrast
   * with both teams and both keepers, without numbers. Cards and the flag are small props in the hand.
   */
  private createOfficials(match: Match, characters: CharacterAssets, avoid: string[], preset: QualityPreset): void {
    const options = ['#111111', '#facc15', '#22d3ee', '#ec4899', '#84cc16', '#f97316'];
    const rgb = (h: string) => new THREE.Color(h);
    const dist = (a: string, b: string) => {
      const x = rgb(a),
        y = rgb(b);
      return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
    };
    let colour = options[0],
      best = -1;
    for (const c of options) {
      const d = Math.min(...avoid.map((a) => dist(c, a)));
      if (d > best) {
        best = d;
        colour = c;
      }
    }
    const spec: KitSpec = {
      shirt: colour,
      shirt2: colour,
      trim: colour === '#111111' ? '#e5e7eb' : '#111111',
      shorts: '#111111',
      socks: '#111111',
      boots: '#111111',
      pattern: 'solid',
      keeper: false,
      gloves: '#ffffff',
    };
    this.officialAtlas = createKitAtlas([], [], '#ffffff', '#00000055', { primary: colour, secondary: '#111111', short: 'REF' });
    const n = match.officials.withAssistants ? 3 : 1;
    const tones = ['#c68863', '#8d5a3b', '#e9b995'];
    for (let i = 0; i < n; i++) {
      const fb = new Footballer(
        characters,
        spec,
        this.officialAtlas,
        0,
        appearanceFor(1000 + i * 13, tones[i % tones.length], bodyFor('mixed', 0, i)),
        1000 + i,
      );
      fb.setShadows(preset.shadows);
      if (i === 0) {
        for (const [name, c] of [
          ['yellow', '#facc15'],
          ['red', '#dc2626'],
        ] as const) {
          const card = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.1), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
          card.visible = false;
          card.position.set(0, 0.08, 0);
          fb.attachProp(name, 'hand_r', card);
        }
      } else {
        const flag = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.55, 6), new THREE.MeshBasicMaterial({ color: '#e5e7eb' }));
        pole.position.y = 0.2;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.2), new THREE.MeshBasicMaterial({ color: '#facc15', side: THREE.DoubleSide }));
        cloth.position.set(0.14, 0.38, 0);
        const quarter = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.1), new THREE.MeshBasicMaterial({ color: '#dc2626', side: THREE.DoubleSide }));
        quarter.position.set(0.07, 0.43, 0.001);
        flag.add(pole, cloth, quarter);
        fb.attachProp('flag', 'hand_r', flag);
      }
      this.officialRigs.push(fb);
      this.officialPoses.push({
        anim: Anim.Locomotion,
        animTime: 0,
        speed: 0,
        lean: 0,
        mood: 0,
        y: 0,
        diveSide: 0,
        isGK: false,
        sprint: false,
        hasBall: false,
        gait: 0,
        fwd: 0,
        lat: 0,
        touchAge: 10,
        touchFoot: 1,
        kickFoot: -1,
        reach: null,
        gesture: 0,
      });
      this.root.add(fb.root);
    }
  }

  private static readonly SIGNAL_GESTURE: Record<string, number> = {
    whistle: OG.Whistle,
    point: OG.Point,
    goal: OG.Point,
    indirect: OG.Indirect,
    advantage: OG.Advantage,
    yellow: OG.Card,
    red: OG.Card,
    raised: OG.FlagUp,
    offside: OG.FlagUp,
    throwIn: OG.FlagDirection,
    goalKick: OG.FlagLevel,
    corner: OG.FlagDown,
  };

  /** Officials follow the live simulation (they're hidden during replays, which only record players). */
  private updateOfficials(dt: number, camera: THREE.Camera): void {
    if (!this.officialRigs.length) return;
    const o = this.matchRef.officials;
    const list: Official[] = [o.referee, ...o.assistants];
    const visible = this.matchRef.phase !== 'replay';
    for (let i = 0; i < this.officialRigs.length; i++) {
      const rig = this.officialRigs[i];
      rig.root.visible = visible;
      if (!visible) continue;
      const off = list[i];
      const ps = this.officialPoses[i];
      rig.root.position.set(off.x, 0, off.z);
      rig.root.rotation.y = Math.PI / 2 - off.facing;
      const cf = Math.cos(off.facing),
        sf = Math.sin(off.facing);
      ps.speed = Math.hypot(off.vx, off.vz);
      ps.fwd = off.vx * cf + off.vz * sf;
      ps.lat = off.vx * sf - off.vz * cf;
      ps.sprint = ps.speed > 5;
      ps.gait += dt * (2 * Math.PI) * (0.9 + ps.speed * 0.22);
      ps.gesture = MatchView.SIGNAL_GESTURE[off.signal] ?? 0;
      const l = Math.hypot(off.signalX, off.signalZ) || 1;
      const dx = off.signalX / l,
        dz = off.signalZ / l;
      ps.pointX = dx * sf - dz * cf;
      ps.pointZ = dx * cf + dz * sf;
      if (i === 0) {
        rig.showProp('yellow', off.signal === 'yellow');
        rig.showProp('red', off.signal === 'red');
      }
      rig.update(ps, dt, camera.position.distanceTo(rig.root.position));
    }
  }

  dispose(): void {
    this.root.remove(this.sky);
    if (this.env) this.env.dispose();
    this.stadium.dispose();
    for (const a of this.atlases) a.dispose();
    this.officialAtlas?.dispose();
    for (const r of this.officialRigs) r.dispose();
    this.rigs.forEach((r) => r.dispose());
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(o instanceof THREE.SkinnedMesh)) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
