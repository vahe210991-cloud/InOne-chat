# P0 binary artifact retention — mandatory

**Owner instruction, 2026-11-08:** "Я отправляю файл в последний раз. Больше этот файл не буду отправлять."

This is a binding handover rule. The owner will not upload this bundle again. Future sessions and agents must retrieve it from GitHub. **Do not ask the owner to resend it.**

## Supplied artifact

| Field | Verified value |
|---|---|
| File | `InOne-P0-snapshot-2026-11-08.bundle` |
| Size | 2,476,944 bytes |
| SHA-256 | `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e` |
| Git blob SHA-1 | `8d77f064b27784a1cf7119a0a3ee0d4c5ae74dbb` |
| Bundle HEAD | `16eab726106ae04b4979af2a1646c2052233b87c` |
| Git verification | PASS — complete history; bundle verifies successfully |
| Supplied in chat | 2026-11-08; final owner upload |

The exact same bytes were independently recovered from GitHub Actions artifact `InOne-P0-snapshot-2026-11-08`, run #2 (run ID `42480781656`, artifact ID `13617261673`). Its extracted bundle SHA-256 matched the owner's upload exactly.

Important: a newly generated bundle from a later commit may contain the same history plus newer documentation commits and may have a different SHA-256. That regenerated snapshot is a separate artifact; it does **not** replace the exact owner-supplied bytes.

## Permanent repository location

<badge label="PERMANENTLY ARCHIVED" color="success" />

- Repository: `vahe210991-cloud/InOne-chat`
- Permanent archive branch: `artifacts/p0-bundles`
- Archive commit containing the owner file: `718f7845abe45cda404d5ae1563f695e0233ddb2`
- Exact owner-supplied bundle: [bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle](https://github.com/vahe210991-cloud/InOne-chat/blob/artifacts/p0-bundles/bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle)
- Exact owner-supplied checksum: [SHA256SUMS.txt](https://github.com/vahe210991-cloud/InOne-chat/blob/artifacts/p0-bundles/bundles/owner-upload-2026-11-08/SHA256SUMS.txt)
- Source commit metadata: [SNAPSHOT-COMMIT.txt](https://github.com/vahe210991-cloud/InOne-chat/blob/artifacts/p0-bundles/bundles/owner-upload-2026-11-08/SNAPSHOT-COMMIT.txt)
- Pointer to exact original: [OWNER-SUPPLIED-ORIGINAL.txt](https://github.com/vahe210991-cloud/InOne-chat/blob/artifacts/p0-bundles/bundles/OWNER-SUPPLIED-ORIGINAL.txt)
- Latest regenerated snapshot pointer: [LATEST.txt](https://github.com/vahe210991-cloud/InOne-chat/blob/artifacts/p0-bundles/bundles/LATEST.txt)
- Regenerated snapshots are retained separately by source commit under `bundles/<SNAPSHOT_COMMIT>/`.

The workflow `.github/workflows/export-p0-snapshot.yml` downloads the original owner bundle from the first verified Actions export, checks its expected SHA-256 and Git bundle integrity, and commits those exact bytes to the permanent archive branch. It also archives each newly generated complete snapshot separately.

## Permanent storage verification — PASS

- Workflow run: [#13 — 42496934304](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496934304), conclusion SUCCESS.
- Branch: `artifacts/p0-bundles`.
- Archive commit: `718f7845abe45cda404d5ae1563f695e0233ddb2`.
- Exact path exists and is readable through GitHub Contents API.
- GitHub file blob SHA: `8d77f064b27784a1cf7119a0a3ee0d4c5ae74dbb`.
- Local uploaded file `git hash-object` SHA: `8d77f064b27784a1cf7119a0a3ee0d4c5ae74dbb`. The matching Git blob identity proves the stored GitHub file contains the exact same bytes as the supplied file.
- GitHub-stored `SHA256SUMS.txt` records the expected SHA-256 `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`.
- The original uploaded bytes passed `git bundle verify`; the retention workflow independently downloaded those same bytes and passed both the SHA-256 assertion and `git bundle verify` before committing them.
- Exact permanent file URL: https://github.com/vahe210991-cloud/InOne-chat/blob/artifacts/p0-bundles/bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle

The temporary Actions artifact expires on 2027-02-06 and is no longer the only copy. The exact bundle is now retained in the Git repository's dedicated archive branch.

## Required procedure for every future session

1. Read this file and `development/WORKING-RULES.md` before asking for any source artifact.
2. Fetch `artifacts/p0-bundles` and read `bundles/OWNER-SUPPLIED-ORIGINAL.txt`.
3. Retrieve the exact bundle at the path in that pointer.
4. Verify SHA-256 and `git bundle verify`.
5. Restore/inspect the complete history from the bundle as needed.
6. If the permanent path is unavailable, inspect the branch history and Actions artifact run #2 before declaring it missing. **Never ask the owner to upload this file again.**
7. Any newly created bundle must be archived automatically by the workflow and its SHA-256 retained in the corresponding versioned directory.

## Why this is mandatory

Repeatedly requesting an artifact already supplied by the owner wastes time and breaks project continuity. The repository, not a chat session, is the durable handover mechanism. This artifact is now permanently retained in GitHub; do not request it again.
