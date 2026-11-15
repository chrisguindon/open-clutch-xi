# Open Clutch XI — Asset Inventory

Every third-party file that ships in `public/assets/` is listed here with its origin, licence and how it was processed. **All third-party content is CC0 1.0 (public domain dedication)**, so attribution is not legally required. It is given anyway as good practice. There are no copyrighted likenesses, real club names, crests, kits, chants or commercial marks. Clubs, players, sponsors and crests are fictional and generated in code.

Raw sources go in `asset-src/` (gitignored, not redistributed). Shipped files are rebuilt with the scripts listed under each section.

## 3D characters and animation

| Shipped file | Source | Author | Licence | Notes |
|---|---|---|---|---|
| `public/assets/player.glb` (600 KB) | **Universal Base Characters — Standard (free) tier**, https://quaternius.itch.io/universal-base-characters | Quaternius | CC0 1.0 (`asset-src/ubc/License_Standard.txt`) | Male "SuperHero" base body, eyes and eyebrows. LOD1 and LOD2 are generated with meshoptimizer simplification (32% and 10% of triangles). Textures are re-encoded to 1024 px WebP. |
| `public/assets/player_f.glb` (650 KB) | Same pack: **Universal Base Characters — Standard (free) tier** | Quaternius | CC0 1.0 (`asset-src/ubc/License_Standard.txt`) | Female "Superhero" base body, eyes and eyebrows. Same 65-joint skeleton as `player.glb` (joint names and order verified identical), so the shared animations drive it; small rest-pose differences are corrected at runtime. LODs and textures are processed as for `player.glb`. |
| `public/assets/hair.glb` (577 KB) | Same pack | Quaternius | CC0 1.0 | Hair_Buzzed, Hair_BuzzedFemale, Hair_SimpleParted, Hair_Long, Hair_Beard and Hair_Buns, merged into one file (one glTF scene per style). |
| `public/assets/skin_light.webp`, `skin_dark.webp`, `skin_f_light.webp`, `skin_f_dark.webp` | Same pack (body base-colour textures; one light and one dark per body) | Quaternius | CC0 1.0 | Re-encoded. In-game skin tone comes from a per-player tint, not from these two textures. |
| `public/assets/anims.glb` (369 KB) | **Universal Animation Library — Standard**, https://quaternius.itch.io/universal-animation-library, and **Universal Animation Library 2 — Standard**, https://quaternius.itch.io/universal-animation-library-2 | Quaternius | CC0 1.0 (`asset-src/ual1/License.txt`, `asset-src/ual2/License.txt`) | 21 clips. UAL2 clips are retargeted onto the UAL1 skeleton, finger and scale tracks are removed, and the clips are resampled at 2e-3 tolerance. |

Only the free tiers (minimum price 0) were downloaded. The paid "Source"/"Pro" tiers were not used.

Our own work on top of the CC0 base:
- **Football kits:** shirt patterns, trims, numbers, names, crests, socks, boots and gloves. These are drawn by a shader (`src/render/characters/kitMaterial.ts`) from generated canvas atlases.
- **Procedural animation layers:** kicks, passes, tackles, keeper reach, dive roll, celebrations and strafing (`src/render/characters/footballer.ts`).
- **Per-player variation:** height, build, skin tint and hair colour.

Build: `node scripts/build-assets.mjs`, which uses @gltf-transform, meshoptimizer and sharp.

## Pitch surface

| Shipped file | Source | Author | Licence | Notes |
|---|---|---|---|---|
| `public/assets/grass_color.webp`, `grass_normal.webp`, `grass_rough.webp` | **Grass005** (1K JPG), https://ambientcg.com/view?id=Grass005 | ambientCG (Lennart Demes) | CC0 1.0 (https://docs.ambientcg.com/license/) | Re-encoded to WebP. The colour map is used only as a luminance detail layer; pitch colour, mowing stripes, wear and floodlight falloff are procedural (`src/render/stadium.ts`). |

Built by `scripts/build-assets.mjs`.

## Audio

All clips come from Freesound.org. Each was checked on its own sound page for the licence link `creativecommons.org/publicdomain/zero/1.0` ("Creative Commons 0"). The shipped files are trimmed, faded, normalised and MP3-encoded versions of the public HQ previews. The full list of source URLs is in `asset-src/audio/manifest.tsv`.

