# InOne MLS G2 — A1 Rust FFI audit

Date: 2026-11-19
Base: `main` at `a174f794535ab09699d38292acb4919308873fd7`
Work branch: `fix/mls-a1-ffi-path-validation-2026-11-19`

## Scope

Reviewed the public Rust FFI session lifecycle in `mobile/rust/src/api/session.rs`, the platform key-store boundary in `mobile/rust/src/secure_store.rs`, the generated Flutter adapter `mobile/lib/core/mls/rust_mls_session_bridge.dart`, and the underlying `mls-client` session connect/resume validation.

## Confirmed finding fixed in A1

**A1-P0/P1 — untrusted/empty database directory accepted by local purge.**

Before this change, `purge_local_session` accepted an empty or relative `database_directory`. An empty path is interpreted relative to the process working directory, so a malformed FFI call could target a hashed SQLCipher filename in the working directory rather than the app-private support directory. `open_session` and `resume_session` also relied on the Flutter caller to supply a valid app-private directory.

### Change

- Added one shared `validate_database_directory` guard.
- Require a non-empty absolute path.
- Reject parent-directory traversal components.
- Apply validation before filesystem or platform key-store operations in open, resume, and purge.
- Validate identity and token presence at the FFI open/resume boundary before side effects.
- Added regression coverage for empty, whitespace, relative, and parent-traversal paths, plus a valid absolute temp directory.

### Compatibility

The Flutter adapter uses `getApplicationSupportDirectory()`, which returns an absolute app-private path. Existing SQLCipher filenames, identity scopes, database format, keyring service/account names, and refresh-token ownership are unchanged. No migration is required.

## Existing controls retained

- Refresh token is not exposed by the `MlsSession` Dart API.
- SQLCipher key remains in Android Keystore / iOS Keychain through `PlatformKeyStore`.
- Missing key with an existing database fails closed; it is not silently regenerated.
- Logout attempts local database/sidecar and key cleanup even when remote logout fails.
- `close` drops the runtime without deleting persistent state.
- Underlying `mls-client` validates API origin and requires HTTPS except permitted local debug hosts.
- Rust session methods serialize access through a mutex.

## A1 validation status

Source-level regression test added. CI compilation and test results are pending on this branch; no green status is claimed until GitHub Actions completes.

## Remaining A1 work

1. Run Rust tests and clippy on the branch.
2. Run Flutter analyze/tests and verify generated FRB bindings remain in sync.
3. Audit every FFI method for panic/poison behavior and input bounds.
4. Audit Flutter adapter lifecycle races across open/resume/close/logout.
5. Close A1 only after CI is green and the review has no unresolved high-severity findings.

## Explicit non-claims

This change does not prove Android Keystore/iOS Keychain physical-device behavior, does not complete message E2E acceptance, and does not enable MLS by default. Those belong to later G2 steps.
