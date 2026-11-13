# Backend authorization specification — session report

**Date:** 2026-11-13  
**Branch:** `architecture/product-and-platform-blueprint-2026-11-13`  
**PR:** [#50](https://github.com/vahe210991-cloud/InOne-chat/pull/50)  
**Specification:** [BACKEND-AUTHORIZATION-SPEC-V0.1.md](../../architecture/BACKEND-AUTHORIZATION-SPEC-V0.1.md)  
**Commit:** `a75651869e409a00e6678e601d03abe05c2c869b`

## Completed

Created the documentation-only backend authorization specification based on the owner's approved seven-level hierarchy and Permission Matrix v1.

The specification covers:
- atomic permission-code catalogue across organization, catalog, commerce, operations, finance, CRM, tasks, integration and audit;
- separation of membership, position, functional assignment, permission, scope, delegation, limits and approval policy;
- strict hierarchy and delegation non-amplification rules;
- department/team/resource scope enforcement;
- configurable limits with explicit currency, effective dates and fail-closed defaults;
- two-person financial approval lifecycle, self-approval prevention, immutable transaction snapshot and idempotency;
- suggested logical persistence entities (not SQL migrations);
- server-side authorization evaluation contract and proposed API routes;
- append-only audit event contract;
- safe migration from existing `owner/admin/member`;
- security/regression test matrix and staged implementation gates.

## Important implementation truth

This is a specification, not implementation. No application code, DB schema/migration, API route, middleware, UI, CI or deployment was changed. No tests were run because no executable code changed. PR #50 remains open/draft and unmerged.

Existing POC behavior remains as previously audited: organization-scoped `owner/admin/member`, multi-organization membership, owner-only role changes and last-owner protection. The approved seven-level hierarchy, delegated grants, limits and dual approval are not implemented yet.

## Open design gates

Before schema/API implementation, close:
1. exact list of operations requiring dual approval;
2. eligible approver policy, including transactions initiated by owners;
3. default thresholds, currencies, expiry and quorum;
4. whether approval-policy changes themselves require dual control;
5. one active primary position per membership (recommended initial rule);
6. endpoint-by-endpoint permission/scope mapping after route inventory;
7. Propo Seller Account stable ID and employee identity/API contract.

## Next action

Perform a read-only endpoint inventory in the existing engine and map each route to the proposed permission code, trusted resource scope, sensitivity and audit behavior. Do not change authorization behavior or schema until that inventory and the remaining owner policy gates are reviewed.
