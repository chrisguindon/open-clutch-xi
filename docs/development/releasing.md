# Releasing Open Clutch XI

**Audience:** the maintainer.

Open Clutch XI ships as **releases**: occasional, named snapshots with a version, an annotated tag, release notes, a changelog entry and downloadable artefacts. **Nothing is committed, tagged, pushed or published automatically**, and a successful build never publishes anything. Every step below is run by the maintainer, when they decide.

The project deploys nothing. A merge to `main` changes no website. Sites that host the game, including the maintainer's own at https://fc.chrisguindon.com, pick a release and move to a newer one when *they* decide (see [hosting](hosting.md)).

## Release artefacts

`npm run release:package` builds and packages, into `release/`:

| File | What it is |
|---|---|
| `open-clutch-xi-v<version>-web.tar.gz` | The playable static site (`site/`), with `LICENSE`, `NOTICE.md`, the recommended headers (`hosting/headers.json`), `HOSTING.md` and `release-manifest.json` (version, source commit, SHA-256 of every file) |
| `open-clutch-xi-v<version>-source.tar.gz` | The committed source at `HEAD` (`git archive`) |
| `SHA256SUMS` | Checksums of both archives, for `sha256sum -c` |
| `open-clutch-xi-<version>.cdx.json` | The SBOM (from `npm run release:check`) |

The web archive is **reproducible**: it's built without a site URL, its entries are sorted, and every file has the same owner, permissions and timestamp (the last commit's time, or `SOURCE_DATE_EPOCH`). Packaging the same commit twice gives identical bytes, and `release:check` verifies that. It's written by `scripts/lib/tar.mjs`, so it needs no system tools. The packager refuses to include source maps or files containing local paths. A manifest whose `sourceDirty` is `true` was built from uncommitted changes: never publish it.

## Versioning

