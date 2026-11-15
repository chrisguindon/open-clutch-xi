# GitHub repository setup (maintainer guide)

This guide covers setting up the Open Clutch XI repository on GitHub so the community files in this repository work as intended. Most of it is a **one-time** job after creating the repository.

Some things live in tracked files; others only exist as GitHub settings and have to be set up by hand or with the GitHub CLI (`gh`):

| In repository files (already done) | GitHub settings (do once) |
|---|---|
| Issue forms, issue chooser and PR template (`.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`) | Enable Discussions and create its categories |
| Discussion forms (`.github/DISCUSSION_TEMPLATE/`) | Repository description, website and topics |
| Workflows: CI, PR title, security, welcome (`.github/workflows/`) | Merge settings (squash only) |
| Dependabot (`.github/dependabot.yml`) | Branch ruleset (importable from `.github/rulesets/default-branch.json`) |
| Label definitions (`.github/labels.yml`) and release-note categories (`.github/release.yml`) | Creating the labels (`node scripts/sync-labels.mjs --apply`) |
| Community health files (README, CONTRIBUTING, …) | Private vulnerability reporting, secret scanning, Dependabot alerts |
| | Projects board and milestones |

## 0. The two repositories, locally

| | Public game | Private deployment |
|---|---|---|
| GitHub repository | `chrisguindon/open-clutch-xi` | `chrisguindon/fc.chrisguindon.com` |
| SSH remote | `git@github.com:chrisguindon/open-clutch-xi.git` | `git@github.com:chrisguindon/fc.chrisguindon.com.git` |
| Web URL | https://github.com/chrisguindon/open-clutch-xi | https://github.com/chrisguindon/fc.chrisguindon.com |
| Local folder | the checkout itself (`open-clutch-xi/`) | `open-clutch-xi/.local/deployments/fc.chrisguindon.com/` (ignored by the public repository; can be moved to a sibling folder) |
| Branch to push | `main` (the only branch) | `main` (the only branch) |
| First commit (to check you have the right history) | `ee9c18b` "chore: establish initial Open Clutch XI project baseline" | `f0c0162` "chore(deployment): initialise Open Clutch XI deployment project" |
| Visibility | **private** at first, public when you decide | private |

The public history was cleaned once before the first push (personal assets and deployment configuration removed from every commit). Push **only `main`**: no tags exist, and old pre-cleanup objects must never be pushed (backups live only in the ignored `.local/backups/`).

Before pushing, confirm each repository's state:

```bash
git status --short          # empty
git branch -a               # only main
git tag                     # empty
git remote -v               # empty until you add origin
git log --oneline | tail -1 # the first commit above
git log -1 --format=fuller  # your name as author and committer
```

## 1. Create the repositories and push

Create both on GitHub **without** a README, licence or .gitignore (the repositories already have them).

**Public game** (create it as *private* first):

```bash
cd open-clutch-xi
git remote add origin git@github.com:chrisguindon/open-clutch-xi.git
git push -u origin main
```

**Private deployment:**

```bash
cd open-clutch-xi/.local/deployments/fc.chrisguindon.com
git remote add origin git@github.com:chrisguindon/fc.chrisguindon.com.git
git push -u origin main
```

Don't use `git push --all` or `--mirror`, and don't push tags. The repository URL is already set in `package.json`, the README, NOTICE and the issue-chooser links, so the game's About screen links to the source. (If it ever changes: `node scripts/set-repo-url.mjs <new URL>`.)

Don't connect the public repository to Netlify or any hosting service. Only the private deployment repository may be linked to the Netlify site, as its `docs/OPERATIONS.md` describes, and deploys happen only when you approve them.

## 2. Repository metadata (About)

**Public game.** Set these in the **About** panel (gear icon), or run `gh repo edit` inside the repository:

- **Description** (GitHub allows up to 350 characters):
  > An open-source 3D football game for the browser, built with TypeScript, Three.js and AI assistance. Play it, learn from it, spot bugs and contribute.
- **Website:** leave it empty until the maintainer's site serves a release, then `https://fc.chrisguindon.com`. (Alternative: the repository's README.)
- **Topics** (lowercase, letters, digits and hyphens; at most 20):
  `football` `soccer` `browser-game` `threejs` `typescript` `webgl` `game-development` `open-source` `ai-assisted-development` `learning` `beginner-friendly`

  `game` is omitted: `browser-game` and `game-development` are more specific. `beginner-friendly` is used instead of `beginners`, because it's the established topic name.

```bash
gh repo edit chrisguindon/open-clutch-xi \
  --description "An open-source 3D football game for the browser, built with TypeScript, Three.js and AI assistance. Play it, learn from it, spot bugs and contribute." \
  --add-topic football,soccer,browser-game,threejs,typescript,webgl,game-development,open-source,ai-assisted-development,learning,beginner-friendly
```

