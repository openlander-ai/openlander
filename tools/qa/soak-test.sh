#!/usr/bin/env bash
# soak-test.sh — long-running mixed-workload driver for OpenLander 1.0 GA.
#
# Runs in a dedicated tmp HOME so it never touches the operator's data
# directory. Spawns a side OpenLander instance on $SOAK_PORT with its own
# admin password, then loops a mixed workload while a metrics collector
# snapshots every cycle. Designed to run for 24h+ unattended.
#
# Workload (per cycle, ~5min):
#   - One redeploy on the seed project
#   - One create+purge of a throwaway qa-soak-{ts} project
#   - Touch /api/ops/activity (SSE-style) to keep a follow consumer warm
#   - Every 6th cycle: stop+start the seed project (recovery exercise)
#
# Usage:
#   ./soak-test.sh start          # start in background (writes PID to tools/qa/soak-logs/run-{ts}/pid)
#   ./soak-test.sh status         # show current run + last metrics line
#   ./soak-test.sh stop           # graceful stop + cleanup containers
#   ./soak-test.sh once           # run a single cycle (for testing)
#
# Env overrides:
#   SOAK_PORT           default 10116
#   SOAK_HOME           default $TMPDIR/ol-soak-{ts}
#   SOAK_PASSWORD       default soak-test-pwd
#   SOAK_CYCLE_SEC      default 300 (5min)
#   SOAK_DURATION_SEC   default 86400 (24h)
#   SOAK_DATABASE_URL   required Postgres URL for the side OpenLander instance

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LOGS_DIR="$HERE/soak-logs"
mkdir -p "$LOGS_DIR"

SOAK_PORT="${SOAK_PORT:-10116}"
SOAK_PASSWORD="${SOAK_PASSWORD:-soak-test-pwd}"
SOAK_CYCLE_SEC="${SOAK_CYCLE_SEC:-300}"
SOAK_DURATION_SEC="${SOAK_DURATION_SEC:-86400}"
SOAK_DATABASE_URL="${SOAK_DATABASE_URL:-}"
SEED_REPO="${SEED_REPO:-https://github.com/openlander-ai/test-no-dockerfile}"
BASE_URL="http://localhost:$SOAK_PORT"

cmd="${1:-status}"

current_run() {
  ls -1d "$LOGS_DIR"/run-* 2>/dev/null | sort | tail -1
}

login_cookie() {
  local pw="$1"
  curl -sS -i -X POST "$BASE_URL/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"password\":\"$pw\"}" 2>/dev/null \
    | grep -i 'set-cookie:' \
    | sed 's/.*ol_session=\([^;]*\).*/ol_session=\1/'
}

setup_password() {
  curl -sS -X POST "$BASE_URL/api/auth/setup-password" \
    -H 'Content-Type: application/json' \
    -d "{\"password\":\"$SOAK_PASSWORD\"}" >/dev/null 2>&1 || true
}

