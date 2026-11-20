# Build status and failure response protocol

This is a mandatory operating rule for every InOne contributor and AI agent.

## User command: "проверить статус сборки"

Treat this command as an instruction to complete the failure-response loop, not merely report workflow colors.

1. Identify the active PR, exact head SHA, base SHA, branch, and PR state before interpreting CI.
2. Query all relevant GitHub Actions runs for that exact head SHA. Inspect jobs and individual steps; do not rely on stale runs or a green summary alone.
3. For every failed, cancelled, or unexpectedly skipped required check, retrieve logs and locate the first causal failure. Distinguish root cause from downstream cancellations.
4. Localize the defect to the exact workflow step, script, source file, configuration, or dependency interaction. Verify the diagnosis against the log and repository source.
5. Fix the root cause on the active working branch. Do not weaken tests, skip required steps, hide errors, loosen security checks, or mutate protected branches.
6. Run focused validation where available, then push the fix and allow fresh workflows to run on the new exact HEAD SHA.
7. Re-query the new SHA and inspect all relevant jobs and steps. Repeat diagnosis and repair until the required checks pass or a concrete blocker is established.
8. Report the root cause, affected files, corrective change, new commit SHA, and actual test results. Explicitly identify tests that have not run.
9. Never merge unless the user separately authorizes the merge.

A status check is not complete when an error is merely identified or described. It is complete only after the failure has been localized, corrected, and fresh tests have been launched and inspected. If tests are still running, continue checking them in the same task until they finish or a genuine external blocker prevents progress.

## Dependency-manifest integrity during Flutter scaffold generation

Never run `flutter create` against the existing `mobile/` application root in CI. Even with `--no-pub`, Flutter may rewrite `pubspec.lock`. Generate platform scaffolding in a fresh temporary directory and copy only the requested `android/` and/or `ios/` platform directory into the app. Keep the explicit `pubspec.yaml` and `pubspec.lock` immutability checks. Dependency resolution must remain a separate step using `flutter pub get --enforce-lockfile`.
