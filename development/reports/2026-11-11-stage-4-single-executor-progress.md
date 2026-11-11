# InOne Beta 1.0 — Stage 4 single-executor progress and acceptance blockers

**Date:** 2026-11-11  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Current work branch:** `feature/stage-4-native-mls-runtime-2026-11-11`  
**Base:** `main` at `94571cbc923ac4d29c3c684dbfdeb35f031d6a30`  
**Verified source head at report time:** `048db63a7817b28e38a3a8353f8665a713f56730`  
**PR:** [#45](https://github.com/vahe210991-cloud/InOne-chat/pull/45), OPEN / Draft  
**Product stage:** Beta 1.0 only  
**Execution ownership:** ChatGPT is the sole developer/executor in this workstream. No external agent is assigned or assumed. Owner will explicitly notify if this changes.

## 1. Scope and acceptance policy

The active product stage is Beta 1.0. Beta 2.0 features are outside the current acceptance scope unless separately approved. The approved WBS v1.1 weights and baseline remain unchanged.

Beta 1.0 WBS weights:
- Backend/API: 25%
- Flutter/UI: 25%
- API/UI integration: 15%
- MLS/security/storage: 20%
- QA/CI/E2E: 10%
- DevOps/release: 5%

Historical baseline remains Beta 1.0 at 42% implementation / 31% verification. No overall percentage has been recalculated or increased in this report.

A task is not accepted because code exists or a workflow was created. Acceptance requires the actual mandatory test/build matrix to execute and pass on one exact final SHA. A workflow that never obtains a runner is not a code-test result. A skipped required platform test is not a pass.

## 2. Changes made during this single-executor session

All changes below are committed to the Stage 4 branch. They are implementation changes, not yet accepted because the CI runners did not execute any steps.

| Area | Change | Commit |
|---|---|---|
| Native MLS feature gate | Added `INONE_MLS_NATIVE_ENABLED` build-time gate; default is `false`; app only constructs native bridge when explicitly enabled on Android/iOS | `0bc48279759b1ced0c25a6602d2d64021e972fcd` |
| Logout cleanup | Database and sidecars are all attempted; SQLCipher key deletion is attempted even if file deletion fails; added failure-path unit test | `008d940dd0edcf845ecbc23f1a5e1601cb4287f7` |
| Inbox idempotency | Replayed event IDs use `INSERT OR IGNORE`, preserving prior content and acknowledgement state; added a regression test | `b331fb2fc9e6c7371b206f9a53a9d3bbaf6f89c0` |
| Persistence atomicity | OpenMLS provider and client metadata share one SQLCipher connection; incoming ratchet state, inbox row and processed marker are committed in one transaction; rollback reloads group state | `a020923dc0b534ba2884f47c0d68f1947f006df1`, `b92d3406a232df792b5563f12e8b6d122038289f` |
| Room/commit transactions | Room creation, Welcome adoption and server commit processing/merge use transaction-backed OpenMLS storage | `b92d3406a232df792b5563f12e8b6d122038289f` |
| Pending commit ordering | Invite/revocation commits are staged, sent to the server, and merged locally only after server acceptance; failed sends clear local pending commits | `4578f2aa11935ba6d34bc0880e7ed1cb18c623e5`, `a431cf951975eda0c27c44ee9f40c42b2e344002`, `b92d3406a232df792b5563f12e8b6d122038289f` |
| Restart reconciliation | Sync clears an unmerged local pending commit before applying server state and fails closed if the local epoch is ahead of the server | `7843716ad483a1bbb24c2662a9bb9b75ba8820ed`, `870b2e505a230653d0b5141cfc83d0b1ba8ef26c` |
| Session concurrency | Serialized concurrent initialization and concurrent native MLS handoff | `b7a9491f2b5bcf3c2c5ac542e285297f836a34dc` |
| Logout concurrency | Logout waits for login, session restoration, MLS handoff and refresh operations; blocks new login/adoption/API requests while cleaning up; always clears in-memory credentials | `19b80ccd8a367a332fcb337fb21d718e5cef4a5b`, `5bb366e92760712e74c54099185d42b14b4d7ff7`, `404775ff54c5e8a5eee175eb8d908c6c6929e2c0` |
| Logout race regression | Added a test that logs out while native MLS handoff is blocked and verifies cleanup occurs only after handoff completes | `3fc8fee49eca979885c4aca9179eaa60f31bab30` |
| Rust logout failure safety | Poisoned session lock and remote logout panic no longer bypass local database/sidecar and platform-key cleanup; added regression test | Current source head `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab` |
| Refresh-token handoff | Dart clears its refresh-token copy immediately after native open succeeds; failed access-token snapshot no longer causes the active Rust session to be closed | Current source head `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab` |
| Rust bridge initialization | Failed RustLib initialization clears the cached future so a later attempt can retry | Current source head `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab` |
| Welcome ACK recovery | Persisted Welcome ID + room ID in the same transaction as the joined group; after restart, retry ACK without consuming the Welcome twice | Current source head `da844b08240c3e67762997be9b65d8e91cab120f` |
| SQLCipher key recovery | Split existing-key lookup from create; resume never creates a replacement key; existing DB without key fails closed; partial new-session failures attempt DB/sidecar and key cleanup | Current source head `da844b08240c3e67762997be9b65d8e91cab120f` |
| Flutter session tests | Added concurrent initialization and concurrent MLS handoff tests | `3c928ea4d50dec549cb13480d818010aaff1f187` |
| iOS Protected Keychain gate | CI now requires signing certificate, password, provisioning profile and team ID; missing secrets fail the iOS runtime gate instead of silently skipping it | `0dd3cab829010df0a4c6230e116e80163729f3a5` |
| Android JNI initialization | Removed panic-based JNI context initialization; errors are retained and propagated to the secure-store initializer; Android MLS fails closed if app context is unavailable | `dcb88d9e0933fda6270ee9017d35b0952da7e7f2`, `3b0f631e47f8219bec1147e7884c4e291d6abdbf` |
| MLS event validation | Missing/empty event IDs are rejected; MLS message processing errors are propagated instead of being converted into and permanently marking an unreadable message | `048db63a7817b28e38a3a8353f8665a713f56730` |

The report does not claim these changes compile or pass tests. They remain pending executed CI evidence.

## 3. CI execution evidence and current blocker

Latest workflow runs on source SHA `048db63a7817b28e38a3a8353f8665a713f56730`:

| Workflow | Run | Job result | Runner evidence |
|---|---:|---|---|
| OpenMLS client validation | [42976612169](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42976612169) | FAILED before first step | `runner_id=0`, empty `steps` |
| Flutter Rust Bridge generation | [42976612175](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42976612175) | FAILED before first step | `runner_id=0`, empty `steps` |
| iOS native assets + Keychain | [42976612175](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42976612175) | SKIPPED because its prerequisite job failed | No iOS runner was allocated |
| Flutter mobile validation | [42976532996](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42976532996) | SKIPPED by the workflow's Stage 4 branch condition | Not a pass; the FRB workflow is intended to run Flutter analyze/tests and Android build after code generation |

The two failed jobs completed in approximately three seconds, reported `runner_id=0`, `runner_name=""`, and `steps=[]`. Their job-log download returned no log content. The failed jobs therefore did not run Rust/Cargo, Flutter, Android or iOS commands. The exact GitHub-side reason that no runner was assigned is **UNKNOWN**; no cause is inferred.

Rerunning failed jobs on earlier Stage 4 runs produced the same no-runner/empty-step pattern. This is a confirmed execution blocker, not evidence that a particular source-code test failed.

## 4. Security and correctness review findings still open

### 4.1 MLS state and inbox atomicity — IMPLEMENTED IN SOURCE, NOT YET VERIFIED

The source has been refactored to use one SQLCipher `Connection` for OpenMLS provider state and client metadata. A transaction-backed `DeviceProvider` borrows the active `rusqlite::Transaction`. Incoming application processing, OpenMLS ratchet-state writes, inbox insertion and the processed marker now execute on that same connection and transaction. On processing or persistence failure, the transaction is rolled back and the in-memory group is reloaded from durable state.

Server commit processing/merge, room creation and Welcome adoption also use transaction-backed OpenMLS storage. Invite and device-removal commits are staged locally, sent to the server, and merged locally only after server acceptance; rejected commits are cleared locally rather than advancing the device epoch ahead of the server.

Regression tests were added to prove that OpenMLS storage writes roll back with an outer SQL transaction, duplicate inbox delivery does not reset acknowledgement state, and a rejected local pending commit can be cleared without advancing the epoch.

**Verification remains outstanding:** none of these tests has executed because the GitHub Actions jobs still fail before runner assignment. A crash/restart integration test must additionally prove that a process termination between message processing and durable inbox commit cannot lose the message. Recovery after a server-accepted commit followed by process termination before local merge also needs a restart regression.

### 4.2 iOS Protected Keychain

The `apple-native-keyring-store` documentation states that the `protected` store requires a code-signed app with a provisioning profile; otherwise access can fail with entitlement error `-34018`. CI now treats the signing secrets as required. The actual signed iOS runtime test remains unexecuted because the prerequisite CI job did not run.

Reference: https://docs.rs/crate/apple-native-keyring-store/latest

### 4.3 Android native context

The Android store documentation requires initialization of `ndk_context` and loading the library before constructing the native store. The JNI path now propagates initialization errors rather than panicking. Runtime proof is still required on an emulator/device.

Reference: https://docs.rs/crate/android-native-keyring-store/latest/source/README.md

## 5. Acceptance checklist

- [x] Single-executor ownership recorded; no external agent assumed.
- [x] Beta 1.0 scope and approved WBS baseline preserved.
- [x] Native MLS feature gate defaults to disabled.
- [x] Logout attempts database, sidecar and key cleanup independently.
- [x] Inbox replay no longer resets acknowledgement state.
- [x] Concurrent session initialization and handoff are serialized in source.
- [x] Android JNI initialization errors fail closed.
- [x] Invalid event IDs and MLS processing errors are no longer silently consumed.
- [x] iOS Protected Keychain CI gate no longer accepts a skipped runtime test.
- [ ] Rust/OpenMLS tests executed and green on the current final SHA.
- [ ] FRB generation and Rust bridge tests executed and green.
- [ ] Flutter analyze and Flutter tests executed and green.
- [ ] Android APK build and Android Keystore runtime test executed and green.
- [ ] iOS device/simulator builds executed and green.
- [ ] Signed iOS Protected Keychain runtime test executed and green.
- [ ] Crash/restart atomicity regression for MLS state + inbox passes.
- [ ] Full Stage 4 acceptance matrix green on one exact final SHA.
- [ ] Native MLS feature flag enabled only after the complete acceptance gate.

**Acceptance status:** NOT ACCEPTED.  
**Verified green Stage 4 required workflows:** 0 of 2 executed workflow gates.  
**Stage 4 acceptance progress:** 0% of the required verification gate is accepted; implementation changes are present but unverified.  
**Beta 1.0 overall progress:** unchanged from the approved WBS baseline.

## 6. Next five tasks — sole executor

1. Resolve the GitHub Actions no-runner condition or obtain a working authorized runner; preserve exact evidence and do not infer a billing or policy cause.
2. Design and implement atomic/recoverable persistence for OpenMLS ratchet state and decrypted inbox; add crash injection and restart tests.
3. Run and fix Rust/OpenMLS, FRB, Flutter analyze/tests, and Android build/runtime checks on the exact branch head.
4. Run iOS device/simulator builds and signed Protected Keychain runtime validation using the required repository secrets.
5. Run the complete Stage 4 acceptance matrix on one final SHA, update this report and continuity files with observed results, then request owner review. Do not merge or enable the native MLS flag before acceptance.

## 7. Actions performed

- Source files and workflows inspected through the GitHub repository connector.
- Code changes committed to the Stage 4 branch.
- GitHub Actions runs inspected, including job metadata and rerun attempts.
- No source test command was successfully executed in this environment because the GitHub jobs never received a runner.
- No PR was merged; no deployment, server, database or paid Codespace was started.


## 8. Post-report CI recheck — 2026-11-11

After the report and continuity files were committed, the current PR head advanced to `87089c610e03ba5302b316db07baa2d44d71260a`. The source-code changes remain at `048db63a7817b28e38a3a8353f8665a713f56730`; the later commits update reports/continuity only.

Latest CI recheck on the updated PR head:

- [OpenMLS client run #42976768215](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42976768215): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42976768182](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42976768182): FAILED before step 1; `runner_id=0`; `steps=[]`.
- iOS dependent job in run #42976768182: SKIPPED because the FRB prerequisite failed.
- [Flutter mobile validation run #42976768225](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42976768225): SKIPPED by the Stage 4 branch condition.

The runner-allocation failure persists on the documentation-updated PR head. No Rust, Flutter, Android or iOS test step executed. Stage 4 remains NOT ACCEPTED.


## 9. Latest source/CI state — 2026-11-11

The source head advanced to `e4133120d59ea833dd010bdaa10a7f7a4f281375` after the atomic persistence, pending-commit and restart-reconciliation changes. This SHA contains product source changes; later report commits may advance the branch without changing the source.

Latest runs on `c8ba8f99c45cd532b0941fd774304b6763429511`:

- [OpenMLS client validation #42977451436](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977451436): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [Flutter Rust Bridge generation #42977451456](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977451456): FAILED before step 1; `runner_id=0`; `steps=[]`.
- iOS dependent job in #42977451456: SKIPPED because the prerequisite failed.
- [Flutter mobile validation #42977404079](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977404079): SKIPPED by the Stage 4 branch condition.

The no-runner condition persists. No Rust/Flutter/Android/iOS command executed. Stage 4 remains NOT ACCEPTED.


## 10. Latest restart-reconciliation CI recheck — 2026-11-11

Source head: `e4133120d59ea833dd010bdaa10a7f7a4f281375`.

- [OpenMLS client run #42977699906](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977699906): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42977699954](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977699954): FAILED before step 1; `runner_id=0`; `steps=[]`; iOS dependent job SKIPPED.
- A rerun of the OpenMLS client job, [#42977708226](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977708226), again failed before step 1 with `runner_id=0` and no steps.
- FRB rerun [#42977708143](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977708143) remained queued at the time of inspection.

No source test command executed. Stage 4 remains NOT ACCEPTED.


## 11. Logout concurrency hardening and latest CI — 2026-11-11

Source head: `404775ff54c5e8a5eee175eb8d908c6c6929e2c0`.

Logout now serializes against an in-flight login, session restoration, MLS handoff and token refresh. New login/adoption/API requests are rejected while logout is active. In-memory credentials are cleared even if secure-storage identity deletion fails. A regression test covers logout during a blocked native handoff.

Latest CI:
- [OpenMLS client run #42977937179](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977937179): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42977937116](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977937116): FAILED before step 1; `runner_id=0`; `steps=[]`; iOS dependent job SKIPPED.
- Flutter mobile validation #42977937100: SKIPPED by Stage 4 branch condition.

No Rust or Flutter test command executed. Stage 4 remains NOT ACCEPTED.


## 12. Welcome ACK and SQLCipher key-recovery hardening — 2026-11-11

Source head: `da844b08240c3e67762997be9b65d8e91cab120f`.

- Welcome processing now stores a local pending-ACK marker in the same transaction as the OpenMLS group and room index. If ACK fails or the process stops after local commit, the next sync retries the ACK rather than processing the same Welcome again.
- The KeyStore contract now distinguishes reading an existing SQLCipher key from creating one. Session resume uses only the existing-key path and fails closed when the key is missing; it never writes a replacement key over an existing encrypted database.
- New session creation rejects a database/KeyStore mismatch before attempting key creation. Failed first-time session construction attempts to remove partial database artifacts and the newly created platform key.
- Added tests for missing-key resume, existing database without key, and SQLCipher sidecar detection. Tests are committed but not executed.

Latest CI on source SHA `da844b08240c3e67762997be9b65d8e91cab120f`:
- [OpenMLS client run #42978533658](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42978533658): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42978533643](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42978533643): FAILED before step 1; `runner_id=0`; `steps=[]`; iOS dependent job SKIPPED.
- Flutter mobile validation #42978533518: SKIPPED by Stage 4 branch condition.

No source tests executed. Stage 4 remains NOT ACCEPTED.


## 13. CI recheck after key-recovery changes — 2026-11-11

The current PR head after report/continuity updates is `24e9a15e1fbc8446a18e68c84a779abe7a865729`; product source remains `da844b08240c3e67762997be9b65d8e91cab120f`.

- [OpenMLS client run #42978646222](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42978646222): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42978646245](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42978646245): FAILED before step 1; `runner_id=0`; `steps=[]`; iOS dependent job SKIPPED.
- [Flutter mobile validation #42978646254](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42978646254): SKIPPED by the Stage 4 branch condition.

The no-runner failure persists. No source tests or platform builds executed. Stage 4 remains NOT ACCEPTED.


## 14. Logout/key-handling follow-up and latest CI — 2026-11-11

Current source head: `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab`.

Additional hardening:
- Rust logout now catches a panic during remote logout and recovers a poisoned client mutex so local database/sidecar and platform-key cleanup still runs. A poisoned-lock regression was added.
- Dart transfers refresh-token ownership to Rust immediately after native open succeeds, before requesting the access-token snapshot.
- Rust bridge initialization no longer permanently caches a failed `RustLib.init()` future.

Latest CI:
- [OpenMLS client run #42979003433](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979003433): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42979003356](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979003356): FAILED before step 1; `runner_id=0`; `steps=[]`; iOS dependent job SKIPPED.

No tests executed. Stage 4 remains NOT ACCEPTED.


## 15. CI recheck on current PR head — 2026-11-11

Current PR #45 head: `ca49b376a65766fb59e792cf2097ba7b4f2b50ce`. Product source head remains `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab`.

- [OpenMLS client run #42979080737](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979080737): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42979080732](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979080732): FAILED before step 1; `runner_id=0`; `steps=[]`; iOS dependent job SKIPPED.
- [Flutter mobile validation #42979080672](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979080672): SKIPPED by Stage 4 branch condition.

The exact runner allocation failure remains unknown. No test command or platform build ran. Stage 4 remains NOT ACCEPTED.


## 16. Secret-memory zeroization — 2026-11-11

Source head: `3d4e64d4f302f7ddbe417903ede4dd4443b10975`.

- Rust session tokens now live in a `SessionTokens` type that zeroizes both strings on drop.
- SQLCipher key buffers use RAII zeroization during new-session creation and resume.
- Keyring secret byte buffers are zeroized after checking or copying; failed key generation/storage also zeroizes temporary key material.
- MemoryKeyStore removes and zeroizes keys.
- Serialized token pairs, request bodies, authorization header copies and token refresh response values are zeroized after use.
- Access/refresh token strings received at the Rust FFI open-session boundary are wrapped in `Zeroizing` immediately.
- Key presence checks return a boolean without copying key material.

Latest CI on source SHA `3d4e64d4f302f7ddbe417903ede4dd4443b10975`:
- [OpenMLS client run #42979859714](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979859714): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42979859709](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979859709): FAILED before step 1; `runner_id=0`; `steps=[]`; iOS dependent job SKIPPED.
- Flutter mobile validation #42979859767: SKIPPED by Stage 4 branch condition.

No tests executed. Stage 4 remains NOT ACCEPTED.


## 17. CI recheck on current PR head — 2026-11-11

Current PR #45 head: `c103cc2ae4eaa9e3ce721101f3581f3b6047e138`. Product source head: `3d4e64d4f302f7ddbe417903ede4dd4443b10975`.

- [OpenMLS client run #42979954916](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979954916): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [FRB generation run #42979955089](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979955089): FAILED before step 1; `runner_id=0`; `steps=[]`; iOS dependent job SKIPPED.
- [Flutter mobile validation #42979954833](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42979954833): SKIPPED by Stage 4 branch condition.

No tests executed on the current PR head. Stage 4 remains NOT ACCEPTED.


## 18. Owner instruction — single executor and Beta 1.0 scope

- Owner explicitly confirmed that ChatGPT is the sole developer and executor for the current work. No external agent is assigned or assumed. An agent may be used only after the owner explicitly notifies that one is available.
- Current product stage is **Beta 1.0**. Stage 4 work and acceptance must remain within the approved Beta 1.0 scope and WBS v1.1. Do not treat Beta 2.0/future modules as current acceptance scope.
- The full Stage 4 responsibility includes code review, implementation, Rust/OpenMLS, Flutter/FRB, Android/iOS, secure storage, session recovery, inbox/outbox, API/UI integration, tests, CI, security and repository archive.
- No Beta 1.0 WBS weight or baseline percentage was changed.

## 19. Source corrections and security hardening — 2026-11-11

Current PR #45 head after these commits: `84248642e05e03c976a6f8d0eae0a9ab03a64765`.

Changes committed to the existing Stage 4 branch:

1. Fixed a confirmed Rust compile defect in `mobile/rust/src/api/session.rs`: cleanup referenced undeclared `existing_key`; it now uses the established `has_existing_key` state.
2. Removed the duplicate `path_provider: ^2.1.5` dependency declaration from `mobile/pubspec.yaml`.
3. Changed native key-store initialization so transient Android Keystore/iOS Keychain initialization errors are not permanently cached as a failed `OnceLock<Result<...>>`.
4. Changed Android JNI application-context initialization so a failed attempt is not permanently cached; later initialization calls can retry.
5. Added Rust API-origin validation: HTTPS is required for non-local endpoints; HTTP is permitted only for private/loopback hosts in debug builds. URL credentials, query strings and fragments are rejected.
6. Applied the same HTTPS/local-debug policy in Flutter `ApiClient`; release builds without an explicit HTTPS endpoint resolve to an unconfigured API origin and fail closed.
7. Disabled automatic HTTP redirects in Rust `ureq` and Flutter `http` clients to prevent bearer credentials from being forwarded to another origin.
8. Added Rust and Flutter regression tests for API-origin policy and a Flutter assertion that bearer requests do not follow redirects.
9. Updated mobile setup documentation and corrected API bridge comments about decrypted inbox history and acknowledgement retention.

These changes are **implemented but not test-verified**. No test is marked passed based only on source inspection.

## 20. CI and execution evidence on current PR head

Exact PR #45 head: `84248642e05e03c976a6f8d0eae0a9ab03a64765`.

- [OpenMLS client validation #42981617948](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42981617948): conclusion FAILED. Job `130393121153` has no step summaries; log download returned `BlobNotFound`.
- [OpenMLS Flutter Rust Bridge generation #42981617913](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42981617913): conclusion FAILED. Job `130393121034` has no step summaries; log download returned `BlobNotFound`. Dependent iOS Keychain job was SKIPPED.
- [Flutter mobile validation #42981617907](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42981617907): SKIPPED by the workflow's Stage 4 branch condition. Flutter analyze/tests and Android smoke coverage are expected in the FRB workflow, which failed before a step ran.

The exact GitHub runner/job failure cause is UNKNOWN. No source-level or billing/policy explanation is inferred. The official GitHub status page showed all systems operational at the time checked; this does not identify the repository-specific job failure.

Local execution capability check:
- Available: Node.js 22, npm 10, Java 21.
- Unavailable: `rustc`, `cargo`, `flutter`, `dart`, `xcodebuild`.
- Therefore no local Rust, Flutter, Android or iOS tests/builds were run.

## 21. Acceptance and next gate

- Stage 4 remains **NOT ACCEPTED**.
- No green test result is claimed for the commits listed in section 19.
- No Beta 1.0 percentage is increased; the approved WBS v1.1 baseline remains unchanged.
- Next gate: make the repository's GitHub Actions jobs executable and expose full logs, then run the complete matrix on one exact final SHA. Continue code review and add missing crash/restart tests for incoming persistence, Welcome ACK recovery and server-accepted commits before acceptance.
- Do not merge PR #45, enable `INONE_MLS_NATIVE_ENABLED`, or claim production readiness until every required platform/security gate is green.


## 22. Acceptance checklist and objective completion status

### Source changes committed

- [x] Fix confirmed undeclared Rust identifier in native session open/cleanup.
- [x] Remove duplicate `path_provider` dependency.
- [x] Make platform key-store initialization retryable after errors.
- [x] Make Android JNI context initialization retryable after errors.
- [x] Enforce HTTPS outside local/private debug endpoints in Rust and Flutter.
- [x] Reject API-origin credentials, query and fragment.
- [x] Disable automatic redirects for credential-bearing API requests.
- [x] Add regression tests for API-origin policy and redirect behavior.
- [x] Document transport policy and update repository continuity/archive.

### Acceptance work not yet verified

- [ ] Run `cargo test --locked` for OpenMLS client and all integration tests.
- [ ] Run Rust formatting/lint checks for the affected crates.
- [ ] Generate and validate Flutter Rust Bridge bindings.
- [ ] Run `flutter analyze` and complete Flutter unit/widget tests.
- [ ] Build Android APK and execute Android Keystore runtime smoke tests.
- [ ] Build/sign iOS app and execute Protected Keychain runtime smoke tests.
- [ ] Execute crash-injection/restart test for MLS ratchet state + inbox transaction.
- [ ] Execute duplicate-delivery and durable-ACK-after-restart tests.
- [ ] Execute Welcome join/ACK retry after process restart.
- [ ] Execute recovery after server accepted invite/revocation commit but process stopped before local merge.
- [ ] Execute missing-key, wrong-key, database/sidecar cleanup and logout recovery tests.
- [ ] Run the full required matrix green on one exact final SHA.

### Objective status (no invented weighting)

- Source-level fixes committed in this pass: 9 checklist items.
- Required workflow runs on source SHA `84248642e05e03c976a6f8d0eae0a9ab03a64765`: 0 green, 2 failed before exposing any step result; Flutter mobile workflow skipped by branch condition; dependent iOS job skipped.
- Rust/Flutter/Android/iOS test commands executed in this pass: 0.
- Stage 4 acceptance: **0% verified / NOT ACCEPTED**.
- Stage 4 implementation percentage: **not assigned** because the approved WBS v1.1 does not define a separately weighted Stage 4 denominator. Do not invent one.
- Beta 1.0 overall baseline remains the approved WBS v1.1 value; no progress percentage is increased in this report.


## 23. Credential-retention hardening — 2026-11-11

- Rust `connect` now zeroizes the login JSON response immediately after extracting the access/refresh pair.
- Rust `connect_with_approval` now zeroizes both the initial login/approval response and each approval-claim response; one-time code and poll secret are held in `Zeroizing<String>`.
- Flutter `InOneSession.login` no longer returns access tokens, refresh tokens, approval codes, poll secrets or approval IDs to callers/UI. The original response map's secret fields are cleared after the session copies them into its owner fields.
- Flutter refresh response secret fields are cleared after the session accepts the new pair.
- Flutter `ApiClient` clears request-body bytes and removes the bearer header from request/header maps after sending; redirect following remains disabled.
- Added a Flutter regression assertion that login results do not expose token or device-approval secrets.

Current PR/source head at this entry: `6e56671b632c993ebd15735caf5001ad2662012a`. These source changes are not test-verified.

Latest CI on this exact head:
- [OpenMLS client #42982066347](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42982066347): FAILED; job `130394540439` returned `steps=null` and `logs_url=null`.
- [FRB generation #42982066366](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42982066366): FAILED; job `130394540623` returned `steps=null` and `logs_url=null`; dependent iOS job SKIPPED.
- [Flutter mobile #42982066410](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42982066410): SKIPPED by the Stage 4 branch condition.

No test command is evidenced as executed. Exact GitHub job failure cause remains UNKNOWN. Stage 4 remains 0% verified / NOT ACCEPTED.


## 24. P0 recovery parity audit — critical Stage 4 gap

The active mobile client was compared directly with the accepted P0 reference implementation and its acceptance map:

- Active client: `inone-engine-poc-0.6.0/mobile-mls/mls-client/src/lib.rs`.
- P0 reference: `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/src/lib.rs`.
- Acceptance map: `inone-development-archive-0.6.0/engine/mobile-mls/P0-ACCEPTANCE-MAP.md`.
- P0 closure: `development/recovered-source/P0-CLOSURE-2026-11-08.md`.

Confirmed differences:

1. Active mobile client does not contain durable `client_welcome_receipts` or `retry_pending_welcome_acks`; it uses the simpler `client_welcomes` marker.
2. Active mobile client does not contain `client_membership_commits`, exact staged-Commit fingerprint validation or `client_invite_intents`.
3. Active mobile client does not contain durable `client_key_package_claims` replay state.
4. Active mobile client does not contain `client_waiting_for_commit` or `client_commit_quarantine`.
5. Active mobile client does not contain sticky room-scoped `RecoveryRequired` / desync state.
6. Active `invite` uses `GET /mls/key-packages/{userId}`; the accepted P0 design uses durable claim IDs and reservation/replay semantics.
7. Active client lacks the archived F1/F4/F5/P0.3 regression targets: Welcome receipt retry/quarantine, membership journal replay/fingerprint mismatch, event identity validation, WaitingForCommit and Commit quarantine.

The P0 closure explicitly says native Flutter Beta 1.0 integration is separate. Therefore the archived code is a reference for porting accepted invariants, not proof that the active mobile client already contains them.

**Impact:** Stage 4 is not functionally complete while these recovery/idempotency guarantees are absent from the active mobile runtime. Do not accept Stage 4 based only on SQLCipher, key-store and bridge work.

### Required port and verification

- [ ] Port F1 durable Welcome receipts, duplicate handling, quarantine and ACK retry after restart.
- [ ] Port F4 membership journal, exact Commit fingerprint, idempotent replay and safe rebase.
- [ ] Port F5 event identity/epoch validation before processing or marking events.
- [ ] Port P0.3 room-scoped WaitingForCommit, Commit quarantine and sticky RecoveryRequired.
- [ ] Port KeyPackage claim/replay using durable client claim intent and server reservation IDs.
- [ ] Preserve the active transaction-backed OpenMLS provider and SQLCipher storage; do not regress the newer secure-key and token-zeroization work.
- [ ] Adapt and execute archived regression scenarios in the active mobile client test harness.
- [ ] Verify API compatibility against the current Beta 1.0 backend contract and PostgreSQL implementation.

This is a source-review finding; no port or test pass is claimed yet. Current CI remains blocked before test steps as recorded above.


## 25. Single-executor re-audit and corrective update — 2026-11-11

**Owner instruction:** Beta 1.0 is the active stage. ChatGPT is the sole developer/executor. No external agent is assigned or assumed.

### 25.1 Correction to the P0 parity audit in section 24

Section 24 is superseded. A fresh inspection of the current Stage 4 branch shows that the previously reported missing P0 mechanisms are present in the active mobile MLS client:

- `client_welcome_receipts`, durable Welcome receipt persistence and pending ACK retry.
- `client_membership_commits`, membership journal replay and staged-Commit fingerprint verification.
- `client_invite_intents` and durable KeyPackage claim/reservation replay.
- `client_waiting_for_commit`, room-scoped WaitingForCommit state.
- `client_commit_quarantine`, Commit quarantine and RecoveryRequired handling.
- Event identity validation and transaction-backed MLS/inbox persistence.

The following six active test files were compared with the accepted P0 archive. Each pair has the same Git blob SHA, so these files are byte-identical at the checked revision:

| Active test | Verified blob SHA |
|---|---|
| `welcome_receipt_recovery.rs` | `61b13f2433682ad8e1252629bc496155fadd0989` |
| `welcome_recovery.rs` | `31bfa5b627a793ca0dc8cc911c989781ff3bb733` |
| `membership_journal.rs` | `9485f218b2430f13deea358f09b58fa0c89aac6c` |
| `commit_quarantine.rs` | `76adee3e3f64e427b2a8da9a8a844f6d28a66537` |
| `waiting_for_commit.rs` | `b3affa76f4da34056f3c1d170bb9fcc865df908c` |
| `consistency.rs` | `d474c214145b3ead7608f59359567ec30311fa19` |

Therefore, do not port these mechanisms again. Section 24's claim that they are absent was based on an earlier source revision and is no longer valid. Presence and blob parity are source-level evidence only; they do not establish that the tests pass on the current branch.

### 25.2 Additional local-purge safety correction

At source commit `4670646558723ae5b33eeffdaa105f3a6df209ed`, `mobile/rust/src/api/session.rs` was changed so local SQLCipher database and sidecar deletion is still attempted when Android Keystore/iOS Keychain initialization fails.

- Database, WAL, SHM and journal removal are attempted independently of secure-store initialization.
- Failure to initialize the secure store remains an explicit error; key deletion is not claimed.
- Added regression test `purge_removes_database_even_when_platform_key_store_initialization_fails`.

The changed source file was fetched again from GitHub; the helper and regression test are present. The test has **not** executed.

### 25.3 Current PR and CI evidence

- PR #45 remains OPEN/Draft; product merge is not authorized.
- Product source correction commit: `4670646558723ae5b33eeffdaa105f3a6df209ed`.
- A documentation correction followed in commit `412dfb010968f18fe90f5c92aacfe9ce6e97341c`.
- The latest available earlier-head reruns were:
  - OpenMLS client run [#42985487129](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42985487129): rerun completed FAILED; job steps/log URL unavailable.
  - FRB generation run [#42985487107](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42985487107): rerun completed FAILED; job steps/log URL unavailable; dependent iOS job SKIPPED.
  - Flutter mobile run [#42985487102](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42985487102): SKIPPED by the explicit Stage 4 branch condition.
- GitHub returned no workflow-run records for source commit `4670646558723ae5b33eeffdaa105f3a6df209ed` through the current connector. No CI result is claimed for that commit.
- The local execution environment has no `rustc`, `cargo`, Flutter, Dart or Xcode. A Git clone attempt failed because the environment cannot resolve external network hosts. No local build/test command was executed.

### 25.4 Newly verified iOS CI gap

The current `.github/workflows/openmls-frb-codegen.yml`:
- builds the iOS device and simulator targets with `--no-codesign`;
- runs the protected-store integration test on an iOS simulator;
- does not reference or import the signing certificate, password, provisioning profile or team ID described in earlier reports.

The iOS job therefore does not currently establish the signed Protected Keychain acceptance requirement. The upstream `apple-native-keyring-store` documentation states that the `protected` store requires a code-signed application with a provisioning profile and that unsigned use can fail with entitlement error `-34018`: https://github.com/open-source-cooperative/apple-native-keyring-store

This is a confirmed workflow/documentation mismatch. The iOS signing and runtime gate must be implemented and executed before iOS Protected Keychain can be accepted. The previous README claim that the workflow already fails closed on missing signing secrets was corrected in this branch.

### 25.5 Generated bridge artifacts are not yet committed

The following paths were checked on the current Stage 4 branch and returned 404:
- `mobile/lib/src/rust/frb_generated.dart`
- `mobile/lib/src/rust/api/session.dart`
- `mobile/hook/build.dart`
- `mobile/rust/src/frb_generated.rs`
- `mobile/rust/Cargo.lock`

The current `mobile/pubspec.lock` also contains neither `flutter_rust_bridge` nor `flutter_rust_bridge_hooks`. These outputs/dependencies are currently expected to be generated by the FRB workflow, but that workflow has not executed successfully. The mobile README now documents the exact pinned generation sequence and does not present a clean-checkout `flutter pub get` as sufficient before generation.

### 25.6 Acceptance status and next work

- Beta 1.0 WBS v1.1 remains unchanged.
- No Beta 1.0 overall percentage is increased.
- Stage 4 verification: **0% verified**; no required current-head test has a green execution record.
- Stage 4 status: **NOT ACCEPTED**.
- `INONE_MLS_NATIVE_ENABLED` remains `false`.
- No merge, deployment, database operation or external agent activity occurred.

Next:
1. Restore a working GitHub Actions runner or provide an authorized build environment; exact reason for the repeated no-step failures remains UNKNOWN.
2. Generate and commit FRB Dart/Rust bindings, build hook and Rust lockfile; validate the generated code on the resulting exact SHA.
3. Correct the iOS signing/provisioning workflow and execute the Protected Keychain runtime test in a supported signed environment.
4. Execute Rust/OpenMLS, FRB, Flutter, Android Keystore, iOS and persistence/restart regressions on one exact final SHA.
5. Update acceptance and Beta 1.0 WBS evidence only after the complete required matrix is green. Do not merge PR #45 or enable native MLS before owner approval.


## 25. Stage 4 native MLS hardening — implementation update (2026-11-11)

Implementation changes now present in this branch include membership reconciliation and P0.2 staged Commit metadata verification; durable membership Commit journal and idempotent KeyPackage claims; stale-epoch rebase; journaled revoked-device removal; durable Welcome receipts/ACK retry; WaitingForCommit persistence; Commit quarantine; late-event/unreadable handling; event/API response validation; per-room outbox isolation; and Rust/Flutter recovery diagnostics.

Platform storage remains Android Keystore / iOS Keychain with no plaintext fallback. The native logout integration test now verifies local SQLCipher/key deletion even when the server endpoint is unreachable. The signed iOS protected-Keychain smoke test remains conditional on signing secrets and is not counted as passed when skipped.

Evidence and exact CI state are recorded in `development/reports/2026-11-11-stage-4-native-mls-hardening-progress.md`. Latest source HEAD: `df53ff48a42d9b9ca1dc7b19f049f8f3b05585a6`.

**Verification:** OpenMLS run #42986269774 and FRB run #42986269879 concluded failure, but job step summaries/logs were unavailable (`BlobNotFound`). Flutter mobile job #42986269746 was skipped by workflow branch condition. No local Cargo/Rust toolchain is available in this execution environment. Therefore tests are NOT VERIFIED; no PASS or 100% claim is made.

**Acceptance:** Stage 4 NOT ACCEPTED / BLOCKED. Beta 1.0 WBS v1.1 baseline unchanged (42% implementation / 31% verification). Next gate is inspectable full CI on one exact final SHA.


## 26. CI privilege isolation and exact-SHA acceptance workflow — 2026-11-11

### 26.1 Workflow security and reproducibility changes

The FRB workflow was refactored in source:

- Workflow default token permission is now `contents: read`.
- Code generation, compilation and test execution run in the read-only job.
- Only the dedicated `commit-generated` job receives `contents: write`.
- The write job does not execute PR scripts. It downloads the generated artifact, rejects symlinks, copies only the allowlisted generated bridge files/lockfiles, and pushes to the Stage 4 branch without force.
- The generated commit's exact SHA is exported.
- A separate read-only `verify-final-sha` job checks out that exact SHA and reruns Rust formatting, Rust bridge tests, persistent OpenMLS integration tests against the P0 engine fixture, Flutter analyze/tests, Android APK build and Android Keystore runtime smoke test.
- The iOS job depends on the exact-SHA verification and checks out the same final SHA.

This prevents the generated-file write token from being exposed to the code-execution job and prevents the final acceptance matrix from relying only on the pre-generation PR SHA.

### 26.2 Signed iOS gate

The iOS workflow now:
- fails if any required signing secret is absent;
- imports the Apple Development certificate and provisioning profile using macOS-compatible `base64 -D`;
- validates certificate team, profile team, app identifier, keychain access group and profile expiry;
- configures manual signing for the generated Runner project;
- runs the Protected Keychain integration smoke test;
- verifies the simulator app signature and signed entitlements;
- removes temporary certificate/profile/keychain material after the job.

This is a source-level workflow change only. It has not yet executed successfully; simulator behavior with the protected store remains unverified. A physical-device test is also not claimed.

### 26.3 Exact CI status on latest PR head

Latest PR #45 head at this report update: `56102098427b8853b746b94d8c073c5aa97d0c2c`.

| Workflow | Run | Result | Job evidence |
|---|---:|---|---|
| OpenMLS client validation | [42987007179](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987007179) | FAILURE | `steps=null`, `logs_url=null`; log retrieval returned BlobNotFound |
| OpenMLS Flutter Rust Bridge generation | [42987007308](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987007308) | FAILURE | `generate-and-validate` has `steps=null`, `logs_url=null`; downstream commit, final-SHA and iOS jobs SKIPPED |
| Flutter mobile validation | [42987007363](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987007363) | SKIPPED | Explicit Stage 4 branch condition |

The failed jobs exposed no executable step summaries or usable logs. The exact cause remains UNKNOWN. No test command is evidenced as executed. The current PR head has no green test result.

### 26.4 Remaining generated artifacts

Generated FRB files and lockfiles remain absent because the generation job did not execute:
- `mobile/lib/src/rust/frb_generated.dart`
- `mobile/lib/src/rust/api/session.dart`
- `mobile/hook/build.dart`
- `mobile/rust/src/frb_generated.rs`
- `mobile/rust/Cargo.lock`

The new write/verify workflow is designed to generate and commit these files, then test the exact resulting SHA. It has not yet completed.

### 26.5 Current acceptance

- Stage: Beta 1.0 only.
- WBS v1.1 baseline: unchanged.
- Stage 4 verification accepted: **0%**.
- Stage 4: **NOT ACCEPTED / BLOCKED**.
- `INONE_MLS_NATIVE_ENABLED=false`.
- PR #45 remains Draft and unmerged.
- No source/test pass is claimed from a failed job with no steps/logs.

**Required owner-side unblock:** provide a working GitHub Actions execution path or an authorized Rust/Flutter/macOS build runner. The exact reason GitHub creates failed jobs without steps/logs cannot be determined from the available API evidence. Do not guess billing, runner, permission or policy causes.


## 27. Protected iOS signing environment and latest run status — 2026-11-11

### 27.1 Signing-secret protection

The iOS job now declares GitHub Environment `ios-signing`. The repository owner must configure this environment with required reviewers and these environment secrets (do not paste their values into chat):

- `IOS_SIGNING_CERTIFICATE_P12` — base64-encoded P12.
- `IOS_SIGNING_CERTIFICATE_PASSWORD`.
- `IOS_PROVISIONING_PROFILE` — base64-encoded provisioning profile.
- `IOS_TEAM_ID`.

This keeps the signing job behind environment approval rather than exposing signing material to the read-only code-generation and test jobs. The README documents this configuration. Whether the environment and secrets are configured is UNKNOWN; only the repository owner can verify the settings.

### 27.2 Latest observed CI

- PR #45 head when the latest full run was triggered: `5e3a9dc7644bb9e2eb462a41de345b4ff9f7df3c`.
- [OpenMLS client #42987334965](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987334965): FAILURE; job `steps=null`, `logs_url=null`; log retrieval unavailable.
- [FRB generation #42987334938](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987334938): FAILURE; `generate-and-validate` has no steps/log URL; generated commit, final-SHA and iOS jobs SKIPPED.
- [Flutter mobile #42987335071](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987335071): SKIPPED by branch condition.
- After this run, the mobile README was updated to list the exact protected environment secrets. Latest PR head is now `b0f05abc74ab67910d66f31e7cdd18c01528bb97`; the connector returned no workflow-run records for this SHA at the time of this report update.

The repeated failures expose no step summary or job log. Their root cause remains UNKNOWN; no source-level diagnosis is asserted.

### 27.3 Acceptance

- Current product stage remains Beta 1.0.
- Stage 4 verification accepted remains 0%; NOT ACCEPTED / BLOCKED.
- The codegen outputs remain absent until the generation job runs.
- Keep `INONE_MLS_NATIVE_ENABLED=false`; no merge.
- Owner-side unblock: provide an executing GitHub Actions runner/build environment and configure the protected `ios-signing` environment. No test result can be manufactured from source review alone.


## 28. Latest exact-head CI check — 2026-11-11

Latest PR #45 head: `e8f50e566d1095ed7ad6ed9427abb5d666b5097b`.

CI was triggered on this exact SHA:

| Workflow | Run | Result | Evidence |
|---|---:|---|---|
| OpenMLS client validation | [42987463963](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987463963) | FAILURE | Job `130411972408`: `steps=null`, `logs_url=null`; log download returned `BlobNotFound` |
| FRB generation | [42987464006](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987464006) | FAILURE | Job `130411972791`: `steps=null`, `logs_url=null`; log download returned `BlobNotFound`. Generated commit, final-SHA verification and iOS jobs SKIPPED |
| Flutter mobile | [42987463998](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42987463998) | SKIPPED | Explicit Stage 4 branch condition |

The combined status API returned no status entries for this SHA. No test command is evidenced as executed. The exact job-start failure message is not available through the current GitHub connector, so its cause remains UNKNOWN.

**Current acceptance:** Stage 4 NOT ACCEPTED / BLOCKED; 0% verification accepted. Keep the native MLS feature gate disabled. Owner must provide the exact job-level failure message from the GitHub Actions UI or restore an authorized runner. Do not infer a root cause from the absence of logs.


## 29. Logout fail-closed hardening and regression additions — 2026-11-11

### 29.1 Rust logout behavior

`Client.logout` now attempts the server logout, then always:
- deletes the locally persisted `session_tokens` row from SQLCipher;
- clears the in-memory access/refresh token pair, including when the token mutex is poisoned;
- zeroizes the logout response value;
- returns an explicit error distinguishing server logout failure from local token deletion failure.

A new regression test `logout_clears_local_session_tokens_when_server_is_unavailable` builds a client against an unreachable loopback endpoint and checks that the in-memory access token and SQLCipher session-token row are cleared despite the server error.

### 29.2 Flutter logout behavior

`InOneSession.logout` now clears the persisted MLS user identity after every explicit logout attempt, even when native purge fails. If an MLS identity exists but native runtime/device identity is unavailable, logout returns an explicit error rather than silently succeeding. This prevents the app from automatically attempting to resume the previous MLS session after an explicit logout attempt.

New Dart tests:
- `logout clears saved MLS identity when native purge fails`
- `logout clears saved MLS identity when native runtime is unavailable`

The local SQLCipher DB/key may remain if native purge fails; the app no longer silently auto-resumes that identity. The failure is surfaced to the caller.

### 29.3 Added native persistence regressions

Three additional Rust tests were added:
- `existing_database_with_wrong_protected_key_is_rejected_without_replacement`: verifies a mismatched key does not overwrite the protected key or destroy the existing encrypted database.
- `failed_new_session_initialization_removes_partial_database_and_key`: forces DB open failure after creating a new key and verifies both partial artifacts and the newly-created key are removed.
- `process_crash_rolls_back_openmls_storage_and_inbox_atomically`: child process exits with an open SQLCipher WAL transaction after storing an OpenMLS signature key and an inbox/processed record; parent verifies none of the uncommitted writes survive recovery.

These are test-source additions only. They have not executed.

### 29.4 Latest exact-head CI

PR #45 head: `54711b873349a8adb575f27d9c1fcccebbc49081`.

| Workflow | Run | Result | Evidence |
|---|---:|---|---|
| FRB generation | [42988592622](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42988592622) | FAILURE | `generate-and-validate` job `130415621116`: `steps=null`, `logs_url=null`; log download returned BlobNotFound. Generated commit/final-SHA/iOS jobs SKIPPED |
| OpenMLS client | [42988592592](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42988592592) | FAILURE | Job `130415620536`: `steps=null`, `logs_url=null`; log download returned BlobNotFound |
| Flutter mobile | [42988592656](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42988592656) | SKIPPED | Explicit Stage 4 branch condition |

No test command is evidenced as executed. Exact failure reason remains UNKNOWN.

### 29.5 Acceptance

- Source changes and regression tests are committed, but no new test is marked PASS.
- Stage 4 verification accepted: 0%; NOT ACCEPTED / BLOCKED.
- Beta 1.0 WBS v1.1 unchanged.
- Keep `INONE_MLS_NATIVE_ENABLED=false`; no merge.
- Required next input: exact job-level failure message from GitHub Actions UI for run #42988592622 or #42988592592, or owner-authorized working runner access. No root cause is inferred.


## 30. Owner execution mandate archived in repository — 2026-11-11

- The path referenced by root `AGENTS.md`, `development/AI-AGENT-MANDATE.md`, was missing (GitHub 404) at the start of this work.
- Created `development/AI-AGENT-MANDATE.md` with the owner's current instructions: ChatGPT is the sole executor; no external agent until explicit owner authorization; Beta 1.0 only; no assumptions as facts; acceptance requires all criteria and green tests on one exact SHA; concise evidence-based reports; percentages follow WBS v1.1; reports/checklists are archived in GitHub; no product merge without owner approval.
- Updated `development/WORKING-RULES.md` session-start checklist to read the mandate.
- These are governance/documentation changes only; no product test result or acceptance status changes.
- Current code/test head remains `54711b873349a8adb575f27d9c1fcccebbc49081`; later changes are documentation/governance only. Latest CI on the code/test head is recorded in section 29 and did not execute test steps.


## 31. Latest CI retry after logout regression update — 2026-11-11

The offline logout regression now uses an HTTPS loopback endpoint so it exercises an unreachable server without relying on a non-HTTPS base URL.

Exact code/test head: `5ca865573e7ed8949698ce7eda7d0adbf5f5915a`.

| Workflow | Run | Result | Evidence |
|---|---:|---|---|
| FRB generation | [42988901680](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42988901680) | FAILURE | `generate-and-validate` job `130416646502`: `steps=null`, `logs_url=null`; downstream jobs SKIPPED |
| OpenMLS client | [42988901678](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42988901678) | FAILURE | Job `130416646666`: `steps=null`, `logs_url=null` |
| Flutter mobile | [42988901824](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42988901824) | SKIPPED | Explicit Stage 4 branch condition |

Job-log retrieval returned `BlobNotFound` for the failed jobs. No test command is evidenced as executed. The failure cause remains UNKNOWN.

**Acceptance unchanged:** Stage 4 NOT ACCEPTED / BLOCKED; 0% verification accepted; Beta 1.0 WBS v1.1 unchanged; keep `INONE_MLS_NATIVE_ENABLED=false`.


## 32. Latest exact-head verification after test-name correction — 2026-11-11

The process-exit regression was renamed to `process_crash_rolls_back_openmls_storage_and_inbox_atomically` to describe its actual coverage: an OpenMLS signature-key storage write plus inbox/processed writes inside one uncommitted SQLCipher WAL transaction. It does not claim to mutate an MLS group ratchet.

Latest PR #45 head: `28aa6f488472688ae5d728e18da8ef24910d540d`.

| Workflow | Run | Result | Evidence |
|---|---:|---|---|
| OpenMLS client | [42989119932](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989119932) | FAILURE | Job `130417370301`: `steps=null`, `logs_url=null` |
| FRB generation | [42989119937](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989119937) | FAILURE | Job `130417370534`: `steps=null`, `logs_url=null`; generated commit, final-SHA and iOS jobs SKIPPED |
| Flutter mobile | [42989120066](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989120066) | SKIPPED | Explicit Stage 4 branch condition |

No test command is evidenced as executed; logs are unavailable. Exact job-start failure cause remains UNKNOWN.

**Acceptance:** Stage 4 NOT ACCEPTED / BLOCKED; verification accepted 0%; Beta 1.0 WBS v1.1 unchanged; native MLS disabled.


## 33. Latest CI check on current PR head — 2026-11-11

Latest PR #45 head: `d81e05a794f10aa47e414dcc8d8920ffcd35755e`.

| Workflow | Run | Result | Evidence |
|---|---:|---|---|
| OpenMLS client | [42989207053](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989207053) | FAILURE | Job `130417656507`: no steps/log URL; log retrieval returned BlobNotFound |
| FRB generation | [42989207170](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989207170) | FAILURE | Job `130417656993`: no steps/log URL; log retrieval returned BlobNotFound; generated commit, final-SHA and iOS jobs SKIPPED |
| Flutter mobile | [42989207122](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989207122) | SKIPPED | Job `130417658656` skipped by branch condition |

No test command is evidenced as executed. The current API evidence does not expose the job-start failure message. Exact cause remains UNKNOWN.

**Acceptance:** Stage 4 NOT ACCEPTED / BLOCKED; verification accepted 0%; Beta 1.0 WBS v1.1 unchanged; keep `INONE_MLS_NATIVE_ENABLED=false`.


## 34. Latest CI retry on current PR head — 2026-11-11

Latest PR #45 head: `e7e19ce9de18e6042b36e5bd5f2ae9700796afd1`.

| Workflow | Run | Result | Evidence |
|---|---:|---|---|
| FRB generation | [42989322261](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989322261) | FAILURE | Job `130418031253`: no steps/log URL; log retrieval returned BlobNotFound; downstream jobs SKIPPED |
| OpenMLS client | [42989322167](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989322167) | FAILURE | Job `130418031986`: no steps/log URL; log retrieval returned BlobNotFound |
| Flutter mobile | [42989322186](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989322186) | SKIPPED | Explicit Stage 4 branch condition |

No test command is evidenced as executed. The connector cannot retrieve the job-start failure message; exact cause remains UNKNOWN.

**Acceptance:** Stage 4 NOT ACCEPTED / BLOCKED; verification accepted 0%; Beta 1.0 WBS v1.1 unchanged; native MLS disabled.


## 35. Documentation-only CI trigger reduction and latest exact-head check — 2026-11-11

The FRB workflow's PR path filter now runs the full native matrix only for `.github/workflows/openmls-frb-codegen.yml` and `mobile/**` changes. Documentation-only report/continuity edits no longer launch the native build matrix.

Latest PR #45 head: `bfb87598068239c1107233d930ee79f25ff62d77`.

| Workflow | Run | Result | Evidence |
|---|---:|---|---|
| FRB generation | [42989491362](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989491362) | FAILURE | Job `130418588274`: no steps/log URL; log retrieval returned BlobNotFound; downstream jobs SKIPPED |
| OpenMLS client | [42989491373](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989491373) | FAILURE | Job `130418588173`: no steps/log URL; log retrieval returned BlobNotFound |
| Flutter mobile | [42989491354](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42989491354) | SKIPPED | Explicit Stage 4 branch condition |

No test command is evidenced as executed. The exact job-start failure message remains unavailable through the connector.

**Acceptance:** Stage 4 NOT ACCEPTED / BLOCKED; verification accepted 0%; Beta 1.0 WBS v1.1 unchanged; native MLS disabled.
