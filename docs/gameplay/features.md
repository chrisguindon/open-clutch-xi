# Features in detail

**Audience:** players and contributors who want the full list. The [README](../../README.md) has the short version. Some of these features are rough around the edges: see [known issues](../development/known-issues.md) and the [playtesting guide](../development/playtesting.md).

**Modes**
- **XI Nations Cup.** A fictional international tournament: Short (16 teams) or Classic (32 teams), groups then knockouts, saved between matches. See [XI Nations Cup](tournament.md).
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
  - See the [rules matrix](FOOTBALL_RULES.md).
- **Referees** follow play and signal every decision. Decisions are also shown in words and announced to screen readers.
- A match clock, stamina and match statistics.
- Pass-receive assistance and assisted player switching (optional).

**AI**
- A team "brain" assigns a role to every player each tick: carrier, loose-ball chaser, presser, cover, marker, supporter, runner or shape-holder.
- The ball carrier uses **utility scoring** across shooting (an xG-like shot-quality model that picks the best aim point), passes, through balls, crosses, dribble directions and clearances.
- Off the ball, players find open space with clear passing lanes, make timed runs in behind, and keep a ball-relative formation shape that shifts between attack and defence.
- Defenders press goal-side, man-mark the most dangerous opponents, cover, intercept passes they can reach first, and time their tackles.
- **Goalkeepers** narrow the angle, react to shots after a human-like delay, push off into dives that extend over time, catch or parry, sweep loose balls, smother 1v1s and distribute.
- **Difficulty** changes reaction time, decision noise, pass and shot accuracy, pressing intensity, interception awareness and keeper reactions. It never changes speed or physics. Both teams use the same formation. See [AI and difficulty](ai-and-difficulty.md).
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
- A HUD with the scoreboard and clock, stamina, a power meter, a minimap, a pass-target ring, context hints and penalty trackers. There are also pause, settings and full-time statistics screens.

**Settings & accessibility.**
- **Graphics:** **Auto** (the default: the game measures your device and keeps adjusting resolution, effects and frame rate) or a fixed preset (Low, Medium, High, Ultra with GTAO ambient occlusion).
- **Game:** camera choice, time of day, separate volume controls, assisted switching, replays on or off, minimap, controller vibration and **reduce motion**.
- **Controls:** fully **configurable keyboard, mouse and controller buttons**, plus touch button size and a left-handed touch layout.

Settings persist in `localStorage`. Menus are keyboard- and gamepad-navigable.

## How it plays

- **Dribbling is real.** The ball rolls between touches, and each touch is taken with the foot that's stepping forward. Jogging keeps it close, sprinting knocks it ahead, and standing still near an opponent shields it.
- **Defending is about timing.** Jockey, wait for the ball to leave the attacker's feet, then tackle. Tackling through a shielding player rarely works, and clumsy challenges from behind can be fouls.
- **Momentum.** Players carve wider turns at full sprint and plant before sharp cuts. They walk, jog and sprint naturally, and backpedal or side-step when facing the play.
- **Flow.** Restarts are quick, goal celebrations are short and skippable, and replays play only for standout goals by default (*Settings → Game → Goal replays*).
