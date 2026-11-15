# 0006. Use explainable utility AI where difficulty changes cognition, not physics

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

Computer players must make sensible, varied decisions at several difficulty levels. Players and contributors need to understand *why* the AI did something.

## Decision

- **Utility scoring.** The ball carrier scores every option (shoot, each pass, through balls, crosses, dribble directions, hold, clear) and picks the best. Each option carries a human-readable reason, shown in the F3 overlay.
- **Difficulty** (`AI_PROFILES`) changes reaction time, decision interval and noise, pass and shot accuracy, pressing, interception awareness, tackle timing, keeper reactions and vision. It **never changes speed or physics**.
- **Both teams use the same formation,** so neither side starts with a structural handicap.
- AI quality is measured with an **audit over many seeded matches** (`src/dev/aiAudit.ts`). It flags irrational decisions and checks that pass estimates are calibrated.

## Rationale

- Deterministic and explainable: the same situation gives the same scores, apart from difficulty noise.
- Difficulty that only changes cognition keeps the game fair: no impossible physical advantages.
- Many-seed measurement avoids tuning to noise. A single match varies by ±30%.

## Consequences

- Changes to evaluation or utilities should be checked with `npm run report:ai` and `npm run metrics`, using 30+ seeds where possible.
- No machine-learning models or external AI services: they would be neither deterministic nor explainable.
