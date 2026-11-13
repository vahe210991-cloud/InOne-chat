# InOne Identity — environment and secrets contract

Status: Stage 0 configuration contract; no runtime config loader exists yet.

## Runtime settings

| Variable | Required | Purpose | Rules |
|---|---|---|---|
| NODE_ENV | Yes | Runtime mode | development, test or production only |
| IDENTITY_PORT | Yes | HTTP bind port | Default 3000 in local development |
| IDENTITY_HOST | Yes | Bind address | Local 127.0.0.1; production private interface behind approved ingress |
| IDENTITY_ISSUER_URL | Yes | Canonical OIDC issuer | Exact HTTPS origin in production |
| IDENTITY_DATABASE_URL | Yes | Dedicated PostgreSQL connection | Secret; TLS required outside local development |
| IDENTITY_DB_POOL_MAX | Yes | PostgreSQL pool ceiling | Start at 10; tune from measured connection budget |
| IDENTITY_KMS_PROVIDER | Production | KMS adapter selector | Managed KMS/HSM provider |
| IDENTITY_SIGNING_KEY_REF | Production | Asymmetric signing key reference | Never supply plaintext private key bytes |
| IDENTITY_HASH_KEY_REF | Production | HMAC key for keyed token/recovery-code hashes | Separate key purpose |
| IDENTITY_ENCRYPTION_KEY_REF | Production | Envelope-encryption key for TOTP secrets | Separate key purpose |
| IDENTITY_MTLS_CERT_FILE | S2S | Client certificate path | Mounted secret, read-only |
| IDENTITY_MTLS_KEY_FILE | S2S | Client private key path | Mounted secret, never committed |
| IDENTITY_MTLS_CA_FILE | S2S | Trusted CA bundle | Explicit trust bundle |
| IDENTITY_LOG_LEVEL | Yes | Structured log level | info in production; never log secrets |
| OTEL_EXPORTER_OTLP_ENDPOINT | Optional | Telemetry collector | Private endpoint; redact PII |
| IDENTITY_OUTBOX_POLL_INTERVAL_MS | Yes | Worker polling interval | Initial target 1000 ms |
| IDENTITY_RATE_LIMIT_MODE | Yes | Rate-limit backend | PostgreSQL-backed shared counters in v1 |

## Secret rules

- Production signing keys are asymmetric and KMS/HSM-backed. Application receives key reference/sign permission, not exportable private bytes.
- Refresh-token, recovery-code and grant lookup hashes use dedicated keyed HMAC. Store only hashes.
- TOTP secrets use envelope encryption with separate key purpose.
- Service credentials use distinct client identities and narrow scopes. mTLS identity is checked independently from OAuth scope.
- No secret in source, CI output, issue text, telemetry, crash dumps or mobile/browser clients.
- Local development may use ephemeral test-only keys. They are not persistent and cannot be selected in production.
- Missing KMS key, certificate, DB secret or issuer setting is startup failure; never silently downgrade.

## Example local environment

A future services/identity/.env.example may contain placeholders only:

    NODE_ENV=development
    IDENTITY_HOST=127.0.0.1
    IDENTITY_PORT=3000
    IDENTITY_ISSUER_URL=http://127.0.0.1:3000
    IDENTITY_DATABASE_URL=postgresql://identity_dev:REPLACE_WITH_LOCAL_PASSWORD@127.0.0.1:54329/identity_dev
    IDENTITY_DB_POOL_MAX=5
    IDENTITY_LOG_LEVEL=debug
    IDENTITY_OUTBOX_POLL_INTERVAL_MS=1000
    IDENTITY_RATE_LIMIT_MODE=postgres
    IDENTITY_KMS_PROVIDER=ephemeral-dev-only

The placeholder is not a usable credential. Do not commit a real .env file.

## Production startup invariants

Refuse startup if issuer is not HTTPS; database TLS is disabled outside local/test; KMS is local/ephemeral; key references are missing or reused across purposes; enabled internal routes lack complete mTLS; client registry contains wildcard redirects/duplicate IDs/multiple audiences; production redaction is disabled; or security lifetimes violate the approved baseline.

No cloud provider, production region or paid resource is selected here.
