# AGENTS.md — working on Open Clutch XI

This is the **single source of instructions** for anyone changing this repository with the help of an automated coding assistant or agent, whatever the tool. Human contributors will find the same rules in [CONTRIBUTING.md](CONTRIBUTING.md). Tool-specific files (such as `CLAUDE.md`) only point here; don't copy rules into them.

## The project in one paragraph

Open Clutch XI is a free, open-source 3D football game for the browser (TypeScript, Three.js, Vite). It has no backend. It is educational: newcomers read this code to learn, so clarity matters as much as cleverness. Licence: EPL-2.0. It is a personal project, not affiliated with the Eclipse Foundation. Playable at https://fc.chrisguindon.com.

## Layout

| Path | What lives there |
|---|---|
| `src/sim/` | Deterministic simulation at 120 Hz: physics, rules, AI (`sim/ai/`). No DOM, no rendering. |
| `src/render/` | Three.js scene, characters, camera, stadium |
| `src/game/` | Game loop, settings and migrations, adaptive quality, diagnostics, tutorial |
| `src/input/`, `src/ui/`, `src/audio/` | Devices, menus and HUD, sound |
| `src/dev/` | Developer tools (movement lab, AI audit, penalty simulator) |
| `tests/` | Vitest unit, simulation and scenario tests. `tests/tools/` holds opt-in reports. |
| `scripts/` | Browser checks, captures, asset builds, repository checks (map: `scripts/README.md`) |
| `docs/` | Subject-based docs: `architecture/` (+ `decisions/` ADRs), `development/`, `gameplay/`, `governance/`, `learning/`, `releases/`. Index: `docs/README.md`. |
| `tools/lint/` | ESLint toolchain (separate because it needs the TypeScript 6 API) |

## Commands

```bash
npm ci && npm run lint:setup   # install (the second command installs the ESLint toolchain)
npm run dev                    # http://localhost:5173 (F3 or ?diag = diagnostics)
npm run ci                     # everything CI runs: format, lint, types, tests, build, licence/repo/docs/GitHub checks
npm test                       # tests only
npm run format                 # apply Prettier
```

Browser checks (`npm run test:browser`, `check:controls`, `check:adaptive`, …) need a browser: `npm run browsers:install` downloads the pinned Chrome for Testing into `.cache/browsers/`, or set `CHROME_PATH`. They use software rendering, so their frame rates mean nothing about real hardware.

## Standards

**Changes**
- Keep each change focused. Prefer small, reviewable diffs that match the surrounding style. Don't reformat unrelated code.
- Fix root causes, not symptoms. If you can't reproduce a bug, say so: never mark it fixed.
- Keep `src/sim/` deterministic (use the seeded `world.rng`, never `Math.random`). Avoid allocations in per-frame or per-step hot paths.
- Don't add runtime dependencies or third-party network requests without an issue and the maintainer's agreement.

**Code quality**
- Follow [docs/development/CODING_STANDARDS.md](docs/development/CODING_STANDARDS.md): naming, modules, hot-path rules, TSDoc, licence headers, and the reasons behind them.
- TypeScript strict mode, ESLint (including the type-aware promise rules) and Prettier must pass (`npm run ci`).
- Name things for what they mean in football or game terms.
- Write pure functions where you can, so they're testable.

**Tests**
- Every behaviour change or bug fix comes with a test where practical.
- Gameplay and AI changes need scenario or simulation tests (see `tests/ai-decisions.test.ts`, `tests/controls.test.ts`). Settings changes need migration tests (`tests/settings-migration.test.ts`).
- Wall-clock performance tests (`tests/perf*.test.ts`) run after the rest, on their own, because parallel simulation tests distort their timings. `npm test` handles this.
- AI and gameplay metrics are noisy. Draw conclusions from many seeds (`npm run metrics`, `npm run report:ai`), not from one match.

**Football rules**
- Follow the IFAB *Laws of the Game* (current edition) as summarised in `docs/gameplay/FOOTBALL_RULES.md`.
  - Standard rules apply to 11v11; Arcade rules to 3v3 and 5v5.
  - Never present the game's own simplifications as IFAB rules.
- Decisions belong in the simulation:
  - pure logic in `src/sim/rules.ts`;
  - decisions in `src/sim/match.ts`.
- Decisions are deterministic (no random outcomes). Officials only display decisions.
- Restarts go through the restart stage machine. Takers never move with the ball. Change it only with tests in `tests/rules.test.ts`, and update the rules matrix.

