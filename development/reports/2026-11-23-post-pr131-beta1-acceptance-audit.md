# InOne Beta 1.0 — post-PR #131 acceptance audit

**Audit date:** 2026-11-23  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Main SHA:** `2430b0365ab71c60b0926b27854d17a9090e1fba`  
**Last major merge:** PR #131, merged 2026-11-23T15:33:11Z  
**PR #131 head SHA:** `984d9e2afa6734ac14269fdee6ad787df84b123b`  
**Active audit branch:** `work/mls-production-acceptance-2026-11-23`  
**Active draft PR:** #132, base `2430b0365ab71c60b0926b27854d17a9090e1fba`, code-validation head `87930a5997b9ceb7aea44409b1e0d07020d3c82f` at report preparation.  
**WBS:** v1.1 unchanged. This report does not amend the approved WBS.

## 1. Executive decision

**NOT READY** for Beta 1.0 release acceptance.

PR #131 is merged and the source integration is substantial. PR #131 exact-head validation completed **19/19 PASS**. However, post-merge push validation on the actual main SHA is not yet fully complete: eight of nine push workflows completed PASS; OpenMLS Flutter Rust Bridge generation, including the iOS native-assets build, is now PASS; Native MLS validation had its iOS Keychain target build cancelled in attempt 1 and a targeted rerun is queued in attempt 2.

The audit also found a real P0 Welcome crash-consistency gap. A transaction-aware fix and child-process SQLCipher restart test have been added to draft PR #132, but that branch has not yet completed its exact-SHA validation. Physical Android/iOS two-device acceptance has not been performed. Native MLS remains disabled by default.

Current estimates (engineering estimates, not WBS changes):

| Measure | Estimate | Meaning |
|---|---:|---|
| Engineering implementation | **90%** | Source implementation and integration present; does not mean runtime acceptance |
| Verification | **73%** | CI and source tests exist, but exact-SHA reruns and physical-device proof remain |
| Release readiness | **58%** | P0/P1, physical-device, production operations and release-signing gates remain |

## 2. Exact main SHA and GitHub Actions

Main was confirmed at `2430b0365ab71c60b0926b27854d17a9090e1fba`. PR #131 merge commit equals this SHA. No subsequent main commit was observed during this audit.

### PR #131 head validation

PR #131 head `984d9e2afa6734ac14269fdee6ad787df84b123b` had 19/19 individual workflow jobs conclude PASS. These included canonical Engine B MLS regression tests, persistent Flutter Rust bridge host tests, OpenMLS attachment/session integration tests, iOS Keychain target build, Flutter mobile/iOS validation, backend Node/PostgreSQL tests, Docker Compose acceptance, Dev Container validation, recovered P0 source validation and FRB generation.

These results are PR-head results, not a substitute for push runs on the merge SHA.

### Main push runs on exact SHA `2430b0365ab71c60b0926b27854d17a9090e1fba`

Nine push workflows were retrieved:

| Workflow | Result | Evidence / scope |
|---|---|---|
| Backend Docker Compose runtime acceptance | **PASS** | Backend image build, PostgreSQL + backend health, schema and latest migration |
| OpenMLS client validation | **PASS** | Rust client + real engine integration tests |
| Dev Container Compose runtime validation | **PASS** | Actual Compose services, migrations and backend HTTP smoke |
| Email delivery and PostgreSQL validation | **PASS** | Complete Node engine suite; PostgreSQL migration and durable email queue suite |
| Validate recovered InOne P0 source | **PASS** | Rust format, PostgreSQL integration, OpenMLS tests, P0 room-list regression, Rust bridge tests, backend Node suite |
| Flutter iOS validation | **PASS** | Flutter validation plus unsigned simulator and iOS device-target builds |
| Flutter mobile validation | **PASS** | Flutter analyze/tests, Android preview APK and Android emulator Keystore/SQLCipher lifecycle smoke |
| OpenMLS Flutter Rust Bridge generation | **PASS** | Main generate/validate job, Android build, Android Keystore emulator smoke and iOS native-assets compile all PASS |
| Native MLS client validation | **RERUN QUEUED** | Exact-source check, canonical Engine B regression tests, persistent bridge host tests and attachment/session integration tests PASS; iOS Keychain native-target job was cancelled on attempt 1. Its cancelled-job log was unavailable. Targeted rerun was accepted and attempt 2 is queued |

