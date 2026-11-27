# AI-agent operating and verification policy

**Status:** proposed repository-wide operating standard; owner confirmation is required for any change to existing owner decisions.  
**Applies to:** every AI agent, automation, and human contributor working in InOne.  
**Canonical repository:** vahe210991-cloud/InOne-chat.  
**Scope:** task intake, repository access, implementation discipline, test selection and launch, GitHub Actions queue management, evidence, and handoff.

This document supplements (and never overrides) AGENTS.md, development/AI-AGENT-MANDATE.md, development/AI-AGENT-GIT-INTEGRATION-POLICY.md, development/WORKING-RULES.md, and the owner-approved WBS. If instructions conflict, stop before editing and follow the most recent explicit owner decision. Do not infer approval from a branch, PR, passing check, or another agent's action.

## 1. Mandatory start-of-task procedure

Before implementation, every agent must:

1. Read the repository-root AGENTS.md, the complete AI-agent mandate, working rules, Git integration policy, approved development/PROGRESS-BASELINE.md, and the latest relevant report, session log, and continuity documents.
2. Read the task brief and identify its exact deliverable, Beta release boundary, acceptance criteria, security impact, and dependencies.
3. Map the task to an approved WBS row, API contract, stable screen ID, architecture decision, issue, or acceptance criterion. If no approved requirement or contract exists, mark BLOCKED and ask the owner; do not invent behavior or endpoints.
4. Fetch live GitHub state. Record repository, base branch and exact base SHA, task branch, current head SHA, related PRs, relevant workflow runs, and files concurrently owned or modified.
5. Check open PRs and recent commits for overlapping work. Never overwrite, close, merge, rebase destructively, or edit another task's branch without explicit authorization.
6. Choose the smallest safe work mode. Repository-native edits are acceptable for focused documentation and small, fully reviewable text changes. Broad code changes, builds, generated files, binaries, submodules, LFS, and complex history operations require a complete supported Git workspace/CI path. If the available tools cannot safely perform the operation, stop and record the exact limitation.

The current mandate identifies ChatGPT as the sole executor unless the owner explicitly authorizes delegation. This policy does not itself authorize parallel agents or subcontracted work.

## 2. Repository and change safety

- GitHub is the durable source of truth. No required artifact, code, evidence, or handoff may exist only in chat, memory, a temporary workspace, or a local machine.
- Use a unique task branch from the exact approved base SHA. Follow the main-first selective integration policy; do not use stale feature branches as a new base or wholesale-copy divergent trees.
- Make one coherent, reviewable change set. Preserve unrelated changes and inspect the complete diff, including added, modified, deleted, renamed, generated, and untracked files.
- Before editing a file, fetch its latest content and blob SHA. After editing, fetch it again and verify the expected remote content and commit SHA. Resolve SHA conflicts by re-fetching and reviewing, never by overwriting.
- Do not change release scope, WBS weights, architecture decisions, security defaults, CI requirements, branch protections, repository settings, secrets, or production configuration without explicit owner approval.
- Never commit credentials, access tokens, signing keys, SQLCipher keys, real OTPs, personal data, or production secrets. Use approved protected secret storage.
- Do not deploy, expose a server/database, create paid Codespaces resources, or access production systems without explicit owner permission.
- Keep PRs Draft until review and exact-SHA validation are complete. Never merge a product PR, enable a release gate, force-push, delete a shared branch, or close an owner-protected PR without explicit owner authorization.

## 3. Test planning: decide before launching

Tests are selected from the changed paths and acceptance criteria, not from habit. Before launching anything, create a short verification plan containing:

- exact candidate SHA;
- changed components and affected contracts;
- risks and failure modes being tested;
- required checks and why each applies;
- checks that are intentionally not applicable;
- required external credentials, services, devices, or protected environments;
- expected runtime/cost and whether a relevant run is already queued or in progress.

Use these verification layers in order:

### Layer 0 — source and diff review (no test runner)

Required before any test launch:

- inspect the full diff and surrounding implementation;
- check API/schema compatibility, authorization boundaries, data lifecycle, error handling, idempotency, concurrency, logging, secrets, and rollback behavior as applicable;
- check formatting/configuration and workflow triggers;
- identify tests that could mutate shared state or require protected services.

Source review is not a test pass. Record it as REVIEWED, never PASS for a runtime check.

### Layer 1 — focused checks

Run the smallest relevant checks for changed code, for example:

