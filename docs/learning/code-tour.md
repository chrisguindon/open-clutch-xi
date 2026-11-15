# Code tour: from a key press to a saved achievement

**You'll learn:** how one action travels through the whole game: input, simulation, rules, rendering, statistics and saving. **Prerequisites:** none, but the [game loop](game-loop.md) guide helps. Open each file as you read; the function names are real, so your editor's search will find them.

We follow one moment: **you press Shoot, the ball goes in, and at full time you unlock *First Goal*.**

## 1. Your key press becomes an input frame

**File:** `src/input/input.ts`, `InputManager.poll()`

The browser reports a `keydown` for, say, `KeyJ`. The input manager looks it up in your bindings (`activeBindings` in `src/game/settings.ts`) and finds the action `shoot`. It doesn't do anything with it yet: it records a **press edge** in an `InputFrame` (`src/sim/human.ts`).

- **Why an edge, not "is the key down"?** A tap can be shorter than one frame. The edge is kept until a simulation step consumes it (`consumeEdges`), so even very quick taps are never lost.
- **Why one `InputFrame` for every device?** Keyboard, mouse, controller and touch all produce the same structure, so the simulation never knows or cares which device you used.

## 2. The input frame becomes a command

**File:** `src/sim/human.ts`, `humanCommand()` (called from `Match.step()` in `src/sim/match.ts`)

Once per simulation step (120 times a second), the human-controlled player's input frame is turned into a **`PlayerCommand`**: "move this way, sprint or not, kick like this". For a shot, `shotRequest()` builds a `KickRequest` aimed at goal, using your stick direction to pick a corner.

The AI produces exactly the same `PlayerCommand`s (`TeamBrain.think()` in `src/sim/ai/teamBrain.ts`), which is why computer players can't do anything you can't.

## 3. The command moves a body and strikes the ball

**File:** `src/sim/world.ts`, `World.step()`

`World.step()` runs in a fixed order (read the module comment):
1. `startActions` starts the kick animation;
2. `p.move` moves every player;
3. `processKick` waits for the moment the foot actually reaches the ball (`kickContactAt`). Then `applyKick` gives the ball its velocity and spin.

So the ball leaves the foot at the same moment the animation shows contact.

**File:** `src/sim/ball.ts`, `Ball.step()`

Gravity, air drag and the Magnus force (spin curving the ball) change its velocity, then its position, every 1/120 s. See [physics](physics.md).

## 4. The rules engine sees a goal

**File:** `src/sim/match.ts`, `applyLaws()` → `onGoal()`

After the world moves, `applyLaws()` checks Laws 9 and 10:
- Is the ball wholly over the goal line, between the posts and under the bar?
- Was it scored directly from a restart that can't score (`canScoreDirectly` in `src/sim/rules.ts`)?

If it's a goal, `onGoal()` decides **who is credited**: the last toucher, or an own goal by a defender. It adds a line to `goalLog`, picks a celebration (`src/sim/celebration.ts`), and **emits events** (`goal`, `banner`, `decision`). Nothing here draws or plays sound; it only decides. See [rules in code](football-rules.md).

## 5. The renderer shows it

**Files:** `src/game/frames.ts` (`Frame.capture`), `src/render/matchView.ts` (`MatchView.interpolate`), `src/render/characters/footballer.ts`

After each step, the game copies the simulation into a compact **`Frame`**: positions, animation states and gesture codes. The renderer reads only frames, never the simulation itself.
- It blends the last two frames for smooth motion at any frame rate.
- It poses each footballer, including the celebration gesture the simulation chose.
- Three.js draws the scene. See [Three.js](threejs.md).

The UI listens for the `goal` and `banner` events to show "GOAL!" and to announce it to screen readers in words.

## 6. Full time: the match becomes statistics

**Files:** `src/game/game.ts` (`recordFinishedMatch`), `src/game/progress.ts` (`summariseMatch`, `recordMatch`)

When the match reaches full time:
1. `summariseMatch()` builds a `MatchSummary` from the simulation's own records: the score, `goalLog` and shootout kicks. The UI isn't used, so the record can't disagree with what the simulation decided.
2. `recordMatch()` returns a **new** record with your statistics and history updated. It is a *pure function*: same input, same output, nothing modified. Each match has an id, and a match already in your history is ignored, so it can't be counted twice. Matches you quit never reach this point, so they aren't counted.

## 7. Achievements are checked

**File:** `src/game/achievements.ts`

Each achievement is a small rule over your record, for example:

```ts
{ id: 'first-goal', name: 'First Goal', description: 'Score a goal in a match.', unlocked: (p) => p.stats.goalsFor >= 1 },
```

`recordMatch()` checks every achievement that isn't unlocked yet, and stores the time for each one that now passes. The full-time screen lists the new ones quietly (and announces them in words). The ids never change, because they are saved in players' browsers.

## 8. Your record is saved and restored

**Files:** `src/game/progress.ts` (`saveProgress`, `loadProgress`, `parseProgress`), `src/game/storage.ts`

`saveProgress()` writes the record as JSON to `localStorage` under the key `player-progress-v1`. Next time you open the game, `loadProgress()` reads it back and **validates every field** (`parseProgress`) before trusting it. If the browser blocks storage, or the data is damaged, the game still works: you get a fresh record, and damaged text is kept as a recovery copy. See [saving data safely](persistence.md).

## Try it

Set a breakpoint (or add a `console.log`) in `onGoal()` and in `recordMatch()`, then score a goal. You'll see the moment the simulation decides, and later the moment your record changes. Then try the [exercises](exercises.md): **I7** adds your own achievement, and **I8** adds a statistic.
