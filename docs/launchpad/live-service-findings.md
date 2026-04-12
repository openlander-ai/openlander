# live-service-pulse — OpenLander QA Findings

**Repo:** https://github.com/lehdqlsl/live-service-pulse  
**Deployed as:** `live-service-app` (name conflict with legacy container forced rename)  
**DB Service:** `live-service-db` (PostgreSQL 17, OpenLander managed)  
**URL:** http://live-service-app.192.168.219.133.sslip.io  
**Version:** v2.2.0 (Docker HEALTHCHECK, version bump)

---

## OpenLander MCP Operations Test Results

### ✅ Tools That Worked Well

| Tool                                 | Verdict      | Notes                                                                                                                                              |
| ------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects`                      | ✅ Excellent | 21 projects listed with full metadata, URL, status                                                                                                 |
| `list_services`                      | ✅ Excellent | 8 services with type, port, external access                                                                                                        |
| `create_service` (postgresql)        | ✅ Excellent | Auto-generated credentials, connection string, suggested env var name — zero config needed                                                         |
| `get_service_credentials`            | ✅ Excellent | Returns internal DNS host, external access, connection strings per network type                                                                    |
| `create_deploy_plan`                 | ✅ Good      | Detected Dockerfile, found env vars from source code, linked to existing services                                                                  |
| `update_deploy_plan`                 | ✅ Good      | Filling missing env vars moved plan from `needs_input` to `ready`                                                                                  |
| `validate_deploy_plan`               | ✅ Good      | Pre-flight checks caught potential issues                                                                                                          |
| `deploy` (one-call)                  | ✅ Excellent | 8 seconds from trigger to running container. Best-in-class DX                                                                                      |
| `get_deploy_status` (wait mode)      | ✅ Excellent | Blocks until done, returns URLs + health. Perfect for automation                                                                                   |
| `get_logs`                           | ✅ Good      | Simple, returns recent stdout/stderr                                                                                                               |
| `get_build_log`                      | ✅ Excellent | Shows clone → diff → build → run → connectivity check. The `[connectivity] ✓ ol-svc-live-service-db:5432 (DNS OK, TCP OK)` auto-check is brilliant |
| `set_env_vars`                       | ✅ Excellent | Auto-triggers redeploy after env change. Smart and safe                                                                                            |
| `redeploy_project`                   | ✅ Good      | Picks up new git commits, rebuilds. Cached deploys in ~3s, full in ~30s                                                                            |
| `get_deploy_history`                 | ✅ Excellent | Full history with commit SHA, duration, trigger, status. Great for auditing                                                                        |
| `expose_public` / `unexpose_public`  | ✅ Good      | Cloudflare tunnel in seconds. Random URL is fine for testing                                                                                       |
| `enable_webhook` / `disable_webhook` | ✅ Good      | Clean setup, returns path + secret for GitHub config                                                                                               |
| `backup_service`                     | ✅ Good      | 6.7MB backup in seconds. Backup ID for restore                                                                                                     |
| `list_service_backups`               | ✅ Good      | Lists with size and timestamp                                                                                                                      |
| `exec_service_container`             | ✅ Excellent | Run SQL queries directly. Exit code + stdout/stderr separation. Very useful for debugging                                                          |
| `get_system_stats`                   | ✅ Excellent | Host overview with CPU/memory/disk. Formatted summary + structured data                                                                            |
| `get_disk_usage`                     | ✅ Excellent | Per-volume sizes, managed volumes listed separately. Good for capacity planning                                                                    |
| `get_service_status`                 | ✅ Good      | Shows health, container ID, healthDetail with last error message                                                                                   |
| `get_alerts`                         | ✅ Good      | Works. No alerts = empty array (correct)                                                                                                           |
| `get_service_logs`                   | ✅ Good      | PostgreSQL logs accessible                                                                                                                         |

### 🐛 Bugs Found

#### BUG-1: `get_project_stats` returns all zeros

- **Tool:** `get_project_stats`
- **Input:** `{ project_name: "live-service-app" }`
- **Expected:** CPU %, memory MB, uptime seconds for a running container
- **Actual:** `{ cpu_percent: 0, memory_usage_mb: 0, memory_limit_mb: 0, restarts: 0, uptime_seconds: 0 }`
- **Reproducibility:** 100% — tested 3 times across different sessions
- **Impact:** Cannot monitor resource usage of running projects via MCP
- **Suspected cause:** Docker stats API may not be queried, or stats collection is async and always returns stale/empty data

#### BUG-2: `rollback_project` always fails — "No previous image available"

- **Tool:** `rollback_project`
- **Input:** `{ project_name: "live-service-app" }`
- **Context:** 6 deploys done (5 success, 1 failed), including deploys from 2 different commits (c0dc74c, 08852f3)
- **Expected:** Rollback to previous successful deploy's image
- **Actual:** `"No previous image available for rollback"` every time
- **Impact:** Rollback is unusable. If a bad deploy goes out, there's no way to revert via MCP
- **Suspected cause:** `redeploy_project` overwrites `:latest` tag without preserving a `:previous` tag. The rollback mechanism has no image to fall back to

#### BUG-3: `deploy_blue_green` port conflict with external containers

- **Tool:** `deploy_blue_green`
- **Input:** `{ project_name: "live-service-app", health_check_path: "/health" }`
- **Error:** `Bind for 0.0.0.0:10040 failed: port is already allocated`
- **Context:** Port 10040 was used by a manually-created Docker container (`ol-svc-pulse-db`) not managed by OpenLander
- **Impact:** Blue-green deploy fails if ANY external container uses a port in OpenLander's range
- **Root cause:** Port allocator doesn't scan actual Docker port bindings, only its own DB

#### BUG-4: Deploy blocked by external container with `ol-` prefix

- **Tool:** `deploy` / `execute_deploy_plan`
- **Error:** `Container "ol-live-service-pulse" already exists (external, running)`
- **Context:** A manually-created Docker container named `ol-live-service-pulse` blocked deployment of OpenLander project `live-service-pulse`
- **Impact:** If someone (or another tool) creates a container with `ol-` prefix, OpenLander can't deploy that project name
- **Workaround:** Had to rename project to `live-service-app`
- **Suggestion:** Add a `force` flag to `deploy`/`execute_deploy_plan` that removes conflicting external containers, or add a standalone `cleanup_external_container` tool

### ⚠️ UX Issues

#### UX-1: `create_deploy_plan` shows ALL PostgreSQL services as candidates

- When creating a deploy plan, the `services` array listed all 5 PostgreSQL services in the system as potential matches
- The plan has no way to know which DB is intended — user must manually pick via `update_deploy_plan`
- **Suggestion:** If `DATABASE_URL` env var is already provided and points to a specific service, auto-resolve it instead of listing all candidates

#### UX-2: `get_service_status` shows "degraded" from stale health detail

- `live-service-db` showed `health: "degraded"` with healthDetail from a past restart: `FATAL: terminating connection due to administrator command`
- The DB was actually running fine and accepting connections
- **Suggestion:** Health status should be based on current liveness check, not last error log line

#### UX-3: No way to rename a project

- Had to deploy as `live-service-app` because `live-service-pulse` name was taken by external container
- No `rename_project` tool exists
- **Suggestion:** Add `rename_project` or at least allow re-creating with `force: true`

#### UX-4: `deploy` plan auto-detection marks optional env vars as required

- `SEED_MONITORS` (only used on first startup when DB is empty) was listed as `required`
- `DATABASE_SSL` (has a default of `false`) was also listed as required
- **Suggestion:** Distinguish between "referenced in code" vs "required for app to start". Parse default values from code

#### UX-5: Deploy history lacks version/tag info

- `get_deploy_history` shows commit SHA but not the app version or Docker image tag
- When troubleshooting, knowing "this was v2.1.0" vs "v2.2.0" is more useful than raw SHAs
- **Suggestion:** Include app version from package.json or Dockerfile label in deploy history

### 💡 Improvement Ideas

1. **`get_project_stats` should work** — This is the most impactful missing feature. Without resource metrics, you can't do capacity planning or detect memory leaks

2. **Rollback that actually works** — Tag previous image as `:rollback` before overwriting `:latest`. This is table-stakes for production deployments

3. **Health check integration** — Show container HEALTHCHECK status in `get_deploy_status` and `list_projects`. The `health: "running"` field doesn't distinguish between "running but unhealthy" vs "running and healthy"

4. **Log streaming / tail mode** — `get_logs` returns a snapshot. A `follow: true` or `since: "5m"` parameter would be useful for debugging

5. **Deploy diff preview** — Before `redeploy_project`, show what changed (new commits, file diff summary). The build log's `[diff] 3 files changed, 2 build-impacting` is great — expose this as a pre-deploy check

6. **`stop_project` / `start_project` distinction in history** — Deploy history only shows "success/failed". Manual stops/starts aren't logged

7. **Service dependency graph** — When deploying, auto-check that required services are running. The `[connectivity]` check in build log is great but silent in the API response

8. **Bulk env var validation** — `validate_deploy_plan` should flag `DATABASE_URL=postgresql://localhost` as an error (it currently only catches it in the plan phase)

