# Beta 2.0 — screen gap audit

**Date:** 2026-11-25  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base inspected:** `main` at `74169a449de182ea734049e21d8424dfc4091c88`  
**Audit branch:** `feature/ui-dart-archive-stage1-2026-11-25`  
**Sources:** owner-approved `development/PROGRESS-BASELINE.md` v1.1, `docs/continuity/DECISIONS.md` §7, `mobile/README.md`, `Ui dart.zip`, `Ui dart part 2.zip`, current Flutter source tree.

## 1. Scope and product boundary

The owner-approved WBS v1.1 defines Beta 2.0 as a separate release with a 2% implementation / 0% verification baseline. Its workstreams are:

| Workstream | Weight | Baseline implementation / verification | Approved scope |
|---|---:|---:|---|
| Backend platform and API | 25% | 0% / 0% | Beta 2.0 domain/API |
| Frontend and CRM screens | 20% | 10% / 0% | Leads, Kanban, Deal detail placeholders only |
| CRM domain | 15% | 0% / 0% | entities, pipeline, permissions, CRUD |
| Cindy / AI assistant | 15% | 0% / 0% | model selection, files, correspondence, archive, accounting/finance |
| Tasks + Calendar | 15% | 0% / 0% | creator/executor/observer, attachments/comments/CRM number/notifications |
| Group collaboration extras | 5% | 0% / 0% | events/RSVP, polls, favorites, search, permissioned bots, pinned messages |
| QA, security, operations | 5% | 0% / 0% | acceptance/E2E/security/operations |

The owner separately approved two products on 2026-11-13:
- **InOne:** personal/social product: feed, publications, personal chats, groups, Threads and related community features.
- **InOne Business:** professional/work product: Kanban, CRM, Leads, Deals, Wallet, Flags and integration/interoperation with Propo Seller Account.

Therefore CRM, Kanban, Leads, Deals, Wallet and Flags must be classified under InOne Business. Do not merge both products into one navigation. The product split does not by itself decide separate/shared identity, backend, database, repository or infrastructure.

## 2. Existing code and delivered Dart archive

### CRM

Current `main` contains and exports these native UI widgets from `mobile/lib/ui_dart_source/inone.dart`:
- `InOneLeadsScreen` — `screens/main/inone_leads_screen.dart`.
- `InOneDealsBoardScreen` — `screens/main/inone_deals_board_screen.dart`.
- `InOneDealDetailScreen` — `screens/main/inone_deal_detail_screen.dart`.

The repository code search finds their call sites in the demo gallery, not in the production app host. They use in-memory/demo model inputs and callbacks; their existence is **UI source only**, not a connected CRM feature. They are the three placeholder concepts counted by the approved WBS baseline and must not be counted as missing source files.

The owner-supplied `Ui dart part 2.zip` adds these CRM-related Dart screens:
- `InOneAddLeadScreen` — add lead form.
- `InOneLeadCardScreen` — lead card/detail presentation.
- `InOneMoveStageSheet` — move lead/deal stage interaction.
- `InOneAddNoteScreen` — add activity/note form.

These four candidate screens are present in the supplied archive but are not yet integrated into the current production app source. They do not replace the existing Leads/Deals Board/Deal Detail widgets.

**CRM gaps still to specify/design:** end-to-end lead lifecycle and editing; deal create/edit and conversion/association rules; pipeline/stage administration; assignment/ownership and permission-denied states; search/filter/sort/empty/loading/error states; activity history and note lifecycle; CRM entity relationships and audit history. These are feature-level gaps inferred from the approved CRM domain scope, not a claim that each item has an already approved separate screen ID. The approved baseline does not enumerate every CRM screen.

### Tasks and projects

The owner-supplied `Ui dart.zip` contains:
- `InOneTasksListScreen` — task list.
- `InOneTaskDetailsScreen` — task details.
- `InOneNewTaskScreen` — create task.
- `InOneKanbanBoardScreen` — task Kanban.
- `InOneProjectsListScreen` — projects list.
- `InOneProjectCardScreen` — project card.
- `InOneProfileOtherScreen` — another user's profile.

These files are not present in the current `mobile/lib/ui_dart_source/screens` tree and are not yet integrated. They are source-delivered candidate screens, not absent design work. The archive describes the task roles as creator, executor and observer, and the approved WBS additionally requires attachments, comments, CRM number and notifications.

**Task screens/features still missing from the delivered archive/current native tree:** task edit/update flow; assignment/role management; comments/activity thread; attachment picker/list/preview; CRM record linking/number lookup; notification preferences/deep links; recurring/due-date/calendar linkage; filters/search and robust empty/loading/error/permission states. These are derived from WBS acceptance scope and require screen/API contract detail before implementation.

Projects list/card are in the Dart archive, but the approved Beta 2.0 WBS does not give Projects a separate weighted row. Keep them classified as InOne Business candidate screens until their exact release placement is approved.

### Calendar

The supplied task archive README describes a six-screen calendar group (screens 60–65):
- month view;
- week view;
- day view;
- event card/detail;
- new event;
- participant availability.

