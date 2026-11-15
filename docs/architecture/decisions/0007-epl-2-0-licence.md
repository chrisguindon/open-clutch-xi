# 0007. License code under EPL-2.0 and ship only redistributable assets

- **Status:** Accepted
- **Date:** 2026-11-14

## Context

Open Clutch XI is a personal, educational open-source project. It isn't an Eclipse Foundation project, but it follows good open-source practice. See [OPEN_SOURCE_PRACTICES.md](../../governance/OPEN_SOURCE_PRACTICES.md).

## Decision

- Code is licensed under the **Eclipse Public License 2.0**. Every source file has an SPDX header. No Secondary Licenses are declared.
- `NOTICE.md` is the canonical legal notice, including third-party attributions.
- Shipped assets must be redistributable (CC0 preferred) and listed in the asset inventory.
- The creator portrait is excluded from the licence. (*Update, November 2026:* the portrait has since moved out of this repository into the maintainer's own deployment, and is supplied to that site through `site-config.json`.)

## Rationale

- EPL-2.0 is a weak-copyleft licence: forks must share changes to the files covered by the EPL, while combining the code with other work stays easy. That suits a learning project.
- Automated checks (`npm run check:licenses`, SBOM generation) keep licensing visible.

## Consequences

- Contributions are inbound = outbound under EPL-2.0. Sign-off (DCO) is recommended.