wait_for_health() {
  local i
  for i in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start_instance() {
  local home_dir="$1"
  local log_file="$2"
  if [ -z "$SOAK_DATABASE_URL" ]; then
    echo "[soak] SOAK_DATABASE_URL is required after the Postgres cutover" >&2
    return 1
  fi
  echo "[soak] starting OpenLander on $BASE_URL with HOME=$home_dir"
  HOME="$home_dir" OPENLANDER_DATABASE_URL="$SOAK_DATABASE_URL" \
    nohup npx tsx "$(dirname "$HERE")/../src/cli/index.ts" --port "$SOAK_PORT" \
    >"$log_file" 2>&1 &
  echo $!
}

cycle() {
  local cookie="$1"
  local seed_id="$2"
  local cycle_idx="$3"
  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%S)
  local throwaway="qa-soak-$stamp"

  # 1. redeploy seed
  curl -sS -X POST "$BASE_URL/api/projects/$seed_id/redeploy" \
    -H "Cookie: $cookie" -H 'Content-Type: application/json' -d '{}' \
    -o /dev/null -w '[soak] redeploy seed → %{http_code}\n'

  # 2. create + purge throwaway
  local create_resp
  create_resp=$(curl -sS -X POST "$BASE_URL/api/projects" \
    -H "Cookie: $cookie" -H 'Content-Type: application/json' \
    -d "{\"repo_url\":\"$SEED_REPO\",\"name\":\"$throwaway\"}")
  local throw_id
  throw_id=$(echo "$create_resp" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
  p=d.get("project",d)
  print(p.get("id",""))
except Exception: pass' 2>/dev/null)
  if [ -n "$throw_id" ]; then
    curl -sS -X DELETE "$BASE_URL/api/projects/$throw_id/purge?confirm=true" \
      -H "Cookie: $cookie" -o /dev/null -w '[soak] purge throwaway → %{http_code}\n'
  else
    echo "[soak] throwaway create did not return an id (probably busy) — skip"
  fi

  # 3. ops feed touch
  curl -sS -H "Cookie: $cookie" "$BASE_URL/api/ops/activity?limit=10" >/dev/null

  # 4. every 6th cycle (~30min): stop + start seed (recovery exercise)
  if [ $((cycle_idx % 6)) -eq 0 ]; then
    curl -sS -X POST "$BASE_URL/api/projects/$seed_id/stop" \
      -H "Cookie: $cookie" -o /dev/null -w '[soak] stop seed → %{http_code}\n'
    sleep 5
    curl -sS -X POST "$BASE_URL/api/projects/$seed_id/start" \
      -H "Cookie: $cookie" -o /dev/null -w '[soak] start seed → %{http_code}\n'
  fi
}

case "$cmd" in
  start)
    if [ -n "$(current_run)" ] && kill -0 "$(cat "$(current_run)/pid" 2>/dev/null)" 2>/dev/null; then
      echo "soak already running at $(current_run)"
      exit 1
    fi
    ts=$(date -u +%Y%m%dT%H%M%S)
    RUN_DIR="$LOGS_DIR/run-$ts"
    mkdir -p "$RUN_DIR"
    SOAK_HOME="${SOAK_HOME:-${TMPDIR:-/tmp}/ol-soak-$ts}"
    mkdir -p "$SOAK_HOME"
    echo "$SOAK_HOME" > "$RUN_DIR/home"

    INSTANCE_LOG="$RUN_DIR/instance.log"
    METRICS_LOG="$RUN_DIR/metrics.jsonl"
    LOOP_LOG="$RUN_DIR/loop.log"

    if ! INSTANCE_PID=$(start_instance "$SOAK_HOME" "$INSTANCE_LOG"); then
      exit 1
    fi
    echo "$INSTANCE_PID" > "$RUN_DIR/instance.pid"
    echo "[soak] instance pid=$INSTANCE_PID, waiting for /health…" | tee -a "$LOOP_LOG"
    if ! wait_for_health; then
      echo "[soak] instance did not become healthy in 120s — abort"
      kill "$INSTANCE_PID" 2>/dev/null || true
      exit 1
    fi

    echo "[soak] setup password" | tee -a "$LOOP_LOG"
    setup_password

    cookie=$(login_cookie "$SOAK_PASSWORD")
    if [ -z "$cookie" ]; then
      echo "[soak] login failed" | tee -a "$LOOP_LOG"
      kill "$INSTANCE_PID" 2>/dev/null || true
      exit 1
    fi

    echo "[soak] creating seed project" | tee -a "$LOOP_LOG"
    seed_resp=$(curl -sS -X POST "$BASE_URL/api/projects" \
      -H "Cookie: $cookie" -H 'Content-Type: application/json' \
      -d "{\"repo_url\":\"$SEED_REPO\",\"name\":\"qa-soak-seed\"}")
    seed_id=$(echo "$seed_resp" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); p=d.get("project",d); print(p.get("id",""))
