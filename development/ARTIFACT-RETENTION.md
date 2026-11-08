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

The exact same bytes were independently recovered from GitHub Actions artifact `InOne-P0-snapshot-2026-11-08`, run #2 (run ID `42480781656`, artifact ID `13617261673`). Its extracted bundle SHA-256 matched the owner's upload exactly. The bundle is the snapshot at commit `16eab726106ae04b4979af2a1646c2052233b87c`.

Important: a newly generated bundle from a later commit may contain the same history plus newer documentation commits and may have a different SHA-256. That regenerated snapshot is a separate artifact; it does **not** replace or satisfy retention of the exact owner-supplied bytes.

## Permanent repository location

- Repository: `vahe210991-cloud/InOne-chat`
- Permanent archive branch: `artifacts/p0-bundles`
- Exact owner-supplied bundle: `bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle`
- Exact owner-supplied checksum: `bundles/owner-upload-2026-11-08/SHA256SUMS.txt`
- Source commit metadata: `bundles/owner-upload-2026-11-08/SNAPSHOT-COMMIT.txt`
- Pointer to exact original: `bundles/OWNER-SUPPLIED-ORIGINAL.txt`
- Latest regenerated snapshot pointer: `bundles/LATEST.txt`
- Regenerated snapshots are retained by source commit under `bundles/<SNAPSHOT_COMMIT>/`.

The workflow `.github/workflows/export-p0-snapshot.yml` downloads the original owner bundle from the first verified Actions export, checks its expected SHA-256 and Git bundle integrity, and commits those exact bytes to the permanent archive branch. It also archives each newly generated complete snapshot separately.

## Status and verification gate

The temporary Actions artifact expires on 2027-02-06 and is only the workflow's transport source. It is not permanent storage.

The permanent branch is considered complete only after all of the following are verified:

1. `artifacts/p0-bundles` exists in GitHub.
2. The exact owner-supplied bundle path above is present.
3. Its GitHub blob SHA matches the local Git blob SHA for the supplied file, and its stored SHA-256 file records `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`.
4. A downloaded copy has the same SHA-256 and passes `git bundle verify`.
5. The archive commit SHA and GitHub URL are recorded below.

Do not claim permanent storage before these checks pass.

### Permanent storage verification

- Status: PENDING final exact-byte verification.
- Branch: `artifacts/p0-bundles`
- Exact owner bundle path: `bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle`
- Expected SHA-256: `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`
- Archive commit: pending
- GitHub URL: pending

## Required procedure for every future session

1. Read this file and `development/WORKING-RULES.md` before asking for any source artifact.
2. Fetch `artifacts/p0-bundles` and read `bundles/OWNER-SUPPLIED-ORIGINAL.txt`.
3. Retrieve the exact bundle at the path in that pointer.
4. Verify SHA-256 and `git bundle verify`.
5. Restore/inspect the complete history from the bundle as needed.
6. If the permanent path is unavailable, inspect the branch history and Actions artifact run #2 before declaring it missing. **Never ask the owner to upload this file again.**
7. Any newly created bundle must be archived automatically by the workflow and its SHA-256 retained in the corresponding versioned directory.

## Why this is mandatory

Repeatedly requesting an artifact already supplied by the owner wastes time and breaks project continuity. The repository, not a chat session, is the durable handover mechanism. An uploaded file is not considered retained until the exact bytes are stored and verified in GitHub.
