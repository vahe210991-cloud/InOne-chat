# InOne development session log

This log is a durable GitHub record. Add newest entries at the top. Keep each entry factual and link commits, PRs, workflow runs, and test evidence.

## 2026-11-08 — Establish development folder and handover protocol

- Added the mandatory `development/` entry point, working rules, baseline, and start/end checklist.
- Verified owner-provided ZIP contains a complete Git bundle and companion architecture map.
- Verified bundle SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`, bundle ref `engine/p0-wave3`, HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, five commits, and complete history.
- Bundle verification report says its history has no common commit with GitHub main. Do not force-push or treat it as a fast-forward.
- PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) is the isolated patch-based validation/import path. Its workflow status and any published applied-source branch must be verified live.
- PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17) preserves reference artifacts only.
- JavaScript/MJS syntax check: 135 files PASS (syntax only). Full Rust/DB/Flutter acceptance not run in the local environment.
- Product Flutter Beta 1.0 source is not in the P0 bundle; do not claim a phone-ready app.
- Owner decision retained: independent InOne backend/database for Beta 1.0; shared InOne+Propo operational DB deferred.
- Next: verify PR #18 workflow status and resulting branch; import the exact architecture map and provenance files into GitHub; then continue toward Flutter source recovery and a runnable Android test build.


## 2026-11-08 — PR #18 CI investigation and correction

- Fetched workflow run [42453233555](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42453233555): **FAIL**.
- Job `validate`: patch decode/apply PASS; npm ci PASS; backend npm test FAIL (365 total, 364 pass, 1 fail); room-list, PostgreSQL, OpenMLS, and bridge tests SKIPPED. Publish job SKIPPED.
- Exact failure: `ERR_MODULE_NOT_FOUND` for `client-reference/biometric-client.mjs` imported by `test/client-reference.test.js`.
- Checked bundle commit `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`: file exists with blob SHA `b03e72fe33c79e6b261d980bc86459babf03b388`.
- Restored exact file to PR #18 branch: commit `04a490e9a01cf7523fb45205a8077f5f357c2658`; fetched GitHub blob SHA matches the bundle blob SHA.
- Updated workflow path filter: commit `762e3eca8ccb2e34965441114cc29b63083aa0f9`.
- Fresh Actions run for the new head was not visible at the last check. Do not report the correction as validated until a new run completes.
- Important correction: matching the eight P0-modified file blobs did not prove the full base tree was identical. Continue auditing missing base files before acceptance.
- Original binary bundle remains pending durable GitHub storage; architecture map and bundle verification report have been committed under `development/recovered-source/`.
