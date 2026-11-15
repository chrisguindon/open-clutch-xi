# Animation

**Audience:** contributors working on characters, celebrations or officials.

## How characters are animated

- **Two CC0 base bodies** (Quaternius Universal Base Characters): `player.glb` and `player_f.glb`. Each has three LODs (switching at 16 m and 46 m) and the same 65-joint skeleton (identical joint names and order), shared by each player's meshes. Which body a player is drawn with comes from the *Teams* setting (women, men or mixed; `src/render/characters/squad.ts`). It is presentation only, and the simulation never sees it.
- **One set of animations for both bodies.** The clips were baked on the first body (the *reference*). They store absolute bone rotations and translations, so the second body gets small per-bone corrections, measured once from its rest pose (`retargetFor` in `clipSampler.ts`): it keeps its own bone lengths and rest angles while following the clip's motion. For the reference body there are no corrections and no extra per-frame cost.
- **Kits fit both bodies.** The kit shader's garment boundaries are calibrated to the reference body. Each body's skeleton landmarks (ankle, knee, hip, shoulder, neck, head) are measured at load, and its bind positions are mapped onto the reference before the shirt, shorts and socks are drawn (`fitBody` in `kitMaterial.ts`). The small chest number and crest sit on the upper chest (`chestBadgeY`).
- **Hair** was rigged on the reference head. On the other body it is moved to that body's head with one corrected bind matrix, sharing the body's skeleton (no second skeleton update per hair mesh).
  - `hair.glb` holds one glTF scene per hairstyle, so the loader reads every scene, not just the default one.
  - The loader renames duplicate bone names in merged files (`Head_1`), so each hair bone's real name is recorded (`canonicalBoneName`) before binding.
  - Missing either step left most players bald, with their hair standing at the centre spot. `tests/hair-assets.test.ts` guards both.
- **Recorded clips** (CC0 Universal Animation Libraries) are baked to 30 fps and blended by `PoseSampler` (`src/render/characters/clipSampler.ts`) without allocation.
  - **Locomotion** blends idle, walk, jog and sprint by speed. Clip time follows the simulation's **gait phase**, so the feet land on the dribble touches.
  - **No foot skating:** the legs cycle at speed ÷ stride length (`cadence` in `src/sim/gait.ts`), using stride lengths measured from the clips, so a planted foot stays put on the grass. The simulation and the renderer share one blend table (`gaitWeights`). `tests/gait.test.ts` re-measures the clips and fails if the table drifts from them.
  - **Body lean:** runners lean forward to burst away, sit back to brake and bank into curves, by a share of the physical angle atan(a / g) of the simulated acceleration (`bodyLean` in `src/render/characters/lean.ts`). The body tilts about the feet, so planted feet don't move.
  - **Action clips** are indexed by the simulation's action time: slides, stumbles, falls and get-ups, throw-ins, celebrations, dejection.
  - **Nothing in animation adds input delay:** the simulation decides, and the animation follows.
- **Procedural layers** (`Footballer`, `src/render/characters/footballer.ts`) aim bone chains at targets in model space:
  - kick and pass wind-up, strike and follow-through, from the foot the simulation chose (contact timing is shared through `KICK_TIMING`);
  - tackles and headers;
  - keeper stance (knees bent, weight forward, hands low and in front with elbows bent, fading into a reach when the ball comes close), reach towards the ball, and dive roll;
  - strafing;
  - gestures.

## Gestures: celebrations, reactions and officials' signals

The simulation chooses a **gesture code** per player (`Player.gesture`, `src/sim/celebration.ts`) and stores it in the frame buffer (`PF.Gesture`). Replays therefore show exactly what happened.

- **Goal celebrations** are chosen from the match context only: score, minute, own goal. Never from nationality, appearance or gender.

  | Context | Scorer's celebration |
  |---|---|
  | Late (80′+) equaliser or winner | Big: a run to the corner flag, or the whole team piling in |
  | Consolation while still 2+ behind | Subdued: a raised hand and a jog back. Team-mates head for the kick-off. |
  | Own goal by the opponents | A brief fist pump by a nearby player of the benefiting team |
  | Otherwise | One of six: arms up, fist pump, pointing to the sky, applauding the fans, corner run, or the "yes!" motion. Never the team's previous one. |

  **Variety beyond the scorer:**
  - Team-mates each pick a reaction (the "yes!" motion, arms up, clapping or a fist pump), varied by player and by goal.
  - Looping reactions start at a different point for every character, so a group never moves in unison.
  - Only the corner-running scorer uses the "aeroplane" arms; team-mates running to join sprint naturally.
  - The team that conceded varies too: dejected head shake, hands on head, hands on hips.

  **Own goals:** the player who put the ball into their own net is credited ("o.g."), looks dismayed (hands on head) and never celebrates. The celebration is led by a player of the team that benefits.

  Celebrations end on their own (1.3–2.8 s), can be skipped with any button after 0.6 s, and team-mates stop 2.2 m short of the scorer.

  **How gestures are posed** (`poseGesture` and `armPose` in `footballer.ts`):
  - **A two-bone arm solver.** Each pose is a hand position relative to the shoulder, in arm lengths, plus the direction the elbow points. The law of cosines places the elbow, so arms bend naturally. Earlier gestures aimed the upper arm and forearm at the same point, usually higher than the hand can reach, which gave locked, straight, robotic arms.
  - **Eased blending:** a gesture blends in over 0.32 s and out over 0.28 s, so arms move into a pose rather than snapping.
  - **The body takes part:** the back arches with arms up, the torso crunches into each fist pump, and the head looks up when pointing.
  - **Movement, not oscillation:**
    - the fist pump is three quick pulls down with slower recoveries, then a held fist;
    - clapping is about 2.6 claps a second;
    - timings are offset per player.
  - **Reduce motion** (Settings → Game) holds gestures still: no pumping or clapping rhythm.
  - Officials' signals keep a straight pointing arm, which is what referees and assistants actually do.
- **Reactions:** hands on head after a near miss or a saved shot (about 1.5 s). At full time, winners raise their arms and the losing team looks dejected.
- **Officials' signals** (codes 20+):
  - referee: point the direction, raised arm (indirect free kick), advantage, yellow or red card (a card prop in the hand);
  - assistants: flag up (offside), flag towards the throw-in direction, level (goal kick) or down (corner).

## Quality checks

- **Automated:** `tests/rules.test.ts` covers celebration choice, variety, own goals, skipping, ending and gestures.
- **Captures:** `node scripts/celebration-gallery.mjs` captures every celebration style, plus an own goal, to `screenshots/celebrations/` for review, and `scripts/rules-check.mjs` captures the restart flow.
- **Close-ups:** `node scripts/player-capture.mjs <tag>` captures every gesture from the front and side (`SQUAD=women|men` for each body; `ONLY=g-` for gestures only).
- **Human review needed:** see the [playtesting guide](../development/playtesting.md). Gestures are procedural poses over recorded clips; whether they look natural can only be judged by eye.

## Adding a gesture

1. Add the code in `src/sim/celebration.ts` (players) or the `OG` table in `footballer.ts` (officials).
2. Decide it in the simulation (`Match`), never in the renderer.
3. Pose it in `Footballer.poseGesture()` with `armPose` (hand and elbow direction relative to the shoulder, in arm lengths: keep the hand under 1 arm length away so the elbow stays soft). Officials' straight-arm signals use `arm()`, with targets in the root frame: +z forward, +x the character's left, y up from the feet.
4. Add a test for when it's chosen, and capture a screenshot for review.
