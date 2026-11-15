# Contributing to Open Clutch XI

Thanks for your interest! Open Clutch XI is a free 3D football game for the browser and a community learning project. Everyone is welcome:
- first-time open-source contributors
- students
- TypeScript and Three.js developers
- people experimenting with AI-assisted development
- experienced engineers who care about gameplay, accessibility or performance

Please read the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md).

**Most of this codebase was written with AI assistance** (see the [README](README.md#built-with-ai-assistance-what-that-means-here)). If something looks wrong or odd, it may well be. Questioning it is welcome, and so is a careful fix. You don't need to understand the whole project to contribute: one file, one bug or one paragraph of docs is enough. New to open source? [Learning open source with Open Clutch XI](docs/learning/open-source.md) walks through a first contribution.

## Ways to help (no code needed for many of them)

- **Play and give feedback.** Use the *Gameplay feedback* issue form for AI opponents, passing, shooting, penalties and balance.
- **Report bugs** and **accessibility barriers**. Each has its own issue form.
- **Improve docs and learning material.** If something confused you, it will confuse others too. Use the *Documentation or learning* form.
- **Answer questions** in Discussions, or **share what you built** in *Show and Tell*: a fork, a new skill move, an experiment.
- **Write code:** start with an issue labelled [`good first issue`](https://github.com/chrisguindon/open-clutch-xi/labels/good%20first%20issue).

**Issues vs Discussions.**
- *Issues* track actionable work: a bug to fix, an agreed improvement, a doc to write.
- *Discussions* are for questions, early ideas, learning and showing off.
- Not sure which? Start a discussion. It can become an issue later.

## Getting set up

You need [Node.js](https://nodejs.org/) 22 or newer (24 recommended; `mise.toml` pins it) and Git. The project works on Linux, macOS and Windows.

```bash
git clone https://github.com/<you>/open-clutch-xi.git && cd open-clutch-xi
npm ci                 # exact dependency versions from package-lock.json
npm run lint:setup     # once: installs the ESLint toolchain in tools/lint
npm run dev            # http://localhost:5173
```

New to the codebase? [docs/learning/README.md](docs/learning/README.md) has a guided tour and exercises.

Useful in-game tools:
- **F3** or `?diag`: diagnostics, including the AI's latest decision and its reasons
- `?lab`: movement lab
- `?bench`: benchmark

Benchmark and diagnostics exports describe your computer. Keep them local, and don't attach them to public issues unless a maintainer asks.

## Finding something to work on

- Issues labelled **`good first issue`** are small, well understood and have a clear way to test them. The [starter issues](docs/learning/starter-issues/README.md) are where they come from.
- **`help wanted`** marks bigger tasks where help is welcome.
- Found a bug yourself? Check the existing issues first, then report it (below) before fixing it, so others know.
- Comment on the issue to say you're working on it. If you stop, say so: that's completely fine.

## Reporting a bug

Use the **Bug report** form. You don't need to know the cause. Tell us:
- what happened, and what you expected instead;
- the steps to make it happen again, and whether it happens every time;
- your browser, operating system and device (desktop, phone, controller…);
- the game mode (Quick Match, XI Nations Cup, tutorial…), format and difficulty;
- any error messages: press F12 and look in the *Console* tab, then copy the red lines;
- a screenshot or short recording, if it helps.

## Making a change

1. **Pick or open an issue.** For anything bigger than a small fix, comment first so we can agree on the approach and nobody duplicates work.
2. **Branch** from `main` in your fork.
3. **Keep it focused:** one topic per pull request, matching the surrounding style.
4. **Add or update tests.** Gameplay and AI changes need a scenario or simulation test (see `tests/ai-decisions.test.ts`, `tests/controls.test.ts`). Fixes need a regression test where practical.
5. **Run the checks.** `npm run ci` runs everything CI runs:
   - formatting (Prettier)
   - lint (ESLint)
   - type check
   - tests
   - production build
   - licence and asset checks
   - repository hygiene
   - documentation links
   - GitHub configuration

   `npm run format` fixes formatting. Browser checks (`npm run test:browser`, `check:controls` and others) need a browser: run `npm run browsers:install` once (a pinned Chrome for Testing in `.cache/browsers/`), or set `CHROME_PATH` to an installed Chrome or Chromium.
6. **Update docs.** Docs are organised by subject in [docs/](docs/README.md). Update the page that describes the behaviour you changed. For football rules that's [the rules matrix](docs/gameplay/FOOTBALL_RULES.md); significant architecture choices get a short [ADR](docs/architecture/decisions/README.md). Add a line under *Unreleased* in [CHANGELOG.md](CHANGELOG.md) for anything players would notice.
7. **Open a pull request.** The template guides you. Describe how you verified the change. If something could only be checked in emulation (touch, controllers, slow devices), say so.

### Your first pull request, step by step

```bash
# once: fork the repository on GitHub, then
git clone https://github.com/<your-name>/open-clutch-xi.git
cd open-clutch-xi
npm ci && npm run lint:setup

# for each change
git switch -c fix/keeper-dive-direction        # a branch named after the change
# … edit, then check …
npm run ci
git add -A
git commit -m "fix(ai): make the keeper dive towards the shot"
git push -u origin fix/keeper-dive-direction
```

GitHub then offers to **open a pull request**. Fill in the template: what you changed, why, and how you tested it. Review is a conversation. Reviewers may ask questions or suggest changes. Push more commits to the same branch to update the pull request.

### What reviewers look for

- The change does one thing, and the description says what and why.
- It works: tests cover it where practical, and `npm run ci` passes.
- You understand it and can explain it, whoever or whatever typed it.
- It fits the project: readable code with comments that explain *why*, deterministic simulation, no new tracking, dependencies or unlicensed assets.
- Player-visible changes have a line in the changelog, and behaviour changes update the docs.

Reviews are friendly and specific. If a review comment is unclear, ask.

### Commit messages and pull-request titles

We use [Conventional Commits](https://www.conventionalcommits.org/) and **squash-merge** pull requests, so your **PR title becomes the commit on `main`**. CI checks the title. Your individual commits can be informal.

```
<type>(<optional scope>): <summary in the imperative, no full stop>

feat(controls): add a left-handed touch layout
fix(ai): stop clearances towards our own goal
docs(learning): add a troubleshooting section
test(ai): cover restart long balls staying in play
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes** are optional, for example `ai`, `physics`, `controls`, `graphics`, `ui`, `a11y`, `perf`, `docs`, `ci`, `deps`.
- Breaking changes (for example to saved settings) get a `!`: `feat(settings)!: …`.

In short: a **type** (what kind of change), an optional **scope** (which part of the game), then a short summary of what the change does.

To check your own commit messages locally (optional): `git config core.hooksPath .githooks`. Commit under your own name, as the person responsible for the change. If your AI tool adds a `Co-authored-by` trailer or a "generated with …" line, that's fine: the checks only print a warning. Using AI tools is fine (see below), and human co-authors are welcome.

### Code style

- TypeScript strict mode, formatted by Prettier, checked by ESLint. Follow the existing patterns: small pure functions where possible. The [coding standards](docs/development/CODING_STANDARDS.md) explain naming, module headers, TSDoc and hot-path rules.
- **Comments explain *why*:** the football idea or the trade-off. People learn from this code.
- Keep the simulation (`src/sim/`) deterministic and free of DOM or rendering code. Avoid allocations in per-frame hot paths.
- Every source file starts with this header, in its format's comment syntax (`npm run check:licenses` enforces it; see the [coding standards](docs/development/CODING_STANDARDS.md#licence-headers) for shell, YAML and HTML):

  ```ts
  /*
   * Copyright (c) <year> <copyright holder>
   *
   * This program and the accompanying materials are made available
   * under the terms of the Eclipse Public License 2.0,
   * which is available at https://www.eclipse.org/legal/epl-2.0/.
   *
   * SPDX-License-Identifier: EPL-2.0
   */
  ```

## Contributing with AI tools

Contributions written by hand and with AI tools are equally welcome, and nobody has to use AI. If you do:
- **Understand it.** Read every line the tool proposes, and make sure you could explain it in review.
- **Review it critically.** AI tools are confident even when wrong: check the logic, the edge cases and that it fits the existing code.
- **Run it.** Play the change in the browser and run the tests (`npm run ci`). Add a test when the tool didn't.
- **Check licences.** Don't submit generated code or assets that copy other projects or copyrighted material.
- **Keep secrets out.** Never paste tokens, keys or private data into a tool or a pull request.
- **Take extra care with security-sensitive code**: anything that handles imported files, saved data, URLs or HTML.
- **Explain the change** in your pull request in your own words. You don't need to share your prompts.
- **You're responsible** for what you submit, as with any contribution.

Agents and coding assistants working in this repository should follow [AGENTS.md](AGENTS.md).

## Licensing of contributions

Open Clutch XI is licensed under the [Eclipse Public License 2.0](LICENSE). By submitting a contribution, you agree that it is licensed under the EPL-2.0 (inbound = outbound), and you confirm that you have the right to submit it. We recommend signing off your commits (`git commit -s`), following the [Developer Certificate of Origin](https://developercertificate.org/).

**Assets** (models, textures, sounds, fonts, images) must be your own work, or come under a licence that allows redistribution in an EPL-2.0 project. CC0 is preferred; MIT, OFL or CC-BY are fine with attribution. Add every new shipped file to [docs/governance/third-party-assets.md](docs/governance/third-party-assets.md) with its source, author and licence. `npm run check:licenses` fails on unlisted files in `public/`.

**Please don't contribute:**
- real club or federation crests, official kits, sponsor marks, real players' names or likenesses
- recordings of real chants
- anything you don't have the rights to

Personal branding belongs to the sites that host the game, not to this repository: there's no creator portrait or personal sponsor here (a site can add its own through `site-config.json`, see [hosting](docs/development/hosting.md)).

## Project principles

- **Free and private.** No accounts, tracking, analytics, ads or third-party requests at runtime.
- **Accessible.** Keyboard, mouse, controller and touch, with remappable controls and reduced motion.
- **Smooth on modest hardware.** Adaptive quality rather than higher minimum requirements.
- **Original and neutral.** Generated names, generic kits.
- **Welcoming and honest.** Patient reviews, and claims backed by tests.

See [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made and [docs/development/releasing.md](docs/development/releasing.md) for how releases work.
