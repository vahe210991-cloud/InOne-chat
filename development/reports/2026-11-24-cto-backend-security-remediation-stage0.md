# CTO Backend Security Remediation — Stage 0 revalidation

**Date:** 2026-11-24  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** `main` at `02880940c1e4d8261405fbeaa01f40879eb44f3a`  
**Task branch:** `security/beta1-backend-remediation-2026-11-24` (created directly from the exact base SHA)  
**Scope:** Beta 1.0 backend only. SMS verification, SMS recovery and SMS provider integration are excluded.

## Executive result

Stage 0 source revalidation is in progress. The canonical backend source reviewed is `inone-development-archive-0.6.0/engine`. The repository-native review identified multiple high-confidence source-level defects matching the requested audit. These findings are marked **CONFIRMED (source review)**; exploit reproduction and regression tests have NOT RUN in this session.

No backend source, migration, test or workflow file was modified. A complete clone/Codespace and authorized code-execution runner are required before broad multi-file backend remediation. Repository-native editing is not a safe substitute for this task's required code review, PostgreSQL concurrency/fault-injection tests and full diff validation.

## Main and repository state

- Live main SHA: `02880940c1e4d8261405fbeaa01f40879eb44f3a`.
- Main commit includes PR #132. Its Welcome materialization/receipt atomicity work and crash-boundary tests must not be duplicated.
- The exact-SHA main workflow snapshot currently shows five completed PASS and three IN PROGRESS jobs (Backend Docker Compose runtime acceptance, Native MLS client validation, Email delivery/PostgreSQL validation, recovered P0 source validation, Dev Container Compose runtime validation are PASS; Flutter iOS, Flutter mobile and OpenMLS FRB generation remain IN PROGRESS). These are not a backend security acceptance suite.
- GitHub reports `main.protected=false`; required status checks are absent.
- Open PRs with relevant overlap: #42 (org-link revocation races), #86 (device-bound file downloads), #89 (document lifecycle/authorization), #63 (security hygiene), #65 (HTTP error disclosure), #66 (CI permissions). Their complete patches and ancestry must be reviewed before any port. Do not wholesale merge or copy them.
- PRs #127/#129/#124/#125 and #90/#116/#117 are concurrent G2/MLS work. Preserve their ownership and current architecture.

## Findings matrix

| ID | Status | Source evidence | Risk / next action |
|---|---|---|---|
| B-01 MLS KeyPackage authorization | **CONFIRMED** | `server.js`: new `/mls/key-packages/:userId/claims` checks caller room membership and invite capability, but does not explicitly apply `sharesOrgOrLink()`/target organization authorization. Legacy `/mls/key-packages/:userId/claim` remains and calls `mlsClaimKeyPackages(..., roomId=null,...)` without room, membership, invite-right or shared-org/link checks. | Legacy endpoint is an authorization bypass relative to the new contract. Add compatibility-safe shared policy or controlled retirement after Flutter/client compatibility audit. Test both routes and concurrent claims against PostgreSQL. |
| B-02 Keys query / to-device | **CONFIRMED** | `POST /keys/query` authenticates but returns `queryDeviceKeys(user)` without `sharesOrgOrLink()`. `PUT /sendToDevice/:type/:txn` checks sender authentication and recipient device not revoked, but does not check sender-recipient relationship/room authorization. It enqueues with `dedupeKey=null`; no route-level message-count/byte limit or sender-specific rate check is visible in this path. | Cross-user device metadata and arbitrary to-device queueing are possible absent a separate upstream gate. Add unified policy, bounded payload/recipient counts, per-sender throttling, queue quotas, and TTL/dedupe protections. Check adjacent key APIs. |
| B-03 org-link revocation atomicity | **CONFIRMED** | Route calls `transitionOrgLinkStatus()`, then `removeCrossOrgMemberships()`, then two `logAdminAction()` calls. PostgreSQL store implements transition, the two membership DELETEs, and audit INSERTs as separate pool queries, not one transaction. | A crash or SQL failure can leave revoked link with stale memberships or missing audit events. Move state transition, cross-membership deletion and audit events into one transaction; serialize invite/join/revoke races. |
| B-04 streaming/resource safety | **CONFIRMED** | `handleObjectRequest()` collects every upload chunk in an array, creates `Buffer.concat(chunks)`, hashes the full buffer, and passes it to object storage. Filesystem store writes the full buffer. This creates multiple full-size in-memory copies; no upload semaphore/global-per-user concurrency control is visible in this handler. | Memory exhaustion under concurrent large uploads. Implement bounded streaming to temp object + incremental hash, atomic quota reservation, concurrency limits and cleanup while preserving existing upload protocol. |
| B-06 persistent object signing key | **CONFIRMED** | `createServer()` defaults `objectSecret=randomBytes(32).toString('hex')`; `main.js` does not pass an objectSecret; `config.js` has no object signing secret or rotation configuration. | Signed object links become invalid across restart and are not stable across instances. Add required production secret, fail-fast validation, key ID/rotation strategy and multi-instance configuration. |
| B-07 limiter retention | **CONFIRMED** | PostgreSQL `purgeExpired()` deletes inbox/tokens/refresh/auth/recovery-cancel records but not `rate_limits` or `login_throttle`. The current cleanup path calls this method periodically. | Persistent high-cardinality limiter keys can grow without bound. Add safe bounded cleanup/TTL and HMAC-derived identifiers after inspecting active counter semantics and indexes. |
| B-08 secret logging | **CONFIRMED** | Wire log stores raw `req.url` (including query string) and applies a regex blacklist to selected JSON field names. The pattern is not an allowlist and misses alternate/nested/whitespace forms and secret field variants. | Query-string recovery/access material and unlisted credentials can leak into diagnostic dumps. Replace with allowlisted structured request metadata; never log query values or production request bodies. Add canary tests for every secret class. |
| B-09 top-level error boundary | **CONFIRMED** | In the HTTP callback, `currentFlags()` and `handleObjectRequest()` execute before the inner body/route try block. No encompassing request-level catch was found around the callback. | Database/async failures before the inner try can reject the async listener without a safe response/correlation log. Add one outer request boundary and safe disconnect/error behavior. |
| B-10 reverse proxy trust | **CONFIRMED** | `clientIp()` trusts the first `X-Forwarded-For` value whenever boolean `trustProxy=true`; configuration is a boolean `INONE_TRUST_PROXY`, not a trusted proxy address/CIDR/hop policy. | A direct client can spoof source IP if deployment enables the boolean while exposing the service. Replace with explicit trusted proxy configuration and test spoofed/direct/proxy chains. |
| B-11 JWKS hardening | **CONFIRMED** | `fetchProviderKeys()` uses `fetch()` without timeout or response-size cap. Unknown `kid` forces a refresh because cache refreshes when the requested key is absent; there is no negative cache or in-flight request coalescing. `nbf` validation is absent. RS256, signature, issuer, audience and expiry checks are present. | Unknown-kid floods can cause outbound request amplification; provider stalls can hang verification. Add bounded timeout/response, negative cache, single-flight refresh, and `nbf` checks without weakening signature verification. |
| B-12 admin transactionality | **NOT YET RESEARCHED** | Requires route/store audit of role, owner, org settings and audit-journal writes. | Inspect transaction boundaries, last-owner concurrency and stale writes. |
| B-13 file retention/quotas | **NOT YET RESEARCHED** | Partial upload cleanup exists; complete quota/reference lifecycle not yet traced. | Audit pending/ready states, org/user quota reservation, active references, account/org deletion and restore. |
| B-14 FCM lifecycle | **NOT YET RESEARCHED** | Existing push sender and PostgreSQL delivery work are present; provider error taxonomy not re-audited. | Reuse current sender; test permanent vs retryable provider errors and invalid registration cleanup. |
| B-15 health/readiness | **PARTIAL** | `/healthz` returns liveness success; `/readyz` calls `storage.ping()`. | Verify PostgreSQL is the actual production store and check required dependencies/HTTP integration. Do not infer complete readiness from route presence. |

