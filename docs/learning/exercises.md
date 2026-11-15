# Exercises

**Audience:** learners working through the [guides](README.md#learning-guides). Each exercise is small and self-contained. Work on a branch of your fork, and run `npm test` before and after. Share what you made in **Discussions → Show and Tell** if you like.

Every exercise lists its **objective**, the **files**, the **concepts**, the **steps**, the **expected result**, **how to test** it and an **extension**.

## Beginner

### B1. Watch the fixed timestep at work

- **Objective:** see that the simulation runs a varying number of steps per display frame.
- **Files:** `src/game/frames.ts` (`FixedStepClock`), `src/game/diagnostics.ts`.
- **Concepts:** [fixed timestep](game-loop.md), interpolation.
- **Steps:**
  1. `npm run dev`, start a match, and press **F3**.
  2. Find the simulation line (`sim … steps/s`) and the steps-per-frame histogram.
  3. In *Settings → Graphics → Frame rate*, switch between 30, 60 and Auto.
- **Expected result:** at 60 fps, most frames run 2 steps (120 ÷ 60); at 30 fps, about 4. The simulation rate stays near 120 steps/s whatever the frame rate.
- **How to test:** none needed; you're observing. Explain the numbers in your own words.
- **Extension:** read `tests/interpolation.test.ts` and find the test that checks what happens after a long stall.

### B2. A bouncier ball

- **Objective:** change a physics constant and find the test that guards it.
- **Files:** `src/sim/config.ts` (`BALL`), `tests/ball.test.ts`.
- **Concepts:** [restitution and bounces](physics.md#bounces-and-rolling).
- **Steps:**
  1. Raise `BALL.restitution` from `0.6` to `0.85`.
  2. Play a match and watch long balls bounce.
  3. Run `npx vitest run tests/ball.test.ts`.
- **Expected result:** the ball bounces higher and longer, and the bounce test still passes (each bounce is still weaker than the last). Try `1.05` and see it fail. Why?
- **How to test:** `npx vitest run tests/ball.test.ts`.
- **Extension:** add a test that a ball dropped from 2 m never bounces higher than 2 m.

### B3. Change the look of dusk

- **Objective:** make a visible change to rendering and see it live.
- **Files:** `src/render/renderer.ts` (`GRADES`).
- **Concepts:** [colour grading](threejs.md#the-basic-pieces).
- **Steps:**
  1. Find the `dusk` entry in `GRADES`.
  2. Raise the red part of `tint` (the first number) to `1.08`.
  3. Choose *Settings → Graphics → Time of day → Dusk* and start a match.
- **Expected result:** a warmer, more orange dusk. Vite reloads the page when you save.
- **How to test:** `npm run typecheck`; compare screenshots before and after.
- **Extension:** find where `vignette` is applied in the shader string at the top of `renderer.ts`, and explain what it does.

### B4. Read a rules test

- **Objective:** learn to read a scenario test and predict its result.
- **Files:** `tests/rules.test.ts`, `src/sim/rules.ts`.
- **Concepts:** [pure rules and decisions](football-rules.md).
- **Steps:**
  1. Find the `own goals` test.
  2. Before running it, write down what you think `goals[0]` will contain, and why.
  3. Run `npx vitest run tests/rules.test.ts -t "own goal"`.
- **Expected result:** your prediction matches: the defender is credited with an own goal, and someone from the other team celebrates.
- **How to test:** the test itself.
- **Extension:** change the ball's starting position so the attacker touches it last, and predict the new result.

### B5. Make the game yours: the tagline

- **Objective:** see how one configuration file drives the whole user interface.
- **Files:** `src/brand.ts`, `src/ui/ui.ts` (`logoHtml`), `vite.config.ts`.
- **Concepts:** a single source of truth; why names aren't hard-coded.
- **Steps:**
  1. Change `tagline` in `BRAND` to your own line.
  2. Look at the menu and the loading screen.
  3. Search `src/` for the old tagline text.
- **Expected result:** both screens show your line, and the search finds it only in `src/brand.ts`.
- **How to test:** `npm run typecheck`. Also `npm test`: no test depends on the tagline.
- **Extension:** list what *else* would change if the whole game were renamed (see `src/brand.ts`), and what must never change (saved-data keys, achievement ids).

### B6. Who is on the pitch? Team composition

- **Objective:** understand how appearance is kept separate from gameplay.
- **Files:** `src/render/characters/squad.ts` (`bodyFor`), `tests/inclusive-players.test.ts`.
- **Concepts:** pure functions; presentation versus simulation.
- **Steps:**
  1. Read `bodyFor` and predict which players are drawn with which body in a mixed 5v5 squad.
  2. Choose *Teams & options → Teams → Mixed* and check your prediction at kick-off.
  3. Read the test `nothing in src/sim/ imports rendering, settings or appearance code`.
- **Expected result:** you can explain why no player can be faster or stronger because of how they look: the simulation never receives that information.
- **How to test:** `npx vitest run tests/inclusive-players.test.ts`.
- **Extension:** change the mixed pattern (for example by squad role instead of index) and update the test that checks both bodies appear in every format.

## Intermediate

### I1. Test the fixed-step clock yourself

- **Objective:** write a unit test for a small pure class.
- **Files:** `src/game/frames.ts` (`FixedStepClock`), `tests/interpolation.test.ts`.
- **Concepts:** [accumulators and the spiral of death](game-loop.md#the-solution-a-fixed-timestep).
- **Steps:**
  1. Create a clock with `stepDt = 0.01` and `maxSteps = 5`.
  2. Call `advance(0.025, …)` and count the steps.
  3. Call `advance(1.0, …)` (a one-second stall) and count again.
- **Expected result:** 2 steps with `alpha` ≈ 0.5, then exactly 5 steps, and the backlog is dropped (the next `advance(0, …)` runs 0 steps).
- **How to test:** `npx vitest run tests/interpolation.test.ts`.
- **Extension:** what does returning `true` from the step callback do? Write a test for it.

### I2. Plot a curling free kick

- **Objective:** see the Magnus force bend the ball.
- **Files:** `src/sim/ball.ts` (`predictBall`), `src/core/math.ts` (`Vec3`).
- **Concepts:** [Magnus force](physics.md#the-forces-on-a-flying-ball).
- **Steps:**
  1. In a scratch test, call `predictBall` twice from the same position and velocity (about 25 m/s towards goal): once with zero spin, once with spin about the vertical axis.
  2. Print the z coordinate (sideways) every 10 samples.
- **Expected result:** without spin, z stays near constant; with spin, it curves steadily to one side. Flip the spin's sign and it curves the other way.
- **How to test:** turn your scratch file into a test that asserts the side of the curl.
- **Extension:** find the spin a human shot gets from `curl` in `src/sim/human.ts`.

### I3. A new step on the quality ladder

- **Objective:** extend a pure state machine, test first.
- **Files:** `src/game/adaptive.ts` (`LADDER`), `tests/adaptive.test.ts`.
- **Concepts:** [adaptive quality](threejs.md#adaptive-quality).
- **Steps:**
  1. Read how the tests simulate devices.
  2. Add a level between `Medium (lean)` and `Low`, for example `medium` with `{ bloom: false, msaa: 0 }`.
  3. Add a test with a simulated device that settles on your new level.
- **Expected result:** all adaptive tests pass, including yours.
- **How to test:** `npx vitest run tests/adaptive.test.ts`.
- **Extension:** run `npm run check:adaptive` (needs Chrome) and watch the ladder in a real browser.

### I4. Explain an AI decision

- **Objective:** connect what you see on screen to the utility scores in code.
- **Files:** `src/sim/ai/teamBrain.ts` (`carrier`), `src/sim/ai/evaluate.ts`.
- **Concepts:** [utility AI](football-ai.md#utility-ai-how-the-carrier-decides).
- **Steps:**
  1. Start a match, press **F3**, and watch *AI decision*.
  2. Note an option that lost (for example a pass that scored lower than a dribble).
  3. Find the terms in `carrier()` that produced each score.
- **Expected result:** a short written explanation: "the pass lost because the receiver was marked (low `evaluatePass` success) and…".
- **How to test:** discuss it with someone, or post it in Discussions → Learning.
- **Extension:** change one weight, then compare `npm run report:ai` before and after. Remember to use many seeds.

### I5. Clearances stay on the pitch

- **Objective:** write a missing scenario test.
- **Files:** `src/sim/ai/evaluate.ts` (`chooseClearance`), `tests/ai-decisions.test.ts`.
- **Concepts:** scenario tests; [AI evaluation](football-ai.md).
- **Steps:**
  1. Copy the structure of `every sampled clearance from anywhere in our half goes forwards`.
  2. Assert instead that every target lies inside the touchlines (`|z| < pitch width / 2`).
- **Expected result:** the test passes. If it fails, you've found a bug: open an issue with the failing position.
- **How to test:** `npx vitest run tests/ai-decisions.test.ts`.
- **Extension:** repeat for the 11v11 pitch.

### I6. A validated setting with a migration

- **Objective:** add saved data the safe way.
- **Files:** `src/game/settings.ts`, `tests/settings-migration.test.ts`, `tests/storage.test.ts`.
- **Concepts:** [validation and migrations](persistence.md).
- **Steps:**
  1. Add a setting, for example `showClock: boolean`, to `Settings` and `DEFAULT_SETTINGS`.
  2. Write a test: old saved settings without `showClock` load with the default.
  3. Write a test: `"showClock": "yes"` (the wrong type) loads with the default.
- **Expected result:** both tests pass without any special code: `sanitizeSettings` handles the wrong type.
- **How to test:** `npx vitest run tests/settings-migration.test.ts tests/storage.test.ts`.
- **Extension:** add a toggle in *Settings → Game* (`src/ui/ui.ts`), keyboard-accessible with a hint.

### I7. Add an achievement

- **Objective:** add a feature end to end, with tests, following the project's rules for achievements.
- **Files:** `src/game/achievements.ts`, `tests/progress.test.ts`.
- **Concepts:** pure predicates; permanent identifiers; [no-pressure design](../gameplay/progression.md).
- **Steps:**
  1. Pick a reliable condition, for example *"Win 11v11"*: `(_p, s) => !!s && s.mode === 'match' && s.format === '11v11' && s.winner === 0`.
  2. Append a new id to `ACHIEVEMENT_IDS` and a matching entry to `ACHIEVEMENTS` (same order: a test checks it).
  3. Write two tests: it unlocks after an 11v11 win, and not after a 5v5 win.
- **Expected result:** the Records screen lists it (locked) straight away. A real 11v11 win unlocks it once, and the full-time screen says so.
- **How to test:** `npx vitest run tests/progress.test.ts`.
- **Extension:** why must an id never be renamed? Try renaming one and load a record saved before the rename (`parseProgress` rejects it).

### I8. Add a statistic, without breaking old saves

- **Objective:** change a saved data format safely: the most important lesson in [saving data](persistence.md).
- **Files:** `src/game/progress.ts` (`PlayerStats`, `emptyProgress`, `recordMatch`, `parseProgress`), `src/ui/ui.ts` (`showRecords`), `tests/progress.test.ts`.
- **Concepts:** schema changes, strict validation, migrations.
- **Steps:**
  1. Add `elevenAsideWins: number` to `PlayerStats` and `emptyProgress`, and count it in `recordMatch`.
  2. Add it to the counters checked in `parseProgress`.
  3. **Write a test first:** save a record *without* the new field (as an older version would have), then call `loadProgress()`. It fails: strict validation rejects the old record.
  4. Fix it with a migration: in `parseProgress`, treat a missing `elevenAsideWins` as `0` before validating.
  5. Show it on the Records screen with a new `card(...)`.
- **Expected result:** new records count the statistic, and old records still load, with the statistic at 0.
- **How to test:** `npx vitest run tests/progress.test.ts`.
- **Extension:** when would you bump `version` to 2 instead? Write down the rule for this project.

### I9. Design a change kit

- **Objective:** change team data, and see how kit clashes are resolved.
- **Files:** `src/sim/nations.ts`, `resolveKits` in `src/render/matchView.ts`, `tests/teams-kits-and-bindings.test.ts`.
- **Concepts:** data-driven design; colour contrast.
- **Steps:**
  1. Pick a team and change its `away` kit (shirt, secondary, shorts, socks, pattern, trim).
  2. Start a match against a team whose home shirt is a similar colour.
  3. Read `resolveKits` to see when the change kit is used.
- **Expected result:** the teams are always easy to tell apart on the pitch.
- **How to test:** `npx vitest run tests/teams-kits-and-bindings.test.ts` (it checks every pairing).
- **Extension:** use national colours only, with no crests or commercial kit designs ([third-party assets](../governance/third-party-assets.md) explains why).

## Advanced

### A1. A new skill move

- **Objective:** add gameplay end to end: simulation, input and test.
- **Files:** `src/sim/world.ts` (`performSkill`), `src/sim/human.ts`, `tests/controls.test.ts`.
- **Concepts:** [player physics](physics.md#players); commands.
- **Steps:**
  1. Study how `performSkill` moves the ball and player.
  2. Add a variation, for example a quick stop that kills the ball's speed under the sole.
  3. Write a scenario test that the ball stays within reach after the move.
- **Expected result:** the move works with keyboard, controller and touch (they share the command path), and the test passes.
- **How to test:** `npx vitest run tests/controls.test.ts`; play it.
- **Extension:** add a matching procedural pose in `src/render/characters/footballer.ts`.

### A2. Smarter crosses

- **Objective:** improve AI behaviour and prove it statistically.
- **Files:** `src/sim/ai/teamBrain.ts`, `src/sim/ai/evaluate.ts`, `tests/tools/ai-audit-report.test.ts`.
- **Concepts:** [measuring AI changes](football-ai.md#measuring-ai-changes).
- **Steps:**
  1. Run `npm run report:ai` and save the cross numbers.
  2. Change where the crosser aims, for example the space between the keeper and the defensive line.
  3. Rerun over the same seeds and compare.
- **Expected result:** a measurable improvement over 30 or more seeds, with no new failures in `npm test`.
- **How to test:** `npm run report:ai`, `npm test`.
- **Extension:** add a guardrail test only if the effect is large compared with the noise (see [testing](../development/testing.md)).

### A3. A rule, end to end

- **Objective:** follow the project's checklist for changing the Laws of the Game.
- **Files:** `src/sim/rules.ts`, `src/sim/match.ts`, `tests/rules.test.ts`, `docs/gameplay/FOOTBALL_RULES.md`.
- **Concepts:** [rules in code](football-rules.md), the restart stage machine.
- **Steps:** pick a small missing rule from the matrix (for example a dropped ball after a stoppage), then follow [Adding or changing a rule](../gameplay/FOOTBALL_RULES.md#adding-or-changing-a-rule): a pure function, the decision in `match.ts`, the announcement in words, a test and a matrix row.
- **Expected result:** the rule is deterministic, announced, tested, and documented. The Arcade/Standard difference is stated honestly.
- **How to test:** `npx vitest run tests/rules.test.ts`; `npm run check:rules` (needs Chrome).
- **Extension:** add the officials' signal for it in `src/sim/officials.ts`.
