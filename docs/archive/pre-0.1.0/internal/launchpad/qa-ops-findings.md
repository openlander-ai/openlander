# QA Ops Findings (2026-04-03)

---

## Critical 버그 수정 검증 (2026-04-03 최종)

### BUG-001: 한글 프로젝트명 — 부분 수정

| 경로                                 | 결과      | 상세                                                                   |
| ------------------------------------ | --------- | ---------------------------------------------------------------------- |
| MCP `create_deploy_plan`             | ✅ 수정됨 | Zod 스키마 `^[a-z0-9][a-z0-9-]*$` 패턴으로 즉시 거부. 서버 크래시 없음 |
| REST API `POST /api/projects/deploy` | ❌ 미수정 | 한글 이름이 여전히 통과 → building stuck 재현                          |

**MCP 호출 로그:**

```
create_deploy_plan(name: "qa-ops-한글테스트")
→ Zod validation error: "String must match pattern ^[a-z0-9][a-z0-9-]*$"
```

**REST API 테스트:**

```
POST /api/projects/deploy (name: "qa-ops-한글테스트")
→ 프로젝트 생성됨 → building stuck → 복구 불가
```

**결론**: MCP 경로만 검증 추가됨. REST API/웹 UI 경로에는 동일 검증 누락. **파이프라인 레벨(프로젝트 생성 공통 경로)에서 검증해야 함.**

### BUG-003: 블루-그린 — 부분 수정

| 항목                  | 이전             | 이번                                             |
| --------------------- | ---------------- | ------------------------------------------------ |
| 포트 충돌             | 100% 실패        | 포트 할당 개선됨 (10021 할당)                    |
| 실패 시 기존 컨테이너 | 망가짐 (DB 끊김) | ✅ **보존됨** ("previous version still serving") |
| 헬스체크              | 미도달           | 실패 (프로모션 후 타이밍 이슈 추정)              |

**개선 확인**: 블루-그린 실패 시 기존 서비스가 더 이상 손상되지 않음.
**남은 문제**: 프로모션 후 헬스체크 실패 — DB 연결 지연으로 추정.

### BUG-017: get_project_stats — 미수정

```
get_project_stats(project_name: "live-service-app")
→ { error: "Stats unavailable: Cannot read properties of undefined (reading 'length')" }
```

모든 프로젝트에서 동일 (live-service-app, hotdeal-web 등). Docker stats API 응답 파싱 시 null-safety 부재.

### 기타 확인된 수정

| 버그                        | 상태      | 비고                                   |
| --------------------------- | --------- | -------------------------------------- |
| BUG-003 기존 컨테이너 보존  | ✅ 수정됨 | 블루-그린 실패 시 롤백 동작            |
| get_project_stats 에러 필드 | ✅ 개선됨 | 이전: 0만 반환, 이번: 에러 메시지 포함 |
| ENETUNREACH 네트워크        | ✅ 해소됨 | 일반 redeploy 시 DB 네트워크 안정      |

---

## live-service-pulse 운영 결과 (2026-04-03 3차)

**Project:** `live-service-app` (port 10054, v2.2.0)  
**DB Service:** `live-service-db` (PostgreSQL 17, port 10046)  
**Data:** 3 monitors, 1320 checks, 4 incidents (4h uptime)  
**URL:** http://live-service-app.192.168.219.133.sslip.io

---

## 1. `get_project_stats` 버그 — 상세 에러 발견

### 이전

```json
{ "cpu_percent": 0, "memory_usage_mb": 0, "uptime_seconds": 0 }
```

값만 0이고 에러 정보 없었음.

### 이번 발견

```json
{
  "error": "Stats unavailable: Cannot read properties of undefined (reading 'length')",
  "_agent_guidance": {
    "message": "Container stats could not be retrieved."
  }
}
```

### 분석

- **JavaScript 런타임 에러**: `Cannot read properties of undefined (reading 'length')`
- Docker stats API 응답에서 특정 필드가 `undefined`인데 `.length`를 호출
- **모든 프로젝트에서 동일** — live-service-app, live-service-pulse, hotdeal-web 3개 테스트, 전부 같은 에러
- 프로젝트 고유 문제가 아니라 **OpenLander 코드 버그**
- 추정 위치: `src/pipeline/docker.ts` 또는 stats 수집 코드에서 Docker API 응답 파싱 시 array/string 길이 체크

### 영향