## Additional review notes

- Existing tests include `log-secrets.test.js`, `org-links.test.js`, `org-isolation-matrix.test.js`, `expired-cleanup.test.js`, and PostgreSQL `test:db` coverage. Their existence is not proof they pass on this SHA.
- Existing org-link tests and prior historical PostgreSQL evidence must be reused where source/test scope is unchanged; new concurrency/fault-injection cases are still required for the currently non-atomic revoke path.
- The new KeyPackage claims route has useful room/invite checks, but legacy compatibility currently bypasses them. Do not remove the legacy route until client/API usage is established.
- Email-only recovery remains in Beta 1.0 scope; SMS work is excluded. Verify email_verified, single-use/expiry and generic account responses as a separate auth slice.
- `INONE_MLS_NATIVE_ENABLED` must remain false by default.

## Test and CI status

- Source inspection: PASS for the paths listed above.
- Exploit reproduction / new unit tests: NOT RUN.
- PostgreSQL integration/concurrency/fault injection: NOT RUN.
- Full Node suite: NOT RUN in this session.
- Docker Compose backend acceptance: current main workflow PASS at exact main SHA, but it is not evidence for unmodified security findings unless its test coverage is explicitly mapped.
- Flutter iOS/mobile and FRB workflows: IN PROGRESS at inspection.
- Physical penetration testing / two-device acceptance: NOT RUN.
- Branch protection: BLOCKED (not configured; no settings changed).

## Execution blocker and next steps

This is a broad multi-file backend change requiring complete repository clone/Codespace, local source diff review, Node + PostgreSQL execution, Docker Compose acceptance and exact-SHA CI. The current session has GitHub repository-native inspection and write capability, but no verified complete clone/test runner. Per repository policy, do not implement a broad backend change through piecemeal contents-API writes.

1. Obtain an authorized complete clone/Codespace and test runner.
2. Continue B-01..B-03 as Stage 1; include legacy route/client compatibility and PostgreSQL race/fault-injection tests.
3. Only after P1 acceptance, proceed to streaming/quota file lifecycle (B-04/B-13).
4. Then B-06..B-11/B-14/B-15; then B-07/B-12 database integrity; finally supply-chain/production hardening.
5. Review all relevant open PR patches before porting any existing fix.
6. Keep PR Draft, no main merge, no issue closure, no secret mutation, no native MLS enablement.

**Beta 1.0 verdict:** NOT READY for backend security acceptance. Findings are source-level confirmations, not a penetration-test result or production-readiness claim.
