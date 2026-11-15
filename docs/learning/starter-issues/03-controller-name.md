# Show shorter, friendlier controller names

Labels: good first issue,area:controls,enhancement

## Problem

When a controller is connected, the *How would you like to play?* screen and Settings → Controls show the raw `Gamepad.id`. Browsers often add technical details, for example `Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)` or `Xbox 360 Controller (XInput STANDARD GAMEPAD)`. That's long, wraps awkwardly, and means little to players.

## Relevant files

- `src/ui/ui.ts`:
  - `showChooser()`: the `Connected: …` text on the Controller card
  - `showSettings()`, controls tab: `Connected: ${escapeHtml(padName)}`
- A good place for a small pure helper, `friendlyPadName(id: string): string`, is next to `padLabel()` in `src/ui/ui.ts`.

## Expected behaviour

- The parenthesised technical part is removed: `Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)` → `Wireless Controller`.
- Anything longer than about 40 characters is shortened with an ellipsis.
- An empty result falls back to `Controller`.
- The full id stays available as a tooltip (`title` attribute).

## Acceptance criteria

- The helper has unit tests covering the two examples above, a short name that stays unchanged, and an empty string.
- Both places in the UI use it, and the output is still HTML-escaped.
- `npm run ci` passes.

## How to test

Unit tests, plus `npm run check:controls`, which uses an emulated controller called "Emulated Standard Gamepad". With a real controller: `npm run dev`, connect it, and open Settings → Controls.
