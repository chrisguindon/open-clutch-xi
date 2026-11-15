# 0008. Accept AI-assisted contributions with human responsibility and no vendor attribution

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

The project began as an AI-assisted development experiment, and many contributors will use coding assistants. Public history and documentation should explain the software, not record conversations with tools.

## Decision

- AI-assisted contributions are welcome. **The human submitter is responsible** for reviewing, testing and understanding the change, and for having the right to contribute it.
- **No AI vendors as Git authors or co-authors,** and no promotional signatures. `npm run check:repo` and the commit-message check enforce this.
- Agent instructions live in one file, [AGENTS.md](../../../AGENTS.md). Tool-specific files only point to it.
- Agents' temporary working notes stay in the ignored `.local/` directory. Lasting knowledge goes into subject-based docs and ADRs.

## Rationale

- Accountability stays with people.
- A single instruction source avoids rules drifting apart.
- Public docs stay readable and durable.

## Consequences

- Reviewers judge AI-assisted changes like any other: by tests, clarity and correctness.
- Prompts don't need to be disclosed.
