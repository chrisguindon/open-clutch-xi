# Tournament mode: feasibility and plan

**Status:** Short and Classic formats implemented (see [XI Nations Cup](tournament.md)). Still to do: cup achievements, extra time, the 48-team format, a 3D trophy scene, and the human review of names and visuals (criterion 7). **Audience:** the maintainer (decisions) and contributors (implementation).

A tournament gives players what the [experience review](EXPERIENCE_REVIEW.md) found missing most: a goal that lasts beyond one match. This page records what was verified, the decisions the maintainer needs to make, and a plan with acceptance criteria.

## Which teams: the latest completed men's world championship

The game's original 32 national teams were chosen from the **2022** tournament, which is no longer the latest completed edition. **The 2026 tournament** (11 June – 19 July 2026, hosted by Canada, Mexico and the United States) was the first with **48 teams**. Spain beat Argentina 1–0 after extra time in the final.

Verified in November 2026 from the tournament's public Wikipedia articles (main and qualification pages) and contemporary news reports. Check again before changing the catalogue.

| Confederation | Teams in 2026 |
|---|---|
| Asia (9) | Australia, Iran, Iraq, Japan, Jordan, Qatar, Saudi Arabia, South Korea, Uzbekistan |
| Africa (10) | Algeria, Cape Verde, DR Congo, Egypt, Ghana, Ivory Coast, Morocco, Senegal, South Africa, Tunisia |
| North & Central America (6) | Canada, Curaçao, Haiti, Mexico, Panama, United States |
| South America (6) | Argentina, Brazil, Colombia, Ecuador, Paraguay, Uruguay |
| Oceania (1) | New Zealand |
| Europe (16) | Austria, Belgium, Bosnia and Herzegovina, Croatia, Czech Republic, England, France, Germany, Netherlands, Norway, Portugal, Scotland, Spain, Sweden, Switzerland, Turkey |

**Compared with the original 32-team catalogue:**
- 26 of those teams also played in 2026.
- **6 didn't qualify for 2026:** Wales, Poland, Denmark, Costa Rica, Serbia, Cameroon.
- **22 teams are new in 2026:** Iraq, Jordan, Uzbekistan, Algeria, Cape Verde, DR Congo, Egypt, Ivory Coast, South Africa, Curaçao, Haiti, Panama, Colombia, Paraguay, New Zealand, Austria, Bosnia and Herzegovina, Czech Republic, Norway, Scotland, Sweden, Turkey.

**Done: the catalogue now has 54 teams.** The 22 new teams were added and the other 6 kept, as the maintainer proposed. The catalogue is "National Teams", not a replica of a tournament, and removing a team a player likes gains nothing.
- **Flags** come from flag-icons 7.6.0 (MIT), the same package as before. All 32 earlier flags were checked byte-identical to the package, and the 22 new ones were copied unchanged.
- **Kits** are generic designs in each country's national colours, with no crests or commercial kit designs (`src/sim/nations.ts`).
- **Names** are the common English names used in the source list (for example "Turkey", "Ivory Coast", "Czech Republic"). The maintainer may prefer official short forms such as Türkiye, Côte d'Ivoire or Czechia; that's a one-line change per team.
- **Codes** are three-letter abbreviations used as stable identifiers in saved progress. Don't change them.
- **Still to review by eye:** each new kit in the team-select screen and in a match, especially kit clashes between similar colours (`resolveKits` switches to the change kit when needed).

## Name and branding: fictional only

The real tournament's names, logos, trophy, mascots, slogans and typefaces are protected marks. The game must not use them, imitate them, or suggest any endorsement. Plain descriptive country names and flags are already used this way (see [third-party assets](../governance/third-party-assets.md)).

- **Name.** An original name that fits Open Clutch XI: **"XI Nations Cup"**. Avoid "World Cup", and any phrase, logo or typeface from the real competition. The name will be configurable: a `tournamentName` entry in `src/brand.ts`, read everywhere it is shown, so changing it is one edit.
- **Trophy.** An original design that suits the game's identity, for example a stylised "XI" on a silver base, modelled procedurally or as a CC0 asset.
- **Visual identity.** The game's own slate and blue palette and Inter type. No host-country motifs that imitate the real tournament's branding.
- **Wording.** "A fictional international tournament inspired by world championships." Never "the official…", and never real sponsors.

## Format

| Option | Groups | Knockouts | Matches for the player to win it | Session fit |
|---|---|---|---|---|
| **Short (16 teams)** | 4 groups of 4, top 2 advance | Quarter-final, semi-final, final | 6 | One evening |
| **Classic (32 teams)** | 8 groups of 4, top 2 advance | Round of 16 to final | 7 | Two or three sessions |
| **Expanded (48 teams)** | 12 groups of 4, top 2 and the 8 best third-placed teams advance | Round of 32 to final | 8 | Several sessions |

**Recommendation:** ship **Short** and **Classic** first. Short suits young players and short sessions; Classic is the familiar shape. Expanded adds a best-third-place table and one more round for little extra fun. Leave it for later.

