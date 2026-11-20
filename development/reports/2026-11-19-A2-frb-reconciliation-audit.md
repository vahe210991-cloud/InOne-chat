# A2 — Clean Flutter Rust Bridge generation and Rust/Dart binding reconciliation

**Audit date:** 2026-11-19 (UTC+3)  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base branch / starting SHA:** `main` / `c939634288db1e7105cfe8d6a7182d4469da1dc4`  
**Task branch:** `feature/a2-frb-reconciliation-2026-11-19`  
**Stage status:** IN PROGRESS — source inventory completed; generated-contract and platform verification pending  
**Scope:** Beta 1.0 only. No release-gate or WBS changes.

## 1. Starting state and A1

Live GitHub ref `refs/heads/main` was checked. Its HEAD remains exactly `c939634288db1e7105cfe8d6a7182d4469da1dc4`, the A1 merge commit.

PR [#95](https://github.com/vahe210991-cloud/InOne-chat/pull/95) is CLOSED / MERGED. Its source head was `7aa7e8b9c6e6c13ed5eb497b48732ece60407c5c`; merge commit is the current `main` HEAD. A1 is not repeated.

### Post-merge A1 workflow runs

All three runs target merge SHA `c939634288db1e7105cfe8d6a7182d4469da1dc4`. At the latest inspection:

| Workflow | Run | Observed state | Evidence |
|---|---:|---|---|
| Native MLS validation | [44519837539](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44519837539) | IN PROGRESS / not concluded | OpenMLS client and Rust bridge host jobs completed successfully; iOS Keychain target job remained queued |
| Flutter iOS validation | [44519837547](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44519837547) | QUEUED | iOS job had not started |
| Flutter mobile validation | [44519837614](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44519837614) | IN PROGRESS | Flutter setup, generated platform projects, Rust targets, codegen installation and FRB integration passed; typed binding generation was still running; later checks had not started |

**A1 post-merge verification is not yet PASS.** No run has `conclusion: success` at this snapshot. PR #95's successful PR-head checks are separate evidence and do not replace these post-merge runs.

## 2. Parallel work and collision controls

Two open draft PRs modify files inside the A2 scope:

- [PR #90](https://github.com/vahe210991-cloud/InOne-chat/pull/90), head `9291b3939e663784d5489c98a81593fd57749ab8`, branch `fix/g2-mls-ffi-hardening-2026-11-19`.
- [PR #94](https://github.com/vahe210991-cloud/InOne-chat/pull/94), head `ce47f732cc4d7dd34a66e7d0b9e8be57c9da11a3`, branch `fix/android-path-provider-jni-smoke-2026-11-19d`, stacked on PR #90.

Both branches have merge-base `a174f794535ab09699d38292acb4919308873fd7` with current main and are 30 commits behind current main. PR #90 changes the Rust session API, pubspec lock, Dart interface/adapter and Flutter workflow; PR #94 changes the Rust crate entrypoint, Android storage initialization, Dart adapter and FRB codegen workflow.

These changes are preserved, not overwritten. A2 source edits to overlapping files are deferred until the parallel changes are reconciled against current main. This audit branch is based on current main at A1 merge SHA, not on either stale PR branch.

## 3. Rust public FFI API inventory

Source: `mobile/rust/src/api/session.rs`. The source declares 30 public functions: 26 methods on opaque `MlsSession`, three free functions and one FRB initializer. No `#[frb(ignore)]` exclusion is present. Generated files are absent from the checked-in tree, so the generated column below is the expected FRB camelCase name, **not a verified generated symbol**.

| Rust source method / signature | Expected generated Dart binding | Production adapter mapping | Audit |
|---|---|---|---|
| `init_app() -> ()` | FRB init hook / `RustLib.init()` | `_ensureInitialized()` | Special initializer |
| `open_session(base_url, user_id, device_id, access_token, refresh_token, database_directory: String) -> MlsSession` | `openSession(...)` | `open()` | Expected |
| `resume_session(base_url, user_id, device_id, database_directory: String) -> MlsSession` | `resumeSession(...)` | `resume()` | Expected |
| `purge_local_session(user_id, device_id, database_directory: String) -> ()` | `purgeLocalSession(...)` | `purgeLocalSession()` | Expected |
| `access_token_snapshot() -> String` | `accessTokenSnapshot()` | `accessTokenSnapshot()` | Expected |
| `refresh_session() -> String` | `refreshSession()` | `refreshSession()` | Expected |
| `ensure_key_packages(target: u64) -> ()` | `ensureKeyPackages(target: BigInt)` | `ensureKeyPackages(BigInt.from(target))` | Integer mapping must be generated-verified |
| `create_room(room_id: String) -> ()` | `createRoom(roomId)` | `createRoom()` | Expected |
| `invite(room_id, user_id: String) -> ()` | `invite(roomId, userId)` | `invite()` | Expected |
| `cancel_invite(room_id, user_id: String) -> ()` | `cancelInvite(roomId, userId)` | `cancelInvite()` | Expected |
| `room_recovery_status(room_id: String) -> Option<String>` | `roomRecoveryStatus()` | `roomRecoveryStatus()` | Nullable mapping must be verified |
| `undecryptable_json() -> String` | `undecryptableJson()` | `undecryptable()` | JSON tuple decoding |
| `welcome_receipt_status_json(welcome_id: i64) -> String` | `welcomeReceiptStatusJson()` | None | Unmapped public method; decide ignore vs adapter contract |
| `quarantined_commit_reason(room_id: String, epoch: u64) -> Option<String>` | `quarantinedCommitReason()` | `quarantinedCommitReason()` | Nullable + u64 mapping |
| `send_text(room_id, plaintext: String) -> String` | `sendText()` | `sendText()` | Expected |
| `enqueue_text(room_id, plaintext: String) -> String` | `enqueueText()` | `enqueueText()` | Expected |
| `sync() -> Vec<IncomingMessage>` | `sync()` | Adapter uses `syncJson()` instead | Typed method is not directly consumed |
| `sync_json() -> String` | `syncJson()` | `sync()` | JSON path used |
| `pending_incoming() -> Vec<IncomingMessage>` | `pendingIncoming()` | Adapter uses `pendingIncomingJson()` instead | Typed method is not directly consumed |
| `pending_incoming_json() -> String` | `pendingIncomingJson()` | `pendingIncoming()` | JSON path used |
| `messages_for_room_json(room_id: String) -> String` | `messagesForRoomJson()` | `messagesForRoom()` | JSON path used |
| `acknowledge_incoming(event_ids: Vec<String>) -> ()` | `acknowledgeIncoming()` | `acknowledgeIncoming()` | Explicit ACK boundary |
| `outbox_len() -> u64` | `outboxLen()` | `outboxLength()` | BigInt/range check |
| `flush_outbox() -> usize` | `flushOutbox()` | `flushOutbox()` | BigInt/range check |
| `local_epoch(room_id: String) -> Option<u64>` | `localEpoch()` | `localEpoch()` | Nullable BigInt/range check |
| `members_of(room_id: String) -> Vec<String>` | `membersOf()` | `membersOf()` | List mapping |
| `revoke_device(device_id: String) -> ()` | `revokeDevice()` | `revokeDevice()` | Expected |
| `remove_revoked_devices() -> usize` | `removeRevokedDevices()` | `removeRevokedDevices()` | BigInt/range check |
| `logout() -> ()` | `logout()` | `logout()` | Local cleanup lifecycle |
| `close() -> ()` | `close()` | `close()` | Handle release lifecycle |

The source-level scan found **25 abstract methods** in `MlsSessionBridge` and all 25 have corresponding overrides in `RustMlsSessionBridge`. This proves interface-to-adapter method coverage only; it does not prove that generated Dart bindings contain the expected symbols or types.

### Contract notes

- Rust methods are synchronous Rust functions returning `Result<T, String>`; none is annotated `#[frb(sync)]`. The adapter exposes `Future` methods, consistent with the expected default asynchronous Dart wrappers. Generated behavior is not yet verified.
- Expected mapping: `Option<String>` → `String?`; `Option<u64>` → nullable `BigInt`; `u64`, `usize`, `i64` → generated integer representation (the adapter currently expects `BigInt` for native counters/epochs and applies signed-64-bit range checks); `Vec<String>` → `List<String>`; `Vec<IncomingMessage>` → generated list/enum types; opaque `MlsSession` → FRB-managed Dart handle.
- `Result<T, String>` relies on FRB's generated error conversion. The concrete Dart exception/error mapping cannot be asserted without generated output.
- Adapter JSON paths parse `undecryptable_json`, `sync_json`, `pending_incoming_json` and `messages_for_room_json`. The typed `sync` and `pending_incoming` methods are also public but are not directly used by the adapter. `welcome_receipt_status_json` has no adapter/interface mapping.
- Lifecycle surface is present in source: open, resume, close, logout and local purge. `close` is distinct from `logout`; `resume` does not accept refresh credentials; `open_session` accepts the one-time token handoff; only the short-lived access-token snapshot is returned to Dart.

## 4. Generated output and toolchain inventory

Observed on current main:

| Item | Current state |
|---|---|
| Rust FRB dependency | `flutter_rust_bridge = "=2.13.0"` in `mobile/rust/Cargo.toml` |
| Rust lock | `mobile/rust/Cargo.lock` present; includes FRB 2.13.0 |
| Rust toolchain | `mobile/rust/rust-toolchain.toml` pins Rust 1.91.0 |
| FRB codegen binary | Workflows install `flutter_rust_bridge_codegen 2.13.0` with `cargo install --locked` |
| Flutter toolchain | Workflows pin Flutter 3.47.9 |
| Dart FRB package | `mobile/pubspec.yaml` declares `flutter_rust_bridge: ^2.13.0` and `flutter_rust_bridge_hooks: ^2.13.0` |
| Dart lock | Current main `mobile/pubspec.lock` has neither FRB package; `flutter pub get` therefore changes the lock. PR #90 adds both at 2.13.0, but that PR is open and stale against main |
| `mobile/lib/src/rust/` | Absent |
| `mobile/rust/src/frb_generated.rs` | Absent |
| FRB YAML config | No `flutter_rust_bridge.yaml` found |
| Native Assets hook | `mobile/hook/build.dart` absent |
| Rust build script | `mobile/rust/build.rs` absent |
| Android/iOS projects | `mobile/android/` and `mobile/ios/` absent; workflows create them using pinned Flutter before generation/build |

The README intentionally documents that generated bindings and build hooks are validation-workspace artifacts and are not automatically committed. Therefore their absence is not, by itself, proof of a broken CI build. It does mean a clean checkout requires the documented bootstrap/generation sequence before `flutter analyze`, `flutter test` or `flutter run`.

## 5. Pipeline findings

1. `openmls-frb-codegen.yml` generates on Linux, validates Rust/Flutter/Android, uploads generated Dart/Rust files, hook and lockfiles, then downloads that artifact on macOS for iOS device/simulator compilation. The split is reasonable: generation is platform-independent; Android SDK/NDK and iOS/Xcode compilation need different runners.
2. The Linux and macOS jobs use a mutable branch ref (`pull_request.head.ref` / `github.ref_name`) rather than an immutable event SHA. If the branch advances during the run, iOS can compile source from a newer checkout with generated artifacts from an earlier checkout.
3. `flutter-mobile.yml` and `flutter-ios-validation.yml` independently regenerate bindings rather than consuming the Linux artifact. Their checkout uses the PR head SHA. `mls-native-validation.yml` uses `github.sha` for PR runs, which is the PR merge ref, not the same convention as the Flutter workflows. A2 must normalize the matrix to one explicitly recorded SHA.
4. The three FRB workflows do not use identical `integrate` options. The mobile/iOS validation workflows disable FVM installation, Dart fix/format and sample integration tests; the dedicated codegen workflow uses a different option set. This is a reproducibility risk until normalized and diff-tested.
5. The dedicated codegen workflow runs `cargo generate-lockfile` and `flutter pub get` rather than requiring pre-resolved lockfiles. This can resolve newer compatible transitive versions and modify lockfiles during generation. The Flutter lock mismatch on main confirms this path is not currently locked end-to-end.
6. The iOS artifact is transferred within the same workflow run, which binds it to that run; however, source checkout SHA is not pinned and there is no explicit generated-output checksum manifest verified by the iOS job.
7. Android/iOS project scaffolding is generated by `flutter create`. `prepare_android_mls.mjs` rewrites MainActivity and adds the recovery intent filter; `prepare_ios_deep_links.mjs` configures URL handling. These scripts and the generated platform configurations need clean-repeat/idempotency tests. The Android script currently detects an existing `inone` scheme but does not fully validate the expected host/path before deciding the intent filter is already present.

## 6. Findings and priority

### P1 — acceptance blockers

- **P1-01: Dart lockfile does not lock declared FRB dependencies on current main.** The pubspec declares FRB and hooks, but the committed lock omits both. `flutter pub get` resolves and changes the lock; this prevents a deterministic clean-checkout dependency graph. PR #90 contains a lock update to 2.13.0, but it is not merged and is 30 commits behind main.
- **P1-02: CI does not consistently validate one immutable source SHA.** Dedicated codegen uses branch refs; native validation uses the PR merge SHA; Flutter mobile/iOS use PR head SHA. Artifact transfer alone does not correct a source-checkout mismatch.
- **P1-03: FRB integration/generation is duplicated with different options.** Three workflows independently run codegen with divergent integrate flags; generated output equivalence has not been established.
- **P1-04: Lockfile mutation is part of generation.** `cargo generate-lockfile` and unconstrained `flutter pub get` are run in the generation pipeline; no clean second-generation diff or enforced-lock verification exists.
- **P1-05: Clean-checkout generation is documented but not yet proven reproducible.** Generated files are intentionally not committed. The single canonical generation procedure must be executable, idempotent and tested from a clean checkout before A2 acceptance.

### P2 — contract/API cleanup

- **P2-01: `welcome_receipt_status_json` is public but absent from `MlsSessionBridge` and the production adapter.** Decide whether it is internal-only (`#[frb(ignore)]`) or a deliberate adapter method.
- **P2-02: Typed `sync` / `pending_incoming` exports duplicate JSON wrappers but are not consumed by the production adapter.** Either use the typed generated API or mark the typed methods intentionally non-exported; do not hand-edit generated Dart.
- **P2-03: Platform project generation is implicit.** Android/iOS project directories are not committed; clean builds rely on Flutter 3.47.9 `flutter create` plus preparation scripts. Document and regression-test the bootstrap output.
- **P2-04: Android recovery intent idempotency check is too broad.** The script checks only for `android:scheme="inone"`, not the complete `scheme/host/path` tuple.
- **P2-05: No explicit FRB config file exists.** Generation currently relies on CLI defaults plus command-line arguments; an explicit config should be considered if it removes hidden defaults without adding unnecessary generated churn.

No P0 security exposure was established by this source inventory. The FFI surface does not expose a SQLCipher key or private MLS key getter; refresh-token input is a one-time open handoff and the adapter exposes an access-token snapshot/refresh result only. This is a source review, not runtime proof.

## 7. Security contract review

- Private MLS keys and SQLCipher key bytes are not fields or return values in the public `MlsSession` API; the session's client/key-store/database fields are private.
- Refresh token is accepted only by `open_session`; there is no refresh-token getter. The Dart adapter's public access-token snapshot is distinct from refresh-token ownership.
- SQLCipher and protected platform key storage remain in the Rust client/key-store path. No plaintext database fallback or Megolm path was introduced by A1.
- Inbox delivery is explicitly separated from acknowledgement: Rust exposes `pending_incoming` and `acknowledge_incoming`; the client source documents that ACK follows durable app acceptance and has an encrypted-inbox restart/explicit-ACK regression. This test has not been executed as part of this A2 snapshot.
- No change in this audit enables `INONE_MLS_NATIVE_ENABLED` or changes the release gate.

## 8. Verification matrix at this snapshot

| Acceptance item | Result |
|---|---|
| Rust public API source inventory | PASS — 30 public functions inventoried |
| Each method mapped to generated Dart | BLOCKED — generated files absent; expected names only |
| Type/nullability/error/async contract | BLOCKED — source/adapter reviewed; generated type/error mapping unavailable |
| Production adapter implements interface | PASS — 25/25 interface methods overridden |
| Clean checkout code generation | IN PROGRESS — A1 post-merge Flutter mobile job is generating; no conclusion |
| Second clean generation / no diff | NOT RUN |
| Rust host tests | NOT RUN for A2; A1 post-merge host jobs pending/partially complete |
| Flutter analyze/tests | NOT RUN for A2; A1 post-merge Flutter job still running |
| Android build + Keystore smoke | NOT RUN for A2 |
| iOS device + simulator builds | NOT RUN for A2 |
| Security invariants | PASS for static FFI surface review only; runtime/platform verification NOT RUN |
| One exact final SHA across all checks | NOT VERIFIED |
| Reports and continuity updates | In progress on this task branch |

## 9. Environment limitation

A complete local clone could not be obtained: `git ls-remote https://github.com/vahe210991-cloud/InOne-chat.git refs/heads/main` failed at DNS resolution. The execution container has no `rustc`, `cargo`, `flutter`, `dart` or `xcodebuild`. Therefore no local generation, compilation, analyzer or test command is claimed. GitHub repository-native operations are being used for this audit/report only; broad source edits remain deferred until the overlapping PRs are reconciled and a complete build-capable workspace or CI-backed change is available.

## 10. WBS and acceptance

A2 maps to the existing Beta 1.0 MLS/security/storage (20%) and QA/CI/E2E (10%) WBS rows. The approved WBS v1.1 weights and cumulative baseline remain unchanged: **42% implementation / 31% verification**. No separate A2 percentage is invented.

A2 is **NOT ACCEPTED**. No merge, native MLS enablement, release-gate change or product API contract change is authorized by this audit.

## 11. Previous five tasks completed in this session

1. Verified current main HEAD and A1 merge commit.
2. Inspected post-merge A1 workflow runs and recorded their non-final states.
3. Read the required mandate, working rules, WBS, continuity documents and latest Stage 4 / bridge reports.
4. Inventoried the Rust FFI public methods and checked interface-to-adapter method coverage.
5. Inspected FRB workflows, generated-output locations, toolchain pins, lockfiles, platform bootstrap scripts and parallel PR overlap.

## 12. Next five tasks

1. Recheck A1 runs #44519837539, #44519837547 and #44519837614 until each reaches a terminal conclusion; retrieve job logs for any failure.
2. Reconcile PR #90 and #94 against current main and their changed API/adapter/workflow paths; do not overwrite either branch.
3. Obtain generated FRB artifacts from a successful clean-checkout workflow and verify actual Dart symbol names, BigInt/nullable/error mapping and opaque lifecycle bindings.
4. Consolidate generation into one deterministic procedure: immutable SHA checkout, pinned toolchain, enforced lockfiles, normalized integrate flags, output manifest and second-generation no-diff test.
5. Add regression coverage for the Rust-to-generated-Dart-to-adapter contract, then run Rust, Flutter, Android Keystore and iOS device/simulator checks on one exact final SHA.

**No source/API/workflow changes are made by this audit report.**


## 13. Exact-head follow-up — 2026-11-20

The baseline audit branch `feature/a2-frb-reconciliation-2026-11-19` remains an audit/baseline PR and is not accepted A2. Its exact head for the evidence below is `3b20f4e557a994918be474a65aa20eb24e0f6d17`.

### Verified evidence on that exact head

- FRB generation completed and repeated generation produced no output drift.
- The generated artifact `inone-mls-frb-generated` carries the exact source SHA and all 11 entries in `SHA256SUMS` verified.
- Android native-assets APK and Android Keystore runtime smoke passed; the lifecycle integration test reported `All tests passed!`.
- The separate Flutter mobile workflow passed analyze, tests and Android APK build.
- The separate iOS validation workflow passed unsigned simulator and device builds with `IPHONEOS_DEPLOYMENT_TARGET=15.0`.
- The same-artifact iOS simulator build passed after downloading the generated artifact and verifying its source SHA. The same-artifact iOS device build was still in progress at this report update.

### Corrected FFI inventory

The live interface has 26 abstract Future methods and the production adapter has 26 matching overrides. The generated artifact initially exposed 26 MlsSession methods, but three were unused by the adapter: `sync_`, `pendingIncoming`, and `welcomeReceiptStatusJson`. The typed `sync` and `pending_incoming` helpers duplicate the JSON DTO methods consumed by Dart; `welcome_receipt_status_json` has no Dart consumer. The reconciliation branch marks these three Rust helpers `#[frb(ignore)]` and adds a deterministic verifier that requires exact generated/export/adapter method sets and checks BigInt/nullability signatures.

### Pipeline corrections on the reconciliation branch

- One shared `mobile/tool/frb_ci.mjs` owns FRB integration/generation flags for Android, iOS and the dedicated artifact workflow.
- It snapshots/restores manually maintained entrypoints/manifests, uses `flutter pub get --enforce-lockfile`, checks tracked lock/manifests remain unchanged, removes generated sample/web glue and verifies the generated Dart contract.
- Repeated generation runs the same pinned flags and verifies the contract again.
- The iOS artifact consumer compares `pubspec.lock` as well as Cargo and pubspec manifests before copying the artifact.
- The duplicate Flutter mobile workflow uses the same Maven repository init script as the dedicated Android workflow; the earlier Kotlin 2.2.21 failure was not a version incompatibility. A later APK build passed without the init script, so transient Plugin Portal artifact availability remains the likely cause; explicit Google Maven/Maven Central repositories are retained as deterministic fallback.
- The duplicate iOS workflow now uses the same FRB generation script, immutable SHA check, enforced lockfile, deployment-target configuration before both builds, verbose linker output and Apple toolchain capture.

### Current acceptance status

A2 remains OPEN until the reconciliation branch passes its own exact-head workflows, including Android APK/runtime smoke, same-artifact iOS simulator/device builds, lockfile immutability, Rust bridge tests and the exact generated Dart adapter contract. PR #90 and PR #94 remain separate, open, and 31 commits behind current main; their overlapping attachment/file-picker changes are not silently included here. No release gate, branch protection, registration, recovery or SMS policy has been changed.
