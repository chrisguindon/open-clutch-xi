# Security policy

## Supported versions

Open Clutch XI is a static web game. Fixes are made on the `main` branch and shipped in the next release (a PATCH version for security fixes). Older releases aren't patched separately: sites hosting the game should move to the release that contains the fix. The maintainer's own site, https://fc.chrisguindon.com, runs a chosen release.

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests** when doing so would reveal how to exploit them.

Report them privately, in either of these ways:
1. **GitHub private vulnerability reporting.** Open the repository's **Security** tab and choose **Report a vulnerability**. This creates a private advisory that only the maintainers can see.
2. **Email:** Christopher Guindon, **info@chrisguindon.com**. Put "Open Clutch XI security" in the subject.

Please include:
- what the problem is and where it is (a file or URL)
- steps to reproduce, or a proof of concept
- the impact you expect

Leave out personal data you don't need to share.

## What to expect

This is a community project maintained in spare time, so there are no guaranteed response times. Reports are taken seriously and handled as soon as reasonably possible. You'll be told when the problem is confirmed and when it's fixed, and you'll be credited in the advisory unless you'd rather not be. Please give the project a reasonable chance to fix the problem before disclosing it publicly.

## Scope

The game runs entirely in the browser:
- There is no backend and there are no accounts.
- No personal data is collected or stored, apart from game settings kept in your own browser's `localStorage`.
- There are no third-party requests at runtime.

Relevant reports include, for example:
- cross-site scripting, or HTML injection through settings, URL parameters or game content
- weaknesses in the Content-Security-Policy or other recommended headers in `hosting/headers.json`
- a vulnerable dependency that actually ships in the game (three.js, or the Inter font files)
- supply-chain or permission problems in the build, the GitHub Actions workflows or dependency updates

Out of scope:
- vulnerabilities only in development tools that never ship to players, unless they affect the build output or CI
- denial of service through extreme settings on your own device
- reports from automated scanners without a demonstrated impact

## How the project protects itself

- **GitHub Actions:**
  - least-privilege permissions
  - actions pinned to commit SHAs
  - no secrets exposed to pull requests from forks
- **Analysis:**
  - CodeQL analysis and dependency review in `.github/workflows/security.yml`
  - Dependabot updates
  - `npm audit` in CI
- **Repository hygiene:** `npm run check:repo` checks for committed secrets, private paths and personal profiling data. Maintainers are asked to also enable GitHub secret scanning with push protection (see [docs/development/github-setup.md](docs/development/github-setup.md)).
