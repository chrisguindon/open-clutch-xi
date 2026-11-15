# 0005. Use rules profiles, with officials that display decisions but never make them

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

Players could carry a throw-in around the pitch, and restarts weren't governed by the Laws of the Game. Full IFAB rules (offside, cards) suit 11-a-side, but they slow down small-sided arcade play. Referees needed to be meaningful, without being random.

## Decision

- **Two rules profiles** (`src/sim/rules.ts`): **Standard** for 11v11 and **Arcade** for 3v3 and 5v5. Differences are listed in [FOOTBALL_RULES.md](../../gameplay/FOOTBALL_RULES.md).
- **An explicit restart stage machine** (`Match.restartStage`): live → outOfPlay → decision → positioning → ready → live.
  - The taker can't move with the ball; a human taker aims instead.
  - Opponents are kept at the Law distance.
  - A second touch is an offence.
- **Decisions are deterministic,** made from the facts of a situation. For example, foul severity comes from slide, angle and speed.
- **Officials** (`src/sim/officials.ts`) position themselves realistically and *show* decisions that the match made. They never decide anything.

## Rationale

- Recognisable football without punishing small-sided fun.
- Deterministic decisions are fair, explainable, and testable (`tests/rules.test.ts`).
- Separating "decide" from "show" means officials can't contradict the rules engine.

## Consequences

- Each rule simplification must be documented in the rules matrix.
- Some offside nuances (interfering with an opponent; deflections and saves) aren't modelled yet.
