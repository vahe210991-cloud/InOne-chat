# Architecture development workspace

This folder turns the product architecture into an engineering plan. It is a planning and design area, not proof that implementation exists.

## Read in order

1. [Development roadmap](DEVELOPMENT-ROADMAP.md) — stages, dependencies and acceptance gates.
2. [Backend evolution](BACKEND-EVOLUTION.md) — how to grow the existing Node/PostgreSQL-shaped backend safely.
3. [Repository re-baseline](REPOSITORY-REBASELINE.md) — how to treat the current repository as a technical reference and restart implementation planning.

## Working rule

No production code changes should begin until:
- the owner answers the blocking product/integration questions;
- product boundaries and organization model are approved;
- Propo provides a versioned integration contract or a sandbox/contract specification;
- the first release scope is approved;
- the target identity, database and deployment boundaries are recorded in ADRs.

Use the current source tree as a reference and audit target. Do not assume historical code is complete, secure, deployable or accepted.
