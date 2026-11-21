# InOne CI acceptance and branch protection

## Pull request acceptance

The single repository-level acceptance status check is:

- `Exact-SHA required workflow acceptance`

It is produced by `.github/workflows/inone-acceptance.yml`. The gate reads the PR's changed-file list, determines which validation workflows apply, and waits for successful GitHub Actions workflow runs whose `head_sha` exactly equals the current PR head SHA. A failed, cancelled, missing, or timed-out applicable run fails acceptance. It does not reuse results from an earlier commit.

The current workflow set includes:

- `Validate recovered InOne P0 source`
- `Native MLS client validation`
- `Flutter mobile validation`
- `Flutter iOS validation`
- `OpenMLS Flutter Rust Bridge generation`
- `Email delivery and PostgreSQL validation`
- `Dev Container Compose runtime validation`

The gate requires only workflows applicable to the PR's changed paths. Workflow-definition changes require the corresponding workflow's own exact-head validation.

## Recommended main branch rule

Configure a branch ruleset or classic branch protection for `main` with:

1. Require a pull request before merging.
2. Require status checks to pass before merging.
3. Add `Exact-SHA required workflow acceptance` as the required check (GitHub Actions app).
4. Require branches to be up to date before merging if the repository's merge throughput permits it.
5. Block force pushes and branch deletion.
6. Do not require deployment environments for this CI-only project gate.

The GitHub integration used during this change can read the branch summary but cannot access the branch-protection administration endpoint (HTTP 403). The repository owner must apply these settings in GitHub Settings; no protection change is claimed here.

## Runtime and database boundaries

The Compose runtime workflow builds `.devcontainer/Dockerfile`, starts the existing PostgreSQL 16 Compose service, applies canonical engine migrations, starts the backend, and checks `/healthz` and `/readyz`. It uploads diagnostics for 14 days, including after failure.

PostgreSQL 16 remains the Codespaces/CI version. This workflow does not access a developer's local Windows PostgreSQL 18 instance.

## Secrets

The workflow set is designed to use read-only repository permissions and local ephemeral test credentials. Secret values must never be printed, copied into artifacts, or added to logs. The connected GitHub integration does not expose repository secret values or secret metadata; verify configured secrets and environments in GitHub Settings when required by a future workflow.
