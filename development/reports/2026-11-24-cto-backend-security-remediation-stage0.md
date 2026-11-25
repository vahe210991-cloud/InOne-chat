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


## Stage 0 addendum — expanded review of B-12..B-15 and open-PR overlap (2026-11-24)

The following details refine the initial matrix; they are still source-level findings, not executed exploit/test results.

### Updated status matrix

| ID | Updated status | Evidence / refinement |
|---|---|---|
| B-12 admin transactionality | **CONFIRMED** | Organization role route checks `countOrgOwners()`, then independently calls `setOrgMemberRole()` and `logAdminAction()`. PostgreSQL methods are separate pool queries; no shared transaction or org-row lock. Member removal similarly checks last-owner count before the transactional `removeOrgMember()`, so concurrent removals can pass the count check. Org settings update and settings-log INSERT are also separate queries. |
| B-13 file retention/quotas | **CONFIRMED (partial implementation)** | Owner byte count and organization byte count exist, as does a pending-upload count. However quota enforcement is a read-then-create sequence: `bytesForOwner()+size` and `bytesForOrg()+size` are checked before a separate `createFile()`; no atomic reservation/locking is present. No quota is applied to org-less avatar uploads through an org quota. Cleanup deletes pending/uploaded rows older than cutoff, while ready files remain indefinitely unless a separate retention/deletion lifecycle exists. Object deletion occurs after DB deletion in a separate step; crash consistency needs review. |
| B-14 FCM registration lifecycle | **FIXED (source-level; tests not executed)** | `fcm-push-sender.js` classifies invalid FID/registration as non-retryable `invalid_target`; `push-delivery.js` deletes the matching encrypted push registration, cancels queued/failed deliveries for the device and marks current delivery cancelled. Current-registration lookup joins active devices, and provider payload is allowlisted to `type,event_id,path` with no plaintext body. Existing `push.test.js` includes an invalid-FID deletion/no-retry regression. Run DB-backed delivery tests before acceptance. |
| B-15 readiness/health | **PARTIAL** | `/healthz` is a liveness response and `/readyz` checks `storage.ping()`. No separate `/livez` route was found. The readiness contract currently verifies PostgreSQL/store ping only; required external/runtime dependencies and orchestrator semantics still need explicit definition and integration verification. |

### Additional concrete evidence

- B-01: legacy `POST /mls/key-packages/:userId/claim` remains active and calls `mlsClaimKeyPackages(..., roomId=null,...)` after only authentication, claim ID validation and sender rate check. It has no room membership, invite capability, shared-org/link, or target-user authorization gate. The newer `/claims` route requires room membership and invite capability but does not explicitly assert the target's shared-org/active-link eligibility.
- B-02: `POST /keys/query` still authenticates but does not call `sharesOrgOrLink()`; `POST /keys/claim` does call it. `PUT /sendToDevice/:type/:txn` accepts arbitrary target user/device maps, skips only missing/revoked devices, and enqueues each payload with `dedupeKey=null`. Existing body-size cap is global, not a per-message/per-recipient queue cap. No per-sender rate check appears in this route.
- B-04: upload still buffers chunks and `Buffer.concat()` before hashing and object-store write. Declared size is checked, including exact Content-Length and actual byte count, but this does not prevent many concurrent valid large uploads from exhausting memory.
- B-06: `main.js` calls `createServer()` without `objectSecret`; the factory default is fresh random bytes. No persistent secret configuration or production fail-fast guard was found in `config.js`.
- B-07: PostgreSQL `purgeExpired()` omits `rate_limits` and `login_throttle`; periodic cleanup calls that method. HMAC/minimization of identifiers remains to be reviewed.
- B-08: wire log continues to include raw `req.url` and blacklist-based body masking. Recovery/download signed query parameters are therefore logged verbatim unless the route is specially excluded; use path-only allowlisted metadata instead.
- B-09: the request callback performs maintenance flag lookup and object handler before the route/body inner try/catch. A single outer error boundary is still absent.
- B-10: trust remains a boolean. When enabled, the first X-Forwarded-For entry is accepted without validating the immediate peer against an explicit proxy allowlist.
- B-11: provider JWKS fetch has no AbortSignal timeout or response-size limit; unknown kid causes another fetch even when the cache is fresh; no negative cache or in-flight coalescing; `nbf` is not checked. Algorithm is explicitly restricted to RS256; signature, issuer, audience and expiry checks are present.
- B-12: role demotion and owner removal both use a check-then-write sequence. `setOrgMemberRole`, `countOrgOwners` and audit logging are independent operations. The existing transaction in `removeOrgMember` protects membership cleanup/join races, but it does not serialize the earlier last-owner count with role/owner mutations.
- B-13: `bytesForOrg()` sums file sizes by room organization, and route checks it, but the check and file insert are not atomic. `bytesForOwner()` likewise is a preflight read. There is no quota reservation row/counter with concurrency protection.
- B-14: current FCM path already has explicit permanent/retryable error classification and removal of invalid FIDs. Do not reimplement this work; add/execute PostgreSQL tests for races where a token is re-registered while an old send fails.
- B-15: health and readiness endpoints are outside the inner request body parse try and are handled before regular API routing; verify safe behavior under DB outage and orchestrator expectations.