The initial Native MLS workflow attempt concluded failure because the iOS Keychain native-target job was cancelled; the other four jobs passed. The targeted job rerun is queued. Do not call this workflow complete until the rerun concludes.

The exact-SHA acceptance gate is configured for pull-request events, not main push; it is therefore N/A for main push. Each applicable main workflow verifies its own source SHA.

**Main SHA verdict:** 7 workflow PASS; 1 workflow IN_PROGRESS; 1 workflow awaiting targeted rerun. Main is not yet fully accepted until the targeted Native MLS iOS Keychain job completes.

### Current audit branch validation

PR #132 is a draft PR based directly on main SHA `2430b...`. Its latest reported head at report preparation was `988d537d7fb3acf812781e67ac598cb5954ed958`. Nine PR workflows were queued for this exact code head: Flutter iOS, exact-SHA acceptance gate, Email/PostgreSQL, Native MLS, Backend Docker Compose, Flutter mobile, OpenMLS FRB generation, recovered P0 source and Dev Container Compose. No completed result was available at report preparation. The later report/continuity commits do not change Rust or Flutter source; the exact-SHA gate still needs to finish for the code-validation SHA.

## 3. P0 — MLS crash consistency, Issue #1

### Current main implementation evidence

Production mobile Rust dependency is canonical Engine B:

`mobile/rust/Cargo.toml` → `../../inone-development-archive-0.6.0/engine/mobile-mls/mls-client`.

OpenMLS storage and the client event journal use one shared SQLCipher connection. A transaction-aware provider is used for inbound application processing and inbound Commit processing.

The canonical Engine B `tests/outbox.rs` suite contains real SQLCipher child-process restart tests, including:

- `process_crash_after_application_ratchet_write_rolls_back_and_redelivers`
- `process_crash_after_inbound_commit_merge_rolls_back_epoch_and_retries`
- `process_crash_immediately_after_inbound_commit_transaction_commit_keeps_epoch`
- `process_crash_at_each_inbox_journal_boundary_preserves_atomic_delivery`
- `encrypted_inbox_survives_restart_until_app_ack_and_never_replays_after_ack`

These tests use a fixed key store to reopen the same encrypted database from a child process. They are not memory-store-only tests.

### Remaining boundary audit

| Boundary | Source state | Evidence / gap |
|---|---|---|
| OpenMLS group state + journal for inbound application message | Shared transaction | Child-process SQLCipher tests exist on main |
| Inbound Commit merge + processed journal | Shared transaction | Child-process SQLCipher tests exist on main |
| Welcome materialization + room index + receipt | **Gap found on main** | Separate write boundaries were found; PR #132 adds a transaction-backed provider and atomic receipt/index commit |
| Flutter/native ACK lifecycle | Partial source integration | Durable inbox persists before app ACK; mobile ACK after durable history is wired. Physical crash/restart proof is pending |
| Outbound Commit server-accepted / response-lost recovery | Partial source implementation | Stable intent/fingerprint journal exists; dedicated child-process proof of accepted server Commit and response-loss reconciliation is not established |
| SQLCipher transaction boundaries | Implemented for covered operations | Welcome fix still requires CI execution |
| WAL behaviour | **Not enabled / not accepted** | Canonical Engine B uses SQLite default journal mode; no WAL-specific crash test. A WAL test in the old Engine A POC is not evidence for production Engine B |
| Forced process termination | Partial proof | Application, inbound Commit and inbox child-process tests exist; Welcome child-process test is on PR #132 and unexecuted |

### PR #132 P0 changes

On branch `work/mls-production-acceptance-2026-11-23`:

- Welcome materialization now uses a transaction-backed OpenMLS provider.
- OpenMLS group state, `client_rooms` and the durable Welcome receipt commit in one SQLCipher transaction.
- Network ACK is sent only after COMMIT; the existing pending-ACK retry handles a lost ACK.
- Five failpoints were added: after group materialization, after room-index write, after receipt write, before COMMIT and after COMMIT.
- Child-process SQLCipher restart coverage was added for all five boundaries in `process_crash_at_welcome_transaction_boundaries_preserves_atomic_join`.

A same-room invalid UTF-8 → valid-message regression and a real `sync()` HTTP 401/403/404 proxy regression were also added to `tests/outbox.rs` on PR #132. All three new Rust regressions (Welcome crash/restart, invalid UTF-8 follow-up, and access-error classification) have **not yet been compiled or executed**. Issue #1 remains OPEN. Do not close it until exact-SHA test evidence proves all boundaries, including outbound Commit and Flutter/native ACK lifecycle.

