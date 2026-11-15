# Records: list past XI Nations Cups

Labels: good first issue,area:ui,enhancement

**Idea.** The Records screen shows matches and achievements, but not the XI Nations Cups you've finished. The cup record already keeps them (`history` in `src/game/tournament/record.ts`), and the cup setup screen shows the last five.

**What to do.** Add a short "XI Nations Cups" section to the Records screen: for each finished cup, your team, how far it got, and who won. Show a friendly line when there are none yet.

**Where to look.**
- `src/ui/ui.ts`: `showRecords()`.
- `src/ui/cupScreen.ts`: `cupSetupHtml` already renders the history (reuse or extract that part).
- The UI host exposes the record as `this.host.cup`.

**How to test.**
- Add a unit test for any HTML helper you extract (see `tests/cup-screen.test.ts`).
- In the browser: finish a cup (`npm run check:cup` shows how to steer one quickly), then open Records.
- Keep it accessible: a list or a table with a caption, and text rather than colour alone.

**Skills:** HTML templates in TypeScript, reusing existing code, a unit test.
