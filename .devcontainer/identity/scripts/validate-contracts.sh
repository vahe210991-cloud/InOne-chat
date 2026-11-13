#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

npx --yes @redocly/cli@2.77.0 lint "$ROOT/architecture/identity/contracts/identity-openapi-v1.yaml"
npx --yes @redocly/cli@2.77.0 lint "$ROOT/architecture/identity/contracts/identity-events-v1.asyncapi.yaml"
