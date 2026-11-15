# AI-assisted development workflow

**Audience:** the maintainer, and contributors using coding assistants. Policy: [ADR 0008](../architecture/decisions/0008-ai-assisted-contributions.md) and [AGENTS.md](../../AGENTS.md).

Open Clutch XI welcomes AI-assisted work, but **people decide and people are responsible**. No step merges, deploys or publishes automatically.

## The pipeline

```
issue ──► triage (automatic, deterministic) ──► plan (opt-in) ──► maintainer approval ──► maintainer assigns Copilot (or a person)
      ──► pull request ──► CI ──► human review ──► human decides whether to merge
```

1. **Issue.** Created from an issue form.
2. **Triage** (`.github/workflows/triage.yml`, `scripts/triage/triage.mjs`). Adds an `area:` label from the form's answers, and `status:needs-info` if required answers are missing or too thin. It's deterministic code, not an AI service. It adds labels only, posts no comments, and treats issue text as untrusted (read only to pick from a fixed label list).
3. **Plan (opt-in).** A maintainer adds `plan:requested`. The workflow posts one plan skeleton with the relevant modules (built from labels only). It has sections for problem, solution, tests, security, performance, accessibility, licensing and open questions. A person fills it in, or the maintainer asks Copilot to propose one in a comment.
4. **Approval.** The maintainer adds `plan:approved`.
5. **Assignment.** The maintainer assigns the issue to Copilot (or a contributor picks it up). Copilot works in its GitHub Actions environment, prepared by `.github/workflows/copilot-setup-steps.yml`, and follows `AGENTS.md` and `.github/copilot-instructions.md`.
6. **Pull request.** CI validates it like any other: formatting, lint, types, tests, build, licences, repository hygiene, docs, SBOM, browser checks, CodeQL and dependency review.
7. **Human review.** It's reviewed like any contribution. The reviewer understands the change, checks the tests, and asks for changes.
8. **Merge** is a human decision. Squash-merge with a Conventional Commit title. Merging deploys nothing; releases are manual, and the maintainer's own site moves to a release only when they choose.

## Repository files (already in place)

| File | Purpose |
|---|---|
| `AGENTS.md` | The single source of engineering instructions for all agents |
| `.github/copilot-instructions.md` | A short pointer to AGENTS.md, plus the essentials (GitHub Copilot reads both) |
| `.github/agents/*.agent.md` | Three focused custom agents: `football-rules`, `rendering-performance`, `docs-and-licensing` |
| `.github/workflows/copilot-setup-steps.yml` | Copilot's environment (install only; read-only permissions; 20-minute limit) |
| `.github/workflows/triage.yml`, `scripts/triage/` | Deterministic triage and the plan skeleton (tested in `tests/triage.test.ts`) |
| `.github/labels.yml` | Includes `plan:requested` and `plan:approved` |

**Why only three custom agents.** Rules, rendering and performance, and documentation and licensing need specialised context. Testing, security and accessibility apply to *every* change and are already enforced by AGENTS.md and CI, so separate agents would only duplicate rules.

## Manual configuration (GitHub settings)

These can't be set from repository files:
- **Copilot coding agent.** Requires a Copilot plan that includes it. Enable it for the repository in the account or repository settings. Availability and pricing are set by GitHub: check the current GitHub documentation.
- **Workflow approval for agent pull requests.** Keep GitHub's default, where a maintainer approves before workflows run on pull requests opened by Copilot.
- **Copilot firewall.** Keep the default (restricted internet access). The setup steps only need npm.
- **Branch ruleset.** Pull requests are required, CI must pass, and nothing merges automatically (see [github-setup.md](../governance/github-setup.md)).

## Security and cost controls

- **Least privilege.** Every workflow declares minimal permissions. Triage and plan jobs have `issues: write` only. No secrets are used anywhere, so nothing can leak to untrusted code.
- **Untrusted input.** Issue text is never interpolated into shell commands or echoed into comments.
- **Limits.** Concurrency groups per issue and per branch, timeouts on every job, and agent work only on an explicit maintainer assignment (no automatic triggers).
- **No automatic merging, deployment or release.**

## What contributors using assistants must do

- Review and understand every line. Run `npm run ci`. Explain non-obvious decisions in the pull request.
- **Don't add AI co-author trailers or vendor signatures.** The commit-message and hygiene checks reject them.
- **Don't paste private data** (profiling exports, tokens, personal files) into prompts or pull requests.
- Prompts don't need to be shared.
