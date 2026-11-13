# InOne platform

InOne is a product platform built around three connected but distinct products:

- **Propo** — marketplace and classifieds in Armenia.
- **InOne Business** — the professional back office and team workspace for organizations selling through Propo.
- **InOne** — personal and social communication for individuals.

The product vision and technical boundaries are documented in the architecture directory. The implementation plan is in development/architecture.

## Start here

1. [Product vision](architecture/PRODUCT-VISION.md)
2. [Product boundaries](architecture/PRODUCT-BOUNDARIES.md)
3. [System architecture](architecture/SYSTEM-ARCHITECTURE.md)
4. [Domain model and organization permissions](architecture/DOMAIN-MODEL-AND-ACCESS.md)
5. [Architecture laws](architecture/ARCHITECTURE-LAWS.md)
6. [Open decisions for the owner](architecture/OPEN-OWNER-DECISIONS.md)
7. [Development roadmap](development/architecture/DEVELOPMENT-ROADMAP.md)

## Project status

The architecture documents are version 0.1 drafts based on the owner's product direction and previously inspected repository structure. The owner must approve unresolved decisions before implementation. Existing repository code, branches, screens, tests and CI records are historical technical references; they are not assumed complete or production-accepted for this restart.

## Development rules and continuity

- Read development/README.md and development/WORKING-RULES.md before development.
- Read docs/continuity/README.md for durable project decisions and handoff.
- GitHub is the durable source of truth. Never rely on chat memory or local-only files.
- Do not merge PRs, run deployments, expose services or change product code without the required owner authorization.
