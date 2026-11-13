# Existing organization API — authorization endpoint inventory v0.1

**Status:** Read-only audit of the existing `inone-engine-poc-0.6.0` reference engine  
**Source baseline:** `main` at `1df19a001acb5f8c4892471ca4eaa0696e02c54d`  
**Audited contract:** `inone-engine-poc-0.6.0/ORG_API.md` (blob `0f27f4b597964f527ed16faec0e4897bf9747926`)  
**Server source:** `inone-engine-poc-0.6.0/src/server.js` (blob `9d466284fe69059dc31444b7b45fb624025a07b9`)  
**Tests:** `test/org-management.test.js` and `test/admin-journal.test.js`  
**Implementation status:** Inventory only. No handlers, schema or tests were changed.

## 1. Summary

The current organization API is a small POC access model, not the approved InOne Business hierarchy. It implements authenticated organization membership checks and three organization roles (`owner`, `admin`, `member`), with owner-only role changes. Admin can add/remove ordinary members but cannot promote or change roles. Multiple owners are supported and last-owner protection is tested.

The approved backend specification proposes atomic permissions. The mappings below are **target mappings**, not claims about current runtime enforcement. A route can map to multiple permission codes and additional state/scope checks.

## 2. Organization routes

| Existing route | Current documented access | Proposed permission mapping | Required scope / additional checks | Audit |
|---|---|---|---|---|
| `GET /orgs/mine` | Authenticated user; own memberships only | No org-level grant; identity-scoped self query | Return only memberships of authenticated subject; never accept arbitrary user ID | Security read log optional |
| `GET /orgs/:id/members` | Any member | `org.members.read` | Active membership in path org; fields should be minimized by privacy policy | Read audit only for sensitive expanded fields |
| `POST /orgs/:id/members` | Owner; admin only for ordinary member | `org.members.invite` | Target and inviter same org context; target role/position must be within actor ceiling; invite idempotency | Required |
| `POST /orgs/:id/members/:uid/role` | Owner only | `org.positions.assign` plus `org.access.grant` as needed | Strictly lower hierarchy target; no self-elevation; grant cannot exceed actor ceiling; custom-position policy | Required, before/after |
| `DELETE /orgs/:id/members/:uid` | Owner; admin only ordinary member | `org.members.remove` | Strict hierarchy; preserve last-owner; preserve room ownership/transfer guard; cannot remove peer/superior | Required |
| `POST /orgs/:id/leave` | Any member | Self-service membership operation (proposed `org.members.leave`) | Authenticated actor must equal target; preserve last-owner and owned-room safeguards | Required |
| `GET /orgs/:id/settings` | Any member | `org.read` | Active membership in organization | Optional |
| `POST /orgs/:id/settings` | Owner or admin | `org.settings.update` | Per-setting permission and sensitivity; critical settings may require approval | Required |
| `GET /orgs/:id/settings/log` | Owner or admin | `audit.read` (or a narrower `org.settings.audit.read`) | Organization scope; redact secrets/private data | Required access audit |
| `GET /orgs/:id/admin-log` | Owner or admin | `audit.read` | Explicit audit scope; do not expose private room content | Required access audit |
| `GET /orgs/:id/links` | Owner or admin | Proposed `org.links.read` | Both sides' organization authorization; relationship data only | Read audit optional |
| `POST /orgs/:id/links` | Owner or admin | Proposed `org.links.propose` | Actor member of proposing org; target organization validated; duplicate protection | Required |
| `POST /orgs/:id/links/:lid/accept` | Owner/admin of non-proposing side | Proposed `org.links.accept` | Actor must belong to accepting side; cannot accept own side's proposal | Required |
| `POST /orgs/:id/links/:lid/revoke` | Owner/admin of either side | Proposed `org.links.revoke` | Actor belongs to one endpoint org; policy must define either-side revocation semantics | Required |

### Notes

- `org.links.*` are proposed permissions for the existing organization-to-organization link feature. They are not in the initial atomic catalogue and need a product decision: retain, redefine, or retire for InOne Business.
- `org.members.leave` is a proposed self-service action distinct from administrator removal. It should not allow a caller to nominate another target.
- Current `POST /orgs/:id/members/:uid/role` should not be expanded directly into arbitrary permission editing. Prefer a new explicit position/grant/delegation API after policy review.
- Current `GET /orgs/:id/admin-log` is an organization admin action journal, not a room message/event API. Existing test explicitly ensures org admin does not gain room content without room membership.

## 3. Platform organization-request routes — separate authority domain

These routes administer the platform onboarding/approval queue, not ordinary InOne Business membership. Their platform-level privileges must remain separate from organization position/permissions.