- 모니터링 대시보드의 CPU/메모리 수치가 전부 0
- 자동 스케일링이나 리소스 알림을 구현할 수 없음
- 심각도: **Medium** (기능 불능, 서비스 자체에는 영향 없음)

---

## 2. `deploy_blue_green` — 이전과 다른 실패 패턴

### 이전 (세션 1-2)

- 에러: `Bind for 0.0.0.0:10040 failed: port is already allocated`
- 외부 컨테이너와 포트 충돌
- 실패 후 기존 컨테이너 **망가짐** (DB 연결 끊김)

### 이번 (세션 3)

- 에러: `Promoted container failed health check after blue-green promotion`
- 포트 충돌 없음 (port 10021 할당)
- 빌드 성공 (16.6초), 하지만 프로모션 후 헬스체크 실패
- **기존 컨테이너가 살아있음** — `"previous version still serving"`

### 개선 확인

- ✅ BUG-003 (블루-그린 실패 시 기존 컨테이너 손상) — **수정된 것으로 보임**
- 이전: 블루-그린 실패 → 기존 컨테이너 DB 연결 끊김 → 수동 복구 필요
- 이번: 블루-그린 실패 → 기존 컨테이너 계속 서빙 → 정상 동작

### 남은 문제

- 블루-그린 프로모션 후 헬스체크 실패 원인 불명
- `/health`가 200을 반환하는 앱인데 왜 실패하는지
- 추정: 새 컨테이너가 DB 연결 전에 헬스체크가 시작됨 (타이밍 이슈)

---

## 3. 중복 프로젝트 발견 + 정리

같은 repo에서 두 프로젝트 배포됨:

- `live-service-app` (port 10054) — 이전 세션에서 이름 충돌 우회로 생성
- `live-service-pulse` (port 10040) — 이전 세션에서 원래 이름으로도 배포 성공

`live-service-pulse`를 `archive_project`로 정리함.

**UX 교훈:** 같은 repo를 다른 이름으로 배포해도 경고/차단 없음. 의도적 사용(staging/prod)일 수도 있지만, 실수 방지를 위해 경고 옵션이 있으면 좋겠음.

---

## 4. 운영 도구 테스트 결과 (전체)

| 도구                     | 결과   | 비고                                               |
| ------------------------ | ------ | -------------------------------------------------- |
| `list_projects`          | ✅     | 23개 프로젝트, 메타데이터 완전                     |
| `list_services`          | ✅     | 8개 서비스                                         |
| `get_project_stats`      | ❌ BUG | JS 런타임 에러, 모든 프로젝트 동일                 |
| `get_logs`               | ✅     | 정확, 즉시 반환                                    |
| `get_alerts`             | ✅     | 0건 (정상)                                         |
| `get_deploy_history`     | ✅     | 9건, commit_sha/duration 정확                      |
| `deploy_blue_green`      | ❌     | 헬스체크 실패 (타이밍?), 하지만 기존 서비스 보존됨 |
| `redeploy_project`       | ✅     | 21초, 안정적                                       |
| `backup_service`         | ✅     | 7.3MB, 3번째 백업                                  |
| `exec_service_container` | ✅     | SQL 쿼리 정상 (1320 checks, 4 incidents)           |
| `get_system_stats`       | ✅     | CPU 25%, RAM 72%, Disk 87%                         |
| `archive_project`        | ✅     | 중복 프로젝트 정리                                 |

---

## 5. 종합 평가 (세션 3)

### 개선된 것 (vs 이전 세션)

1. **BUG-003 수정됨** — 블루-그린 실패 시 기존 컨테이너가 더 이상 망가지지 않음
2. **`get_project_stats`에 에러 필드 추가** — 이전엔 0만 반환했는데 이제 구체적 에러 메시지 있음
3. **ENETUNREACH 미발생** — 이번 세션에서 일반 redeploy 시 DB 네트워크 문제 없었음

### 여전한 문제

1. **`get_project_stats` JS 에러** — 근본 원인 미수정 (`Cannot read properties of undefined`)
2. **블루-그린 헬스체크 실패** — DB 연결 지연으로 추정, 재시도 로직 필요
3. **배포 트리거 구분 없음** — 히스토리에서 전부 `trigger: "api"`, env 변경/blue-green/일반 구분 불가

### 아이디어