GitHub detects the licence (EPL-2.0) from `LICENSE`. GitHub Pages isn't used. Releases attach the static web archive and checksums (see [releasing](releasing.md)).

**Private deployment.** Description: "Deployment of approved Open Clutch XI releases at fc.chrisguindon.com." No topics, website or Discussions needed. Keep Actions off unless you add a workflow.

## 3. General settings

**Settings → General → Features:**
- Turn on Issues, Discussions and Projects.
- Turn off the Wiki: docs live in the repository, where they're reviewed like code.

**Pull requests:**
- Allow **squash merging only**. Turn off merge commits and rebase merging.
- Set the default squash commit message to **"Pull request title"** (or "title and description"). The PR title is checked for Conventional Commits, so the history on `main` stays consistent.
- Turn on **Always suggest updating pull request branches** and **Automatically delete head branches**.

**Settings → Actions → General:**
- Workflow permissions: **Read repository contents** (the default token is read-only; workflows ask for more per job).
- Leave "Allow GitHub Actions to create and approve pull requests" **off**.
- Fork pull request workflows: **Require approval for first-time contributors**. CI uses no secrets, but this avoids wasted runs from spam pull requests.

## 4. Security settings

**Settings → Code security:**
- **Private vulnerability reporting:** on. `SECURITY.md` points reporters to it, with info@chrisguindon.com as the alternative.
- **Dependabot alerts** and **Dependabot security updates:** on. Version updates come from `.github/dependabot.yml`.
- **Secret scanning** and **Push protection:** on. They're free for public repositories, and complement `npm run check:repo`.
- **Code scanning:** handled by the CodeQL job in `.github/workflows/security.yml`. Don't also turn on "default setup", because the two conflict.
- **Dependency graph:** on. Dependency review on pull requests needs it.

## 5. Protect `main` (ruleset)

The recommended rules suit a one-maintainer project: they protect against accidents without blocking routine work.

| Rule | Why |
|---|---|
| Require a pull request before merging, with 0 approvals | Every change goes through CI and leaves a reviewable record. Zero approvals, because a single maintainer can't approve their own pull request. Raise it when more maintainers join. |
| Require conversation resolution | Review comments aren't lost. |
| Require status checks: `Lint, test, build and repository checks` and `conventional-title` | Nothing reaches `main` without passing CI. |
| Allowed merge method: squash | One Conventional Commit per pull request. |
| Block force pushes, and block deletion | No rewritten or lost history. |
| Bypass: repository admins, "always" | The maintainer can make exceptions when needed, for example an urgent fix, or recovering if CI itself is broken. |

To import it after the first CI run (status checks can only be required once GitHub has seen them):

```bash
gh api -X POST repos/chrisguindon/open-clutch-xi/rulesets --input .github/rulesets/default-branch.json
```

Or create it by hand under **Settings → Rules → Rulesets**. Rulesets (and secret scanning push protection) need a public repository or a paid plan, so while the repository is private on a free plan, do this when you make it public.

## 6. Labels

Create them once: `node scripts/sync-labels.mjs --apply`. This creates or updates the labels and deletes nothing. Run it without `--apply` to preview. Contributors never need to run it.

| Group | Labels | Meaning and use |
|---|---|---|
| **Type** | `bug`, `enhancement`, `documentation`, `question` | What kind of work. Issue forms add the type automatically. |
| **Area** | `area:gameplay`, `area:ai`, `area:physics`, `area:graphics`, `area:controls`, `area:accessibility`, `area:performance`, `area:testing`, `area:documentation`, `area:infrastructure` | Which part of the game. Add one, rarely two, during triage. |
| **Contribution** | `good first issue` | Small and well described, with files, acceptance criteria and test steps. Use it only when it's genuinely suitable for a newcomer. |
| | `help wanted` | You'd welcome a contribution. |
| | `mentorship available` | Someone has offered to guide a contributor. |
| **Priority** | `priority:critical`, `priority:high`, `priority:medium`, `priority:low` | Set during triage. |
| **Planning** | `plan:requested`, `plan:approved` | Opt-in AI-assisted or human planning before coding. See [AI-assisted workflow](ai-assisted-workflow.md). Maintainers only. |
| **Status** | `status:needs-triage` | Added automatically by issue forms. Remove it once the issue has been triaged. |
| | `status:needs-info` | Waiting for the reporter. |
| | `status:ready` | Agreed, and described well enough to start. |

Triage in a minute:
1. Read the issue.
2. Add an area and a priority.
3. Swap `status:needs-triage` for `status:ready` or `status:needs-info`.
4. Optionally add a contribution label.

Don't label things you haven't read.

## 7. Discussions

**Issues** track actionable work: a bug to fix, an agreed feature, a doc to write. **Discussions** are for conversations: questions, early ideas, sharing forks and experiments, and learning. If a discussion produces concrete work, open an issue and link it.

