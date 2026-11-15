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
import { Match, MatchOptions } from '../sim/match';
import { GameMode, SIM_DT } from '../sim/config';
import { BRAND } from '../brand';
import { loadProgress, recordMatch, recordTutorialCompleted, saveProgress, summariseMatch, type PlayerProgress } from './progress';
import { achievementById, type AchievementId } from './achievements';
import { TeamIdentity } from '../sim/teams';
import { NATIONS, nationByCode } from '../sim/nations';
import { chargeToPower, consumeEdges } from '../sim/human';
import { pickPassTarget } from '../sim/ai/evaluate';
import { DecisionInfo, TeamBrain } from '../sim/ai/teamBrain';
import { Renderer, QUALITY } from '../render/renderer';
import { MatchView } from '../render/matchView';
import { CharacterAssets, loadCharacterAssets } from '../render/characters/assets';
import { loadSurfaceTextures, SurfaceTextures } from '../render/environment';
import { CameraRig, INTRO_LENGTH, INTRO_LINEUP, celebrationShotEnds } from '../render/camera';
import { Footballer } from '../render/characters/footballer';
import { FluidityDiagnostics, download, stamp } from './diagnostics';
import { TouchControls } from '../input/touch';
import { Benchmark, BenchToggles } from './benchmark';
import { SIM_PROFILE } from '../sim/match';
import { MovementLab } from '../dev/lab';
import { applyTuning, loadTuning } from '../dev/tuning';
import { AudioEngine } from '../audio/audio';
import { InputManager, UICommand } from '../input/input';
import { MinimapData, UI, UIHost, bindHtml, controlAvailable } from '../ui/ui';
import { FixedStepClock, Frame, REFRESH_FALLBACK_DT, RefreshEstimate, ReplayBuffer, autoFrameSteps, estimateRefresh, frameIntervalFor } from './frames';
import { AdaptiveController, AdaptiveOptions, LADDER, levelIndexFor } from './adaptive';
import { ReplayDirector } from './replay';
import { CameraMode, Quality, Settings, classifyDevice, hasStoredSettings, loadSettings, profileFor, saveSettings } from './settings';
import { Tutorial } from './tutorial';

type State = 'loading' | 'menu' | 'playing' | 'paused' | 'fulltime';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const REPLAY_RATE = 60;
const REPLAY_BEFORE = 3.2;
const REPLAY_AFTER = 1.3;

/**
 * Top-level orchestrator. Owns the renderer, audio, input and UI, and runs the
 * current Match with a fixed-step simulation loop, rendering interpolated frames.
 */
export class Game implements UIHost {
  settings: Settings;
  private renderer!: Renderer;
  private cam!: CameraRig;
  private audio = new AudioEngine();
  private input!: InputManager;
  private ui: UI;
  private match: Match | null = null;
  private view: MatchView | null = null;
  private clubs: [TeamIdentity, TeamIdentity] = [NATIONS[0], NATIONS[1]];
  private characters: CharacterAssets | null = null;
  private surface: SurfaceTextures | null = null;
  private mode: GameMode = 'match';
  private state: State = 'loading';
  private attract = false;
  private prev: Frame | null = null;
  private cur: Frame | null = null;
  private replayBuf: ReplayBuffer | null = null;
  private stepCount = 0;
  private time = 0;
  private replay: ReplayDirector | null = null;
  private replayAngle = 0;
  private pendingReplay: { at: number } | null = null;
  private replayFrames: Frame[] | null = null;
  private excitement = 0;
  private crowdLevel = 0.3;
  private wave = 0;
  private fullTimeTimer = -1;
  private introTimer = 0;
  private celebrateTimer = 0;
  private tutorial: Tutorial | null = null;
  private fpsShown = 0;
  private showFps = new URLSearchParams(location.search).has('fps');
  private lastMatchOptions: MatchOptions | null = null;
  /** The player's local record (statistics, history, achievements); see src/game/progress.ts. */
  progress: PlayerProgress = loadProgress();
  /**
   * Id of the match or shootout in progress, set when it starts and cleared once it is recorded, so a
   * match is counted at most once. Quitting or restarting replaces it: abandoned matches never count.
   */
  private matchId: string | null = null;
  private passTarget: { x: number; z: number } | null = null;
  private minimapTimer = 0;
  private lastDt = 0;
  private minimapData: MinimapData = { length: 1, width: 1, players: [], ball: { x: 0, z: 0 }, colors: ['#fff', '#000'] };
  /** Rolling CPU timings in ms (exposed for profiling via window.__game.perf). */
  readonly perf = { sim: 0, view: 0, render: 0, steps: 0, resolutionScale: 1 };
  /** Fluidity diagnostics (F3 / ?diag). Recording is always on and cheap; the overlay is optional. */
  readonly diag: FluidityDiagnostics = new FluidityDiagnostics();
  private camCuts = 0;
  private bench: Benchmark | null = null;
  private firstLaunch = false;
  private benchToggles: BenchToggles = {};
  /** Movement lab (`?lab`), development only. */
  private lab: MovementLab | null = null;

