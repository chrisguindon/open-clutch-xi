# 0003. Use one adaptive controller for resolution, quality and frame rate

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

Players use everything from phones to 240 Hz desktops. Earlier, dynamic resolution and a quality governor acted independently. The governor never raised quality again after a slowdown, and both were fed a frame time that was capped at 100 ms, so very slow devices were never adapted.

## Decision

A single pure controller, `AdaptiveController` (`src/game/adaptive.ts`), decides everything from real frame intervals:
- **Measurement:** 2 s windows (1 s during an 8 s start-up calibration), judged on the median and p90 frame time and the game's own frame cost.
- **Stepping down, in this order:**
  1. on high-refresh screens, the frame-rate target (an even divisor of the refresh, at least ~55 fps);
  2. resolution to 85%;
  3. the quality ladder;
  4. resolution to 65%;
  5. finally, the frame-rate target again, never below 30 fps.
- **Recovery** happens in reverse order, one step at a time, after sustained headroom.
- **Anti-flapping:** hysteresis, cooldowns, and an exponential back-off for steps that recently failed.
- **Graphics → Auto** is the default. Manual presets act as a ceiling.

## Rationale

- One owner means no fighting between mechanisms.
- A pure, deterministic controller can be tested against simulated device profiles (`tests/adaptive.test.ts`). Those tests found a real oscillation before release.
- Changing quality rebuilds the view, never the match.

## Consequences

- Real-device behaviour still needs measuring by people (F3 → *Run benchmark*). Emulated checks only cover the logic.
- New quality features should join the ladder rather than add a separate adaptive mechanism.
