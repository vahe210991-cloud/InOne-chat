# InOne Beta 1.0 — CTO Security Remediation & Release Plan

**Owner:** Product owner / CTO  
**Stage 1 + 2 base branch:** `security/beta1-backend-remediation-2026-11-24`  
**Stage 1 + 2 tracking PR:** [#135](https://github.com/vahe210991-cloud/InOne-chat/pull/135) — merged  
**Stage 3 PR:** [#152](https://github.com/vahe210991-cloud/InOne-chat/pull/152) — Draft, open, unmerged; based on `main`
**Baseline:** `main` at `02880940c1e4d8261405fbeaa01f40879eb44f3a` when the remediation branch was created  
**Plan date:** 2026-11-24  
**Stage 1 + 2 accepted candidate:** `7b8af4f00c15db759253dd9ce7b7666dda9eab3b`  
**Stage 3 implementation checkpoint:** see `development/reports/2026-11-25-beta1-stage3-runtime-hardening.md`

## 1. CTO directive

Deliver a secure, testable Beta 1.0 backend through a sequence of independently reviewable remediation stages. Preserve the existing client/API contracts unless a compatibility review proves a change is necessary. Fix root causes; do not weaken authorization, MLS invariants, tests, or acceptance gates to obtain green CI.

Stage 1 + Stage 2 remain on the existing remediation branch and PR #135. Later stages may use separate stacked stage branches and Draft PRs based on the immediately preceding accepted stage; do not retarget them to `main` until the dependency PR is merged. Do not modify `main`, merge any PR, close related issues, change repository protection/settings, or mutate secrets without explicit owner approval.

## 2. Non-negotiable product and engineering boundaries

- Beta 1.0 scope only. Do not pull Beta 2.0 features into this remediation.
- SMS verification, SMS recovery and SMS provider integration are out of scope.
- Native MLS remains disabled by default. No production enablement as part of this plan.
- Preserve end-to-end encrypted file payloads: the backend stores opaque ciphertext and must not decrypt user content.
- Preserve existing file upload/download API and signed URL contract where possible; make internal storage changes backward-compatible.
- Do not retire legacy MLS/key-package or to-device routes until Flutter, Rust bridge, generated bindings, tests and runtime call sites have been traced and compatibility is proven.
- No invented file-retention duration. A ready-file retention period is a product/operations decision and must be approved before automatic deletion is implemented.
- WBS v1.1 baseline and percentages remain unchanged until evidence-based acceptance and owner approval.

## 3. Execution sequence and stage gates

### Gate 0 — Close Stage 1 authorization remediation (B-01/B-02/B-03)

**Purpose:** establish an accepted security baseline before expanding the change surface.

**Current status:** Stage 1 and Stage 2 were accepted together on exact SHA `7b8af4f00c15db759253dd9ce7b7666dda9eab3b`. All 17/17 check runs, including Flutter, Flutter iOS and the Exact-SHA required workflow gate, completed successfully on that immutable SHA. The earlier `0d383e38...` commit was documentation-only and is not used as proof of Stage 1 code acceptance. PR #135 was merged; `main` now contains merge commit `74169a449de182ea734049e21d8424dfc4091c88`.

**Work / acceptance criteria:**
1. Re-fetch PR head and all workflow runs; identify the exact failed/skipped/cancelled gate dependency from job-level evidence.
2. Complete Flutter iOS validation on the same immutable PR head, or record a concrete infrastructure blocker without calling it a code pass.
3. Re-run the aggregate exact-SHA gate after all required jobs are terminal.
4. Confirm B-01/B-02/B-03 authorization denials, legacy-route compatibility, idempotency/replay behavior and PostgreSQL race coverage remain intact.
5. Add/retain a guard regression for the B-12 last-owner invariant so later database work cannot regress it.
6. Record exact SHA, run IDs, job conclusions and relevant test counts.

**Exit gate:** all required Stage 1 jobs PASS on one exact head; no skipped/cancelled required check; source review confirms no weakened security assertions. Otherwise Stage 1 remains NOT ACCEPTED and work must not be described as release-ready.

### Stage 2 — File transfer, quota and object lifecycle (B-04/B-13)

**Purpose:** bound memory and storage consumption, eliminate quota races and make file lifecycle crash-safe.

**Current status:** ACCEPTED and merged jointly with Stage 1 through PR #135; exact candidate SHA `7b8af4f00c15db759253dd9ce7b7666dda9eab3b`, 17/17 checks passed.

**Implementation packages:**
1. **Streaming upload:** replace whole-body buffering with bounded streaming and backpressure; incrementally count bytes and calculate SHA-256; reject short/long bodies and checksum mismatch; enforce declared size and existing per-kind limits.
2. **Object-store streaming contract:** introduce compatible stream/write/read primitives for filesystem and in-memory implementations. Write to a unique temporary object, finalize atomically, and remove temporary data on abort/error. Preserve current Buffer helpers where tests or callers still need them until migration is complete.
3. **Atomic quota reservation:** reserve owner and organization bytes in one database transaction with concurrency-safe serialization/conditional updates. Include pending and uploaded reservations. Release reservation on failed/expired upload; commit it on ready transition. Implement equivalent deterministic semantics in memory storage. Avoid relying on a read-then-insert check.
4. **Pending upload limits:** make pending-count reservation race-safe as well as byte quotas; preserve current limits unless a documented decision changes them.
5. **Authorization revalidation:** at upload completion, re-check the current owner device state and current room membership/capability/org eligibility. Re-check current membership/device state when issuing and serving downloads. Ensure revocation during an in-flight operation fails closed where the request lifecycle permits it.
6. **Crash-safe cleanup:** do not delete the only database reference before object deletion is durably complete. Use an explicit deletion state/outbox or retryable tombstone/reconciliation design. Make cleanup idempotent and observable; include temp-object and orphan reconciliation.
7. **Retention decision:** document pending-upload expiry separately from ready-file retention. Pending uploads may use the existing upload TTL/stale cutoff. Ready-file automatic expiry requires owner-approved retention policy and must not be guessed.

**Required regressions:**
- Large upload processed with bounded memory / stream backpressure.
- Exact size, short body, oversized body, wrong hash, client abort and storage write failure.
- Concurrent owner quota and organization quota reservations at boundary; no over-allocation.
- Concurrent pending-upload limit reservations.
- Reservation rollback/release after failure and stale pending cleanup.
- Crash/failure between object write, metadata status transition and deletion; retry/reconciliation removes orphan/temp objects without losing references.
- Room membership/capability removal and device revocation between announce, PUT, complete and download.
- Existing signed URL expiry, wrong-device, revoked-device, checksum and encrypted-payload behavior remains covered.

**Exit gate:** focused file tests, complete Node suite, PostgreSQL concurrency/fault-injection suite, disk object-store tests and runtime Compose acceptance all PASS on one exact SHA. No unexplained object leak, quota overrun or unauthorized completion/download. Retention policy remains explicitly undecided unless owner-approved.

### Stage 3 — Runtime boundary, secrets, logging and identity-provider resilience (B-06/B-08/B-09/B-10/B-11/B-15)

**Purpose:** make runtime failure modes deterministic and prevent configuration, request or provider boundaries from becoming security gaps.

**Current status:** ACCEPTED on exact SHA `bd7d8d5e5cdee594f77e399ac3d37252e463263b`; all 15/15 check runs passed. PR #152 remains Draft and unmerged pending owner authorization.

**Implementation packages:**
1. **Persistent object-signing secret (B-06):** load a stable secret from the supported production configuration; fail startup in production if missing/invalid; no random-per-process production fallback. Keep test-only generation explicit.
2. **Safe request logging (B-08):** log normalized route/path and allowlisted metadata; never log signed query strings, authorization/session tokens, recovery codes, message bodies or arbitrary sensitive payload fields. Add regression tests with sentinel secrets.
3. **Global request error boundary (B-09):** cover maintenance checks, object routes, body parsing and regular routes; return stable public errors while retaining redacted structured internal diagnostics. Verify rejected async handlers do not crash the process or leak exception details.
4. **Trusted proxy policy (B-10):** accept forwarded client/protocol metadata only when the immediate peer matches an explicit configured proxy allowlist. Validate and normalize the chain; default to untrusted.
5. **JWKS hardening (B-11):** add bounded timeout and response size; validate content type/shape; coalesce in-flight refreshes; avoid repeated fetch storms for unknown key IDs; check `nbf`; retain strict algorithm/issuer/audience/expiry/signature validation and fail closed.
6. **Health/readiness contract (B-15):** define liveness independently of PostgreSQL and readiness against explicitly required dependencies. Keep responses minimal and do not expose credentials, hostnames, connection strings or configuration values. Confirm container/orchestrator probes match the contract.

**Required regressions:** missing/invalid secret startup tests; log redaction sentinels; failures from every outer request path; spoofed forwarded headers from untrusted peers; trusted proxy chain cases; JWKS timeout/oversize/malformed/unknown-kid/concurrency/nbf tests; DB-down liveness/readiness behavior.

**Exit gate:** focused tests, full Node suite, provider/auth tests, runtime Compose probes and configuration-negative tests PASS on one exact SHA. Production startup fails safely for mandatory missing secrets; health endpoints reveal no sensitive internals.

### Stage 4 — Database integrity, cleanup and administrative atomicity (B-07/B-12/B-14)

**Purpose:** ensure security-sensitive multi-row state transitions are atomic and cleanup is complete.

**Implementation packages:**
1. **Retention of ephemeral security state (B-07):** review all expiring tables and their retention semantics; include missing rate-limit/login-throttle records in scheduled cleanup where appropriate. Use bounded batches/index-supported predicates and avoid deleting active state. Minimize or HMAC identifiers where required by the approved data model.
2. **Organization owner invariant (B-12):** serialize owner-count validation and owner demotion/removal under a stable organization-row lock or equivalent transaction-level invariant. Persist membership mutation and audit event in the same transaction. Cover concurrent last-owner removal/demotion and audit insert failure rollback.
3. **Admin/settings transactionality:** make role changes, member removal, organization settings updates and corresponding admin/settings audit records atomic. Preserve existing authorization and idempotency semantics.
4. **FCM lifecycle race (B-14):** do not reimplement source-level invalid-FID cleanup. Add/execute PostgreSQL regression for re-registration racing with an older failed delivery; ensure stale failure cannot delete a newer registration. Confirm cancellation and retry classification remain correct.

**Required regressions:** concurrent last-owner changes; concurrent owner removal/demotion; audit insert failure; transaction rollback at each mutation boundary; concurrent org-link/revocation and membership cleanup; expiry cleanup for rate-limit/login-throttle state; stale FCM failure versus new token registration.

**Exit gate:** PostgreSQL integration/concurrency/fault-injection suite and full Node suite PASS on one exact SHA; invariants and audit atomicity demonstrated under races and rollback.

### Stage 5 — Supply-chain, CI permissions and production-operability hardening

**Purpose:** reduce dependency and deployment risk after application/runtime/database invariants are stable.

**Implementation packages:**
1. Inventory direct/transitive dependencies, lockfiles, lifecycle scripts, known advisories and unused packages. Upgrade only with compatibility review and regression evidence.
2. Verify reproducible locked installs, supported Node/Rust toolchains and deterministic build inputs.
3. Review GitHub Actions permissions, pinned third-party actions, artifact provenance/retention, secret exposure and fork/PR trust boundaries. Prefer least privilege and read-only validation jobs.
4. Review container base images, runtime user, filesystem permissions, exposed ports, health probes, resource limits and production configuration examples.
5. Produce an operator runbook for secret rotation, backup/restore, database migration/rollback, object-store reconciliation, incident response and safe deploy/rollback.
6. Record any remaining owner-only operational dependencies (domains, signing, provider credentials, retention policy) as explicit blockers; never put secret values in documentation.

**Exit gate:** dependency/security scan evidence, workflow permission review, container/runtime checks and operator runbook reviewed; all relevant CI on one exact SHA PASS. Any unresolved critical/high risk is listed with owner and mitigation, not silently waived.

### Final Beta 1.0 backend security acceptance

The backend is eligible for a CTO recommendation of READY only when:
- Every applicable stage exit gate is met on the final source state.
- All required CI workflows are terminal and successful on the same exact SHA; skipped/cancelled jobs are not passes.
- Node, PostgreSQL, concurrency, fault-injection, Compose and applicable mobile/native integration checks have evidence.
- No critical/high security finding remains open without an explicitly accepted owner risk decision.
- Migrations are backward-compatible, operationally documented and tested against upgrade paths.
- The final report lists exact SHA, run IDs, test counts, known limitations and owner decisions.
- Owner explicitly approves release/merge. This plan itself does not authorize merge.

## 4. Cross-stage engineering rules

- One active stage at a time. Do not mix unrelated fixes into a validation SHA.
- Before each stage: re-fetch PR head, inspect current code and existing PR overlap, record a concise design decision and test plan.
- Prefer small commits grouped by one invariant; update this plan/report as evidence changes.
- For every security fix, add a negative test and, where concurrency/crash consistency is relevant, a PostgreSQL or fault-injection regression.
- Preserve existing API contracts and client behavior; document any unavoidable migration and compatibility window.
- Never claim a test passed based on source inspection, a queued run, a previous SHA, or a cancelled job.
- Re-run the complete applicable gate after the final code change of a stage.
- Keep the PR Draft until all acceptance evidence and owner review are complete.

## 5. Current checkpoint and immediate next actions

### Stage 1 + Stage 2 — JOINTLY ACCEPTED

Accepted exact source SHA: `7b8af4f00c15db759253dd9ce7b7666dda9eab3b`.

All 17/17 check runs passed on that same SHA, including Backend Node, PostgreSQL integration, P0 room-list, Rust bridge, OpenMLS, iOS Keychain, Flutter host/mobile/iOS, Email/PostgreSQL, Compose runtime, Dev Container, Native MLS exact-head verification and Exact-SHA required workflow acceptance.

PR #135 was merged into `main` as merge commit `74169a449de182ea734049e21d8424dfc4091c88`.

### Stage 3 — ACCEPTED (CI)

Stage 3 branch: `security/beta1-stage3-runtime-hardening-2026-11-25`, based on `main` after PR #135. PR #152 is Draft and unmerged. Accepted exact SHA: `bd7d8d5e5cdee594f77e399ac3d37252e463263b`. The implementation report is `development/reports/2026-11-25-beta1-stage3-runtime-hardening.md`.

Implemented in the Stage 3 branch:
- Production persistent object URL signing secret `INONE_OBJECT_SIGNING_SECRET`, passed from configuration to the signer; production fails closed if missing/invalid.
- Request logs use allowlisted static route labels and bounded metadata; request bodies, dynamic path segments and query strings are excluded from the wire log.
- Global request error boundary covers health/readiness, maintenance, object routes, request parsing and regular API routes.
- Forwarded client IP metadata is accepted only from an explicitly allowlisted immediate proxy; chain is validated and walked right-to-left.
- JWKS fetch timeout (5 seconds), response cap (256 KiB), content-type/shape validation, refresh coalescing, unknown-kid cooldown (30 seconds) and `nbf` validation.
- Provider fetch failures return a stable 503.
- Liveness/readiness contract is documented and regression tests added.

**Evidence status:** 15/15 check runs are terminal and successful on exact SHA `bd7d8d5e5cdee594f77e399ac3d37252e463263b`. The set includes backend Node, PostgreSQL integration, P0 room-list, Rust format/check/tests, canonical MLS, Flutter-Rust bridge, OpenMLS attachment/session integration, iOS Keychain, Compose PostgreSQL/migrations/API smoke, Compose build/migrations/HTTP smoke, engine, exact-head MLS source verification and Exact-SHA workflow acceptance.

**Next actions:**
1. Stage 3 implementation and exact-SHA CI acceptance are complete.
2. Conduct owner/reviewer source review of PR #152 and confirm production rollout prerequisites (persistent signing secret and trusted proxy allowlist) are provisioned outside source control.
3. Keep PR #152 Draft and unmerged until explicit owner authorization to merge.
4. Begin Stage 4 work on a separate branch based on current `main`, without changing `main` or merging PR #152 absent authorization.

Do not implement automatic ready-file expiry. Existing pending-upload stale cutoff remains separate from ready-file retention, which still requires an owner decision.

## 6. Decisions required from product owner

Only these decisions are intentionally not invented by engineering:
- Ready-file retention period and whether retention differs by file kind, room or account.
- Any change to existing per-kind maximum file sizes, pending-upload limit or configured quotas.
- Whether a non-default optional dependency should block readiness in production, once the runtime dependency inventory is complete.
- Any residual critical/high risk that would be accepted rather than fixed.

Until approved, preserve current limits and do not automatically expire ready files.
