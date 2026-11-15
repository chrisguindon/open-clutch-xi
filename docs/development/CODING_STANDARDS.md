# Coding standards

**Audience:** everyone writing code for Open Clutch XI, human or AI-assisted. The rules for contributing (tests, documentation, commits) are in [AGENTS.md](../../AGENTS.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md). This page covers how the code itself is written, and why.

The project is **educational**: newcomers read this code to learn. A clear solution beats a clever one, and a comment that explains a football or engineering idea is worth more than one that restates a line.

## Where these conventions come from

We compared three established sources and kept what suits a small, readable, performance-sensitive game:

| Source | What we adopt | Where we differ, and why |
|---|---|---|
| **TypeScript project's own coding guidelines** (written for contributors to the compiler) | PascalCase for types, classes and enums; camelCase for functions, variables and members; no `I` prefix on interfaces; one concept per file; arrow functions for callbacks | The TypeScript project prefers `undefined` and avoids `null`. We use **`null` for "explicitly nothing"** in simulation state (for example `heldBy: number \| null`) because it survives JSON (saves, frames, tests) and reads clearly in football terms ("no one holds the ball"). `undefined` means "not provided" (optional fields). |
| **Three.js conventions** (library source and examples) | Import from `three` and `three/addons/…`; PascalCase classes; reuse `Vector3`, `Quaternion` and `Matrix4` scratch objects instead of allocating; call `dispose()` on geometries, materials and textures you create | None: Three.js's performance habits match ours (see [performance](performance.md)) |
| **typescript-eslint** recommended configurations | `recommended`, plus two type-aware rules that catch real bugs: `no-floating-promises` and `no-misused-promises` | We don't enable the full `recommended-type-checked` or `strict` presets. Measured on this code base, they reported mostly redundant assertions and style issues, at roughly double the lint time. |

Formatting is Prettier's job (`.prettierrc`: single quotes, 160 columns, trailing commas). Don't argue style in reviews; run `npm run format`.

## Language and compiler

