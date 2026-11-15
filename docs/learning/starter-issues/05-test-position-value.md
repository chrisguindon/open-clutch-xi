# Test: how the AI values positions on the pitch

Labels: good first issue,area:testing,area:ai

## Problem

`positionValue(world, team, x, z)` is a small function at the heart of the AI. It says how valuable a spot on the pitch is for a team, from 0 to 1, and passes, dribbles and shots all compare against it. It has no direct unit test, so a change could silently flip what the AI thinks is "forward".

## Relevant files

- `src/sim/ai/evaluate.ts`: `positionValue()`, with a comment explaining the idea
- `tests/ai-decisions.test.ts`, or a new `tests/position-value.test.ts`
- `tests/helpers.ts`: `makeMatch()` creates a match you can query (`m.world`)

## Expected behaviour (what the tests should check)

- For each team, a point near the goal it attacks is worth more than a point near its own goal. Use `world.attackDir(team)` to find out which way is forward.
- Near the opponent's goal, the centre of the pitch is worth more than the same distance out by the touchline.
- Values stay within 0–1 everywhere. Sample a grid of points.

## Acceptance criteria

- At least three focused tests with clear names, as above.
- They pass on the current code, and would fail if the attacking direction were reversed. Try it.
- `npm run ci` passes.

## Learn more

The *Utility AI* explanation in [docs/learning/README.md](../README.md#ideas-that-show-up-everywhere).
