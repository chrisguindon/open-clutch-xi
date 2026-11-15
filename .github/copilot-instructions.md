# Copilot instructions

Follow **[AGENTS.md](../AGENTS.md)**: it is the single source of engineering instructions for this repository and applies to every coding assistant. Don't duplicate or override its rules.

Most important, in brief:
- **Before finishing:** run `npm run ci`, add tests for behaviour changes, and update the relevant docs (`docs/`, `CHANGELOG.md`).
- **Football rules:** follow `docs/gameplay/FOOTBALL_RULES.md`. Decisions belong in the simulation (`src/sim/`), never in rendering.
- **Commits and PR titles:** Conventional Commits. A real human is the author (see the Git authorship policy in AGENTS.md). Automatic co-author trailers are allowed; the checks only warn.
- **Never commit** secrets, personal profiling data or private paths.
- **Code style:** follow `docs/development/CODING_STANDARDS.md`: a header comment on every module, TSDoc on exports, and comments that explain *why* (this is an educational project).
- **Licensing:** start every new source file with the Eclipse-style EPL-2.0 header (format in the coding standards; `npm run check:licenses` checks it). Only add assets with verified redistribution rights.
- **Saved data:** only through `src/game/storage.ts`, validated and migrated (`docs/architecture/persistence.md`). Storage keys and achievement ids are permanent. No backend, tracking or third-party requests.
- **Branding:** read the name from `src/brand.ts`; never hard-code the game's name.
- **Inclusive players:** appearance (women, men, mixed squads) never reaches `src/sim/`; gameplay is identical for everyone.