## 4. P1 — MLS issue reconciliation

| Issue | Current source fact | Remaining acceptance | Status |
|---|---|---|---|
| #114 — canonical Engine B FFI | `mobile/rust/Cargo.toml` uses canonical Engine B; current Rust FFI and Dart adapter are integrated | Exact-SHA Native MLS/FRB validation and physical Android/iOS runtime, Keychain/Keystore and SQLCipher persistence | OPEN |
| #6 — durable incoming inbox | SQLCipher inbox, pending replay and explicit ACK exist; child-process and restart tests exist | Exact-SHA validation and physical Flutter/native ACK lifecycle after process kill | OPEN |
| #5 — invalid UTF-8 | Invalid payload maps to `Incoming::Unreadable` and diagnostic record; existing crash-boundary test covers invalid bytes | A same-room follow-up-valid-message test was added on PR #132, asserting no desync and unchanged epoch; test is not yet run | OPEN |
| #9 — auth/access error classification | Typed API failure classification separates access failures from MLS state failures | A real `sync()` TCP-proxy regression for 401/403/404 was added on PR #132; it asserts no `RecoveryRequired` and valid delivery after access restoration. Not yet executed | OPEN |

All four issue descriptions were updated with current main facts and remaining proof gaps. None was closed.

## 5. Physical Android/iOS acceptance matrix

No physical two-device acceptance has been performed. CI emulator/simulator and unsigned build results are listed separately and do not count as physical acceptance.

| Scenario | Android physical | iOS physical |
|---|---|---|
| Registration and login | NOT RUN | NOT RUN |
| Create room / join room | NOT RUN | NOT RUN |
| Receive and materialize MLS Welcome | NOT RUN | NOT RUN |
| Bidirectional text send/receive | NOT RUN | NOT RUN |
| Offline outbox | NOT RUN | NOT RUN |
| Retry after network restoration | NOT RUN | NOT RUN |
| No duplicate delivery | NOT RUN | NOT RUN |
| Encrypted attachment upload | NOT RUN | NOT RUN |
| Download and decrypt on second device | NOT RUN | NOT RUN |
| Force-stop during send and resume | NOT RUN | NOT RUN |
| Force-stop after receive before ACK | NOT RUN | NOT RUN |
| Device revocation | NOT RUN | NOT RUN |
| Remove room participant | NOT RUN | NOT RUN |
| Session restoration | NOT RUN | NOT RUN |
| Logout and SQLCipher/key-storage purge | NOT RUN | NOT RUN |
| 401 / 403 / 404 handling | NOT RUN | NOT RUN |
| Corrupt/unreadable MLS event | NOT RUN | NOT RUN |
| Android Keystore persistence | NOT RUN on physical device | N/A |
| Protected Keychain persistence | N/A | NOT RUN on physical device |
| SQLCipher key persistence across process death | NOT RUN on physical device | NOT RUN on physical device |
| Signed iOS device build | N/A | NOT RUN |

CI evidence only:
- Flutter mobile validation on main SHA passed, including Android preview APK and Android emulator Keystore/SQLCipher smoke.
- Flutter iOS validation on main SHA passed, including unsigned simulator and device-target builds.
- Native MLS iOS Keychain target job is pending targeted rerun.
- OpenMLS FRB iOS native-assets compile is still in progress.

`INONE_MLS_NATIVE_ENABLED` must remain `false` by default until the physical matrix passes and the owner separately authorizes enabling it.

## 6. Push lifecycle

Source audit corrected an outdated README claim: the production backend FCM sender is already implemented.

Confirmed in source:
- Firebase Admin FCM sender and FCM adapter.
- Sender wired through `engine/src/main.js`, conditional on configured Firebase project and PostgreSQL.
- Encrypted PostgreSQL `push_deliveries` outbox with lease/retry processing.
- Generic allowlisted payload `{type,event_id,path}`; no message plaintext or attachment content in push payload.
- Production configuration requires `INONE_FIREBASE_PROJECT_ID` and independent `INONE_PUSH_ENCRYPTION_KEY`; Firebase Admin uses ADC/workload identity or injected secret.
- Flutter Firebase Core initialization, FID registration/refresh, APNs readiness check, logout unregister and revocation cleanup.
- Foreground, opened-from-background and terminated-launch receive paths; navigation remains authenticated and MLS-gated.

