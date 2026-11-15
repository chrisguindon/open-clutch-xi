# Scripts

**Audience:** contributors who want to know which tool to run. Every script starts with a comment explaining what it does and how to run it. This page is the map.

Browser scripts need Chrome or Chromium (set `CHROME_PATH` if it isn't found). They use **software rendering**, so frame rates and GPU timings they print say nothing about real hardware. Device emulation (touch, controllers, 144 Hz) is not real-device testing. Screenshots go to the ignored `screenshots/` directory.

## Repository checks (run by `npm run ci`)

| Script | npm command | Checks |
|---|---|---|
| `check-licenses.mjs` | `check:licenses` | Licence headers, dependency licence allow-lists, asset inventory. `--write` regenerates the licence texts in `NOTICE.md` and `public/NOTICE.txt`. |
| `check-repo-hygiene.mjs` | `check:repo` | Nothing private would be published: profiling exports, private paths, tokens, AI attribution trailers, `.local/` or `release/` files; no hosting-platform deploy configuration |
| `check-docs.mjs` | `check:docs` | Community files exist; every relative Markdown link and anchor resolves |
| `check-github-config.mjs` | `check:github` | Issue and discussion forms, chooser config, labels, Dependabot; workflows (explicit permissions, actions pinned to commit SHAs, no script injection) |
| `check-commit-message.mjs` | — | A commit message or PR title follows Conventional Commits (used by CI and `.githooks/commit-msg`) |
| `generate-sbom.mjs` | `sbom` | CycloneDX SBOM of what ships. `--check` verifies it's reproducible. |
| `release-check.mjs` | `release:check` | Everything above in a clean copy, plus the release artefacts packaged twice to prove they're reproducible. Never commits, tags or publishes. |
| `release.mjs` | `release` (`make release-prepare` / `make release-publish`) | Maintainers' release automation: prepare (version, changelog, notes, release check, pull request) and publish (tag, artefacts, draft GitHub release). Asks before anything permanent; `--dry-run` changes nothing. See [releasing](../docs/development/releasing.md). |
| `package-web.mjs` | `release:package` | Builds the release artefacts in `release/`: the static web archive (site, licence, notices, `hosting/headers.json`, manifest), the source archive and `SHA256SUMS`. Never tags or uploads. |

## Browser checks (pass or fail)

| Script | npm command | What it plays through |
|---|---|---|
| `browser-smoke.mjs` | `test:browser` | Boot, menus, a match to full time, no console errors |
| `rules-check.mjs` | `check:rules` | Throw-in, attempted walking with the ball, goal, celebration skip, kick-off |
| `controls-check.mjs` | `check:controls` | First-launch chooser, mouse buttons, rebinding |
| `tutorial-check.mjs` | `check:tutorial` | The whole tutorial with real key presses, then deliberate mistakes: switch while carrying, losing the ball, reset key, scoring (camera returns to play), retry, skip, exit, re-entry |
| `cup-check.mjs` | `check:cup` | A whole XI Nations Cup through the menus: start, group matches, reload mid-cup, a level quarter-final and its shootout, the trophy, past cups |
| `mobile-check.mjs` | `check:mobile` | Touch controls in phone emulation; the page never scrolls or zooms |
| `adaptive-check.mjs` | `check:adaptive` | Auto graphics steps down on a slow device without restarting the match |
| `input-check.mjs` | `check:input` | Input diagnostics, benchmark validity flags, guided CPU check |
| `refresh-check.mjs` | `check:refresh` | Frame limiter on an emulated 144 Hz display |
| `fluidity-check.mjs` | `check:fluidity` | Movement stays smooth under irregular frame timing |
| `audio-check.mjs` | `check:audio` | Every sound plays, and the synthesised fallback works when files are blocked |
| `prod-check.mjs` | `check:prod` | The production build served with the headers from `hosting/headers.json` (`PROD_DIR=` checks another built site) |
| `anim-compare.mjs` | `check:anim` | The baked pose sampler matches three.js's mixer for every clip |

## Captures for human review (screenshots only)

| Script | Output |
|---|---|
| `journey-capture.mjs` | A new player's journey, desktop and phone: tutorial offer, How to Play, settings including Saved data, full time and Records (used by the [experience review](../docs/gameplay/EXPERIENCE_REVIEW.md)) |
| `celebration-gallery.mjs` | Every celebration style, plus an own goal |
| `ui-capture.mjs`, `review-capture.mjs` | Screens, modes, cameras and moments |
| `anim-capture.mjs`, `player-capture.mjs`, `pose-gallery.mjs` | Animation states and close-ups (`SQUAD=women\|men` picks the body for `player-capture.mjs`) |
| `lighting-capture.mjs`, `replay-capture.mjs` | Times of day × cameras; a replay sequence |
| `contact-sheet.mjs`, `compare-sheet.mjs` | Tile screenshots into one sheet; labelled before/after sheets |

## Measurements (numbers stay local)

`perf-capture.mjs`, `bench-capture.mjs`, `cpu-microbench.mjs` and `alloc-profile.mjs` measure render statistics, CPU cost and allocations. `lighting-capture.mjs` shoots every time of day from fixed cameras, for before/after lighting comparisons with `compare-sheet.mjs`. Their output can describe your machine, so it is git-ignored and must not be committed (see [performance](../docs/development/performance.md)). AI and gameplay reports run through Vitest instead: `npm run metrics`, `npm run report:ai`, `npm run report:attack` (shots, crosses and goals per minute by format and difficulty), `npm run report:penalties`.

## Assets and maintenance

| Script | Purpose |
|---|---|
| `build-assets.mjs`, `build-audio.sh` | Build `public/assets/` from the CC0 sources in `asset-src/` (`build-assets.mjs player_f skins` builds only those targets) |
| `brand-assets.mjs` | Regenerate the apple-touch icon and social card from the favicon and the real menu (after a change of name or logo) |
| `set-repo-url.mjs` | Replace the placeholder repository URL once the repository exists |
| `sync-labels.mjs` | Create the labels in `.github/labels.yml` (dry run by default) |
| `triage/` | Issue triage used by the `triage` workflow (tested in `tests/triage.test.ts`) |
| `run-with-env.mjs`, `lib/chrome.mjs` | Helpers: cross-platform environment variables; finding Chrome |
