# Governance

Open Clutch XI is a personal open-source project that welcomes a community of players, learners and contributors. This document describes how it is run today. It is intentionally lightweight, and it will change as the community grows.

## Roles

- **Maintainer:** Christopher Guindon ([chrisguindon.com](https://www.chrisguindon.com/about/)) owns the repository, reviews and merges pull requests, manages releases (and, separately, their own site's deployment), and has the final say on direction.
- **Contributors:** anyone who opens an issue, answers a question, reviews a change, playtests, improves the docs or submits a pull request.
- **Mentors:** experienced contributors who offer to guide a newcomer through an issue. Mark the issue `mentorship available`.

Regular contributors may be invited to become maintainers, with merge rights for specific areas such as the AI, rendering or accessibility. Any such changes are recorded in this file.

## How decisions are made

- **Every change goes through a pull request** from a feature branch: nobody commits directly to `main`, the maintainer included. A change merges after CI passes and the maintainer approves it (see [CONTRIBUTING.md](CONTRIBUTING.md#branches-pull-requests-and-approval)).
- **Small changes** (fixes, polish, tests, docs) are decided in the pull request.
- **Larger changes** (new modes, new dependencies, changes to controls or defaults, new third-party assets, anything affecting privacy or licensing) start as an issue. Discussion happens in the open, and the maintainer decides. The reasoning is recorded in the issue.
- **Disagreements** are resolved by the maintainer after hearing the arguments. The [Code of Conduct](CODE_OF_CONDUCT.md) applies to all project spaces.

## Principles the project holds to

These guide decisions and reviews:
1. **Free to play and private.** No accounts, analytics, tracking, ads, or runtime requests to third parties.
2. **Licensing hygiene.** Code is EPL-2.0. Assets must be redistributable and listed in `docs/governance/third-party-assets.md`. No real crests, official kits or likenesses.
3. **Accessible and smooth.** It should work on keyboard, mouse, controller and touch, with remappable controls. Adaptive quality is preferred over higher minimum requirements.
4. **Honest verification.** Changes say how they were tested. Emulated results are not presented as real-device results.

## Releases, hosting and planning

- **Hosting.** The project doesn't deploy anything. It produces versioned releases with a static web archive that anyone can host (see [docs/development/hosting.md](docs/development/hosting.md)). Changes to `main` and pull requests never update a live website: the maintainer's own site at https://fc.chrisguindon.com is managed separately and moves to a new release only when the maintainer decides.
- **Releases.** Occasional, versioned snapshots (Semantic Versioning, `vX.Y.Z` tags, [CHANGELOG.md](CHANGELOG.md)), created by hand by a maintainer. See [docs/development/releasing.md](docs/development/releasing.md).
- **Planning.** Work is tracked with labels, a simple project board and milestones for meaningful releases (see [docs/development/github-setup.md](docs/development/github-setup.md)).
- **Current priorities, in order:**
  1. bugs that stop people playing;
  2. accessibility;
  3. gameplay feel and AI;
  4. performance on modest devices;
  5. learning materials;
  6. new features.

## Affiliation

This is a personal project. It is not an Eclipse Foundation project, and it is not governed by the Eclipse Foundation Development Process. The Eclipse Public License 2.0 is used as its licence only.
