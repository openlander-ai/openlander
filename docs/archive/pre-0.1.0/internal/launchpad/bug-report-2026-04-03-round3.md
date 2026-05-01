# OpenLander 버그 리포트 Round 3 — 2026-04-03

> Round 1-2 리포트 기반 버그 수정 후, 오픈클로 에이전트 3대(qa1/qa2/live)로 병렬 검증 QA 수행.
> Round 1: `bug-report-2026-04-03.md` (Critical 6 + Major 9)
> Round 2: `bug-report-2026-04-03-round2.md` (Critical 1 + Major 2 + UX 6)
> 검증 raw 데이터: `qa-ops-findings.md` (653줄)

---

## 검증 환경

| 항목            | 값                                                                    |
| --------------- | --------------------------------------------------------------------- |
| 테스터          | OpenClaw Agent × 3 (claude-opus-4-6)                                  |
| qa1             | 미수정 버그 검증 (BUG-002, 004, 005, 007, 008)                        |
| qa2             | Major 버그 + Operations Center API 검증 (BUG-006, 009, 013, 014, 015) |
| live            | OpsAgent 운영 시나리오 (크래시 감지, 알림, 자동 복구)                 |
| 서버            | OpenLander dev build, Apple M4, 103일 가동                            |
| 프로젝트 접두사 | `qa-ops-*` (테스트 후 전부 정리 완료)                                 |

---

## 수정 확인 — 5건 ✅

### BUG-005: dockerfile_path 반영 안 됨 → ✅ 수정됨

**검증 (qa1):**

1. `deploy(repo_url: "mono-test", dockerfile_path: "api/Dockerfile")` → 빌드 로그 `Using api/Dockerfile` 확인
2. `update_project_config(dockerfile_path: "worker/Dockerfile", build_context: "worker")`
3. `redeploy_project(no_cache: true)` → 빌드 로그 `Using worker/Dockerfile` 확인

**비고:** `get_build_log` 기본값이 최신 로그가 아닐 수 있음 — `deploy_index: 0` 명시 필요. 이전 세션에서 BUG-005를 오진한 원인.

---

### BUG-006: Redis 백업 BGSAVE 미호출 → ✅ 수정됨

**검증 (qa2):**

1. `create_service(template: "redis")` → Redis 8 생성
2. `redis-cli SET testkey testval` → dump.rdb 없는 상태 확인
3. `backup_service` → **242 bytes** (이전: 94 bytes 빈 백업)
4. `redis-cli FLUSHALL` → DBSIZE=0
5. `restore_service` → `redis-cli GET testkey` → **"testval" 복원 성공**

BGSAVE 자동 호출 + dump.rdb 포함 확인.

---

### BUG-007: 포트 범위 검증 부재 → ✅ 수정됨 (MCP)

**검증 (qa1):**

- `create_deploy_plan(port: -1)` → `Validation failed: port: must be > 0` ✅
- `create_deploy_plan(port: 99999)` → `Validation failed: port: must be <= 65535` ✅
- `create_deploy_plan(port: 8080)` → 정상 생성 ✅

**잔여:** REST API에서는 여전히 포트 검증 없음.

---

### BUG-008: 볼륨 mount_path 중복 허용 → ✅ 수정됨

**검증 (qa1):**

- `add_volume(volume_name: "vol-a", mount_path: "/data")` → 생성 ✅
- `add_volume(volume_name: "vol-b", mount_path: "/data")` → `Mount path "/data" is already in use by volume "vol-a"` ✅

명확한 에러 메시지로 거부.

---

### BUG-015: 웹훅 re-enable 시 새 secret 발급 → ✅ 수정됨

**검증 (qa2):**

1. `enable_webhook(source: "github")` → id=fbLRX, secret=r_kK0v4R...
2. `disable_webhook` → disabled
3. `enable_webhook(source: "github")` → id=**fbLRX** (동일), secret=**동일**, `reused: true`

ID + secret 유지 + `reused` 플래그 추가됨.

---

## 부분 수정 — 2건 ⚠️

### BUG-001: 프로젝트명 유효성 검증 → ⚠️ MCP만 수정

| 경로                                 | 결과                                             |
| ------------------------------------ | ------------------------------------------------ |
| MCP `create_deploy_plan`             | ✅ Zod 스키마 `^[a-z0-9][a-z0-9-]*$`로 즉시 거부 |
| REST API `POST /api/projects/deploy` | ❌ 한글 이름 통과 → building stuck 재현          |

**결론:** 프로젝트 생성 공통 경로(파이프라인 레벨)에서 검증 필요.

---

