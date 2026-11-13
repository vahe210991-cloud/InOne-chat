# Repository re-baseline — restart assumptions

**Date:** 2026-11-13  
**Status:** Required before implementation

## 1. Meaning of "start from zero"

For this architecture exercise, the owner asked us to treat all repository implementation as not yet done.

Therefore:
- historical code is not accepted product functionality;
- old progress percentages and Beta labels are not a new roadmap;
- existing UI screens are not automatically assigned to either app;
- a route in source is not a verified API contract;
- a test file is not evidence of a passing test;
- old CI success applies only to its exact historical SHA and scope;
- existing Propo integration notes are proposals unless Propo confirms the contract.

This does not mean delete, overwrite or ignore existing files. Preserve history and use code/assets as candidate references.

## 2. Current repository as a technical reference

The repository has previously been analyzed as containing:
- a Node.js modular HTTP backend and PostgreSQL/migration path in versioned engine/archive directories;
- memory-backed test support;
- object/file storage and SMTP/SMS adapters;
- organization, account, device, session, room and MLS domain work;
- Rust/OpenMLS client and Rust bridge code;
- Flutter mobile application and typed repository/session/bridge work across active branches;
- approved HTML/UI design assets and screen manifests;
- CI workflows and historical test reports.

Exact source paths and branch heads must be rechecked from a complete clone before implementation. Some relevant Flutter and CH-01 work was on draft PR branches and must not be assumed merged into main.

## 3. First audit tasks

1. Capture current main SHA and all relevant active PR branch heads.
2. Build a complete repository tree inventory including submodules/LFS where used.
3. Map duplicate/parallel engine trees and preserve their provenance.
4. Inventory Node modules, route handlers, DB schema/migrations and test coverage.
5. Inventory Rust/OpenMLS code, FFI bridge, platform handlers and secure key storage.
6. Inventory Flutter app entry points, navigation, UI assets, screen IDs, API repositories and bridge ownership.
7. Inventory CI workflows and determine which jobs run on which source trees.
8. Inventory Propo integration docs; obtain actual Propo API docs and sandbox before claiming compatibility.
9. Map every screen and API to Propo, InOne Business, InOne, shared platform or unresolved.
10. Produce a new source baseline and a reuse/rewrite/retire recommendation.

## 4. Reuse decision criteria

Classify every artifact:
- **REUSE-CANDIDATE:** architecture/source is coherent and can be proven by tests/security review.
- **REFERENCE-ONLY:** useful patterns or historical implementation, but not ready to ship.
- **REWORK:** valuable domain but boundary, contract or security needs redesign.
- **REPLACE:** incompatible or unsafe; preserve history and explain why.
- **UNKNOWN/BLOCKED:** insufficient evidence.

Never copy code into a new canonical tree until its provenance, license, dependencies, tests and security implications are understood.

## 5. Output of the re-baseline

Required report:
- exact source SHA and branch/PR map;
- canonical source tree proposal;
- module inventory;
- API contract inventory;
- database ownership and schema inventory;
- security/MLS state;
- UI screen ownership map;
- test and CI evidence matrix;
- dependency and deployment map;
- risk register;
- owner decisions still needed;
- phased reuse/rewrite plan.

## 6. Guardrails

- No code changes in the re-baseline stage.
- No PR merge, branch deletion, force push or Actions run without authorization.
- No database or server exposure.
- No assumption that Propo's database/API is available.
- No weakening of existing MLS fail-closed requirements if an encrypted messaging domain is retained.
