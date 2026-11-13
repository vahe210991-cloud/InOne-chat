# InOne Identity — Stage 0 readiness session report

- **Date/time:** 2026-11-13 13:26:59 Europe/Tallinn (UTC+02:00)
- **Session type:** CTO technical architecture / GitHub documentation and contract scaffolding
- **Repository:** vahe210991-cloud/InOne-chat
- **Task branch:** stage0/identity-readiness-2026-11-13
- **Base branch:** architecture/product-and-platform-blueprint-2026-11-13
- **Base SHA:** 05bc226526d9c984b6ccb2b9f44dbad8459dcd6e
- **Head at report creation:** 1c987223605f7d6aafde7fbed6bc74b48f9b5fff
- **Parent architecture PR:** #50, draft/open/unmerged
- **Stage 0 PR:** not opened; see repository working-copy blocker below.
- **Report commit SHA:** recorded in the following session-log entry after creation.

## 1. Objective and scope

Owner instructed the CTO to begin and create a fully working Stage 0 for InOne Identity, using all necessary installed skills. Scope was Stage 0 contract freeze and engineering readiness, not implementation of a running service.

## 2. What was created and committed

- Restored the exact mandatory AI-agent mandate from branch docs/mandatory-ai-agent-protocol-2026-11-09 (source blob 80a36b484b48019e1200d521bde520d0419a2054) into this task branch because the architecture branch referenced it but did not contain it.
- Stage 0 readiness pack: architecture/IDENTITY-STAGE-0-READINESS-PACK-V0.1.md.
- CTO runtime/protocol ADR: architecture/identity/ADR-001-RUNTIME-AND-IDENTITY-PROTOCOL.md.
- OpenAPI 3.1 contract for Identity-owned REST routes: architecture/identity/contracts/openapi.json.
- JSON Schema 2020-12 event envelope covering twelve event types: architecture/identity/contracts/event-envelope.schema.json.
- Three representative event examples and an array wrapper schema: event-examples.json and event-examples.schema.json.
- Static first-party client/audience registry plus validation schema: client-registry.json and client-registry.schema.json.
- Environment/secrets contract and local development/CI plan.
- GitHub Actions workflow for Redocly OpenAPI lint and Ajv validation.
- Identity workspace/service README entrypoints.
- Updated Stage 0 readiness status to make the uncompleted verification gates explicit.

## 3. CTO technical decisions recorded

- Node.js 26.x Active LTS, TypeScript strict, Fastify 5.x.
- oidc-provider 9.x as OpenID Provider; @simplewebauthn/server 14.x for passkeys; argon2 0.45.x for Argon2id.
- PostgreSQL 18.7 baseline, pg driver, SQL-first migrations and explicit transaction/locking semantics.
- Modular monolith; separate HTTP/OIDC and outbox/reconciliation worker processes.
- Separate product audiences: urn:inone:api, urn:inone-business:api and urn:propo:api.
- Native apps use public clients + Authorization Code/PKCE S256; web clients use confidential BFF; dynamic registration and insecure grants disabled.
- No production app callback URLs or bundle IDs were invented.
- Propo production adapter is explicitly deferred behind a versioned boundary until Propo supplies immutable personal/work IDs, Seller Account contract, reserve/activate semantics, API/events and sandbox.

These are CTO technical decisions within the delegated architecture task. They do not approve hosting spend, production deployment, legal/privacy processing or Propo integration.

## 4. Verification and exact status

| Check | Result | Evidence / limitation |
|---|---|---|
| GitHub file writes | PASS | Files committed to the task branch and fetched back |
| JSON syntax parse | PASS | OpenAPI, event schema, examples, wrapper and client registry parsed in Code Mode |
| OpenAPI local reference scan | PASS | No unresolved local JSON pointers found by the scan |
| HTTP 204 response-body check | PASS | Removed response bodies from all 204 operations |
| Redocly lint | NOT RUN | GitHub Actions workflow exists; no run visible for the final head |
| Ajv event/client registry validation | NOT RUN | Workflow authored; not executed on final head |
| Application unit/integration tests | NOT RUN | No runtime source exists in Stage 0 |
| Complete repository clone | BLOCKED | Attempted git clone --mirror; failed because this environment could not resolve github.com |
| Server/container/database start | NOT RUN | Prohibited without separate owner permission |
| Deployment/production credentials | NOT RUN | Not requested or authorized |