1. `get_project_stats` 수정 시 Docker stats API 응답의 null-safety 추가
2. 블루-그린에 헬스체크 재시도 횟수/대기 시간 옵션 추가
3. 배포 히스토리에 `trigger` 상세 구분: `api:deploy`, `api:redeploy`, `api:env_change`, `api:blue_green`
4. 같은 repo 중복 배포 시 경고 메시지

---

## qa1: 미수정 버그 검증 (2026-04-03)

**테스터**: OpenClaw Agent (claude-opus-4-6)  
**목적**: 이전 QA에서 발견된 Critical 버그 5개의 수정 여부 재검증  
**테스트 프로젝트**: `qa-ops-lock`, `qa-ops-rollback2`, `qa-ops-dfpath`

---

### T1: deploy lock (BUG-002) ❌ 미수정

**호출 1**: `create_deploy_plan(repo_url: "github.com/lehdqlsl/status-page", name: "qa-ops-lock")`  
**응답**: `{plan_id: "plan__keqGdbNFxeV", status: "ready"}`

**호출 2**: `execute_deploy_plan(plan_id: "plan__keqGdbNFxeV")`  
**응답**: `{status: "building", project_id: "vtgHb2J8B-N0"}`

**호출 3** (빌드 중 즉시): `redeploy_project(project_name: "qa-ops-lock", no_cache: true)`  
**응답**: `{status: "redeploying", message: "Redeployment started (no_cache)..."}`

**결과**: ❌ 빌드 중에 redeploy가 **거부 없이 수락됨**. deploy lock이 여전히 없다.

- `deploy_lock_session`, `deploy_lock_at` DB 필드 존재하지만 미활용
- 두 빌드가 동시 실행될 수 있음 (Docker 409 Conflict 위험)

---

### T2: 롤백 (BUG-004) ❌ 미수정

**호출 1**: `deploy(source: "image", image: "nginx:1.25-alpine", name: "qa-ops-rollback2", port: 80)`  
**응답**: `{status: "done", project_id: "gsKdexprv35V", elapsed: "5s"}`

**호출 2**: `redeploy_project(project_name: "qa-ops-rollback2", no_cache: true)`  
**응답**: `{status: "redeploying"}`  
**완료**: `{phase: "done", elapsed: "8s"}`

**DB 확인** (`projects` 테이블):

```
image_tag: nginx:1.25-alpine
previous_image_tag: (null)
```

**호출 3**: `rollback_project(project_name: "qa-ops-rollback2")`  
**응답**:

```json
{
  "success": false,
  "error": "No previous image available for rollback",
  "_agent_guidance": {
    "next_steps": [
      "Rollback failed. Check the error field above for details.",
      "Call get_deploy_history to review recent deployment state.",
      "Call get_logs if a container was started to check runtime errors."
    ]
  }
}
```

**결과**: ❌ `previous_image_tag`가 redeploy 시 저장되지 않음. 롤백 불가.

---

### T3: dockerfile_path (BUG-005) ✅ 수정됨

**호출 1**: `deploy(repo_url: "github.com/lehdqlsl/mono-test", name: "qa-ops-dfpath", dockerfile_path: "api/Dockerfile", prefer_dockerfile: true)`  
**응답**: `{status: "done", elapsed: "2s"}`

**빌드 로그 (1차)**:

```
[clone] github.com/lehdqlsl/mono-test @ db32bff4
[dockerfile] Using api/Dockerfile
[dockerfile]   EXPOSE 4000
[dockerfile]   CMD ["node", "server.mjs"]
```

**호출 2**: `update_project_config(project_name: "qa-ops-dfpath", dockerfile_path: "worker/Dockerfile", build_context: "worker")`  
**응답**: `{status: "updated", config: {dockerfile_path: "worker/Dockerfile", build_context: "worker"}}`

**호출 3**: `redeploy_project(project_name: "qa-ops-dfpath", no_cache: true)`  
**완료**: `{phase: "done", elapsed: "15s"}`

**빌드 로그 (2차, deploy_index: 0)**:

```
[clone] github.com/lehdqlsl/mono-test @ db32bff4
[dockerfile] Using worker/Dockerfile
[dockerfile]   EXPOSE 4001
[dockerfile]   CMD ["node", "worker.mjs"]
```

**결과**: ✅ `update_project_config` 후 redeploy에서 worker/Dockerfile이 정확히 사용됨.  
**주의**: `get_build_log`의 기본 `deploy_index`가 최신이 아닌 이전 로그를 반환할 수 있음 — `deploy_index: 0`을 명시적으로 전달해야 최신 로그 확인 가능.

