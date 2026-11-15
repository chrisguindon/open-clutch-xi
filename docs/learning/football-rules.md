# Learning guide: football rules in code

**You'll learn:** how the Laws of the Game become deterministic, testable code: offside, fouls, cards and restarts. **Prerequisites:** basic football knowledge helps; the [game loop](game-loop.md) guide. **Read alongside:** `src/sim/rules.ts` (pure rules), `src/sim/match.ts` (decisions), `src/sim/officials.ts`, and the [rules matrix](../gameplay/FOOTBALL_RULES.md).

## Where rules live

| Layer | File | Does |
|---|---|---|
| **Pure rules** | `rules.ts` | Functions with no state: "is this offside?", "how severe is this foul?", "what sanction?" Easy to test. |
| **Decisions** | `match.ts` | Watches world events (touches, ball out, fouls), calls the pure rules, and decides: a free kick, a throw-in, a goal |
| **Display** | `officials.ts`, `ui.ts` | The referee and assistants signal; the HUD announces decisions **in words**. Officials never decide. |

Keeping decisions in the simulation means the same situation always gets the same decision, there's no randomness in refereeing, and tests can check every Law without a browser.

## Two rules profiles

- **Standard** (11v11): offside, cards, advantage, 9.15 m at free kicks and corners, the goal-kick area rule, assistant referees.
- **Arcade** (3v3, 5v5): no offside, fouls without cards, shorter restart distances. These are **the game's own simplifications, not IFAB rules**, and the docs always say so.

See `RULES` in `rules.ts`.

## Offside, as code

Law 11 compares an attacker's position with the **second-last defender** (usually the last outfield player, because the keeper is last) at the moment a team-mate plays the ball. `offsideLine()` finds that line; the match takes a **snapshot** of who was offside at each touch, and penalises only if that player then plays the ball. (Other kinds of involvement, such as interfering with an opponent, aren't modelled yet: see the matrix.) No offside from a goal kick, throw-in or corner (`offsideExemptRestart`).

## Fouls are judged from facts

The world reports the physical facts of a challenge: was it a slide, the angle from behind, the tackler's speed. `foulSeverity()` maps them to Law 12.1's categories:
- **careless:** a foul only;
- **reckless:** a caution (yellow card);
- **excessive force:** a sending-off (red card).

A second caution means a sending-off. The same challenge always gets the same decision.

## The restart stage machine

Every restart (throw-in, corner, goal kick, free kick, kick-off) moves through the same stages (`RestartStage` in `match.ts`):

```
live → outOfPlay → decision → positioning → ready → live
```

- **outOfPlay:** a short pause; the referee whistles.
- **decision:** the restart type and team are chosen; officials signal.
- **positioning:** players walk to legal positions (opponents 9.15 m away, a wall at free kicks).
- **ready:** the taker may play. **Takers never move with the ball** (a bug that once let players walk with a throw-in).

One machine for every restart means one place to get right, and one set of tests (`tests/rules.test.ts`).

## Try it

- **Exercise B4** reads a rules test and predicts its result.
- **Exercise A3** adds a rule end to end: pure function, decision, announcement, test, matrix row.

Both are in [exercises](exercises.md). [Adding or changing a rule](../gameplay/FOOTBALL_RULES.md#adding-or-changing-a-rule) is the checklist.