Not accepted:
- Live `npm run test:push:live` against a real Firebase project.
- Real Android FCM display/open.
- Real iOS FCM→APNs delivery, display and tap/terminated-launch.
- Provider acceptance, token rotation and cleanup under real revocation/logout.

No new backend route is required for this work.

## 7. Recovery links

- Beta custom scheme `inone://recovery/confirm` is parsed by the mobile recovery deep-link handler.
- Android intent registration is applied by the generated-platform preparation script.
- iOS `CFBundleURLSchemes` registration is applied by the generated-platform preparation script; the iOS/FRB workflows include this configuration step.
- Unit tests cover valid custom-scheme parsing and reject unsupported hosts/URLs.
- Physical open/confirm, repeated link, expired/reused token, logout and revoked-device recovery tests remain pending.
- Production Android App Links and iOS Universal Links are not configured. No production domain, Android signing fingerprint or iOS application identifier/association domain was supplied. Do not invent a domain or association files.

## 8. Infrastructure and production operations

### Implemented source/tests

- PostgreSQL migrations and transactional migration runner.
- PostgreSQL custom dump, SHA-256 sidecar, retention policy and restore script.
- FILES_DIR archive and restore checks, path traversal/symlink/special-file validation.
- `verify-restore.mjs` checks table set, row counts and migration versions.
- Backup/restore tests for DB and FILES_DIR exist.
- JSON structured request/operation logs with sensitive data redaction.
- Health/readiness endpoints and Compose/Dev Container acceptance workflows.
- SMTP transport and encrypted durable email queue; live SMTP handoff command exists.

### Production blockers

- DB and FILES_DIR backups are separate operations, not one atomic cross-store snapshot.
- External backup storage, encryption at rest, isolated backup credentials and automated checksum/restore alerts are not accepted.
- WAL/PITR is not configured.
- No production restore rehearsal or measured RTO/RPO.
- No accepted production monitoring/alerting and operational runbook.
- HTTPS/proxy is a documented requirement but no live production deployment was validated.
- Real SMTP provider acceptance, sender domain and SPF/DKIM/DMARC delivery are not confirmed.
- Production secrets/configuration are not evidenced as provisioned in a real secret manager.
- Docker Compose acceptance is not production readiness.

## 9. Documentation and tracking updated on PR #132 branch

- `mobile/README.md` — PR #131 marked merged; push sender implementation corrected; exact main SHA workflow state recorded.
- `mobile/API-CONTRACTS-BETA-1.md` — Stage 3 table marked historical; current Flutter/Dart and Engine B state clarified.
- `mobile/API-INTEGRATION.md` — session ownership, runtime acceptance, backend deployment and production blockers reconciled.
- `docs/continuity/CURRENT-STATE.md`, `NEXT-SESSION.md`, `SOURCE-OF-TRUTH.md` — new post-PR131 source of truth and handoff.
- `architecture/decisions/ADR-MLS-SQLCIPHER-ATOMICITY.md` — Welcome transaction gap and evidence limits recorded; ADR remains Proposed.
- `inone-development-archive-0.6.0/engine/mobile-mls/P0-ACCEPTANCE-MAP.md` — historical PR #25 closure explicitly separated from Beta 1.0 mobile Issue #1.
- `development/reports/2026-11-23-beta1-screen-backend-wiring.md` — PR #131 marked merged; exact merge-SHA CI caveats corrected.
- `development/SESSION-LOG.md` — audit and P0/P1 changes recorded.
- Issues #1, #114, #6, #5 and #9 — descriptions corrected; all remain open.

All these documentation changes are on draft PR #132. No documentation change was merged to main. WBS v1.1 was not changed.

## 10. Open PR audit

Ahead/behind and changed-file counts below are comparisons of each PR head against current main SHA `2430b...`. The merge base is shown explicitly. CI status is the state of runs associated with the listed PR head; green on an old head does not mean the branch is current.

