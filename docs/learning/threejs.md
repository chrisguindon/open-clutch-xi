# Learning guide: 3D rendering with Three.js

**You'll learn:** how the game draws a stadium, 22 animated players and a crowd of thousands in a browser, and keeps it smooth on modest hardware. **Prerequisites:** the [game loop](game-loop.md) guide; no 3D experience needed. **Read alongside:** `src/render/renderer.ts`, `src/render/matchView.ts`, `src/render/stadium.ts`, `src/render/characters/`.

## The basic pieces

Three.js organises a 3D picture into:
- a **scene**: a tree of objects (meshes, lights, cameras);
- **meshes**: geometry (triangles) plus a material (how the surface responds to light);
- a **camera**: where we look from;
- a **renderer**: draws the scene from the camera into a `<canvas>` using WebGL2.

`src/render/renderer.ts` creates the `WebGLRenderer` with ACES filmic tone mapping (a film-like response to bright floodlights), shadows, and an `EffectComposer` that adds multisample anti-aliasing and a colour-grading pass.

## Simulation in, pictures out

The renderer never asks the simulation anything. It only reads **`Frame` snapshots** (plain typed arrays: positions, facing, animation state, gesture codes; see `PF` in `src/game/frames.ts`). `MatchView` interpolates two frames and moves the 3D objects to match. This one-way flow is why replays are easy: a replay is just older frames from a ring buffer.

## Characters

- Two CC0 base bodies (`player.glb`, `player_f.glb`) sharing one 65-joint skeleton, each with three **levels of detail** (fewer triangles when far away). Small per-body corrections let one set of animation clips drive both (`retargetFor` in `clipSampler.ts`).
- **Skinned animation:** a skeleton of 65 joints deforms the mesh. Recorded clips are **baked** into typed arrays at 30 fps, and `PoseSampler` blends them with no per-frame allocation (`src/render/characters/clipSampler.ts`). The standard Three.js `AnimationMixer` allocates as it runs, which causes stutter at 22 players.
- **Procedural layers** on top of the clips: the kicking foot, tackles, keeper dives, leaning into turns, celebration gestures. The simulation decides these; the renderer only poses them.
- **Kits are drawn by a shader** (`kitMaterial.ts`), which works out shirt, shorts and socks from each point's height on the body. One material covers every team's colours, patterns, names and numbers.

## Posing an arm: two-bone inverse kinematics

Recorded clips can't know where a player's hand should go for a fist pump or a keeper's reach, so `Footballer.armPose()` solves it. Given the shoulder S, the target T and the two bone lengths *a* (upper arm) and *b* (forearm), the elbow lies at distance x = (a² − b² + d²) / 2d along S→T, and h = √(a² − x²) out from that line, on the side we want the elbow to point. Aim the upper arm at the elbow, then the forearm at the hand, and the arm bends naturally. Ask for a target closer than one arm length, or the elbow locks straight: that was exactly why the old celebrations looked robotic.

## Post-processing: tone mapping and bloom

The scene is rendered in **high dynamic range** (values above 1.0 allowed) into an off-screen buffer, then post-processed (`renderer.ts`):
- **Bloom** blurs everything brighter than a threshold and adds it back as glow.
- **Tone mapping** (ACES) squeezes the high range into what a screen can show.
- **Colour grading** gives each time of day its look.

Order matters. Bloom runs *before* tone mapping, on HDR values, where a sunlit pitch and lit advertising boards are well above 1.0. So the threshold must be above white (1.6 here), or everything bright glows and the picture looks washed out. Text that must stay crisp, such as the player name, isn't drawn in the 3D scene at all: it's HTML on top.

## Drawing a lot, cheaply

The GPU is fast, but each **draw call** (a request to draw one object) costs CPU time.

- **Static batching:** the stands are merged into a few big meshes.
- **Instancing:** the crowd is thousands of camera-facing billboards (2 triangles each), drawn in a handful of draw calls. They're animated in the vertex shader (bobbing, jumping, the wave). This replaced 3D fans that cost about a million triangles.
- **Scratch objects:** temporary `Vector3`s and `Quaternion`s are created once at module level and reused (`const vA = new THREE.Vector3()`), never `new` inside a frame.
- **Shader precompilation:** every effect is compiled when the match loads, so the first goal doesn't freeze while confetti's shader compiles.

## Adaptive quality

`src/game/adaptive.ts` watches frame times and moves up and down a **quality ladder** (resolution, shadows, effects, crowd density). It's a small pure state machine, so it's unit-tested with simulated slow and fast devices. See [ADR 0003](../architecture/decisions/0003-adaptive-rendering.md).

## Fallbacks

If a model, texture or sound fails to load, the game uses a procedural mannequin (`playerModel.ts`), procedural grass or a synthesised sound. A missing file never stops a match.

## Try it

- **Exercise B3** changes a time-of-day colour.
- **Exercise I3** adds a quality-ladder step with a test.

Both are in [exercises](exercises.md).
