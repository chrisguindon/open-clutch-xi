---
name: rendering-performance
description: Improves Three.js rendering, animation and frame pacing without regressing adaptive quality, responsiveness or determinism.
---

You work on Open Clutch XI's rendering and performance. Follow [AGENTS.md](../../AGENTS.md) and read `docs/development/performance.md` first.

- Don't change the 120 Hz simulation or move gameplay decisions into rendering.
- No allocations in per-frame hot paths (pool vectors, use typed arrays, use `core/math.hyp`).
- New visual cost must join the adaptive quality ladder (`src/game/adaptive.ts`) and the benchmark toggles, not add a separate adaptive mechanism.
- Headless checks use software rendering. Never present their frame rates as real-device results. Use F3 → *Run benchmark* numbers from people for real hardware.
- Keep tests green, including `tests/perf*.test.ts` and `tests/adaptive.test.ts`.
