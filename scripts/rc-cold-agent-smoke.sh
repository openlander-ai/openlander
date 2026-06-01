#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${OPENLANDER_E2E_BASE_URL:-}" ]]; then
  echo "OPENLANDER_E2E_BASE_URL is required, for example http://localhost:10114" >&2
  exit 1
fi

cat >&2 <<'MSG'
Running OpenLander RC cold-agent smoke.

Requirements:
- run this on a fresh or dedicated QA host, not a dogfood/shared Docker daemon
- start OpenLander from the exact RC artifact before invoking this script
- ensure Docker and the public test repositories are reachable
MSG

export OPENLANDER_E2E_RC_SMOKE=1

npx playwright test --project=quality-gate \
  e2e/quality-gate/auth.spec.ts \
  e2e/quality-gate/mcp.spec.ts \
  e2e/quality-gate/deploy-git.spec.ts \
  e2e/quality-gate/lifecycle.spec.ts \
  e2e/quality-gate/managed-services.spec.ts

if [[ "${OPENLANDER_E2E_SLOW:-}" == "1" ]]; then
  npx playwright test --project=quality-gate e2e/quality-gate/compose.spec.ts
fi
