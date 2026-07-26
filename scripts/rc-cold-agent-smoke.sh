#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${OPENLANDER_E2E_BASE_URL:-}" ]]; then
  echo "OPENLANDER_E2E_BASE_URL is required, for example http://localhost:10114" >&2
  exit 1
fi

check_clean_docker_surface() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required for RC cold-agent smoke." >&2
    exit 1
  fi

  local offenders=()
  local name
  local names
  if ! names="$(docker ps -a --format '{{.Names}}')"; then
    echo "Docker daemon is not reachable from this shell." >&2
    echo "Run the RC smoke from a user/session that can access Docker on the QA host." >&2
    exit 1
  fi

  while IFS= read -r name; do
    case "${name}" in
      openlander | openlander-db | openlander-edge-proxy)
        ;;
      # All OpenLander-managed app/service containers use the ol- prefix.
      ol-*)
        offenders+=("${name}")
        ;;
    esac
  done <<<"${names}"

  if ((${#offenders[@]} > 0)); then
    echo "Refusing to run RC cold-agent smoke on a non-clean OpenLander Docker surface." >&2
    echo "Use a fresh/dedicated QA host or remove these existing OpenLander-owned containers first:" >&2
    printf '  - %s\n' "${offenders[@]}" >&2
    exit 1
  fi
}

cat >&2 <<'MSG'
Running OpenLander RC cold-agent smoke.

Requirements:
- run this on a fresh or dedicated QA host, not a dogfood/shared Docker daemon
- start OpenLander from the exact RC artifact before invoking this script
- ensure Docker and the public test repositories are reachable
- for an isolated VM whose runtime ports are SSH-forwarded with an offset, set OPENLANDER_E2E_RUNTIME_PORT_OFFSET
MSG

check_clean_docker_surface

export OPENLANDER_E2E_RC_SMOKE=1

npx playwright test --project=quality-gate \
  e2e/quality-gate/auth.spec.ts \
  e2e/quality-gate/mcp.spec.ts \
  e2e/quality-gate/deploy-git.spec.ts \
  e2e/quality-gate/delivery-workspace-live.spec.ts \
  e2e/quality-gate/interface-first-agent.spec.ts \
  e2e/quality-gate/lifecycle.spec.ts \
  e2e/quality-gate/managed-services.spec.ts

if [[ "${OPENLANDER_E2E_SLOW:-}" == "1" ]]; then
  npx playwright test --project=quality-gate e2e/quality-gate/compose.spec.ts
fi
