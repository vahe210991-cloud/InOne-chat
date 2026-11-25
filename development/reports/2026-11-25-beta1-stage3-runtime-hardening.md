# InOne Beta 1.0 — Stage 3 Runtime Hardening

**Date:** 2026-11-25  
**Stage branch:** `security/beta1-stage3-runtime-hardening-2026-11-25`  
**Base:** `security/beta1-backend-remediation-2026-11-24`  
**Dependency:** PR #135, joint Stage 1 + Stage 2 accepted CI candidate  
**Status:** Implementation committed; exact-SHA validation pending

## Scope

Stage 3 covers B-06, B-08, B-09, B-10, B-11 and B-15. The implementation is intentionally stacked on the Stage 1 + Stage 2 branch so that PR #135 remains unchanged at its accepted source SHA.

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

No Stage 3 test result is claimed yet. The complete backend Node suite, PostgreSQL suite, runtime Compose checks and exact-SHA workflow gate must pass on the final Stage 3 SHA. Any failure will be investigated without weakening security assertions.

## Safety boundaries

- No change to `main`.
- PR #135 remains unchanged at its accepted Stage 1 + Stage 2 candidate SHA and remains Draft/unmerged.
- This Stage 3 branch is stacked on PR #135 and must not be merged ahead of its base.
- No secrets or secret values are committed.
- No production deployment or key rotation was performed.