### 👏 What OpenLander Does Really Well

1. **Speed** — 3-30 seconds from trigger to running container. Cached deploys in 1.5s is remarkable
2. **Service provisioning** — `create_service` with `template: postgresql` is zero-config perfection. Credentials auto-generated, connection string ready
3. **Build log transparency** — Clone → diff detect → dockerfile parse → build → run → connectivity check. Every step visible
4. **Auto-redeploy on env change** — `set_env_vars` triggering redeploy is the right default
5. **Connectivity pre-check** — `[connectivity] ✓ ol-svc-live-service-db:5432 (DNS OK, TCP OK)` catches network issues before the app starts
6. **`_agent_guidance`** — Every response includes next-step hints. This makes AI agent integration seamless
7. **One-call deploy** — `deploy` tool that handles plan+execute+wait is the happy path done right
8. **Backup simplicity** — One call to backup, one call to list, backup IDs for restore. No config needed

---

## Deployment Timeline

| #   | Time     | Tool                           | Result           | Duration |
| --- | -------- | ------------------------------ | ---------------- | -------- |
| 1   | 09:46:24 | `deploy` (initial)             | ✅ Success       | 7.8s     |
| 2   | 09:46:54 | `set_env_vars` (auto-redeploy) | ✅ Success       | 1.4s     |
| 3   | 09:47:27 | `deploy_blue_green`            | ❌ Port conflict | 12.0s    |
| 4   | 09:47:43 | `redeploy_project` (recovery)  | ✅ Success       | 1.5s     |
| 5   | 09:48:44 | `redeploy_project` (no_cache)  | ✅ Success       | 9.8s     |
| 6   | 09:51:23 | `redeploy_project` (v2.2.0)    | ✅ Success       | 29.6s    |

