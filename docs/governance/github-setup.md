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

## 1. Create the repository and set the URL

1. Create a **public** repository, for example `open-clutch-xi`, **without** a generated README or licence; the repository already has them. Then push `main`.
2. Point every link at it:

   ```bash
   node scripts/set-repo-url.mjs https://github.com/<owner>/open-clutch-xi
   git commit -am "chore: set repository URL" && git push
   ```

   This updates `package.json` (so the game's About screen and menu link to the source), the README, the changelog and the issue-chooser links. CI fails while the placeholder is still there.

## 2. Repository metadata

Set these in the repository's **About** panel (the gear icon), or with the CLI:

```bash
gh repo edit \
  --description "A free, open-source 3D football game for the browser — TypeScript + Three.js. Play against the computer, learn, fork and contribute." \
  --homepage "https://fc.chrisguindon.com" \
  --add-topic football,soccer,browser-game,threejs,typescript,webgl,open-source,game-development,ai-assisted-development,learning
```

GitHub detects the licence (EPL-2.0) from `LICENSE`. GitHub Pages isn't used: the game is hosted on Netlify.

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
gh api -X POST repos/<owner>/open-clutch-xi/rulesets --input .github/rulesets/default-branch.json
```

Or create it by hand under **Settings → Rules → Rulesets**. Rulesets need a public repository, or a paid plan for private ones.

## 6. Labels

Create them once: `node scripts/sync-labels.mjs --apply`. This creates or updates the labels and deletes nothing. Run it without `--apply` to preview. Contributors never need to run it.

| Group | Labels | Meaning and use |
|---|---|---|
| **Type** | `bug`, `enhancement`, `documentation`, `question` | What kind of work. Issue forms add the type automatically. |
| **Area** | `area:gameplay`, `area:ai`, `area:physics`, `area:graphics`, `area:controls`, `area:accessibility`, `area:performance`, `area:testing`, `area:documentation`, `area:infrastructure` | Which part of the game. Add one, rarely two, during triage. |
| **Contribution** | `good first issue` | Small and well described, with files, acceptance criteria and test steps. Use it only when it's genuinely suitable for a newcomer. |
| | `help wanted` | You'd welcome a contribution. |
| | `mentorship available` | Someone has offered to guide a contributor. |
| **Priority** | `priority:critical`, `priority:high`, `priority:medium`, `priority:low` | Set during triage. The levels match the severity scale in `docs/ISSUES.md`. |
| **Planning** | `plan:requested`, `plan:approved` | Opt-in AI-assisted or human planning before coding. See [AI-assisted workflow](../development/ai-assisted-workflow.md). Maintainers only. |
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
- **Milestones** are for meaningful releases, for example `0.2 — Controls & accessibility polish`. They carry no dates unless a real one exists. See [RELEASING.md](../development/releasing.md).
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

The repository is prepared for the GitHub Copilot coding agent: `AGENTS.md`, `.github/copilot-instructions.md`, three custom agents in `.github/agents/`, and `copilot-setup-steps.yml`. Enabling it, and the approval and firewall settings, are manual. See [AI-assisted workflow](../development/ai-assisted-workflow.md#manual-configuration-github-settings).

## 10b. What can only be verified on GitHub

These were validated locally, but can only be confirmed once the repository exists:
- **Workflows.** actionlint, the structure checks and every command they run were checked locally. **They have not run on GitHub yet.** Watch the first runs of CI, PR title, Security (CodeQL and dependency review) and Welcome.
- **Issue and discussion forms.** They were validated against GitHub's documented schema. Open the issue chooser and check each form renders.
- **Dependabot.** Check **Insights → Dependency graph → Dependabot** for errors after the first scheduled run.
- **Required status checks.** The names in the ruleset must match the checks GitHub reports.

## 11. Publication checklist

- [ ] The Code of Conduct contact is set (info@chrisguindon.com).
- [ ] Repository created, `main` pushed, `node scripts/set-repo-url.mjs …` run and committed
- [ ] Description, website and topics set (section 2)
- [ ] Squash-only merging and Actions permissions (section 3)
- [ ] Private vulnerability reporting, secret scanning with push protection, and Dependabot alerts (section 4)
- [ ] First CI run is green on GitHub, then the ruleset is imported (section 5)
- [ ] Labels created (section 6), Discussions enabled with categories (section 7)
- [ ] Project board and first milestone (section 8), starter issues created (section 9)
- [ ] Netlify: the production deploy builds from `main` and the About screen shows the source link and version
