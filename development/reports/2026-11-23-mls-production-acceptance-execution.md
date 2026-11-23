# MLS production acceptance — CTO execution plan

Date: 2026-11-23  
Base: `main` at `2430b0365ab71c60b0926b27854d17a9090e1fba`  
Working branch: `work/mls-production-acceptance-2026-11-23`

## Executive decision

Keep `INONE_MLS_NATIVE_ENABLED=false` by default. Engine B integration and passing CI are necessary but insufficient for production acceptance. No release-gate change, production enablement, main merge, or claim of physical acceptance is authorized by this work.

This execution lane covers the remaining implementation and evidence gaps without replacing already merged Engine B, Firebase client registration, G2 encrypted attachment transport, or current app lifecycle.

## Verified baseline

- `mobile/rust/Cargo.toml` links the canonical Engine B client at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`.
- Flutter's production adapter exposes stable message/attachment IDs, durable inbox/outbox, pending incoming records, ACK, local room restoration, and device operations.
- Engine B uses a shared SQLCipher SQLite connection for the OpenMLS provider and client metadata/journal. Migrations run before the shared connection is opened.
- A transaction-scoped adapter exists (`TransactionConnection`) and debug-only process-kill failpoints exist.
- `INONE_MLS_NATIVE_ENABLED` is explicitly `false` by default in the mobile app.
- Firebase Messaging initialization, authenticated FID registration and client receive/tap lifecycle exist. The FCM/APNs sender and end-to-end delivery are not accepted.
- PR #131 is represented in the base commit. No claim is made here that physical two-device testing has happened.

## Workstreams and acceptance gates

### A. MLS transactionality and crash consistency — P0, Issue #1

1. Map every durable mutation for inbound application messages, inbound Commit, outbound Commit, Welcome materialization, inbox ACK and outbox ACK.
2. Prove that OpenMLS writes and the corresponding application journal/cursor updates use the same SQLite transaction and connection. A transaction around only metadata is not sufficient.
3. Add deterministic failpoints immediately before and after each durable write/commit boundary, including WAL recovery and child-process termination.
4. On restart, assert exactly one valid outcome: old epoch + retryable pending operation, or new epoch + committed journal/receipt. Never a mixed state.
5. Cover outbound Commit accepted by server but response lost; reconcile by stable operation identity/fingerprint without regenerating or replaying a different Commit.
6. Cover Welcome received/materialized but local ACK response lost; replay must be idempotent and must not create duplicate groups or lose the Welcome.
7. Cover incoming app event persisted before ACK and crash after ACK; no loss and no duplicate visible delivery.
8. Run against real SQLCipher SQLite, not only memory stores or mocks.

Required outputs: transaction map, ADR/update if the current design has a gap, failpoint tests, restart evidence, WAL recovery evidence, and independent review. Issue #1 stays open until all criteria pass.

### B. Mobile two-device acceptance — P0

Use two physical devices with distinct device identities and fresh installs. Execute and retain a timestamped test record for:

- Device A sends text to B; B receives, decrypts, durably stores and displays it.
- Device B replies; A receives and displays it.
- Send a binary attachment in each direction; verify ciphertext-only upload, authorized download, decryption and plaintext integrity.
- Kill/restart each app at queued, uploaded, sent, received, persisted and ACK-pending boundaries; retry with the same stable operation ID/ciphertext.
- Revoke one device; prove revoked credentials cannot sync, send, download protected attachments, or receive further push. Confirm remaining device/group state remains usable.
- Reinstall/recovery cases must distinguish a recoverable local session from a new device requiring explicit approval. No silent key regeneration or plaintext fallback.

Emulator CI is supporting evidence only and cannot satisfy this gate.

### C. Push end-to-end

1. Preserve the existing Firebase FID registration lifecycle and server-side device association/revocation semantics.
2. Implement a production sender using the documented FID-capable Firebase direct-send path; do not assume legacy APNs/FCM registration tokens are deliverable as FIDs.
3. Use the durable server push outbox, bounded retries/backoff, provider response classification, invalid-FID cleanup, cancellation on logout/revocation, and idempotent delivery state.
4. Payloads contain only opaque routing/event hints; never plaintext message content, MLS keys, access tokens or sensitive previews.
5. Test Android FCM and iOS FCM→APNs on physical devices: foreground, background, terminated, permission denied, token/FID rotation, logout, revocation and provider failure.
6. Verify that push is a wake-up hint only; the app fetches authenticated ciphertext and relies on MLS for content.

Do not add service-account JSON, APNs private keys or provider credentials to the repository. Secrets must be provisioned through the deployment secret manager by the owner/operator.

### D. Backup and recovery

- Specify backup scope and exclusions: SQLCipher database, platform-protected key material, account/device binding, attachment cache and server-side state.
- Verify whether the platform backup can restore the database without its protected key; fail closed if the key is absent or device-bound and unavailable.
- Test backup restore on the same device, fresh install, another device, corrupted/truncated database, wrong key, stale schema and revoked device.
- Do not copy raw platform key material into ordinary app backup or cloud files.
- Define user-visible recovery/re-enrolment behavior and prove no silent database-key regeneration.

### E. Production links and operations

- Keep the existing beta custom scheme for development/test.
- Add production Universal Links (iOS) and Android App Links only after the owner supplies the production domain and controls DNS/hosting.
- Generate and serve exact `apple-app-site-association` and `assetlinks.json` files over HTTPS; bind the real bundle ID, team ID, package name and signing-certificate SHA-256.
- Verify association files from the public internet and exercise install/open/deferred-open behavior on physical devices.
- Add operational monitoring for push queue age/failure, invalid registrations, MLS sync/commit failures, recovery-required rooms, outbox/inbox backlog, attachment failures and crash/restart loops. Redact identifiers and secrets.
- Define alert thresholds, retention, runbooks, ownership and rollback procedure before production acceptance.

## Dependency and execution order

1. Complete source audit and transaction map for Issue #1; implement missing transaction boundaries and crash tests.
2. Complete outbound operation journal/reconciliation and Welcome/ACK idempotency.
3. Reconcile any mobile bridge gaps against canonical Engine B and add automated integration regressions.
4. Implement push sender and provider delivery state using the existing registration/outbox contracts.
5. Complete backup/recovery implementation and test matrix.
6. Obtain production domain and signing/provider configuration; implement association files and production link verification.
7. Run exact-head CI and security review.
8. Conduct physical two-device acceptance and production operational rehearsal.
9. Submit an acceptance dossier for owner review. Only after explicit owner acceptance may the release gate be changed.

## Evidence rules

- Every result is tied to an exact commit SHA, device/OS/build, test case and timestamp.
- Distinguish PASS, FAIL, NOT RUN and BLOCKED. Missing evidence is not PASS.
- CI/emulator evidence is not physical-device evidence.
- No credentials or secret values in logs, test artifacts or commits.
- Do not weaken tests, remove failpoints, or redefine acceptance criteria to make a gate green.
- No changes to `main`, branch protection, production secrets, Firebase project settings, Apple Developer settings or DNS without the relevant owner/operator authorization.

## External dependencies / owner inputs

The following cannot be completed solely by source changes in this repository:

- Two physical iOS/Android devices and a coordinated test window.
- Production domain and DNS/hosting ownership for association files.
- Apple Developer App ID/team/signing configuration and APNs key provisioned to Firebase.
- Firebase project/service identity with permission to send FID-addressed messages.
- A production-like backend environment with push outbox and observability access.
- Backup-provider/device environment for restore testing.

## Current status

- Branch created from the exact `main` base above.
- Source audit started; this report records the verified baseline and gates.
- No source implementation, test execution, physical-device test, push delivery, backup restore, domain association or production deployment is claimed by this report.
- Release gate remains OFF.
