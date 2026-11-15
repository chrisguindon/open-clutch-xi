# Releasing Open Clutch XI

**Audience:** the maintainer.

There are two parts to how Open Clutch XI ships:
- **Deploys** happen continuously. Netlify builds `main` and publishes https://fc.chrisguindon.com (see [deployment](deployment.md)).
- **Releases** are occasional, named snapshots: a version, an annotated tag, release notes and a changelog entry. **Nothing is committed, tagged, pushed or published automatically.** Every step below is run by the maintainer, when they decide.

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

## Release checklist (example: v0.1.0)

The commands are given for reference. Run them yourself, in order, only when you're ready.

**1. Validate the release** (clean copy, fresh install, every check, browser flows, SBOM):

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
- The publication checklist in [github-setup.md](../governance/github-setup.md#11-publication-checklist): code of conduct contact set, repository URL set.

**3. Create the release commit** (Conventional Commit; only when authorised, with no AI co-author trailers):

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

**8. Prepare the GitHub release as a draft:**

```bash
gh release create v0.1.0 --draft --verify-tag \
  --title "Open Clutch XI 0.1.0 (public beta)" \
  --notes-file docs/releases/v0.1.0.md \
  release/open-clutch-xi-0.1.0.cdx.json
```

Review the draft on GitHub. "Generate release notes" there groups merged pull requests by label (`.github/release.yml`). Publish it by hand when ready.

## Reproducible builds

- `package-lock.json` pins every dependency, and `npm ci` installs exactly those versions. Node 24 is pinned in `mise.toml`, CI and `netlify.toml`.
- The SBOM (`npm run sbom`) uses the commit time (or `SOURCE_DATE_EPOCH`), so the same commit gives the same file.

## After a release

- Netlify deploys `main`. Check the live site: start a match, open About, and check the version and links.
- **If a deploy goes wrong:** Netlify → *Deploys* → publish the previous good deploy. Then fix forward with a pull request. Never force-push `main`.
- Open the next milestone.

## What needs GitHub or Netlify

These can't be done from repository files:
- milestones
- drafting and publishing releases
- Netlify rollbacks
- confirming the custom domain
