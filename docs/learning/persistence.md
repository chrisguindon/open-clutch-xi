# Learning guide: saving data safely in the browser

**You'll learn:** how a web game remembers things without a server, and how to make saved data robust against private mode, corruption and old versions. **Prerequisites:** JSON, TypeScript types. **Read alongside:** `src/game/storage.ts`, `loadSettings` and `sanitizeSettings` in `src/game/settings.ts`, `tests/storage.test.ts`, `tests/settings-migration.test.ts`.

## Local-first

Open Clutch XI saves settings in the browser's `localStorage`: a small key-value store (about 5 MB) that belongs to the website. There is no account and no server, and nothing leaves the player's machine. See [persistence](../architecture/persistence.md) for the design and [ADR 0009](../architecture/decisions/0009-local-first-persistence.md) for why.

## Four things that go wrong, and the fix for each

| Problem | Example | Fix in the code |
|---|---|---|
| **Storage unavailable** | Private windows or blocked cookies throw an exception on *any* `localStorage` access | `storage.ts` catches it and falls back to an in-memory store |
| **Corrupt data** | A truncated write leaves `{"minutes": 6,` | `readJson` treats it as "nothing saved" and keeps a `:corrupt` copy |
| **Wrong types** | A hand edit sets `"minutes": "four"` | `sanitizeSettings` keeps only fields whose type matches the default |
| **Old versions** | A player who last played months ago has an older settings shape | `loadSettings` **migrates** step by step, keeping their choices |

## Why `readJson` returns `unknown`

```ts
export function readJson(key: StorageKey): unknown
```

If it returned `Settings`, TypeScript would believe whatever is in storage, and anything can be in storage. `unknown` forces the caller to check the shape (`isRecord`, `typeof`) before using it. This is the general rule for **trust boundaries**: data from outside your program is `unknown` until validated.

## Migrations keep players' choices

When the format changes, old data is upgraded rather than thrown away. For example, an old boolean `replays: true` becomes `'best'`, and players who used the retired "mouse aim" option get the keyboard-and-mouse scheme with their own keys plus the two mouse buttons. Each migration has a test that stores the old shape and checks the result.

## Try it

**Exercise I6** in [exercises](exercises.md) adds a validated setting with a migration test.
