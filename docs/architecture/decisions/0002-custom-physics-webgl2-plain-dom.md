# 0002. Use custom physics, WebGL2 with Three.js, and a plain-DOM UI

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

The game needs believable ball physics, a 3D stadium, and a few UI screens. It must run in any current browser, load quickly, and stay easy for learners to read.

## Decision

- **Physics:** a bespoke integrator for one sphere against capsules, planes and a net volume (`src/sim/ball.ts`, `world.ts`). No physics engine.
- **Rendering:** Three.js on **WebGL2** with the EffectComposer stack. Not WebGPU, yet.
- **UI:** plain DOM and CSS, no framework.

## Rationale

- **Physics.** The problem is small and specific. A custom integrator is deterministic, has no WASM payload, and makes game-feel tuning direct. Closed-form rolling lets passes be solved exactly.
- **WebGL2.** Shader hooks (pitch, crowd, kits) and mature post-processing work everywhere on WebGL2. WebGPU would mean rewriting them, for no measurable benefit at this scene size.
- **No framework.** A few screens and a HUD keep the game bundle small. It's also easy for newcomers to follow.

## Consequences

- Physics behaviour is ours to test. `tests/ball.test.ts` covers drag, Magnus, bounces, posts and the net.
- A move to WebGPU would be a dedicated project (TSL shaders).