  constructor(
    private container: HTMLElement,
    uiRoot: HTMLElement,
  ) {
    this.firstLaunch = !hasStoredSettings();
    this.settings = loadSettings();
    this.ui = new UI(uiRoot, this);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    try {
      this.ui.setLoading(0.1, 'Initialising graphics…');
      await nextFrame();
      this.renderer = new Renderer(this.container);
      // First launch: pick quality / frame-rate defaults for this device (players can change them).
      if (this.firstLaunch && !this.settings.deviceProfileApplied) {
        const cls = classifyDevice(this.gpuName());
        Object.assign(this.settings, profileFor(cls), { deviceProfileApplied: true });
        saveSettings(this.settings);
        console.info(`${BRAND.name}: device class "${cls}" → ${this.settings.quality} quality`);
      }
      this.cam = new CameraRig(PITCH_PLACEHOLDER, this.aspect());
      this.cam.reduceMotion = this.settings.reduceMotion;
      Footballer.reduceMotion = this.settings.reduceMotion;
      this.cam.mode = this.settings.camera;
      this.activeQuality = this.settings.quality;
      this.renderer.applyQuality(this.settings.quality, this.cam.camera);
      this.input = new InputManager(this.settings, this.renderer.canvas);
      this.input.onGameplayInput = (t) => this.diag.inputEvent(t);
      this.input.touch = new TouchControls(document.getElementById('app') ?? document.body);
      this.input.touch.onPause = () => this.pause();
      this.input.touch.setPrefs(this.settings.touchSize, this.settings.touchLeftHanded);
      // Touch-only devices (phone / tablet without a mouse) get touch controls without being asked.
      if (!this.settings.controlsChosen && TouchControls.isTouchDevice() && !matchMedia('(any-pointer: fine)').matches) {
        this.settings.controlScheme = 'touch';
        this.settings.controlsChosen = true;
        saveSettings(this.settings);
      }
      this.diag.attachRenderer(this.renderer.statsSource());
      this.resetAdaptive(true);
      this.diag.aiDecision = () => this.aiDecisionText();
      this.diag.adaptive = () =>
        this.adaptive && {
          mode: this.settings.graphicsMode === 'auto' ? 'Auto' : `Manual ${this.settings.quality}${this.settings.adaptiveQuality ? ' + adaptive' : ''}`,
          level: LADDER[this.adaptive.state.level].name,
          calibrating: this.adaptive.calibrating,
          resolutionScale: this.adaptive.state.resScale,
          history: this.adaptive.history,
        };
      this.diag.context = () => ({
        quality: this.activeQuality,
        graphicsMode: this.settings.graphicsMode,
        camera: this.cam.mode,
        timeOfDay: this.settings.timeOfDay,
        dynamicResolution: this.settings.dynamicResolution,
        adaptiveQuality: this.settings.adaptiveQuality,
        mode: this.mode,
        state: this.state,
        players: this.match?.world.players.length ?? 0,
        pixelRatio: this.renderer.renderer.getPixelRatio(),
      });
      this.input.onUI((c) => this.onUICommand(c));
      this.ui.setLoading(0.2, 'Loading players…');
      try {
        this.characters = await loadCharacterAssets((f) => this.ui.setLoading(0.2 + f * 0.2, 'Loading players…'));
      } catch (err) {
        // Fall back to the procedural players rather than failing to start.
        console.warn('Character assets unavailable, using procedural players:', err);
        this.characters = null;
      }
      try {
        this.surface = await loadSurfaceTextures();
      } catch (err) {
        console.warn('Turf textures unavailable, using procedural grass:', err);
      }
      this.ui.setLoading(0.45, 'Building the stadium…');
      await nextFrame();
      this.buildMatch(
        { mode: 'match', format: '5v5', difficulty: 'medium', duration: 99999, aiOnly: true, replays: false, seed: Date.now() % 100000 },
        this.attractTeams(),
        true,
      );
      this.ui.setLoading(0.8, 'Rolling out the pitch…');
      await nextFrame();
      // Warm up: compile shaders and run a few sim steps.
      this.renderer.renderer.compile(this.renderer.scene, this.cam.camera);
      this.ui.setLoading(1, 'Ready');
      await nextFrame();
    } catch (err) {
      console.error(err);
      this.ui.showError(err instanceof Error ? err.message : String(err));
      return;
    }
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      this.adaptive?.interrupt();
      if (document.hidden) {
        this.autoPause();
        this.audio.suspend();
      } else if (this.audio.ready) {
        this.audio.resume();
      }
    });
    window.addEventListener('blur', () => this.autoPause());
    // Unlock audio on the first interaction (autoplay policy).
    const unlock = () => {
      this.audio.unlock();
      void this.audio.loadSamples(import.meta.env.BASE_URL + 'assets/audio/');
      this.applyVolumes();
      this.audio.startCrowd();
      this.audio.setCrowdIntensity(0.2);
    };
    // (touchend / click as well: older iOS Safari only treats those as user activation for audio.)
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click'] as const) window.addEventListener(ev, unlock, { passive: true });
    const params = new URLSearchParams(location.search);
    this.diag.onBenchmark = () => {
      void this.runBenchmark();
    };
    this.diag.onCpuCheck = () => {
      void this.runCpuCheck();
    };
    if (params.has('bench')) {
      this.state = 'menu';
      setTimeout(() => {
        void this.runBenchmark();
      }, 300);
    } else if (params.has('lab')) {
      this.lab = new MovementLab({ match: () => this.match, cam: this.cam, cut: () => this.cam.cut() });
      this.launch({ mode: 'practice', format: '5v5', difficulty: 'easy', duration: 9999, replays: false, autoSwitch: false, seed: 1 });
      this.cam.cinematic = null;
      this.lab.setupScenario();
    } else {
      // Lab tuning only affects normal play when explicitly enabled there.
      const t = loadTuning();
      applyTuning(t?.useInMatches ? t : null, this.cam.tune);
      this.state = 'menu';
      this.ui.showMenu();
    }
    this.lastRaf = 0;
    this.sinceRender = 0;
    requestAnimationFrame(this.loop);
    (window as unknown as { __game: Game }).__game = this;
  }

  private aspect(): number {
    return Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
  }

  private onResize(): void {
    this.adaptive?.interrupt();
    this.renderer.resize();
    this.cam.setAspect(this.aspect());
  }

  // ---------------------------------------------------------------------------
  // Match lifecycle
  // ---------------------------------------------------------------------------

  private buildMatch(opts: MatchOptions, clubs: [TeamIdentity, TeamIdentity], attract: boolean): void {
    this.disposeMatch();
    this.attract = attract;
    this.clubs = clubs;
    this.mode = opts.mode;
    const m = new Match({ ...opts, teamNames: [clubs[0].name, clubs[1].name] });
    this.match = m;
    const preset = { ...QUALITY[this.activeQuality] };
    this.view = new MatchView(
      m,
      clubs,
      preset,
      this.settings.timeOfDay,
      this.characters,
      { renderer: this.renderer.renderer, surface: this.surface },
      this.settings.squad,
    );
    this.renderer.scene.add(this.view.root);
    this.applyViewEnvironment();
    this.precompile();
    this.cam.setPitch(m.pitch);
    const n = m.world.players.length;
    this.prev = new Frame(n);
    this.cur = new Frame(n);
    this.cur.capture(m);
    this.prev.copyFrom(this.cur);
    this.replayBuf = new ReplayBuffer(REPLAY_RATE * 7, n);
    this.clock.reset();
    this.replay = null;
    this.pendingReplay = null;
    this.replayFrames = null;
    this.fullTimeTimer = -1;
    this.excitement = 0;
    this.wireMatchEvents(m);
    if (attract) {
      this.cam.cinematic = { kind: 'attract', t: 0 };
    } else if (opts.mode === 'penalties') {
      this.cam.cinematic = { kind: 'penShoot' };
    } else {
      this.cam.cinematic = { kind: 'intro', t: 0 };
      this.introTimer = INTRO_LENGTH;
      this.ui.showLineups(m, clubs, INTRO_LINEUP);
    }
    this.cam.cut();
    this.ui.resetHud();
  }

  /**
   * Compile every shader up front, including effects that start hidden (confetti, fireworks,
   * trails, labels): WebGLRenderer.compile() skips invisible objects, which otherwise causes a
   * hitch the first time a goal is scored.
   */
  private precompile(): void {
    const hidden: THREE.Object3D[] = [];
    this.renderer.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      this.renderer.renderer.compile(this.renderer.scene, this.cam.camera);
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }

  /** Scene-wide lighting environment for the current view: PMREM reflections, haze and bloom. */
  private applyViewEnvironment(): void {
    const scene = this.renderer.scene;
    const tod = this.settings.timeOfDay;
    const env = this.view?.env ?? null;
    scene.environment = env?.envMap ?? null;
    scene.environmentIntensity = env?.envIntensity ?? 1;
    // Exponential haze: a touch of atmosphere at day, floodlit mist at night.
    const fogCol = tod === 'day' ? 0xb9cde6 : tod === 'dusk' ? 0x5a4a5e : 0x0d1424;
    scene.fog = new THREE.FogExp2(fogCol, tod === 'day' ? 0.0016 : tod === 'dusk' ? 0.0024 : 0.0026);
    // Bloom only affects lamps and flares now (see BLOOM_THRESHOLD), so these are gentle on purpose.
    this.renderer.setBloom(tod === 'day' ? 0.1 : tod === 'dusk' ? 0.22 : 0.3);
    this.renderer.setGrade(tod);
    this.renderer.setExposure(tod === 'day' ? 0.85 : tod === 'dusk' ? 1.1 : 1.1);
  }

  private disposeMatch(): void {
    this.ui.hideLineups();
    if (this.view) {
      this.renderer.scene.remove(this.view.root);
      this.view.dispose();
      this.view = null;
    }
    this.match?.events.clear();
    this.match = null;
    this.tutorial = null;
    this.ui.tutorial(null);
  }

  startMatch(mode: GameMode): void {
    this.audio.unlock();
    this.applyVolumes();
    this.audio.startCrowd();
    if (mode === 'match' && !this.settings.tutorialSeen && this.ui.screen === 'menu') {
      this.ui.showTutorialOffer();
      return;
    }
    const s = this.settings;
    const opts: MatchOptions = {
      mode,
      format: s.format,
      difficulty: s.difficulty,
      duration: s.minutes * 60,
      replays: s.replays,
      autoSwitch: s.autoSwitch,
      seed: Math.floor(Math.random() * 1e9),
    };
    this.launch(opts);
  }

  startTutorial(): void {
    this.launch({ mode: 'practice', format: '5v5', difficulty: 'easy', duration: 9999, replays: false, autoSwitch: true, seed: 1 });
    this.tutorial = new Tutorial(this.match!, this.settings, (step, msg, done) => this.ui.tutorial(step, msg, done));
  }

  tutorialAction(a: 'retry' | 'skip' | 'restart' | 'exit'): void {
    if (!this.tutorial) return;
    // Don't leave the button focused: Space (a gameplay key) would press it again.
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.renderer.canvas.focus?.();
    if (a === 'exit') {
      this.tutorial = null;
      this.ui.tutorial(null);
      this.quitToMenu();
      return;
    }
    if (this.state === 'paused') this.resume();
    this.tutorial.handle(a);
  }

  private launch(opts: MatchOptions): void {
    this.lastMatchOptions = opts;
    this.ui.hide();
    this.ui.clearPauseContext();
    this.ui.clearBanner();
    this.buildMatch(opts, [nationByCode(this.settings.homeTeam) ?? NATIONS[0], nationByCode(this.settings.awayTeam) ?? NATIONS[1]], false);
    this.matchId = opts.mode === 'match' || opts.mode === 'penalties' ? `${Date.now().toString(36)}-${opts.seed}` : null;
    this.state = 'playing';
    this.input.gameplayActive = true;
    this.ui.showHud(true, this.settings.minimap && opts.mode !== 'penalties');
    this.audio.setCrowdIntensity(0.35);
    if (opts.mode === 'match') {
      this.audio.whistle('short');
      this.ui.banner(`${this.clubs[0].name} v ${this.clubs[1].name}`, `${opts.format} · ${cap(opts.difficulty)}`, 'info', 3);
    } else if (opts.mode === 'practice') {
      this.ui.banner('Practice', 'Free play — no clock', 'info', 2.5);
    }
    this.renderer.canvas.focus?.();
  }

  restart(): void {
    if (!this.lastMatchOptions) return;
    const o = { ...this.lastMatchOptions, seed: Math.floor(Math.random() * 1e9) };
    const wasTutorial = !!this.tutorial;
    this.launch(o);
    if (wasTutorial) this.tutorial = new Tutorial(this.match!, this.settings, (s, m, d) => this.ui.tutorial(s, m, d));
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hide();
    this.ui.clearPauseContext();
    this.input.gameplayActive = true;
    this.lastRaf = 0;
    this.sinceRender = 0;
  }

  private pause(): void {
    this.ui.hideLineups();
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.gameplayActive = false;
    this.ui.tutorialActive = !!this.tutorial;
    this.ui.showPause(this.mode);
  }

  private autoPause(): void {
    if (this.cpuCheckRunning) return;
    // Never pause a running benchmark (it would silently measure a paused game); the benchmark
    // records focus/visibility interruptions as validity warnings instead.
    if (this.bench?.running) return;
    if (this.state === 'playing' && !this.replay) this.pause();
  }

  quitToMenu(): void {
    this.ui.clearPauseContext();
    this.ui.showHud(false, false);
    this.ui.clearBanner();
    this.input.gameplayActive = false;
    this.buildMatch(
      { mode: 'match', format: '5v5', difficulty: 'medium', duration: 99999, aiOnly: true, replays: false, seed: Date.now() % 100000 },
      this.attractTeams(),
      true,
    );
    this.state = 'menu';
    this.audio.setCrowdIntensity(0.2);
    this.ui.showMenu();
  }

  // ---------------------------------------------------------------------------
  // UIHost
  // ---------------------------------------------------------------------------

  applySettings(changed: keyof Settings | 'all'): void {
    const s = this.settings;
    saveSettings(s);
    this.input.setSettings(s);
    // Choosing a preset switches to Manual; any graphics change restarts adaptation (with a short calibration).
    if (changed === 'quality') s.graphicsMode = 'manual';
    if (
      changed === 'quality' ||
      changed === 'graphicsMode' ||
      changed === 'adaptiveQuality' ||
      changed === 'dynamicResolution' ||
      changed === 'frameRate' ||
      changed === 'all'
    ) {
      if (!this.bench?.running) {
        saveSettings(s);
        this.resetAdaptive(true);
      }
    }
    if (changed === 'timeOfDay') this.rebuildViewForQuality();
    if (changed === 'camera' || changed === 'all') this.cam.mode = s.camera;
    if (changed === 'touchSize' || changed === 'touchLeftHanded' || changed === 'all') this.input.touch?.setPrefs(s.touchSize, s.touchLeftHanded);
    // Choosing touch shows the on-screen controls even on a hybrid laptop / tablet with a keyboard.
    if (changed === 'controlScheme' && s.controlScheme === 'touch' && s.touchControls === 'auto') {
      s.touchControls = 'on';
      saveSettings(s);
    }
    if (changed === 'frameRate') {
      s.frameRateChosen = true;
      saveSettings(s);
    }
    if (changed === 'reduceMotion' || changed === 'all') {
      this.cam.reduceMotion = s.reduceMotion;
      Footballer.reduceMotion = s.reduceMotion;
    }
    if (changed === 'minimap' && this.state !== 'menu') this.ui.showHud(true, s.minimap && this.mode !== 'penalties');
    if (changed === 'autoSwitch' && this.match && !this.attract) this.match.options.autoSwitch = s.autoSwitch;
    if (changed === 'masterVolume' || changed === 'sfxVolume' || changed === 'crowdVolume' || changed === 'all') this.applyVolumes();
  }

  /** Quality/time-of-day changes need the scene rebuilt (crowd density, shadows, lighting). */
  private rebuildViewForQuality(): void {
    const m = this.match;
    if (!m || !this.view) return;
    this.renderer.scene.remove(this.view.root);
    this.view.dispose();
    const preset = { ...QUALITY[this.activeQuality] };
    this.view = new MatchView(
      m,
      this.clubs,
      preset,
      this.settings.timeOfDay,
      this.characters,
      { renderer: this.renderer.renderer, surface: this.surface },
      this.settings.squad,
    );
    this.renderer.scene.add(this.view.root);
    this.applyViewEnvironment();
    this.precompile();
  }

  private applyVolumes(): void {
    const s = this.settings;
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.crowdVolume);
  }

  captureKey(cb: (code: string) => void, mouse = false): void {
    this.input.captureNextKey(cb, mouse);
  }

  capturePadButton(cb: (button: number) => void): void {
    this.input.captureNextPadButton(cb);
  }

  cancelCapture(): void {
    this.input.cancelCapture();
  }

  click(): void {
    this.audio.unlock();
    this.audio.uiClick();
  }

  /**
   * After an import or reset, reload the page: settings, progress, input bindings and the menu all start
   * cleanly from what is now saved, rather than patching every live object. (Nothing writes the old
   * in-memory settings back on unload, so the new data survives the reload.)
   */
  reloadSavedData(): void {
    location.reload();
  }

  gamepadName(): string | null {
    return this.input?.gamepadName ?? null;
  }

  private onUICommand(c: UICommand): void {
    if (this.state === 'playing') {
      if (c === 'pause') this.pause();
      else if (c === 'camera' && !this.cam.cinematic) this.cycleCamera();
      else if (c === 'reset' && this.mode === 'practice') this.match?.practiceReset();
      return;
    }
    // Menus.
    if (c === 'pause' || c === 'back') {
      if (!this.ui.back() && this.state === 'paused') this.resume();
      return;
    }
    if (c === 'navUp') this.ui.navigate('up');
    else if (c === 'navDown') this.ui.navigate('down');
    else if (c === 'navLeft') this.ui.navigate('left');
    else if (c === 'navRight') this.ui.navigate('right');
    else if (c === 'confirm') this.ui.confirm();
  }

  private cycleCamera(): void {
    const order: CameraMode[] = ['broadcast', 'dynamic', 'tactical'];
    this.settings.camera = order[(order.indexOf(this.settings.camera) + 1) % order.length];
    this.cam.mode = this.settings.camera;
    saveSettings(this.settings);
    this.ui.toast(`Camera: ${cap(this.settings.camera)}`, 1.5);
  }

  // ---------------------------------------------------------------------------
  // Events → audio / effects
  // ---------------------------------------------------------------------------

  private wireMatchEvents(m: Match): void {
    const ev = m.events;
    const quiet = () => this.attract;
    ev.on('kick', (e) => {
      if (quiet()) return;
      // Latency tracking: the kick came from the player the human was controlling this step.
      if (e.playerId === this.humanBeforeStep) {
        const k =
          e.kind === 'shot' || e.kind === 'chip' ? 'shoot' : e.kind === 'pass' ? 'pass' : e.kind === 'through' ? 'through' : e.kind === 'lob' ? 'lob' : null;
        if (k) this.diag.tracker.kicked(k, performance.now());
      }
      this.audio.kick(Math.min(1, e.speed / 28), this.screenPan(m.world.players[e.playerId].pos.x, m.world.players[e.playerId].pos.z));
      const p = m.world.players[e.playerId];
      if (p.humanControlled) this.input.vibrate(0.2 + e.power * 0.5, 0.3, 80 + e.power * 80);
      if (e.speed > 24 && (e.kind === 'shot' || e.kind === 'clear')) {
        this.cam.kick(Math.min(1, (e.speed - 22) / 10));
        this.view?.turf.emit(p.pos.x, p.pos.z, 10);
        this.crowdLevel = Math.max(this.crowdLevel, 0.75);
      }
      if (e.kind === 'shot' || e.kind === 'header' || e.kind === 'chip') this.crowdLevel = Math.max(this.crowdLevel, 0.7);
    });
    ev.on('touch', () => {
      if (!quiet()) this.audio.touch();
    });
    ev.on('bounce', (e) => {
      if (!quiet() && e.strength > 2) this.audio.bounce(e.strength);
    });
    ev.on('post', (e) => {
      if (quiet()) return;
      this.audio.post(e.strength);
      this.audio.ooh();
      this.cam.kick(0.5);
      this.input.vibrate(0.6, 0.6, 150);
    });
    ev.on('net', (e) => {
      this.view?.netImpact(e.side, e.x, e.y, e.z, e.strength);
      if (!quiet()) this.audio.net(e.strength);
    });
    ev.on('save', (e) => {
      if (quiet()) return;
      this.audio.save(e.caught);
      if (e.speed > 14) {
        this.audio.applause();
        this.crowdLevel = Math.max(this.crowdLevel, 0.8);
      }
    });
    ev.on('tackle', (e) => {
      if (quiet()) return;
      if (e.won || e.slide) this.audio.tackle();
      const t = m.world.players[e.tacklerId];
      if (e.slide) this.view?.turf.emit(t.pos.x, t.pos.z, 18, 1.4);
      if (e.victimId !== null && m.world.players[e.victimId].humanControlled) this.input.vibrate(0.7, 0.3, 160);
    });
    ev.on('whistle', (e) => {
      if (!quiet()) this.audio.whistle(e.kind);
    });
    ev.on('nearMiss', () => {
      if (!quiet()) this.audio.ooh();
    });
    ev.on('banner', (e) => {
      if (quiet()) return;
      if (e.text === 'GOAL!' && this.mode !== 'penalties') return;
      this.ui.banner(e.text, e.sub, e.kind, e.kind === 'info' ? 1.5 : 2.2);
    });
    ev.on('cut', () => {
      this.cutPending = true;
      this.cam.cut();
      if (this.view) this.view.trail.reset(this.view.ballPos);
    });
    ev.on('goal', (e) => {
      if (quiet()) return;
      // The stadium is mostly home fans: a roar for a home goal, a groan (and a small away-end cheer) otherwise.
      const homeGoal = e.team === 0;
      if (homeGoal) this.audio.roar(1);
      else {
        this.audio.groan(1);
        this.audio.roar(0.4);
      }
      this.excitement = 1;
      this.crowdLevel = 1;
      const goalX = (m.world.attackDir(e.team) * m.pitch.length) / 2;
      const c = e.team === 0 ? [this.clubs[0].primary, this.clubs[0].secondary] : [this.clubs[1].primary, this.clubs[1].secondary];
      this.view?.celebration.burst(goalX, c);
      if (this.mode !== 'penalties') {
        const scorer = e.scorerId !== null ? m.world.players[e.scorerId] : null;
        const sub = scorer ? `${scorer.name}${e.ownGoal ? ' (o.g.)' : ''} · ${Math.floor(m.minute)}'` : undefined;
        this.ui.banner('GOAL!', sub, 'goal', 3.0);
        this.celebrateTimer = 3.0;
        if (m.replayWorthy) this.pendingReplay = { at: this.time + REPLAY_AFTER };
        this.cam.cinematic = { kind: 'celebrate', t: 0 };
      }
      this.input.vibrate(1, 1, 400);
    });
    ev.on('phase', (e) => {
      if (quiet()) return;
      if (e.phase === 'replay') this.startReplay();
      if (this.cam.cinematic?.kind === 'celebrate' && celebrationShotEnds(e.phase)) {
        this.cam.cinematic = null;
        // A kick-off teleports every player, so cut. Back to open play (practice, tutorial): the
        // gameplay camera glides from the celebration shot to the ball, so nobody loses their bearings.
        if (e.phase === 'kickoff') this.cam.cut();
      }
      if (this.mode === 'penalties') {
        if (e.phase === 'penReady') {
          this.cam.cinematic = { kind: m.restart?.team === 0 ? 'penShoot' : 'penKeep' };
          this.cam.cut();
        }
      }
    });
    ev.on('fullTime', () => {
      if (quiet()) return;
      this.fullTimeTimer = 3.2;
      const [h, a] = m.score;
      if (h >= a) this.audio.cheer(h > a ? 1 : 0.6);
      else this.audio.groan(0.8);
      this.audio.applause();
      this.cam.cinematic = { kind: 'orbit', t: 0 };
    });
  }

  /**
   * Add the match that just reached full time to the local record (once), save it, and return the names
   * of achievements it unlocked for the full-time screen.
   */
  private recordFinishedMatch(m: Match): string[] {
    if (!this.matchId || this.attract) return [];
    const summary = summariseMatch(m, { id: this.matchId, team: this.clubs[0].short, opponent: this.clubs[1].short, finishedAt: new Date() });
    this.matchId = null;
    const r = recordMatch(this.progress, summary);
    this.progress = r.progress;
    saveProgress(this.progress);
    return r.unlocked.map((id: AchievementId) => achievementById(id).name);
  }

  /** The tutorial was completed without skipping a step: record it, and say so without interrupting. */
  private recordTutorial(): void {
    const r = recordTutorialCompleted(this.progress, new Date());
    this.progress = r.progress;
    saveProgress(this.progress);
    for (const id of r.unlocked) this.ui.banner('Achievement unlocked', achievementById(id).name, 'info', 4);
  }

  private labelPos = new THREE.Vector3();
  /** Project the controlled player's name onto the screen for the UI's HTML label (no allocation). */
  private updatePlayerLabel(view: MatchView): void {
    const text = this.attract ? null : view.labelText;
    if (!text) {
      this.ui.playerLabel(null, 0, 0);
      return;
    }
    const v = this.labelPos.copy(view.labelAnchor).project(this.cam.camera);
    const onScreen = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    this.ui.playerLabel(onScreen ? text : null, (v.x * 0.5 + 0.5) * 100, (0.5 - v.y * 0.5) * 100);
  }

  /** Stereo position of a world point as seen by the current camera (−1 left … 1 right), softened. */
  private screenPan(x: number, z: number): number {
    const v = this.panTmp.set(x, 0.5, z).project(this.cam.camera);
    return Math.max(-1, Math.min(1, v.x)) * 0.6;
  }
  private panTmp = new THREE.Vector3();
  /** Two random national teams for the menu's background match. */
  private attractTeams(): [TeamIdentity, TeamIdentity] {
    const a = Math.floor(Math.random() * NATIONS.length);
    let b = Math.floor(Math.random() * (NATIONS.length - 1));
    if (b >= a) b++;
    return [NATIONS[a], NATIONS[b]];
  }

  // ---------------------------------------------------------------------------
  // Benchmark (?bench / F3 → Run benchmark)
  // ---------------------------------------------------------------------------

  async runBenchmark(): Promise<unknown> {
    if (this.bench?.running) return null;
    const saved = { adaptive: this.settings.adaptiveQuality, dyn: this.settings.dynamicResolution };
    this.settings.adaptiveQuality = false;
    this.settings.dynamicResolution = false;
    this.renderer.setResolutionScale(1);
    this.ui.hide();
    this.bench ??= new Benchmark(
      {
        startScenario: async () => {
          this.launch({
            mode: 'match',
            format: this.settings.format,
            difficulty: 'medium',
            duration: 99999,
            aiOnly: true,
            replays: false,
            autoSwitch: false,
            seed: 4242,
          });
          this.ui.clearBanner();
          this.ui.hideLineups();
          this.cam.cinematic = null;
          this.cam.mode = 'broadcast';
          this.cam.cut();
          this.applyBenchViewToggles();
          await nextFrame();
          await nextFrame();
        },
        setToggles: (t) => {
          this.benchToggles = t;
          const o = this.renderer.overrides;
          for (const k of Object.keys(o) as Array<keyof typeof o>) delete o[k];
          if (t.shadows !== undefined) o.shadows = t.shadows;
          if (t.post !== undefined) o.post = t.post;
          if (t.bloom !== undefined) o.bloom = t.bloom;
          if (t.msaa !== undefined) o.msaa = t.msaa;
          if (t.pixelRatio !== undefined) o.pixelRatio = t.pixelRatio;
          this.renderer.applyOverrides();
          this.benchFrameRate = t.frameRate ?? null;
          this.clock = new FixedStepClock(1 / (t.simHz ?? 1 / SIM_DT), 14);
          this.applyBenchViewToggles();
        },
        settings: () => ({ ...this.diag.context(), format: this.settings.format, gpu: this.gpuName() }),
      },
      this.diag,
    );
    const quick = new URLSearchParams(location.search).get('bench') === 'quick';
    const report = await this.bench.run(quick ? { warmup: 800, measure: 2500 } : {});
    this.settings.adaptiveQuality = saved.adaptive;
    this.settings.dynamicResolution = saved.dyn;
    this.resetAdaptive(false);
    return report;
  }

  /**
   * Guided CPU check. JavaScript cannot read process CPU, so this runs fixed phases with a large label
   * telling the player what to read in Chrome's Task Manager (Shift+Esc: the game tab, "GPU Process",
   * "Browser") or Windows Task Manager, and records the in-game metrics for each phase alongside.
   */
  async runCpuCheck(): Promise<unknown> {
    if (this.bench?.running || this.cpuCheckRunning) return null;
    this.cpuCheckRunning = true;
    const phaseSec = 20;
    const banner = document.createElement('div');
    banner.className = 'cpu-check';
    document.body.appendChild(banner);
    const results: Array<{ phase: string; summary: unknown }> = [];
    const saved = this.settings.frameRate;
    const phases: Array<{ name: string; setup: () => void }> = [
      {
        name: 'PAUSED (match paused, menu open)',
        setup: () => {
          if (this.state === 'playing') this.pause();
        },
      },
      {
        name: `PLAYING — frame rate: ${saved}`,
        setup: () => {
          if (this.state === 'paused') this.resume();
          this.benchFrameRate = null;
        },
      },
      {
        name: 'PLAYING — frame rate: Max (every refresh)',
        setup: () => {
          if (this.state === 'paused') this.resume();
          this.benchFrameRate = 'display';
        },
      },
    ];
    try {
      if (!this.match || this.attract || this.state === 'menu') {
        this.launch({
          mode: 'match',
          format: this.settings.format,
          difficulty: 'medium',
          duration: 99999,
          aiOnly: true,
          replays: false,
          autoSwitch: false,
          seed: 4242,
        });
        this.cam.cinematic = null;
      }
      for (const ph of phases) {
        ph.setup();
        this.diag.benchmarking = true;
        await new Promise((r) => setTimeout(r, 2000));
        this.diag.reset();
        for (let t = phaseSec; t > 0; t--) {
          banner.innerHTML = `<b>CPU check · ${ph.name}</b><br>Read CPU now in Chrome Task Manager (Shift+Esc): this tab, <i>GPU Process</i>, <i>Browser</i> · ${t}s`;
          await new Promise((r) => setTimeout(r, 1000));
        }
        const sm = this.diag.summary();
        results.push({
          phase: ph.name,
          summary: {
            fps: sm.fps,
            frameMs: sm.frameMs,
            jsFrameMs: sm.jsFrameMs,
            jsBusyPct: sm.jsBusyPct,
            mainThreadBusyPctEstimate: sm.mainThreadBusyPctEstimate,
            gpuMs: sm.gpuMs,
            displayHz: sm.displayHz,
            frameLimiter: sm.frameLimiter,
            validity: sm.validity,
          },
        });
      }
    } finally {
      this.benchFrameRate = null;
      this.diag.benchmarking = false;
      this.cpuCheckRunning = false;
    }
    const report = {
      generated: new Date().toISOString(),
      note: 'Add the Task Manager CPU % you read for each phase (tab / GPU Process / Browser) when sharing.',
      results,
    };
    banner.innerHTML = `<b>CPU check done</b> — <button data-c="export">Export JSON</button> <button data-c="close">Close</button>`;
    banner.querySelector('[data-c=export]')!.addEventListener('click', () => download(`${BRAND.filePrefix}-cpucheck-${stamp()}.json`, report));
    banner.querySelector('[data-c=close]')!.addEventListener('click', () => banner.remove());
    (window as unknown as { __cpuCheck: unknown }).__cpuCheck = report;
    return report;
  }
  private cpuCheckRunning = false;

  private applyBenchViewToggles(): void {
    const t = this.benchToggles,
      v = this.view;
    if (!v) return;
    v.setCrowdVisible(t.crowd ?? true);
    v.setStadiumDetail(t.detail ?? true);
    v.freezeAnimation = t.animation === false;
    v.setSimplePlayers(!!t.simplePlayers);
    this.ui.showHud(t.hud ?? true, (t.hud ?? true) && this.settings.minimap);
  }

  private gpuName(): string {
    try {
      const gl = this.renderer.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    } catch {
      return 'unknown';
    }
  }
  private clock = new FixedStepClock(SIM_DT, 14);
  private cutPending = false;
  private humanBeforeStep: number | null = null;
  private passTargetTimer = 0;
  private passTargetId = -1;
  private passTargetPos = { x: 0, z: 0 };

  private startReplay(): void {
    const frames = this.replayFrames ?? this.replayBuf?.last(Math.round((REPLAY_BEFORE + REPLAY_AFTER) * REPLAY_RATE)) ?? [];
    this.replayFrames = null;
    if (frames.length < 10) {
      this.match?.endReplay();
      return;
    }
    this.replay = new ReplayDirector(frames, REPLAY_RATE);
    // The replay shows the build-up: live-celebration confetti/fireworks must not hang over it.
    this.view?.celebration.clear();
    this.cam.cinematic = { kind: 'replay', angle: this.replayAngle++, t: 0 };
    this.cam.cut();
    this.ui.clearBanner();
  }

  private endReplay(): void {
    this.replay = null;
    this.cam.cinematic = null;
    this.match?.endReplay();
    this.cam.cut();
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  /** Raw rAF intervals (s) for estimating the display refresh, and a scratch copy for sorting. */
  private rafDeltas = new Float32Array(120);
  private rafSorted = new Float32Array(120);
  private rafN = 0;
  private lastRaf = 0;
  private sinceRender = 0;
  /** Seconds of game work in the previous callback (0 when the limiter skipped it). */
  private lastWorkS = 0;
  /** Display refresh estimate (see {@link estimateRefresh}); assumed 60 Hz until measured. */
  readonly refresh: RefreshEstimate = { dt: REFRESH_FALLBACK_DT, measured: false };
  /** Estimated display refresh interval (s). */
  get refreshDt(): number {
    return this.refresh.dt;
  }

  /** Target interval between rendered frames for the frame-rate setting (an even multiple of the refresh). */
  private benchFrameRate: Settings['frameRate'] | null = null;
  /** 'auto' frame rate: how many divisor steps below the top rate we currently are (0 = top). */
  private autoStep = 0;
  private targetFrameDt(): number {
    return frameIntervalFor(this.refreshDt, this.benchFrameRate ?? this.settings.frameRate, this.autoStep);
  }

  private loop = (t: number): void => {
    requestAnimationFrame(this.loop);
    // Display refresh estimate from rAF intervals. Only intervals after a cheap callback count: after a
    // heavy one, the interval measures this device's speed, not the screen's.
    const raw = this.lastRaf ? (t - this.lastRaf) / 1000 : 0;
    this.lastRaf = t;
    const clean = this.lastWorkS < raw * 0.5;
    this.lastWorkS = 0;
    if (raw > 0 && raw < 0.2 && clean) {
      this.rafDeltas[this.rafN++ % this.rafDeltas.length] = raw;
      // Re-estimate every 30 samples (≈0.13 s at 240 Hz) so fast displays are paced evenly almost at once.
      if (this.rafN % 30 === 0) {
        const n = Math.min(this.rafN, this.rafDeltas.length);
        const sorted = this.rafSorted.subarray(0, n);
        sorted.set(this.rafDeltas.subarray(0, n));
        sorted.sort();
        estimateRefresh(sorted, n, this.refresh, this.refresh);
      }
    }
    // Frame-rate limiter: skip whole vsyncs so frames stay evenly paced (e.g. 72 fps on 144 Hz).
    this.sinceRender += raw;
    if (this.sinceRender + this.refreshDt * 0.5 < this.targetFrameDt()) return;
    let dt = this.sinceRender;
    this.sinceRender = 0;
    if (!(dt > 0)) dt = 0;
    const tStart = performance.now();
    this.diag.frame(Math.min(dt, 0.25));
    this.rawFrameDt = dt; // real interval, for performance tracking (the game itself uses the clamped dt)
    dt = Math.min(dt, 0.1);
    this.time += dt;
    try {
      this.frame(dt);
    } catch (err) {
      console.error(err);
    }
    const workMs = performance.now() - tStart;
    this.lastWorkS = workMs / 1000;
    this.diag.frameEnd(workMs);
  };

  private frame(dt: number): void {
    this.lastDt = dt;
    const m = this.match,
      view = this.view;
    if (!m || !view || !this.cur || !this.prev) return;
    const P = performance;
    let tp = P.now();
    const axes = this.cam.groundAxes();
    const input = this.input.poll(axes.fwd, axes.right);
    this.input.frame.aim = this.computeAim();
    this.diag.add('input', P.now() - tp);
    this.diag.display.hz = Math.round(1 / this.refreshDt);
    this.diag.display.measured = this.refresh.measured;
    this.diag.display.setting = this.benchFrameRate ?? this.settings.frameRate;
    this.diag.display.targetFps = Math.round(1 / this.targetFrameDt());
    // Real-input latency tracking (only for the human-controlled player in live play).
    {
      const h = m.human,
        ev = this.input.events,
        tr = this.diag.tracker;
      if (h && !this.attract && this.state === 'playing') {
        if (ev.moveChanged) tr.moveInput(ev.t, input.move.x, input.move.z, h.vel.x, h.vel.z);
        for (const a of ev.presses) if (a === 'pass' || a === 'shoot' || a === 'through' || a === 'lob' || a === 'switch') tr.buttonDown(a, ev.t);
        for (const a of ev.releases) if (a === 'pass' || a === 'shoot' || a === 'through' || a === 'lob' || a === 'switch') tr.buttonUp(a, ev.t);
      }
    }

    const running = this.state === 'playing' || this.state === 'menu' || this.state === 'fulltime';
    let renderA = this.prev,
      renderB = this.cur,
      alpha = 0;

    if (this.replay && m.phase !== 'replay') {
      // The match moved on (e.g. restarted): never leave a stale replay on screen.
      this.replay = null;
      this.cam.cinematic = null;
      this.cam.cut();
    }
    if (this.replay) {
      const anyAction = Object.values(input.buttons).some((b) => b.pressed);
      consumeEdges(input);
      const v = this.replay.update(dt, anyAction);
      if (!v) {
        this.endReplay();
      } else {
        renderA = v.a;
        renderB = v.b;
        alpha = v.alpha;
        // Cut to the behind-the-goal angle for the finish.
        const c = this.cam.cinematic;
        if (c?.kind === 'replay') c.t = (v.index - v.strikeIndex) / REPLAY_RATE;
      }
    } else if (running) {
      const tSim = performance.now();
      SIM_PROFILE.enabled = this.diag.detailed;
      SIM_PROFILE.aiMs = 0;
      const humanInput = this.attract ? null : input;
      const prev = this.prev,
        cur = this.cur;
      const { steps, alpha: a } = this.clock.advance(dt, () => {
        prev.copyFrom(cur);
        this.cutPending = false;
        this.humanBeforeStep = m.humanId;
        m.step(this.clock.stepDt, humanInput);
        if (humanInput) consumeEdges(humanInput);
        this.lab?.afterStep(this.clock.stepDt);
        if (humanInput && m.human) {
          const now = performance.now();
          if (m.humanId !== this.humanBeforeStep) this.diag.tracker.switched(now);
          this.diag.tracker.simStep(now, m.human.vel.x, m.human.vel.z);
        }
        cur.capture(m);
        // A restart/teleport happened this step: don't interpolate across it.
        if (this.cutPending) prev.copyFrom(cur);
        this.stepCount++;
        if (this.stepCount % 2 === 0 && m.phase !== 'replay') this.replayBuf?.push(m);
        return !!this.replay;
      });
      alpha = a;
      const simMs = performance.now() - tSim;
      this.perf.sim = this.perf.sim * 0.95 + simMs * 0.05;
      this.perf.steps = steps;
      this.diag.frameSim(simMs, steps);
      this.diag.add('ai', SIM_PROFILE.aiMs);
      renderA = this.prev;
      renderB = this.cur;
      // Capture replay footage shortly after a goal.
      if (this.pendingReplay && this.time >= this.pendingReplay.at) {
        this.pendingReplay = null;
        this.replayFrames = this.replayBuf?.last(Math.round((REPLAY_BEFORE + REPLAY_AFTER) * REPLAY_RATE)) ?? null;
      }
      this.tutorial?.update(dt, input);
      if (this.tutorial?.finished && this.tutorial.skippedSteps === 0 && !this.progress.tutorialCompleted) this.recordTutorial();
    } else {
      consumeEdges(input);
    }

    // Interpolate positions for this frame *before* the camera follows them.
    tp = P.now();
    view.interpolate(renderA, renderB, alpha);
    this.diag.add('interp', P.now() - tp);
    this.diag.frameInterp(alpha, view.snapsLastFrame, this.replay ? 'replay' : running ? 'live' : 'paused');

    // Camera.
    const human = m.human;
    const focus = human && !this.attract ? view.playerPos[human.id] : null;
    if (this.cam.cinematic?.kind === 'intro') {
      this.introTimer -= dt;
      const skip = Object.values(input.buttons).some((b) => b.down) || Math.hypot(input.move.x, input.move.z) > 0.3;
      if (this.introTimer <= 0 || skip) {
        this.cam.cinematic = null;
        this.ui.hideLineups();
        this.audio.cheer(0.5);
        if (skip) this.cam.cut();
      }
    }
    if (this.cam.cinematic?.kind !== 'intro') this.ui.hideLineups();
    if (this.cam.cinematic?.kind === 'celebrate') {
      this.celebrateTimer -= dt;
    }
    const subject = m.lastScorer !== null ? view.playerPos[m.lastScorer] : null;
    tp = P.now();
    this.cam.update(dt, {
      ball: view.ballPos,
      ballVel: view.ballVel,
      focus,
      attackDir: m.world.attackDir(0),
      subject,
      players: view.playerPos,
      lineup: view.homeLineup,
    });
    this.diag.add('camera', P.now() - tp);
    tp = P.now();
    if (this.cam.cuts !== this.camCuts) {
      this.camCuts = this.cam.cuts;
      this.diag.cameraCut();
    }
    {
      const cp = this.cam.camera.position,
        aim = this.cam.aim;
      this.diag.camera(
        cp.x,
        cp.y,
        cp.z,
        aim.x,
        aim.z,
        view.ballPos.x,
        view.ballPos.z,
        dt,
        this.cam.camera.fov,
        this.cam.cinematic ? this.cam.cinematic.kind : this.cam.mode,
      );
    }

    // Pass target hint.
    this.passTarget = null;
    if (
      human &&
      !this.attract &&
      m.world.controllerId === human.id &&
      (m.phase === 'playing' || m.phase === 'restart' || m.phase === 'kickoff') &&
      this.mode !== 'penalties'
    ) {
      const ml = Math.hypot(input.move.x, input.move.z);
      const dx = ml > 0.2 ? input.move.x : Math.cos(human.facing);
      const dz = ml > 0.2 ? input.move.z : Math.sin(human.facing);
      // The pass-target search evaluates every team-mate's lane: refresh it at 30 Hz, not every frame.
      this.passTargetTimer -= dt;
      if (this.passTargetTimer <= 0) {
        this.passTargetTimer = 1 / 30;
        this.passTargetId = pickPassTarget(m.world, human, dx, dz, m.pitch.length * 0.6)?.id ?? -1;
      }
      if (this.passTargetId >= 0) {
        this.passTargetPos.x = view.playerPos[this.passTargetId].x;
        this.passTargetPos.z = view.playerPos[this.passTargetId].z;
        this.passTarget = this.passTargetPos;
      }
    }

    // Crowd dynamics: louder when the ball is near a goal.
    const bx = view.ballPos.x / (m.pitch.length / 2);
    const nearGoal = Math.max(0, Math.abs(bx) - 0.55) / 0.45;
    this.crowdLevel = Math.max(0.25 + nearGoal * 0.35, this.crowdLevel - dt * 0.12);
    this.excitement = Math.max(0, this.excitement - dt * 0.18);
    this.wave = this.state === 'menu' || this.state === 'fulltime' ? 1 : 0;
    this.audio.setCrowdIntensity(this.attract ? 0.22 : this.crowdLevel);
    this.audio.update(dt);
    this.diag.add('game', P.now() - tp);

    const tView = performance.now();
    const penAim = this.mode === 'penalties' && !this.attract && m.phase === 'penReady' && m.restart?.team === 0 ? m.penAim : null;
    view.render(
      renderA,
      renderB,
      alpha,
      dt,
      {
        humanId: m.humanId,
        passTarget: this.passTarget,
        penAim,
        time: this.time,
        showIndicator: !this.attract && !this.replay && m.phase !== 'goal' && m.phase !== 'fullTime' && this.mode !== 'penalties',
      },
      this.cam.camera,
      Math.max(this.excitement, this.attract ? 0.05 : 0),
      this.wave,
    );
    const tRender = performance.now();
    this.diag.add('anim', view.animMs);
    this.diag.add('scene', tRender - tView - view.animMs);
    this.diag.gpuBegin();
    this.renderer.render(this.cam.camera);
    this.diag.gpuEnd();
    const tDone = performance.now();
    this.perf.view = this.perf.view * 0.95 + (tRender - tView) * 0.05;
    this.perf.render = this.perf.render * 0.95 + (tDone - tRender) * 0.05;
    this.diag.add('shadow', this.renderer.shadowMs);
    this.diag.add('render', tDone - tRender - this.renderer.shadowMs);
    this.diag.resolutionScale = this.renderer.resolutionScale;
    this.diag.frameSubmitted();
    this.diag.tracker.frameSubmitted(tDone);
    tp = P.now();
    // Touch controls: visible during live play on touch devices (or when forced on).
    if (this.input.touch) {
      const wantTouch = this.settings.touchControls === 'on' || (this.settings.touchControls === 'auto' && TouchControls.isTouchDevice());
      const live = wantTouch && this.state === 'playing' && !this.attract && !this.replay && !this.bench?.running;
      this.input.touch.show(live);
      this.input.touchActive = live;
      document.body.classList.toggle('touch-ui', live);
      if (live) this.input.touch.setDefending(!!m.world.controller && m.world.controller.team !== 0);
    }
    if (!this.attract) this.updateHud(input);
    this.updatePlayerLabel(view);
    this.ui.update(dt);
    this.diag.add('ui', P.now() - tp);
    if (this.fullTimeTimer > 0) {
      this.fullTimeTimer -= dt;
      if (this.fullTimeTimer <= 0 && this.state === 'playing') {
        this.state = 'fulltime';
        this.input.gameplayActive = false;
        this.ui.showHud(false, false);
        const goals = m.goalLog.map((g) => ({
          team: g.team,
          minute: g.minute,
          ownGoal: g.ownGoal,
          scorer: g.scorerId !== null ? m.world.players[g.scorerId].name : 'Unknown',
        }));
        const unlocked = this.recordFinishedMatch(m);
        this.ui.showFullTime(this.clubs, [m.score[0], m.score[1]], m.winner, m.stats, this.mode, goals, m.options.difficulty, unlocked);
      }
    }
    this.trackPerformance(this.rawFrameDt);
  }

  private aimRay = new THREE.Raycaster();
  private aimNdc = new THREE.Vector2();
  private aimHit = new THREE.Vector3();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private aimOut = { x: 0, z: 0 };
  private computeAim(): { x: number; z: number } | null {
    const ndc = this.input.mouseNDC;
    if (!ndc) return null;
    this.aimNdc.set(ndc.x, ndc.y);
    this.aimRay.setFromCamera(this.aimNdc, this.cam.camera);
    if (!this.aimRay.ray.intersectPlane(this.aimPlane, this.aimHit)) return null;
    this.aimOut.x = this.aimHit.x;
    this.aimOut.z = this.aimHit.z;
    return this.aimOut;
  }

  private updateHud(input: ReturnType<InputManager['poll']>): void {
    const m = this.match!;
    const s = this.settings;
    const h = m.human;
    const b = input.buttons;
    let power: { label: string; value: number } | null = null;
    if (this.mode === 'penalties') {
      if (m.phase === 'penReady' && m.restart?.team === 0 && b.shoot.down)
        power = { label: m.penPower > 0.85 ? 'Power — too much risks blazing it over!' : 'Power (60–80% is ideal)', value: m.penPower };
    } else if (h && !this.replay) {
      const charging = (['shoot', 'pass', 'through', 'lob'] as const).find((k) => b[k].down && b[k].held > 0.08);
      if (charging) {
        const labels = { shoot: 'Shot power', pass: 'Pass', through: 'Through ball', lob: 'Lob / cross' };
        power = { label: labels[charging], value: chargeToPower(b[charging].held, charging === 'shoot' ? 0.2 : 0.1) };
      }
    }
    let hint: string | null = null;
    const k = (a: keyof Settings['bindings']) => bindHtml(s, a);
    if (this.mode === 'penalties') {
      if (m.phase === 'penReady' && m.restart?.team === 0)
        hint = `Aim with ${k('left')}${k('right')} ${k('up')}${k('down')} (outside the frame misses) · hold ${k('shoot')} for power, release to shoot`;
      if (m.restart?.team === 1) {
        // Keeper cues: timing only — never where the ball is going. Watch the run-up for the side.
        const info = m.penaltyInfo();
        const dive = `${k('left')}/${k('right')} + any action button`;
        if (m.phase === 'penReady') hint = `You're in goal · watch the shooter's run-up, then dive with ${dive}`;
        else if (m.phase === 'penRunup') hint = info.timeToStrike < 0.35 ? `<b class="cue">Get ready…</b> ${dive}` : `Watch the run-up · dive with ${dive}`;
        else if (m.phase === 'penFlight' && m.phaseTime < 0.35) hint = `<b class="cue now">DIVE!</b>`;
      }
    } else if ((m.phase === 'restart' || m.phase === 'kickoff') && h && m.restart?.takerId === h.id) {
      const what = { kickoff: 'Kick-off', throwIn: 'Throw-in', corner: 'Corner', goalKick: 'Goal kick', freeKick: 'Free kick', penalty: 'Penalty' }[
        m.restart.type
      ];
      // Only name controls this scheme has (touch has no lob while attacking, for example).
      const opt = (a: keyof Settings['bindings'], label: string) => (controlAvailable(s, a) ? [`${k(a)} ${label}`] : []);
      const options =
        m.restart.type === 'penalty' || m.restart.type === 'freeKick'
          ? [...opt('shoot', 'shoot'), ...opt('pass', 'pass'), ...opt('lob', 'cross')]
          : [...opt('pass', 'pass'), ...opt('lob', 'lob'), ...(m.restart.type === 'kickoff' ? [] : opt('through', 'through'))];
      hint = `${what} — ${options.join(' · ')}`;
    } else if (this.mode === 'practice' && !this.tutorial) {
      hint = controlAvailable(s, 'reset') ? `Practice · ${k('reset')} reset ball · ${k('pause')} menu` : `Practice · ${k('pause')} menu`;
    }
    const clock = this.mode === 'match' ? `${String(Math.floor(m.minute)).padStart(2, '0')}'` : this.mode === 'practice' ? 'PRACTICE' : 'PENS';
    const roleNames: Record<string, string> = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
    // FPS readout (opt-in with ?fps).
    this.ui.updateHud({
      teams: this.clubs,
      colors: this.view!.colors,
      score: m.score,
      clock,
      player: h ? { name: `${h.number}  ${h.name}`, role: roleNames[h.role], stamina: h.stamina } : null,
      power,
      hint,
      fps: this.showFps ? this.fpsShown : null,
      pens: this.mode === 'penalties' ? m.penKicks : null,
      replay: !!this.replay,
    });
    // Minimap at ~20 Hz with a reused data array.
    this.minimapTimer -= this.lastDt;
    if (s.minimap && this.mode !== 'penalties' && this.view && this.minimapTimer <= 0) {
      this.minimapTimer = 0.05;
      const v = this.view;
      const mp = this.minimapData;
      mp.length = m.pitch.length;
      mp.width = m.pitch.width;
      mp.colors = v.colors;
      for (const p of m.world.players) {
        const e = mp.players[p.id] ?? (mp.players[p.id] = { x: 0, z: 0, team: 0, human: false, gk: false });
        e.x = v.playerPos[p.id].x;
        e.z = v.playerPos[p.id].z;
        e.team = p.team;
        e.human = p.humanControlled;
        e.gk = p.isGK;
      }
      mp.players.length = m.world.players.length;
      mp.ball.x = v.ballPos.x;
      mp.ball.z = v.ballPos.z;
      this.ui.drawMinimap(mp);
    }
  }

  private fpsAcc = 0;
  private fpsCount = 0;
  private rawFrameDt = 0;
  /** Adaptive performance (adaptive.ts): resolution, quality level and frame-rate target. */
  private adaptive: AdaptiveController | null = null;
  /** Quality preset currently rendered (in Auto mode it can differ from the last saved one mid-match). */
  private activeQuality: Quality = 'high';

  private adaptiveOptions(): AdaptiveOptions {
    const s = this.settings;
    const auto = s.graphicsMode === 'auto';
    const fr = this.benchFrameRate ?? s.frameRate;
    const R = this.refreshDt;
    return {
      autoLevel: auto || s.adaptiveQuality,
      topLevel: auto ? 0 : levelIndexFor(s.quality),
      dynamicResolution: s.dynamicResolution,
      autoFrameRate: fr === 'auto',
      maxFpsStep: fr === 'auto' ? autoFrameSteps(R) : 0,
      fpsAt: (step) => 1 / frameIntervalFor(R, 'auto', step),
    };
  }

  /**
   * (Re)start adaptation from the current settings. `calibrate` = a short start-up calibration (1 s
   * windows, faster decisions) — on launch and when the player changes graphics settings.
   */
  private resetAdaptive(calibrate: boolean): void {
    this.autoStep = 0;
    this.adaptive = new AdaptiveController({ level: levelIndexFor(this.settings.quality), resScale: 1, fpsStep: 0 }, this.adaptiveOptions(), calibrate ? 8 : 0);
    this.applyAdaptiveState(true);
  }

  /** Push the controller's state to the renderer. Never restarts the match (a preset change rebuilds the view only). */
  private applyAdaptiveState(force = false): void {
    const a = this.adaptive;
    if (!a) return;
    const lvl = LADDER[a.state.level];
    const r = this.renderer;
    const o = r.overrides;
    for (const k of Object.keys(o) as Array<keyof typeof o>) delete o[k];
    if (lvl.overrides.bloom !== undefined) o.bloom = lvl.overrides.bloom;
    if (lvl.overrides.msaa !== undefined) o.msaa = lvl.overrides.msaa;
    if (force || lvl.quality !== this.activeQuality) {
      const rebuild = lvl.quality !== this.activeQuality;
      this.activeQuality = lvl.quality;
      r.applyQuality(lvl.quality, this.cam.camera);
      if (rebuild) this.rebuildViewForQuality();
    } else {
      r.applyOverrides();
    }
    r.setResolutionScale(a.state.resScale);
    this.perf.resolutionScale = r.resolutionScale;
    this.autoStep = a.state.fpsStep;
  }

  private trackPerformance(dt: number): void {
    TeamBrain.explain = this.diag.enabled; // AI decision reasons only while the F3 panel is open
    this.fpsAcc += dt;
    this.fpsCount++;
    if (this.fpsAcc >= 2) {
      this.fpsShown = Math.round(this.fpsCount / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsCount = 0;
    }
    const a = this.adaptive;
    if (!a || this.bench?.running || document.hidden) return;
    a.opts = this.adaptiveOptions();
    // The frame's own work (CPU). Frame times show GPU-bound cases (they miss the target regardless).
    const cost = this.perf.sim + this.perf.view + this.perf.render;
    const d = a.frame(dt, this.targetFrameDt(), cost);
    if (!d.changed) return;
    this.applyAdaptiveState();
    if (d.kind === 'level') {
      a.interrupt(); // the rebuild frame isn't representative
      if (this.settings.graphicsMode === 'auto') {
        // Remember where Auto settled so the next launch starts there.
        if (this.settings.quality !== LADDER[a.state.level].quality) {
          this.settings.quality = LADDER[a.state.level].quality;
          saveSettings(this.settings);
        }
      } else if (d.direction === 'down' && this.state === 'playing') {
        this.ui.toast(`Graphics lowered to ${LADDER[a.state.level].name} to keep the game smooth`, 3);
      }
    }
  }

  /** Dev overlay: the most recent AI ball-carrier decision, the reason, and the runners-up. */
  private aiDecisionText(): string | null {
    TeamBrain.explain = this.diag.enabled; // reasons are only built while the panel is open
    const m = this.match;
    if (!m || !this.diag.enabled) return null;
    let d: DecisionInfo | null = null;
    for (const b of m.brains) for (const x of b.lastDecision.values()) if (!d || x.time > d.time) d = x;
    if (!d || m.world.time - d.time > 6) return 'no recent decision';
    const alt = d.options
      .filter((o) => o.label !== d!.label || o.utility !== d!.utility)
      .slice(0, 3)
      .map((o) => `${o.label} ${o.utility.toFixed(2)}`)
      .join(' · ');
    return (
      `${d.team === 0 ? 'home' : 'away'} #${d.playerId} → ${d.label} (${d.utility.toFixed(2)}) at ${Math.round((d.progress + 1) * 50)}% up the pitch, pressure ${d.pressure.toFixed(1)} m\n` +
      `why: ${d.why ?? '—'}\nalternatives: ${alt || '—'}`
    );
  }

  /** Short status for the graphics settings tab. */
  graphicsStatus(): string {
    const a = this.adaptive;
    if (!a) return '';
    const fps = Math.round(1 / this.targetFrameDt());
    return `${a.calibrating ? 'Calibrating… ' : ''}Now: ${LADDER[a.state.level].name} · ${Math.round(a.state.resScale * 100)}% resolution · ${fps} fps target`;
  }
}

const PITCH_PLACEHOLDER = {
  length: 66,
  width: 42,
  goalWidth: 6.4,
  goalHeight: 2.3,
  goalDepth: 1.8,
  penaltyAreaDepth: 12,
  penaltyAreaWidth: 25,
  goalAreaDepth: 4,
  goalAreaWidth: 12,
  centerCircleRadius: 7,
  penaltySpot: 9.5,
  cornerArcRadius: 1,
  postRadius: 0.06,
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
