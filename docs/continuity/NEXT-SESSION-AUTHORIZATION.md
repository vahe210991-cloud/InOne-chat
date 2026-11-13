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


## Owner-approved UI requirement — Financial authority block (2026-11-13)

The employee assignment/edit screen must include a separate **Financial authority** block for organization-specific, employee-specific operation permissions and limits. Capture per-transaction maximums, optional cumulative period caps, explicit currency and the applicable independent second-approval requirement. Do not add universal numeric defaults or permit the UI to bypass mandatory dual control. Version and audit every change. This remains design work: no screen/API/schema/runtime implementation is authorized or claimed by this note.
\n\n## Owner-approved direction — Identity and paired product accounts (2026-11-13)\n\nThe owner approved mandatory phone and email at registration, centrally stored by InOne Identity as unverified claims until verification providers exist. Personal entry through InOne provisions InOne personal + Propo personal; work entry through InOne/invitation provisions InOne Business work + Propo work. The paired Propo account is reserved immediately and only becomes usable after its own first-device activation. Product backends and databases remain separate; Identity coordinates identity/authentication and product-account mapping. Invitations require explicit acceptance before work membership activation.\n\nRead [IDENTITY-AND-PRODUCT-ACCOUNT-LIFECYCLE-V0.1.md](../../architecture/IDENTITY-AND-PRODUCT-ACCOUNT-LIFECYCLE-V0.1.md). Next work is to close contact-claim conflicts/recovery, credentials/MFA, device lifecycle, invitation timing and Propo's personal/work account contract before implementation. Keep this documentation-only; do not change code/schema/API until separately approved.\n