except: pass' 2>/dev/null)
    if [ -z "$seed_id" ]; then
      echo "[soak] seed create failed: $seed_resp" | tee -a "$LOOP_LOG"
      kill "$INSTANCE_PID" 2>/dev/null || true
      exit 1
    fi
    echo "$seed_id" > "$RUN_DIR/seed.id"

    # background loop
    (
      end_ts=$(( $(date +%s) + SOAK_DURATION_SEC ))
      cycle_idx=0
      while [ "$(date +%s)" -lt "$end_ts" ]; do
        cycle_idx=$((cycle_idx+1))
        echo "=== cycle $cycle_idx @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOOP_LOG"
        cookie=$(login_cookie "$SOAK_PASSWORD")
        cycle "$cookie" "$seed_id" "$cycle_idx" 2>&1 | tee -a "$LOOP_LOG"
        OPENLANDER_BASE_URL="$BASE_URL" OPENLANDER_ADMIN_PASSWORD="$SOAK_PASSWORD" \
          "$HERE/soak-metrics.sh" >>"$METRICS_LOG"
        sleep "$SOAK_CYCLE_SEC"
      done
      echo "[soak] duration reached, ending loop" | tee -a "$LOOP_LOG"
    ) &
    LOOP_PID=$!
    echo "$LOOP_PID" > "$RUN_DIR/pid"
    echo "[soak] loop pid=$LOOP_PID, instance pid=$INSTANCE_PID, run dir=$RUN_DIR"
    echo "[soak] tail with: tail -f $LOOP_LOG  /  $METRICS_LOG"
    ;;

  status)
    run="$(current_run)"
    if [ -z "$run" ]; then
      echo "no soak runs in $LOGS_DIR"
      exit 0
    fi
    pid=$(cat "$run/pid" 2>/dev/null || echo "?")
    inst=$(cat "$run/instance.pid" 2>/dev/null || echo "?")
    alive="dead"
    if kill -0 "$pid" 2>/dev/null; then alive="alive"; fi
    echo "run: $run"
    echo "loop pid: $pid ($alive)"
    echo "instance pid: $inst"
    echo "last metrics line:"
    tail -1 "$run/metrics.jsonl" 2>/dev/null || echo "  (none yet)"
    ;;

  stop)
    run="$(current_run)"
    if [ -z "$run" ]; then echo "nothing to stop"; exit 0; fi
    pid=$(cat "$run/pid" 2>/dev/null || echo "")
    inst=$(cat "$run/instance.pid" 2>/dev/null || echo "")
    [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "[soak] killed loop pid=$pid"
    [ -n "$inst" ] && kill "$inst" 2>/dev/null && echo "[soak] killed instance pid=$inst"
    # cleanup any qa-soak-* containers
    if command -v docker >/dev/null 2>&1; then
      docker ps -a --filter name=qa-soak- --format '{{.ID}}' \
        | xargs -r docker rm -f >/dev/null 2>&1
      docker volume ls --filter name=qa-soak- --format '{{.Name}}' \
        | xargs -r docker volume rm >/dev/null 2>&1
    fi
    echo "[soak] stopped"
    ;;

  once)
    if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      echo "no instance reachable on $BASE_URL — start one first"
      exit 1
    fi
    cookie=$(login_cookie "$SOAK_PASSWORD")
    seed_id="${1:-}"
    if [ -z "$seed_id" ]; then echo "usage: once <seed_project_id>"; exit 1; fi
    cycle "$cookie" "$seed_id" 1
    OPENLANDER_BASE_URL="$BASE_URL" OPENLANDER_ADMIN_PASSWORD="$SOAK_PASSWORD" \
      "$HERE/soak-metrics.sh"
    ;;

  *)
    echo "usage: $0 {start|status|stop|once}"
    exit 2
    ;;
esac