- **Strict TypeScript** (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noFallthroughCasesInSwitch`). Don't loosen `tsconfig.json`.
- **`unknown` at trust boundaries** (stored data, URL parameters, messages), narrowed by a validator. `any` is a warning in game code, and allowed in tests and dev tools.
- **Non-null assertions (`!`)** are allowed when an invariant guarantees the value (for example, a controller exists during a restart). Prefer a guard when it doesn't.
- **Interfaces for object shapes, type aliases for unions.** String-literal unions (`'standard' | 'arcade'`) beat enums for names that appear in saved data or UI.
- **Numeric enums** (`Anim`, `Gesture`) are used where values are packed into typed arrays for rendering frames.

## Naming

- **Use football and game terms:** `carrier`, `presser`, `offsideLine`, `restartStage`, `celebrant`, not `obj1` or `handlerB`. A reader who knows football should recognise the idea.
- **Tuning tables are UPPER_SNAKE** (`BALL`, `PLAYER`, `AI_PROFILES`, `KICK_TIMING`). They are the knobs a learner will turn first.
- **Units in names or docs** whenever a number has one: `restartDistance` documented in metres, `reaction` in seconds, angles in radians.
- **Booleans read as questions:** `isRecord`, `hasStoredSettings`, `goalKickClearsArea`.

## Modules

- **Every module starts with the licence header, then a header comment:** what the module is for, the main idea, and where to read next. A newcomer should be able to follow a module from its header alone.
- **Layering:** `src/sim/` never imports from `render/`, `ui/`, `input/` or browser APIs. It must run headless in tests. `render/` reads `Frame` snapshots, never live simulation objects.
- **Determinism in `src/sim/`:** randomness only through the seeded `world.rng`, never `Math.random`, `Date.now` or wall-clock time.
- **Persistence** goes through `src/game/storage.ts` only (see [persistence](../architecture/persistence.md)).
- **Identity in one place:** the game's name and other branding come from `src/brand.ts`. Identifiers that are saved or exported (storage keys, achievement ids, team codes, the save-file `format`) are permanent and brand-neutral.
- **Presentation stays out of the simulation:** appearance (body, hair, skin) is chosen in `src/render/`, never read by `src/sim/`.

## Performance in hot paths

The simulation runs at 120 Hz and rendering at up to 240 Hz, so garbage collection pauses show up as stutter.
- **No allocation per step or per frame:** no new objects, arrays, closures or template strings in `step()`, `think()`, `interpolate()` or `update()` loops.
- **Scratch objects:** module-level scratch vectors (`const vA = new THREE.Vector3()`), typed arrays for per-player data, and shared result objects documented as such ("returns a shared scratch object: read it immediately").
- **New visual cost** joins the adaptive quality ladder. Read [performance](performance.md) before adding effects.

## Comments and TSDoc

Comments are a major part of this project's educational value. Write them for the next learner.

**Write a doc comment (`/** … */`) on:**
- every exported class, function, interface and constant that another module uses;
- any function whose name doesn't tell the whole story: units, ranges, side effects, shared return objects, invariants.

**Write an inline comment (`//`) for:**
- the *why*: the football idea ("Law 11: no offside from a throw-in"), the trade-off ("cheaper than a raycast, accurate enough at 120 Hz"), or the bug it prevents ("the practice reset must lift the freeze, or the tutorial soft-locks").

**Don't:**
- restate the code (`// increment i`);
- narrate history ("changed in phase 3"). Git and the changelog hold history; comments describe the code as it is;
- leave commented-out code.

**TSDoc style:**
- The first sentence is a summary that stands alone; detail follows after a blank line.
- Use `{@link Name}` to point at related code.
- Add `@param` and `@returns` only when they add something the types don't (units, ranges, meaning of `null`).
- Use the IFAB Law number when code implements a rule ("Law 12.1").

**Example:**

```ts
/**
 * Law 12.1 distinguishes careless (foul only), reckless (caution) and excessive force (sending-off).
 * The game decides from the physical facts of the challenge — never randomly — so the same challenge
 * always gets the same decision.
 */
export function foulSeverity(f: FoulFacts): FoulSeverity {
```

It explains the football rule, the design choice (deterministic), and why it matters (fairness), without repeating the three `if` statements below it.

## Tests

- Behaviour changes and bug fixes come with a test where practical. Gameplay and AI need scenario or simulation tests. See [testing](testing.md).
- Test names describe behaviour in football terms ("the own-goal scorer is credited and looks dismayed").
- Pure functions first: logic you can test without a match or a browser.

## Licence headers

Every source file starts with the Eclipse-style header, in its format's comment syntax. `npm run check:licenses` enforces it in CI.

**TypeScript, JavaScript and CSS:**

```ts
/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
```

**Shell scripts, YAML and git hooks** use the same lines with `#` comments. **Any shebang (`#!/usr/bin/env bash`) stays on line 1**, above the header; the check fails otherwise. **HTML** puts the header in an `<!-- … -->` comment after `<!doctype html>`.

**Not headed, on purpose:**
- **JSON** (comments are invalid JSON);
- **generated files** (`public/NOTICE.txt`, the SBOM);
- **third-party files** (`public/assets/**`, flags, fonts), which keep their own notices; never overwrite a third-party copyright notice;
- **Markdown**;
- **data-only GitHub forms** (`.github/ISSUE_TEMPLATE/`, `DISCUSSION_TEMPLATE/`, `release.yml`).

If the copyright holder changes, update `COPYRIGHT_HOLDER` in `scripts/check-licenses.mjs` and the headers together. "and others" may be added once others contribute; the check accepts it.

## Tooling: what we use and what we evaluated

| Tool | Decision | Why |
|---|---|---|
| TypeScript strict | **Used** | The first line of defence |
| ESLint and typescript-eslint `recommended` | **Used** | Catches real mistakes with few false alarms |
| Type-aware `no-floating-promises`, `no-misused-promises` | **Used** | Assets, audio and fonts load asynchronously, so an unhandled promise fails silently. There were zero violations when enabled, so they are a pure guard. They raised lint time from about 8 s to about 17 s on a typical machine. |
| Full type-checked presets | **Not used** | Measured: about 85 `no-unnecessary-condition` and 18 redundant-assertion reports, mostly noise in defensive game code |
| Prettier | **Used** | No formatting debates |
| Coverage (`@vitest/coverage-v8`) | **Not added** | Coverage percentages reward testing easy code. The project's confidence comes from scenario and simulation tests chosen by risk. Run it ad hoc if useful: `npm i --no-save @vitest/coverage-v8 && npx vitest run --coverage`. |
| Dead-code finders (for example knip) | **Not added** | A one-off scan found two unused exports, both since removed. As a CI gate it reports many false positives (dev tools, browser scripts, `?lab` entry points). Run it occasionally by hand. |
