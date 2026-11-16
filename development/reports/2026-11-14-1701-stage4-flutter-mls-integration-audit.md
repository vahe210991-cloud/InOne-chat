# InOne Beta 1.0 — Stage 4 / Flutter MLS integration audit

**Date/time:** 2026-11-14 17:01:57 Europe/Tallinn (UTC+03:00)  
**Session type:** ChatGPT repository audit  
**Task branch:** `task/beta1-stage4-mls-merge-audit-2026-11-14`  
**Base branch:** `feat/flutter-ui-dart-migration-2026-11-14`  
**Base SHA:** `eda47ce560cb1468438460147cbd49cd2f4a4747`  
**Initial task-branch HEAD:** `eda47ce560cb1468438460147cbd49cd2f4a4747`  
**Related PRs:** [#45 — Native MLS runtime](https://github.com/vahe210991-cloud/InOne-chat/pull/45), [#52 — Flutter-native Beta 1.0 migration](https://github.com/vahe210991-cloud/InOne-chat/pull/52)  
**Status:** READ-ONLY TECHNICAL AUDIT COMPLETE; SOURCE INTEGRATION BLOCKED pending a complete working copy and executable validation.

## 1. Scope

Owner explicitly requested work on all six Beta 1.0 items:

1. Flutter ↔ Rust MLS FFI.
2. Platform secure key storage and SQLCipher key transfer.
3. Rust-owned refresh/session lifecycle after native adoption.
4. MLS message encryption/decryption in Flutter.
5. File attachments exclusively through an encrypted transfer path.
6. Recovery confirmation deep links for accounts with a verified phone.

No Beta 2.0 work is included. No backend API contract change, deployment, server start, merge, or release enablement is authorized by this task.

## 2. Repository state and source-of-truth findings

The active Flutter migration branch is `feat/flutter-ui-dart-migration-2026-11-14` at `eda47ce560cb1468438460147cbd49cd2f4a4747`. PR #52 is Draft/open and targets `stage0/identity-engineering-readiness-2026-11-13`; it is not merged.

A separate Stage 4 implementation exists on `feature/stage-4-native-mls-runtime-2026-11-11`, HEAD `016ba75045412652d362fa8c94ee166bfa371c23`, PR #45 Draft/open, based on main SHA `94571cbc923ac4d29c3c684dbfdeb35f031d6a30`.

These branches diverged from the same earlier base. GitHub compare reports the active Flutter branch and Stage 4 branch as **diverged**, not fast-forward compatible. Do not merge PR #45 wholesale or overwrite the newer Flutter UI with its older app entry point. Port/reconcile the Stage 4 files selectively on a task branch.

The mandatory `development/AI-AGENT-MANDATE.md` is absent from the active Flutter branch, although it exists on `docs/mandatory-ai-agent-protocol-2026-11-09` (blob SHA `80a36b484b48019e1200d521bde520d0419a2054`). This audit followed that recovered mandate plus the active branch's `AGENTS.md`, `development/README.md`, `WORKING-RULES.md`, `HANDOVER-CHECKLIST.md`, WBS and continuity records. Restore the mandatory file through a separately reviewed documentation change; do not silently treat the active branch as complete.

## 3. Findings by owner-requested item

### 3.1 Flutter ↔ Rust MLS FFI — PARTIALLY IMPLEMENTED IN PR #45; NOT IN ACTIVE FLUTTER BRANCH

Stage 4 PR #45 contains:
- `mobile/rust/Cargo.toml`, Rust API/session module and secure-store module;
- Dart `MlsSessionBridge` contract and `RustMlsSessionBridge` adapter;
- persistent OpenMLS client integration and tests;
- an FRB code-generation workflow.

The active Flutter branch has no `mobile/rust/`, `mobile/lib/core/mls/`, generated Rust/Dart bindings, or FRB package dependency. The active tree also has no committed `mobile/android/` or `mobile/ios/` projects; the earlier Stage 4 workflow generated those during CI.

PR #45's own body states that generated outputs are still absent: `mobile/lib/src/rust/frb_generated.dart`, `mobile/hook/build.dart`, `mobile/rust/src/frb_generated.rs`, and `mobile/rust/Cargo.lock`. Its exact-head CI has not established a successful code-generation/build/test result. Therefore the FFI is not complete or accepted.

**Required:** selectively port Rust crate + typed Dart adapter + build/codegen configuration, generate bindings on a real runner, verify Android/iOS target packaging and test ABI/serialization/error propagation. Keep the native MLS feature gate disabled until the complete matrix passes.

### 3.2 Platform key storage and SQLCipher — IMPLEMENTATION EXISTS IN PR #45; RUNTIME ACCEPTANCE BLOCKED

PR #45 contains `mobile/rust/src/secure_store.rs`:
- 32-byte SQLCipher key material is read/written inside Rust;
- Android uses `android-native-keyring-store` / Keystore;
- iOS uses `apple-native-keyring-store` protected Keychain;
- the key is not exposed through the Dart bridge;
- key deletion is attempted during local purge/logout.

The Rust client uses SQLCipher-backed SQLite. Its key-provider contract has separate existing-key lookup so resume must fail closed when a database exists but its platform key is missing.

However, current Flutter branch does not include this Rust integration. PR #45 reports Android emulator Keystore and signed iOS protected-Keychain tests as pending; no successful exact-head evidence was found. iOS runtime acceptance also depends on repository Environment signing material (certificate, password, provisioning profile and Team ID), which must never be pasted into chat or committed.

**Required:** port without changing key semantics; verify create/close/resume, wrong-key rejection, missing-key rejection, WAL/SHM/journal cleanup and logout. Run Android emulator and signed iOS protected-Keychain tests. Do not substitute `flutter_secure_storage` or memory storage as a production SQLCipher key provider.

### 3.3 Rust-owned session refresh — IMPLEMENTED IN PR #45; NOT IN ACTIVE BRANCH

PR #45 changes `InOneSession` so successful login adopts the authenticated session into Rust, Rust owns the refresh-token pair and rotation, and Flutter receives only a short-lived access-token snapshot. It also covers restore after app restart and coordinated logout/handoff.

The active branch's `mobile/lib/core/session/inone_session.dart` still stores `_refreshToken` in Dart secure storage and calls `POST /token/refresh` from Flutter. It has no native MLS bridge or adoption/resume path.

**Required:** port the Stage 4 lifecycle into the current Dart session implementation without regressing current Beta 1.0 login/registration/recovery behavior. Test concurrent login, refresh, handoff, restart/resume, failed handoff, logout races, revocation and token zeroization. Never keep a second refresh-token owner after successful Rust adoption.

### 3.4 MLS encryption/decryption in the mobile app — CLIENT CORE EXISTS IN PR #45; ACTIVE APP NOT CONNECTED

Stage 4's persistent Rust client implements MLS text send, sync/decrypt, durable inbox/outbox, SQLCipher message history, epoch/membership reconciliation, and explicit inbox acknowledgement. The Rust bridge exposes `send_text`, `sync`, pending inbox/history and ACK methods.

The active Flutter branch does not contain the bridge or native session. Its current message UI does not yet demonstrate a verified send/receive path. The existing backend contract requires `POST /mls/groups/:id/messages` with MLS ciphertext; `POST /rooms/:id/events` plaintext/legacy fallback is explicitly forbidden.

**Required:** connect current Flutter room/message repository and UI to the native bridge; persist decrypted inbox before ACK; test two devices, offline/restart, commits/Welcome ordering, revoked devices, replay and epoch transitions. Until all pass, send/receive must remain fail-closed.

### 3.5 File attachments — NOT IMPLEMENTED IN THE NATIVE MLS CLIENT

Static source audit found only `send_text` / MLS text-message support in the Stage 4 client and bridge. No native attachment encrypt/decrypt/upload/download API was found.

The backend has generic `POST /files` + signed object upload/download URLs and associates a ready `fileId` with an MLS message. The object upload route stores the bytes it receives; it does not encrypt them. The MLS message route accepts a `fileId` reference alongside MLS ciphertext, but this alone does not protect the file contents.

**Required secure design:** encrypt file bytes on-device before upload using an authenticated-encryption content key; upload only ciphertext; deliver the file ID, algorithm/version, nonce and content key (plus any encrypted filename/MIME metadata) inside an MLS application message; download ciphertext and decrypt only after MLS membership/key authorization. Bind room ID, file ID, size and content hash as authenticated data or verify them inside the encrypted manifest. Enforce size limits and safe streaming/temp-file handling. Never upload plaintext, place a key in a URL/metadata field, or send a plaintext attachment reference. Add tests that inspect stored objects and assert that plaintext, filenames and content keys are absent. No such implementation or tests currently exist.

### 3.6 Recovery deep link for verified-phone accounts — BACKEND FLOW EXISTS; FLUTTER DEEP-LINK HANDOFF MISSING

Canonical backend behavior:
- `POST /recovery/start` is privacy-preserving.
- For a verified-phone account, backend creates an SMS code and an email confirmation token.
- Email URL is `/recovery/confirm?user=...&token=...`.
- `GET /recovery/confirm` is a non-mutating preview (email link scanners must not confirm recovery).
- `POST /recovery/confirm` consumes the link token; the JSON response is `{ok:true}`.
- The SMS code is then entered in `POST /recovery/complete`.

The active Flutter app has SC-08 source, but `mobile/lib/app/inone_mobile_app.dart` has no recovery-confirm route, no `app_links` listener/initial-link handler, and no `InOneSession.confirmRecoveryLink` method. Current recovery flow goes from SC-07 directly to SC-09. The SC-08 screen is therefore not wired.

**Required:** validate only the configured HTTPS recovery host and exact path; parse the user/token without logging or persisting the token; show SC-08 confirmation; on explicit user action POST `{user, token}` to `/recovery/confirm`; then navigate to SC-09. Handle initial and warm links, duplicate delivery, expired/wrong tokens, app-not-installed/browser preview and safe cancellation. Do not let GET preview consume the token.

**External prerequisite:** Universal/App Links require the actual public recovery hostname, Android asset-links certificate fingerprint and Apple Team ID/Associated Domains configuration. These values are not established in the repository. In addition, current production config forbids enabling the SMS provider and `POST /account/phone/confirm` returns 503 when SMS is disabled. The verified-phone recovery path must not be called production-ready until a real SMS provider is configured and tested; otherwise the SMS code is not delivered to the user.

## 4. Work completed in this audit

- Verified current Flutter branch HEAD and PR #52 state.
- Verified Stage 4 PR #45 HEAD, base, source files, workflow and acceptance status.
- Compared branch ancestry; confirmed branches diverged.
- Inspected Rust key-store, Rust session API, persistent MLS client, Dart bridge adapter, current Flutter session/app/recovery routing, canonical backend recovery handlers and file/MLS routes.
- Created this isolated task branch from the exact current Flutter HEAD.
- No product source was changed in this audit. No tests/builds were run. No Actions workflow was dispatched. No merge/deployment/server/device action was performed.

## 5. Environment and exact blocker

The connected GitHub interface can inspect repository files/trees and create isolated branches, but it does not provide a complete clone/Codespace/working tree or a Rust/Flutter build runner. The repository is private, and the available Vercel sandbox source contract accepts only public Git clone URLs or existing prepared snapshots; no authorized private-repository snapshot is available here. The GitHub Actions jobs observed for the latest Flutter migration head fail before steps with no runner/step logs. Therefore a broad multi-file Rust/Flutter/Android/iOS integration cannot safely be authored, compiled, or validated through the available repository-native file editor alone.

**BLOCKED:** full source integration and executable verification. The exact source gaps are documented above; do not mark any of the six items complete on the basis of PR #45 code presence.

## 6. Validation status

| Check | Status | Evidence |
|---|---|---|
| Repository tree/source inspection | PASS | GitHub tree + exact file blobs |
| Stage 4 PR #45 source audit | PASS (static only) | HEAD `016ba750...` |
| Current Flutter branch source audit | PASS (static only) | HEAD `eda47ce...` |
| Branch ancestry compatibility | PASS (divergence identified) | compare: diverged |
| FRB code generation | BLOCKED / NOT RUN | generated outputs absent; no runner evidence |
| Rust cargo fmt/check/test | NOT RUN | no Rust toolchain in execution environment |
| Flutter analyze/test | NOT RUN | no Flutter SDK in execution environment |
| Android Keystore runtime | NOT RUN | no emulator/device execution |
| iOS Keychain runtime | BLOCKED / NOT RUN | signing environment and macOS runner required |
| MLS send/receive E2E | NOT RUN | native integration absent from active branch |
| Encrypted attachment E2E | NOT RUN | attachment cryptographic path absent |
| Recovery deep-link E2E | NOT RUN | Flutter deep-link route absent |

Latest active Flutter branch Actions evidence from the preceding audit: Flutter run #43600137641 failed before steps; job #132462922724 has no steps and logs unavailable. Do not interpret it as a source-level Flutter test failure.

## 7. Cumulative readiness

Approved WBS v1.1 unchanged:
- InOne overall: historical qualitative 25% (not recalculated).
- Beta 1.0: 42% implementation / 31% verification baseline.
- Beta 2.0: 2% implementation / 0% verification baseline.

No increase is justified: Stage 4 code exists on a separate unmerged branch, generated bindings are absent, and no exact-head tests/device acceptance passed.

## 8. Last five previous tasks (partial chronology from current GitHub log)

1. ~~[x] Engine source reconciliation and hardening audit — report `2026-11-14-engine-stability-audit.md`; source-only, runtime checks blocked.~~
2. [ ] IN PROGRESS — Engine security hardening follow-up: refresh rotation, file URL origin and DB restore; exact-head CI still unverified.
3. [ ] BLOCKED — Exact-head engine verification: Actions jobs terminated before steps; no logs.
4. [ ] BLOCKED — Flutter-native migration PR #52: migration source committed in draft branch; Flutter validation run has no steps/logs.
5. [ ] BLOCKED — Stage 4 Native MLS PR #45: implementation submitted on a separate draft branch; generated bindings and Android/iOS acceptance remain pending.

The prior session log contains a partial chronological record; this list preserves the most recent relevant workstreams and does not imply acceptance.

## 9. Next five tasks

1. [ ] IN PROGRESS — Obtain a complete private-repository working copy on the owner-approved computer/Codespace or another authorized full-clone environment; verify HEAD, refs, submodules/LFS and clean status.
2. [ ] NOT STARTED — Port Stage 4 Rust crate, secure-store implementation, Dart bridge and client hardening selectively onto this task branch; reconcile current `InOneMobileApp` and `InOneSession`, do not replace current UI.
3. [ ] NOT STARTED — Generate and commit FRB outputs; configure Android/iOS native assets and validate Rust + Flutter compilation on one exact SHA.
4. [ ] NOT STARTED — Complete MLS message and encrypted attachment flows, including SQLCipher inbox/outbox durability, ciphertext-only object storage and two-device E2E.
5. [ ] BLOCKED — Wire verified-phone recovery deep links; confirm public HTTPS host, Apple Team ID, Android signing fingerprint and real SMS provider before end-to-end acceptance.

## 10. Owner decisions / unresolved external inputs

No additional product-scope decision is requested. Required operational values are not to be guessed:
- public recovery HTTPS hostname and app-link association ownership;
- Apple Developer Team ID / signing environment;
- Android release/app-signing SHA-256 fingerprint;
- real SMS provider and credentials/configuration managed outside GitHub.

No secrets should be posted in chat or committed.
