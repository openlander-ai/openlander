#!/usr/bin/env bash
# soak-metrics.sh — collect a single metric snapshot from the running OpenLander.
# Writes one JSON line to stdout. Designed to be called every N minutes by
# soak-test.sh (or a cron wrapper) and tee'd into a per-run log file.
#
# Usage:
#   ./soak-metrics.sh [BASE_URL] [PASSWORD]
# Env overrides: OPENLANDER_BASE_URL, OPENLANDER_ADMIN_PASSWORD

set -uo pipefail

BASE_URL="${1:-${OPENLANDER_BASE_URL:-http://localhost:10114}}"
PASSWORD="${2:-${OPENLANDER_ADMIN_PASSWORD:-admin}}"

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# auth
COOKIE_HEADER=$(curl -sS -i -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PASSWORD\"}" 2>/dev/null \
  | grep -i 'set-cookie:' \
  | sed 's/.*ol_session=\([^;]*\).*/ol_session=\1/' || true)

# health
health_json=$(curl -sS "$BASE_URL/health" 2>/dev/null || echo '{}')
health_status=$(printf '%s' "$health_json" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")
uptime=$(printf '%s' "$health_json" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("uptime",""))' 2>/dev/null || echo "")
docker_count=$(printf '%s' "$health_json" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("dockerContainers",0))' 2>/dev/null || echo 0)

# pm2 process metrics (if pm2 available)
pm2_restarts=0
pm2_mem_mb=0
pm2_cpu=0
pm2_unstable=0
if command -v pm2 >/dev/null 2>&1; then
  pm2_data=$(pm2 jlist 2>/dev/null | python3 -c '
import sys, json
try:
    arr = json.load(sys.stdin)
    p = next((x for x in arr if x["name"]=="openlander"), None)
    if p:
        env = p.get("pm2_env", {})
        mon = p.get("monit", {})
        print(f"{env.get(\"restart_time\",0)},{int(mon.get(\"memory\",0)/1048576)},{mon.get(\"cpu\",0)},{env.get(\"unstable_restarts\",0)}")
except Exception:
    pass
' 2>/dev/null)
  if [ -n "$pm2_data" ]; then
    pm2_restarts=$(echo "$pm2_data" | cut -d, -f1)
    pm2_mem_mb=$(echo "$pm2_data" | cut -d, -f2)
    pm2_cpu=$(echo "$pm2_data" | cut -d, -f3)
    pm2_unstable=$(echo "$pm2_data" | cut -d, -f4)
  fi
fi

# API-backed state metrics
db_size_kb=0
projects_total=0
projects_recovering=0
projects_error=0
deploy_locks_held=0
activity_rows=0
if [ -n "$COOKIE_HEADER" ]; then
  projects_json=$(curl -sS -H "Cookie: $COOKIE_HEADER" "$BASE_URL/api/projects?include_archived=true" 2>/dev/null || echo '{}')
  project_counts=$(printf '%s' "$projects_json" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    arr = data.get("projects", data if isinstance(data, list) else [])
    def val(row, *keys):
        for key in keys:
            if key in row:
                return row[key]
        return None
    active = [p for p in arr if not val(p, "archived_at", "archivedAt")]
    recovering = sum(1 for p in active if val(p, "status") == "recovering")
    error = sum(1 for p in active if val(p, "status") == "error")
    locked = sum(1 for p in active if val(p, "deploy_lock_session", "deployLockSession"))
    print(len(active), recovering, error, locked)
except Exception:
    print("0 0 0 0")
' 2>/dev/null)
  read -r projects_total projects_recovering projects_error deploy_locks_held <<<"$project_counts"

  activity_json=$(curl -sS -H "Cookie: $COOKIE_HEADER" "$BASE_URL/api/ops/activity?limit=50" 2>/dev/null || echo '{}')
  activity_rows=$(printf '%s' "$activity_json" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    rows = data.get("items") or data.get("activity") or data.get("activities") or []
    print(len(rows) if isinstance(rows, list) else 0)
except Exception:
    print(0)
' 2>/dev/null || echo 0)
fi

# disk
disk_pct=0
if df -h "$HOME/.openlander" 2>/dev/null | tail -1 >/dev/null; then
  disk_pct=$(df -h "$HOME/.openlander" 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
fi

# docker counts
qa_containers=0
qa_volumes=0
if command -v docker >/dev/null 2>&1; then
  qa_containers=$(docker ps -a --filter name=qa-soak- --format '{{.ID}}' 2>/dev/null | wc -l | tr -d ' ')
  qa_volumes=$(docker volume ls --filter name=qa-soak- --format '{{.Name}}' 2>/dev/null | wc -l | tr -d ' ')
fi

# ops feed snapshot speed (request latency)
ops_latency_ms=0
if [ -n "$COOKIE_HEADER" ]; then
  start=$(($(date +%s%N)/1000000))
  curl -sS -H "Cookie: $COOKIE_HEADER" "$BASE_URL/api/ops/activity?limit=5" -o /dev/null 2>/dev/null
  end=$(($(date +%s%N)/1000000))
  ops_latency_ms=$((end - start))
fi

# emit single JSON line
printf '{"ts":"%s","health":"%s","uptime":"%s","dockerContainers":%s,"pm2RestartTotal":%s,"pm2UnstableRestarts":%s,"pm2MemMb":%s,"pm2Cpu":%s,"dbSizeKb":%s,"projectsTotal":%s,"projectsRecovering":%s,"projectsError":%s,"deployLocksHeld":%s,"activityRows":%s,"diskPct":%s,"qaContainers":%s,"qaVolumes":%s,"opsLatencyMs":%s}\n' \
  "$ts" "$health_status" "$uptime" "$docker_count" \
  "$pm2_restarts" "$pm2_unstable" "$pm2_mem_mb" "$pm2_cpu" \
  "$db_size_kb" "$projects_total" "$projects_recovering" "$projects_error" \
  "$deploy_locks_held" "$activity_rows" "$disk_pct" \
  "$qa_containers" "$qa_volumes" "$ops_latency_ms"