---

### T4: 포트 범위 (BUG-007) ✅ 수정됨 (MCP)

**호출 1**: `create_deploy_plan(source: "image", image: "nginx:alpine", name: "qa-ops-port-neg", port: -1)`  
**응답**:

```
Validation failed: port: must be > 0
```

**호출 2**: `create_deploy_plan(source: "image", image: "nginx:alpine", name: "qa-ops-port-big", port: 99999)`  
**응답**:

```
Validation failed: port: must be <= 65535
```

**호출 3**: `create_deploy_plan(source: "image", image: "nginx:alpine", name: "qa-ops-port-ok", port: 8080)`  
**응답**: `{plan_id: "plan_mWfjtofXBxm9", status: "ready"}`

**결과**: ✅ MCP Zod 스키마에서 `exclusiveMinimum: 0`, `maximum: 65535` 검증. 음수와 초과값 모두 차단.  
**잔여 이슈**: REST API에서는 여전히 포트 검증 없음 (이전 세션에서 확인됨).

---

### T5: 볼륨 중복 (BUG-008) ✅ 수정됨

**호출 1**: `add_volume(project_name: "qa-ops-lock", volume_name: "vol-a", mount_path: "/data")`  
**응답**: `{status: "created", volume: "ol-vol-qa-ops-lock-vol-a"}`

**호출 2**: `add_volume(project_name: "qa-ops-lock", volume_name: "vol-b", mount_path: "/data")`  
**응답**:

```
Mount path "/data" is already in use by volume "vol-a" in project "qa-ops-lock".
Each volume must have a unique mount path.
```

**결과**: ✅ 같은 mount_path에 두 번째 볼륨 등록 시 명확한 에러로 거부.

---

### 검증 결과 요약

| BUG     | 항목            | 결과            | 비고                                       |
| ------- | --------------- | --------------- | ------------------------------------------ |
| BUG-001 | 한글 프로젝트명 | ✅/⚠️           | MCP 수정, REST API 미수정 (이전 세션 확인) |
| BUG-002 | deploy lock     | ❌ 미수정       | 빌드 중 redeploy 거부 없이 수락            |
| BUG-004 | 롤백            | ❌ 미수정       | previous_image_tag 저장 안 됨              |
| BUG-005 | dockerfile_path | ✅ 수정됨       | worker/Dockerfile 정확히 사용 확인         |
| BUG-007 | 포트 범위       | ✅ 수정됨 (MCP) | 음수/상한 모두 Zod 검증. REST는 미수정     |
| BUG-008 | 볼륨 중복       | ✅ 수정됨       | 명확한 에러 메시지로 거부                  |

**수정됨: 3/6 | 부분 수정: 1/6 (MCP만) | 미수정: 2/6**

### 잔여 Critical

1. **deploy lock (BUG-002)**: `deploy_lock_session`/`deploy_lock_at` DB 필드 존재하지만 미활용
2. **롤백 (BUG-004)**: `previous_image_tag` 필드 존재하지만 redeploy 시 저장 안 됨

### 재발견: get_build_log 기본 동작

- `get_build_log(project_name)` 데폴트가 최신 로그가 아닐 수 있음
- `deploy_index: 0`을 명시적으로 전달해야 최신 로그 확인 가능
- BUG-005를 이전 세션에서 오진한 원인

### 리소스 정리

- ✅ `qa-ops-lock` — archived, vol-a removed
- ✅ `qa-ops-rollback2` — archived
- ✅ `qa-ops-dfpath` — archived
- ✅ `qa-ops-mono` — archived
- ✅ `qa-ops-redis` 서비스 — removed
- ✅ Docker qa-ops 컨테이너 — 전부 정리

---

## qa2: Major 버그 + Ops Center 검증 (2026-04-03)

### 테스트 환경

- **서버:** OpenLander dev build, 포트 10114
- **프로젝트:** `qa-ops-svcwarn` (nginx:alpine)
- **서비스:** `qa-ops-redis` (Redis 8), `qa-ops-pg` (PostgreSQL 17)

---

### Part 1: Major 버그 검증

#### T1: Redis 백업 BGSAVE (BUG-006)

