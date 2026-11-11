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
| Session concurrency | Serialized concurrent initialization and concurrent native MLS handoff | `b7a9491f2b5bcf3c2c5ac542e285297f836a34dc` |
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

The source head advanced to `c8ba8f99c45cd532b0941fd774304b6763429511` after the atomic persistence and pending-commit changes. This SHA contains product source changes; later report commits may advance the branch without changing the source.

Latest runs on `c8ba8f99c45cd532b0941fd774304b6763429511`:

- [OpenMLS client validation #42977451436](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977451436): FAILED before step 1; `runner_id=0`; `steps=[]`.
- [Flutter Rust Bridge generation #42977451456](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977451456): FAILED before step 1; `runner_id=0`; `steps=[]`.
- iOS dependent job in #42977451456: SKIPPED because the prerequisite failed.
- [Flutter mobile validation #42977404079](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42977404079): SKIPPED by the Stage 4 branch condition.

The no-runner condition persists. No Rust/Flutter/Android/iOS command executed. Stage 4 remains NOT ACCEPTED.
