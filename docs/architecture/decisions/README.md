# Architecture decision records

Short records of significant, long-lived technical decisions: the context, what was decided, and why. They explain *why the code is the way it is*.

ADRs are for meaningful architecture choices, not for every change. To change a decision, add a new ADR that supersedes the old one, and mark the old one *Superseded*.

| # | Decision | Status |
|---|---|---|
| [0001](0001-deterministic-fixed-timestep-simulation.md) | Deterministic 120 Hz fixed-step simulation, separate from rendering | Accepted |
| [0002](0002-custom-physics-webgl2-plain-dom.md) | Custom physics, WebGL2 with Three.js, plain DOM UI | Accepted |
| [0003](0003-adaptive-rendering.md) | One adaptive controller for resolution, quality and frame rate | Accepted |
| [0004](0004-device-agnostic-input.md) | Device-agnostic input with per-scheme bindings | Accepted |
| [0005](0005-rules-engine-and-officials.md) | Rules profiles; officials display decisions, never make them | Accepted |
| [0006](0006-explainable-utility-ai.md) | Explainable utility AI; difficulty changes cognition, not physics | Accepted |
| [0007](0007-epl-2-0-licence.md) | Eclipse Public License 2.0 for code; redistributable assets only | Accepted |
| [0008](0008-ai-assisted-contributions.md) | AI-assisted contributions: human responsibility, no vendor attribution | Accepted |
| [0009](0009-local-first-persistence.md) | Local-first saved data behind one storage module; no backend | Accepted |

Template: copy [0000-template.md](0000-template.md).
