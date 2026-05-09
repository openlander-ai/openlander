#!/usr/bin/env bash
# Soak-grep CI gate — used during the 7-day post-merge soak window to
# detect any post-0012 schema mismatch surfacing in production logs.
#
# Plan §"Test Strategy" Observability lane (b):
#   tools/qa/soak-grep.sh runs against ~/.openlander/error.log (or a path
#   passed as $1) and greps for symptom patterns that indicate a stale
#   reader against the post-0012 schema. ANY MATCH FAILS — the soak gate
#   is binary green/red.
#
# Patterns matched (forensic anchors for the dropped/repointed columns):
#   - "no such column: status"           (projects.status)
#   - "no such column: assigned_port"    (projects.assigned_port)
#   - "no such column: container_id"     (projects.container_id)
#   - "no such column: image_tag"        (projects.image_tag)
#   - "no such column: parent_project_id"(projects.parent_project_id)
#   - "no such column: project_id"       (per-deployable FK leftover)
#   - "no such column: type"             (services.type)
#   - "no such column: image"            (services.image)
#   - "no such column: port"             (services.port)
#   - "no such column: env_vars"         (services.env_vars)
#   - "FOREIGN KEY constraint failed"
#
# Usage:
#   tools/qa/soak-grep.sh                       # default: ~/.openlander/error.log
#   tools/qa/soak-grep.sh /path/to/error.log    # explicit path
#
# Exit codes:
#   0 — no matches (clean)
#   1 — ≥1 matches (soak window blocks GA tag)
#   2 — log file not found

set -euo pipefail

LOG_PATH="${1:-${HOME}/.openlander/error.log}"

if [[ ! -f "${LOG_PATH}" ]]; then
  echo "[soak-grep] log file not found: ${LOG_PATH}" >&2
  exit 2
fi

PATTERNS=(
  "no such column: status"
  "no such column: assigned_port"
  "no such column: container_id"
  "no such column: image_tag"
  "no such column: parent_project_id"
  "no such column: project_id"
  "no such column: type"
  "no such column: image"
  "no such column: port"
  "no such column: env_vars"
  "FOREIGN KEY constraint failed"
)

EGREP_PATTERN=""
for p in "${PATTERNS[@]}"; do
  if [[ -z "${EGREP_PATTERN}" ]]; then
    EGREP_PATTERN="${p}"
  else
    EGREP_PATTERN="${EGREP_PATTERN}|${p}"
  fi
done

# -E for extended regex; -n to print line numbers; -c for count fallback.
matches=$(grep -E -n "${EGREP_PATTERN}" "${LOG_PATH}" || true)

if [[ -n "${matches}" ]]; then
  count=$(echo "${matches}" | wc -l | tr -d '[:space:]')
  echo "[soak-grep] FAIL: ${count} matches in ${LOG_PATH}" >&2
  echo "${matches}" | head -20 >&2
  exit 1
fi

echo "[soak-grep] PASS: 0 matches in ${LOG_PATH}"
exit 0
