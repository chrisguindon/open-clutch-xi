# Changelog

Notable changes to Open Clutch XI, for players and contributors. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The browser game has no public API, so versions are read as follows:

| Version part | When it changes |
|---|---|
| **MAJOR** | Saved settings or controls become incompatible without migration |
| **MINOR** | New features or modes |
| **PATCH** | Fixes |

Add entries under **Unreleased** as part of your pull request. The maintainer moves them into a version when releasing (see [docs/development/releasing.md](docs/development/releasing.md)).

## [Unreleased]

The first public release is planned as **0.1.0 (public beta)**. It includes everything developed so far:

### Added
- **Football rules engine.** Standard rules (11v11) and Arcade rules (3v3, 5v5).
  - An explicit restart state machine.
  - Throw-ins where the thrower can't move and must throw two-handed.
  - Opponent distances at restarts, and the second-touch offence.
  - No direct goals from throw-ins or indirect free kicks.
  - Offside (Standard).
  - Fouls judged from the challenge, with advantage, yellow and red cards, and sendings-off (Standard).
  - Defensive walls.
  - The five-second throw-in countdown (Standard, per the 2026/27 Laws), only for deliberate delay. Before that, the referee gives a hurry-up cue.
- **Match officials:** a referee who follows play and signals decisions, and assistant referees with flag signals (Standard). Decisions are also given in words and announced to screen readers.
- **Beginner difficulty.**
- **Contextual goal celebrations** (late winners, consolations, own goals): six normal scorer styles, plus big and subdued ones. Team-mates and the conceding team react in varied, unsynchronised ways. Reactions to near misses and saves.
- **Release tooling:** a CycloneDX SBOM (`npm run sbom`) and reproducible release validation (`npm run release:check`).
- **Play:** 3v3, 5v5 and 11v11 matches against the computer, with 54 national teams (flags and national colours only): every team of the 2022 and 2026 men's world championships. Also a penalty shootout, a practice pitch and an interactive tutorial.
- **Graphics:** Auto adapts resolution, effects, quality level and frame rate to the device, from 30 fps up to the display's refresh rate. It runs a short calibration, keeps monitoring, and the match never restarts. Manual presets remain available.
- **Controls:**
  - A first-launch "How would you like to play?" screen offering keyboard, keyboard and mouse, or controller. Touch is chosen automatically on touch devices.
  - Fully remappable keyboard, mouse and controller buttons.
  - Touch button size and a left-handed layout.
- **AI:** explainable, utility-based decisions, with a developer overlay showing the latest decision and its reasons (F3).
- **Women players and mixed teams.** A *Teams* setting draws mixed (the default), women's or men's squads. It's presentation only: every player has exactly the same abilities.
- **Records and achievements.** Local statistics (results, goals, clean sheets, personal bests, shootouts) and recent matches, plus ten achievements, all visible from the start, with no streaks, currencies or locked content. Everything is saved in your browser only.
- **Saved data controls** (*Settings → Saved data*): export a backup, import one (checked and confirmed first), reset your records, or reset everything.
- **How to Play** is now a quick start (move, pass, shoot) for the input method you use, with the full controls folded away.
- **Full time** lists each team's goals with the minute and scorer (own goals marked), and suggests a next step: the next difficulty after a win, a defending tip after a loss.
- **Learning guides** for the game loop, physics, Three.js, AI, rules and saved data, with beginner, intermediate and advanced exercises. Also coding standards and a scripts map for contributors.
- **Project:** EPL-2.0 licence, contribution guide, code of conduct, security policy, governance, GitHub issue forms, CI quality gates, Dependabot, and a learning guide.

