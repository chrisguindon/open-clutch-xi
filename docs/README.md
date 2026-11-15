# Open Clutch XI documentation

Documentation is organised by subject. Each page says who it's for.

| Section | For | Pages |
|---|---|---|
| **[Architecture](architecture/README.md)** | Contributors | How the game fits together · [Persistence (saved data)](architecture/persistence.md) · [decision records](architecture/decisions/README.md) |
| **Gameplay** | Players and contributors | [Football rules (Laws of the Game matrix)](gameplay/FOOTBALL_RULES.md) · [Modes, tutorial and replays](gameplay/modes.md) · [AI and difficulty](gameplay/ai-and-difficulty.md) · [Controls](gameplay/controls.md) · [Animation](gameplay/animation.md) · [Player experience review](gameplay/EXPERIENCE_REVIEW.md) · Proposals: [tournament](gameplay/tournament-plan.md), [statistics and achievements](gameplay/progression.md) |
| **Development** | Contributors and the maintainer | [Coding standards](development/CODING_STANDARDS.md) · [Scripts](../scripts/README.md) · [Testing](development/testing.md) · [Performance](development/performance.md) · [Playtesting guide](development/playtesting.md) · [Known issues](development/known-issues.md) · [Roadmap](development/roadmap.md) · [AI-assisted workflow](development/ai-assisted-workflow.md) · [Hosting](development/hosting.md) · [Releasing](development/releasing.md) |
| **Governance** | The maintainer, and contributors interested in licensing | [Open-source practices](governance/OPEN_SOURCE_PRACTICES.md) · [Third-party assets](governance/third-party-assets.md) · [GitHub setup](governance/github-setup.md) |
| **[Learning](learning/README.md)** | Newcomers and students | [Code tour](learning/code-tour.md) · guides: [game loop](learning/game-loop.md), [physics](learning/physics.md), [Three.js](learning/threejs.md), [AI](learning/football-ai.md), [rules](learning/football-rules.md), [saved data](learning/persistence.md), [tutorial and camera](learning/tutorial-and-camera.md) · [exercises](learning/exercises.md) · [starter issues](learning/starter-issues/README.md) |
| **Releases** | Everyone | [v0.1.0 (draft)](releases/v0.1.0.md) · [Changelog](../CHANGELOG.md) |

Repository-wide files live at the root:
- [README](../README.md)
- [CONTRIBUTING](../CONTRIBUTING.md)
- [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md)
- [SECURITY](../SECURITY.md)
- [GOVERNANCE](../GOVERNANCE.md)
- [NOTICE](../NOTICE.md)
- [LICENSE](../LICENSE)
- [AGENTS](../AGENTS.md)

**Documentation policy:** update the existing page when behaviour changes. Record significant architecture decisions as ADRs. Temporary working notes stay out of the repository (in the ignored `.local/` directory). See AGENTS.md.
