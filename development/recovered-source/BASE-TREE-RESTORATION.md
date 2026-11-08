# P0 base-tree restoration record — 2026-11-08

## Baseline

- Verified source bundle base commit: `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`.
- Base tree: 240 tracked blobs.
- GitHub archived engine tree originally had 225 blobs and was missing 15 paths.
- The recovery PR branch now has 240 blobs under `inone-development-archive-0.6.0/engine/`; recursive tree path count matches the bundle base path count. This confirms path parity, not yet a complete 240/240 blob-hash comparison.

## Restored missing paths

| Bundle-base path | Exact source / provenance |
|---|---|
| `.gitignore` | Extracted directly from verified bundle base; blob `4bca9066716a6752d980976471dfc9916ca57a1e` |
| `PUBLISH_STEPS.md` | Existing archive `repository/PUBLISH_STEPS.md`; blob `968c9af0e46d39381b0c99fac98dd8b0bf156778` |
| `SECURITY.md` | Existing archive `repository/SECURITY.md`; blob `1fbe8448f714e7767beb3af2f3d11774347a5562` |
| `client-reference/README.md` | Existing root client-reference; blob `35a2c554ffe324b48cabc5e6097e8ebba0ba5f69` |
| `client-reference/biometric-client.mjs` | Existing root client-reference; blob `b03e72fe33c79e6b261d980bc86459babf03b388` |
| `client-reference/dart/README.md` | Existing root client-reference; blob `c849fbfc0d8c0bbca4ec51f045e70cf047b34a19` |
| `client-reference/dart/lib/org_api.dart` | Existing root client-reference; blob `f00b39a05892a3c287848be9c0c916bd6c0fb09d` |
| `client-reference/dart/lib/org_errors.dart` | Existing root client-reference; blob `d4f16e2ccee1b7c7310796f6a5c0b272ec1e085d` |
| `client-reference/dart/lib/org_models.dart` | Existing root client-reference; blob `443d2a8218f47adce635204c4469cc88eec01b77` |
| `client-reference/dart/lib/org_picker.dart` | Existing root client-reference; blob `8b803106fd5f8cddb4eb6e1600cc55168ff4d001` |
| `client-reference/dart/pubspec.yaml` | Existing root client-reference; blob `936204d2b92ba26cde8052d3b02bba9dc8f2086d` |
| `client-reference/dart/test/org_errors_test.dart` | Existing root client-reference; blob `9dc7e16c64ea77d48953e56d541aaaaf51323d83` |
| `client-reference/make-vectors.mjs` | Existing root client-reference; blob `c667cc9993e232163766acd514f6a6d03f72b6ff` |
| `client-reference/package.json` | Existing root client-reference; blob `a7221652f1ea57b9e684b86424a928beb47e301d` |
| `client-reference/vectors/biometric-vectors.json` | Existing root client-reference; blob `5a00755946219df2527591f00058a19d167c7811` |

All restored client-reference and documentation files were sourced from existing GitHub paths whose blobs match the bundle-base blob IDs; `.gitignore` was read directly from the verified local bundle base. The two files required by the current biometric test were already verified exact.

## Publish workflow correction

The publish job now creates a patch from the PR head's complete engine-path diff against `origin/main` and applies it to the clean main-based recovery branch before applying the P0 patch. This carries all 15 restored files into the published branch, rather than only the biometric client and vectors.

Workflow commit: `7898fde9a592a8c180e7c9e89a2c7b3cb2e5ad80`.

## Acceptance still pending

- CI must pass Node, room-list, PostgreSQL, OpenMLS client, and Rust bridge tests.
- Publish job must complete and create `recovery/p0-wave3-applied`.
- Inspect the published branch tree and compare the full 240 base blob hashes plus P0 delta before opening a final code PR.
- Do not merge PR #18 yet.


## P0 delta summary

The verified bundle diff from base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9` to P0 HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9` is:

- 32 changed paths
- 2,145 insertions
- 23 deletions
- Includes 0.7 client-screens auth/common HTML+JS prototype, Node API/state, room-list endpoint/tests, MLS consistency/window/poison handling and P0 wave documentation.
- Includes a nested complete `inone-engine-0.6.0.bundle` in the P0 HEAD; SHA-256 `4da09eb841313667b47b243111b2c0f50bdbb1e732e4ee1edfbc031c0d6b349e`, ref `engine/0.6.0-alpha.38` at `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`.

Commit sequence in the outer bundle:
1. `694e140` — InOne engine 0.6.0-alpha.38.
2. `1d93282` — client 5.9, organization API, unverified Dart reference.
3. `ea3b49a` — close 0.6 line.
4. `4c24ff3` — P0 waves 1–3.
5. `a7f60b6` — P0 wave 4.

The 0.7 client-screens files in this delta are a web/JavaScript prototype, not a Flutter app. This does not change the Flutter source audit conclusion.
