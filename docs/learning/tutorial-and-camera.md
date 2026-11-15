# Learning guide: the tutorial's state machine and the camera

**You'll learn:** how to make an interactive lesson that can't get stuck, and how a camera decides what to look at. **Prerequisites:** the [code tour](code-tour.md). **Read alongside:** `src/game/tutorial.ts`, `src/render/camera.ts` (`celebrationShotEnds`, the follow logic in `update`), `tests/tutorial.test.ts`, `scripts/tutorial-check.mjs`.

## A tutorial is a state machine

Each lesson (`Step` in `tutorial.ts`) has the same parts:

| Part | In the code | Example (Passing) |
|---|---|---|
| Entry and a valid starting state | `setup`, run once on entry and on Retry | the ball goes to your feet |
| Objective | `text` | "Push towards a team-mate and press Space to pass" |
| Completion check | `check` | a `humanKick` event of kind pass |
| Recovery | the watchdog | ball out of reach, play stopped, player unable to move |
| Retry / Skip / Exit | `handle` | buttons on the card and in the pause menu |

The rule that keeps it reliable: **a lesson must always be completable from whatever state the game is in.** Real players do unexpected things: they pass the ball away, score when asked to pass, press the wrong button, pick up a controller halfway through.

## Three bugs that got a playtester stuck, and what they teach

1. **The camera never came back.** After a goal, the camera orbits the scorer. It used to return to play only at a kick-off, but practice has no kick-off, so it orbited forever while the ball was elsewhere. *Lesson:* end a temporary state on the condition that really ends it ("the goal phase is over": `celebrationShotEnds`), not on one event you assume will follow.
2. **Switching away from the ball.** Pressing Switch while carrying the ball moved control to another player, leaving the ball with an AI team-mate. *Lesson:* keep invariants in one place. The match now guarantees that the controlled player is the ball carrier whenever the team has the ball (`keepHumanOnCarrier` in `src/sim/match.ts`).
3. **Buttons that looked clickable but weren't.** The tutorial card's buttons had no click handler. *Lesson:* test the way people actually use the game: the browser check clicks those buttons for real.

## Explain first, recover second

When the ball is out of reach, the tutorial does two things in order:
1. **Tell the player** where the ball is and how to get it back, using the control for *their* device (`bindHtml` and `controlAvailable` in `src/ui/ui.ts`).
2. **Fix it** only if it stays out of reach: the ball comes back to their feet.

Taking over straight away is confusing, and never taking over can leave someone stuck. Touch has no "reset ball" button, so there the return comes sooner.

## How the camera decides what to look at

The gameplay camera follows a **focus point**: the ball, pulled a quarter of the way towards the controlled player, and led a little in the direction the ball is moving (`update` in `camera.ts`). It moves there smoothly in small sub-steps, so the path is the same at any frame rate. Cinematic shots (intro, celebrations, replays) temporarily replace it, and must always end: that's what bug 1 above got wrong.

## Try it

Run `npm run check:tutorial` and read its output: first the happy path, then each deliberate mistake with PASS or FAIL. Then add a lesson of your own to `allSteps`, with a `setup`, a `check` and a test that makes a mistake during it.
