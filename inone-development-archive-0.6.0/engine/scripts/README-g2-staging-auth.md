# G2 staging authorization smoke test

This script exercises the live G2 authorization boundary against a controlled staging environment. It creates one test organization request and approves it with the platform-owner account, so use staging only.

Required environment variables:

- `INONE_STAGING_BASE_URL`: HTTPS base URL of the staging API.
- `INONE_STAGING_APPLICANT_TOKEN`: account token with no platform role; this account creates the test request.
- `INONE_STAGING_ORDINARY_TOKEN`: a different account token with no platform role.
- `INONE_STAGING_ADMIN_TOKEN`: platform admin token.
- `INONE_STAGING_OWNER_TOKEN`: platform owner token.

Run from `inone-development-archive-0.6.0/engine`:

```sh
node scripts/verify-org-request-staging-auth.mjs
```

The script verifies role identity, applicant queue visibility, ordinary-user isolation, admin/owner read access, cross-account detail denial, applicant/ordinary/admin decision denial, and owner-only approval. It never prints bearer tokens. The created request is deliberately approved and remains in staging for auditability.

The automated Node test suite separately runs the same authorization matrix against the in-memory API harness and PostgreSQL-backed integration harness. The staging smoke test must be run with real staging credentials before G2 is declared complete; no staging credentials are stored in the repository or CI logs.
