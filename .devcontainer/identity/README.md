# InOne Identity Codespaces profile

This is an isolated development environment for the new Identity service. It does not replace or modify the existing Flutter/mobile development environment.

## Create a Codespace

1. Open the repository in GitHub.
2. Choose **Code → Codespaces → Create codespace on branch**.
3. Open the advanced configuration / dev-container selection.
4. Select the file .devcontainer/identity/devcontainer.json.
5. Create the Codespace and wait for the Node and PostgreSQL services to become healthy.

If GitHub offers only the default configuration, use **Codespaces: Configure Dev Container** and select this file path. Do not overwrite another product's root devcontainer configuration.

## Verify Stage 0 environment

From the repository root, run:

~~~bash
bash .devcontainer/identity/scripts/verify-stage0-environment.sh
~~~

The script verifies:
- Node.js major version 26;
- PostgreSQL client tools;
- PostgreSQL server major version 18 and connectivity;
- OpenAPI 3.1 and AsyncAPI 3.0 contract lint using pinned Redocly CLI 2.77.0.

Expected local-only database:
- Host: postgres
- Port: 5432
- Database: identity_dev
- User: identity_dev
- Password: identity_local_only

These credentials are disposable local development values only. Never reuse them outside this isolated Codespace. No production credentials or real user data belong here.

## Current limitations

- No Identity application package or API server exists yet, so port 8080 is reserved for Stage 1.
- No schema migrations exist yet; PostgreSQL starts as an empty development database.
- The compatibility spike for oidc-provider, WebAuthn and Argon2id must be implemented/run in Stage 1 and its exact output recorded.
- This Codespaces profile is configuration-only until a user creates it and the verification script passes.
