# G2 / PR #90 — Engine B integration execution plan

**Status:** integration branch prepared; selective code port NOT YET STARTED.  
**Date:** 2026-11-22  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** `main` at `a23f9624b8dfcf6234c1770178cff503eff38553`  
**Task branch:** `integration/g2-pr90-engine-b-main-2026-11-22-r1`  
**Source PR:** [#90](https://github.com/vahe210991-cloud/InOne-chat/pull/90)  
**Source head inspected:** `074e76014f33f46085d46cad93007a0fbc849215`

## Goal

Bring the still-required G2 persistent messaging and encrypted-attachment behavior from PR #90 into the current production architecture without transplanting its obsolete Engine A dependency or overwriting changes already accepted on `main`.

This branch was created directly from the exact current `main` SHA above. It is intentionally clean of PR #90 product-code changes at preparation time.

## Baseline facts

- PR #90 is OPEN / DRAFT and must remain open and unmerged unless the owner explicitly changes that instruction.
- PR #90 source branch: `fix/g2-mls-ffi-hardening-2026-11-19`.
- Source head: `074e76014f33f46085d46cad93007a0fbc849215`.
- At the latest comparison before branch preparation, source branch was 115 commits ahead and 322 behind `main`, with merge base `a174f794535ab09699d38292acb4919308873fd7`; compare status was diverged.
- The source patch changes backend, experimental Engine A, production Rust FFI, Flutter app/session/bridge/UI, lockfiles, tests, and CI workflows. A wholesale merge is not acceptable.
- Current production dependency on `main` is canonical Engine B: `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`.
- Engine B already provides persistent-session, stable message-ID, encrypted attachment, stable attachment-ID, download, pending-outbox, flush and inbox APIs.
- PR #90 still points to experimental Engine A: `inone-engine-poc-0.6.0/mobile-mls/mls-client`.
- Existing `main` app/session lifecycle and Firebase Push lifecycle must be retained.

## Required porting work

Port only after confirming each behavior is still absent on this branch's current source:

1. **Persistent session lifecycle:** adapt only missing session adoption/recovery behavior to the canonical Engine B API and current production session lifecycle.
2. **Durable text outbox:** connect current UI/session flow to Engine B stable-ID enqueue/send, pending-outbox and flush APIs; preserve durable persistence before ACK.
3. **Idempotent attachment send/retry:** use Engine B `sendAttachmentWithId` with a stable operation ID. Never create a new operation ID on retry.
4. **Encrypted attachment receive/download:** retain ciphertext-only transport, manifest integrity, authenticated/device-bound download and current room/device authorization. Do not port a duplicate Engine A crypto implementation without proof of a missing Engine B capability.
5. **Message history and UI wiring:** expose typed history/attachment state through the existing Flutter repositories and current chat UI while preserving navigation, Firebase Push and loading/error/offline states.
6. **FFI contract:** port only missing Rust/Dart bridge adapters to Engine B's existing types and methods. Export `local_room_ids()` only if an acceptance requirement demonstrates that offline room restoration cannot otherwise work.
7. **Backend hardening:** inspect each PR #90 backend patch against current server source and tests. Port only a demonstrably missing security fix; retain current auth, room membership, device revocation and Host-header checks.
8. **Regression coverage:** add focused tests for outbox persistence/restart, stable-ID retries, ciphertext-only attachment flow, tamper rejection, unauthorized/revoked device downloads, incoming ACK ordering, and push/session lifecycle non-regression.

## Non-negotiable safeguards

- Canonical Engine B only; no production dependency on Engine A.
- `INONE_MLS_NATIVE_ENABLED` remains false by default.
- Preserve Firebase Push lifecycle, navigation and existing session adoption.
- SQLCipher and protected platform key storage remain mandatory.
- No plaintext fallback; no secrets or key material exposed to Dart/logs.
- No incoming ACK before durable local persistence.
- Preserve authentication, room membership, device revocation and download authorization.
- No invented API endpoints.
- Beta 2.0 remains out of scope.
- No merge, force-push, branch deletion, or closing PR #90 without owner authorization.

## Execution gates

| Gate | Requirement | Status |
|---|---|---|
| G0 | Repository-wide agent policy committed and discoverable | PASS |
| G1 | Fresh integration branch created from exact live main SHA | PASS |
| G2 | PR #90 patch mapped against current Engine B and app lifecycle | PARTIAL — source inventory done; per-feature diff mapping pending |
| G3 | Minimal product-code port and regression tests | NOT STARTED |
| G4 | Rust/FRB, backend, Flutter, Android and iOS validation on one exact SHA | NOT RUN |
| G5 | Source review, security review, acceptance report | NOT STARTED |
| G6 | Owner review and explicit merge authorization | NOT STARTED |

## Next actions

1. Re-fetch live `main`, PR #90 head, and this branch head before touching overlapping files.
2. Produce a per-file/per-feature port matrix from the complete PR #90 patch, classifying each change as already present, required, obsolete, or blocked.
3. Inspect Engine B API signatures and current Dart/Rust bridge signatures from this branch; write a typed mapping before editing.
4. Implement one small vertical slice at a time, with focused tests, and review each complete diff.
5. Open/maintain a Draft integration PR and run every applicable GitHub Actions workflow on the exact proposed head SHA. Inspect job logs and artifacts; no inherited CI claims.
6. Keep PR #90 open Draft as source provenance. Do not merge either PR without explicit owner approval.

## Acceptance rule

This plan is not an implementation or test result. PR #90 integration remains **NOT ACCEPTED** until all required behavior is ported to canonical Engine B, all applicable exact-SHA checks pass, security/regression criteria are satisfied, and the owner accepts the result.

## Port-matrix checkpoint — 2026-11-22

The detailed per-file decisions are recorded in [G2 / PR #90 selective port matrix](G2-PR90-PORT-MATRIX.md).

- **PASS:** all 27 source PR changed paths and patches inspected.
- **PASS:** canonical Engine B, FFI, Dart bridge and session API signatures verified at source level.
- **ALREADY PRESENT:** Engine B attachment crypto, stable-ID text/attachment operations, durable outboxes, encrypted download, SQLCipher/protected key lifecycle, backend device-bound download authorization and Host hardening.
- **DO NOT PORT:** Engine A tree, its manifests/lockfiles, duplicate backend hardening, duplicate current bridge/session APIs.
- **FIRST MISSING PRODUCT SLICE:** typed `GET /rooms/mine` repository wrapper and Flutter messages-list wiring. The backend route exists; do not invent a new endpoint.
- Product-code port remains NOT STARTED; G2 remains NOT ACCEPTED. Native MLS remains disabled by default.
- Next: implement the rooms-list vertical slice, then persisted room history/durable text outbox, with regressions and exact-SHA Actions.
