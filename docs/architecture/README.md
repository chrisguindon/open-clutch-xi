# Architecture

**Audience:** contributors who want to understand how the game fits together before changing it.

Open Clutch XI strictly separates a **deterministic football simulation** (pure TypeScript, no DOM or Three.js) from **presentation** (rendering, audio, UI). The simulation runs headless in tests at thousands of steps per second. The renderer only ever reads compact `Frame` snapshots of it.

Significant decisions are recorded as [architecture decision records](decisions/README.md).

## Source layout

```
src/
├── brand.ts         the game's name and identity, in one place
├── core/            math (Vec2/Vec3, allocation-free hyp), seeded RNG, typed event emitter
├── sim/             ← deterministic simulation, no browser APIs
│   ├── config.ts        pitch sizes per format, physics constants, formations, AI difficulty profiles
│   ├── ball.ts          ball physics, trajectory predictor, pass-speed solvers
│   ├── player.ts        player state, locomotion, actions, commands
│   ├── world.ts         physics step: actions, kicks, dribbling, control, tackles, saves, collisions
│   ├── match.ts         game modes, Laws of the Game, restarts, clock, stats, switching, shootout
│   ├── rules.ts         rules profiles (Standard / Arcade), offside, foul severity, sanctions
│   ├── officials.ts     referee and assistants: positioning and signals (display only)
│   ├── celebration.ts   context-based goal celebrations and reactions
│   ├── human.ts         device-agnostic input → commands, with pass/shot assistance
│   ├── nations.ts, teams.ts   the 54 national teams, kits, generated names
│   └── ai/
│       ├── situation.ts     shared per-tick analysis (ball prediction, interception times, threats)
│       ├── evaluate.ts      positional value, shot quality, pass success, clearance targets
│       ├── tactics.ts       formation → positions, steering, restart context types
│       ├── teamBrain.ts     role assignment, utility AI for the ball carrier, restarts
│       └── goalkeeper.ts    keeper positioning, reactions, dives, sweeping, distribution
├── render/          ← Three.js presentation
│   ├── renderer.ts      WebGL2 renderer, quality presets, post-processing
│   ├── matchView.ts     binds Frames to the scene: interpolation, characters, officials, effects
│   ├── characters/      skinned footballers (two bodies), baked pose sampler, kit shader, team composition
│   ├── camera.ts        gameplay and cinematic cameras, occlusion and collision
│   ├── stadium.ts, environment.ts, effects.ts, textures.ts
│   └── playerModel.ts   procedural fallback rig (when character assets fail to load)
├── input/           ← keyboard, mouse, Gamepad API, touch controls, rebinding
├── audio/           ← CC0 samples with a synthesised Web Audio fallback for every sound
├── ui/              ← plain-DOM menus, HUD, settings, accessibility announcements
├── game/            ← orchestration
│   ├── game.ts          frame loop, event wiring, replays, cameras
│   ├── frames.ts        fixed-step clock, frame limiter, render snapshots, replay buffer
│   ├── adaptive.ts      adaptive quality controller (pure, tested with simulated devices)
│   ├── settings.ts      persisted settings, control schemes, bindings, migrations
│   ├── storage.ts       the only module that touches localStorage (fallbacks, recovery copies)
│   ├── progress.ts      local statistics and match history; achievements.ts; saveData.ts (export/import/reset)
│   ├── diagnostics.ts   F3 overlay, benchmark and CPU-check support
│   └── tutorial.ts      interactive tutorial driven by real gameplay events
└── dev/             ← movement lab, AI decision audit, penalty simulator, tuning helpers
```

## The frame

`Game.frame()` runs on `requestAnimationFrame`, paced by the frame limiter (see [performance](../development/performance.md)):

1. **Input.** `InputManager.poll()` merges keyboard, mouse, gamepad and touch into one `InputFrame`. Press and release edges accumulate until a simulation step consumes them, so taps shorter than a frame are never lost.
2. **Fixed-step simulation** at **120 Hz** (`SIM_DT`, `FixedStepClock`). Each step: `match.step()`, then the state is captured into a `Frame`. Catch-up is capped, so a stalled tab can't spiral.
3. **Interpolation.** `MatchView.interpolate()` blends the last two frames, so motion is smooth at 60, 144 or 240 Hz. Physically impossible jumps (teleports at restarts) snap instead of smearing.
4. **Camera** follows those interpolated positions, integrated in ≤4 ms sub-steps so its path doesn't depend on frame rate.
5. **Scene update and render.** Animation, effects, officials and the HUD. Then the adaptive controller reviews the frame time.

Why a fixed 120 Hz step: see [ADR 0001](decisions/0001-deterministic-fixed-timestep-simulation.md).

## Simulation

- **Ball** (`ball.ts`). Gravity, quadratic drag and the Magnus force, so shots curl and topspin dips. Bounces convert friction into spin. Rolling deceleration has a closed form, which `groundPassSpeed()` and `groundTravelTime()` invert so passes arrive at the intended distance and speed. Posts are capsule colliders and the net is a damped volume.
- **Ball control.** The ball is never glued to a player. Dribbling is a series of touches taken on the forward-stepping foot. The gait phase lives in the simulation, so the animation's foot plants match real touches. First touches are directional and sized to settle the ball. Steals need an *exposed* ball and are blocked by shielding. Intercepting a pass meant for someone else is a speed-dependent skill. Tackles are judged on timing, angle, exposure and shielding.
- **Locomotion.** Acceleration falls off near top speed. Turn rate depends on speed (14 rad/s walking, 3.6 rad/s sprinting). Reversals at speed plant first. Human-controlled players brake and turn faster than AI players, but have the same top speed, so foot races stay fair.
- **World step order:** actions → locomotion → player separation → kick contact → control and dribbling → ball physics → keeper saves → tackles → deflections. Every ball contact goes through one choke point (`markTouch` → `ballTouch` event) that the rules use.
- **Match** (`match.ts`). The phase machine is `kickoff → playing ↔ stoppage → restart`, `goal → replay → kickoff`, `fullTime`, with `penReady → penRunup → penFlight → penResult` for shootouts. Inside it runs the Laws of the Game: ball out of play, goals and direct-goal rules, offside, fouls with advantage and cards, restart positioning and the restart stage machine. See [Football rules](../gameplay/FOOTBALL_RULES.md) and [ADR 0005](decisions/0005-rules-engine-and-officials.md).
- **Determinism.** All randomness flows through a seeded `Rng`. The same seed and inputs give identical matches, and tests rely on it.

