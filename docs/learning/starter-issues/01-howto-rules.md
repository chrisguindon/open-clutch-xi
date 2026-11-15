# Explain Standard and Arcade rules on the How to Play screen

Labels: good first issue,area:gameplay,documentation

## Problem

11v11 matches use **Standard** rules (offside, yellow and red cards, assistant referees), while 3v3 and 5v5 use **Arcade** rules (no offside, no cards). The team-selection screen mentions this in one line, but *How to Play* doesn't explain what offside or advantage mean. New players may be surprised by an offside whistle.

## Relevant files

- `src/ui/ui.ts`: `showHowTo()`, where the controls tables and tips are built
- `docs/gameplay/FOOTBALL_RULES.md`: what each profile supports (use this as the source; keep the in-game text short)
- `src/sim/rules.ts`: the `RULES` profiles

## Expected behaviour

A short **Rules** block on How to Play, with two or three sentences for each profile:
- **Standard (11v11):** offside — don't be beyond the last defender when a team-mate passes; cards for reckless challenges; the referee can play advantage.
- **Arcade (3v3, 5v5):** no offside or cards; fouls still give free kicks and penalties.

## Acceptance criteria

- The text is accurate for the current rules (check `src/sim/rules.ts`).
- It reads well on a phone-sized screen (try the browser's device emulation).
- `npm run ci` passes.

## How to test

`npm run dev`, then open How to Play from the menu.