- Markdown/link and repository policy consistency for documentation;
- targeted Node tests for changed backend modules;
- targeted Flutter unit/widget tests and analyze for changed Dart code;
- targeted Rust fmt/check/test for changed Rust crates;
- focused migration/schema compatibility tests;
- security regression tests for the changed authorization, cryptographic, storage, or input-validation boundary.

Do not run unrelated platform matrices for a documentation-only change unless a policy or workflow file was changed and its validation is relevant.

### Layer 2 — component integration checks

Run when the change crosses a component boundary or changes a contract, persistence, generated bridge, or lifecycle:

- backend + PostgreSQL/Compose tests for backend/data changes;
- Flutter + Rust/FRB checks for FFI or mobile integration;
- SQLCipher/OpenMLS persistence, restart, replay, rollback, and recovery tests for MLS/storage changes;
- authenticated attachment lifecycle and access-control tests for file changes;
- email delivery/provider tests for email changes.

### Layer 3 — full exact-SHA acceptance matrix

Run only when required by the task's acceptance criteria, release gate, or owner instruction. Select the applicable backend, database, Flutter, Android, iOS, Rust, OpenMLS, FRB, security, Dev Container, and exact-SHA acceptance workflows. Do not launch unrelated workflows just to create activity.

### Layer 4 — controlled environment and device acceptance

Physical devices, two-device messaging, real Keychain/Keystore behavior, staging credentials, external providers, production-like load, and destructive recovery tests require an explicitly authorized and controlled environment. If unavailable or not authorized, mark BLOCKED or NOT RUN. A simulator, mock, source review, or CI unit test must not be represented as physical-device acceptance.

## 4. Rules for launching GitHub Actions

1. Inspect the live PR head SHA and all relevant queued/in-progress/completed runs before launching checks.
2. Prefer the PR/push workflow already triggered by the candidate commit. Do not dispatch a duplicate run when the required workflow is already queued or running for the same SHA.
3. Launch only the missing, applicable checks. Use workflow dispatch only when the workflow supports it and the required run is genuinely absent; record why the dispatch is necessary.
4. Never create empty or documentation-only commits solely to retrigger CI or make a queue appear active.
5. Batch related source changes into a coherent commit so every intermediate commit does not trigger an unnecessary full matrix.
6. After every new commit, treat all earlier green results as historical. Re-run the applicable checks on the new exact head SHA.
7. Verify that each workflow actually tested the intended PR head SHA. A run on an old head, a base SHA, a synthetic merge ref without an explicit head assertion, or another branch is not final-head evidence.
8. Inspect job-level results, not only the workflow summary. Queued, in-progress, skipped, cancelled, timed-out, action-required, missing, or stale-SHA jobs are not green.
9. Never report a workflow as passed because it was configured, triggered, or has a successful prior run. It must have a terminal successful conclusion on the exact proposed SHA.
10. Do not disable required checks, weaken test assertions, skip security jobs, suppress advisories, or change workflow triggers to obtain a green result.

## 5. Queue management and runner capacity

A queued workflow is not a test failure. First distinguish:

- QUEUED: GitHub has not started the job on a runner;
- IN PROGRESS: a runner has started it;
- FAILED: a job executed and returned a failing conclusion;
- CANCELLED/SKIPPED/TIMED OUT: no successful acceptance evidence;
- COMPLETED/SUCCESS: valid only if it tested the exact candidate SHA and all required jobs succeeded.

When a queue delay occurs:

1. Record run ID, workflow, branch, head SHA, creation/update time, status, and how long it has waited.
2. Inspect repository-wide queued and in-progress runs, grouping by PR, branch, workflow, and SHA. Use the observed sample and API pagination limits accurately; do not extrapolate a partial page into an exact global queue count.
3. Check runner availability, workflow dependencies, concurrency groups, path filters, environment approvals, and workflow-level/job-level conditions.
4. Determine whether repeated commits or duplicate dispatches are creating redundant work.
5. Report queue delay separately from test failures. Do not edit source to address a runner scheduling delay.
6. Do not cancel runs merely to improve queue appearance. Cancel only a clearly obsolete duplicate or superseded run when the task/owner policy explicitly permits it and the run is not protected or the only acceptance evidence. Never cancel unrelated PRs' runs.
7. Do not change repository-wide concurrency, runner configuration, workflow triggers, or required-check settings as part of a feature task. Propose an isolated CI-policy change and obtain owner approval.

### Concurrency design guidance for CI maintainers

