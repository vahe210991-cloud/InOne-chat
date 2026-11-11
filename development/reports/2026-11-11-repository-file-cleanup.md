# Repository file cleanup audit — 2026-11-11

Repository: `vahe210991-cloud/InOne-chat`  
Base: `main` at `f2ac0b28fb36b3c478ede15f934cf248a56c850b`  
Task branch: `cleanup/remove-duplicate-archive-readme-2026-11-11`

## Scope and method

- Read the mandatory repository workflow rules and the repository handover/continuity instructions.
- Inspected the complete Git tree through GitHub's recursive Git Trees API: 964 entries (853 files), not truncated.
- Compared blob SHA values to identify exact byte-for-byte duplicates.
- Checked for obvious generated/cache/temp paths (`node_modules`, `.dart_tool`, build/dist/target, coverage, `.DS_Store`, logs, tmp, backup and swap files): none were present in the inspected tree.
- Searched the default branch for references to the duplicate archive README names.

## Deleted

- `README-ARCHIVE.md` — removed from this task branch.
  - It was byte-for-byte identical to `README-ARCHIVE-0.6.0.md` (same Git blob SHA `09d8ce05bdcc73fad5555127004149f8d4113250`, both 2,490 bytes at audit time).
  - No repository content references to the generic path were found.
  - The version-explicit `README-ARCHIVE-0.6.0.md` is retained as the canonical archive guide.
  - The deleted path returns HTTP 404 on the task branch; the retained file remains retrievable with the original blob SHA.

## Explicitly retained

- `TEST_REPORT_0.6.0.md` and its copies under `inone-development-archive-0.6.0/` and `inone-engine-poc-0.6.0/`: identical content appears in distinct project/archive/release locations. These are retained because their location is part of the archive and historical provenance; no copies were removed.
- `inone-engine-poc-0.6.0/package-lock.json` and `inone-development-archive-0.6.0/engine/package-lock.json`: same blob SHA, but each belongs to a distinct working/archive tree and may be required for reproducible installation from that tree.
- The duplicated engine source, migration and test files under the 0.6.0 archive and engine paths: retained as historical source snapshots, not treated as disposable duplicates.
- Duplicate PNG blobs under different approved UI screen/state paths: retained because path identity may be referenced by manifests and visual tests.
- `Ui.zip`, UI source assets, checksums, owner artifacts, migrations, test fixtures, security reports and historical handover reports: retained.

## Verification

- Recursive tree inspection: PASS, complete response (`truncated=false`).
- Exact duplicate detection: PASS.
- Reference search for `README-ARCHIVE.md`: no internal path reference found.
- Deleted path on task branch: NOT FOUND (expected).
- Retained `README-ARCHIVE-0.6.0.md`: PASS, fetched successfully.
- Application tests/builds: NOT RUN; this change deletes one Markdown duplicate and does not modify application code.
- Local `git diff --check`: NOT RUN; no local clone was used. GitHub tree and file retrieval were used to verify the remote result.

## Outcome

One confirmed redundant Markdown file was removed. No archive directories, source files, tests, dependencies, lockfiles, assets, or security materials were deleted. This is a deliberately conservative first cleanup pass; other identical blobs were retained where their separate paths have archival or runtime significance.
