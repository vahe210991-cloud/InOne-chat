# InOne — Beta 2.0 and later roadmap

Status: planning backlog only. Captured 2026-11-08. No implementation order or release date is approved yet.

## Product direction

Beta 2.0 and later versions may extend group conversations from messaging into collaborative workspaces. Features below are candidates for product discovery, UX definition, security review, and phased delivery. Some may intentionally be deferred to later beta releases.

Do not expand Beta 1.0/P0 scope with these items. Keep this roadmap on its own branch until the product owner approves scope and sequencing.

## New group capabilities requested

### G1. Group events and attendance
- A group administrator can create, edit, and cancel an event.
- Event details: title, description, start/end date and time, timezone, location or meeting link.
- Notify eligible group members when an event is published; notify again on material changes or cancellation.
- Each participant can respond **Going** or **Not going**, and can change their response.
- Show attendance totals and an authorized participant response list.
- Decide later whether to add tentative/maybe, reminders, calendar export, recurring events, guest lists, and event attachments.

### G2. Group polls
- Create polls inside a group with a question and answer options.
- Decide between single-choice and multiple-choice per poll.
- Optional closing time; optional anonymous voting.
- Members can vote and, where configured, change a vote before closure.
- Display results with privacy behavior appropriate to anonymous/non-anonymous mode.
- Later candidates: scheduled polls, quiz mode, ranked-choice voting, and poll templates.

### G3. Personal favorite messages
- Members can mark/unmark messages as personal favorites.
- Provide a dedicated list of previously favorited messages, filterable by group.
- Open the original message in its group context.
- Favorites are private to the user, unlike group-wide pins.
- Handle deleted messages and revoked room access without leaking message content.

### G4. Group search
- Search messages within the current group.
- Consider a cross-group search entry point, subject to organization and membership permissions.
- Candidate filters: sender, date range, message type, attachments/files.
- Results link to the original message and show safe surrounding context.
- Search must re-check authorization at result access time; deleted, redacted, or inaccessible content is not exposed.

### G5. Bots in groups
- Authorized group administrators can add and remove bots.
- Display bot identity, publisher, requested permissions, and capabilities before installation.
- Use explicit, revocable, least-privilege scopes.
- Distinguish bot messages and actions from human participants.
- Define separate grants for reading history, receiving new messages, posting, accessing files, and managing events/polls.
- Audit installation, permission changes, actions, and removal.
- This feature requires a separate security and abuse review before scheduling.

### G6. Pinned messages
- Authorized group members can pin/unpin messages under group permission rules.
- Provide a dedicated pinned-messages list in each group.
- Show who pinned each message and when; navigate to the original message.
- Define pin limit, ordering, and behavior when the source message is deleted or becomes inaccessible.

## Cross-cutting requirements

- All shared group actions require server-side authentication and authorization.
- Personal favorites remain private; pins, events, and polls are shared group state.
- Notifications must respect membership, privacy, mute settings, and existing notification delivery/retry mechanisms.
- Duplicate requests and retries must be idempotent.
- Persist state across restarts and multiple devices.
- Search, bots, events, and polls must respect the established MLS-protected group architecture; no plaintext bypass or fake encryption.
- Define API contracts, database migrations, audit events, offline behavior, push/in-app notifications, and Flutter UX before implementation.
- Each capability needs unit, integration, authorization, multi-device, and failure/retry tests.

## Candidate phased delivery (not approved)

The following is a discussion aid, not a commitment:

1. **Foundation / UX discovery:** shared interaction patterns, permissions, notification preferences, message metadata model.
2. **Small message utilities:** personal favorites + favorites list; pinned messages + pinned list. These are distinct: favorites are per-user, pins are shared.
3. **Group interaction:** polls, including privacy and voting rules.
4. **Group planning:** events, RSVP, notifications, reminders, and possible calendar integration.
5. **Findability:** group search after access-controlled indexing and retention behavior are designed.
6. **Extensibility:** bot framework after permission scopes, auditability, sandboxing, and abuse controls are reviewed.

The product owner may split these across Beta 2.0, Beta 2.1, Beta 3.0, or later releases. No feature is required to ship in the first Beta 2.0 increment.

## Existing InOne product context (carry forward; not a new request)

Previously defined product capabilities remain part of the broader InOne direction and should not be mistaken for new scope introduced by this roadmap:
- Personal account and profile, phone/email confirmation, display name, avatar, and cover image.
- Corporate group conversations and personal direct messages.
- AI assistant **Синди**, with user-selectable AI provider/model and intended workflows for file processing, business correspondence, archiving, accounting/management-accounting support, and financial snapshots.
- Integrated task manager and calendar; task creator, executor, and observer roles; file attachments; comments surfaced in Messages; CRM task number; Синди progress tracking and observer notifications.

These existing capabilities still require their own version/scope decisions and acceptance criteria. This roadmap does not assert that they are implemented or production-ready.

## Product decisions to make before implementation

For each candidate, agree:
- Release target (Beta 2.0 / 2.1 / 3.0 / later).
- User stories and final interaction flows.
- Group roles and permission matrix.
- Notification and privacy behavior.
- Data retention, deletion, and audit policy.
- API/data model and migration plan.
- Acceptance criteria and rollout/feature-flag strategy.

## Explicit exclusions

- No feature in this document is claimed to be implemented.
- No Beta 2.0 release scope or delivery date is approved by this document.
- No changes to `main` or Beta 1.0/P0 acceptance scope are authorized.
