# Player experience review

**Audience:** the maintainer and contributors deciding what to build next. This review looks at the game from the player's side: who plays it, what they go through from first launch to the final whistle, and what would bring them back. Its proposals feed the [roadmap](../development/roadmap.md).

**Method and limits.** The journey was captured with `node scripts/journey-capture.mjs` at desktop (1280×720) and phone (844×390, touch emulation) sizes, read against the code, and compared with the playtesting notes in [known issues](../development/known-issues.md). Emulation and software rendering are not real devices. **Whether the game is fun can only be judged by people playing it.** The findings below are prompts for playtesting, not conclusions.

## Who plays Open Clutch XI

| Persona | Wants | Risk today |
|---|---|---|
| **Young first-timer** (8–12, often playing with family) | Score goals quickly, understand what happened, play again | Dense How to Play text; Medium is the default difficulty; a 10–0 loss ends the fun |
| **Casual football fan** (plays once in a while) | A quick, recognisable match with their country | Nothing to come back for after a few matches |
| **Football-game regular** | Control, depth, challenge, a competition to win | No tournament, no long-term goals, 11v11 AI creates few chances |
| **Learner or contributor** | Readable code, small exercises, a visible result of their change | Covered by the [learning guides](../learning/README.md) |
| **Player with access needs** (keyboard only, reduced motion, low vision) | Every screen usable without a mouse, decisions in words, no flashing | Good base (focus, announcements, reduce motion); needs testing with real assistive technology |
| **Phone or tablet player** | Touch controls that fit; screens that fit | Small landscape screens clipped two screens (now fixed, below) |

## The journey, step by step

| Step | What happens | Finding |
|---|---|---|
| 1. First launch | "How would you like to play?" chooser (keyboard, keyboard and mouse, controller; touch is automatic), then the tutorial offer ("Start tutorial" / "Not now"), then the menu | Clear. The chooser appears over a live AI match, which sets the mood well. |
| 2. Menu | Kick Off (format · difficulty · minutes), Teams & options, Penalty shootout, Practice, Tutorial, Records, How to play, Settings, About | Records now show progress between visits. A "continue tournament" waits for the tournament. |
| 3. Team selection | 32 national teams by region, search, Random; difficulty; 3v3 / 5v5 / 11v11 | Works well. The difficulty hint ("Balanced, competitive football") helps. |
| 4. How to Play | Quick-start cards for the player's device, with the full reference folded away | Was dense text; rewritten (X1). |
| 5. Settings | Game, Graphics, Audio, Controls tabs | Clear, with hints for every setting. |
| 6. First Kick Off | Plays straight away, unless the player skipped the chooser: then the tutorial is offered once | Moved earlier (X4). |
| 7. Kick-off | Line-up intro (skippable), then play | Good presentation. The hint bar shows the kick-off keys. |
| 8. Playing | HUD: score, clock, controlled player, minimap | Readable. |
| 9. Pause | Resume, Restart match, Settings, Controls, Quit to menu | Complete. |
| 10. Full time | Result, stats, then Rematch / Change teams / Main menu | **Was a dead end** (fixed, below): no goal summary, no sense of progress, no suggestion of what to try next. |

## Changes made in this review

Low-risk fixes that needed no product decision:

- **Phone layouts.** On a small landscape screen (844×390) the menu logo was cut off at the top and the full-time buttons were pushed off the screen. Screens now scroll when they don't fit (`justify-content: safe center`), and the full-time actions stay pinned at the bottom of the panel. Checked in phone emulation only.
- **Goal timeline at full time.** The full-time panel lists each team's goals with the minute and scorer, and marks own goals "(o.g.)". The data comes from the simulation (`Match.goalLog`), so it is tested (`tests/rules.test.ts`).
- **A next step after a match.** After a win, the full-time panel suggests the next difficulty up (Beginner → Easy → Medium → Hard). After a loss, it offers one defending tip. It's a single line, never a pop-up, and never pressure to keep playing.

## Findings and their status

| # | Finding | Who it affects | What happened | Status |
|---|---|---|---|---|
| X1 | How to Play was a wall of text | Young first-timers | Now three quick-start cards (move, pass, shoot) for the player's own input method, with the full reference and tips folded underneath | **Done** (needs playtesting) |
| X2 | No reason to return after a few matches | Casual fans, regulars | Local statistics, a Records screen and 10 visible, no-pressure achievements ([progression](progression.md)). The tournament is planned. | **Partly done** |
| X3 | Medium was the default difficulty | Young first-timers | New players start on **Easy**. Returning players keep their choice; saved settings from before the change keep Medium. | **Done** |
| X4 | The tutorial offer appeared at the first Kick Off | First-timers | Offered straight after the controls chooser on first launch ("Not now" goes to the menu). Players who skip the chooser are still asked once at Kick Off. | **Done** (needs playtesting) |
| X5 | 11v11 AI creates few chances | Regulars | On the roadmap ([known issues](../development/known-issues.md)) | Open (P2) |
| X6 | No half-time, substitutions or extra time | Regulars | Needed by tournament knockouts (extra time); see the [rules matrix](FOOTBALL_RULES.md) | Open (P2) |
| X7 | Accessibility not tested with real assistive technology | Players with access needs | A screen-reader and keyboard-only pass on real devices before v0.1.0 | Open (P0 testing) |
| X8 | Everyone shared one male body | Everyone | Women players and mixed squads (*Teams* setting: mixed, women or men), with identical gameplay | **Done** (needs visual review) |

## Modes

| Mode | Assessment |
|---|---|
| Quick Match | The core of the game, and complete |
| Penalty shootout | A good short session. Could become a skill challenge with a personal best. |
| Practice | Useful, but has no goal. Skill challenges would give it one. |
| Tutorial | Reliable (watchdog, retry, skip), and short |
| **Missing** | A competition (tournament), skill challenges, local two-player (the input architecture already allows a second `InputFrame`) |

## Replayability: what happens after the final whistle

Today a match ends with a result and three buttons. Nothing is remembered: the next session starts exactly like the first. Players come back to a game like this for three reasons, in roughly this order:
1. **A goal to work towards:** win the tournament with my country, beat Hard.
2. **Visible improvement:** my win rate rising, my best penalty streak.
3. **Variety:** different teams, formats, times of day, and challenges.

Open Clutch XI has variety, but neither of the first two. The proposals below add them **locally, without accounts, tracking or pressure**.

## Proposed features

Each has its own plan with acceptance criteria. None is implemented yet: they are proposals for the maintainer to approve.

- **[Tournament](tournament-plan.md):** a fictional international competition with groups and knockouts, saved between sessions (planned; the 54-team catalogue is done).
- **[Statistics, achievements and progression](progression.md):** local records, and achievements that recognise play without manipulative mechanics (implemented).
- **[Local persistence](../architecture/persistence.md):** the storage foundation, with export, import and reset (implemented).
- **Skill challenges:** short, repeatable drills on the practice pitch (finishing, passing through gates, penalties against the keeper), each with a local personal best. They reuse the tutorial's event-driven step machinery.

Priorities and the recommended v0.1.0 scope are in the [roadmap](../development/roadmap.md).

## What this review doesn't claim

- No usability study with real players has been done. The personas are assumptions to test.
- Phone results come from emulation, not real devices.
- Fun, difficulty balance and readability need people: see the [playtesting guide](../development/playtesting.md).
