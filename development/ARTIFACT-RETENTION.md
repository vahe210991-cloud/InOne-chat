# Permanent artifact retention — InOne

## Owner P0 snapshot bundle

The owner-uploaded bundle is a permanent project artifact. Do not ask the owner to upload it again during a new chat or session.

- Repository: `vahe210991-cloud/InOne-chat`
- Permanent branch: `artifacts/p0-bundles`
- Path: `bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle`
- [Open the retained bundle in GitHub](https://github.com/vahe210991-cloud/InOne-chat/blob/artifacts/p0-bundles/bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle)
- Size: 2,476,944 bytes
- SHA-256: `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`
- Git bundle HEAD: `16eab726106ae04b4979af2a1646c2052233b87c`
- GitHub blob SHA: `8d77f064b27784a1cf7119a0a3ee0d4c5ae74dbb`
- Bundle verification: PASS; complete Git history.

## Retrieval procedure for future sessions

1. Read this file before asking the owner for any source archive.
2. Use GitHub branch `artifacts/p0-bundles` and the exact path above.
3. Verify the file size and SHA-256 against this record after downloading it.
4. Use `git bundle verify` and `git bundle list-heads` before using its refs.
5. Never overwrite the owner-uploaded original. New snapshots belong in separate hash-addressed directories under `bundles/`; update `bundles/LATEST.txt` only to the new snapshot.
6. Keep the owner-uploaded original and subsequent snapshots immutable.

## Non-negotiable rule

**The owner has stated this is the last time the bundle will be sent. Do not request another upload.** If retrieval fails, diagnose repository permissions, branch/path, or connector limitations and report the actual blocker. Do not transfer the retrieval burden back to the owner.

## Related records

- [P0 closure report](recovered-source/P0-CLOSURE-2026-11-08.md)
- [Development working rules](WORKING-RULES.md)
- [Development session log](SESSION-LOG.md)
