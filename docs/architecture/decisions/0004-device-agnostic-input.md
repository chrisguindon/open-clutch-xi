# 0004. Use device-agnostic input with per-scheme bindings

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

Players use keyboards (including non-QWERTY ones), keyboard and mouse, controllers and touch screens. Earlier, mouse buttons were hard-coded, and controller buttons couldn't be remapped.

## Decision

- All devices feed one `InputFrame` (`src/input/input.ts`). The simulation never knows which device was used.
- Keys are bound by **physical position** (`KeyboardEvent.code`). Labels come from the browser's keyboard layout map where available.
- Mouse buttons are binding codes (`Mouse0`–`Mouse4`) in a separate keyboard-and-mouse layout. They only act on the game canvas.
- Controller buttons have their own remappable table.
- A **control scheme** (keyboard, keyboard and mouse, controller, touch) chooses which layout hints show and edit. Every device keeps working whatever the scheme.
- Settings changes come with **migrations**, so existing customisations are never lost.

## Rationale

- One code path for game logic, whatever the device.
- Physical-position binding keeps WASD in place on AZERTY and QWERTZ keyboards.
- Separate layouts mean customising one never breaks another.

## Consequences

- New actions need a binding in each layout, a label, and help text.
- Bindings follow a "one input does one thing" rule: conflicts swap rather than leave an action unbound.
