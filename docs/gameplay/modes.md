# Game modes, tutorial and replays

**Audience:** players, and contributors working on modes or match flow.

## Modes

| Mode | What it is | Rules |
|---|---|---|
| **Quick Match** | 3v3, 5v5 or 11v11 against the computer, 2–8 minutes, night, dusk or day | Arcade (3v3, 5v5) or Standard (11v11): see the [rules matrix](FOOTBALL_RULES.md) |
| **Penalty shootout** | Best of five, then sudden death. You shoot and keep in turn. | See [penalties](ai-and-difficulty.md#penalties) |
| **Practice** | Free play with two passing partners and a keeper. `R` returns the ball. No clock and no restarts: the ball comes back to you when it goes out. | — |
| **Tutorial** | Six steps on the practice pitch (move, sprint, pass, shoot, score, skill move), advanced by what you actually do. Offered once on first launch, right after the controls chooser (or at the first Kick Off if the chooser was skipped), and always on the menu. | — |

**Team composition** (*Teams & options → Teams*): **Mixed** (default), **Women** or **Men**. It only changes how players are drawn. Every player has the same abilities, whatever they look like (see [animation](animation.md)).

**Difficulty:** new players start on **Easy**. Beginner is there for first-timers, and Medium and Hard for a challenge. A returning player's choice is never changed.

**How to play** shows three quick-start cards (move, pass, shoot) for the input method in use (keyboard, keyboard and mouse, controller or touch), then that method's full controls and some tips, folded away.

**Records** shows your statistics, all ten achievements (locked ones included) and recent matches, all saved in this browser only. See [statistics and achievements](progression.md).

**Match flow:**
- After the ball goes out there is a short pause (0.55 s), then the restart is set up (see the [restart stage machine](FOOTBALL_RULES.md#the-restart-state-machine-laws-8-9-1317)).
- AI takers act within 0.35–0.75 s.
- Celebrations are short and skippable ([animation](animation.md)).
- **Full time** shows:
  - the result;
  - each team's goals (minute, scorer, own goals marked "o.g."; from `Match.goalLog`);
  - any achievements just unlocked, in one quiet line;
  - the match statistics;
  - one line suggesting a next step (the next difficulty up after a win, a defending tip after a loss).

  Rematch, Change teams and Main menu stay visible on small screens. The match is added to your records at this point; quitting or restarting earlier doesn't count it.

## Tutorial reliability

The tutorial (`src/game/tutorial.ts`) watches real gameplay, so it must never get stuck:
- **Every step starts from a valid state.** It's set up once on entering the step, or on *Retry*, never repeatedly during play. For example, the ball goes to your feet for the pass, shoot and score steps, and stamina is refilled for the sprint step: an exhausted player can't sprint.
- **Passes and shots are counted** from the `humanKick` event, emitted *before* control moves to a pass receiver, so counting can't depend on event order.
- **The player always controls the ball carrier.** While your team has the ball, the controlled player *is* the player with it: Switch does nothing then, and if an AI team-mate ever gains the ball, control moves to them. (Switching away used to hand the ball to an AI team-mate, leaving you watching someone else keep it.)
- **The camera follows play.** The goal-celebration shot ends as soon as play resumes. It used to end only at a kick-off, which practice never has, so after a goal in the tutorial the camera kept orbiting the scorer with the ball out of shot.
- **Losing the ball is explained, then recovered,** in this order:
  - after 2.5 s out of reach (more than 6 m away and not yours), the card says where it is and how to get it back (*press R*; on touch, that it comes back by itself);
  - the ball returns to your feet when it has sat idle with nobody on your team controlling it (8 s, or 5 s on touch, which has no reset button), or is stranded more than 14 m away for 4 s.
- **Other watchdog recoveries,** only for persistent impossible states: a frozen ball during play (immediately), play not running for 3 s, pushing the stick without moving for 1.5 s.
- **Instructions match your controls:** keyboard, keyboard and mouse, controller or touch. They are redrawn if you switch method mid-lesson. On touch, which has no skill-move button, the skill lesson is left out (the steps are numbered 1–5), never shown as impossible.
- **Recovery controls:** *Retry step*, *Skip step*, *Restart* and *Exit* on the tutorial card (clickable and tappable) and in the pause menu.
- **A former soft-lock to guard against:** goals freeze the ball until a restart is taken, but practice has no restarts, so the practice reset must lift the freeze (`Match.practiceReset`). `tests/tutorial.test.ts` covers this, along with:
  - completion on several seeds, including with the ball knocked away at random;
  - every watchdog case;
  - switching while carrying;
  - an AI team-mate gaining the ball;
  - unexpected goals;
  - ball out of play;
  - touch instructions;
  - changing input method mid-lesson.

  `npm run check:tutorial` plays the tutorial in a browser with real key presses, then makes deliberate mistakes with real clicks and keys (switch while carrying, losing the ball, the reset key, scoring and checking the camera, retry, skip, exit, re-entry).

## Replays

- *Settings → Game → Goal replays:* **Off**, **Best goals** (default: long range, headers, chips) or **All**.
- `ReplayDirector` (`src/game/replay.ts`) finds the decisive strike in the recorded frames, starts 1.3 s before it, plays the strike in slow motion, and always ends: at the end of the footage, on skip, or at a 7 s cap. A replay is dropped if the match moves on.
- Replays record players and the ball. The officials are hidden during replays.

## First-launch defaults

On first launch only, the game picks starting settings from the device class (`classifyDevice` / `profileFor` in `src/game/settings.ts`). A player's saved choices are never overridden.

| Device class | Starting quality | Frame rate |
|---|---|---|
| Phone | Low | 60 |
| Tablet | Low | 60 |
| Laptop with integrated GPU | Medium | Auto |
| Other desktop | High | Auto |

With **Graphics → Auto** (the default) the game then adapts continuously (see [performance](../development/performance.md)).