- **Match settings:** the player's chosen format (3v3, 5v5 or 11v11), difficulty and length apply to every match the player plays. Rules follow the format (Standard for 11v11, Arcade for the small-sided formats), as in Quick Match.
- **Draws in knockouts:** go straight to a penalty shootout, which already exists. **This is a game simplification, not the Laws of the Game** (which allow extra time first), and the screen must say so. Extra time can come later with half-time and change of ends (see the [rules matrix](FOOTBALL_RULES.md)).
- **Group tiebreakers:** points, goal difference, goals scored, head-to-head points, then a deterministic drawing of lots from the tournament seed. Document them on the standings screen.

## Simulating the other matches

The player plays their own team's matches. The other matches in each round need results too.

- **Running the real simulation headless is too slow.** It's thousands of steps per second, but a 4-minute match is about 29,000 steps, and a 32-team tournament has 63 matches.
- **Use a small result model** instead: goals for each side drawn from a seeded distribution (for example Poisson with a mean of about 1.3), plus a shootout result for drawn knockout matches.
- **Every team has the same strength by default.** The game has no team ratings: the national teams differ only in identity, not ability. Inventing ratings for real countries invites dispute and isn't needed for fun. A later option could weight teams by the player's chosen difficulty only.
- **Deterministic and replay-proof.** Each result comes from `hash(tournamentSeed, matchId)` using the seeded `Rng`. Reloading a save can't reroll results, and the same seed always produces the same tournament, which makes it testable.

## Saving

A tournament spans sessions, so it needs the [persistence foundation](../architecture/persistence.md):
- **Key:** `tournament-v1` (brand-neutral, like `player-progress-v1`). **Record:** `{ version, seed, format, team, settings, fixtures, results, stage, createdAt }`, validated strictly on load like `parseProgress` in `src/game/progress.ts`.
- **Export, import and reset** include it automatically once it's added to `STORAGE_KEYS` and the save file's `data` (`src/game/saveData.ts`).
- **Statistics:** each tournament match the player plays reaches full time normally and is recorded in the player's statistics (`recordMatch`). Tournament-only records (tournaments entered, best finish, trophies) go in the tournament record, plus two achievements (*Reach the knockouts*, *Win the trophy*) with new permanent ids.
- **One active tournament.** The menu shows **Continue tournament** (with the next opponent) or **New tournament**. Starting a new one asks before replacing the old one.
- **Atomic saves after every match.** Quitting mid-match forfeits nothing: the match is simply replayed.
- **Recovery.** A save that fails validation is never half-loaded. The player is told it can't be read and can start again; the raw text is kept (`storage.ts` keeps a `:corrupt` copy).

## Acceptance criteria

1. The player can start a Short or Classic tournament, choose a team, and play through to elimination or the trophy.
2. Group standings follow the documented tiebreakers. Unit tests cover points, goal difference, and a full deterministic tie.
3. Other matches' results are deterministic for a seed (tested), and reloading never changes them.
4. Closing the browser between any two matches and reopening resumes the same tournament (tested with the storage fake).
5. A corrupt or old-version save never crashes the game: it is migrated or offered for reset (tested).
6. Knockout draws go to penalties, and the UI labels this as the game's simplification.
7. No real tournament names, logos, trophy or sponsor marks anywhere: reviewed by a human before release.
8. Every screen is keyboard- and controller-navigable, and results and standings are announced in words.
9. Docs updated: [modes](modes.md), [rules matrix](FOOTBALL_RULES.md) (the knockout simplification), the changelog.

## Architecture

Tournament logic stays independent of rendering and of the DOM, like the match simulation, so all of it is unit-tested without a browser.

```
src/game/tournament/
  types.ts       Tournament, Fixture, GroupTable, Stage, TournamentFormat ('short16' | 'classic32')
  draw.ts        seeded group draw: (teams, format, seed) → groups (one team per region pot where possible)
  fixtures.ts    group round-robins, knockout bracket from group positions
  standings.ts   points, goal difference, goals, head-to-head, then seeded lots (pure, deterministic)
  results.ts     result model for matches the player doesn't play: hash(seed, fixtureId) → score (+ shootout)
  record.ts      parse/validate (strict), migrate, load/save through src/game/storage.ts
src/ui/        a tournament hub screen: standings, bracket, next match, "Continue tournament" on the menu
src/game/game.ts  starts the player's fixture as a normal match (settings from the tournament record) and
                  reports the full-time result back with recordResult(tournament, fixtureId, score, kicks)
```

- **One way in, one way out.** The match itself is an ordinary `Match` (same rules, AI and recording). The tournament only decides *who* plays next and stores *what happened*.
- **Pure transitions:** `recordResult(t, …) → t'` returns a new record, like `recordMatch`, so every step is testable and a save is always a complete, valid record.
- **Determinism:** draw, other results and tiebreak lots all come from the tournament's seed, through the seeded `Rng` from `src/core/rng.ts`.
- **No new dependencies.**

## Effort and order

1. ~~**Catalogue update**~~: done (54 teams).
2. **Pure tournament logic** in `src/game/tournament/` (see Architecture): draw, fixtures, standings, tiebreakers, result model. Fully unit-tested before any UI.
3. **Persistence** for the tournament record.
4. **UI:** a hub screen (standings, next match, bracket), plus integration with full time.
5. **Trophy presentation** and the final celebration.
