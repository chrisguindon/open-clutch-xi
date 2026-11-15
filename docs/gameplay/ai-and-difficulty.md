# AI and difficulty

**Audience:** contributors improving computer players or balance. Design rationale: [ADR 0006](../architecture/decisions/0006-explainable-utility-ai.md).

## How the AI decides

- **Roles each tick** (`TeamBrain`):
  - with the ball: carrier, supporters looking for open angles, runners timing runs in behind the defensive line, shape-holders. In 11v11, once the carrier is within about 26 m of goal, forwards and then midfielders attack distinct spots (near post, penalty spot, far post, edge of the box for a cut-back), always onside;
  - without it: a goal-side presser who jockeys, then tackles when the ball is exposed; cover; markers on the most dangerous opponents; zonal shape;
  - loose ball: the earliest chaser on each team.
- **Ball carrier: utility scoring.** Every option gets a score, and the best one wins. Difficulty adds Gaussian noise, so weaker AI chooses sub-optimally rather than randomly.
  - **Shoot:** shot quality (opening angle × distance × blockers × keeper coverage) at the best aim point. Needs quality ≥ max(threshold × 0.5, 0.07), comes from inside 27 m, and has a long-range penalty.
  - **Pass / through ball:** `success² × (base + value gain) − failure × loss cost`.
    - Success checks the passing lane: who can reach the ball's path first. Only the two most dangerous defenders count, because a pass is lost to the first one there; multiplying every defender's risk used to make most passes in a crowded 11v11 final third look hopeless.
    - It also checks the **reception point** for passes into space and crosses (who reaches the target first), and pressure on the passer.
    - In 11v11, a pass to a wide player in the crossing zone counts as progress when team-mates are in the box.
  - **Cross:** needs an estimated success above 0.5 (0.35 in 11v11, where runners attack the box). It leads the runner, and keepers claim high balls in their area.
  - **Dribble:** seven directions, scored by progress, space and pressure.
  - **Hold or shield:** builds *impatience*, which favours progress over endless recycling.
  - **Clear:** keepers, and outfielders under pressure deep in their own half. Aimed at the least-contested landing spot, or into touch, and never towards their own goal.
- **Restarts.** Takers pass to the best option, skipping passes under 30% likely to succeed. The fallback long ball aims at open space and never into touch. Free kicks near goal are shot when the quality is good. AI takers never touch a restart twice.
- **Rules awareness.** AI players respect dead balls (they can't touch the ball during a restart), the restart distances, and offside: runs are timed against the last defender, and AI-vs-AI 11v11 produced no offsides in testing.
- **Explainability.** Press **F3** in a match. The *AI decision* section shows the latest carrier decision, its score and reason, and the runners-up.

## Difficulty

Difficulty changes **cognition and accuracy only**: reaction time, decision interval and noise, pass and shot error, pressing, interception awareness, tackle timing, keeper reaction and positioning, vision and marking. Speeds and physics are identical for every team.

| Level | Intended for |
|---|---|
| **Beginner** | First-time players: late reactions, little pressing, loose marking, poor finishing |
| **Easy** | Casual players: time on the ball |
| **Medium** | Balanced, competitive football |
| **Hard** | Smart pressing, tight marking, clinical finishing |

Your AI team-mates always play at Medium. Both teams use **the same formation**. Previously, the player's side had a weaker 5v5 formation, which lost 2–14 over 24 equal-skill matches.

**Measured ladder.** Proxy: an AI side at Easy level (standing in for a newer player with Medium team-mates) against each opponent difficulty. 5v5, 24 matches of 4 minutes, seeds 900–923:

| Opponents | Goals for–against | Won / lost |
|---|---|---|
| Beginner | 1.71–0.83 | 12 / 4 |
| Easy | 1.46–1.00 | 12 / 7 |
| Medium | 0.58–2.04 | 1 / 18 |
| Hard | 0.17–3.50 | 0 / 23 |

This is a model of a player, not a person. Whether Beginner is fair for real newcomers needs playtesting (see the [playtesting guide](../development/playtesting.md)).

## Measuring AI quality

- `npm run report:ai` plays seeded AI matches and flags decisions a spectator would call irrational. It also checks that pass estimates are **calibrated**: passes rated 85–95% likely completed about 98% of the time on Medium. It writes to `test-results/`.
  - passes rated safe but intercepted (misreads)
  - passes out of play
  - hopeless long shots
  - clearances to opponents or backwards
  - own goals
- `npm run report:attack` plays seeded matches per format and difficulty and reports shots, shots on target, goals, crosses (and how many reach a team-mate), final-third entries and pass completion per match minute. Use it to compare a change before and after.
  - Measured with 12 seeds × 4 minutes, AI against AI, before and after the 11v11 attacking changes: goals per minute roughly doubled on Beginner (0.10 → 0.21), Easy (0.06 → 0.13) and Hard (0.08 → 0.15); Medium went from 0.13 to 0.15; shots per minute stayed flat (about 0.5–0.75); 5v5 shots per minute fell slightly (3.58 → 3.25) while goals rose (0.69 → 0.79).
  - Small samples are noisy. These figures guide tuning; they don't prove the game is fun.
- `tests/ai-decisions.test.ts` holds scenarios plus a fixed-seed regression audit, for example "no clearances towards our own goal", "fewer than 2.5 misread passes per 100 kicks", "risks from many defenders don't pile up" and "attackers take distinct onside spots in the box".
- Always compare over many seeds (see [testing](../development/testing.md)).

## Penalties

Shootout balance is tuned in `PEN_TUNING` (`src/sim/match.ts`) and modelled with `src/dev/penaltySim.ts` (`npm run report:penalties`). Outcome rates come from modelled players over 200 kicks per row, using the real physics.

| Your shot vs computer keeper | Beginner/Easy | Medium | Hard |
|---|---|---|---|
| Good (corner, 60–80% power) | ~100% goal | ~80% | ~64% |
| Central | ~50% | ~48% | ~46% |
| Full power (over-hit) | ~50% miss | ~64% miss | ~73% miss |

| Your keeper reading the computer's run-up tell | Easy | Medium | Hard |
|---|---|---|---|
| Save rate | ~62% | ~56% | ~55% |

(Beginner values are tuned to be at least as forgiving as Easy; rerun the report after changes.) Real football converts around 75% of penalties. Easy is intentionally forgiving.

**Timing cues show timing only**: "Watch the run-up", then "Get ready…", then "DIVE!". They never show the destination.
