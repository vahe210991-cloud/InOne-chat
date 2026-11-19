# G2 — controlled staging authorization validation

This is an explicit, mutating smoke test for a dedicated staging environment. It creates one uniquely named organization request using the user token, verifies owner/admin/user queue and detail access, confirms that admin and user decisions are rejected with HTTP 403, and closes the fixture by rejecting it with the owner token.

## Required environment variables

- `INONE_STAGING_BASE_URL` — HTTPS origin only, e.g. `https://staging-api.example.test`.
- `INONE_STAGING_OWNER_TOKEN` — active platform-owner bearer token.
- `INONE_STAGING_ADMIN_TOKEN` — active platform-admin bearer token.
- `INONE_STAGING_USER_TOKEN` — ordinary authenticated user bearer token.
- `INONE_STAGING_OUTSIDER_TOKEN` — optional second ordinary user; enables cross-applicant queue isolation, details 404, and decision 403 checks.

Run the script from the repository root after setting the variables in a protected local shell or secret manager:

`node inone-development-archive-0.6.0/engine/scripts/verify-org-request-staging.mjs`

It does not print tokens. It mutates staging by creating and rejecting a uniquely named request; use a disposable/dedicated staging tenant. Do not place tokens in command-line arguments, source files, or pull-request CI.

## Local automated coverage

The normal engine test suite also runs the role matrix against the test server and the configured PostgreSQL test store (when available). Those tests are not represented as a live staging run.
