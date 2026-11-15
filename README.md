# Open Clutch XI

**A free, open-source 3D football game that runs entirely in your browser**, by [Christopher Guindon](https://www.chrisguindon.com/about/).

### ▶ [Play now at fc.chrisguindon.com](https://fc.chrisguindon.com)

No download, no account, no tracking. Pick a national team and play against the computer with a keyboard, mouse, controller or touch screen.

Open Clutch XI started as a fun experiment in AI-assisted development with my nephews, who love football games. It's built with TypeScript and Three.js, and it's **open source under the [Eclipse Public License 2.0](LICENSE)**. It is a personal project, not an Eclipse Foundation project.

- **Teams:** pick from **54 national teams**, as women's, men's or mixed squads.
- **Formats:** 3v3, 5v5 or 11v11 against a tactical AI.
- **Other modes:** a penalty shootout, a practice pitch and an interactive tutorial.
- **Records:** your statistics, recent matches and ten achievements, saved **only in your browser**, with export, import and reset in *Settings → Saved data*.
- **Devices:** keyboard, keyboard & mouse, controller or touch. The game has no backend, no accounts and no tracking. Its players, animations, turf textures and recorded sounds are **CC0** (public-domain) assets, and everything else is generated in code. See [docs/governance/third-party-assets.md](docs/governance/third-party-assets.md) for the full inventory.

```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # static production build in dist/
npm run preview    # serve the production build
npm test           # unit + simulation tests (vitest)
```

Requires Node 22+ (24 recommended, see `mise.toml`) and a browser with **WebGL2** (current Chrome, Edge, Firefox or Safari).

## Learn, fork and contribute

Open Clutch XI is also a learning project. It's a complete game that's small enough to read, and it's a good place to learn TypeScript, Three.js, game physics, game AI and testing, or to try out AI-assisted development.

- **[docs/learning/README.md](docs/learning/README.md):** a guided tour of the code and hands-on exercises.
- **[CONTRIBUTING.md](CONTRIBUTING.md):** how to set up, make a change and open a pull request. Issues labelled [`good first issue`](https://github.com/chrisguindon/open-clutch-xi/labels/good%20first%20issue) are a friendly start.
- **[Discussions](https://github.com/chrisguindon/open-clutch-xi/discussions):** questions (*Q&A*, *Learning*), ideas, and *Show and Tell*. Forked it and built a new skill move? Share a video!
- **Community health:**
  - [Code of Conduct](CODE_OF_CONDUCT.md)
  - [Security policy](SECURITY.md)
  - [Governance](GOVERNANCE.md)
  - [Changelog](CHANGELOG.md)
  - [Releasing](docs/development/releasing.md)
  - [AGENTS.md](AGENTS.md), with guidelines for AI-assisted work

---

## Features

**Modes**
- **Quick Match.** 3v3, 5v5 or 11v11 against the AI, with Beginner, Easy, Medium or Hard difficulty and 2–8 minute matches. Pick from 54 national teams, with night, dusk or day kick-offs.
- **Practice.** Free play with two passing partners and a keeper. Press `R` to reset the ball. No clock.
- **Penalty Shootout.** Best of five, then sudden death. Aim with a reticle and hold to charge power. When the CPU shoots, you are the keeper and pick your dive.
- **Interactive tutorial.** Offered on first launch and also available from *How to Play*. It watches your real inputs and advances step by step.

**Football**
- Ball physics: gravity, quadratic drag and the **Magnus effect**, so shots curl and topspin makes them dip. Bounces transfer spin, the ball rolls with resistance, rebounds off the posts and crossbar, and gets caught by a deformable net.
- Dribbling is physical, not glued: the ball rolls between touches taken on the stepping foot. Jogging keeps it close, and sprinting knocks it ahead, which is faster but easier to steal. The first touch on a received pass depends on the incoming speed.
- Ground passes, driven passes, through balls, lobs and crosses, headers, power shots, curling finesse shots and chips.
- Standing and sliding tackles. A slide that clips the player before the ball is a foul, which means a free kick, or a penalty inside the box.
- Skill moves: feint-and-burst, drag-back and a step-over that can wrong-foot nearby defenders.
- **Laws of the Game.**
  - 11v11 uses **Standard** rules: offside, fouls with yellow and red cards, advantage, walls, and assistant referees.
  - 3v3 and 5v5 use faster **Arcade** rules.
  - Every restart (kick-off, throw-in, corner, goal kick, free kick, penalty) follows the Laws: no carrying the ball at a throw-in, opponents keep their distance, no second touch.
  - See the [rules matrix](docs/gameplay/FOOTBALL_RULES.md).
- **Referees** follow play and signal every decision. Decisions are also shown in words and announced to screen readers.
- A match clock, stamina and match statistics.
- Pass-receive assistance and assisted player switching (optional).

**AI**
- A team "brain" assigns a role to every player each tick: carrier, loose-ball chaser, presser, cover, marker, supporter, runner or shape-holder.
- The ball carrier uses **utility scoring** across shooting (an xG-like shot-quality model that picks the best aim point), passes, through balls, crosses, dribble directions and clearances.
- Off the ball, players find open space with clear passing lanes, make timed runs in behind, and keep a ball-relative formation shape that shifts between attack and defence.
- Defenders press goal-side, man-mark the most dangerous opponents, cover, intercept passes they can reach first, and time their tackles.
- **Goalkeepers** narrow the angle, react to shots after a human-like delay, push off into dives that extend over time, catch or parry, sweep loose balls, smother 1v1s and distribute.
- **Difficulty** changes reaction time, decision noise, pass and shot accuracy, pressing intensity, interception awareness and keeper reactions. It never changes speed or physics. Both teams use the same formation. See [AI and difficulty](docs/gameplay/ai-and-difficulty.md).
- **Celebrations** are chosen from the match situation (a late winner, a consolation goal, an own goal), vary from goal to goal, and can always be skipped.

**Presentation**
- **Rigged footballers.** They are built on a CC0 base body with three LODs, five hair styles, faces and per-player variation in height, build and skin tint. Kits are drawn by shader in six shirt designs, with trims, back names and numbers, chest numbers, crests, socks and boots.
- **Animation.** Recorded clips are blended by speed and synced to the simulation's gait phase: idle, walk, jog, sprint, slide, stumble, fall and get-up, throw, celebrations. Procedural layers on top handle kicks and passes from the correct foot, tackles, headers, keeper reach, dives, catches and strafing.
- **Lighting environments** for day, dusk and night:
  - a PMREM environment map for reflections
  - a physically based sky for day and dusk
  - floodlight towers with a shadow-casting key and three fill lights
  - multi-directional player shadows under floodlights
  - light shafts through haze
  - exponential fog
  - per-environment colour grading and vignette
- **Pitch.** CC0 photo-scanned turf detail with anti-tiling. Mowing stripes whose brightness changes with the viewing direction, cross-mowing, wear in the goalmouths and centre, and floodlight falloff.
- **Stadium.** Tiered stands with aisles and tunnel entrances, roof ribs, team-coloured fascia and waving roof flags. Also **thousands of instanced billboard fans**, scrolling LED boards, floodlight pylons, dugouts, corner flags and goals with rippling nets.
- Three gameplay cameras (Broadcast, Dynamic, Tactical) plus cinematic cameras for intros, celebrations, replays and penalties.
  - The Broadcast camera zooms dynamically with how spread out the play is.
  - Low cameras push out of player bodies and rise when a player would hide the ball.
- **Broadcast presentation.**
  - A pre-match line-up dolly with starting XI cards.
  - Replays are letterboxed, with a stinger wipe and a clean HUD. Confetti and fireworks are cleared so they never hang over a replay.
- Goal celebrations with confetti and fireworks, the crowd jumping, a roar, a slow-motion **instant replay**, ball trails on power shots and a subtle FOV kick.
- **Audio.** CC0 recordings provide the stadium ambience, goal roar, cheer, groan, "ooh", applause, referee whistles and ball strikes.
  - Dynamic mix: crowd excitement opens a filter and raises the ambience bed, and whistles and roars duck the crowd.
  - Kicks are panned to where the ball is on screen, and the home crowd groans when you concede.
  - Every sound has a synthesised Web Audio fallback.
- A premium HUD: scoreboard and clock, stamina, a power meter, a minimap, a pass-target ring, context hints and penalty trackers. There are also pause, settings and full-time statistics screens.

**Settings & accessibility.**
- **Graphics:** **Auto** (the default: the game measures your device and keeps adjusting resolution, effects and frame rate) or a fixed preset (Low, Medium, High, Ultra with GTAO ambient occlusion).
- **Game:** camera choice, time of day, separate volume controls, assisted switching, replays on or off, minimap, controller vibration and **reduce motion**.
- **Controls:** fully **configurable keyboard, mouse and controller buttons**, plus touch button size and a left-handed touch layout.

Settings persist in `localStorage`. Menus are keyboard- and gamepad-navigable.

## Controls

On first launch the game asks **"How would you like to play?"**:
- **Keyboard only**
- **Keyboard & mouse**
- **Controller.** This option is enabled once one is connected.

You can skip the question. It's asked only once, and you can change your answer any time in *Settings → Controls*. Touch-only devices get touch controls automatically. Whatever you choose, every device keeps working.

Everything can be rebound under *Settings → Controls*: keys, mouse buttons and controller buttons. Conflicting bindings swap rather than leave an action without one. Keys are matched by physical position, so WASD stays put on AZERTY and QWERTZ keyboards, and labels show what's printed on your keyboard where the browser exposes it.

| Keyboard | Attacking | Defending | Controller (Xbox / PlayStation) |
|---|---|---|---|
| `WASD` / arrows | Move | Move | Left stick |
| `Shift` | Sprint | Sprint | RT / R2 |
| `Space` | Pass | Standing tackle | A / ✕ pass · hold to jockey |
| `J` | Shoot | Slide tackle | B / ○ shoot · tackle |
| `K` | Through ball | Switch player | Y / △ through ball |
| `L` | Lob / cross | Jockey (hold) | X / □ lob · slide tackle |
| `E` | Skill move | — | RB / R1 |
| `Q` | Switch player | Switch player | LB / L1 |
| `C` · `Esc` | Camera · Pause | | View · Start |

**Keyboard & mouse:**
- **Move:** `WASD`. **Sprint:** `Shift`.
- **Left click:** shoot / slide tackle.
- **Right click:** pass / standing tackle.
- **Middle click or `Q`:** through ball / switch player. The middle button is never the only way to do something.
- **`Space`:** lob / cross / jockey.
- **`E`:** switch player. **`F`:** skill move.

Mouse buttons only act on the pitch, never on menus, and the right-click menu is suppressed there. *Aim with the mouse* is optional.

**Control style** (*Settings → Controls*):
- **Simple** (the default): passes and shots fire the moment you press, with assisted power.
- **Advanced:** hold Shoot (and Pass, if Passing is set to Charged) to charge power.

**Returning players** keep their saved keys. If they never changed the old defaults, the menu offers the new layout once.

**Touch:** a floating joystick on the left (push it to the edge to sprint) and three contextual buttons on the right.

## How it plays

- **Dribbling is real.** The ball rolls between touches, and each touch is taken with the foot that's stepping forward. Jogging keeps it close, sprinting knocks it ahead, and standing still near an opponent shields it.
- **Defending is about timing.** Jockey, wait for the ball to leave the attacker's feet, then tackle. Tackling through a shielding player rarely works, and clumsy challenges from behind can be fouls.
- **Momentum.** Players carve wider turns at full sprint and plant before sharp cuts. They walk, jog and sprint naturally, and backpedal or side-step when facing the play.
- **Flow.** Restarts are quick, goal celebrations are short and skippable, and replays play only for standout goals by default (*Settings → Game → Goal replays*).

## Testing

```bash
npm test                 # unit, simulation and scenario tests: physics, contact, rules, flow, replays, AI decisions, controls, settings migration, adaptive quality, perf, camera
npm run ci               # everything CI runs: format, lint, types, tests, build and the repository checks below
npm run lint             # ESLint (first time: npm run lint:setup) · npm run format applies Prettier
npm run check:licenses   # licence headers, dependency licence allow-list, asset inventory, third-party notices
npm run check:repo       # repository hygiene: secrets, private paths, profiling exports, generated files
npm run check:docs       # Markdown links and anchors, required community files
npm run check:github     # issue forms, workflows (pinned, least privilege), Dependabot, labels
npm run check:controls   # real-browser: control chooser, mouse buttons, rebinding by click, emulated controller remap
npm run check:adaptive   # real-browser: adaptive quality on an emulated slow and fast device
npm run check:rules      # real-browser: restarts (no carrying the ball at a throw-in), celebration, kick-off
npm run sbom             # CycloneDX software bill of materials → release/
npm run release:check    # full, reproducible release validation (commits/tags nothing)
npm run report:ai        # AI decision audit (irrational-decision rates) → test-results/ai-audit.log
npm run test:browser     # headless Chromium smoke test (needs Chromium; see below)
npm run metrics          # gameplay metrics report vs tests/fixtures/metrics-baseline.json (~10 min)
npm run bench            # simulation CPU / GC benchmark
npm run capture:review   # full screenshot review → screenshots/review-after/
npm run capture:perf     # render stats (draw calls, triangles, shader programs) + screenshots
npm run capture:anim     # close-up animation frame sequences
npm run capture:replay   # long-range goal replay frames (+ checks confetti is cleared during replays)
npm run capture:lighting # night / dusk / day × broadcast / dynamic / tactical / close-up matrix
npm run capture:player   # one footballer through every animation state
npm run bench:headless   # in-game benchmark in headless Chromium (software GL: CPU breakdown only)
npm run bench:cpu        # deterministic CPU micro-benchmark of the production build (npm run build first)
npm run check:mobile     # phone emulation: touch joystick/buttons, no scroll/zoom (not a real-device test)
npm run check:fluidity   # real-browser loop/interpolation check under jittered frame timing
npm run check:audio      # loads every audio sample, plays each sound, then repeats with files blocked (fallback)
npm run build:assets     # rebuild public/assets/*.glb / *.webp from asset-src/ (CC0 sources, see docs/governance/third-party-assets.md)
npm run build:audio      # rebuild public/assets/audio/*.mp3 (needs ffmpeg)
```

**In the game:**
- **F3** (or `?diag`) opens the diagnostics overlay: frame times, input latency, adaptive quality and the AI's latest decision with its reasons.
- `?bench` runs the benchmark.
- `?lab` opens the movement lab.
- `?fps` shows a frame-rate counter.

More detail:
- [Testing](docs/development/testing.md): test layers, browser checks, why statistics need many seeds.
- [Performance](docs/development/performance.md): frame pacing, adaptive quality, budgets, profiling tools.
- [Playtesting guide](docs/development/playtesting.md): what needs human eyes.
- [Documentation index](docs/README.md).

## Hosting

Open Clutch XI is a static web app that any static host can serve, including from a subdirectory; the project doesn't depend on a hosting platform, and contributors need no hosting account. `npm run build` produces `dist/` with relative asset paths: hashed bundles go in `static/`, and the game's own files go in `assets/`. Releases also provide a ready-to-host, checksummed web archive (`npm run release:package`). See [hosting](docs/development/hosting.md) for the recommended security headers and how to set your own site's title and link previews. The maintainer's own copy at https://fc.chrisguindon.com is deployed separately, from approved releases only. There are no API keys or external services. The only runtime requests are for the game's own files in `assets/`: models, animations, turf and audio, about 3.5 MB in total. If any of them fails to load, the game falls back to procedural players, grass or sound.

## Licence & assets

Open Clutch XI is licensed under the **Eclipse Public License 2.0**: see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Source files carry the Eclipse-style EPL-2.0 header with an `SPDX-License-Identifier: EPL-2.0` line. No Secondary Licenses are declared. This is a personal project. It is not affiliated with, endorsed by or governed by the Eclipse Foundation; EPL-2.0 is simply the licence chosen for it.

This repository contains no personal branding: sites that host the game can add their own through `site-config.json` (see [hosting](docs/development/hosting.md)).

All code, procedural art, synthesised audio and sponsor names are original. National teams use flags and national colours only, with no crests, official kits or player likenesses; player names are generated.

Third-party content:
- CC0: Quaternius, ambientCG and Freesound contributors
- flags: flag-icons (MIT)
- font: Inter (SIL OFL)

All of it is listed with sources and processing steps in [docs/governance/third-party-assets.md](docs/governance/third-party-assets.md). [NOTICE.md](NOTICE.md) is the canonical legal notice, with every licence text. It ships with the game as `NOTICE.txt`, linked from the About screen. The only runtime code dependency is [three.js](https://threejs.org) (MIT). See the [architecture overview](docs/architecture/README.md) for technical details and design decisions, and [GOVERNANCE.md](GOVERNANCE.md) for how the project is run.
