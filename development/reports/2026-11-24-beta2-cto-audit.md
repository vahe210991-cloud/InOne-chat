# CTO audit snapshot — InOne Beta 2.0

**Date:** 2026-11-24  
**Repository:** vahe210991-cloud/InOne-chat  
**Baseline:** main `02880940c1e4d8261405fbeaa01f40879eb44f3a`  
**Scope:** repository/documentation/source-path review for Beta 2.0 planning. Not a penetration test or runtime certification.

## Executive conclusion

Beta 2.0 should begin with an independent Identity Service. The product requirement and architecture direction are already recorded, but the current canonical InOne backend evidence shows local identity/authentication behavior rather than a separately deployable cross-platform Identity authority. This is the largest architectural prerequisite and must be resolved before broad cross-product feature work.

The product is approved as two separate applications: InOne (personal/social) and InOne Business (professional/work). A shared identity service does not mean a shared application backend, navigation tree, domain database or authorization policy.

## Findings

| ID | Severity | Finding | Evidence / impact | CTO disposition |
|---|---|---|---|---|
| A-01 | Critical architectural gap | No independent cross-platform Identity Service evidenced in reviewed current source | Current canonical backend has local identity rules and registration/auth/recovery imports; product decision requires independent authoritative identity service/database | Start Phase 1 Identity; do not claim cross-product reservation implemented |
| A-02 | High | Identifier uniqueness and policy are not centralized across products | Existing email normalization and ASCII nickname rules are local backend functions | Define canonical claim types, normalization, scope and DB uniqueness; preserve Beta 1 compatibility until approved |
| A-03 | High | Cross-product provisioning/reconciliation is not evidenced as a complete system | Product decisions require transactional outbox, idempotent consumers, retries and reconciliation | Implement durable event lifecycle and failure injection |
| A-04 | High | Existing account migration is undefined | Beta 1 has live account/session/recovery behavior; duplicate/conflicting identities are possible | Inventory and mapping first; no auto-merge or destructive migration |
| A-05 | High | Product boundary requires explicit service and UI ownership | Approved InOne vs InOne Business split; existing roadmap candidates span social, business and shared capabilities | Classify screens/routes/data and establish independent app/API boundaries |
| A-06 | High | Group collaboration features have security-sensitive semantics | Events, polls, search, bots, favorites and pins differ in visibility/permissions; group content is MLS protected | Specify authorization, privacy, MLS metadata boundary, deletion and multi-device behavior before implementation |
| A-07 | High | Cindy introduces external data/tool risks | Files, correspondence, archives and financial workflows require provider, tool, privacy and consent controls | Threat model, least-privilege tool registry and human approval gates before implementation |
| A-08 | Medium | Localization/theme/icon foundations require design-system protection | HY/RU/EN and future FR/DE/ES; themes and icon variants are approved directions | Use immutable approved design-system source; no invented tokens |
| A-09 | Medium | Existing Beta 2 roadmap branch is stale | `planning/beta-2.0-roadmap` is 1 commit ahead / 1,262 behind `main`, diverged | Preserve branch; new CTO roadmap based on current main |
| A-10 | High release dependency | Beta 1.0 remediation is still separately gated | PR #135 Stage 1 accepted; Stage 2 not accepted until required exact-head checks pass | Keep Beta 1.0 and Beta 2.0 branches/issues isolated |

## Existing work to preserve

- Cross-product identity/localization/design requirements: `docs/PRODUCT-DECISIONS-IDENTITY-LOCALIZATION-DESIGN.md`.
- Owner decisions and two-app split: `docs/continuity/DECISIONS.md`.
- Existing Beta 2 feature candidates: `docs/product/BETA-2.0-AND-LATER-ROADMAP.md` on the legacy planning branch.
- Canonical backend ownership: ADR-004 and `docs/continuity/BACKEND-SOURCE-OF-TRUTH.md`.
- Existing Beta 1 identity/auth behavior in the canonical Node backend. Treat it as compatibility baseline; do not copy the historical POC tree wholesale.
- Beta 1 PR #135 staged security remediation and its scope boundaries.

## Scope limitation

This pass did not execute tests, inspect production data, deploy services, access Propo's private systems, perform a penetration test, or certify the current Beta 1 release. All findings are architectural/source-review findings and require implementation evidence and exact-SHA validation.
