# Feed Beta 1.0 API contract proposal

**Status:** DRAFT — owner review required before route, schema, or Flutter integration.  
**Baseline:** `main` at `7d34b99fcc026a828b838e211d039c575aeace1d`.  
**Scope authority:** owner approved Feed for Beta 1.0 and approved cross-account visibility for published general-feed items to all registered/authenticated InOne accounts. The documentation record is pending review in PR #172.

## 1. Binding product rules

1. Feed and user publications are part of InOne Beta 1.0.
2. Every published item intentionally included in the general/news feed is readable by every registered and authenticated InOne account.
3. Anonymous/unauthenticated requests are denied.
4. A publication ID, media ID, cursor, or signed URL is not an authorization credential.
5. Feed attachments, if/when enabled, inherit the parent publication's eligibility and must be re-authorized on every download.
6. Privacy variant В remains binding for profiles, drafts, private account data, and every non-Feed domain. This decision does not create public profiles, follow/block relationships, subscriptions, or a social graph.

## 2. Proposed first API slice

All routes below require a currently active authenticated device session. No endpoint is public.

| Method and route | Purpose | Authorization |
|---|---|---|
| `POST /posts` | Create and immediately publish the caller's text post | Authenticated author |
| `GET /feed` | Read the general news feed | Any authenticated account |
| `GET /posts/mine` | Read the caller's own publications | Authenticated author |
| `GET /posts/:postId` | Read one published post | Any authenticated account |
| `PATCH /posts/:postId` | Edit a post | Author only |
| `DELETE /posts/:postId` | Delete a post | Author only |

The general feed is newest-first. The own-publications list is newest-first and filtered by the authenticated account on the server. The API does not accept a caller-supplied author ID for either operation.

## 3. Proposed post DTO

```json
{
  "postId": "32 lowercase hexadecimal characters",
  "content": "Plain-text post content",
  "author": {
    "nickname": "Publicly displayed author nickname"
  },
  "createdAt": 1795000000123,
  "updatedAt": 1795000000123,
  "revision": 1,
  "isMine": false
}
```

- Do not return email, phone, verification state, provider links, security hints, device identifiers, organization membership, or other account/profile fields.
- Do not return the internal author user ID in the Feed DTO. `isMine` is computed server-side from the authenticated session.
- Showing the author's nickname to every authenticated Feed reader is a proposed minimal identity disclosure, not yet separately approved. Owner review must explicitly confirm it; otherwise the DTO must use a non-identifying author label.
- Content is rendered as plain text, not trusted HTML.
- Deleted posts are not returned by list or detail operations.

## 4. Proposed write semantics

### Create

Request:

```json
{
  "idempotencyKey": "16–128 URL-safe characters",
  "content": "Plain-text content"
}
```

- Normalize line endings and Unicode NFC; trim surrounding whitespace.
- Proposed limits: 5,000 Unicode code points and 16 KiB UTF-8.
- Same author + same idempotency key + same normalized content returns the original post.
- Same author + same key + different content returns `409 idempotency_conflict`.
- Proposed per-account create limit: 10 posts per minute. Return `429` on limit.
- The server generates the post ID and publication timestamp.

### Edit

Request:

```json
{
  "content": "Updated plain-text content",
  "expectedRevision": 1
}
```

- Only the author can edit.
- Revision is checked atomically. A stale revision returns `409 revision_conflict`.
- A caller who is not the author receives `404`, avoiding an ownership/existence oracle.

### Delete

- Only the author can delete.
- Deletion is idempotent from the caller's perspective. A deleted or non-owned post returns `404`.
- The storage layer should retain a minimal tombstone for idempotency and revision safety while removing the content from all read paths.

## 5. Proposed cursor contract

- Default page size: 20; allowed range: 1–50.
- Sort order: `createdAt DESC, postId DESC`.
- Cursor is an opaque, versioned encoding of the last returned `createdAt` and `postId`.
- Query uses keyset pagination, never OFFSET.
- Cursor validation is strict. Invalid cursors return `400 invalid_cursor`.
- Every page request still requires an active authenticated session; a cursor grants no access.

## 6. Media boundary

The existing `/files` API supports owner/device-bound files and room-member files. It does not currently support a post-to-file relationship or authenticated cross-account Feed downloads.

Therefore the first implementation slice should establish text-post lifecycle and authenticated Feed reads. Media attachment endpoints and schema changes must be a separate, reviewed sub-slice using the existing object store and signed-download pipeline. No public object URL or bypass of active-session/device checks is allowed. The approved owner rule for media applies once Feed media is implemented.

The approved UI manifest currently contains no Feed/post-composer screen. The production UI must be new native Flutter/Dart, not restored HTML/WebView. Media controls should not be exposed until the media contract and screen states are accepted.

## 7. Explicit exclusions from this slice

- Drafts and scheduled publication.
- Comments, reactions, shares, follows, subscriptions, blocks.
- Stories, ranking/recommendations, and public-profile endpoints.
- Public/anonymous web access.
- Feed media upload/download until its separate contract is reviewed.

These exclusions do not change the approved Beta 1.0 Feed commitment; they define the smallest safe first slice.

## 8. Required security and acceptance matrix

| Scenario | Expected result |
|---|---|
| Account A reads published post by account B with active session | `200` |
| No token, expired token, or revoked device reads Feed/post | `401` |
| Account A edits/deletes account B's post | `404` |
| Account A supplies account B's ID as an author filter | Rejected or ignored; server derives account identity |
| Repeated create with same idempotency key and same content | Original post returned; no duplicate |
| Repeated create with same key and different content | `409` |
| Stale edit revision | `409` |
| Forged or malformed cursor | `400`; no authorization bypass |
| Direct post ID lookup | Same authenticated read rule as Feed |
| Feed DTO inspection | No email, phone, provider, device, or private profile fields |
| Media download after media support is added | Active session and parent-post eligibility checked again |

## 9. Implementation dependencies

1. Finalize this API contract and first-slice boundary.
2. Add posts table/migration and PostgreSQL + in-memory store parity.
3. Add authenticated server routes and object-level authorization.
4. Add backend HTTP and PostgreSQL regression tests.
5. Add typed Dart models/repository and a native Feed/post-composer screen.
6. Add media support only after its separate contract and UI states are reviewed.
7. Run every applicable GitHub Actions workflow on one immutable final PR SHA. No task closes on source presence alone.