Enable it under **Settings → General → Features → Discussions**, then edit the categories under **Discussions → Categories** (the pencil icon):

| Category | Format | Purpose | Slug, to match the files |
|---|---|---|---|
| **Announcements** (keep the default) | Announcement | Releases and news; only maintainers can post | `announcements` |
| **General** | Open-ended | Project conversations | `general` |
| **Ideas** | Open-ended | Suggestions and future improvements, before they become issues | `ideas` |
| **Q&A** | Question / Answer | Development and gameplay questions; answers can be marked accepted | `q-a` |
| **Show and Tell** | Open-ended | Forks, experiments and improvements, for example "I added a rabona skill move, here's a video" | `show-and-tell` (form: `.github/DISCUSSION_TEMPLATE/show-and-tell.yml`) |
| **Learning** (create it) | Question / Answer | Programming questions and exercises from `docs/learning/README.md`. No question is too basic. | `learning` (form: `.github/DISCUSSION_TEMPLATE/learning.yml`) |

Delete "Polls" if you won't use it. A form only applies when its file name matches the category slug. To get started, pin a welcome post in General that says hello and links CONTRIBUTING.md and docs/learning/README.md.

## 8. Planning: Projects and milestones

Keep it light:
- **Board.** One GitHub Project ("Open Clutch XI"), board view, with columns **Backlog → Ready → In progress → In review → Done**. Use the built-in workflows only ("item closed → Done", "pull request merged → Done"), no custom automation.
- **Milestones** are for meaningful releases, for example `0.2 — Controls & accessibility polish`. They carry no dates unless a real one exists. See [releasing](releasing.md).
- **Priorities, in order:**
  1. bugs that stop people playing;
  2. accessibility barriers;
  3. gameplay feel and AI quality;
  4. performance on modest devices;
  5. learning materials;
  6. new features.

## 9. Starter issues

[`docs/learning/starter-issues/`](../learning/starter-issues/README.md) holds a small set of reviewed beginner tasks. Create them once the labels exist:

```bash
for f in docs/learning/starter-issues/[0-9]*.md; do
  title=$(head -1 "$f" | sed 's/^# //')
  labels=$(sed -n 's/^Labels: //p' "$f")
  gh issue create --title "$title" --label "$labels" --body-file "$f"
done
```

Check them on GitHub afterwards, and keep the list small: a few good first issues beat dozens of vague ones.

## 10. Copilot (optional)

The repository is prepared for the GitHub Copilot coding agent: `AGENTS.md`, `.github/copilot-instructions.md`, three custom agents in `.github/agents/`, and `copilot-setup-steps.yml`. Enabling it, and the approval and firewall settings, are manual. See [AI-assisted workflow](ai-assisted-workflow.md#manual-configuration-github-settings).

## 10b. What can only be verified on GitHub

These were validated locally, but can only be confirmed once the repository exists:
- **Workflows.** actionlint, the structure checks and every command they run were checked locally. **They have not run on GitHub yet.** Watch the first runs of CI, PR title, Security (CodeQL and dependency review) and Welcome.
- **Issue and discussion forms.** They were validated against GitHub's documented schema. Open the issue chooser and check each form renders.
- **Dependabot.** Check **Insights → Dependency graph → Dependabot** for errors after the first scheduled run.
- **Required status checks.** The names in the ruleset must match the checks GitHub reports.

## 11. Publication checklist

Before making `open-clutch-xi` public. Items marked **open** were not resolved when this guide was written.

**Legal**
- [ ] Third-party assets reviewed against [third-party assets](../governance/third-party-assets.md) (automated checks confirm the inventory, not legal clearance).

**History and content**
- [x] Public history cleaned of personal assets and deployment configuration; gitleaks and content scans clean (see the cleanup notes kept privately).
- [ ] Your own final look through the history and files: `git log --stat`, the README, docs and screenshots.
- [ ] No personal assets in `public/` (the creator portrait and website panel live in the private deployment).

**Community**
- [ ] README, CONTRIBUTING, issue forms and starter issues read through by a person.
- [ ] Code of Conduct contact set (info@chrisguindon.com).

**GitHub**
- [ ] Both repositories created and `main` pushed (section 1); About, website and topics set (section 2).
- [ ] Squash-only merging and read-only Actions permissions (section 3).
- [ ] Private vulnerability reporting, secret scanning with push protection, Dependabot alerts (section 4).
- [ ] First CI run green on GitHub, then the ruleset imported (section 5).
- [ ] Labels created (section 6), Discussions enabled (section 7), board and first milestone (section 8), starter issues created (section 9).

**Releases and hosting**
- [ ] No hosting integration (deploy app, webhook) installed on the public repository.
- [ ] v0.1.0 release candidate reviewed; tag and GitHub Release created only when you decide ([releasing](releasing.md)).
- [ ] The private deployment pins the published release's URL and SHA-256, and passes `npm run verify`.