### BUG-003 + BUG-016: 블루-그린 → ⚠️ 기존 컨테이너 보존은 수정, 헬스체크 이슈 남음

| 항목                  | 이전             | 이번                                             |
| --------------------- | ---------------- | ------------------------------------------------ |
| 포트 충돌             | 100% 실패        | ✅ 포트 할당 개선 (10021 할당)                   |
| 실패 시 기존 컨테이너 | 망가짐 (DB 끊김) | ✅ **보존됨** ("previous version still serving") |
| 헬스체크              | -                | ❌ 프로모션 후 헬스체크 실패                     |

BUG-016(실패 시 기존 컨테이너 손상) 해결 확인. 프로모션 후 헬스체크 실패는 DB 연결 지연(타이밍)으로 추정 — 재시도 로직 필요.

---

## 미수정 — 5건 ❌

### BUG-002: deploy lock 부재 → ❌ 미수정

**검증 (qa1):**

1. `execute_deploy_plan` → building 상태
2. 즉시 `redeploy_project(no_cache: true)` → **거부 없이 수락**

`deploy_lock_session`, `deploy_lock_at` DB 필드가 존재하지만 여전히 미활용.

---

### BUG-004: 롤백 미작동 → ❌ 미수정

**검증 (qa1):**

1. `deploy(image: "nginx:1.25-alpine")` → 성공
2. `redeploy_project(no_cache: true)` → 성공
3. DB 확인: `previous_image_tag: (null)`
4. `rollback_project` → `"No previous image available for rollback"`

redeploy 시 `previous_image_tag`가 저장되지 않음.

**추가 발견 (live):** 크래시 테스트 후 복구 시 `ENETUNREACH 172.22.0.27:5432` 재현 (4회째). 컨테이너 빠른 종료/재생성 시 Docker 네트워크에서 서비스 컨테이너 IP가 stale되는 근본적 문제.

---

### BUG-009: 서비스 삭제 시 연결 프로젝트 미경고 → ❌ 미수정

**검증 (qa2):**

1. `create_service(template: "postgresql")` → qa-ops-pg 생성
2. `set_env_vars(DATABASE_URL=ol-svc-qa-ops-pg 참조)` → 프로젝트 연결
3. `remove_service("qa-ops-pg")` → 경고 없이 삭제됨

응답에 `warning: "All persistent data..."`만 있고, 연결 프로젝트 정보 없음.

---

### BUG-013 (재분류): 크래시 알림 미생성 → ⚠️ 부분 동작

**검증 (qa2):**

- `docker kill` 후 70초 대기 → REST `/api/ops/incidents`에 2건 신규 인시던트 생성 (escalated)
- 하지만 `get_alerts` (MCP/REST 모두) → 크래시 타입 알림 없음

인시던트와 알림이 별도 시스템으로 동작. 크래시 → 인시던트 O, 알림 X.

---

### BUG-014 (재분류): alerts MCP↔REST 불일치 → ❌ 미수정

**검증 (qa2):**

- MCP `get_alerts` → `count: 0, alerts: []`
- REST `GET /api/alerts` → `1건 (disk warning 86.6%)`

MCP가 alerts를 다른 경로로 조회하거나 필터링하는 것으로 추정.

---

## 신규 발견 — 2건

### BUG-017 상세: get_project_stats JS 런타임 에러

**심각도**: 🟡 Major
**재현율**: 100% (모든 프로젝트)

```json
{
  "error": "Stats unavailable: Cannot read properties of undefined (reading 'length')"
}
```

- 이전: 모든 메트릭 0 반환 (에러 정보 없음)
- 이번: 에러 메시지 포함으로 **개선됨**, 하지만 근본 원인 미수정
- Docker stats API 응답 파싱 시 null-safety 부재
- 추정 위치: `src/pipeline/docker.ts` 또는 stats 수집 코드

---

### NEW: get_build_log 기본 인덱스 혼란

**심각도**: 🟢 Minor

- `get_build_log(project_name)` 기본값이 최신 빌드가 아닌 이전 빌드 로그를 반환할 수 있음
- `deploy_index: 0`을 명시해야 최신 로그 확인 가능
- Round 1에서 BUG-005를 오진한 원인

---

## OpsAgent 운영 시나리오 결과 (live)

### 크래시 테스트

| 테스트    | 방법                                     | 감지                                | 알림 | 자동 복구 |
| --------- | ---------------------------------------- | ----------------------------------- | ---- | --------- |
| 즉시 종료 | `cmd: ["node", "-e", "process.exit(1)"]` | ⚠️ 감지하나 `source-error`로 오분류 | ❌   | ❌        |
| 지연 종료 | `cmd: ["sh", "-c", "sleep 2 && exit 1"]` | ✅ `runtime-crash` 정확 분류        | ❌   | ❌        |

