# AI-agent operating and test-execution policy

- Date: 2026-11-27
- Repository: vahe210991-cloud/InOne-chat
- Base: main at 7d34b99fcc026a828b838e211d039c575aeace1d
- Branch: docs/architecture-ai-agent-checks-policy-2026-11-27
- Status: documentation committed; PR review pending

## Deliverable

Added architecture/AI-AGENT-OPERATING-AND-TEST-EXECUTION-POLICY.md. The policy defines mandatory task intake, exact-SHA branch discipline, review-before-test sequence, layered test selection, GitHub Actions launch rules, queue triage, concurrency design guidance, security-safe test operation, failure triage, evidence vocabulary, and completion reporting.

Updated AGENTS.md to make the architecture policy discoverable and mandatory for every repository agent.

## Evidence and verification

- Architecture policy file committed: 44477b418ed3482ed35e53f55d3b39f356d7264c.
- Root agent-instructions link committed: bac26ec8ef3fdf21fd7f7c5d6bc284cf60c4ef55.
- Source review: PASS for the two documentation changes; no product source, tests, workflows, secrets, release gates, or repository settings changed.
- Automated Markdown/link validation: NOT RUN. No workflow was launched for this documentation-only change.
- Application, backend, Flutter, Rust, MLS, Android/iOS, database, and device tests: NOT APPLICABLE to this documentation-only change; no product behavior changed.
- WBS implementation/verification percentages: unchanged. No feature acceptance or release readiness is claimed.

## Policy decisions captured

- Queued checks are not failures and are never PASS.
- All required checks must be terminal-successful on the exact final candidate SHA.
- Avoid duplicate dispatches and empty commits; run only checks applicable to changed paths and acceptance criteria.
- Do not cancel unrelated or protected runs.
- Concurrency may be grouped by PR/branch rather than SHA for supersession, while exact-SHA assertions remain explicit in each job. Workflow changes still require separate owner approval.
- Draft PRs remain Draft; no merge, release-gate activation, branch deletion, or repository-wide CI changes are authorized by this documentation task.

## Remaining work

- Review and approve this policy PR.
- Merge only after explicit owner authorization.