| 단계 | 도구                         | 파라미터                                   | 결과                                                  |
| ---- | ---------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| 1    | `create_service`             | name="qa-ops-redis", template="redis"      | ✅ id=vbcLK1t-0Q4Y, port=10055, running               |
| 2    | `exec_service_container`     | ["redis-cli", "SET", "testkey", "testval"] | ✅ exit=0, stdout="OK"                                |
| 2b   | `exec_service_container`     | ls /data/dump.rdb                          | ✅ "No such file" — dump.rdb 없음 확인                |
| 3    | `backup_service`             | service="qa-ops-redis"                     | ✅ backupId=qa-ops-redis-1775223459071, **242 bytes** |
| 3b   | tar tzf (shell)              | 백업 내용 확인                             | ✅ `./dump.rdb` 포함됨                                |
| 4    | `exec_service_container`     | ["redis-cli", "FLUSHALL"]                  | ✅ exit=0, DBSIZE=0                                   |
| 5    | `restore_service`            | backupId=qa-ops-redis-1775223459071        | ✅ status="restored"                                  |
| 6    | shell: redis-cli GET testkey |                                            | ✅ **"testval"** 반환                                 |

**✅ BUG-006 수정 확인.** `backup_service`가 Redis에 BGSAVE를 자동 호출. dump.rdb 없는 상태에서도 백업에 포함되고, 복원 시 데이터 정상 복구.

- 이전 라운드 5에서는 94 bytes (빈 백업) → 지금 242 bytes (dump.rdb 포함)

---

#### T2: 서비스 삭제 경고 (BUG-009)

| 단계 | 도구                      | 파라미터                                | 결과                            |
| ---- | ------------------------- | --------------------------------------- | ------------------------------- |
| 1    | `create_service`          | name="qa-ops-pg", template="postgresql" | ✅ id=bkFXObIbMFKU, port=10058  |
| 2    | `deploy` + `set_env_vars` | DATABASE_URL=ol-svc-qa-ops-pg 참조      | ✅ qa-ops-svcwarn 프로젝트 연결 |
| 3    | `remove_service`          | service="qa-ops-pg"                     | ❌ **연결 프로젝트 경고 없음**  |

**❌ BUG-009 미수정.** 응답:

```json
{ "status": "removed", "warning": "All persistent data for postgresql service..." }
```

`DATABASE_URL`에서 `ol-svc-qa-ops-pg`를 참조하는 `qa-ops-svcwarn` 프로젝트가 있음에도 연결 프로젝트 경고 없이 삭제됨.

---

#### T3: 웹훅 secret 유지 (BUG-015)

| 단계 | 도구              | 파라미터                                  | 결과                                                               |
| ---- | ----------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| 1    | `enable_webhook`  | project="qa-ops-svcwarn", source="github" | ✅ id=fbLRX-LyqAfT, secret=r_kK0v4R...25813ea..., **reused=false** |
| 2    | `disable_webhook` | source="github"                           | ✅ status="disabled"                                               |
| 3    | `enable_webhook`  | source="github" (동일)                    | ✅ id=**fbLRX-LyqAfT** (동일), secret=**동일**, **reused=true**    |

**✅ BUG-015 수정 확인.** disable→enable 시 ID와 secret이 유지됨. `reused: true` 플래그와 "no need to reconfigure" guidance 추가됨.

---

#### T4: 크래시 알림 + alerts MCP↔REST (BUG-013, BUG-014)

| 단계 | 도구                          | 결과                                                    |
| ---- | ----------------------------- | ------------------------------------------------------- |
| 1    | `get_alerts` (MCP)            | **count: 0, alerts: []**                                |
| 2    | REST `GET /api/alerts`        | **1건: disk warning (86.6%)**                           |
| 3    | docker kill ol-qa-ops-svcwarn | 컨테이너 강제 종료                                      |
| 4    | 70초 대기 후 알림 확인        | REST: disk 1건 동일, MCP: 0건 동일                      |
| 5    | REST `/api/ops/incidents`     | qa-ops-svcwarn에 **2건 신규 인시던트** 생성 (escalated) |
| 6    | 프로젝트 status               | **error**로 전환                                        |

**버그 상태:**

- ❌ **BUG-014 미수정:** MCP `get_alerts`는 0건, REST API는 1건(disk). MCP가 alerts를 다른 경로로 조회하거나 필터링하는 것으로 추정.
- ⚠️ **BUG-013 부분 동작:** 크래시 감지는 ops/incidents에 기록되지만, alerts API에는 container-crash 타입이 추가되지 않음. 인시던트와 알림이 별도 시스템.

