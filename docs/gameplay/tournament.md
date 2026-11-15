# XI Nations Cup

**Audience:** players and contributors. The design and its history are in the [tournament plan](tournament-plan.md); this page describes what the game does.

The **XI Nations Cup** is the game's own, fictional international tournament: a group stage, then knockouts, then a trophy. It is not a real competition, uses none of a real competition's names, logos, trophy or sponsors, and implies no endorsement. Its name comes from `BRAND.tournamentName` in `src/brand.ts`.

## Playing a cup

1. Main menu → **XI Nations Cup**.
2. Choose **Short** or **Classic**. Your team is the one picked as *You* in Teams & options (**Change team** opens it).
3. Every match you play uses the format (3v3, 5v5 or 11v11), difficulty and length set in Teams & options when the cup starts. They stay the same for the whole cup.
4. The hub shows your next opponent, your group's table, your results and the knockout bracket. **Play match** starts your next match: an ordinary match with the usual rules for its format.
5. After each match, the full-time screen says what comes next. **Continue the cup** returns to the hub.

Only one cup is in progress at a time. It's saved after every match, so you can close the browser between matches and carry on later. Quitting *during* a match replays that match: nothing is decided until the final whistle. **Abandon cup** asks first, then discards the cup (your match statistics stay). A finished cup goes into *Past cups*.

## Formats

| Format | Teams | Groups | Knockouts | Most matches you play |
|---|---|---|---|---|
| **Short** | 16 | 4 groups of 4 | Quarter-finals, semi-finals, final | 6 |
| **Classic** | 32 | 8 groups of 4 | Round of 16, quarter-finals, semi-finals, final | 7 |

- **The draw** picks your opponents at random from the 54 national teams, and spreads teams from the same region across groups, like the pots of a real draw.
- **Groups:** each group is a round robin over three matchdays. The top two go through. Group winners meet runners-up in the first knockout round, and two teams from the same group can only meet again in the final.

## Group tables and tie-breakers

3 points for a win, 1 for a draw. Teams level on points are separated by, in order:
1. goal difference;
2. goals scored;
3. points in the matches between the teams still level;
4. a drawing of lots.

The drawing of lots is decided by the cup's seed. A given cup always ranks the same way, and reloading can't change it. These criteria are the game's own, similar to real competitions'. The hub states them under each table.

## Knockout draws go straight to penalties

A knockout match level at the final whistle goes **straight to a penalty shootout** (five kicks each, then sudden death), played in the usual shootout mode. **This is a game simplification, not the Laws of the Game**, which allow extra time first. The hub says so before every knockout match. See the [rules matrix](FOOTBALL_RULES.md).

## The other matches

You play your own team's matches. Every other match is decided by a small model, not the full 3D simulation, which would take far too long for up to 63 matches:
- each side's goals are drawn from a Poisson distribution averaging 1.3 a match;
- a level knockout match gets a simulated shootout, where each kick is scored three times in four.

**Every team has the same strength.** The national teams differ in identity, not ability, so a cup favours no country. Results are seeded by the cup and the fixture: reloading never rerolls them, and the same seed always produces the same cup.

## Saving

The cup in progress and the history of finished cups are one record, `tournament-v1`, validated strictly on load (see [persistence](../architecture/persistence.md)). It's included when you export your saved data and checked on import. **Reset records** (Settings → Saved data) clears it along with your statistics. Your cup matches also count in your statistics and achievements, like any match played to the final whistle. Two achievements belong to the cup: *Into the Knockouts* and *Champions*.

## For contributors

- **Engine** (`src/game/tournament/`):
  - `cup.ts`: draw, fixtures, results, progression;
  - `standings.ts`: tables and tie-breakers;
  - `record.ts`: saving and validation.

  It's pure and deterministic, with no DOM or rendering. Only the draw and the fixtures are stored; tables, the current stage and the champion are derived, so a save can't contradict itself. Tests: `tests/tournament.test.ts`.
- **Screens:** `src/ui/cupScreen.ts` (HTML from the record; tests in `tests/cup-screen.test.ts`). `Game.playCupMatch` and `finishCupMatch` connect a fixture to an ordinary `Match`.
- **Browser check:** `npm run check:cup` plays a whole Short cup through the menus, including a reload mid-cup and a shootout.
- **Not yet:**
  - extra time;
  - the 48-team format;
  - a trophy-lift scene in 3D (the trophy is shown on the result screen).
