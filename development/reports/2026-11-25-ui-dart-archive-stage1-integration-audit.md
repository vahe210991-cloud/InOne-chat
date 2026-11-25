# InOne UI Dart archive — Stage 1 integration audit

**Date:** 2026-11-25  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** `main` at `74169a449de182ea734049e21d8424dfc4091c88`  
**Working branch:** `feature/ui-dart-archive-stage1-2026-11-25`  
**Inputs:** `Ui dart.zip` and `Ui dart part 2.zip`

## Decision

The two archives are a candidate native Flutter UI source set, not a self-contained drop-in module. Do not place their Dart files under `mobile/lib` or export them from `mobile/lib/ui_dart_source/inone.dart` until the missing dependencies and API contracts are resolved.

The existing app imports `mobile/lib/ui_dart_source/inone.dart`. That module and the current `main` screens are the live baseline. The approved HTML screens remain the visual/interaction reference; the Dart implementation must be reconciled against them, not used to redefine the approved design.

## Archive inventory

- Archive 1 contains task list/details/create/Kanban screens, project list/card screens, another-user profile, task models/widgets/demo data, a task gallery, translations and README.
- Archive 2 contains CRM lead/card/stage/note screens, organization list/member-role/settings/journal/links/leave screens, CRM/organization models/demo data, a CRM/organization gallery, translations, navigation notes, localization runtime and text wrapper.
- Both archives contain `inone_translations.dart`. Their key/value entries were merged in the prepared staging bundle; no differing duplicate values were found.
- Archive README says the screens are callback-driven and do not own HTTP/navigation. It also states Flutter analyze and tests were not run.

## Confirmed integration blockers

The candidate files import shared modules that are not present at the expected paths on `main`:

- `widgets/inone_screen_kit.dart`
- `models/inone_social_models.dart`
- `widgets/inone_calendar_widgets.dart`
- `widgets/inone_post_card.dart`
- `demo/inone_social_demo_data.dart`
- `models/inone_settings_models.dart`
- `demo/inone_gallery_extra.dart`
- `widgets/inone_text.dart`

The missing imports were checked against both `main` and `feat/flutter-ui-dart-migration-2026-11-14`; the checked paths returned 404 on both refs. This is not a full repository-wide symbol search, but it is enough to block a safe direct copy into `mobile/lib`.

Further observations:
- `inone_gallery_tasks.dart` and `inone_gallery_crm_org.dart` import `inone_gallery_extra.dart`, absent from both archives and the checked repository paths.
- `inone_l10n.dart` imports `models/inone_settings_models.dart`, absent from both archives and the checked repository paths.
- Task and CRM models import `widgets/inone_screen_kit.dart`, so even non-gallery screens are not self-contained.
- The archive README calls for Noto Sans and Noto Sans Armenian font assets; the current `mobile/pubspec.yaml` does not declare these font assets. Asset availability was not established.
- The current app's existing `inone.dart` export list does not expose the candidate screens. No export or navigation changes were made.
- No backend route contracts were supplied with these archives. No new backend operations are assumed.

## Safe integration plan

1. Keep the existing production UI module and app navigation unchanged.
2. Recover the missing shared UI support files from the exact source revision that produced these archives, or replace them only after checking the approved HTML reference and current design-system contracts.
3. Compare each candidate screen with its approved HTML counterpart: layout, text, states, empty/loading/error behavior, accessibility and interaction.
4. Map every screen callback to an existing mobile repository/API contract. Keep unsupported operations disabled or explicitly deferred; do not create fake success behavior.
5. Resolve model overlap with existing `inone_models.dart` and domain models before adding duplicate presentation/domain types.
6. Merge localization deliberately. Preserve the current app's language source and verify Armenian/Russian/English placeholders and plural rules.
7. Add only the required fonts/assets and verify licensing and asset paths.
8. Integrate one vertical slice at a time, then update exports and navigation.
9. Run `dart format`, `flutter analyze`, unit/widget tests and device-level visual regression on the exact commit before promotion.

## Current execution status

| Work item | Status |
|---|---|
| Inspect both archives and classify files | COMPLETE |
| Merge duplicate translation maps | COMPLETE in prepared staging bundle; no conflicting duplicate values |
| Inspect current app entrypoint and UI exports on main | COMPLETE |
| Check key missing imports on main and Flutter migration branch | BLOCKED: dependencies absent at checked paths |
| Compare all screens to approved HTML | NOT RUN |
| Map callbacks to backend/mobile contracts | NOT RUN |
| Integrate source into `mobile/lib` | BLOCKED pending dependency recovery and design/API review |
| Flutter analyze / tests | NOT RUN |
| Change app navigation or backend | NOT CHANGED |

## Safety constraints

- Do not replace, delete, or downgrade the approved HTML reference screens.
- Do not change backend or MLS code as part of this UI import.
- Do not add candidate Dart files to the active `mobile/lib` tree while imports are unresolved.
- Do not merge this work to `main` until exact-SHA analysis, tests and HTML-to-Dart visual acceptance pass.
