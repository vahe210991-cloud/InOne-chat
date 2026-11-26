# InOne UI Dart archive — Stage 1 integration audit

**Date:** 2026-11-25  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** `main` at `74169a449de182ea734049e21d8424dfc4091c88`  
**Working branch:** `feature/ui-dart-archive-stage1-2026-11-25`  
**Inputs:** `Ui dart.zip` and `Ui dart part 2.zip`

## Owner-approved workflow and implementation decision

The owner clarified the workflow:

1. Screens are authored against the technical specification.
2. The owner reviews and approves the HTML presentation as a temporary visual acceptance artifact.
3. Dart screens are then produced from the approved screens, structurally and functionally, not by mandatory pixel-perfect conversion.
4. The Dart implementation is connected to the existing Flutter app and backend according to the technical specification.
5. Only after connection do we inspect actual behavior and appearance. If a discrepancy is found, the owner supplies a screenshot and a specific correction request.
6. The affected area is corrected in place.

**HTML files are not required, will not be restored, and are not a dependency or merge gate.** They are not part of the runtime implementation. Owner screenshots are the authoritative input for any later visual corrections. No preliminary HTML-to-Dart pixel comparison is required.

## Archive inventory

- Archive 1: task list/details/create/Kanban screens, project list/card screens, another-user profile, task models/widgets/demo data, task gallery, translations and README.
- Archive 2: CRM lead/card/stage/note screens, organization list/member-role/settings/journal/links/leave screens, CRM/organization models/demo data, CRM/organization gallery, translations, navigation notes, localization runtime and text wrapper.
- Both archives contain `inone_translations.dart`. Their key/value entries were merged in the prepared staging bundle; no differing duplicate values were found.
- The README describes a callback-driven screen contract: screens do not own HTTP or navigation; actions are host callbacks, with `null` indicating success and `InOneFailure.message` supplying errors. This is the contract to validate during integration.
- Archive docs describe intended screen groups, navigation, font assets, and known limitations. These are implementation inputs, not proof that all dependencies already exist in the current app.

## Integration findings

The supplied archives contain the feature screens and domain/presentation files, but several imports point to shared modules not included in either archive:

- `widgets/inone_screen_kit.dart`
- `widgets/inone_calendar_widgets.dart`
- `widgets/inone_ds_widgets.dart`
- `widgets/inone_icons.dart`
- `widgets/inone_widgets.dart`
- `widgets/inone_bottom_nav.dart`
- `widgets/inone_post_card.dart`
- `widgets/inone_text.dart`
- `models/inone_social_models.dart`
- `models/inone_settings_models.dart`
- `theme/inone_theme.dart`
- `state/inone_state.dart`
- `demo/inone_social_demo_data.dart`
- `demo/inone_gallery_extra.dart`

These are dependency-resolution tasks, not reasons to stop the entire integration. For each import, check the current `main` tree and existing mobile UI implementation first. Reuse compatible current modules; adapt only the candidate screen imports/types where practical; create a missing shared component only when its required contract can be established from the archive source and current design system. Do not pull a wholesale divergent branch into main just to obtain a helper.

Other checks:
- The old Flutter migration branch is heavily diverged from current `main` (GitHub compare: 646 commits ahead and 1,168 behind; merge base `1df19a001acb5f8c4892471ca4eaa0696e02c54d`). Do not merge or cherry-pick it wholesale.
- Archive README requests Noto Sans and Noto Sans Armenian font assets. Verify available fonts and pubspec configuration; add only if required by the actual implementation and license/source are established.
- The current app's existing exports/navigation must be inspected before adding routes. Do not overwrite existing screens or route definitions.
- No new backend routes are assumed. Map callbacks to existing API/repository contracts; where a required backend capability is absent, report that specific gap and do not fake a successful operation.

## Execution plan

1. Inspect current `main` app entrypoint, screen exports, navigation, domain models, design-system widgets and API repositories.
2. Build an import/dependency matrix for all 17 screens and shared modules. Reuse current code where contracts match.
3. Integrate screens by technical-specification feature groups, preserving current app architecture.
4. Connect callbacks to existing backend/mobile repository contracts. Clearly isolate any unsupported action.
5. Resolve model overlap with existing domain models; avoid duplicate competing representations.
6. Merge localization deliberately and verify hy/ru/en keys, placeholders and formatting.
7. Add required assets only after verifying paths and licenses.
8. Add exports/routes for completed feature slices without exposing unfinished flows.
9. Run formatting, static analysis, unit/widget tests and available device tests on the exact PR commit.
10. After the owner reviews the connected implementation, apply screenshot-led visual corrections where requested.

## Current execution status

| Work item | Status |
|---|---|
| Inspect both archives and classify files | COMPLETE |
| Read archive README and navigation instructions | COMPLETE |
| Merge duplicate translation maps | COMPLETE in prepared staging bundle; no conflicting duplicate values |
| Establish owner-approved HTML/Dart workflow | COMPLETE |
| Confirm HTML restoration/comparison is not required | COMPLETE |
| Inspect current app and resolve candidate imports | IN PROGRESS |
| Map all screen callbacks to existing backend contracts | NOT RUN |
| Integrate screens into active Flutter source | NOT RUN |
| Flutter analyze / tests | NOT RUN |

## Safety and scope constraints

- Do not restore, recreate, or require the temporary HTML approval files.
- Do not demand pixel-perfect HTML-to-Dart comparison.
- Technical specification and owner-approved Dart deliverables define the integration target; owner screenshots drive subsequent visual corrections.
- Do not change backend or MLS code as part of UI integration unless a concrete required contract gap is identified and separately approved.
- Do not expose unfinished actions as successful or connect routes before their dependencies are ready.
- Keep the PR unmerged until exact-SHA analysis/tests pass and the integrated feature slices are reviewable.
