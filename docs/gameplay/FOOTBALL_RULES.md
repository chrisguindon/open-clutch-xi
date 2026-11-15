# Football rules in Open Clutch XI

**Audience:** players who want to know which rules apply, and contributors who change rules or restarts.

**Reference:** IFAB *Laws of the Game 2026/27* (https://www.theifab.com/laws-of-the-game-documents/). Open Clutch XI is a video game, so it *adapts* the Laws. Where it simplifies them, that's stated below. The game's own small-sided rules are not IFAB rules.

**Code:**
- **Rules engine:** `src/sim/rules.ts` (rules profiles, offside, foul severity, sanctions) and `src/sim/match.ts` (decisions, restarts, advantage, cards, the restart state machine).
- **Match officials:** `src/sim/officials.ts`. They display decisions; they never make them.
- **Tests:** `tests/rules.test.ts`, plus `tests/match.test.ts`, `tests/penalties.test.ts` and `scripts/rules-check.mjs` (browser).

## Rules profiles

| Profile | Used for | Summary |
|---|---|---|
| **Standard** | 11v11 | Recognisable Laws: offside, cautions and sendings-off, advantage, 9.15 m at free kicks, corners and kick-offs, opponents outside the area at goal kicks, the five-second throw-in countdown, assistant referees. |
| **Arcade** | 3v3, 5v5 | Faster small-sided play: no offside, no cards (fouls still give free kicks and penalties), 5 m restart distance, no assistants, the AI helps a player who stalls at a restart. |

Both profiles share the same restart state machine, ball-out detection, second-touch rule and direct-goal rules. Neither can be exploited by carrying the ball at a restart. The 2026/27 five-second countdown applies only to deliberate delay (see Law 15).

## The restart state machine (Laws 8, 9, 13–17)

```
live ──ball out / foul / offside──► outOfPlay ──► decision ──► positioning ──► ready ──restart taken──► live
                                   (whistle,     (banner,      (opponents to     (the taker may
                                    flag)         referee       the Law distance;  play the ball once)
                                                  points)       taker placed)
```

- `Match.restartStage` exposes the stage (`'live' | 'outOfPlay' | 'decision' | 'positioning' | 'ready'`). Controls, AI, HUD and tests read it.
- **The taker can't move with the ball.** At every restart their movement is zeroed. A human taker's stick turns them to aim instead. The taker can't dribble, skill or tackle. This fixes the defect where a player could carry a throw-in around the pitch (`tests/rules.test.ts`, *"the thrower cannot walk or run with the ball"*, and step 4–5 of `scripts/rules-check.mjs`).
- **No restart before `ready`** (0.4 s for positioning). A kick pressed early is remembered and taken the moment the restart is ready, so input is never lost.
- **Opponents keep their distance** every step until the ball is in play: 2 m at throw-ins, 9.15 m (Standard) or 5 m (Arcade) at free kicks and corners, outside the area at goal kicks, and outside the centre circle and in their own half at kick-offs.
- **Second touch:** the taker may not touch the ball again until another player has. AI takers don't. A human who does concedes an indirect free kick.
- **Never stuck:** `tests/rules.test.ts` plays whole AI matches in every format and checks that dead-ball spells end and no taker dribbles. Arcade matches also let the AI take a restart that a human taker ignores for 8 s. In Standard, a hesitant thrower gets a hurry-up cue, and only deliberate delay leads to the countdown.

## Law-by-law matrix

**Status key:**
- ✅ supported
- 🟡 adapted or simplified (documented)
- ⛔ not supported

**Profiles:** **S** = Standard, **A** = Arcade, **All** = every match mode. Penalty shootouts follow their own section.

| Law | Official requirement (summary) | Open Clutch XI implementation | Modes | Status | Simplifications, missing parts and known defects | Tests |
|---|---|---|---|---|---|---|
| **1 · Field of play** | Rectangular field with touch and goal lines, halfway line, centre circle 9.15 m, penalty and goal areas, corner arcs, goals 7.32 × 2.44 m | Three pitch sizes (`PITCHES` in `src/sim/config.ts`). 11v11 uses full-size dimensions; 3v3 and 5v5 use smaller pitches and goals. | All | 🟡 | Small-sided pitches and goals are scaled down (Arcade). No technical areas. | `tests/match.test.ts` |
| **2 · Ball** | Spherical, size 5 | Physical ball: drag, Magnus effect, bounces, rolling (`src/sim/ball.ts`) | All | ✅ | No ball replacement (the ball never deflates or goes into the crowd). | `tests/ball.test.ts` |
| **3 · Players** | Up to 11 per team including a keeper; at least 7; substitutions | 3, 5 or 11 per side, always with a keeper. Sent-off players leave for the rest of the match (Standard). | All | 🟡 | No substitutions, no minimum-players abandonment. Keepers are never sent off (a reckless keeper is cautioned) because there is no substitute keeper. | `tests/rules.test.ts` (*sent-off player takes no further part*) |
| **4 · Equipment** | Kits contrast with each other and with officials; keepers distinct | Kit-clash resolution picks away kits (`resolveKits`). Keepers wear distinct kits. Officials' kit colour is chosen to contrast with both teams and both keepers. | All | ✅ | No jewellery or footwear checks (not meaningful in a game). | `tests/teams-kits-and-bindings.test.ts` (kits) |
| **5 · Referee** | Authority, decisions, advantage, disciplinary action, signals | `Officials` show decisions made by the rules engine: whistle and point the restart direction, raised arm for indirect free kicks (kept up until another player touches the ball), advantage, yellow and red cards, goal. Advantage is played when the fouled team keeps the ball in a promising position; if possession is lost within 2.5 s, play goes back to the foul. Cards held back during advantage are shown at the next stoppage. | All (cards: S) | ✅ | No dropped ball, no injuries or stoppages for treatment. Decisions are deterministic (same facts, same decision). | `tests/rules.test.ts` (*advantage*, *officials*) |
| **6 · Other match officials** | Assistant referees signal offside, throw-ins, corners, goal kicks | Two assistants (Standard) patrol a half each, level with the second-last defender or the ball. They flag offside (flag up), throw-in direction, corners and goal kicks. | S | 🟡 | No fourth official, no VAR. Flags only show decisions the engine made. | `tests/rules.test.ts`, `scripts/rules-check.mjs` |
| **7 · Duration** | Two halves of 45 min, half-time, added time | One period of 2–8 real minutes, shown as 0–90′ on the clock. The clock runs slower during stoppages. A shot already in flight at full time is allowed to finish. | All | 🟡 | No halves, half-time, change of ends, added time or extra time. | `tests/match.test.ts` (full time) |
| **8 · Start and restart** | Kick-off: everyone in their own half, opponents 9.15 m away (outside the circle), ball kicked and clearly moving; dropped ball | Kick-offs at the start and after goals, by the conceding team. Positions are enforced; taker can't touch twice. | All | 🟡 | Arcade: the human kick-off taker may only pass, not shoot directly (allowed by the Laws). No dropped ball. | `tests/rules.test.ts` (*kick-off*), `tests/match.test.ts` |
| **9 · Ball in and out of play** | Out when the whole ball crosses the goal line or touchline, on the ground or in the air, or when play is stopped | Detected when the whole ball (centre + radius) crosses a line. Throw-ins, corners and goal kicks are awarded from the last touch. | All | ✅ | The ball never hits a match official (officials have no collision). | `tests/match.test.ts`, `tests/rules.test.ts` |
| **10 · Outcome** | Goal when the whole ball crosses the goal line between the posts and under the bar; winner; penalties to decide | Goals detected as above. No goal directly from a throw-in or an indirect free kick (goal kick or corner instead). Own goals are credited to the player who put the ball in (shown as "o.g."). That player reacts with dismay, and a player of the benefiting team leads a brief celebration. Penalty shootout mode. | All | ✅ | Matches can end drawn (no extra time or shootout after a match). | `tests/match.test.ts`, `tests/rules.test.ts` (*no goal directly from a throw-in*) |
| **11 · Offside** | Offside *position*: in the opponents' half and nearer the goal line than the ball and the second-last opponent. *Offence*: becoming involved in active play when a team-mate plays or touches the ball. Not from goal kicks, throw-ins or corners. Indirect free kick | Positions are frozen at every touch by a team-mate. An attacker in an offside position who then plays the ball commits an offence, and the assistant flags it. A touch by an opponent resets everything. Indirect free kick where the offence occurred. | S | 🟡 | Only *interfering with play* (touching the ball) is detected; *interfering with an opponent* (blocking the keeper's view, challenging) isn't. Any opponent touch resets offside, including deflections and saves, where the Law wouldn't reset it. Players are points with a 0.15 m tolerance in the attacker's favour. | `tests/rules.test.ts` (*offside*) |
| **12 · Fouls and misconduct** | Careless (foul), reckless (caution), excessive force (sending-off); handball; holding; DOGSO and SPA; second caution = red | Fouls come from physical challenges: a slide that takes the player, or a clumsy challenge through the back. Severity comes from the facts (slide, angle from behind, speed): careless gives a free kick, reckless a caution, excessive force a sending-off. A second caution is a red card. Fouls in the offender's penalty area are penalties. | All (cards: S) | 🟡 | No handball, holding, pushing, dissent or DOGSO and SPA judgements. No temporary dismissals. Keepers aren't sent off (see Law 3). | `tests/rules.test.ts` (*fouls, advantage and cards*) |
| **13 · Free kicks** | Direct and indirect; stationary ball; opponents 9.15 m away; walls of 3+ with attackers 1 m away; no direct goal from an indirect kick | Direct free kicks for fouls; indirect for offside and second touches. Opponents at the profile distance. Walls of 2–3 defenders at 9.15 m for direct free kicks within 30 m of goal. AI takers shoot or pass by shot quality. | All | 🟡 | No quick free kicks (the restart is always set up). The 1 m attacker-to-wall rule isn't enforced. Indirect free kicks inside the goal area aren't moved to the goal-area line. | `tests/rules.test.ts` (*wall*, *indirect signal*) |
| **14 · Penalty kick** | From the penalty mark; keeper on the line between the posts until the kick; other players outside the area and arc; kicker plays forward, no second touch | In-match penalties: the box is cleared, the keeper is on the line, and the kicker can't touch the ball again before another player. Shootout mode with tells, early-dive punishment and difficulty tuning (`PEN_TUNING`). | All | 🟡 | Encroachment and keeper movement off the line before the kick aren't penalised. In-match rebounds play on normally. | `tests/penalties.test.ts`, `tests/match.test.ts` |
| **15 · Throw-in** | Awarded against the last toucher where the ball left; thrower faces the field, part of each foot on or behind the line, both hands from behind and over the head; opponents 2 m away; no direct goal; no second touch; **five-second countdown** for delays (2026/27) | Awarded and placed correctly. The thrower holds the ball overhead and can't move (they turn to aim), then throws with a two-handed overhead animation. Shot requests become long throws. Opponents at 2 m. No direct goal. Second touch gives an indirect free kick. **Standard:** if the thrower hesitates, the referee first asks for the throw (a hurry-up cue after 5 s). The visible five-second countdown, after which the throw-in goes to the opponents, starts only for a delay the referee judges **deliberate**: time-wasting while level or ahead from 75′, or an obvious stall of 15 s or more. Normal restarts and AI throw-ins never get a countdown. | All (countdown: S) | 🟡 | The thrower stands on the line rather than behind it, and foot faults can't happen. There is no foul-throw offence (every throw is legal). Arcade: the AI helps a stalled thrower after 8 s instead of the countdown. | `tests/rules.test.ts` (*throw-ins*, *countdown*), `scripts/rules-check.mjs` |
| **16 · Goal kick** | Ball over the goal line last touched by an attacker; any point in the goal area; in play once kicked and clearly moving; opponents outside the area; no second touch; countdown for delays (2026/27) | Awarded correctly, taken by the keeper from the goal area. Standard: opponents leave the penalty area. In play once kicked. | All | 🟡 | The keeper always takes it promptly, so the countdown never applies. Arcade doesn't clear the area. | `tests/rules.test.ts` (*goal kick*) |
| **17 · Corner kick** | Ball over the goal line last touched by a defender; from the corner area; opponents 9.15 m away; no second touch; a goal may be scored directly | Awarded at the correct corner; opponents at the profile distance; the assistant flags it. AI takers cross into the box. | All | ✅ | No short-corner routines. | `tests/rules.test.ts` (*corner*), `tests/match.test.ts` |