| PR | Base SHA | Head SHA | Merge base | Ahead / behind | Files vs main | CI at PR head | Classification / recommendation |
|---|---|---|---|---:|---:|---|---|
| #127 | `a23f9624b8dfcf6234c1770178cff503eff38553` | `154c6ba7283bf8f3b5a1b725ae5b3d706484384f` | `a23f9624b8dfcf6234c1770178cff503eff38553` | 43 / 2 | 34 | 4 PASS, 5 CANCELLED | Partially superseded: core G2 organization requests/admin integration is in #131. Older non-auth staging script is not needed; main contains the newer auth staging script/test. Do not merge branch wholesale. |
| #87 | `a174f794535ab09699d38292acb4919308873fd7` | `eab331fa4efb36cc1f69e8f11ce0c4436fe4fee1` | `a174f794535ab09699d38292acb4919308873fd7` | 104 / 327 | 30 | 4 PASS | Superseded G2 screen/admin branch. PR #131 contains selected merged scope. Keep open pending owner cleanup approval. |
| #89 | `ff0325b20a44dc8e5f96213eea28f259ffdad417` | `8cfcf47c644067814e061cb1e6f3a37fcb5a0498` | `a174f794535ab09699d38292acb4919308873fd7` | 90 / 327 | 32 | 3 PASS, 1 FAIL | Superseded document lifecycle/auth branch. Auth staging script/test and protected document lifecycle are in main/#131. Flutter smoke failure: stale test expects removed `InOneLoginScreen` (76 passed, 1 failed). No merge. |
| #90 | `e629fd35a53147f8372fc5e2bd52ab042a23e766` | `074e76014f33f46085d46cad93007a0fbc849215` | `a174f794535ab09699d38292acb4919308873fd7` | 115 / 327 | 27 | 0 runs | Partially superseded; contains old Engine A path and selected MLS/attachment glue now integrated through canonical Engine B in #131. Do not merge or copy Engine A. |
| #124 | `36ee2c464bc0259ecc302a21bd6cbf321ac25896` | `91814c840da9e0b045d36afa7eec5091938e2199` | `36ee2c464bc0259ecc302a21bd6cbf321ac25896` | 29 / 13 | 16 | 6 PASS | Superseded persistent MLS Flutter operations branch; current bridge/Flutter operations are in #131, and AGP9 patch script is already on main. No cherry-pick identified. |
| #116 | `3c82621af502ccf7e5f00310908046bd27b14c0c` | `32b94020d94660413aa16175880676de7745b174` | `3c82621af502ccf7e5f00310908046bd27b14c0c` | 76 / 142 | 21 | 9 PASS | Superseded Engine B attachment reconciliation; current canonical Engine B and encrypted attachment path are merged by #131. No wholesale merge. |
| #117 | `ce0c4dba63c2f1275090500c263882864becd875` | `3984a222e50588038258064630cec2580d77c684` | `96bf053d0f713e97d1018d6022b15915d46cb3e8` | 16 / 140 | 5 | 7 PASS, 1 FAIL | Superseded key-store lifecycle branch. Current main already contains the KeyStore contract. Exact-SHA gate failed after waiting 120 minutes for FRB generation to finish. No unique required code identified. |
| #125 | `36ee2c464bc0259ecc302a21bd6cbf321ac25896` | `bfeb4e1080f1ef761fb86489c2faedbc83ed07e6` | `36ee2c464bc0259ecc302a21bd6cbf321ac25896` | 3 / 13 | 3 | 5 PASS, 3 FAIL | Superseded reconciliation branch. Rust formatting failure (extra blank line) caused Native MLS and recovered P0 source failures; exact-SHA gate then failed. Main has newer source. |
| #94 | `fa5cabb10003aaae8aad8c624c06cb9a63110483` | `ce47f732cc4d7dd34a66e7d0b9e8be57c9da11a3` | `a174f794535ab09699d38292acb4919308873fd7` | 113 / 327 | 30 | 1 PASS, 4 FAIL | Superseded Android PathProvider JNI bypass. Main has current JNI initialization/panic boundary. Old branch Flutter analyzer errors include duplicate `pending`, missing `eventId`, unresolved `FilePicker.platform` and invalid static `isAbsolute`; do not merge. |
| #129 | `a23f9624b8dfcf6234c1770178cff503eff38553` | `6470e4f4ff13e9e8e42457ccf52f8e86c911c5f7` | `a23f9624b8dfcf6234c1770178cff503eff38553` | 76 / 2 | 19 | 7 PASS, 2 CANCELLED, 1 FAIL | Validation-only mirror for PR #128. Exact gate failed because FRB generation was cancelled; #131 now contains the integrated product code. No merge required. |
| #110 | `e629fd35a53147f8372fc5e2bd52ab042a23e766` | `27927ad1ed9b2a0c7792d72d79c119dd2aeaadc8` | `e629fd35a53147f8372fc5e2bd52ab042a23e766` | 2 / 174 | 2 | 1 PASS | Documentation-only Issue #1/ADR reconciliation. ADR is already on main; new post-PR131 audit supersedes its report. Do not merge stale report. |
| #97 | `b877d883f8ad8c731c784b82729e18f7d5523fc9` | `083a4c92d1c07b3a724cb3c40a8c6c5ad0ff79ec` | `b877d883f8ad8c731c784b82729e18f7d5523fc9` | 2 / 177 | 1 | 9 PASS | Validation/reconciliation-only session API branch. Main's session API is newer and carries attachment-aware incoming message state. No unique required code identified. |