For ordinary PR validation, concurrency should normally group by workflow purpose plus PR number (or stable branch identity), not by commit SHA, when the intended behavior is to cancel superseded runs from the same PR. Including the SHA in the group creates a separate group for every commit and prevents those older runs from being superseded by later commits.

Preserve exact-SHA correctness independently: each job must print and assert the expected PR head SHA before doing work and publish that SHA in its result/artifacts. Keep intentionally independent jobs in distinct groups where cancellation would destroy required evidence. Do not apply this guidance by editing workflows without owner approval and an isolated review.

## 6. Security and data safety during tests

- Use synthetic fixtures and least-privilege test identities. Do not use real user/customer data unless the owner has explicitly approved a controlled test.
- Never print tokens, OTPs, private keys, database keys, decrypted message bodies, or attachment plaintext into logs or artifacts.
- Keep cryptographic and authorization checks fail-closed. Do not add plaintext fallback, bypass membership/device checks, or silently replace missing protected keys.
- Do not run destructive migrations, database resets, load tests, fuzzers against shared services, or process-kill/recovery tests against production.
- Verify test cleanup and isolation. Do not let a test mutate shared staging data or another agent's fixtures.
- For cryptographic, MLS, SQLCipher, file access, authentication, and recovery changes, test negative cases as well as successful flows: invalid keys, corrupt/partial state, stale/replayed inputs, revoked devices/members, authorization failures, rollback and restart/recovery where applicable.
- A test that uses a mock or in-memory database cannot prove real SQLCipher file persistence, OS key-store integration, process-crash recovery, or two-device interoperability.

## 7. Failure triage and code changes

When a check fails:

1. Preserve the run ID, exact SHA, failing job/step, relevant logs, artifacts, and first meaningful error.
2. Classify the cause: source defect, test defect, environment/runner issue, missing secret/approval, dependency/supply-chain issue, flaky test, or stale-SHA mismatch.
3. Reproduce or corroborate the failure with the narrowest safe check before changing code.
4. Fix the root cause without weakening security or deleting regression coverage.
5. Review the new diff and run the affected checks again on the new SHA.
6. Record unresolved or intermittent failures. Do not relabel them as environmental without evidence.

If a check cannot be run because a runner, device, secret, approval, service, or supported tool is unavailable, record the exact blocker and mark BLOCKED or NOT RUN. Never guess the result.

## 8. Evidence and status vocabulary

Use only these acceptance states:

- PASS: executed successfully on the exact candidate SHA, with the required job-level evidence.
- FAIL: executed and failed.
- BLOCKED: could not execute because a named prerequisite/capability/authorization is missing.
- NOT RUN: intentionally not executed or not yet started.
- NOT ACCEPTED: the feature/release gate does not meet all acceptance criteria, even if some checks passed.

For every check, record its name, run URL/ID, tested SHA, conclusion, and relevant artifact/log. Distinguish source implementation, source review, automated test, device test, security review, and owner acceptance.

Never convert a queued run to PASS. Never carry a green result forward from an earlier SHA. Never claim full acceptance from a partial matrix.

## 9. Required completion report and handoff

For every completed stage or substantial work session, commit a concise report in the repository and update the required session/continuity records. Include:

- task, scope, and linked WBS/contract/acceptance criterion;
- exact base/head branch and SHA;
- files changed and PR URL;
- source-review result;
- every executed check with run URL/ID, exact SHA, status, and concise result;
- queued, skipped, blocked, failed, and not-run checks, with reasons;
- security/privacy findings and remaining risks;
- implementation and verification progress calculated only against the owner-approved WBS;
- remaining work, next owner decision (if any), and handoff notes.

Keep the PR Draft until all required review and exact-SHA checks pass. Do not merge or declare release acceptance without explicit owner authorization.

## 10. Quick pre-flight checklist

- [ ] Read mandatory repository instructions and latest continuity/report files.
- [ ] Mapped task to approved WBS/contract/screen/acceptance criterion.
- [ ] Captured exact base and candidate SHAs.
- [ ] Checked overlapping PRs, files, and queued/in-progress workflows.
- [ ] Confirmed scope and owner permissions; identified secrets/services/device needs.
- [ ] Reviewed source/diff before launching tests.
- [ ] Selected only applicable test layers and avoided duplicate CI runs.
- [ ] Verified every required result on the exact final SHA.
- [ ] Recorded blockers and non-passing states honestly.
- [ ] Committed report and handoff records to GitHub; left merge/release decisions to the owner.
