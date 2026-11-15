# 0001. Run a deterministic 120 Hz fixed-step simulation, separate from rendering

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

The game must feel the same on 30, 60, 144 and 240 Hz displays. It must be testable without a browser, and AI behaviour and tuning must be reproducible. Football feel depends on small timings: dribble touches, kick contact, tackle windows.

## Decision

- The simulation (`src/sim/`) is pure TypeScript with no DOM or Three.js. It advances in fixed steps of 1/120 s (`SIM_DT`), driven by `FixedStepClock`. Catch-up is capped after long stalls.
- All randomness uses a seeded `Rng`.
- The renderer reads `Frame` snapshots and interpolates between the last two. Physically impossible moves (teleports) snap instead of blending.

## Rationale

- **Determinism.** The same seed and inputs give the same match. That makes simulation tests, AI audits over many seeds, and replays possible.
- **120 rather than 60 Hz.** A 60 Hz simulation failed the dribble close-control tests, while 120 Hz costs about 0.25 ms per step (≈3% of one core).
- **Interpolation** gives smooth motion at any refresh rate, without tying physics to the display.

## Consequences

- Everything visible must come from frame data. For example, animation time comes from the simulation, so animation adds no input delay.
- Hot paths must avoid allocations: there are up to 2–4 steps per frame.
- Web Workers were rejected: the simulation is cheap and latency-critical, and rendering must stay on the main thread.
