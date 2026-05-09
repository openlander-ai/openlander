#!/usr/bin/env bash
# Post-deploy smoke against a live OpenLander instance.
#
# Logs in once via /api/auth/login, then probes the set of endpoints the
# 1.0 dashboard depends on and asserts HTTP 200 + minimal JSON shape (jq
# expression that returns truthy for the expected key). Any failure
# fails the whole run with a non-zero exit so a CI scheduler / post-deploy
# hook can page on it.
#
# Usage:
#   OPENLANDER_PASSWORD=xxx tools/qa/smoke-live.sh
#   OPENLANDER_PASSWORD=xxx OPENLANDER_URL=http://10.0.0.5:10114 tools/qa/smoke-live.sh
#
# Defaults to the local OpenLander port. Set OPENLANDER_URL to target a remote instance.
#
# Probes only GET endpoints that don't mutate state. SSE endpoints are
# checked for the Content-Type header without consuming the stream.

set -euo pipefail

BASE="${OPENLANDER_URL:-http://localhost:10114}"
PASSWORD="${OPENLANDER_PASSWORD:-}"

if [[ -z "${PASSWORD}" ]]; then
  echo "OPENLANDER_PASSWORD env required" >&2
  exit 2
fi

JAR="$(mktemp -t ol-smoke-cookie.XXXXXX)"
trap 'rm -f "${JAR}"' EXIT

# ── Login ────────────────────────────────────────────────────────────────────
login_status=$(curl -s -o /dev/null -w '%{http_code}' \
  -c "${JAR}" -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"${PASSWORD}\"}" \
  "${BASE}/api/auth/login") || true

if [[ "${login_status}" != "200" ]]; then
  echo "FAIL: /api/auth/login returned ${login_status}" >&2
  exit 1
fi
echo "✓ login → ${BASE}"

PASS=0
FAIL=0
FAILURES=()

# probe LABEL URL JQ_EXPR
#   JQ_EXPR runs against the response body; non-empty truthy = pass.
probe() {
  local label="$1" url="$2" expr="$3"
  local body status
  body=$(curl -s -b "${JAR}" -w '\n__STATUS__%{http_code}' "${BASE}${url}")
  status=$(printf '%s' "${body}" | tail -n1 | sed 's/__STATUS__//')
  body=$(printf '%s' "${body}" | sed '$d')
  if [[ "${status}" != "200" ]]; then
    echo "  ✗ ${label}: HTTP ${status}"
    FAIL=$((FAIL + 1))
    FAILURES+=("${label} (HTTP ${status})")
    return
  fi
  if ! printf '%s' "${body}" | jq -e "${expr}" > /dev/null 2>&1; then
    echo "  ✗ ${label}: shape mismatch — ${expr}"
    FAIL=$((FAIL + 1))
    FAILURES+=("${label} (shape)")
    return
  fi
  echo "  ✓ ${label}"
  PASS=$((PASS + 1))
}

# probe_stream LABEL URL — checks Content-Type is a streaming format
# (text/event-stream OR application/x-ndjson). Kills the connection after
# 2s so we don't hang waiting for a real event.
probe_stream() {
  local label="$1" url="$2"
  local ctype
  ctype=$(curl -s -b "${JAR}" -D - -o /dev/null --max-time 2 \
    "${BASE}${url}" 2>/dev/null | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tr -d '\r\n' | head -c 64)
  if [[ "${ctype}" == text/event-stream* || "${ctype}" == application/x-ndjson* ]]; then
    echo "  ✓ ${label} (Content-Type: ${ctype})"
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${label}: expected stream Content-Type, got '${ctype}'"
    FAIL=$((FAIL + 1))
    FAILURES+=("${label} (no stream Content-Type)")
  fi
}

echo ""
echo "── core list endpoints"
probe "GET /api/projects                          " "/api/projects"           '.projects | type == "array"'
probe "GET /api/system/stats                      " "/api/system/stats"       '.cpu != null and .memory != null'
probe "GET /api/activity?limit=5                  " "/api/activity?limit=5"   '.activities | type == "array"'
probe "GET /api/deployments/recent?limit=1        " "/api/deployments/recent?limit=1" '.deployments | type == "array"'

echo ""
echo "── MCP"
probe "GET /api/mcp/status                        " "/api/mcp/status"         '.totalConnected != null and (.sessions | type == "array")'

# Pull first project id (if any) for the per-project probes
first_pid=$(curl -s -b "${JAR}" "${BASE}/api/projects" | jq -r '.projects[0].id // empty')
if [[ -n "${first_pid}" ]]; then
  echo ""
  echo "── per-project (id=${first_pid:0:12}…)"
  probe "GET /api/projects/:id                      " "/api/projects/${first_pid}" '.id != null and .name != null'
  probe "GET /api/projects/:id/topology             " "/api/projects/${first_pid}/topology" '.services | type == "array"'
  probe "GET /api/projects/:id/services             " "/api/projects/${first_pid}/services" '.services | type == "array"'

  # Pull first service id under that project
  first_sid=$(curl -s -b "${JAR}" "${BASE}/api/projects/${first_pid}/services" | jq -r '.services[0].id // empty')
  if [[ -n "${first_sid}" ]]; then
    echo ""
    echo "── per-service (id=${first_sid:0:12}…)"
    probe_stream "GET /api/projects/:p/services/:s/logs    " "/api/projects/${first_pid}/services/${first_sid}/logs?follow=true&limit=1"
  fi
else
  echo ""
  echo "  (no projects on this instance — skipping per-project probes)"
fi

echo ""
echo "──────────────────────────────────────────────"
echo "PASS=${PASS} FAIL=${FAIL}"
if (( FAIL > 0 )); then
  echo ""
  echo "failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - ${f}"
  done
  exit 1
fi
