# Add a "Troubleshooting setup" section to the learning guide

Labels: good first issue,documentation,area:documentation

## Problem

[docs/learning/README.md](../README.md) explains how to set up the project, but not what to do when something goes wrong. Newcomers often get stuck on the same few problems and give up.

## What to add

A short **Troubleshooting** section in `docs/learning/README.md`, after *Setup*, covering:
- **Node too old:** errors during `npm ci` or `npm run dev`. How to check (`node --version`) and where to get Node 24. `mise.toml` pins it for people who use mise.
- **Port 5173 already in use:** Vite picks another port and prints it.
- **Browser checks can't find Chrome:** set `CHROME_PATH` (see `scripts/lib/chrome.mjs`).
- **`npm run lint` fails with "Cannot find module":** run `npm run lint:setup` once (ESLint lives in `tools/lint`).
- **A blank page:** the browser needs WebGL2. Check `chrome://gpu` or try another browser.

Keep each item to a sentence or two.

## Acceptance criteria

- The new section exists, is linked from the *Setup* section, and is written for beginners.
- `npm run check:docs` passes (internal links and anchors are checked).

## How to test

Read it as if it were your first day. Better still, ask a friend to follow it.
