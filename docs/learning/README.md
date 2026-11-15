# Learning with Open Clutch XI

Open Clutch XI is a real, complete game that's small enough to understand. You can use it to learn:
- TypeScript
- 3D graphics with Three.js
- game loops and physics
- game AI
- testing
- how open-source projects work

Read the code, change it, break it, and share what you built in **Discussions → Show and Tell**. Questions of any level are welcome in **Discussions → Learning**.

## Setup (about 5 minutes)

You need [Node.js](https://nodejs.org/) 22 or newer (24 recommended) and Git.

```bash
git clone <your fork's URL> open-clutch-xi && cd open-clutch-xi
npm ci
npm run dev      # open http://localhost:5173
npm test         # run the tests
```

Vite reloads the page when you save a file. Press **F3** in a match to open the diagnostics panel, which shows frame times, input latency, adaptive quality, and the AI's latest decision with its reasons.

Stuck on setup? Open a [documentation issue](../../CONTRIBUTING.md) or ask in Discussions. If setup confused you, it will confuse others too.

## A tour of the code

The game is split so that **the football can be understood without the graphics**:

```
input (keyboard / mouse / pad / touch)
        │   src/input/  → an InputFrame: "move this way, pass pressed"
        ▼
simulation, 120 times a second                     src/sim/
   Match.step()   rules, restarts, clock          sim/match.ts
   World.step()   players, ball contact, kicks    sim/world.ts
   Ball.step()    gravity, drag, spin (Magnus)    sim/ball.ts
   TeamBrain      AI decisions                    sim/ai/teamBrain.ts
        │
        ▼
rendering, once per display frame                  src/render/
   MatchView interpolates between simulation steps (smooth at any frame rate)
   Three.js draws the stadium, players and ball
```

| Start here if you're interested in… | File | Look for |
|---|---|---|
| The game loop | `src/game/game.ts` | `loop`, `frame`. The fixed-step clock is in `src/game/frames.ts` (`FixedStepClock`). |
| Ball physics | `src/sim/ball.ts` | `Ball.step`: gravity, air drag and the Magnus force that makes shots curl. The constants are in `BALL` in `src/sim/config.ts`. |
| Player movement and kicks | `src/sim/world.ts` | `World.step`, `performSkill` |
| AI decisions | `src/sim/ai/teamBrain.ts` | `carrier()`: every option gets a utility score, and the best one wins |
| How the AI judges a pass or shot | `src/sim/ai/evaluate.ts` | `evaluatePass`, `evaluateShot`, `chooseClearance` |
| Difficulty levels | `src/sim/config.ts` | `AI_PROFILES`: reaction time, decision noise, accuracy |
| Settings and saved data | `src/game/settings.ts`, `src/game/storage.ts` | `loadSettings`, `sanitizeSettings`, `readJson` |
| Statistics and achievements | `src/game/progress.ts`, `src/game/achievements.ts` | `recordMatch`, `ACHIEVEMENTS` |
| Women, men and mixed squads | `src/render/characters/squad.ts`, `clipSampler.ts` | `bodyFor`, `retargetFor` |
| The game's name and logo | `src/brand.ts` | `BRAND` |
| Release archives and site metadata | `scripts/package-web.mjs`, `src/siteMeta.ts` | `createTar`, `renderSiteMeta` |
| Adaptive graphics | `src/game/adaptive.ts` | `AdaptiveController`, a small, pure, well-tested state machine |
| Menus and HUD | `src/ui/ui.ts`, `src/ui/styles.css` | plain HTML strings and CSS, no framework |

Every module starts with a comment explaining what it's for. [The architecture overview](../architecture/README.md) goes deeper, and the [coding standards](../development/CODING_STANDARDS.md) explain how the code is written.

### Ideas that show up everywhere

- **Fixed timestep.** The simulation always advances in exact 1/120 s steps, whatever the frame rate. This makes it deterministic (the same seed gives the same match) and testable without a browser.
- **Interpolation.** The renderer draws positions between the last two simulation steps, so movement looks smooth on 60, 144 and 240 Hz screens.
- **Utility AI.** Instead of a fixed script, the ball carrier scores each option (shoot, each pass, dribble directions, hold, clear) and picks the highest. Difficulty adds controlled noise. Open F3 in a match to watch the scores live.
- **Tests as experiments.** `tests/` contains scenario tests that set players up by hand and check what happens, plus whole-match simulations.

## Learning guides

Each guide explains one idea with the real code, then points to exercises.

| Guide | You'll learn |
|---|---|
| [Code tour: from a key press to a saved achievement](code-tour.md) | **Start here.** One shot followed through input, simulation, rules, rendering, statistics and saving |
| [The game loop](game-loop.md) | Fixed timestep, interpolation, determinism |
| [Ball and player physics](physics.md) | Gravity, drag, the Magnus force, bounces, rolling, player movement |
| [3D rendering with Three.js](threejs.md) | Scenes, skinned characters, instancing, adaptive quality |
| [Releases and hosting](releases-and-hosting.md) | Versioned, checksummed, reproducible releases; customising a site without rebuilding; security headers |
| [Football AI](football-ai.md) | Situation analysis, roles, utility scoring, fair difficulty |
| [Football rules in code](football-rules.md) | Offside, fouls and cards, the restart stage machine |
| [Saving data safely](persistence.md) | localStorage, validation, migrations, privacy |
| [The tutorial and the camera](tutorial-and-camera.md) | State machines that can't get stuck, camera targeting, testing like a player |

## Exercises

[Exercises](exercises.md) at three levels:
- **Beginner:** observe, tweak a constant, read a test, customise the UI, explore team composition.
- **Intermediate:** write tests, extend pure modules, add an achievement or a statistic (with a migration), design a kit.
- **Advanced:** gameplay, AI and rules changes end to end.

Each one lists its objective, files, concepts, steps, expected result, how to test it, and an extension. For real tasks, see the [starter issues](starter-issues/README.md).

## Contributing what you learned

Fixed something, or wrote a clearer explanation? That's a contribution. See [CONTRIBUTING.md](../../CONTRIBUTING.md); `good first issue` labels mark tasks suited to a first pull request. If you used an AI assistant, that's fine. Make sure you understand the code you submit, as you would for any pull request.