**Important process blocker:** development/WORKING-RULES.md requires a complete repository clone/working copy with history before editing. The environment could access GitHub Contents/Tree APIs but could not clone the repository: Could not resolve host: github.com. The mandatory protocol requires stopping and recording this exact blocker rather than claiming a complete checkout. Consequently, Stage 0 is authored but not accepted/closed. No PR was opened and no Actions run was triggered.

## 5. Remaining Stage 0 gates

1. Obtain an authorized full clone/working environment, or receive an explicit one-time owner exception to use the repository-native GitHub API workflow for this documentation-only stage.
2. Run the contract workflow on the exact final head SHA and fix every lint/schema failure.
3. Complete the provider conformance review for issuer discovery/JWKS paths and refine library-specific WebAuthn/TOTP payload schemas before Stage 1 implementation.
4. Obtain real app identifiers and exact redirect/logout URI inventory before enabling client registrations.
5. Obtain privacy/legal review before production data processing.
6. Obtain Propo API/sandbox contract before building the Propo adapter; this does not block isolated Identity core development after Stage 0 acceptance.

## 6. Last five completed prior tasks

These are the five most recent substantial architecture decisions/artefacts visible in the previous report and session log. They are complete as documentation in draft branches/PRs, not merged into main.

- ~~[x] Product architecture restart: Propo, InOne Business and InOne product boundaries and architecture v0.1 — PR #50, draft.~~
- ~~[x] Owner decision A1: one Propo Seller Account maps to one InOne Business organization — recorded in architecture docs and PR #50.~~
- ~~[x] Owner decision: many employees per organization and many-to-many person/organization membership with delegated access ceiling — documented after existing organization API audit.~~
- ~~[x] Owner approval: seven-level position hierarchy, separate Observer, Permission Matrix v1 and dual approval for critical finance — recorded in architecture and continuity documents.~~
- ~~[x] Identity registration/contact reservation, account-pair lifecycle and CTO recovery policy/threat model — architecture documents and PR #50 draft.~~

*Completion means the bounded documentation/decision artifact exists; it does not mean merge, runtime implementation or production acceptance.*

## 7. Next five tasks

1. [ ] **BLOCKED** — obtain a complete repository clone/working copy or explicit one-time owner exception for GitHub API-only documentation work.
2. [ ] **NOT STARTED** — open the Stage 0 draft PR and run Redocly/Ajv contract CI on its exact head SHA; fix all failures.
3. [ ] **NOT STARTED** — verify oidc-provider discovery/JWKS and OAuth profile configuration; finalize WebAuthn/TOTP request/response contracts against the selected libraries.
4. [ ] **BLOCKED** — collect app bundle/package IDs, exact redirect URIs and privacy/legal sign-off; do not enable production clients before this.
5. [ ] **NOT STARTED** — after Stage 0 acceptance, implement Stage 1 Identity service bootstrap, PostgreSQL migrations, contact claims, audit, outbox/inbox and idempotency. Keep Propo adapter deferred pending its contract.

## 8. Cumulative readiness

Source: development/PROGRESS-BASELINE.md v1.1 (owner-approved WBS, 2026-11-09). No weights or release scope changed in this task.

| Product measure | Carried forward | Change |
|---|---:|---|
| InOne overall historical estimate | 25% | unchanged; historical qualitative value, no global WBS |
| Beta 1.0 implementation | 42% | unchanged; Identity Stage 0 is not Beta 1.0 scope |
| Beta 1.0 verification | 31% | unchanged |
| Beta 2.0 implementation | 2% | unchanged |
| Beta 2.0 verification | 0% | unchanged |
| Identity Stage 0 authoring | Draft package committed | Not accepted/closed |
| Identity Stage 0 verification | Partial JSON parsing/reference scan only | CI NOT RUN; clone BLOCKED |

Do not add this documentation-only architecture work to Beta 1.0 percentages. Implementation and verification remain separate.

## 9. Safety and handoff

- No application source, database migration, runtime API, UI, production secret, cloud resource, server, container, deployment or DNS was created/started.
- No PR was merged.
- PR #50 remains draft/open/unmerged.
- The task branch is a proposal and must not be treated as main.
- Exact remote head must be re-fetched after this report and continuity updates; the final SHA will be recorded in SESSION-LOG.
- **Handoff status: INCOMPLETE** until the full-clone blocker is resolved and contract CI passes on the exact final SHA.