### OpsAgent 자동화 수준

| 능력          | 상태        | 비고                                         |
| ------------- | ----------- | -------------------------------------------- |
| 크래시 감지   | ✅          | restart loop 감지, 로그 포함, 에러 코드 표시 |
| 에러 분류     | ⚠️          | 지연 종료는 정확, 즉시 종료는 오분류         |
| 알림 생성     | ❌          | 크래시 후 `get_alerts` 항상 0건              |
| 자동 복구     | ❌          | `auto_fixable: false` → 에이전트 개입 없음   |
| 인시던트 기록 | ❌ MCP 없음 | REST `/api/ops/incidents`에는 기록됨         |
| 서킷 브레이커 | ❌ MCP 없음 | REST `/api/ops/circuit-breakers`에는 있음    |

**핵심 결론:** 크래시 **감지**는 잘 동작하지만, 감지 후 **대응**(알림, 자동 복구, 인시던트)이 MCP 도구로 노출되지 않음. MCP만으로 운영하는 AI 에이전트는 크래시 시 수동 `redeploy_project`/`rollback_project` 호출이 필요.

---

## Operations Center API 검증 (qa2)

| API                             | 상태 | 비고                           |
| ------------------------------- | ---- | ------------------------------ |
| `GET /api/ops/incidents`        | ✅   | 52건, 구조 정상, 필드 완전     |
| `GET /api/ops/circuit-breakers` | ✅   | 9개, open/closed 상태, DB 일치 |
| `GET /api/activity`             | ✅   | 5 이벤트, 다양한 타입          |
| `GET /api/action-runs`          | ✅   | 승인 대기 정상 동작            |
| `GET /api/ops/config`           | ✅   | 설정 조회 정상                 |
| `GET /api/ops/health`           | ✅   | status:ok, running:true        |
| `GET /api/ops/dependencies`     | ✅   | nodes/edges 그래프 정상        |

**주의:** `/api/ops/circuit-breaker` (단수) → 404. 복수형 `/api/ops/circuit-breakers`만 동작.

---

## 전체 누적 (Round 1 + 2 + 3)

| 구분     | Round 1 | Round 2 | 합계 | Round 3 수정 확인                 | 잔여  |
| -------- | ------- | ------- | ---- | --------------------------------- | ----- |
| Critical | 6       | 1       | 7    | 3 수정 + 2 부분                   | **2** |
| Major    | 9       | 2       | 11   | 2 수정                            | **7** |
| UX 이슈  | 5       | 6       | 11   | 2 수정 (UX-007, BUG-017 에러표시) | **9** |
| 아이디어 | 0       | 6       | 6    | -                                 | 6     |

### 잔여 Critical (1.0 출시 전 필수)

1. **BUG-002** — deploy lock 부재 → 동시 배포 시 Docker 409 Conflict
2. **BUG-004** — 롤백 미작동 + ENETUNREACH 네트워크 stale 문제

### 수정 우선순위 (잔여)

**즉시 — Low:**

1. BUG-001 REST API 경로 검증 추가 (MCP는 수정됨)
2. BUG-002 deploy lock 활성화 (DB 필드 이미 존재)

**단기 — Medium:** 3. BUG-004 롤백 이미지 보존 (`previous_image_tag` 저장) 4. BUG-003 블루-그린 헬스체크 재시도 로직 5. BUG-014 alerts MCP↔REST 통합 6. BUG-017 get_project_stats null-safety

**1.0.1+ :** 7. BUG-009 서비스 삭제 시 연결 프로젝트 경고 8. BUG-013 크래시 → alerts 연동 9. OpsAgent MCP 도구 확장 (incidents, circuit-breakers 조회)

---

## 칭찬 (Round 3에서 확인)

| 항목                               | 평가                                            |
| ---------------------------------- | ----------------------------------------------- |
| 블루-그린 실패 시 기존 서비스 보존 | BUG-016 수정 — 실패해도 서비스 중단 없음        |
| Redis 백업/복원 완전성             | BGSAVE 자동 호출, 복원 100% 정확                |
| 웹훅 secret 재사용                 | disable→enable 시 secret 유지 + `reused` 플래그 |
| Operations Center API              | 인시던트, 서킷브레이커, 활동 피드 전부 정상     |
| 배포 속도                          | redeploy 21초, 안정적                           |
| 에러 메시지 품질                   | `_agent_guidance` 포함, 다음 행동 안내          |
| 리소스 모니터링                    | CPU 25%, RAM 72%, Disk 87% 정확                 |