| Existing route | Current documented access | Proposed policy | Audit |
|---|---|---|---|
| `POST /org-requests` | Any authenticated user | `platform.org_requests.create_self` or authenticated self-service policy | Required |
| `GET /org-requests` | Applicant sees own; platform staff sees all | Self-scope OR platform-specific read permission | Required for staff-wide access |
| `GET /org-requests/:id` | Applicant; platform staff read-only | Applicant ownership check OR platform request-read permission | Required |
| `POST /org-requests/:id/documents` | Applicant while request pending | Self-owned request + pending state | Required; validate file type/size/secrets |
| `GET /org-requests/:id/documents/:docId` | Applicant; platform staff read-only | Request ownership OR platform document-read permission | Required document-view event |
| `POST /org-requests/:id/decision` | Platform owner only | Dedicated `platform.org_requests.decide` | Required; decision idempotency and state transition |

Do not map platform owner/admin to InOne Business Owner/Director. They are different trust boundaries and identity scopes.

## 4. Cross-cutting resource authorization found in the contract/tests

| Resource boundary | Existing behavior evidenced | Target requirement |
|---|---|---|
| Organization membership | `org_members` keyed by `(org_id,user_id)`; `/orgs/mine` returns own memberships | Keep organization-scoped membership as the tenant boundary |
| Multi-organization person | Existing composite key and tests/data model support multiple memberships | Resolve membership independently for every requested org |
| Organization status | Several write/link routes reject unapproved organizations | Model approval status as a resource-state guard, not a permission grant |
| Private rooms | Org admin cannot read room events without room membership | Preserve room membership/MLS boundary independently of org authority |
| Room ownership on leave/remove | Leave/removal may be blocked if member owns rooms | Keep explicit transfer/ownership lifecycle; do not bypass with elevated org role |
| Last owner | Last owner cannot be demoted/removed | Preserve invariant; owner changes use protected flow |
| Organization links | Accepting side cannot accept its own proposal | Preserve proposer/acceptor separation and prevent self-approval if the feature remains |

## 5. Existing tests and coverage gaps

### Existing tests evidenced

`test/org-management.test.js` covers:
- ordinary member cannot invite;
- admin cannot invite an admin, but can invite ordinary member;
- owner can invite admin;
- duplicate membership rejected;
- admin cannot change role; owner can;
- last owner cannot be demoted;
- second owner can be added and first owner can then be demoted;
- leaving org revokes ability to rejoin org room;
- owner with owned rooms cannot leave;
- admin cannot remove owner but can remove ordinary member.

`test/admin-journal.test.js` covers:
- member add, role change, member remove, org-link propose/accept/revoke and settings change appear in admin journal;
- actor and role-change before/after detail recorded;
- ordinary member cannot read admin journal;
- organization admin cannot read room events without room membership.

### Not covered by existing tests (for new model)

- seven-level hierarchy and strict peer/superior denial;
- one person with different positions/permissions across multiple organizations;
- department and team resource scoping;
- custom positions and permission ceilings;
- delegation chain intersection, expiry, revocation propagation and non-amplification;
- self-grant/self-elevation through alternate endpoints;
- observer/auditor read-only restrictions and scope;
- employee-specific and position-specific monetary limits;
- missing-limit fail-closed behavior and currency handling;
- dual approval, owner-initiated transaction eligibility, self-approval denial;
- immutable payload/hash invalidation after transaction edits;
- concurrent approval/release idempotency;
- policy versioning and policy-change approval;
- audit tamper resistance, retention and access-to-audit events.

These are gaps against the **new approved target**, not necessarily defects against the legacy POC contract.

## 6. Implementation implications

1. Keep existing endpoints and compatibility behavior until new APIs and migration are approved.
2. Add a centralized authorization service rather than scattering new rank comparisons through handlers.
3. Resolve the target resource from storage before checking department/team scope.
4. Keep platform request permissions separate from organization membership permissions.
5. Preserve room membership as a separate gate; org membership or admin status must never imply room membership.
6. Add explicit position/grant/delegation APIs; do not overload the legacy role enum.
7. Add audit writes transactionally with the state change where possible.
8. Recheck permission, scope, limit and approval state at mutation/execution time.
9. Roll out new policy in shadow mode before enforcement.
10. Run the existing org tests unchanged as compatibility regression tests, then add the new negative/security matrix.

## 7. Evidence limitations

- The route catalogue is taken from the engine's `ORG_API.md` and corroborated with the source search and existing tests.
- This was a read-only source inspection, not a fresh runtime test run.
- No claim is made that every route implementation detail or every platform role has been exhaustively verified from a running service.
- The audited POC is historical/reference code for the architecture restart, not accepted production implementation.
