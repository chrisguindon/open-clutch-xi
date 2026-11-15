# Controls

**Audience:** players and contributors working on input. Design rationale: [ADR 0004](../architecture/decisions/0004-device-agnostic-input.md).

## Control schemes

On first launch the game asks **"How would you like to play?"**: keyboard only, keyboard and mouse, or controller (available once one is connected). Touch-only devices get touch controls automatically. The choice is remembered and can be changed in *Settings → Controls*. Every device keeps working whichever scheme is chosen; the scheme decides which layout hints show and which layout is edited.

| Action | Keyboard | Keyboard & mouse | Controller (Xbox / PlayStation) |
|---|---|---|---|
| Move · sprint | WASD / arrows · Shift | WASD · Shift | Left stick · RT / R2 |
| Pass · standing tackle | Space | Right click | A / ✕ |
| Shoot · slide tackle | J | Left click | B / ○ |
| Through ball · switch | K | Q (or middle click) | Y / △ |
| Lob / cross · jockey | L | Space | X / □ |
| Skill move | E | F | RB / R1 |
| Switch player | Q | E | LB / L1 |
| Pause · camera | Esc / P · C | Esc / P · C | Menu · View |

At restarts the taker can't move. The movement stick turns them to aim instead.

## Who am I controlling?

The player you control has a ring at their feet, and the player card in the corner of the HUD shows their name, role and stamina.

On a big screen with a mouse or keyboard, their name also stays above them. On touch screens and small windows (shorter side under 500 px) it appears only briefly, for 1.6 s when you switch players or play restarts, then fades. On a phone a player is only about a dozen pixels wide, while a name is about a hundred: a permanent name hid the players further up the pitch and repeated the card. The rule is in `src/ui/playerLabel.ts`, and `npm run check:mobile-hud` checks it in phone, tablet and desktop layouts.

## Customisation
- **Keyboard** and **keyboard & mouse** are separate layouts. Keys are bound by physical position, so WASD stays put on AZERTY and QWERTZ keyboards.
- **Mouse buttons** (`Mouse0`–`Mouse4`) bind like keys and act only on the pitch, never on menus. The right-click menu and middle-click autoscroll are suppressed there. The middle button is never the only way to do something.
- **Controller buttons** can be remapped by pressing the new button.
- **Touch:** button size and a left-handed layout.
- **Conflicts swap.** One input does one thing, and an action is never left without a binding.
- **Migrations** keep every existing customisation when settings change between versions.

## Control style
- **Simple** (default): passes and shots fire on press, with assisted power.
- **Advanced:** hold to charge shots (and passes, if *Passing* is set to *Charged*).

## Implementation notes
- `src/input/input.ts` merges devices into one `InputFrame`. Press and release edges accumulate until a simulation step consumes them, so short taps are never lost.
- `src/game/settings.ts` holds the defaults, `activeBindings()` and migrations. `src/ui/ui.ts` holds the Settings → Controls UI and `applyBinding` / `applyPadBinding`.
- Tests: `tests/control-schemes.test.ts`, `tests/settings-migration.test.ts` and `scripts/controls-check.mjs` (real mouse input, emulated controller).
