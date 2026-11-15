# Performance

**Audience:** contributors working on rendering, animation, the simulation or adaptive quality.

Goal: smooth, responsive play from phones to high-refresh desktops, without raising minimum requirements. See [ADR 0003](../architecture/decisions/0003-adaptive-rendering.md) for the adaptive design.

## Frame pacing

- **Frame limiter.** The game renders on whole multiples of the measured display refresh interval (`frameIntervalFor`, `src/game/frames.ts`), so frames are evenly paced. The refresh rate is estimated from the 10th percentile of raw `requestAnimationFrame` intervals, and settles after about 30 frames (`estimateRefresh`). Only intervals after cheap callbacks count, and slow readings (30–48 Hz) only when they're as regular as a real screen's. On a device too slow to measure the screen, the last good estimate is kept, or 60 Hz is assumed, and the F3 overlay says *(assumed)*. Otherwise the device's own low frame rate would be mistaken for the screen's refresh.
- **Frame-rate settings:**

  | Setting | Behaviour |
  |---|---|
  | **Auto** (default) | Every refresh up to ~165 Hz; an even divisor above that (120 fps on 240 Hz). May step down to 30 fps on weak devices. |
  | **Max** | Every refresh (the performance mode) |
  | **60** | About 60 fps |
  | **30** | About 30 fps |

- **CPU scales with frame rate.** Main-thread work is roughly per-frame cost × frames per second. Rendering every refresh at 240 Hz costs about three times the main-thread time of 60 fps. That's why Auto caps around 120–165 fps on high-refresh screens.

## Adaptive quality

`AdaptiveController` (`src/game/adaptive.ts`) steps through, in order:
1. high-refresh frame rate (≥ ~55 fps);
2. resolution to 85%;
3. the quality ladder: Ultra → High → High (no bloom) → Medium → Medium (lean) → Low → Low (lean);
4. resolution to 65%;
5. frame rate down to 30.

It recovers in reverse order. Decisions use 2 s windows (median and p90) with hysteresis, cooldowns and back-off. Quality changes rebuild the view, never the match. The F3 overlay shows the level, the target and the reason for each adjustment.

**Quality presets** (`QUALITY`, `src/render/renderer.ts`):

| Preset | Pixel ratio | Shadows | Bloom | AO | Crowd | Night fill lights |
|---|---|---|---|---|---|---|
| Low | 1 (1.3 on touch screens) | off | off | off | 4,000 | 1 |
| Medium | 1.25 | 1024 | on | off | 9,000 | 1 |
| High | 1.5 | 2048 | on | off | 16,000 | 3 |
| Ultra | 2 | 4096 | on | GTAO | 24,000 | 3 |

All presets render through the composer, with MSAA in the render target (the WebGL context itself has no MSAA) and one output pass for tone mapping and grade.

## Budgets (60 fps = 16.7 ms; mid-range desktop, 11v11, High)

| Section | ms per frame |
|---|---|
| Simulation (2 steps, incl. AI ≈ 0.8) | 1.5 |
| Animation | 1.5 |
| Scene update | 1.0 |
| Shadow pass (CPU) | 1.0 |
| Render submit (CPU) | 3.0 |
| Input, interpolation, camera, game logic, HUD | ≈ 0.9 |
| **Total game JavaScript** | **≤ 8** |
| GPU | ≤ 10 |

These are profiling targets, not guarantees. The F3 overlay marks sections over budget with `!`.

## What keeps it fast (decisions worth preserving)

- **One shared skeleton per player.** Each player's meshes share bone matrices instead of recomputing them per mesh.
- **Baked pose sampler** instead of `THREE.AnimationMixer`. Clips are baked to typed arrays and blended without allocation. The mixer was the largest source of garbage. It matches the mixer within 0.4° (`npm run check:anim`).
- **Full-rate animation out to 75 m.** Only very distant players animate at reduced rate; half-rate far players caused visible foot sliding.
- **Normalised blend weights.** Missing weight otherwise blends towards the T-pose and lifts arms during transitions.
- **Static batching** of the stadium, by material. Hair casts no shadows. Night fill-light shadows are instanced decals.
- **Allocation discipline.** `core/math.hyp()` instead of `Math.hypot` (which boxes its arguments in V8). Typed arrays for analysis data. Pooled pose inputs. The HUD writes to the DOM only when values change.
- **Throttled extras.** The pass-target search runs at 30 Hz and the minimap redraws at 20 Hz.
- **Shader precompilation** when a match is built, so the first goal doesn't hitch.
- **Bloom only for things meant to shine.** The bloom threshold sits above white (`BLOOM_THRESHOLD` in `renderer.ts`), so lamps and flares glow and lit surfaces don't. A low threshold made boards, kits and the sunlit pitch glow, washing out the picture. Bloom costs the same either way; this is about readability, not speed.
- **The name label is HTML,** positioned with a CSS transform each frame (no layout), not a sprite in the scene: sharp text, no bloom, no extra draw call.
- **Hair shares the body's skeleton,** including on the second body (one corrected bind matrix), so it adds no per-frame skeleton work.

## Measuring

| Tool | Use |
|---|---|
| **F3** or `?diag` | Live frame times (p50/p95/p99), hitches, per-section CPU against budget, GPU timer (where supported), draw calls, heap, long tasks, input latency, adaptive state, the AI's latest decision. *Export JSON* saves a report. |
| `?bench` / F3 → *Run benchmark* | A fixed-seed match, repeated with one system changed at a time (shadows, post-processing, bloom, MSAA, crowd, detail, animation, simulation rate, pixel ratio, HUD, frame rate). Rows disturbed by focus loss are marked ⚠. |
| F3 → *CPU check* | Guided phases (paused, playing, playing at Max), to read alongside the browser's task manager. Chrome's task manager reports per-core percentages; Windows Task Manager reports a share of all cores. |
| `npm run bench:cpu` | Deterministic CPU micro-benchmark of the production build |
| `npm run check:fluidity`, `check:refresh`, `check:adaptive` | Loop and interpolation under jittered timing; frame limiter on emulated refresh rates; adaptive control on emulated slow and fast devices |

**Rules for measurements:**
- Headless checks use software rendering, so they validate logic, not real performance.
- Benchmark and diagnostics exports describe your hardware. They're git-ignored and blocked by `npm run check:repo`; don't commit them or attach them to public issues unless a maintainer asks.
- In documentation, describe hardware generically.

## Constraints

- The simulation stays at 120 Hz (see [ADR 0001](../architecture/decisions/0001-deterministic-fixed-timestep-simulation.md)).
- No allocations in per-step or per-frame hot paths.
- New effects must join the quality ladder (and the benchmark toggles) rather than add a separate adaptive mechanism.