### PR recommendations

- Do not merge any of the listed old branches wholesale.
- Do not copy Engine A from #90 or #94.
- Treat #87/#89/#90/#124/#116/#117/#125/#94/#129/#110/#97 as superseded for current Beta 1.0 implementation, with the limited review notes above.
- #127 is partially superseded; if a staging artifact is still desired, compare it individually with the newer auth staging script already on main.
- Keep all PRs open until the owner explicitly authorizes closure. No PR or branch was closed or deleted in this audit.
- PR #132 remains a draft audit/remediation PR and is not merged.

## 11. Remaining work and effort

| Priority | Work | Estimate | Exit evidence |
|---|---|---:|---|
| P0 | Complete PR #132 Rust format/check/test run; fix any compile/test failure | 0.5–1.5 engineer-days | Exact-SHA Native MLS + FRB + Flutter + acceptance gate PASS |
| P0 | Prove outbound Commit accepted/response-lost recovery under child-process restart | 1–2 days | SQLCipher child-process test and same-SHA logs |
| P0 | Prove Flutter/native ACK and inbox lifecycle through process kill/restart | 1–2 days | Engine + Flutter bridge integration test, then physical device |
| P0 | Decide/document journal mode; add WAL tests only if WAL is enabled | 0.5–1 day | Explicit ADR decision and crash tests on configured mode |
| P1 | Execute new #5 and #9 integration regressions | 0.5–1 day | Same-room valid message after invalid UTF-8; 401/403/404 real sync path no desync |
| P1 | Two-device Android/iOS MLS acceptance matrix | 2–4 days | Signed build/device logs, both directions, restart, attachment, revocation |
| P1 | Live FCM/APNs push acceptance | 0.5–1 day after secrets/project access | Real provider response plus physical Android/iOS receive/tap/terminated launch |
| P1 | Recovery physical test and production link setup | 1–2 days plus domain owner input | Custom scheme tests; Universal/App Links only with real domain and app IDs |
| P1 | Backup/restore drill, external encryption, monitoring, HTTPS/proxy, SMTP/domain | 3–5 days | Production-like restore record, alerting, secrets and delivery evidence |
| P2 | Reconcile/close superseded PRs after owner approval | 0.5–1 day | Owner-approved closure list; no code cherry-pick without diff |
| P2 | Release packaging/signing and final acceptance review | 1–3 days, credential-dependent | Signed Android/iOS artifacts, release checklist and rollback |

## 12. Final acceptance

- Exact main SHA: `2430b0365ab71c60b0926b27854d17a9090e1fba`.
- PR #131: merged; PR-head checks 19/19 PASS.
- Main push workflows: 7 PASS, 1 IN_PROGRESS, 1 targeted rerun QUEUED at report preparation.
- PR #132: draft; 9 exact-head workflows queued at report preparation; no completed test result yet.
- P0 Issue #1: OPEN.
- P1 Issues #114, #6, #5, #9: OPEN.
- Physical acceptance: NOT RUN.
- Push provider/device E2E: NOT RUN.
- Production recovery association links: BLOCKED on real domain/app identifiers.
- Production infrastructure acceptance: NOT READY.
- WBS v1.1: unchanged.
- `INONE_MLS_NATIVE_ENABLED`: remains false by default.
- No main merge, no issue closure, no PR closure and no branch deletion performed.

**Final recommendation: NOT READY.** Proceed to Beta 1.0 acceptance only after P0 crash consistency, exact-SHA validation, P1 regressions, physical two-device Android/iOS tests and production operations gates are all evidenced.
