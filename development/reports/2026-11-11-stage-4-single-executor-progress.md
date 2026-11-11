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
