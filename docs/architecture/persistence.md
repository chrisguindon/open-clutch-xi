# Persistence: local-first saved data

**Audience:** contributors adding anything the game remembers: settings, statistics and achievements today, and tournament saves next. The decision is recorded in [ADR 0009](decisions/0009-local-first-persistence.md).

Open Clutch XI has no backend. Everything it remembers lives **in the player's own browser** (`localStorage`), and nothing is ever sent anywhere. This page describes the storage layer, the rules every saved record follows, and what a server could add one day if a real need appears.

## What is stored today

| Key | Contents | Owner |
|---|---|---|
| `floodlight-fc-settings-v1` | Settings: graphics, audio, controls and bindings, teams, format, difficulty, team composition, tutorial seen | `src/game/settings.ts` |
| `player-progress-v1` | Statistics, the last 20 matches, unlocked achievements (with dates), tutorial completed | `src/game/progress.ts` |
| `floodlight-fc-tuning-v1` | Movement-lab tuning (developer tool, `?lab`) | `src/dev/tuning.ts` |
| `<key>:corrupt` | The first unreadable copy of a key, kept for recovery | `src/game/storage.ts` |

- Every key is listed in `STORAGE_KEYS`, so the resets and the export can't miss one.
- **Keys are identifiers, not branding.** The settings key keeps its original name, so returning players keep their settings. New keys are brand-neutral.

## The storage layer (`src/game/storage.ts`)

The only module that touches `localStorage`. It provides `readJson`, `writeJson`, `remove`, `forget` (a key and its recovery copy), `keepRecoveryCopy` and `hasStored`, plus `isRecord` for validation, with three guarantees:

1. **Storage may be missing.** Private windows, blocked site data and some embedded browsers throw on any `localStorage` access. The layer falls back to an in-memory store: the game works normally and simply forgets on reload.
2. **Corrupt data never crashes the game.** Unparseable JSON reads as "nothing saved", and the first corrupt copy is kept under `<key>:corrupt`.
3. **Values are `unknown` until validated.** `readJson` deliberately returns `unknown`. The owner validates the shape before using it.

## Rules for every saved record

- **Typed.** A TypeScript interface describes the record. Defaults live next to it.
- **Versioned.** Either a `version` field in the record or the key's `-vN` suffix. Bump the version only with a migration.
- **Validated.** Check every field on load. Two styles, chosen by what the record holds:
  - **Preferences are sanitised field by field** (`sanitizeSettings`). An invalid field (the wrong type, or a value outside its allowed set) falls back to its default, so one bad value never costs a player all their settings.
  - **Records are validated strictly** (`parseProgress`). Statistics that don't add up (more wins than matches, negative counts, unknown achievement ids, absurd numbers) mean the data is damaged, so the whole record is refused rather than guessed at. The original text is kept as a recovery copy before anything replaces it.
  - A record that isn't an object at all gives the defaults.
- **Migrated, never reset.** Upgrade old shapes step by step (see `loadSettings`). A player's own choices (bindings, preferences) are never silently lost. Every migration gets a test in `tests/settings-migration.test.ts` or alongside the new record's tests.
- **Small.** `localStorage` holds about 5 MB per origin, and every read is synchronous. Records stay in kilobytes. Anything large (recordings, replays) doesn't belong here.
- **Written at natural moments.** Save when settings change or a match ends, never per frame.

## Statistics and achievements

`src/game/progress.ts` holds the player's record. It is updated only at full time, from a `MatchSummary` built from the simulation (score, goal log, shootout kicks).
- **Pure updates.** `recordMatch(progress, summary)` returns a new record plus the achievements unlocked. The input is never modified.
- **Counted once.** Every match has an id (start time and seed), and a summary whose id is already in the history is ignored.
- **Abandoned matches don't count.** Quitting or restarting never reaches full time.
- **What is recorded.** Matches and shootouts are counted separately. Practice and the tutorial never count; the tutorial only sets `tutorialCompleted`.

Achievements (`src/game/achievements.ts`) are pure conditions over the record, and their ids are permanent. See [statistics, achievements and progression](../gameplay/progression.md) for the design rules.

## Export, import and reset (Settings → Saved data)

`src/game/saveData.ts`. The export is a JSON file named `open-clutch-xi-player-data-<time>.json`:

```json
{
  "format": "football-game-save",
  "version": 1,
  "exportedAt": "2026-11-15T10:00:00.000Z",
  "data": { "settings": { "…": "…" }, "progress": { "version": 1, "stats": { "…": "…" }, "history": [], "achievements": {}, "tutorialCompleted": false } }
}
```

- **`format` is brand-neutral**, so files exported before a rename still import.
- **Imports are untrusted input.**
  - At most 256 KB.
  - Parsed as JSON only, never evaluated.
  - A file is refused (with a message a player can read, and nothing changed) when it has another format, comes from a newer version, has unknown sections, contains damaged progress, or is empty.
  - Settings in a file are sanitised exactly like stored ones.
  - The player sees what a file contains ("settings and 12 matches and 4 achievements") and confirms before it replaces anything.
- **Two resets, each confirmed in words:**
  - **Reset records** removes statistics, history and achievements, and keeps settings;
  - **Reset everything** removes every saved key, including recovery copies.
- After an import or reset the page reloads, so every part of the game starts from the new data.

Covered by `tests/progress.test.ts` (round trip, every rejection case, both resets, blocked storage, damaged data) and `tests/storage.test.ts`.

## Planned additions

- **Tournament record** `tournament-v1` ([tournament plan](../gameplay/tournament-plan.md)), following the same rules and included in export and reset automatically once it's in `STORAGE_KEYS` and the save file.

## Privacy note

- Saved data contains game settings and match records (scores, teams, dates). It contains **no personal information**: no names, emails, accounts, device identifiers or analytics.
- It never leaves the browser unless the player exports a file themselves.
- Clearing the browser's site data deletes it.
- Team names are fixed by the game. If player-entered text (for example a custom team name) is ever added, it must be escaped (`escapeHtml`) before display and validated on import.

## Future server-side options (no backend now)

A backend is **not** justified today. Every planned feature (tournaments, statistics, achievements, export and import) works locally. A server would add cost, a privacy policy, data-protection duties, abuse handling and an availability dependency to a free educational game. It would also break the "no third-party requests" promise. The options below are recorded so a future decision starts from facts.

The project doesn't choose a hosting platform (see [hosting](../development/hosting.md)): it ships static files, and anything server-side would tie it to one provider's functions and storage. Static hosting usually charges for bandwidth and builds even without a backend, which is one more reason the build keeps assets small and cacheable.

What a server could one day offer, and what it would require:

| Feature | Would need | Notes |
|---|---|---|
| Cloud sync between devices | Accounts or a sync code, server functions and storage, a privacy policy | Export and import cover this manually first |
| Global leaderboards | Server-side validation (scores from a browser are trivially forged), moderation | Conflicts with "no pressure" design for children; not recommended |
| Shared community challenges | A static JSON file in the site is enough | Needs no backend at all |

**Rule:** no Functions, authentication, database or third-party request is added without an issue, a privacy review, and the maintainer's agreement (see [AGENTS.md](../../AGENTS.md)).