## App Status at QA Completion

- **Version:** v2.2.0 with Docker HEALTHCHECK
- **Monitors:** 3 (Google, GitHub, Cloudflare) — all UP
- **Checks recorded:** 30+ and growing
- **DB backup:** 1 snapshot (6.7MB)
- **Public URL tested:** TryCloudflare tunnel works
- **Webhook config tested:** GitHub webhook setup/teardown works

---

## 2차 운영 테스트 (2026-04-03 후반)

### 추가 도구 테스트 결과

| 도구                                 | 결과            | 비고                                       |
| ------------------------------------ | --------------- | ------------------------------------------ |
| `get_logs(lines=20)`                 | ✅              | v2.1.0 정상 구동, 요청 로깅 확인           |
| `get_project_stats`                  | ❌ BUG-001 재현 | cpu=0, memory=0, uptime=0 (또 나옴)        |
| `get_alerts`                         | ✅              | 0건, 정상                                  |
| `get_deploy_history`                 | ✅              | 5건 이력, 4성공/1실패, duration 정확       |
| `rollback_project`                   | ✅              | "No previous image" — 거부 정확, 에러 명확 |
| `expose_public`                      | ✅              | Cloudflare URL 즉시 생성                   |
| `unexpose_public`                    | ✅              | 즉시 해제                                  |
| `backup_service`                     | ✅              | **6.7MB** 백업 생성 (2개 누적)             |
| `list_service_backups`               | ✅              | 2건 조회, ID/날짜/용량 정확                |
| `exec_service_container`             | ✅              | SQL 직접 실행: "3 monitors, 30 checks"     |
| `get_system_stats`                   | ✅              | CPU 38%, RAM 76%, Disk 87%                 |
| `get_disk_usage`                     | ✅              | managed volumes 목록 + 크기                |
| `get_service_status`                 | ⚠️ BUG-003      | health: "degraded" — 과거 로그 기반 오탐   |
| `get_build_log`                      | ✅              | connectivity check 포함, 1.4초 빌드        |
| `enable_webhook` + `disable_webhook` | ✅              | 설정/해제 즙어있음                         |
| `redeploy(no_cache)` → v2.2.0        | ❌→✅           | **BUG-004 재현** 후 DB 재시작으로 복구     |

### BUG-004 재현: ENETUNREACH (3회째)

```
Error: connect ENETUNREACH 172.22.0.27:5432
```

- `redeploy_project(no_cache=true)` 후 발생
- DB IP가 변경되었으나 앱이 stale IP 참조
- **해결:** `stop_service` + `start_service` + `redeploy_project` → 25초 만에 v2.2.0 배포 성공
- **제안:** 배포 시 의존 서비스 health probe → unhealthy면 자동 재시작 후 배포

### v2.2.0 배포 성공

- `Pulse v2.2.0 running on port 3000` 확인
- Docker HEALTHCHECK 추가됨
- 요청 로깅 정상 작동: `GET / 200 51ms`

### 추가 발견

1. **`backup_service` ⭐** — 원클릭 6.7MB tar.gz. `list_service_backups`로 목록 관리. 재해 복구 플로우 완전.
2. **`exec_service_container` ⭐** — DB 내부 SQL 직접 실행. 디버깅에 핵심.
3. **`get_disk_usage`** — managed volume별 크기 확인 가능. `live-service-db` = 48MB.
4. **BUG-001 재현 확정** — `get_project_stats`가 항상 0. Docker stats API 타이밍 또는 container ID 매핑 문제.
5. **BUG-003 재현 확정** — DB 정상 작동 중인데 `health: "degraded"`. 과거 FATAL 로그 기반 판정 오류.
6. **BUG-004 패턴 확인** — `no_cache` redeploy가 네트워크 불안정을 트리거함. 일반 redeploy는 문제없으나 클린 리빌드 시 네트워크 불안정.
