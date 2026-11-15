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
 * Match audio, two layers:
 * - Recorded CC0 samples (Freesound; see docs/governance/third-party-assets.md): stadium ambience loop, goal roar, cheer,
 *   groan, "ooh", applause, referee whistles and ball kicks.
 * - Procedural Web Audio synthesis for everything, used as the fallback whenever a sample is missing
 *   (offline, decode failure, file not shipped) and for sounds with no recording (touches, posts, nets).
 * Dynamic mix: crowd intensity drives the ambience level and brightness (a low-pass opens as the crowd
 * gets louder), whistles and the goal roar duck the bed, and one-shots get pitch/level variation.
 */
export type SampleName = 'ambience' | 'goal' | 'cheer' | 'groan' | 'ooh' | 'applause' | 'whistle_long' | 'whistle_short' | 'kick1' | 'kick2';
export const SAMPLE_NAMES: SampleName[] = ['ambience', 'goal', 'cheer', 'groan', 'ooh', 'applause', 'whistle_long', 'whistle_short', 'kick1', 'kick2'];

export class AudioEngine {
  private samples = new Map<SampleName, AudioBuffer>();
  private loading: Promise<number> | null = null;
  private ambGain: GainNode | null = null;
  private ambFilter: BiquadFilterNode | null = null;
  private duck!: GainNode;
  private rand = Math.random;
  /** Synthesised murmur oscillators (stopped once the recorded ambience is playing — saves audio-thread CPU). */
  private murmur: OscillatorNode[] = [];
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private crowdBus!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private chantGain!: GainNode;
  private noise!: AudioBuffer;
  private intensity = 0.25;
  private targetIntensity = 0.25;
  private volumes = { master: 0.8, sfx: 0.9, crowd: 0.7 };
  private lastKick = 0;
  private lastTouch = 0;
  private crowdRunning = false;
  private chantTimer = 8;

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.crowdBus = ctx.createGain();
    this.duck = ctx.createGain();
    this.crowdBus.connect(this.duck).connect(this.master);
    this.noise = this.makeNoise(4);
    this.applyVolumes();
  }

  /** Fetch and decode the recorded samples (after unlock). Resolves to how many loaded; missing ones fall back to synthesis. */
  loadSamples(base: string): Promise<number> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(0);
    if (this.loading) return this.loading;
    this.loading = Promise.all(
      SAMPLE_NAMES.map(async (n) => {
        try {
          const res = await fetch(`${base}${n}.mp3`);
          if (!res.ok) throw new Error(String(res.status));
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.samples.set(n, buf);
          if (n === 'ambience' && this.crowdRunning) this.startAmbience();
        } catch (err) {
          console.warn(`Audio sample "${n}" unavailable, using synthesis:`, err);
        }
      }),
    ).then(() => this.samples.size);
    return this.loading;
  }

  /** Which sounds are currently recorded rather than synthesised (diagnostics / tests). */
  get sampleCount(): number {
    return this.samples.size;
  }

  /** Play a sample; returns false if it isn't loaded (caller falls back to synthesis). */
  private play(name: SampleName, opts: { gain?: number; rate?: number; pan?: number; dest?: AudioNode; when?: number; offset?: number } = {}): boolean {
    const ctx = this.ctx,
      buf = this.samples.get(name);
    if (!ctx || !buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    let node: AudioNode = src.connect(g);
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      node = node.connect(p);
    }
    node.connect(opts.dest ?? this.sfx);
    src.start(opts.when ?? ctx.currentTime, opts.offset ?? 0);
    return true;
  }

  /** Briefly lower the crowd bed so a whistle / roar cuts through. */
  private duckCrowd(depth: number, hold: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime,
      g = this.duck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - depth, t, 0.03);
    g.setTargetAtTime(1, t + hold, 0.35);
  }

  /** Recorded ambience loop under the synthesised bed; level and brightness follow crowd intensity. */
  private startAmbience(): void {
    const ctx = this.ctx,
      buf = this.samples.get('ambience');
    if (!ctx || !buf || this.ambGain) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Skip MP3 encoder padding at the loop seam.
    src.loopStart = 0.03;
    src.loopEnd = buf.duration - 0.03;
    this.ambFilter = ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 2500;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0;
    src.connect(this.ambFilter).connect(this.ambGain).connect(this.crowdBus);
    src.start(ctx.currentTime, this.rand() * buf.duration * 0.8);
    for (const o of this.murmur) {
      try {
        o.stop();
        o.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.murmur = [];
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  setVolumes(master: number, sfx: number, crowd: number): void {
    this.volumes = { master, sfx, crowd };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.volumes.crowd, t, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // Pinkish noise (Paul Kellet's economy filter).
      let b0 = 0,
        b1 = 0,
        b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }
    return buf;
  }

  /** Start the continuous stadium crowd ambience. */
  startCrowd(): void {
    const ctx = this.ctx;
    if (!ctx || this.crowdRunning) return;
    this.crowdRunning = true;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 700;
    this.crowdFilter.Q.value = 0.5;
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 300;
    low.gain.value = 6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    src.connect(this.crowdFilter).connect(low).connect(this.crowdGain).connect(this.crowdBus);
    src.start();
    // Murmur layer: many detuned voices through vowel formants.
    this.chantGain = ctx.createGain();
    this.chantGain.gain.value = 0;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 600;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1100;
    f2.Q.value = 4;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    for (let i = 0; i < 10; i++) {
      const o = ctx.createOscillator();
      this.murmur.push(o);
      o.type = 'sawtooth';
      o.frequency.value = 150 + Math.random() * 160;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.2 + Math.random() * 0.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 6 + Math.random() * 8;
      lfo.connect(lfoGain).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(f1);
      g.connect(f2);
      o.start();
      lfo.start();
      this.murmur.push(lfo);
    }
    f1.connect(mix);
    f2.connect(mix);
    mix.connect(this.chantGain).connect(this.crowdBus);
    this.crowdGain.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5);
    this.startAmbience();
  }

  /** 0..1 how excited the crowd is (attacks, chances). */
  setCrowdIntensity(v: number): void {
    this.targetIntensity = Math.max(0.12, Math.min(1, v));
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.crowdRunning) return;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 1.2);
    const t = ctx.currentTime;
    const wobble = 0.9 + Math.sin(t * 0.7) * 0.06 + Math.sin(t * 1.9) * 0.04;
    // With the recorded bed playing, the synthetic noise drops to a thin "size of the stadium" layer.
    const synth = this.ambGain ? 0.3 : 1;
    this.crowdGain.gain.setTargetAtTime((0.28 + this.intensity * 0.75) * wobble * synth, t, 0.2);
    if (this.ambGain && this.ambFilter) {
      this.ambGain.gain.setTargetAtTime(0.75 + this.intensity * 0.9, t, 0.4);
      this.ambFilter.frequency.setTargetAtTime(1800 + this.intensity * 9000, t, 0.4);
    }
    this.crowdFilter.frequency.setTargetAtTime(500 + this.intensity * 900, t, 0.3);
    this.chantGain.gain.setTargetAtTime(0.05 + this.intensity * 0.12, t, 0.5);
    // Occasional rhythmic chant swell.
    this.chantTimer -= dt;
    if (this.chantTimer <= 0) {
      this.chantTimer = 10 + Math.random() * 14;
      this.chant();
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.002, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    src
      .connect(f)
      .connect(g)
      .connect(dest ?? this.sfx);
    src.start(t, Math.random() * 3);
    src.stop(t + attack + dur + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.003, peak, dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  kick(power: number, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastKick < 0.03) return;
    this.lastKick = t;
    const p = Math.max(0.2, Math.min(1, power));
    if (this.play(this.rand() < 0.5 ? 'kick1' : 'kick2', { gain: 0.45 + p * 0.55, rate: 1.12 - p * 0.22 + (this.rand() - 0.5) * 0.08, pan })) {
      // Recorded strike plus a little synthesised weight for powerful shots.
      if (p > 0.6) this.tone(t, 'sine', 120, 45, 0.16, (p - 0.6) * 0.9);
      return;
    }
    this.tone(t, 'sine', 140 + p * 40, 45, 0.14 + p * 0.06, 0.5 + p * 0.5);
    this.noiseBurst(t, 0.03 + p * 0.03, 'highpass', 1800, 0.7, 0.25 + p * 0.45);
    this.noiseBurst(t, 0.08, 'bandpass', 500, 1.2, 0.2 * p);
  }

  touch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastTouch < 0.08) return;
    this.lastTouch = t;
    this.tone(t, 'sine', 110, 60, 0.07, 0.16);
    this.noiseBurst(t, 0.02, 'bandpass', 1400, 1, 0.05);
  }

  bounce(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = Math.min(1, strength / 10);
    this.tone(ctx.currentTime, 'sine', 90, 50, 0.1, 0.12 + s * 0.3);
  }

  post(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = Math.min(1, strength / 15);
    const partials = [523, 1247, 2210, 3360, 4730];
    partials.forEach((f, i) => this.tone(t, 'sine', f, f * 0.995, 0.9 - i * 0.12, (0.25 / (i + 1)) * (0.4 + s)));
    this.noiseBurst(t, 0.04, 'highpass', 3000, 1, 0.4 * s);
  }

  net(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = Math.min(1, strength / 15);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(3500, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    const g = ctx.createGain();
    this.env(g, t, 0.01, 0.15 + s * 0.4, 0.4);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + 0.5);
  }

  save(caught: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 'sine', 120, 50, 0.15, 0.5);
    this.noiseBurst(t, caught ? 0.06 : 0.04, 'bandpass', caught ? 1200 : 2000, 1.2, 0.5);
  }

  tackle(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 'sine', 80, 40, 0.18, 0.4);
    this.noiseBurst(t, 0.12, 'lowpass', 600, 0.7, 0.35);
  }

  whistle(kind: 'short' | 'long' | 'final'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    if (this.samples.has('whistle_short') && this.samples.has('whistle_long')) {
      this.duckCrowd(0.35, kind === 'final' ? 1.8 : 0.6);
      if (kind === 'short') this.play('whistle_short', { gain: 0.6, rate: 0.98 + this.rand() * 0.04 });
      else if (kind === 'long') this.play('whistle_long', { gain: 0.6 });
      else {
        this.play('whistle_short', { gain: 0.6, when: t0 });
        this.play('whistle_short', { gain: 0.6, when: t0 + 0.45 });
        this.play('whistle_long', { gain: 0.65, when: t0 + 0.9 });
      }
      return;
    }
    const blasts =
      kind === 'final'
        ? [
            [0, 0.35],
            [0.5, 0.35],
            [1.0, 1.1],
          ]
        : kind === 'long'
          ? [[0, 0.9]]
          : [[0, 0.28]];
    for (const [start, dur] of blasts) {
      const t = t0 + start;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
      g.gain.setValueAtTime(0.32, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const trem = ctx.createGain();
      trem.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 28;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.3;
      lfo.connect(lfoG).connect(trem.gain);
      for (const f of [2650, 2790]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(trem);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
      trem.connect(g).connect(this.sfx);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
      this.noiseBurst(t, dur, 'bandpass', 2700, 2, 0.06, 0.02);
    }
  }

  /** Big goal roar: swelling noise + many voices. */
  roar(scale = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.targetIntensity = 1;
    if (this.play('goal', { gain: 1.1 * scale, rate: 0.97 + this.rand() * 0.06, dest: this.crowdBus })) {
      this.duckCrowd(0.25, 3);
      this.play('cheer', { gain: 0.5 * scale, when: t + 1.2, dest: this.crowdBus });
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.6;
    f.frequency.setValueAtTime(600, t);
    f.frequency.linearRampToValueAtTime(1500, t + 0.6);
    f.frequency.linearRampToValueAtTime(900, t + 5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.4 * scale, t + 0.35);
    g.gain.setValueAtTime(1.4 * scale, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    src.connect(f).connect(g).connect(this.crowdBus);
    src.start(t);
    src.stop(t + 6.2);
    this.voices(t, 'aah', 4.5, 0.5 * scale);
    this.targetIntensity = 1;
  }

  /** Near miss: "ooooh" falling in pitch. */
  ooh(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.play('ooh', { gain: 0.85, rate: 0.95 + this.rand() * 0.1, dest: this.crowdBus })) return;
    this.voices(ctx.currentTime, 'ooh', 1.8, 0.45);
    this.noiseBurst(ctx.currentTime, 1.4, 'bandpass', 500, 0.8, 0.5, 0.15, this.crowdBus);
  }

  /** Applause-like patter after saves / good play. */
  applause(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.play('applause', { gain: 0.6, rate: 0.96 + this.rand() * 0.08, dest: this.crowdBus })) return;
    this.noiseBurst(ctx.currentTime, 1.6, 'highpass', 2500, 0.5, 0.35, 0.1, this.crowdBus);
  }

  /** Home crowd deflated (conceded / big miss). */
  groan(scale = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.play('groan', { gain: 0.9 * scale, rate: 0.96 + this.rand() * 0.08, dest: this.crowdBus })) return;
    this.voices(ctx.currentTime, 'ooh', 2.2, 0.35 * scale);
  }

  /** Crowd cheer (kick-off, full-time win, great save). */
  cheer(scale = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.play('cheer', { gain: 0.7 * scale, dest: this.crowdBus })) return;
    this.voices(ctx.currentTime, 'aah', 2.5, 0.35 * scale);
  }

  private chant(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // A rhythmic "clap-clap-clapclapclap" chant.
    const t = ctx.currentTime;
    const pattern = [0, 0.4, 0.8, 1.0, 1.2];
    for (let r = 0; r < 3; r++) {
      for (const p of pattern) {
        this.noiseBurst(t + r * 1.8 + p, 0.08, 'bandpass', 1800, 1.2, 0.18, 0.005, this.crowdBus);
      }
    }
  }

  private voices(t: number, vowel: 'ooh' | 'aah', dur: number, peak: number): void {
    const ctx = this.ctx!;
    const [fa, fb] = vowel === 'ooh' ? [380, 850] : [750, 1250];
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = fa;
    f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = fb;
    f2.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f1.connect(g);
    f2.connect(g);
    g.connect(this.crowdBus);
    for (let i = 0; i < 14; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const base = 140 + Math.random() * 220;
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * (vowel === 'ooh' ? 0.75 : 1.05), t + dur);
      const og = ctx.createGain();
      og.gain.value = 0.05;
      o.connect(og);
      og.connect(f1);
      og.connect(f2);
      o.start(t + Math.random() * 0.1);
      o.stop(t + dur + 0.1);
    }
  }

  uiClick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.tone(ctx.currentTime, 'triangle', 880, 660, 0.06, 0.12);
  }

  uiConfirm(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 'triangle', 660, 660, 0.08, 0.12);
    this.tone(t + 0.07, 'triangle', 990, 990, 0.12, 0.12);
  }
}