**Animation**
- The simulation decides; animation follows. Gestures and celebrations are chosen in `src/sim/` (from match context only, never from a player's nationality, appearance or gender) and posed in `Footballer`.
- Celebrations must be skippable and end on their own.

**Branding**
- Never hard-code the game's name: read `BRAND` from `src/brand.ts` (HTML metadata is filled from it at build time).

**Inclusive players**
- Women, men and mixed squads are presentation only (`src/render/characters/squad.ts`). Nothing in `src/sim/` may read appearance, body type or the *Teams* setting, and gameplay attributes never depend on gender, appearance or nationality. `tests/inclusive-players.test.ts` guards this.

**Saved data, progress and privacy**
- Persist only through `src/game/storage.ts`. Every record is typed, versioned, validated and migrated (see `docs/architecture/persistence.md`, ADR 0009). Storage keys and achievement ids are permanent identifiers: never derive them from the brand, never rename them.
- Statistics are recorded only at full time from simulation data (`src/game/progress.ts`), once per match. Achievements stay visible, pressure-free and reliably detectable (`docs/gameplay/progression.md`).
- Imported files are untrusted: size-limited, validated strictly, applied only after confirmation.
- No backend, accounts, serverless functions, analytics or databases without an issue and the maintainer's agreement.

**Performance and accessibility**
- Keep per-frame work allocation-free. New visual cost joins the adaptive quality ladder. Read `docs/development/performance.md`.
- **UI:**
  - keyboard- and controller-navigable, with a visible focus;
  - text alternatives for anything shown by colour or animation (decisions are announced in words);
  - respect *reduce motion*.

**Educational comments** (a major priority: newcomers learn from this code)
- Every module has a header comment; a newcomer should be able to follow it from that alone.
- Exported classes, functions, interfaces and shared constants get TSDoc (`/** … */`): a summary sentence, units and ranges, side effects, `{@link}` to related code.
- Comments explain *why*: the football idea, the trade-off, the bug it prevents. They don't restate the code, narrate history, or keep commented-out code. Don't overcomment obvious lines.

**Documentation policy (permanent)**
- **Behaviour changes:** update the existing documentation that describes the behaviour: `docs/` by subject, the README, `docs/learning/README.md`. Add a `CHANGELOG.md` entry under *Unreleased* for player-visible changes.
- **ADRs:** create one in `docs/architecture/decisions/` only for meaningful architecture decisions, not for every change or phase.
- **Working notes:** temporary notes, plans, transcripts, investigations, profiling and benchmark output go in the ignored `.local/` directory (for example `.local/agent-history/`). Never publish phase reports or agent transcripts.
- **No duplicates:** extend an existing page rather than adding a near-duplicate.
- **Lasting knowledge:** keep what future contributors need, in subject-based pages.
- **Accuracy:** keep public documentation accurate for the current code. Fix or remove stale statements.
- **No personal data:** never include personal profiling data, hardware details or private paths. Use generic or synthetic examples.

**Honest verification**
- Report what you actually ran and what happened, including failures.
- Emulation (touch, controllers, slow devices, software GL) is not real-device testing. Say which was used.
- Don't claim GitHub Actions passed unless they ran on GitHub.

## Commits and pull requests

- **Conventional Commits:** `<type>(<scope>): <summary>`, for example `fix(ai): stop clearances towards our own goal`.
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
  - Suggested scopes: `ai`, `physics`, `gameplay`, `controls`, `graphics`, `audio`, `ui`, `a11y`, `perf`, `tutorial`, `penalties`, `docs`, `ci`, `deps`, `release`, `repo`.
  - Use `!` or a `BREAKING CHANGE:` footer for breaking changes, for example to saved settings.
- Pull requests are **squash-merged**, so the PR title becomes the commit message on `main` and must follow the same format. `scripts/check-commit-message.mjs` checks it.
- **AI attribution trailers are allowed, not required.** Tools such as GitHub Copilot (the coding agent, Autofix) add `Co-authored-by:` trailers on their own. The checks report them as a warning, never a failure. Don't write "generated with …" signatures into files: the repository hygiene check rejects those.
- **Feature branches only.** Before changing anything, check the working tree is clean and `main` is up to date with `origin/main`. Then create a branch named `<type>/<short-description>` (for example `fix/mobile-player-labels`), and commit there in focused Conventional Commits. Never commit directly to `main`. The full workflow is in [CONTRIBUTING.md](CONTRIBUTING.md#branches-pull-requests-and-approval).
- Don't commit, push, open or merge pull requests, tag, publish releases or deploy unless the human you're working with asks. Merging into `main` always needs their approval.

### Git authorship policy

- **A real, authorised human is the author and committer** of every commit: the person who reviewed the change and takes responsibility for it, using their own configured Git identity.
- **Never invent, guess or impersonate an identity.** Don't set `user.name` or `user.email` for someone, and don't commit as an AI tool, a model or a vendor. If no authorised identity is configured, don't commit: leave the work ready for the human to review and commit.
- **Automatic AI attribution in commit messages** (AI co-author trailers, "generated with …" signatures, AI-tool session links) is tolerated. Many tools add it themselves, and blocking it made them hard to use.
  - `scripts/check-commit-message.mjs` (CI, the optional `.githooks/commit-msg` hook, and the hygiene check over history) reports it as a warning and never fails because of it.
  - The maintainer may drop such trailers from the squash-merge message, but doesn't have to.
  - Claude Code's shared project settings (`.claude/settings.json`) keep its own commit and PR attribution off. That's a project preference, not a rule.
- **Keep legitimate attribution:** human co-authors (`Co-authored-by:` a person), third-party copyright notices and licence-required notices stay.
- **This is not a claim of human-only authorship.** The project uses AI-assisted development and says so openly (README, ADR 0008, [docs/development/ai-assisted-workflow.md](docs/development/ai-assisted-workflow.md)). The policy is about responsibility: a human reviews, understands, commits and publishes every change.
- Never bypass checks (`--no-verify`), amend or rewrite published history, or force-push.

## Human responsibility

AI-assisted work is welcome. The human who submits it is responsible for it, and must:
- have reviewed and understood every line;
- have run the checks;
- be able to explain the change;
- have the right to contribute it under the EPL-2.0.

Agents should make that review easy: explain non-obvious decisions, and list anything that wasn't verified.

## Security

- Never commit secrets, tokens or credentials.
- Never put untrusted input (URL parameters, settings, team names) into HTML without escaping (`escapeHtml` in `src/ui/ui.ts`).
- Keep the Content-Security-Policy in `hosting/headers.json` strict.
- The project stays independent of any hosting platform: no hosting-provider configuration, accounts or deploy hooks in this repository (see `docs/development/hosting.md`). `npm run check:repo` rejects platform deploy configuration.
- Workflows:
  - least-privilege `permissions`;
  - actions pinned to full commit SHAs;
  - no `${{ github.event.* }}` inside `run:` (pass it through `env:`);
  - never check out pull-request code in `pull_request_target`.
- Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Licensing

- Every source file starts with the Eclipse-style header, in its format's comment syntax:

  ```
  /*
   * Copyright (c) <year> <copyright holder>
   *
   * This program and the accompanying materials are made available
   * under the terms of the Eclipse Public License 2.0,
   * which is available at https://www.eclipse.org/legal/epl-2.0/.
   *
   * SPDX-License-Identifier: EPL-2.0
   */
  ```

  - Shell, YAML and git hooks use `#` lines, with any shebang kept on line 1. HTML uses `<!-- … -->` after the doctype.
  - Not headed: JSON, generated files, third-party files (never overwrite their notices), Markdown, data-only GitHub forms.
  - `npm run check:licenses` enforces all of this in CI. Details: [CODING_STANDARDS.md](docs/development/CODING_STANDARDS.md#licence-headers).
- Don't copy code from elsewhere unless its licence is compatible, and record it in `NOTICE.md`. Notices are regenerated with `node scripts/check-licenses.mjs --write`.
- Assets must be redistributable. CC0 is preferred. List each one in `docs/governance/third-party-assets.md` with its source, author and licence.
- No real club or federation crests, official kits, sponsor marks, real players' names or likenesses, or recordings of real chants.
- No personal branding in this repository (portraits, personal sponsors or site-specific assets): hosting sites add their own through `site-config.json` (`src/game/siteConfig.ts`).

## Privacy

- The game has no telemetry, analytics, accounts or third-party requests. Keep it that way.
- Never commit personal data: benchmark, diagnostics or CPU-check exports; traces; CPU or heap profiles; local paths containing user names; machine details. `.gitignore` and `npm run check:repo` guard this.
- Use generic or synthetic data in docs and tests.
- Diagnostics stay hidden unless the player opens them (F3 or `?diag`).