### Changed
- **The project no longer depends on a hosting platform.** `netlify.toml` is gone. The recommended security headers, caching and MIME types are now a platform-neutral policy (`hosting/headers.json`), tested in CI and applied by `npm run check:prod`. Merging to `main` deploys nothing, and contributors need no hosting account. The maintainer's own site is deployed separately, from approved releases (see [hosting](docs/development/hosting.md)).
- **Releases include a ready-to-host web archive.** `npm run release:package` builds a reproducible `open-clutch-xi-v<version>-web.tar.gz`, with its licence, notices, header policy and a manifest of file checksums, plus a source archive and `SHA256SUMS`. `release:check` verifies the archive is byte-for-byte reproducible.
- **Site metadata is host-neutral.** Released builds no longer hard-code a canonical URL. The title, description and link-preview tags sit in one marked block that a host can replace without rebuilding, or fill at build time with `SITE_URL` (`src/siteMeta.ts`).
- **Players lean into their running.** They tilt forward when bursting away, sit back when braking and bank into curved runs, following the simulated acceleration. Before, they ran bolt upright through every turn and stop.
- **11v11 attacking:** forwards and midfielders attack the near post, the penalty spot, the far post and the edge of the box when a team-mate has the ball near goal; wide players and crosses are used; edge-of-box shots are allowed; pass risk counts the most dangerous defenders only. In seeded AI matches, goals per minute roughly doubled on most levels.
- **New players start on Easy** (it was Medium). Returning players keep the difficulty they chose.
- **The tutorial is offered once, right after you choose how to play,** instead of at your first Kick Off. It's always available from the menu.
- The menu's *Controls* button is now *How to play*, and there's a new *Records* button.
- **A new logo, favicon and social preview.** The game's name is defined in one place (`src/brand.ts`). Saved settings carry over unchanged.
- **Saved settings are validated.** A hand-edited or damaged value falls back to its default instead of breaking the game. Unreadable saved data is kept as a recovery copy. The game keeps working, without saving, when the browser blocks storage.
- **Source headers** use the longer Eclipse-style EPL-2.0 notice, checked in CI.
- **AI passing** checks whether a defender reaches the reception point first, and adds risk when the passer is closely pressed.
- **AI clearances and restart long balls** aim for open space and never go towards their own goal.
- **AI shooting:** no more hopeless long-range shots.
- **AI crosses** lead the runner, and keepers claim high balls in their area.

### Fixed
- **Very slow devices could show a frame-rate target below 30 fps.** When a device couldn't keep up, the game mistook its own low frame rate for the screen's refresh rate (down to 24 Hz). It now keeps the last good measurement, or assumes 60 Hz, and the F3 overlay marks an assumed refresh. The frame-rate floor of 30 fps now holds and is reached.
- **Players' feet slid over the grass.** Walking players skated (legs too slow) and jogging players' feet slipped backwards (legs too fast). Leg tempo is now worked out from each running style's real stride length, so planted feet stay put.
- **The tutorial could leave you stuck.** After a goal the camera kept orbiting the scorer with the ball out of shot, because it only returned to play at a kick-off, which practice never has. Pressing Switch while carrying the ball handed it to an AI team-mate. The tutorial card's Retry, Skip, Restart and Exit buttons didn't respond to clicks. All three are fixed. When the ball is out of reach, the tutorial now says where it is and how to get it back, and returns it if it stays out of reach.
- **Touch players saw keyboard keys in the tutorial and hints,** and the skill-move lesson had no touch button. Instructions now name only controls your device has, and the skill lesson is left out on touch.
- **Most players looked bald.** Only one of the hairstyles was ever loaded, and the others were bound to the wrong bones, standing at the centre spot. Every hairstyle now appears, including a short cut modelled for the women's body.
- **Robotic celebration arms.** Arms used to lock straight towards points out of reach. Gestures now bend the elbows, blend in and out, involve the torso and head, and pump or clap in a natural rhythm (still under reduce motion).
- **White glare at the sides of the stadium in daylight.** The physically based sky drew near-white haze at and below the horizon, visible through the gaps between stands, and bright enough to bloom. The sky is now capped below the bloom threshold, and a hazy landscape replaces the haze below the horizon.
- **Glare and washed-out lighting.** Night advertising boards glowed with halos and daytime views had a milky veil, because bloom caught everything brighter than nearly-white. Only lamps and floodlight flares glow now, boards are dimmer, and daytime flares are gone.
- **Blurry player names.** The name above the controlled player is now sharp HTML text instead of a glowing, upscaled sprite.
- You could walk or run with the ball before taking a throw-in (and dribble at other restarts).
- The player's side used a weaker formation than the opponents in 3v3 and 5v5, which made every difficulty harder than intended.
- Keepers' hands didn't reach towards the ball: a shared scratch vector overwrote the target.
- Settings toggle switches had no visible keyboard focus.
- Own goals were attributed to the attacker who celebrated rather than to the player who put the ball in. That player now reacts with dismay and never celebrates.
- Adaptive quality never raised graphics quality again after a temporary slowdown.
- Very slow devices were not adapted because the frame time used was capped.
- Audio now also starts from `touchend` and `click` events, which older iOS Safari versions require. (Not yet verified on a real iOS device.)
- Mouse buttons couldn't be rebound.
- On small landscape phones, the menu logo was cut off and the full-time buttons were off-screen. Screens now scroll when they don't fit, and the full-time buttons stay visible. (Checked in phone emulation only.)

[Unreleased]: https://github.com/OWNER/open-clutch-xi/commits/main
