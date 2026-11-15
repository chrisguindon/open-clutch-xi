# Testing

**Audience:** everyone changing code.

`npm run ci` runs everything CI runs:
- formatting
- lint
- type check
- tests
- production build
- licence, repository, docs and GitHub-config checks

Use `npm test` for the tests alone.

## Layers

| Layer | Where | What it covers |
|---|---|---|
| Unit | `tests/*.test.ts` | Pure functions: rules (`rules.ts`), adaptive controller, bindings and migrations, celebrations, pass and shot evaluation, statistics and achievements (`progress.test.ts`), saved data and export/import (`storage.test.ts`, `progress.test.ts`), team composition and animation retargeting (`inclusive-players.test.ts`) |
| Architecture | `tests/inclusive-players.test.ts` | Boundaries that must hold: nothing in `src/sim/` imports rendering, settings or appearance code, so appearance can never change gameplay |
| Scenario | `tests/rules.test.ts`, `ai-decisions.test.ts`, `controls.test.ts`, `behaviour.test.ts` | Players placed by hand, then a check of what happens. Synthetic `kick`, `ballTouch` and `foul` events give precise rule scenarios. |
| Simulation | `tests/match.test.ts`, `gameplay-metrics.test.ts`, the AI audit in `ai-decisions.test.ts` | Whole AI-vs-AI matches on fixed seeds: no soft-locks, sensible statistics, irrational-decision rates |
| Perf | `tests/perf*.test.ts` | Simulation ms per step, allocation, pose sampler. These run **after** the rest, on their own (`npm test` handles it), because parallel simulations distort wall-clock timings. |
| Browser | `scripts/*-check.mjs`, `scripts/browser-smoke.mjs` | Real gameplay in headless Chromium with real keyboard and mouse input. Software rendering, so frame rates mean nothing. |

**Browser checks:**

| Command | What it does |
|---|---|
| `npm run test:browser` | Smoke test across all modes |
| `npm run check:rules` | Restarts: throw-in prevention, celebrations and kick-off |
| `npm run check:controls` | The control chooser, mouse buttons, rebinding, and an *emulated* controller |
| `npm run check:adaptive` | Adaptive quality on emulated slow and fast devices |
| `npm run check:tutorial` | The tutorial bot |
| `npm run check:mobile` | Phone emulation |
| `npm run check:prod` | The production build and CSP |

They need a browser. The browser is chosen in this order (`scripts/lib/chrome.mjs`):
1. `CHROME_PATH`, if set;
2. the project's pinned **Chrome for Testing**;
3. an installed Chrome, Chromium or Edge.

The reproducible option is the pinned browser:

```bash
npm run browsers:install   # once: downloads Chrome for Testing into .cache/browsers/ (ignored by Git)
```

It's the exact build the locked `puppeteer-core` version is made for, the same in every environment, and nothing is installed system-wide. Run it again after updating `puppeteer-core`; it picks up the new build. On a minimal Linux system Chrome may also need shared libraries (on Debian or Ubuntu, for example `libnss3` and `libgbm1`); install them with your package manager. `npm run release:check` locates the browser before it starts and fails at once, with these instructions, if there is none.

## Determinism and noise

- **Simulations are deterministic** for a seed. A failing seed always reproduces.
- **Gameplay statistics are noisy.** A single 3-minute match varies by ±30% in shots and goals, and pass completion by about ±0.05 between two matches. Judge balance changes over 30+ seeds:
  - `npm run metrics` for gameplay metrics;
  - `npm run report:ai` for the AI decision audit (irrational decisions, pass-estimate calibration);
  - `npm run report:penalties` for penalty outcome rates.

  Guardrail tests compare only robust signals (for example, ball control by difficulty).
- **Don't tune to a single seed.**

## Emulation is not real-device testing

Touch, controllers (`navigator.getGamepads` overridden), slow devices and high refresh rates are emulated in automated checks. Say so in pull requests. Real-device checks are listed in [playtesting.md](playtesting.md).

## Writing tests

- Prefer pure functions with direct tests. For gameplay, build a minimal scenario with `makeMatch`/`clearPitch` (`tests/helpers.ts`) or the helpers in `tests/rules.test.ts`.
- Name tests after the behaviour, in plain words, for example *"the thrower cannot walk or run with the ball before throwing"*.
- Give long simulations an explicit timeout (`it(..., 60000)`).
- Regression tests should fail before the fix: try breaking the code temporarily.
