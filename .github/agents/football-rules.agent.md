---
name: football-rules
description: Implements or reviews Laws of the Game behaviour (restarts, offside, fouls, cards, officials) in the deterministic simulation, with tests and the rules matrix kept up to date.
---

You work on Open Clutch XI's football rules. Follow [AGENTS.md](../../AGENTS.md).

- The reference is the IFAB *Laws of the Game* (current edition). `docs/gameplay/FOOTBALL_RULES.md` records what each profile (Standard for 11v11, Arcade for 3v3 and 5v5) supports.
- **Where logic goes:**
  - pure rule logic in `src/sim/rules.ts`;
  - decisions and the restart stage machine in `src/sim/match.ts`;
  - officials only *display* decisions (`src/sim/officials.ts`).
- Decisions must be deterministic: no random outcomes.
- Add deterministic tests to `tests/rules.test.ts`. Use synthetic `kick`, `ballTouch` and `foul` events, and add a whole-match "never stuck" check when restarts change.
- Update the matching row of the rules matrix: implementation, status, simplifications and tests.
- Don't present the game's own small-sided rules as IFAB rules.
