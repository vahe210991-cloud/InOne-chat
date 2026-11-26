# Chat & Groups Beta 1.0 audit — 2026-11-26

- **Audited source:** `main` at `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`.
- **Task branch:** `audit/chat-groups-beta1-main-216c6d9-20261126`.
- **Detailed implementation plan:** [CHAT-GROUPS-BETA-1.0-IMPLEMENTATION-PLAN.md](../CHAT-GROUPS-BETA-1.0-IMPLEMENTATION-PLAN.md).
- **Result:** SOURCE REVIEW COMPLETE / RELEASE ACCEPTANCE NOT READY.
- **Application source changed:** No. This work adds/updates documentation only.

## Findings

| Priority | Count | Main result |
|---|---:|---|
| P0 | 1 | Legacy server-side room member removal does not perform MLS Remove Commit/epoch transition |
| P1 | 2 | Direct member add bypasses MLS Add/Welcome; one-to-one chat model/API is absent |
| P2 | 8 | Channel mapping, history pagination, list summaries/unread, group creation UX, group lifecycle UI, message actions, real-time sync evidence, Flutter widget/integration coverage |
| P3 | 0 | No separate confirmed P3 finding |

### Critical evidence

- `engine/src/server.js:2333`: direct `DELETE /rooms/:roomId/members/:userId` calls `storage.removeRoomMember` without an MLS Commit.
- `engine/src/store.js:1762`: the store operation deletes the room_members row.
- `engine/src/server.js:2260`: direct `POST /rooms/:roomId/members` adds server membership without MLS Add Commit/Welcome.
- The current API contract says direct member DELETE must not be exposed and that removal must use the native MLS operation. The UI uses the native path, but the backend route remains accessible.
- This proves a server/MLS membership consistency defect. It does **not** prove that the removed user can directly fetch new ciphertext through the server: current event ACL denies non-members. The security defect is that the old MLS group state/epoch is not cryptographically revoked by the legacy removal path.

## Architecture and readiness

- Canonical production client is Engine B: `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`.
- Flutter → Rust FFI, OpenMLS, SQLCipher, protected Android/iOS key-store adapters, durable inbox/outbox and AES-GCM attachment path are present in source.
- Backend supports groups, public/private visibility, join policies, owner/admin/member roles, capabilities, invites and join requests.
- Backend supports channels as a distinct kind, but Flutter mapper currently maps channel to group.
- Direct one-to-one conversation creation/reopen and uniqueness are not implemented in the reviewed backend contract.
- `INONE_MLS_NATIVE_ENABLED` remains false by design. Do not enable it from this audit.

## Verification boundary

No tests, builds, live server, database, simulator or physical device were started during this audit. Existing CI on parent code SHA `baec9c083ed51ab5004e5f1b1e99aca6b4f2476a` had five successful workflows: #45759098791, #45759098767, #45759098819, #45759098778, #45759098794. Current documentation-only HEAD `216c6d9...` has no Actions runs; the previous runs are not relabelled as exact-current-SHA PASS.

## Next work

1. Close CHAT-P0-01: all MLS removals must require Remove Commit and epoch transition.
2. Close CHAT-P1-01: prevent direct REST member addition without Add Commit/Welcome.
3. Implement the approved Beta 1.0 one-to-one chat model and create-or-open path.
4. Complete pagination, channel mapping, group lifecycle UX and Flutter integration coverage.
5. Run the exact-SHA backend/PostgreSQL/Rust/OpenMLS/Flutter/platform acceptance matrix only when authorized and safe.

WBS v1.1 and Beta 1.0/Beta 2.0 boundaries are unchanged.
