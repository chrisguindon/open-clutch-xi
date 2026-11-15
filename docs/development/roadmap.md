# Roadmap and backlog

**Audience:** the maintainer and contributors looking for meaningful work. Open Clutch XI is in active development. v0.1.0 is planned as a public beta, not a finished game. Priorities change with playtesting and community feedback. Each item should become (or link to) a GitHub issue.

## Prioritised comparison

From the [player experience review](../gameplay/EXPERIENCE_REVIEW.md). Value is for players; risk is the chance of destabilising what works. **P0** = needed before v0.1.0; **P1** = next; **P2** = planned; **P3** = later or only if a need appears.

| Candidate | Player value | Effort | Risk | Needs a decision? | Priority |
|---|---|---|---|---|---|
| Real-device and accessibility pass (phones, controllers, screen reader, keyboard only) | High: trust | Small | None | No | **P0** |
| Playtesting fixes (restarts, referees, celebrations, Beginner, controls) | High | Small, ongoing | Low | No | **P0** |
| Release decisions: copyright holder, repository URL | — | Small | None | **Yes (human)** | **P0** |
| Women players and mixed teams (below) | High: everyone sees themselves | Medium | Medium (kit shader, hair fit) | — | **Done**: needs visual review |
| Simpler How to Play (pictures first, tutorial button) | High for first-timers | Small | Low | No | **Done**: needs playtesting |
| First-launch difficulty | Medium | Tiny | Low | Decided: Easy | **Done** |
| Local statistics, plus persistence reset, export and import ([progression](../gameplay/progression.md), [persistence](../architecture/persistence.md)) | Medium: visible improvement | Small to medium | Low | — | **Done** |
| Tournament, Short and Classic ([plan](../gameplay/tournament-plan.md)). The 54-team catalogue is done. | High: a lasting goal | Medium to large | Medium (new screens, saves) | **Yes: the name** | **P1** |
| Achievements (visible, non-manipulative) | Medium | Small, after statistics | Low | — | **Done** (10) |
| Skill challenges (finishing, passing gates, penalties) with personal bests | Medium | Medium (reuses the tutorial machinery) | Low | No | **P2** |
| 11v11 AI chance creation and crosses | Medium for regulars | Medium | Medium (AI balance; measure with many seeds) | No | **P2** |
| Extra time, half-time and change of ends | Medium (needed by knockouts) | Medium | Medium (rules, restarts) | No | **P2** |
| Expanded 48-team tournament format | Low | Small after Classic | Low | No | **P3** |
| Local two-player | Medium | Medium | Medium | No | **P3** |
| Any server feature (sync, leaderboards) | Low today | Large | High (privacy, cost) | **Yes** | **P3: not planned** ([why](../architecture/persistence.md#future-server-side-options-no-backend-now)) |

## Recommended v0.1.0 scope

Release what exists, made dependable, rather than adding another large feature first:
- **In:**
  - the current modes (Quick Match, penalties, practice, tutorial);
  - women, men and mixed squads;
  - 54 national teams;
  - the new How to Play and first-launch flow;
  - local statistics, achievements, and saved-data export, import and reset;
  - the P0 rows above.
- **Not in v0.1.0:** the tournament. It builds on a release players have actually tried, and its plan and architecture are ready.
- **Before v0.1.0,** a person should review the new things that only people can judge:
  - women's and men's kits and hair close up;
  - the 22 new teams' kits;
  - How to Play with a young first-time player;
  - the Records screen on a phone.

The maintainer decides when v0.1.0 is ready; this is a recommendation, not a release plan.

## Women players and mixed teams (implemented)

**Goal:** playable women, and mixed teams, with **identical gameplay capabilities** (speed, strength, skill and AI logic don't depend on appearance), and respectful, non-stereotyped presentation.

**What exists:** the *Teams* setting (mixed, women, men). There are two CC0 base bodies with the same 65-joint skeleton, sharing animations through per-body retargeting; kits fitted by skeleton landmarks; and hair moved to each body's head. A test checks that nothing in the simulation can see appearance (`tests/inclusive-players.test.ts`). See [animation](../gameplay/animation.md).

**Still to do:**
1. **Human visual review** of both bodies in every kit pattern, close up and in play, including the goalkeeper kit and celebration gestures. The automated checks can't judge how it looks.
2. **More variety:** the CC0 pack has a limited set of faces and hairstyles. Look for further CC0 hairstyles that fit the skeleton.
3. **Officials** use a fixed mixed pattern. Consider following the *Teams* setting.
4. **Performance on real low-end phones:** the second body adds about 0.7 MB of downloads and a few quaternion multiplications per bone for its players. This was measured only in software rendering.

## Next milestone: XI Nations Cup

The tournament is the next feature, now that the playtest defects (tutorial, camera, celebrations, lighting, hair, 11v11 attack) are addressed. The plan, architecture and acceptance criteria are in the [tournament plan](../gameplay/tournament-plan.md). The order of work:
1. pure engine with tests: draw, fixtures, standings, tie-breakers, result model;
2. the `tournament-v1` saved record;
3. the hub screen (standings, bracket, next match) and integration with full time;
4. trophy presentation;
5. browser checks of a full tournament.

## Playtesting feedback (P0)

Fix what playtesting finds in restarts, referees, celebrations, Beginner difficulty and controls (see the [playtesting guide](playtesting.md)).

## Later

- **AI:** 11v11 chance creation and AI crosses (see [known issues](known-issues.md)).
- **Rules:** offside "interfering with an opponent", handball, half-time and change of ends, substitutions (see the [rules matrix](../gameplay/FOOTBALL_RULES.md)).
- **Animation:** knee slides and team huddles with contact poses; dedicated recorded celebration clips (CC0 only).
- **Devices:** validation on real phones, tablets, controllers and high-refresh monitors.
- **Performance:** measurements from real low-end devices, fed back into the adaptive quality ladder.
