#!/usr/bin/env bash
# Phase B start gate per ralplan-v4-sprint.md
#
# Hits each Phase E_NEW endpoint and prints the top-level field names via
# jq so CI (and humans) can verify the response shape without a running
# database seed. Exits 0 when every endpoint returns the expected HTTP
# status; exits non-zero on any HTTP 5xx or curl failure.
#
# Usage:
#   SERVICE_ID=<id> PROJECT_ID=<id> DEPLOYMENT_ID=<id> bash tools/qa/smoke-endpoint-shapes.sh
#
# Optional:
#   OPENLANDER_PORT  — backend port (default 3000)
#   AUTH_TOKEN       — Bearer token when auth is enabled

set -euo pipefail

PORT="${OPENLANDER_PORT:-3000}"
BASE="http://localhost:${PORT}/api"

# ── Require caller-supplied IDs ───────────────────────────────────────────────
if [[ -z "${SERVICE_ID:-}" || -z "${PROJECT_ID:-}" || -z "${DEPLOYMENT_ID:-}" ]]; then
  echo "Usage: SERVICE_ID=<id> PROJECT_ID=<id> DEPLOYMENT_ID=<id> $0" >&2
  echo "" >&2
  echo "  SERVICE_ID     — an existing service id (for /metrics and /health)" >&2
  echo "  PROJECT_ID     — an existing project id (for /topology)" >&2
  echo "  DEPLOYMENT_ID  — an existing deployment id (for /log/stream)" >&2
  exit 1
fi

AUTH_HEADER=()
if [[ -n "${AUTH_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi

PASS=0
FAIL=0

# ── Helper ────────────────────────────────────────────────────────────────────
check() {
  local label="$1"
  local expected_status="$2"
  local url="$3"
  shift 3
  local extra_args=("$@")

  echo ""
  echo "── ${label}"
  echo "   ${url}"

  local http_code
  local body
  body=$(curl -s --fail-with-body -w '\n__STATUS__%{http_code}' \
    "${AUTH_HEADER[@]}" "${extra_args[@]}" "${url}" 2>&1) || true

  # Extract status code appended by -w
  http_code=$(echo "${body}" | grep '__STATUS__' | sed 's/__STATUS__//')
  body=$(echo "${body}" | grep -v '__STATUS__')

  if [[ "${http_code}" == "${expected_status}" ]]; then
    echo "   HTTP ${http_code} OK"
    PASS=$((PASS + 1))
    # Print top-level keys if body is JSON
    if echo "${body}" | jq -e . > /dev/null 2>&1; then
      echo "   keys: $(echo "${body}" | jq -r 'if type=="array" then .[0] | keys[] else keys[] end' 2>/dev/null | tr '\n' ' ')"
    fi
  else
    echo "   FAIL — expected HTTP ${expected_status}, got HTTP ${http_code}" >&2
    FAIL=$((FAIL + 1))
  fi
}

check_204() {
  local label="$1"
  local url="$2"

  echo ""
  echo "── ${label}"
  echo "   ${url}"

  local http_code
  http_code=$(curl -s -o /dev/null -w '%{http_code}' \
    "${AUTH_HEADER[@]}" "${url}") || true

  if [[ "${http_code}" == "204" || "${http_code}" == "200" ]]; then
    echo "   HTTP ${http_code} OK (204 = no samples yet, 200 = has data)"
    PASS=$((PASS + 1))
  else
    echo "   FAIL — expected HTTP 200 or 204, got HTTP ${http_code}" >&2
    FAIL=$((FAIL + 1))
  fi
}

# ── 1. Deploy log SSE stream (Task 2) — check headers only, don't consume stream
echo ""
echo "── Deploy Log SSE Stream"
echo "   ${BASE}/deployments/${DEPLOYMENT_ID}/log/stream"
sse_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 \
  "${AUTH_HEADER[@]}" "${BASE}/deployments/${DEPLOYMENT_ID}/log/stream") || true
if [[ "${sse_status}" == "200" || "${sse_status}" == "404" ]]; then
  echo "   HTTP ${sse_status} OK (200 = stream open, 404 = deployment not found)"
  PASS=$((PASS + 1))
else
  echo "   FAIL — expected HTTP 200 or 404, got HTTP ${sse_status}" >&2
  FAIL=$((FAIL + 1))
fi

# ── 2. Service health (Task 4)
check "Service Health" "200" "${BASE}/services/${SERVICE_ID}/health"

# ── 3. Service metrics (Task 5) — may be 200 or 204
check_204 "Service Metrics (15m)" "${BASE}/services/${SERVICE_ID}/metrics?range=15m"

# ── 4. Project topology (Task 6)
check "Project Topology" "200" "${BASE}/projects/${PROJECT_ID}/topology"

# ── 5a. Notifications webhook GET (Task 7) — 200 or 404 depending on state
echo ""
echo "── Notifications Webhook GET"
echo "   ${BASE}/settings/notifications/webhook"
webhook_get_status=$(curl -s -o /dev/null -w '%{http_code}' \
  "${AUTH_HEADER[@]}" "${BASE}/settings/notifications/webhook") || true
if [[ "${webhook_get_status}" == "200" || "${webhook_get_status}" == "404" ]]; then
  echo "   HTTP ${webhook_get_status} OK (200 = configured, 404 = not yet set)"
  PASS=$((PASS + 1))
else
  echo "   FAIL — expected HTTP 200 or 404, got HTTP ${webhook_get_status}" >&2
  FAIL=$((FAIL + 1))
fi

# ── 5b. Notifications webhook POST (Task 7)
check "Notifications Webhook POST" "200" "${BASE}/settings/notifications/webhook" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook","events":["deploy.success","deploy.failure"]}'

# ── 5c. Notifications webhook DELETE (Task 7)
check "Notifications Webhook DELETE" "200" "${BASE}/settings/notifications/webhook" \
  -X DELETE

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────"
echo "  PASSED: ${PASS}   FAILED: ${FAIL}"
echo "────────────────────────────────────"

if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
