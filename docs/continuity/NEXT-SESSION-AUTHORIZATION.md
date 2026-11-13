# Next session — InOne Business backend authorization

**Starting point:** branch `architecture/product-and-platform-blueprint-2026-11-13`  
**PR:** [#50](https://github.com/vahe210991-cloud/InOne-chat/pull/50), draft/open/unmerged  
**Latest spec commit:** `a75651869e409a00e6678e601d03abe05c2c869b`

Read first:
1. [Backend authorization specification v0.1](../../architecture/BACKEND-AUTHORIZATION-SPEC-V0.1.md)
2. [Approved Permission Matrix v1](../../architecture/PERMISSION-MATRIX-V1.md)
3. [Organization positions and delegated access](../../architecture/ORG-POSITIONS-AND-DELEGATED-ACCESS.md)
4. Existing organization API/schema/tests in `inone-engine-poc-0.6.0/` listed in the continuity state.

## Next task — read-only endpoint inventory

For every existing organization/business route:
- HTTP method and path;
- handler and underlying data/resource;
- current authentication and legacy role check;
- proposed atomic permission code;
- trusted resource scope and tenant ownership resolution;
- sensitive classification;
- required audit event;
- idempotency/concurrency requirement;
- existing test coverage and missing negative tests.

Produce `architecture/BUSINESS-ENDPOINT-AUTHORIZATION-INVENTORY.md` and a gap report. Do not edit handlers, DB migrations, UI or API behavior during this pass.

## Still requires owner/product policy closure

- Exact critical-financial operation catalogue and thresholds.
- Approver eligibility, especially when an owner initiates.
- Currency defaults, quorum and expiry.
- Whether approval-policy changes require dual control.
- Confirm one active primary position per membership (current recommendation).
- Propo Seller Account ID, employee identity and API/event contract.

## Guardrails

- Preserve `owner/admin/member` compatibility and existing last-owner protections.
- Never auto-map admin/member to a seven-level position.
- Do not merge PR #50.
- No implementation or DB migration until endpoint inventory, policy closure and schema design are reviewed.
- Clearly label each test PASS/FAIL/BLOCKED/NOT RUN; do not imply documentation was runtime-tested.
