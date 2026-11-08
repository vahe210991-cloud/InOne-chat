# Group collaboration features — product requirements

Status: captured from product-owner request on 2026-11-08. This is a requirements record, not an implementation claim.

## Scope

Add the following capabilities inside group conversations. Keep the existing organization, room membership, role/permission, message authorization, notification, and MLS security boundaries. No message or event payload may bypass the established authenticated group transport.

### 1. Group events and attendance

- A group administrator can create an event in the group.
- Event fields should include a title, description, start date/time, optional end date/time, location or meeting link, and creator.
- On publication, notify group participants that an event was created.
- Each participant can respond **Going** or **Not going**; preserve the response and allow it to be changed.
- Show attendance totals and a participant response list to users authorized by group policy.
- Event updates/cancellation notify participants and retain an auditable event history.
- Define behavior for members who join after event publication and for removed members before implementation.

Acceptance:
- Only authorized administrators can create, edit, or cancel group events.
- Every eligible member receives an in-app notification; delivery/retry follows the existing notification infrastructure.
- RSVP is scoped to the authenticated member and is idempotent.
- Time values are stored consistently (UTC instant plus explicit timezone for display).

### 2. Group polls

- Members with the relevant group permission can create a poll in the group.
- A poll has a question and multiple answer options.
- Support single-choice and (if enabled by the creator) multiple-choice voting.
- Support optional closing time and optional anonymous voting; expose these modes clearly before voting.
- Members can cast or change a vote while the poll is open; enforce one valid vote per member according to the selected mode.
- Display live or refreshed results according to the poll's privacy mode.
- Poll creation, closing, and result changes must be reflected consistently across group clients.

Acceptance:
- Server validates membership, poll state, option IDs, and voting constraints.
- Duplicate requests do not create duplicate votes.
- Closed polls reject new or changed votes.
- Anonymous polls do not expose a mapping from member identity to selected option in ordinary group UI.

### 3. Favorite messages

- A member can mark/unmark a message as a personal favorite.
- Favorites are per-user, not a group-wide shared state.
- Provide a dedicated list of previously favorited messages, grouped or filterable by group.
- Each item links back to the original message and its group context.
- If the original message is deleted or becomes inaccessible, show an explicit unavailable state and do not leak its contents.

Acceptance:
- Favorite/unfavorite is idempotent.
- The list is scoped to the current authenticated user and respects current room access.
- Ordering and pagination are stable.

### 4. Search in groups

- Search messages within the current group, with a broader group-search entry point where authorized.
- Support keyword search and filters such as sender, date range, and message type; add file search only where file indexing/permissions support it.
- Search results show enough context to identify the hit and open the original message.
- Results must be re-authorized at read time; removed members cannot use stale search results to read protected content.

Acceptance:
- Search never crosses room/organization boundaries without explicit authorized scope.
- Deleted, redacted, or inaccessible content is not returned.
- Pagination and ordering are deterministic.

### 5. Bots in groups

- Authorized group administrators can add and remove bots.
- Show bot identity, publisher/owner, and requested permissions before installation.
- Use explicit permission scopes, least privilege, and revocable credentials.
- Distinguish bot messages/actions from human members.
- Define whether a bot can read history, receive new messages, post, manage events/polls, or access files; default to no access until granted.
- Audit bot installation, permission changes, actions, and removal.

Acceptance:
- A bot cannot access a room or capability without explicit grant.
- Revoking access takes effect promptly and invalidates credentials.
- Bot actions are attributable and rate-limited.

### 6. Pinned messages

- Authorized members can pin/unpin messages according to group permissions.
- Provide a dedicated pinned-messages view/list in each group.
- Show who pinned an item and when; preserve ordering and allow navigation to the original message.
- Handle deleted or inaccessible source messages without leaking content.

Acceptance:
- Pin/unpin is permission-checked and idempotent.
- Pin state is synchronized to all authorized group clients.
- A bounded/defined pin limit and ordering policy must be selected before implementation.

## Shared design and security requirements

- All actions are authenticated, authorized server-side, and audited where they change shared group state.
- Personal favorites are private to the user; pinned messages are shared group state.
- Notifications are emitted only to eligible members and must not expose hidden poll choices or protected content in previews.
- Persisted state must survive restart and retry safely under duplicate delivery.
- Do not introduce fake encryption, plaintext bypasses, or alternate message-delivery paths. Integrate with the existing MLS-protected group architecture.
- Define migrations, API contracts, client state, offline/retry behavior, notification UX, and acceptance tests before implementation.

## Suggested delivery order (after P0 is accepted)

1. Pinned messages and personal favorites (small, well-scoped message metadata).
2. Group polls (shared state and vote privacy).
3. Group events and RSVP notifications.
4. Group search (after access-control-aware indexing strategy is approved).
5. Bot framework and permission model (largest security review surface).

No feature in this document is claimed to be implemented by the current P0 branch.
