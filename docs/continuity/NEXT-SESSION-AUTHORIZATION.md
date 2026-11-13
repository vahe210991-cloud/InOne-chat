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

## Financial policy decision (owner-approved 2026-11-13)

- The independent two-person control model is APPROVED: initiator → independent approver → execution; no self-approval; separate initiate/approve permissions; immutable approval snapshot; fail closed if no eligible approver; full audit.
- Monetary limits are organization-configurable, not globally fixed: the owner sets employee-specific limits when assigning/editing position/authority in the UI. No universal numeric defaults. The operation-level configuration catalogue and UI/API/schema design remain to be specified.
- Exact operation-by-operation dual-approval catalogue, owner-initiated transaction eligibility, quorum and expiry still require detailed policy closure.
- Whether approval-policy changes require dual control.
- Confirm one active primary position per membership (current recommendation).
- Propo Seller Account ID, employee identity and API/event contract.

## Guardrails

- Preserve `owner/admin/member` compatibility and existing last-owner protections.
- Never auto-map admin/member to a seven-level position.
- Do not merge PR #50.
- No implementation or DB migration until endpoint inventory, policy closure and schema design are reviewed.
- Clearly label each test PASS/FAIL/BLOCKED/NOT RUN; do not imply documentation was runtime-tested.


## Next financial-policy work

Prepare a CFO proposal for monetary limits using an operation-based schedule, explicit currency, per-transaction and cumulative caps, configurable organization/position/employee ceilings, and deny-by-default behavior. Do not invent default amounts or hard-code thresholds. Present recommended values only after establishing the business currency, typical transaction sizes, expected sales/turnover and risk appetite. Owner approval is required before implementation.


## Next financial-limits design task

Design the owner-facing employee assignment/edit interface and the corresponding data model/API for organization-isolated, employee-specific, operation-level limits. Include per-transaction and optional cumulative caps, explicit currency, effective dates, versioning, audit, delegation ceilings and deny-by-default behavior. Do not add global numeric defaults. Keep the independent two-person approval requirement intact.
