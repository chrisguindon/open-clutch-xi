# 0009. Keep saved data local-first, behind one storage module

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

The game remembers settings today. Proposed features (a tournament that spans sessions, statistics, achievements) need more saved data. Before this decision, `localStorage` was used directly in two places, with ad-hoc error handling and no validation: a hand-edited or truncated value could reach game code unchecked. The project promises no accounts, telemetry or third-party requests, and it's played by children.

## Decision

- All saved data stays in the player's browser. There is **no backend** for persistence.
- One module, `src/game/storage.ts`, is the only code that touches `localStorage`. It falls back to memory when storage is unavailable, treats corrupt JSON as "nothing saved" (keeping a recovery copy), and returns `unknown` so callers must validate.
- Every key is listed in `STORAGE_KEYS`.
- Each record is typed, versioned, validated field by field, and migrated rather than reset. See [persistence](../persistence.md).

## Rationale

- Local storage meets every planned feature's needs with zero cost, no privacy duties and no availability dependency.
- A single choke point makes the failure modes (private mode, quota, corruption) consistent and tested once.
- Typed reads (`unknown` until validated) turn "trust whatever is stored" bugs into compile errors.

## Consequences

- Saved data doesn't follow a player between devices. Export and import (planned) cover that manually.
- Clearing site data loses progress. The UI should say so where progress is shown.
- A future server feature needs a new ADR, an issue, and a privacy review. The options are recorded in [persistence](../persistence.md#future-server-side-options-no-backend-now).
