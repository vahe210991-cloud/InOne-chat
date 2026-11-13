# InOne Identity engineering workspace

This is the Stage 0 contract/readiness package, not the running service.

## Entry points
- Stage 0 readiness: ../IDENTITY-STAGE-0-READINESS-PACK-V0.1.md
- ADR-001: ADR-001-RUNTIME-AND-IDENTITY-PROTOCOL.md
- OpenAPI: contracts/openapi.json
- Event schema: contracts/event-envelope.schema.json
- Event examples: contracts/event-examples.json
- Client registry: contracts/client-registry.json
- Client registry schema: contracts/client-registry.schema.json
- Environment: ops/ENVIRONMENT-CONTRACT.md
- Local development: ops/LOCAL-DEVELOPMENT.md

## Contract validation
Run from repository root:

    npx --yes @redocly/cli@2.77.0 lint architecture/identity/contracts/openapi.json
    npx --yes ajv-cli@5.0.0 validate --spec=draft2020 --strict=true -s architecture/identity/contracts/event-examples.schema.json -d architecture/identity/contracts/event-examples.json

CI runs the same checks through .github/workflows/identity-contracts.yml.

## Change policy
- OpenAPI/event changes are versioned and reviewed as API changes.
- Additive changes are not automatically backward-compatible; verify required fields, enums and consumer behavior.
- Breaking changes require a new major contract version or explicit migration plan.
- Never add product-owned endpoints to Identity.
- Never place secrets, credentials, raw contact values or permissions in events.
- Every consumer must be idempotent and support replay/reconciliation.

No service source, migration, running container, secret, external client registration or deployment exists yet.
