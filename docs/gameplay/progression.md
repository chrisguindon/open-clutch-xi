# Statistics, achievements and progression

**Status:** statistics, match history and 10 achievements are implemented; tournament achievements wait for the tournament. **Audience:** players, the maintainer and contributors.

The [experience review](EXPERIENCE_REVIEW.md) found that nothing is remembered between sessions. This page describes the local statistics, achievements and light progression that give players goals and a sense of improvement **without manipulating them**. Open Clutch XI is played by children and learners. It should model respectful game design, not engagement tricks.

## Principles (non-negotiable)

- **Recognise, don't pressure.** No streaks that punish missing a day, no daily log-in rewards, no countdown timers, no "come back" notifications, no loss-aversion messages.
- **Nothing to buy and nothing hidden.** No currencies, loot boxes or random rewards. Every achievement and its condition is visible from the start. There are no secret ones.
- **Gameplay is never gated.** Every team, mode, difficulty and setting is available from the first launch. Achievements are a record, not a key.
- **Local and private.** Everything stays in the player's browser ([persistence](../architecture/persistence.md)). No accounts, telemetry, leaderboards or third-party services. The player can view, export and reset it all.
- **Celebrate quietly.** A small toast at full time, with no pop-up during play. Respect *reduce motion*.
- **Fair to every player.** Achievements are reachable at Beginner difficulty, and with any control scheme. Harder variants exist for those who want them.
- **The simulation decides.** Stats and achievements are computed from simulation events (`goal`, `kick`, `save`, full-time results), so they're deterministic and testable.

## Local statistics (Records screen)

Recorded at full time from the simulation (`src/game/progress.ts`). Quit or restarted matches don't count.

| Shown | Counted from |
|---|---|
| Played, won, drawn, lost | Completed matches (not shootouts, practice or the tutorial) |
| Goals scored and conceded, clean sheets | Completed matches |
| Biggest win, most goals in a match | Personal bests across completed matches |
| Shootouts won and lost, penalties saved | Penalty shootout mode. A save is the player's keeper stopping a kick (a miss isn't a save). |
| Recent matches | The last 20 matches and shootouts (the screen shows 10) |

Wins per difficulty and the countries won with are also kept, for the achievements below. The Records screen uses words and numbers (no charts), and says where the data is stored.

## Achievements

All ten are visible from the start, with their conditions, on the Records screen. When one unlocks, the full-time screen lists it in one quiet line, also announced to screen readers. There are no pop-ups during play and no animation. Ids are permanent (`src/game/achievements.ts`).

| Id | Name | Condition |
|---|---|---|
| `first-goal` | First Goal | Score a goal in a match |
| `first-win` | First Victory | Win a match |
| `clean-sheet` | Clean Sheet | Finish a match without conceding |
| `hat-trick` | Hat-trick | One of your players scores three in a match (own goals don't count) |
| `comeback` | Comeback | Win after being two goals behind |
| `win-hard` | Top Level | Win a match on Hard |
| `three-countries` | Around the World | Win matches with three different countries |
| `shootout-win` | Nerves of Steel | Win a penalty shootout |
| `penalty-save` | Safe Hands | Save a penalty in a shootout |
| `tutorial-complete` | Ready to Play | Complete the tutorial without skipping a step |

**Reachable by everyone.** Every achievement except *Top Level* can be earned at Beginner difficulty, with any control scheme and any team composition.

**Left out on purpose:**
- "Play 100 matches" style grind;
- anything time-limited or based on streaks;
- anything that rewards repetition rather than skill or variety;
- conditions the simulation can't detect reliably.

**Planned:** *Reach the knockouts* and *Win the trophy*, with the [tournament](tournament-plan.md).

## Progression

No levels or experience points. Progression is the **difficulty ladder** (already suggested at full time) and the records above. The full-time hint can draw on statistics, for example "You've won 3 of your last 4 on Easy: try Medium?". Keep it one line, phrased as an invitation.

## Saved data and privacy

Statistics and achievements are saved in the player's browser only, never sent anywhere. Clearing site data deletes them. *Settings → Saved data* exports a backup, imports one (checked and confirmed first), and offers two confirmed resets. Details and the file format: [persistence](../architecture/persistence.md).

## Tests

`tests/progress.test.ts`:
- every counting rule (including shootout saves and duplicate matches);
- each achievement unlocking, and not unlocking;
- unlocking only once;
- a summary from a real simulated match;
- persistence, damaged data and blocked storage;
- export, import and reset.