---

### Part 2: Operations Center API 검증

#### T5: 글로벌 인시던트 조회

| 항목          | 값                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| 엔드포인트    | `GET /api/ops/incidents`                                                                                      |
| 응답 키       | `{incidents: [...]}`                                                                                          |
| 인시던트 수   | 52 (50 escalated, 1 open, 1 new from T4)                                                                      |
| 영향 프로젝트 | 8개                                                                                                           |
| 인시던트 필드 | id, project_id, severity, status, root_cause, diagnosis, actions_taken, created_at, resolved_at, escalated_at |
| **판정**      | **✅ PASS** — 구조 정상, 데이터 포함                                                                          |

#### T6: 서킷 브레이커 상태

| 항목        | 값                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------- |
| 엔드포인트  | `GET /api/ops/circuit-breakers` (복수형 주의, 단수 404)                                             |
| 응답 키     | `{breakers: [...]}`                                                                                 |
| 브레이커 수 | 9개                                                                                                 |
| open        | LbFGtGjmArt-(failures=5), Xr11hWQAdZrz(failures=5)                                                  |
| closed      | 7개 (failures 0~4)                                                                                  |
| DB 일치     | `circuit_breaker_state` 테이블과 완벽 일치                                                          |
| **판정**    | **✅ PASS** — `/api/ops/circuit-breaker` (404) vs `/api/ops/circuit-breakers` (성공). URL 주의 필요 |

#### T7: Activity 피드

| 항목        | 값                                                                                     |
| ----------- | -------------------------------------------------------------------------------------- |
| 엔드포인트  | `GET /api/activity?limit=10`                                                           |
| 응답 키     | `{activities: [...]}`                                                                  |
| 이벤트 수   | 5                                                                                      |
| 이벤트 필드 | type, project, user, status, time                                                      |
| 이벤트 타입 | container:remove, recovery:exhausted, alert:new, deploy:failed                         |
| **판정**    | **✅ PASS** — 다양한 이벤트 타입 표시. project 필드가 비어있는 것은 시스템 레벨 이벤트 |

#### T8: 승인 대기

| 항목       | 값                                       |
| ---------- | ---------------------------------------- |
| 엔드포인트 | `GET /api/action-runs`                   |
| 응답       | `{actionRuns: []}`                       |
| **판정**   | **✅ PASS** — 대기 중인 승인 없음 (정상) |

#### 추가 발견: Ops Center API 전체 라우트 맵

| 경로                                             | 설명               | 상태                              |
| ------------------------------------------------ | ------------------ | --------------------------------- |
| `GET /api/ops/incidents`                         | 인시던트 목록      | ✅ 동작                           |
| `GET /api/ops/incidents/:id`                     | 인시던트 상세      | ✅ 존재                           |
| `GET /api/ops/incidents/:id/events`              | 인시던트 이벤트    | ✅ 존재                           |
| `GET /api/ops/circuit-breakers`                  | 서킷 브레이커 전체 | ✅ 동작                           |
| `GET /api/ops/circuit-breaker/:projectId`        | 프로젝트별 CB      | ✅ 존재                           |
| `POST /api/ops/circuit-breaker/:projectId/reset` | CB 리셋            | ✅ 존재                           |
| `GET /api/ops/config`                            | Ops 설정           | ✅ 동작                           |
| `GET /api/ops/health`                            | Ops 상태           | ✅ 동작 (status:ok, running:true) |
| `GET /api/ops/digest/latest`                     | 최신 다이제스트    | ✅ 존재                           |
| `POST /api/ops/digest/trigger`                   | 다이제스트 트리거  | ✅ 존재                           |
| `GET /api/ops/activity`                          | Ops 활동 피드      | ✅ 존재                           |
| `GET /api/ops/dependencies`                      | 의존성 그래프      | ✅ 동작 (nodes/edges)             |
| `GET /api/activity`                              | 글로벌 활동        | ✅ 동작                           |
| `GET /api/action-runs`                           | 승인 대기          | ✅ 동작                           |

---

### 결과 요약

