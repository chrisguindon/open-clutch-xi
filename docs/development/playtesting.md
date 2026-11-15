# Playtesting guide

**Audience:** anyone helping test a build by hand. Automated tests can't tell whether the game *feels* right or animations *look* natural, so this guide covers what needs human eyes.

Report findings with the **Gameplay feedback** or **Bug report** issue forms. Mention the mode, difficulty and controls you used.

## Tutorial
- [ ] Complete the tutorial without help. Are the instructions enough at each step, for the control method you use?
- [ ] **Make mistakes on purpose:** in Passing or Shooting, pass the ball away, kick it far off, press Switch while carrying it, score when you weren't asked to.
  - [ ] Does the camera always show the ball and your player, including straight after a goal?
  - [ ] When the ball is out of reach, does the card tell you where it is and how to get it back?
  - [ ] Do the card's **Retry step**, **Skip step**, **Restart** and **Exit tutorial** buttons all work when clicked or tapped?
- [ ] On a touch screen, the tutorial never mentions a key you don't have, and leaves out the skill-move step.

## Rules and restarts
- [ ] Put the ball out over a touchline. The throw-in goes to the right team, at the right spot. Try to run with the ball before throwing: you shouldn't be able to. Turning to aim should feel natural.
- [ ] Corners, goal kicks and free kicks: are the takers and positions believable? Do opponents keep their distance? Is the wall placed sensibly?
- [ ] 11v11 (Standard rules):
  - [ ] **Offside.** Is it given when expected, and never when you were level or in your own half?
  - [ ] **Fouls and cards.** Do they feel consistent? Is advantage played sensibly?
  - [ ] **Countdown.** Wait at a throw-in: does the countdown appear, and is it clear?
- [ ] The banner text and the referee's signal always agree.

## Referees
- [ ] The referee stays out of the way but near play. Assistants follow the defensive line.
- [ ] Signals are readable: pointing, raised arm (indirect), advantage, cards, flags.
- [ ] The officials' kit is easy to tell apart from both teams, in all three times of day.

## Animation and celebrations
- [ ] Running turns into kicking smoothly. The ball leaves the foot at the moment of contact. Feet don't slide during runs or turns.
- [ ] **Arms and elbows look natural**: arms raised with soft elbows, a fist pump in front of the chest, one arm pointing up, clapping. Nothing should look like a salute, a stiff stick arm or a mechanical wave. Check women's and men's bodies.
- [ ] Celebrations vary and suit the moment:
  - a late winner is bigger;
  - a consolation goal is subdued;
  - none looks robotic or clips into team-mates.
- [ ] Any button skips a celebration after a moment, and the kick-off follows promptly.
- [ ] Reactions to near misses and saves (hands on head) look natural and respectful.

## Difficulty and controls
- [ ] **Beginner.** Can a newcomer keep the ball, complete passes, shoot and sometimes win?
- [ ] **Easy, Medium, Hard.** Does each step up feel like a fair, noticeable step?
- [ ] **Controls.** Do keyboard, keyboard and mouse, controller and touch all feel responsive? Does remapping work?

## Appearance and lighting
- [ ] Most players have visible hair, in several styles and colours; a shaved head is occasional and intentional. Hair stays on the head while running, celebrating and diving.
- [ ] Night: advertising boards are readable without glowing halos. Floodlights glow; nothing else does.
- [ ] Day: no milky haze over the pitch or stands.
- [ ] The controlled player's name above them is sharp and readable against grass, crowd and sky.

## Devices and performance
- [ ] Real phone and tablet: touch controls, layout, frame rate (Graphics → Auto).
- [ ] High-refresh monitor: F3 shows the display rate. Auto picks 120–165 fps, and Max renders every refresh.
- [ ] Integrated-GPU laptop: Auto settles without visible oscillation.

Please describe your hardware in general terms (for example "mid-range laptop, 60 Hz"). Don't attach full benchmark exports unless a maintainer asks.

## Real-device and accessibility checklist

Automated checks use software rendering and device emulation, which are not real devices. Before a release, someone should try each of these on real hardware and note what was used. Don't tick a box for emulation.

| Device / method | Check |
|---|---|
| Desktop keyboard only | Every menu reachable with Tab/arrow keys and Enter; visible focus everywhere; the tutorial completes with the keyboard |
| Keyboard and mouse | Mouse buttons shoot/pass on the pitch but never act on menus |
| Game controller | Menus navigable with the D-pad and A/B; the tutorial shows controller buttons; rumble can be turned off |
| Phone (landscape) | Menus fit or scroll; touch controls are reachable with thumbs; the tutorial shows touch controls only; text is readable |
| Tablet | As for phone, at a larger size; touch controls are not oversized |
| Screen reader (for example NVDA, VoiceOver, TalkBack) | Menus and buttons are announced with their names; tutorial instructions and recovery notes are read out; goals, decisions and achievements are announced in words |
| Reduced motion (OS setting, or Settings → Game) | Camera shake is off; celebration gestures hold still instead of pumping or clapping |
| Bright-light sensitivity | Night and day look comfortable; no flashing or glaring areas |