## AI

`Situation` runs every other step. It predicts 3.2 s of ball flight and computes every player's earliest time to the ball. `TeamBrain` assigns roles each tick:
- **Own ball:** carrier, supporters, runners, shape.
- **Opponent ball:** presser, cover, markers, zonal shape.
- **Loose ball:** chasers.
- **Restarts:** takers and positioning.

The carrier chooses by **utility scoring**, and each option carries its reasons for the F3 overlay. Difficulty changes cognition and accuracy only, never speed. See [AI and difficulty](../gameplay/ai-and-difficulty.md) and [ADR 0006](decisions/0006-explainable-utility-ai.md).

## Rendering

- **WebGL2 and Three.js**, with custom physics and no UI framework. See [ADR 0002](decisions/0002-custom-physics-webgl2-plain-dom.md).
- **Characters.** Two CC0 base bodies (women's and men's, the same skeleton) with three LODs, shader-drawn kits (patterns, names, numbers, crests) and per-player variation in height, build, skin tint and hair.
  - **Animation.** Recorded clips are baked to 30 fps typed arrays and blended by `PoseSampler` (`characters/clipSampler.ts`) with no per-frame allocation. Clip time and weights come straight from the simulation, which adds no input delay.
  - **Procedural layers.** Kicks (correct foot, shared `KICK_TIMING`), tackles, headers, keeper reach and dives, strafing, celebration gestures, and officials' signals.
  - See [Animation](../gameplay/animation.md).
- **Stadium and environment.** Statically batched stands, an instanced billboard crowd, floodlight towers shared by the lights and the environment map, per-time-of-day grading, a procedural pitch with CC0 turf detail.
- **Quality and frame pacing** are adaptive. See [ADR 0003](decisions/0003-adaptive-rendering.md) and [performance](../development/performance.md).
- **Every external asset has a fallback:** procedural mannequins, procedural grass and synthesised sound.

## Presentation: cameras, replays, audio

- **Cameras** (`src/render/camera.ts`): Broadcast, Dynamic and Tactical gameplay cameras keep a fixed orientation per mode, so controls stay consistent. There are also cinematic cameras for the intro line-up, celebrations, replays and penalties.
  - **Smoothing** is integrated in ≤4 ms sub-steps, so the camera path doesn't depend on frame rate.
  - **Dynamic camera:** follows a smoothed anchor between the controlled player and the ball.
  - **Broadcast zoom:** tightens when play is compact around the ball, and widens for spread-out play or fast balls, within a clamped range.
  - **Safety rules** (`tests/camera.test.ts`):
    - low cameras rise when a player stands between them and the ball (occlusion);
    - a final push-out keeps the camera outside every player body (collision);
    - cameras stay inside the stadium bowl.
- **Replays** (`src/game/replay.ts`): see [modes](../gameplay/modes.md#replays). The replay view is letterboxed with a wipe, the HUD is cleared, and confetti is removed.
- **Audio** (`src/audio/audio.ts`): CC0 samples, with a synthesised Web Audio version of every sound used automatically if a file fails to load.
  - Crowd excitement opens a filter and raises the ambience.
  - Whistles and the goal roar **duck** the crowd.
  - Kicks are panned to the ball's screen position.
- **Crowd:** thousands of instanced camera-facing billboards animated in the vertex shader (bobbing, jumping, the wave). This replaced 3D fans that had cost about a million triangles.
- **Shader precompilation:** when a match is built, the game compiles every effect (including hidden ones like confetti), so the first goal doesn't hitch.

## Input

Devices produce one device-agnostic `InputFrame`. Bindings map keys and mouse buttons (`Mouse0`–`Mouse4`) and controller buttons to actions, per control scheme. See [Controls](../gameplay/controls.md) and [ADR 0004](decisions/0004-device-agnostic-input.md).

## Extending

- **New rule:** see [Adding or changing a rule](../gameplay/FOOTBALL_RULES.md#adding-or-changing-a-rule).
- **New mode:** add a `GameMode`, the roster and setup in `Match.createPlayers()` and `setup*()`, and its per-phase logic in `step()`. The UI only needs a menu entry calling `startMatch(mode)`.
- **New formation:** add slots to `FORMATIONS` in `sim/config.ts`. Both teams use the same formation, which keeps matches fair.
- **Tuning:**
  - physics: `BALL`, `PLAYER`, `GK`, `MOVE`
  - AI: `AI_PROFILES` and the utility terms in `teamBrain.ts`
  - penalties: `PEN_TUNING`

  Measure tuning changes with many seeds (see [testing](../development/testing.md)).

## Known architectural limitations

- **Single player.** Human vs computer only. Commands are already separate from devices, so local multiplayer would mainly need a second `InputFrame` routed to team 1.
- **Replays record players and the ball.** Officials are hidden during replays.
- **Two base bodies, few faces.** Women, men and mixed squads use two CC0 base bodies with shared animations. Facial variety is limited to skin tone, hair and eyebrows.
- **No half-time or change of ends** (see the rules matrix).