- [Semantic Versioning](https://semver.org/), read for a game (see the table at the top of [CHANGELOG.md](../../CHANGELOG.md)):
  - `0.x` during the public beta;
  - MINOR for features, PATCH for fixes;
  - a MINOR (or MAJOR after 1.0) when saved settings or controls change incompatibly without a migration.
- **One authoritative version:** `version` in `package.json`.
  - `package-lock.json` follows it through `npm version`;
  - the About screen gets it at build time (`__APP_VERSION__` in `vite.config.ts`);
  - `npm run release:check` verifies they agree, and that `docs/releases/v<version>.md` exists.
- [Conventional Commits](https://www.conventionalcommits.org/) titles on squash-merged pull requests keep the history readable.

## Releasing with one command per step

The release tool (`scripts/release.mjs`) automates the checklist below. It fits squash-merged pull requests and asks before anything permanent.

**Before you start:**
- `gh auth login` once (the [GitHub CLI](https://cli.github.com/));
- a browser for the browser checks: `npm run browsers:install` once (see [testing](testing.md));
- on an up-to-date, clean `main`;
- with the release notes written in `docs/releases/v<version>.md` (copy the previous ones; a "Draft" notice at the top is removed for you);
- with the changes listed under *Unreleased* in `CHANGELOG.md`.

```bash
make release-status                    # current version, latest tag, unreleased changes
make release-prepare VERSION=0.2.0     # step 1
#   → review and squash-merge the "chore(release): 0.2.0" pull request on GitHub, then:
git switch main && git pull
make release-publish VERSION=0.2.0     # step 2
```

| Step | What it does |
|---|---|
| `release-prepare` | Checks the repository (on `main`, clean, in sync with GitHub, tag free, notes exist, a browser available). Prepares the release files **in a temporary copy**: the version in `package.json` and `package-lock.json`, *Unreleased* moved under `[0.2.0] - <today>` with compare links, and the final release notes. Runs the full release check on that copy. Only if it passes does it write those exact files into your working tree and commit `chore(release): 0.2.0` on `release/v0.2.0`. Then it **asks**, pushes and opens a pull request. If anything fails, your working tree is unchanged and no branch is created. |
| `release-publish` | Checks `main` is the merged release (version, dated changelog section, final notes). **Asks**, then creates and pushes the annotated tag `v0.2.0`. Builds the artefacts from the tag and verifies them (checksums, and a manifest naming the tagged, clean commit). Creates a **draft** GitHub release with the web archive, source archive, `SHA256SUMS` and SBOM. **Asks** whether to publish it now. Prints the `release.json` lines for sites that host the game. |

**Options:**
- `DRY_RUN=1` runs everything a real `release-prepare` runs, including the full release check on the prepared files, then stops before writing, committing, pushing or opening the pull request. A passing dry run means the real run will pass validation. What it can't prove: that GitHub accepts the push and the pull request (it checks that you're logged in, and warns if not), and that nothing changes on `main` or in your environment between the two runs. For `release-publish`, a dry run checks the preconditions and lists the steps; the build and upload only happen for real.
- `YES=1` answers the questions before pushing and tagging, but never publishes the release: publishing always needs a human, on GitHub or at the prompt.
- Without `make`: `npm run release -- prepare 0.2.0` and `npm run release -- publish 0.2.0`.

**Safety:**
- A question needs you to type the version, so a stray Enter can't push or tag.
- The tool never force-pushes, and never moves or reuses a tag.
- If `publish` stops after the tag was pushed (a network error, say), run it again: it carries on from that tag, as long as `main` is still exactly the tagged commit.

**The first release (0.1.0):** `package.json` already says 0.1.0, so `make release-prepare VERSION=0.1.0` just rolls the changelog and finalises the notes. Edit the intro under *Unreleased* first if you like ("The first public release is planned as…"): it moves into the 0.1.0 section as written.

Sites download release files only while the repository is **public**: publish the release once `open-clutch-xi` is public (or before, as a preview only).

## Release checklist by hand (example: v0.1.0)

What the tool does, step by step, if you'd rather run it yourself. Run them in order, only when you're ready.

**1. Validate the release** (clean copy, fresh install, every check, browser flows, artefacts and their reproducibility, SBOM):

```bash
npm run release:check
# faster, in place:            npm run release:check -- --here
# without headless browsers:   npm run release:check -- --no-browser
```

**2. Review the changes:**

```bash
git status
git diff --stat
git log --oneline -20
```

Also check:
- `CHANGELOG.md`: move the *Unreleased* items under `## [0.1.0] - YYYY-MM-DD` and add the compare links.
- `docs/releases/v0.1.0.md`: update the notes, testing status and known limitations.
- The publication checklist in [github-setup.md](github-setup.md#11-publication-checklist): code of conduct contact set, repository URL set.

**3. Create the release commit** (Conventional Commit; only when authorised):

```bash
# Only if the version changes (0.1.0 is already set):
npm version 0.1.0 --no-git-tag-version
git add -A
git commit -m "chore(release): 0.1.0"
```

**4. Create the annotated tag:**

```bash
git tag -a v0.1.0 -m "Open Clutch XI 0.1.0 (public beta)"
```

**5. Verify the tag:**

```bash
git show v0.1.0 --stat
git describe --tags --exact-match   # prints v0.1.0 on the tagged commit
```

**6. Push the repository** (when you decide to publish):

```bash
git push origin main
```

**7. Push the tag:**

```bash
git push origin v0.1.0
```

**8. Build the artefacts from the tagged commit** (clean tree, so the manifest names the tag's commit):

```bash
npm run release:package
sha256sum -c release/SHA256SUMS
```

**9. Prepare the GitHub release as a draft, with the artefacts:**

```bash
gh release create v0.1.0 --draft --verify-tag \
  --title "Open Clutch XI 0.1.0 (public beta)" \
  --notes-file docs/releases/v0.1.0.md \
  release/open-clutch-xi-v0.1.0-web.tar.gz \
  release/open-clutch-xi-v0.1.0-source.tar.gz \
  release/SHA256SUMS \
  release/open-clutch-xi-0.1.0.cdx.json
```

Review the draft on GitHub. "Generate release notes" there groups merged pull requests by label (`.github/release.yml`). Publish it by hand when ready. Once published, never replace an artefact under the same version: anyone pinning its checksum would (rightly) refuse it. Fix forward with a new version.

## Reproducible builds

- `package-lock.json` pins every dependency, and `npm ci` installs exactly those versions. Node 24 is pinned in `mise.toml` and CI.
- The web archive is byte-reproducible (see *Release artefacts*).
- The SBOM (`npm run sbom`) uses the commit time (or `SOURCE_DATE_EPOCH`), so the same commit gives the same file.

## After a release

- Open the next milestone. Development continues towards the next version; sites already hosting a release are unaffected.
- **If a release turns out to be broken:** don't delete or replace it. Publish a fixed PATCH version. Hosts go back to the previous good release by pinning it again.
- **Saved data across versions.** A new release must read data written by older ones: settings and progress are versioned and migrated (see [persistence](../architecture/persistence.md)). Going *back* is safe while the data formats are unchanged. Release notes must say when a format version changes. Rolling back past such a change, the older game can't read the newer record. It never deletes it: it keeps the stored text as a recovery copy (`<key>:corrupt`) and starts afresh, so players would see empty records until the newer release returns. Unknown settings fields fall back to their defaults.

## What needs GitHub

These can't be done from repository files:
- milestones
- drafting and publishing releases and uploading their artefacts