### Open PR overlap — disposition

- **#42:** adds a PostgreSQL workflow against the older `inone-engine-poc-0.6.0` path; its diff is a workflow, not an atomic revocation implementation for the current canonical engine. Do not port as a fix. Its test idea may be adapted to current engine after auditing repository CI conventions.
- **#86:** includes useful device-bound signed download logic and regression tests. Current `main` already contains device-bound download signatures and active-session/device checks, so do not copy it again. It does not solve upload streaming or quota reservation.
- **#89:** adds G2 document lifecycle/UI behavior and a staging smoke script. Its client/document lifecycle work must remain separate from backend B-03/B-12 transactions; review individual files before any reuse.
- **#65:** changes one login error catch to avoid returning `e.message`. It does not supply the missing outer request boundary or guarantee all routes avoid error leakage.
- **#63/#66:** contain useful least-privilege CI changes, but remain open; inspect exact workflow versions/ancestry before applying to current workflows.

### Stage sequencing correction

B-12 is a confirmed database-integrity issue and should be fixed in the database stage, but its last-owner invariant is security-critical. Add a Stage 1 guard test and include the actual transactional fix in the database-integrity package. Do not consider Stage 1 accepted until that concurrency scenario is covered.


### Test-coverage refinement

- Current `test/org-links.test.js` already includes F-01 stale-accept-vs-revoke coverage and F-02 PostgreSQL open-join-vs-revoke concurrency coverage. The file is included in `npm run test:db`. Reuse these tests; do not duplicate them. The missing B-03 proof is atomic rollback/fault injection across status transition + both membership deletions + both audit inserts, and repeatable idempotent revoke behavior after a mid-transaction failure.
- Current `test/mls-keys.test.js` exercises the legacy `/claim` endpoint, including same-claim replay and concurrent replay, but that test file is not listed in `npm run test:db`. Existing coverage therefore does not prove the authorization boundary or PostgreSQL claim races for this route. The MLS contract documents both legacy and reservation routes; preserve compatibility until the native/Flutter call graph is proven, and add PostgreSQL coverage for the legacy/new route authorization policy.
- Current `test/admin-journal.test.js` verifies role-change audit entries but does not test last-owner concurrency or rollback when the audit insert fails.
- Current `test/files-disk.test.js` verifies path-safe object keys and a sequential quota threshold; it does not test concurrent quota reservation or memory-bounded upload streaming.


## Stage 1 progress — B-01 implementation slice (2026-11-24)

**Implementation status:** B-01 code changes committed on the remediation branch; exact-SHA CI is queued/in progress. Do not mark accepted until all applicable workflows pass.

Changes:
- Legacy `POST /mls/key-packages/:userId/claim` now applies the shared approved-organization/active-link policy via `sharesOrgOrLink()`. This preserves the legacy route and its claim ID/idempotency behavior for users who are in an allowed relationship.
- Room-bound `POST /mls/key-packages/:userId/claims` now resolves the room organization from the storage contract and checks target-user eligibility via `orgGate()` before the package reservation. Existing sender room membership and invite capability checks remain.
- Added a negative test with two unrelated approved organizations: both legacy and room-bound claim attempts are rejected and the target package remains unused.
- Added `test/mls-keys.test.js` to `npm run test:db` so this authorization suite executes against PostgreSQL in the DB workflow.

Commits on the branch:
- `81785d1b92b420c5bb4ccf2e862950abee44f205` — negative cross-org KeyPackage test.
- `39bd07b746d36f8433b324687d9678418e47858e` — include KeyPackage suite in PostgreSQL gate.
- `aadb3cc366fa2c239b0318bd3cd1ec39b3088e35` — enforce organization authorization on legacy and room-bound claims.
- `2594bc91982942fcc2726565ee37c25d56f3ce2e` — resolve room organization through `storage.roomOrg()` (the `getRoom()` contract does not expose `orgId`).

Current CI for exact head `2594bc91982942fcc2726565ee37c25d56f3ce2e`:
- Backend Docker Compose runtime acceptance: QUEUED.
- Email delivery and PostgreSQL validation: IN PROGRESS.
- Native MLS client validation: QUEUED.
- Dev Container Compose runtime validation: QUEUED.
- Validate recovered InOne P0 source: QUEUED.
- InOne exact-SHA acceptance gate: IN PROGRESS.

No test result is yet PASS for this code change. B-02/B-03 remain open; Stage 1 is not complete. No main merge, issue closure, SMS scope expansion, secret changes or MLS default changes.