| 테스트 | 버그                     | 결과          | 상세                                       |
| ------ | ------------------------ | ------------- | ------------------------------------------ |
| T1     | BUG-006 Redis BGSAVE     | ✅ **수정됨** | BGSAVE 자동 호출, dump.rdb 포함, 복원 성공 |
| T2     | BUG-009 서비스 삭제 경고 | ❌ **미수정** | 연결 프로젝트 경고 없이 삭제됨             |
| T3     | BUG-015 웹훅 secret 유지 | ✅ **수정됨** | ID+secret 유지, reused=true 플래그         |
| T4a    | BUG-013 크래시 알림      | ⚠️ **부분**   | 인시던트 생성되지만 alerts에는 없음        |
| T4b    | BUG-014 alerts MCP↔REST  | ❌ **미수정** | MCP=0건, REST=1건(disk)                    |
| T5     | Ops incidents            | ✅            | 52건, 구조 정상                            |
| T6     | Circuit breakers         | ✅            | 9개, open/closed 상태, DB 일치             |
| T7     | Activity 피드            | ✅            | 5 이벤트, 다양한 타입                      |
| T8     | 승인 대기                | ✅            | 빈 배열 (정상)                             |

### 정리

- ✅ `qa-ops-svcwarn` — purge 완료
- ✅ `qa-ops-pg` 서비스 — removed
- ✅ `qa-ops-redis` 서비스 — removed

### 남은 미수정 버그

1. **BUG-009** — 서비스 삭제 시 연결 프로젝트 경고 없음
2. **BUG-014** — MCP `get_alerts` ↔ REST `/api/alerts` 불일치
3. **BUG-013** — 크래시가 ops/incidents에는 기록되지만 alerts API에는 표시 안 됨

---

## live: OpsAgent 운영 시나리오 (2026-04-03)

**목적:** OpenLander의 OpsAgent 자동 복구 능력, 크래시 감지/알림 생성, 인시던트 타임라인을 실제 크래시 시나리오로 테스트.  
**프로젝트:** `live-service-app` (v2.2.0)  
**대상 컨테이너:** `ol-live-service-app`

### S1: 자동 재시작 / 알림 관찰

#### 테스트 1: 즉시 종료 (exit 1)

**호출:**

```
redeploy_project(project_name: "live-service-app", cmd: ["node", "-e", "process.exit(1)"])
```

**응답:**

```json
{ "status": "redeploying", "message": "Redeployment started." }
```

**배포 결과 (get_deploy_status):**

```json
{
  "phase": "failed",
  "error": "(HTTP code 404) network or container is not found - network sandbox for container de8957... not found",
  "auto_diagnosis": {
    "category": "source-error",
    "tier": 3,
    "auto_fixable": false
  }
}
```

**관찰:**

- 컨테이너가 너무 빨리 종료되어 Docker 네트워크 샌드박스가 사라짐
- `auto_diagnosis` 카테고리가 `source-error`로 분류 — 실제로는 런타임 크래시인데 오분류
- **30초 후**: `get_alerts` → **0건**. 알림 생성 안 됨.
- **90초 후**: `get_alerts` → **0건**. OpsAgent 반응 없음.
- **자동 복구**: 없음. 프로젝트가 `failed` 상태로 방치.
- `get_logs` → `"No container running for this project."`

#### 테스트 2: 지연 종료 (sleep 2 + exit 1)

**호출:**

```
redeploy_project(project_name: "live-service-app", cmd: ["sh", "-c", "echo 'crashing...' && sleep 2 && exit 1"])
```

**배포 결과:**

```json
{
  "phase": "failed",
  "error": "Container crashed after start: Container is in restart loop (exit code: 1)\n\nContainer logs:\ncrashing...\ncrashing...",
  "auto_diagnosis": {
    "category": "runtime-crash",
    "tier": 2,
    "auto_fixable": false,
    "suggested_action": "Check container logs for the root cause."
  }
}
```

**관찰:**

- OpenLander가 restart loop을 정확히 감지: `"Container is in restart loop (exit code: 1)"`
- `auto_diagnosis: "runtime-crash"` — 올바른 분류 (테스트 1과 다름)
- 컨테이너 로그 `crashing...`이 2번 출력 → 2회 재시작 후 포기
- **60초 후**: `get_alerts` → **0건**. 여전히 알림 없음.
- **자동 복구**: 없음.

### S1 결론