No calendar screen Dart files were present in either supplied ZIP, and no calendar screen files were found in the current native Flutter screen tree. Calendar is therefore a **confirmed source/UI gap** against the README's declared screen set and the Beta 2.0 Tasks + Calendar WBS.

The calendar scope also needs event edit/delete, recurrence, participant invitation/availability response, time-zone handling, reminders/notifications, task linkage and permission states specified before implementation. These are requirements to clarify, not existing approved screen IDs.

### Cindy / AI assistant

The approved WBS defines:
- model selection;
- file handling;
- business correspondence;
- archive;
- accounting/finance.

Neither supplied Dart ZIP contains Cindy screens. The current native screen tree has no Cindy/assistant screens. This is a **confirmed screen-source gap**. At minimum, the screen design backlog needs:
- assistant conversation/workspace;
- model/provider selection and model capability/settings;
- file attach/upload, processing status, preview and result;
- correspondence drafting/history;
- archive/search/reopen;
- accounting/finance overview and report/detail.

This is a functional grouping inferred from WBS, not a final screen count. The assistant's access to business data, file retention, provider/model routing, cost controls and permission boundaries need separate technical contracts.

### Group collaboration extras

The approved WBS includes events/RSVP, polls, favorites, search, permissioned bots and pinned messages. These are not included in the two supplied Dart archives as complete feature screens, and no matching dedicated screens were found in the current native screen tree. The screen backlog needs:
- event create/detail and RSVP/attendee state;
- poll create/vote/results;
- favorites/saved items;
- group/member/content search results and filters;
- bot directory/permissions/installation/configuration and bot conversation state;
- pinned messages list/manage/jump-to-message.

These may be implemented as chat-thread subviews, sheets or full screens; the WBS does not prescribe the presentation form. Keep the feature scope and permission states explicit.

## 3. Future concepts not yet proven to be Beta 2.0 scope

`mobile/README.md` separately lists 21 future concepts across calendar, tasks, files, CRM, Sindy AI, stories, geolocation and Propo map integration. This is a broad future-concept count, not a screen-by-screen Beta 2.0 acceptance specification.

The current approved Beta 2.0 WBS does not explicitly allocate separate screen groups/weights for Stories, Geolocation, Propo map, Calls, Feed, Wallet or Flags. Wallet and Flags are named in the InOne Business product direction, but no detailed Beta 2.0 screen/API inventory was found in the approved WBS or supplied Dart archives. These items must remain **scope clarification / candidate backlog**, not silently added to Beta 2.0 acceptance.

The Files capability is named in Cindy's approved WBS scope. A separate general-purpose file manager is not explicitly enumerated there; its relationship to Cindy file handling and the existing encrypted chat/document attachment flows needs a product decision.

## 4. Consolidated gap register

| Area | Current evidence | Status |
|---|---|---|
| CRM Leads / Deals / Kanban / Deal detail | Three UI widgets exist and are exported; demo-gallery call sites only | UI source exists; production integration and CRM domain/API are not accepted |
| CRM add lead / lead card / move stage / add note | Four screens in supplied Dart archive | Candidate source present; not integrated |
| Tasks list / details / create / Kanban | Four screens in supplied Dart archive | Candidate source present; not integrated |
| Projects list / card | Two screens in supplied Dart archive | Candidate source present; release placement requires classification |
| Other-user profile | One screen in supplied Dart archive | Candidate source present; product/API placement requires review |
| Calendar 60–65 | Described in archive README; absent from supplied ZIPs and current native screen tree | Missing Dart source |
| Cindy / AI | WBS only; no supplied/current screen source | Missing screen set and detailed UX/API contracts |
| Group extras | WBS only; no supplied/current dedicated screen source | Missing screen set; presentation form not specified |
| Wallet / Flags / Propo map / Stories / Geolocation | Product direction or broad future-concept mention; no approved screen-level Beta 2.0 inventory | Scope clarification required |

## 5. Recommended next sequence

1. Finish the current Beta 1.0 Dart integration without importing Beta 2.0 flows into its navigation.
2. Keep the three existing CRM widgets as non-production placeholders until InOne Business is given its own app/navigation and approved API contracts.
3. Integrate the delivered task/project and CRM candidate screens only in a separately scoped InOne Business branch after the product host and API ownership are agreed.
4. Produce the missing Calendar 60–65 Dart screens.
5. Create Cindy screen flows and contracts, then group collaboration extras.
6. Resolve Wallet, Flags, Stories, Geolocation and Propo map placement through a versioned Beta 2.0 scope decision.
7. Do not increase the approved Beta 2.0 WBS percentages: implementation remains 2%, verification 0% until accepted evidence exists.

## 6. Verification limits

- This is a source/document inventory, not runtime acceptance.
- No Flutter analyzer, tests, Android/iOS builds or physical-device tests were run for this audit.
- No Beta 2.0 backend/API implementation was verified; the approved WBS baseline for that workstream is 0%.
- No product-code changes or main-branch changes were made by this report.
