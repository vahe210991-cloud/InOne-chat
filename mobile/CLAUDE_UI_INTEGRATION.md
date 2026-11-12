# Claude UI handoff — integration notes

Source handoff: `Ui.zip` → `ui-approval.zip` → `ui-approval/screen-manifest.json`.

## Integration rules
- Screen matching is by stable ID, never by approximate title.
- The canonical ID/path map is `lib/claude_screen_catalog.dart`.
- The handoff contains 31 screen HTML files: 24 in the manifest's `screens` list plus 7 approved-v1 files.
- Screens not present in the handoff remain in the existing development gallery; they are not deleted.
- The current change labels deferred concepts as placeholders and does not claim their API integration is complete.
- The next integration step is to bundle the original HTML/CSS/JS source files and wire the host to select them by ID without changing the supplied visual design.

## Beta 2.0 retained placeholders
- `leads-light`, `leads-dark`
- `kanban-light`, `kanban-dark`
- `deal-detail-light`, `deal-detail-dark`

These screens remain in the approved-screen gallery, with a visible `Beta 2.0 · заглушка` label. Do not delete or implement them as Beta 1.0 features.

## Current boundaries
- This branch is a development integration branch based on the existing PR #30 head.
- No merge to `main`, production release, or public backend/database exposure is performed here.


## Current owner-authorized design handoff — 2026-11-12

For new UI/UX design work, Claude must follow:
- `development/integrations/CLAUDE-UI-DESIGN-HANDOFF-2026-11-12.md`
- `development/reports/2026-11-12-inone-system-audit-and-gap-plan.md`

The audit includes the 31-screen inventory, screen-by-screen industry UX benchmark review, API integration gaps and Beta 1.0 scope boundaries. Claude is authorized for UI/UX design deliverables only; ChatGPT owns technical integration and acceptance. No API keys or secret values are supplied or required for design.