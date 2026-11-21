//! Build-time placeholder for the Flutter Rust Bridge generated module.
//!
//! The standalone Rust/Keychain validation workflows compile the session
//! runtime without generated Flutter bindings. The pinned FRB generation job
//! replaces this file in its isolated workspace with the real bindings before
//! building the Flutter application. Generated output is intentionally not
//! committed from CI.
