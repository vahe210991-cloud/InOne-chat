# P0 binary artifact retention — mandatory

**Owner instruction, 2026-11-08:** "Я отправляю файл в последний раз. Больше этот файл не буду отправлять."

This is a binding handover rule. The owner will not upload this bundle again. Future sessions and agents must retrieve it from GitHub. **Do not ask the owner to resend it.**

## Supplied artifact

| Field | Verified value |
|---|---|
| File | `InOne-P0-snapshot-2026-11-08.bundle` |
| Size | 2,476,944 bytes |
| SHA-256 | `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e` |
| Bundle HEAD | `16eab726106ae04b4979af2a1646c2052233b87c` |
| Git verification | PASS — complete history; bundle verifies successfully |
| Supplied in chat | 2026-11-08; final owner upload |

The exact same bytes were independently recovered from GitHub Actions artifact `InOne-P0-snapshot-2026-11-08`, run #2 (run ID `42480781656`, artifact ID `13617261673`). Its extracted bundle SHA-256 matched the owner's upload exactly. This confirms the bundle corresponds to the repository's snapshot HEAD.

## Permanent repository location

- Repository: `vahe210991-cloud/InOne-chat`
- Permanent archive branch: `artifacts/p0-bundles`
- Permanent path: `bundles/InOne-P0-snapshot-2026-11-08.bundle`
- Companion metadata: `bundles/SHA256SUMS.txt` and `bundles/SNAPSHOT_COMMIT.txt`

The GitHub Actions workflow `.github/workflows/export-p0-snapshot.yml` must write the bundle bytes to this branch on every snapshot export. The branch is separate from product source and must not be merged into `main`. Keep all historical bundle versions; do not overwrite or delete prior snapshots.

## Status and verification gate

The short-lived Actions artifact exists but expires on 2027-02-06. It is not sufficient permanent retention. The permanent branch is considered complete only after all of the following are verified:

1. `artifacts/p0-bundles` exists in GitHub.
2. The exact bundle path above is present on that branch.
3. The file downloaded from GitHub has SHA-256 `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`.
4. `git bundle verify` succeeds against the downloaded copy.
5. The commit SHA and GitHub URL are recorded below.

Do not claim permanent storage before these checks pass.

### Permanent storage verification

- Status: PENDING until the retention workflow's first successful push is verified.
- Branch: `artifacts/p0-bundles`
- Path: `bundles/InOne-P0-snapshot-2026-11-08.bundle`
- Stored blob SHA-256: pending
- Archive commit: pending
- GitHub URL: pending

## Required procedure for every future session

1. Read this file and `development/WORKING-RULES.md` before asking for any source artifact.
2. Fetch `artifacts/p0-bundles` and retrieve the bundle at the permanent path.
3. Verify its checksum and `git bundle verify`.
4. Restore/inspect the complete history from the bundle as needed.
5. If the permanent path is unavailable, inspect the branch history and Actions artifact run #2 before declaring it missing. Never ask the owner to upload this same file again.
6. Any newly created bundle must be archived automatically by the workflow and its SHA-256 added to this document or a versioned manifest.

## Why this is mandatory

Repeatedly requesting an artifact already supplied by the owner wastes time and breaks project continuity. The repository, not a chat session, is the durable handover mechanism. An uploaded file is not considered retained until the exact bytes are stored and verified in GitHub.