| Shipped file | Freesound sound | Author | Licence | Use / processing |
|---|---|---|---|---|
| `audio/ambience.mp3` (40 s) | #868982 "Norwegian football match / soccer game ambience", https://freesound.org/s/868982/ | Vogyik | CC0 1.0 | Stadium bed. Seconds 1–41, made into a seamless loop with a 4 s crossfade and loudness-normalised to −20 LUFS. |
| `audio/goal.mp3` | #348978 "Crazy Soccer Crowd Cheering", https://freesound.org/s/348978/ | Kinoton | CC0 1.0 | Goal roar (seconds 2–10). |
| `audio/cheer.mp3` | #397434 "Crowd Cheer", https://freesound.org/s/397434/ | FoolBoyMedia | CC0 1.0 | Kick-off, full-time, tail of the goal roar. |
| `audio/groan.mp3` | #763880 "Crowd Sigh In Disappointment", https://freesound.org/s/763880/ | ShangusBurger | CC0 1.0 | Home team concedes, full-time loss. |
| `audio/ooh.mp3` | #264499 "Crowd Ooohs and Ahhhs in Excitement", https://freesound.org/s/264499/ | noah0189 | CC0 1.0 | Near misses, woodwork. |
| `audio/applause.mp3` | #57587 "applause.wav", https://freesound.org/s/57587/ | cognito perceptu | CC0 1.0 | Big saves, full time. |
| `audio/whistle_long.mp3` | #218318 "Referee whistle blow, gymnasium", https://freesound.org/s/218318/ | SpliceSound | CC0 1.0 | Long blasts, and the final whistle (combined with short blasts). |
| `audio/whistle_short.mp3` | #538422 "Referee whistle sound", https://freesound.org/s/538422/ | Rosa-Orenes256 | CC0 1.0 | Short blasts. |
| `audio/kick1.mp3` | #261267 "Soccer Kick", https://freesound.org/s/261267/ | musita182 | CC0 1.0 | Ball strikes, with pitch and level varied by power. |
| `audio/kick2.mp3` | #555042 "Soccer Ball Kick", https://freesound.org/s/555042/ | bittermelonheart | CC0 1.0 | Ball strikes (alternated with kick1). |

Build: `./scripts/build-audio.sh` (needs ffmpeg).

Recordings of real club chants and songs were deliberately not used, even where they were marked CC0.

**Synthesised fallback.** Every sound also has a procedural Web Audio version in `src/audio/audio.ts`. It is used automatically if a file fails to load, and always for touches, bounces, posts, nets, tackles and UI clicks. To check it, run `node scripts/audio-check.mjs`: it plays everything with the files available, then again with the file requests blocked.

## Flags and font

| Shipped file | Source | Licence | Notes |
|---|---|---|---|
| `public/assets/flags/*.svg` (54 files) | **flag-icons** 7.6.0, https://github.com/lipis/flag-icons | MIT (`public/assets/flags/LICENSE-flag-icons.txt`) | 4×3 SVG flags of the 54 national teams, copied unchanged from the package (byte-identical to its `flags/4x3/` files). National flags themselves are public symbols. No federation crests are used. |
| Inter font (`dist/static/inter-*.woff2`) | **@fontsource-variable/inter**, https://rsms.me/inter/ | SIL Open Font License 1.1 | Self-hosted, so there is no request to Google Fonts. It matches the typeface of chrisguindon.com. |
| `public/favicon.svg`, `apple-touch-icon.png`, `social-card.jpg` | Made for this project (the social card is a screenshot of the game's menu) | Original | |

**National teams.** The game includes 54 teams: every team of the 2022 and 2026 men's world championships (2026 is the latest completed edition), presented neutrally as "National Teams". Kits are generic designs in national colours.
- Kits are generic designs in each country's national colours: solid, stripes, hoops, halves, sash, contrast sleeves or checks.
- Player names are generated from a neutral list.
- No federation crests, sponsor marks, official kit replicas or real players are used.

**Stadium advertising.** Every sponsor on the LED boards is fictional, apart from the game's own name. A site hosting the game may add up to three panels of its own through `site-config.json`, and is responsible for having the right to show them.

**Creator portrait.** None is included. The About screen shows the creator's initials unless the hosting site supplies a portrait through `site-config.json`; the maintainer's own site does, from its separate deployment repository.

## Code libraries (runtime)

| Library | Licence |
|---|---|
| three.js 0.187 (core plus addons: GLTFLoader, SkeletonUtils, Sky, EffectComposer passes, GTAO, Unreal bloom) | MIT |
| meshoptimizer decoder (bundled with three) | MIT |

Build-time only: @gltf-transform/* (MIT), meshoptimizer (MIT), sharp (Apache-2.0), Vite (MIT), TypeScript (Apache-2.0), Vitest (MIT), puppeteer-core (Apache-2.0).

## Generated in code (no external source)

- crowd sprite atlas
- advertising boards and sponsor names (fictional)
- club crests and kit atlases
- sky for night (stars)
- the stadium geometry: stands, aisles, tunnels, roof, ribs, flags, floodlights, dugouts
- goal nets
- ball texture
- confetti and fireworks
- UI and icons
