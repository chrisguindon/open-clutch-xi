# Readable names for numpad and punctuation keys

Labels: good first issue,area:controls,enhancement

## Problem

Keys can be rebound in **Settings → Controls**. Bindings are stored as physical key codes (`KeyboardEvent.code`, for example `KeyW`), and `keyLabel()` turns them into something readable. Chromium browsers provide the printed character through the Keyboard Map API, but Firefox and Safari don't. There, keys like `Numpad4`, `BracketLeft`, `Semicolon`, `Minus` or `Backquote` appear as raw codes.

## Relevant files

- `src/game/settings.ts`: `keyLabel()` and its `map` of special names
- `tests/control-schemes.test.ts`: the existing `keyLabel` tests (*"mouse buttons have readable names"*)

## Expected behaviour

Without a layout map:
- `Numpad4` shows as `Num 4`
- `NumpadEnter` shows as `Num Enter`
- common punctuation codes show a short, readable name: `BracketLeft` → `[`, `Semicolon` → `;`, `Minus` → `-`, `Equal` → `=`, `Backquote` → `` ` ``, `Comma`, `Period`, `Slash`

Physical-position binding stays the same; only the label changes.

## Suggested starting point

Handle the `Numpad` prefix like the existing `Key` and `Digit` prefixes, then add the punctuation entries to the `map`.

## Acceptance criteria

- The new labels appear when no layout map is available.
- When a layout map is available, its printed character still wins.
- New unit tests cover a numpad key and two punctuation keys.
- `npm run ci` passes.

## How to test

`npm test -- tests/control-schemes.test.ts`. In Firefox, bind an action to a numpad key in Settings → Controls and check the label.

## Learn more

- [MDN: KeyboardEvent.code](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/code)