## Penalty shootout mode

- Best of five, then sudden death. Shots and keeping alternate.
- Your shots use an aim reticle (aiming outside the frame misses) and a power bar (over-hitting lifts the ball).
- As keeper you choose a side; the height is automatic after the strike. Computer shooters show a run-up "tell" that is honest more often on easier levels. Diving well before the strike may be punished.
- **The keeper may touch the ball from the moment of the kick.** Previously, the ball was reserved for the shooter during its flight, so no penalty could ever be saved. A regression test guards this.
- Balance targets and measured outcome rates are in [ai-and-difficulty.md](ai-and-difficulty.md#penalties).

## Decisions are communicated in words

Every decision produces:
- a banner with a plain-language description (for example "Throw-in to Brazil", "Yellow card for J. Silva, France");
- a polite screen-reader announcement;
- the official's signal.

Decisions are never shown only by colour: cards are also named in text.

## Adding or changing a rule

1. Find the relevant Law text in the IFAB reference.
2. Put pure logic in `src/sim/rules.ts` and the decision in `src/sim/match.ts`. Make the officials *display* it.
3. Add deterministic tests to `tests/rules.test.ts`. Use synthetic `ballTouch`, `kick` and `foul` events for precise scenarios, and full AI matches for "never stuck" checks.
4. Update this matrix: the row's implementation, status and simplifications.
