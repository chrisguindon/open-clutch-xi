# XI Nations Cup: return to the cup after "Change team"

Labels: good first issue,area:ui,area:gameplay

**What happens now.** On the XI Nations Cup setup screen, **Change team** opens *Teams & options*. After choosing a team, **Back** goes to the main menu, so you have to open the cup again.

**What should happen.** Back should return to the cup setup screen, showing the newly chosen team.

**Where to look.**
- `src/ui/ui.ts`: the `cupTeam` action in `handleAction`, and `back()`, which decides where Back goes from each screen.
- `src/ui/cupScreen.ts`: `cupSetupHtml` (no change needed, probably).

**How to test.**
- In the browser: Menu → XI Nations Cup → Change team → pick a team → Back. You should see the cup setup with that team.
- `npm run check:cup` must still pass.
- Bonus: extend `scripts/cup-check.mjs` with this round trip.

**Skills:** reading a UI state machine, small TypeScript change, a browser check.
