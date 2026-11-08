# InOne — technical director audit and delivery checklist

Date: 2026-11-08
Repository: vahe210991-cloud/InOne-chat
Scope: read-only baseline inspection plus product-decision documentation. No production code or main-branch changes were made.

## Executive status

The documentation baseline and corrected icon specification were merged to `main` through PR #15 (documentation-only). Cross-platform Identity Service implementation is tracked in issue #16. The canonical P0 source import remains blocked by issue #11.

**Provisional overall MVP readiness: 35%.** This is a CTO estimate, not a test-coverage percentage. The existing 0.6 engine foundation and its automated checks are substantial, but the product client, approved visual design-system source, cross-platform Identity Service, localization, and complete MVP delivery are not yet present as integrated, accepted product features.

Do not compare this estimate directly with the earlier 0.7 plan's 45/30/25 weighted projection: that plan predates the newly approved InOne + Propo shared-identity, localization, chat-theme, and alternate-icon requirements. Rebaseline the weighted roadmap after source-of-truth inventory and owner acceptance.

## Verified repository facts

- Default branch: `main`; repository is private.
- Current main contains the 0.6.0 archived engine, an engine POC snapshot, and 0.7 planning / common client-screen spike files.
- The 0.7 client work currently consists of a shared request/state layer and test/report documents; the listed product screens 0.7.1–0.7.11 are not implemented in the main tree.
- A Dart reference client exists in the 0.6 archive, but its own archive documentation says it was not verified because Dart SDK was unavailable. No complete Flutter product application or its `pubspec.yaml` was found in the main tree.
- No design-system source directory, design tokens, icon assets, localization catalogue, or chat-theme implementation was found in the main tree. Preserve the approved design-system artifact when located; do not recreate its exact tokens from memory.
- The independent Identity Service and authoritative cross-platform reservation workflow for InOne + Propo are not evidenced in the current main tree. Existing identity/profile functionality in the 0.6 engine is not proof of the newly approved cross-platform identity contract.
- The P0 Wave 3 bundle and patches 001–008 referenced in PR #10 are not available on the inspected remote branches according to the PR's source-scope statement. Obtain/import the canonical source before claiming those changes are integrated or tested.

## GitHub Actions — PR #10

Run: https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42395014895

The PR-triggered workflow completed with **3 of 4 jobs successful**:
- Node 22 backend suite: **369 passed, 0 failed**.
- Node 22 + PostgreSQL 16 database/migration suite: **43 passed, 0 failed**.
- Rust 1.91 MLS client and bridge checks/tests: **successful** (client and bridge tests passed).
- Rust formatting: **failed** because rustfmt reports formatting differences in Rust source/test files. This is a formatting failure, not evidence of a Rust compile/test failure.

The workflow validates only the 0.6.0 archived engine paths named in its workflow file. It does not validate the missing P0 Wave 3 source, 0.7 product screens, Flutter app, Propo integration, or the newly approved product requirements. PR #10 remains a draft and must not be treated as green or merged until the formatting check is corrected and the correct canonical source scope is tested.

## Technical director recommendations

1. Keep `main` protected from unverified or incomplete merges. Work through reviewable feature branches and PRs.
2. First identify and import the canonical current development source (including P0 Wave 3 and patches 001–008 if still authoritative). Reconcile duplicate 0.6 snapshots and define one canonical engine path.
3. Establish a dedicated Identity Service and database as the source of truth. Keep InOne and Propo backends and domain data independent. Implement central unique identifier reservation, `ACTIVE/RESERVED` platform states, transactional outbox/inbox, idempotency, retry/reconciliation, and explicit partial-operation status.
4. Build the client foundation around an in-app language preference: Armenian, Russian, English first; French, German, Spanish enabled by the localization architecture.
5. Retrieve and pin the exact approved design-system source. Then implement glassmorphism components without changing approved tokens. Chat theme selection / user-created themes and alternate app icons can ship after the first beta, but their extension points should be planned now.
6. Correct Rust formatting in source, rerun the full workflow, inspect all job results and artifacts, then request review. Do not bypass or downgrade the formatting gate to manufacture a green result.

## Delivery checklist

- [ ] Locate and verify the canonical current source and P0 Wave 3 + patches 001–008.
- [ ] Reconcile archive / POC duplication and nominate one canonical engine path.
- [ ] Fix Rust formatting properly; rerun Node, PostgreSQL, Rust format, Rust check and Rust tests.
- [ ] Audit current identity schema, registration routes, uniqueness constraints, and profile lifecycle.
- [ ] Design and implement independent Identity Service + shared identity database.
- [ ] Add cross-platform reservation, idempotency, outbox/inbox, retries, and reconciliation tests.
- [ ] Add fault-injection tests: Propo down, Identity down, timeout after commit, duplicate/concurrent registrations, recovery after outage.
- [ ] Locate and version the approved InOne design-system source; protect it from silent changes.
- [ ] Add in-app language selection and Armenian/Russian/English translations; prepare future language packs.
- [ ] Implement product screens and validate client/server flows.
- [ ] Add theme architecture now; deliver built-in and user-created chat themes in a later beta.
- [ ] Add the primary icon exactly as approved: green background with no white perimeter; exact wordmark “InOne”; black bold connected letters; white outline directly around the letters; glass-layer aesthetic.
- [ ] Plan alternate icon variants and platform-specific switching.
- [ ] Run full CI on the canonical source, complete security review, create release candidate, and merge only after required checks pass.

## Change control

The approved product decisions in `PRODUCT-DECISIONS-IDENTITY-LOCALIZATION-DESIGN.md` are the requirements baseline. Any change to the wordmark, icon outline placement, approved design tokens, identity ownership model, or platform-independence principles requires explicit product-owner approval.