| 항목          | 결과                                         |
| ------------- | -------------------------------------------- |
| 크래시 감지   | ✅ restart loop 감지, 에러 메시지 정확       |
| 알림 생성     | ❌ **없음** — `get_alerts` 항상 0건          |
| 자동 복구     | ❌ **없음** — 수동 `redeploy_project`만 가능 |
| 인시던트 생성 | ❌ **없음** — 크래시 이벤트 기록 없음        |
| 서킷 브레이커 | 확인 불가 — MCP 도구 없음                    |

**핵심 발견:** OpenLander의 OpsAgent 자동 복구는 **MCP 도구 레벨에서 관찰되지 않음**. `get_alerts`가 크래시를 알림으로 반영하지 않고, 자동 redeploy/rollback 시도도 없음. `auto_fixable: false`로 판단되면 에이전트가 개입하지 않는 것으로 보임.

추정: OpsAgent가 작동하려면 Operations Center 웹 UI나 특정 설정이 필요할 수 있음. 또는 OpsAgent는 헬스체크 모니터(주기적 폴링) 기반이고, 배포 실패는 범위 밖일 수 있음.

---

### S2: 인시던트 타임라인

- MCP에 `/ops/incidents` 또는 인시던트 조회 도구가 **없음**
- `get_deploy_history`로 간접 확인: 12건 이력 중 5건 failed
- 크래시 이벤트를 독립적인 인시던트로 기록하는 기능은 없는 것으로 확인

---

### S3: 서킷 브레이커

- MCP에 서킷 브레이커 상태 조회 도구가 **없음**
- AGENTS.md에 언급된 `monitor/` 디렉토리에 헬스 모니터링 코드가 있을 수 있으나, MCP로 노출되지 않음

---

### S4: 시스템 전체 상태

```
Host: idongbin-ui-Macmini.local (Apple M4, 10 cores)
Uptime: 103d 7h 8m
CPU: 38% (Load: 3.8/3.6/3.3)
Memory: 12.5GB / 17.2GB (73%)
Disk: 212.3GB / 245.1GB (87%)
```

- error 상태 프로젝트: 4개 (test-bookmarks-api, test-java, test-build-fail, test-compose-fail)
- 이것들은 이전 QA 테스트 잔재로, 알림 없음

---

### 복구 과정에서 발견된 BUG-004 재현 (4회째)

크래시 테스트 후 정상 복구를 시도했을 때:

```
redeploy_project(project_name: "live-service-app")  // CMD 오버라이드 없이
```

**결과:**

```
Container crashed after start: Error: connect ENETUNREACH 172.22.0.27:5432
```

**복구 절차:**

1. `stop_service("live-service-db")` → ✅
2. `start_service("live-service-db")` → ✅
3. `redeploy_project("live-service-app")` → ✅ 21초
4. `get_logs` → `Pulse v2.2.0 running on port 3000` 확인

**패턴 확정:** BUG-004 (ENETUNREACH)는 단순 `no_cache`만이 아니라 **컨테이너가 빠르게 종료/재생성되는 모든 경우**에 발생 가능.  
Docker 네트워크에서 서비스 컨테이너 IP가 stale되는 근본적 문제.

---

### 종합 평가: OpsAgent 자동화 수준

| 능력                     | 상태       | 비고                                                    |
| ------------------------ | ---------- | ------------------------------------------------------- |
| 크래시 감지              | ✅         | restart loop 정확히 감지, 로그 포함                     |
| 에러 분류                | ⚠️ 부분    | runtime-crash는 정확, 즉시 종료는 source-error로 오분류 |
| 알림 생성                | ❌         | 크래시 후 `get_alerts` 항상 0건                         |
| 자동 복구 (auto_fixable) | ❌         | `auto_fixable: false` → 에이전트 개입 없음              |
| 인시던트 기록            | ❌         | MCP 도구 없음, 배포 히스토리로만 간접 추적              |
| 서킷 브레이커            | 확인 불가  | MCP 도구 없음                                           |
| 배포 실패 후 네트워크    | ❌ BUG-004 | 4회째 재현 — 크래시 후 복구에도 영향                    |

**결론:** OpenLander의 크래시 **감지**는 잘 동작하지만, 감지 후 **대응** (알림, 자동 복구, 인시던트 기록)이 MCP 레벨에서는 관찰되지 않음. OpsAgent가 내부적으로 작동할 수 있지만, 그 결과가 MCP 도구로 노출되지 않는다.  
MCP 도구만으로 운영하는 AI 에이전트 입장에서는, 크래시 시 수동으로 `redeploy_project` 또는 `rollback_project`를 호출해야 함.
