# Test: restart long balls never aim into touch

Labels: good first issue,area:testing,area:ai

## Problem

When the AI has no safe pass at a restart, it plays a long ball using `chooseClearance(world, team, x, z, false)`. The last argument (`allowTouch = false`) means the target must stay on the pitch. Previously, these balls went out of play two times in three. Today, nothing tests that `allowTouch = false` keeps the target inside the touchlines.

## Relevant files

- `src/sim/ai/evaluate.ts`: `chooseClearance()`
- `tests/ai-decisions.test.ts`: the *AI clearances (scenarios)* tests, to use as a template, including the `setup()` helper

## Expected behaviour

For starting points across our own half, including near both touchlines, the returned target with `allowTouch = false`:
- has `|z|` less than half the pitch width (`w.pitch.width / 2`);
- is ahead of the starting point (towards the opponent's goal).

## Suggested starting point

Copy the test *"every sampled clearance from anywhere in our half goes forwards"*, pass `false` as the fifth argument, and add the touchline check.

## Acceptance criteria

- A new test in `tests/ai-decisions.test.ts` that fails if `allowTouch` is ignored. Try temporarily breaking it to see the test fail.
- `npm test` and `npm run ci` pass.

## Learn more

[docs/learning/README.md](../README.md), exercises section (this is exercise 6).
