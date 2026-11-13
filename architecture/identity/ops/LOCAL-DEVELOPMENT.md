# InOne Identity — local development and CI plan

Status: Stage 0 runbook; no container or server has been started.

## Local topology for Stage 1
- Identity API/OIDC process.
- Outbox/reconciliation worker.
- PostgreSQL 18.x dedicated local database.
- Ephemeral test-only signing/encryption keys.
- No SMS/email provider.
- Fake in-process product adapters for tests only.

Database port must bind to loopback. No service is exposed to LAN/public network. No production/shared customer data is used.

## Commands planned for Stage 1

After service skeleton and lockfile are committed:

    cd services/identity
    npm ci
    npm run typecheck
    npm test
    npm run test:integration
    npm run contract:check

Exact scripts are created with the first executable Stage 1 source commit. Do not run these commands until files exist.

Local PostgreSQL will be started only after owner authorization. Project mandate prohibits starting even a development server/container without prior owner permission.

## CI gates
- Contract lint: Redocly CLI 2.77.0.
- Event examples: Ajv CLI 5.0.0 and JSON Schema Draft 2020-12.
- Stage 1 adds typecheck, unit/integration/concurrency tests, migrations, dependency audit and container build.
- Production deployment, environment provisioning and database migration are separate gated workflows.

## Test isolation
- Each integration test receives isolated DB/schema or transaction boundary.
- Concurrency tests cover unique contact claims, refresh rotation, recovery grant/code consumption, idempotency and provisioning races.
- No test calls live Propo or sends real email/SMS.
- Test identities and credentials are synthetic.
