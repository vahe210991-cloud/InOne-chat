# InOne Beta 1.0 — Stage 3 Runtime Hardening

**Date:** 2026-11-25  
**Stage branch:** `security/beta1-stage3-runtime-hardening-2026-11-25`  
**Base:** `main` at `74169a449de182ea734049e21d8424dfc4091c88`  
**Dependency:** PR #135, joint Stage 1 + Stage 2 accepted CI candidate  
**Status:** ACCEPTED: all 15/15 check runs passed on exact candidate SHA `bd7d8d5e5cdee594f77e399ac3d37252e463263b`

## Scope

Stage 3 covers B-06, B-08, B-09, B-10, B-11 and B-15. It is based directly on `main` after Stage 1 + Stage 2 were merged by PR #135 (merge commit `74169a449de182ea734049e21d8424dfc4091c88`).

## Findings and changes

### B-06 — Persistent object URL signing secret

- Added `INONE_OBJECT_SIGNING_SECRET` to runtime configuration.
- Production configuration now fails before listening if the secret is missing, shorter than 32 characters, or contains a known test/example marker.
- `main.js` passes the configured value into the object URL HMAC signer.
- Development/test-only direct `createServer` calls retain an ephemeral default for isolation.
- Added environment/deployment documentation. The key must be stable across restarts and identical across replicas; rotation requires an explicit overlap strategy.

### B-08 — Safe request logging

- Request log paths now use an allowlist of static route labels; unknown paths collapse to `/__other__`.
- Dynamic path segments and query strings are not logged.
- Request bodies are no longer copied into the in-memory wire log; message/document annotations remain non-content labels.
- HTTP method is normalized to a fixed allowlist and the remaining metadata is limited to status and duration.

### B-09 — Global request error boundary

- The outer request `try/catch` now covers liveness/readiness, maintenance checks, object routes and body parsing, as well as regular API routes.
- Unexpected failures return a stable public 500 response and log only a bounded error code.
- If a stream has already started a response, the connection is destroyed instead of attempting a second response.

### B-10 — Trusted proxy policy

- Forwarded headers are ignored unless the immediate socket peer exactly matches an explicitly configured trusted proxy IP.
- The forwarded chain is validated as IP addresses and traversed from right to left through trusted hops.
- Missing, malformed or oversized forwarded chains fail closed to the socket peer.
- Added `INONE_TRUSTED_PROXY_IPS`; enabling `INONE_TRUST_PROXY=true` without a valid allowlist is a configuration error.
- The current allowlist format is exact IP addresses, not CIDR ranges.

### B-11 — JWKS resilience

- Provider JWKS fetches now have a 5-second timeout and a 256 KiB response ceiling.
- Content type and JWKS shape/key count are validated before caching.
- Concurrent refreshes for one provider are coalesced.
- Unknown `kid` refreshes are cooldown-limited to one per provider per 30 seconds.
- JWT `nbf` is validated in addition to existing RS256, issuer, audience, expiry, nonce and email checks.
- Provider fetch failures return a stable 503 without exposing provider/network exception details.

### B-15 — Health/readiness contract

- `/healthz` remains process liveness and does not depend on PostgreSQL.
- `/readyz` checks the required PostgreSQL store dependency and returns only a minimal 200/503 status.
- SMTP/FCM delivery remains asynchronous through durable workers and is not synchronously probed by readiness.
- Added regression coverage for liveness during database outage.

## Added regression coverage

- Production signing-secret validation and trusted-proxy configuration validation.
- Trusted and untrusted forwarded-header behavior, including a multi-hop trusted chain.
- Route/path/query/body redaction sentinels.
- Global error boundary for failures before body parsing.
- Liveness/readiness behavior during a simulated database outage.
- JWKS timeout, size, content type, shape, refresh coalescing, unknown-kid cooldown, `nbf`, and provider outage behavior.

## Validation status

**ACCEPTED on exact SHA:** `bd7d8d5e5cdee594f77e399ac3d37252e463263b`.

All 15/15 check runs completed successfully on this exact SHA. The evidence includes Backend Node suite, PostgreSQL integration suite, P0 room-list regression, Rust format/check/tests, canonical MLS regression, persistent Flutter-Rust bridge tests, OpenMLS attachment/session integration, iOS Keychain native target build, Compose PostgreSQL/migrations/API smoke, Compose build/migrations/HTTP smoke, engine, non-mutating exact-head MLS source verification, and the Exact-SHA required workflow acceptance gate.

No required check was left queued, skipped or cancelled in the observed check-run set. This is CI acceptance for the Stage 3 candidate, not authorization to merge or deploy.

## Safety boundaries

- No change to `main`.
- PR #135 is merged; `main` includes merge commit `74169a449de182ea734049e21d8424dfc4091c88`.
- Stage 3 PR #152 remains Draft and unmerged pending owner review/authorization.
- No secrets or secret values are committed.
- No production deployment or key rotation was performed.
