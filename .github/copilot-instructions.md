# InOne Copilot instructions

Before starting any task, read `/AGENTS.md`, the complete `development/AI-AGENT-MANDATE.md`, and the complete owner-approved `development/PROGRESS-BASELINE.md`. Follow the mandatory reading order and latest report/session log.

The approved WBS is the source of truth for scope, weights and cumulative readiness. Every implementation task must identify its WBS item, stable screen ID/API contract, exact branch and base SHA. Do not change weights or Beta 1.0/Beta 2.0 boundaries without explicit owner approval.

Preserve every owner-provided source file and its provenance in GitHub. Never redesign approved UI, invent endpoints, use direct network from HTML, or expose tokens to JavaScript. Missing API contract/assets = BLOCKED, not guessed. Beta 2.0 placeholders stay retained and non-functional in Beta 1.0.

Commit and push all deliverables; verify remote SHA. Write timestamped reports and update SESSION-LOG after each stage. Reports carry five previous/five next tasks and cumulative implementation/verification percentages. Never merge before exact-SHA required CI is green and the owner explicitly authorizes it. Never start servers/deployments/expose DB without explicit permission.
