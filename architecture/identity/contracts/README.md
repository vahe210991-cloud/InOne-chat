# Identity contract artifacts

This folder contains the machine-readable Stage 0 contract baseline.

| File | Format | Purpose |
|---|---|---|
| identity-openapi-v1.yaml | OpenAPI 3.1 | Public Identity endpoints and authenticated internal service API |
| identity-events-v1.asyncapi.yaml | AsyncAPI 3.0 | Identity-to-product event catalogue and payload schemas |
| identity-client-registry-v1.template.yaml | YAML | Non-deployable per-environment OIDC client registry template |

## Contract rules

- The files describe intended contracts; no endpoint, event consumer, OIDC client or runtime behavior is implemented by adding them.
- The .invalid hosts are placeholders only.
- Do not add exact redirect URIs until app identifiers, URL domains and callback schemes are confirmed.
- Do not add production client secrets, service credentials, signing keys or customer data.
- Public user endpoints use product-specific OIDC access tokens; internal endpoints require service authentication and narrow product scope.
- Product APIs remain responsible for product-local authorization and membership.
- Every contract change must update the human-readable API/event contract, compatibility tests and version notes.
- Breaking changes require a new contract version or an explicit compatibility/migration plan.

## Validation

The GitHub Actions workflow at .github/workflows/identity-contracts.yml runs Redocly CLI against the OpenAPI and AsyncAPI descriptions on relevant pull requests. The workflow result must be checked on the exact PR head before declaring Stage 0 contract validation PASS.
