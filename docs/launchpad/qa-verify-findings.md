# QA 검증 — 엣지 케이스 라운드 6 (2026-04-03)

**테스터**: OpenClaw Agent (claude-opus-4-6)  
**목적**: 엣지 케이스 5개 영역 탐색 — 동시 배포, OOM, 특수문자, 멀티라인 환경변수, 빌드 로그  
**테스트 프로젝트 접두사**: `qa-verify-*`

---

## 테스트 결과

### T1: 대용량 빌드 로그 처리

| 항목              | 결과                                                          |
| ----------------- | ------------------------------------------------------------- |
| DB 저장           | ✅ 빌드 로그가 deploy_logs 테이블에 저장됨 (158~338 bytes)    |
| REST API 반환     | ⚠️ deployments 목록 API에서 build_log 필드가 빈 문자열로 반환 |
| MCP get_build_log | ✅ 별도 도구로 정상 조회 가능                                 |

**발견**: REST API `/api/projects/:id/deployments` 응답에서 `build_log` 필드가 제외됨. 성능을 위한 의도적 설계로 보이나, 별도 `build_log` 엔드포인트에서만 조회 가능. 문서화 필요.

---

### T2: 동시 배포 (Race Condition) 🔴

#### T2a: MCP 4건 동시 deploy → 서버 크래시

- **재현**: 4개 `deploy` MCP 호출을 동시에 실행
- **결과**: `MCP error -32000: Connection closed` — **MCP 서버 연결 끊김**
- **영향**:
  - 프로젝트 레코드 4개가 DB에 `building` 상태로 생성됨
  - 실제 빌드는 하나도 완료되지 않음
  - MCP 재연결 불가 — 게이트웨이 + OpenLander 서버 모두 재시작 필요
  - 서버 재시작 후 "stale building projects" 4개가 cleanup됨
- **심각도**: 🔴 Critical — MCP 서버가 동시 요청에 의해 크래시

#### T2b: REST API 3건 동시 redeploy → 고아 컨테이너

- **재현**: 같은 프로젝트에 3건 `POST /redeploy`를 동시 실행
- **결과**: 3개 모두 `success: true` 반환, 각각 다른 `containerId`
- **최종 상태**: 마지막 1개만 살아남고 나머지 2개는 자동 제거됨
- **심각도**: 🟡 Major — 성공 응답을 3개 반환하는 것은 오해 소지, deploy lock 부재

#### 수정 제안

```
- MCP 서버에 동시 요청 제한 (semaphore 또는 request queue)
- deploy 시 프로젝트별 lock 적용 — 이미 building 상태면 거부
- deploy_lock_session, deploy_lock_at 필드가 DB에 존재하나 미활용
```

---

### T3: 컨테이너 OOM 시 동작

| 항목                         | 결과                                                |
| ---------------------------- | --------------------------------------------------- |
| Docker memory limit 적용     | ✅ `docker update --memory 6m` 정상                 |
| OOM Kill 발생                | ✅ `oomKilled=true` 확인                            |
| 프로세스 격리                | ✅ exec한 프로세스만 kill, nginx 메인 프로세스 생존 |
| get_alerts에 OOM 알림        | ❌ 알림 없음                                        |
| get_project_stats에 OOM 정보 | ❌ OOM 정보 미포함                                  |

**발견**:

1. Docker memory limit은 OpenLander에서 설정하는 기능이 없음 — 사용자가 직접 `docker update` 필요
2. OOM Kill 발생해도 알림/이벤트 미생성
3. `get_project_stats`에 memory_limit, oom_killed 정보 미포함

**심각도**: ⚪ Minor — 메모리 제한 기능 자체가 미제공

---

### T4: 프로젝트명 특수문자 처리

| 이름                                 | 생성 | 배포                 | Docker 컨테이너                 | 비고                                 |
| ------------------------------------ | ---- | -------------------- | ------------------------------- | ------------------------------------ |
| `qa-verify-base` (정상)              | ✅   | ✅                   | `ol-qa-verify-base`             |                                      |
| `qa-verify-한글` (한글)              | ✅   | ❌ **영구 building** | 생성 불가                       | 🔴 Docker가 비-ASCII 컨테이너명 거부 |
| `qa-verify-UPPERCASE` (대문자)       | ✅   | ✅                   | `ol-qa-verify-UPPERCASE`        | ⚠️ Traefik 라우팅에서 대소문자 주의  |
| `qa-verify-special_chars.v2` (\_, .) | ✅   | ✅                   | `ol-qa-verify-special_chars.v2` |                                      |

#### 한글 프로젝트명 버그 🔴 Critical

- Docker 컨테이너 이름은 `[a-zA-Z0-9][a-zA-Z0-9_.-]*` 만 허용
- OpenLander가 프로젝트 생성 시 이름 유효성 검증을 하지 않음
- `building` 상태에서 영구 stuck — Docker 컨테이너 생성 시도 실패하지만 에러 핸들링 없음
- `building` 상태의 프로젝트는 archive도 불가 → `ARCHIVE_BUILDING_PROJECT` 에러
- **수동 DB 수정 외에 복구 방법 없음**

**수정 제안**:

```
1. 프로젝트 생성 시 이름 유효성 검증: /^[a-z0-9][a-z0-9-]*$/ (소문자, 숫자, 하이픈만)
2. building 상태 타임아웃 — 일정 시간 후 자동으로 error로 전환
3. force archive/cancel 기능 추가
```

---

### T5: 환경변수 특수문자/멀티라인 값

| 변수                                                        | 설정 | 컨테이너 전달 | 비고                            |
| ----------------------------------------------------------- | ---- | ------------- | ------------------------------- |
| 일반 문자열 `hello`                                         | ✅   | ✅            |                                 |
| 특수문자 `p@$$w0rd!#%^&*()`                                 | ✅   | ✅            | 쉘 메타문자 완벽 보존           |
| URL `postgresql://user:p%40ss@host:5432/db?sslmode=require` | ✅   | ✅            | % 인코딩 보존                   |
| JSON `{"key":"value","nested":{...}}`                       | ✅   | ✅            | 따옴표, 중괄호 보존             |
| 멀티라인 `line1\nline2\nline3`                              | ✅   | ✅            | 실제 뉴라인(0x0a)으로 저장·전달 |
| 이모지 `🚀 Deploy Success ✅`                               | ✅   | ✅            | UTF-8 완벽                      |
| 한글 `한글값테스트`                                         | ✅   | ✅            |                                 |
| 등호 포함 `key=value=another`                               | ✅   | ✅            | 첫 `=` 이후 모두 값으로 처리    |
| 빈 값 `""`                                                  | ✅   | ✅            |                                 |
| 공백 포함 `  leading...trailing  `                          | ✅   | ✅            | 앞뒤 공백 보존                  |

**결과**: ✅ **10/10 완벽 통과** — 모든 특수문자, 멀티라인, 유니코드가 정확히 보존됨.

---

### 추가 발견: get_alerts API 불일치

| MCP `get_alerts`       | REST `/api/alerts`           |
| ---------------------- | ---------------------------- |
| `count: 0, alerts: []` | `count: null, alerts: [3개]` |

- MCP 도구와 REST API가 **다른 결과**를 반환
- REST API의 `count` 필드가 `null` (설정 안 됨)
- REST API에서는 orphan-container, dangling-images, disk 경고 3개가 보이지만 MCP에서는 0개
- **심각도**: 🟡 Major — 에이전트가 알림을 인지하지 못함

---

## 라운드 6 요약

| 테스트                       | 결과                    | 심각도      |
| ---------------------------- | ----------------------- | ----------- |
| T1: 빌드 로그                | ⚠️ REST API에서 미반환  | ⚪ Info     |
| T2a: MCP 동시 deploy         | ❌ 서버 크래시          | 🔴 Critical |
| T2b: REST 동시 redeploy      | ⚠️ 3건 모두 "성공"      | 🟡 Major    |
| T3: OOM                      | ⚠️ 감지/알림 없음       | ⚪ Minor    |
| T4: 한글 프로젝트명          | ❌ 영구 stuck           | 🔴 Critical |
| T4: 대문자 프로젝트명        | ✅ 동작 (주의 필요)     | ⚪ Info     |
| T4: 특수문자(\_.) 프로젝트명 | ✅                      | —           |
| T5: 환경변수 특수문자        | ✅ 10/10 완벽           | —           |
| 추가: alerts 불일치          | ❌ MCP ↔ REST 결과 다름 | 🟡 Major    |

### 신규 Critical 이슈

| ID    | 이슈                             | 수정 난이도                      |
| ----- | -------------------------------- | -------------------------------- |
| T2a   | MCP 동시 요청 시 서버 크래시     | Medium (request queue/semaphore) |
| T4-KR | 한글 프로젝트명 → building stuck | Low (이름 유효성 검증 추가)      |

### 신규 Major 이슈

| ID    | 이슈                              | 수정 난이도             |
| ----- | --------------------------------- | ----------------------- |
| T2b   | 동시 redeploy에 deploy lock 부재  | Low (DB lock 필드 활용) |
| ALERT | get_alerts MCP ↔ REST 결과 불일치 | Medium                  |

### 1.0 블로커 업데이트 (누적)

| 순위 | 이슈                    | 심각도      | 난이도 |
| ---- | ----------------------- | ----------- | ------ |
| 1    | 한글 프로젝트명 → stuck | 🔴 Critical | Low    |
| 2    | MCP 동시 요청 크래시    | 🔴 Critical | Medium |
| 3    | 블루-그린 포트 충돌     | 🔴 Critical | Low    |
| 4    | 롤백 미작동             | 🔴 Critical | Medium |
| 5    | 동시 redeploy lock      | 🟡 Major    | Low    |
| 6    | 크래시 알림 미감지      | 🟡 Major    | Low    |
| 7    | alerts MCP↔REST 불일치  | 🟡 Major    | Medium |

### 리소스 정리

- ✅ `qa-verify-base` — archived
- ✅ `qa-verify-한글` — archived (DB 수동 수정 후)
- ✅ `qa-verify-UPPERCASE` — archived
- ✅ `qa-verify-special_chars.v2` — archived
- ✅ `qa-verify-oom` — archived
- ✅ Docker 컨테이너 — 전부 제거됨

### 한 줄 평

> **환경변수 처리는 완벽하지만, 동시성과 입력 검증에서 심각한 결함이 있다.** 한글 프로젝트명이 시스템을 영구 stuck 시키고, MCP 동시 요청이 서버를 크래시시킨다. 둘 다 간단한 유효성 검증과 동시성 제어로 해결 가능.

---

## 엣지 케이스 라운드 7 (2026-04-03)

**테스터**: OpenClaw Agent (claude-opus-4-6)  
**목적**: 빌드 cancel, 동시 배포 충돌, 환경변수 특수문자, 포트 경계값, 서비스 삭제 후 프로젝트 동작  
**테스트 프로젝트**: `qa-verify-cancel`, `qa-verify-race`, `qa-verify-port*`

---

### T1: 빌드 중 cancel 시 상태 정리

| 시나리오                                       | 결과                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| redeploy(no_cache) 시작 → 즉시 stop_project    | 빌드 계속 진행, stop 무시                                    |
| redeploy(no_cache) 시작 → 즉시 archive_project | archive 성공 응답, 빌드는 완료됨                             |
| 빌드 완료 후                                   | deploy_log에 `success` 기록, 컨테이너 생성 후 archive로 정리 |

**발견**: 빌드 중단(cancel) 기능이 없다.

- `stop_project`은 기존 컨테이너만 중지, 진행 중 빌드는 무시
- `archive_project`은 DB 상태만 변경, 빌드는 완료까지 진행
- `deploy_lock_session`, `deploy_lock_at` 필드가 DB에 존재하지만 미활용
- **심각도**: 🟡 Major — 리소스 낭비 + 사용자 기대와 다른 동작

---

### T2: 동시 배포 충돌 (같은 프로젝트 2번 redeploy)

| 항목                   | 결과                                     |
| ---------------------- | ---------------------------------------- |
| 2건 동시 REST redeploy | 1개 성공, 1개 Docker 409 Conflict        |
| 실패한 쪽              | 빌드는 완료했으나 컨테이너 생성에서 충돌 |
| DB 정합성              | ✅ 성공한 컨테이너 ID만 저장             |
| 빌드 낭비              | ⚠️ 실패한 쪽도 전체 빌드 완료 후 충돌    |

**발견**: deploy lock 부재.

- `deploy_lock_session` / `deploy_lock_at` 필드가 DB 스키마에 존재하지만 미활용
- 두 번째 요청이 크론 클론 → 빌드 → 컨테이너 생성까지 간 후 거부
- **심각도**: 🟡 Major — 빌드 리소스 낭비, 사용자 혼란

---

### T3: 환경변수 특수문자/멀티라인 ✅ 8/8 완벽

| 변수           | 값                                                          | 컨테이너 전달       |
| -------------- | ----------------------------------------------------------- | ------------------- |
| `SPECIAL_PASS` | `p@$$w0rd!#%^&*()`                                          | ✅ 완벽             |
| `DB_URL`       | `postgresql://user:p%40ss@host:5432/db?ssl=true&timeout=30` | ✅                  |
| `JSON_CONFIG`  | `{"key":"val","nested":{"a":[1,2]}}`                        | ✅                  |
| `MULTILINE`    | `line1\nline2\nline3`                                       | ✅ 실제 0x0a로 전달 |
| `EMOJI`        | `🚀✅❌`                                                    | ✅                  |
| `EQUALS_VAL`   | `k=v=w`                                                     | ✅                  |
| `EMPTY`        | `""`                                                        | ✅                  |
| `SPACES`       | `"  hello  "`                                               | ✅ 공백 보존        |

---

### T4: 포트 범위 경계값

| 포트  | MCP 검증                | REST 검증     | Docker            | 결과                |
| ----- | ----------------------- | ------------- | ----------------- | ------------------- |
| 0     | ✅ 차단 (`must be > 0`) | 미테스트      | —                 | ✅                  |
| 80    | ✅ 통과                 | ✅            | ✅                | ✅                  |
| 65535 | ✅ 통과                 | ✅            | ✅                | ✅                  |
| 99999 | ⚠️ 통과 (상한 없음)     | —             | ❌ `invalid port` | ⚠️ 스키마 상한 필요 |
| -1    | ✔️ Zod 차단 (예상)      | ❌ **미검증** | 무시됨            | 🔴 DB에 -1 저장     |

**발견**:

1. MCP Zod 스키마: `exclusiveMinimum: 0` 있으나 `maximum: 65535` 없음
2. REST API: 포트 범위 검증 완전 부재 — 음수도 허용
3. 음수 포트(-1): DB에 `container_port=-1` 저장, Docker는 이미지 EXPOSE 사용
4. **심각도**: 🟡 Major (REST API 포트 검증 부재)

---

### T5: 서비스 삭제 후 연결된 프로젝트 동작

| 단계                                       | 동작                                      |
| ------------------------------------------ | ----------------------------------------- |
| 서비스 생성 → 프로젝트에 DATABASE_URL 설정 | ✅ DNS 해석 + ping 정상                   |
| `remove_service` 호출                      | ✅ 서비스 삭제                            |
| 프로젝트에서 DNS 해석 시도                 | ❌ `bad address` — 서비스 컨테이너 사라짐 |
| DATABASE_URL 환경변수                      | ⚠️ 여전히 존재 (삭제된 서비스 참조)       |
| 브로큰 연결 알림                           | ❌ 알림 없음                              |

**발견**:

1. 서비스 삭제 시 연결된 프로젝트의 환경변수를 경고/정리하지 않음
2. 프로젝트가 존재하지 않는 서비스를 참조하는 끄어진 상태로 남음
3. `remove_service` 응답에 "이 서비스를 사용 중인 프로젝트" 경고가 없음
4. **심각도**: 🟡 Major — 운영 시 예기치 않은 앱 다운타임 발생 가능

---

### 라운드 7 요약

| 테스트                | 결과                    | 심각도   |
| --------------------- | ----------------------- | -------- |
| T1: 빌드 cancel       | ⚠️ cancel 기능 없음     | 🟡 Major |
| T2: 동시 redeploy     | ⚠️ lock 없이 Docker 409 | 🟡 Major |
| T3: 환경변수 특수문자 | ✅ 8/8 완벽             | —        |
| T4: 포트 경계값       | ⚠️ REST에서 음수 허용   | 🟡 Major |
| T5: 서비스 삭제 후    | ⚠️ 끄어진 참조 미처리   | 🟡 Major |

### 신규 이슈

| ID        | 항목                                | 심각도   | 수정 난이도        |
| --------- | ----------------------------------- | -------- | ------------------ |
| T1-CANCEL | 빌드 중단 기능 없음                 | 🟡 Major | Medium             |
| T2-LOCK   | deploy lock 부재                    | 🟡 Major | Low (DB 필드 존재) |
| T4-PORT   | REST API 포트 범위 미검증           | 🟡 Major | Low                |
| T4-SCHEMA | MCP 스키마 포트 상한(≤65535) 없음   | ⚪ Minor | Low                |
| T5-ORPHAN | 서비스 삭제 시 프로젝트 연결 미정리 | 🟡 Major | Medium             |

### 1.0 블로커 누적 (전체 라운드 통합)

| 순위 | 이슈                                | 심각도      | 난이도 | 출처 |
| ---- | ----------------------------------- | ----------- | ------ | ---- |
| 1    | 한글 프로젝트명 → 영구 stuck        | 🔴 Critical | Low    | R6   |
| 2    | MCP 동시 요청 → 서버 크래시         | 🔴 Critical | Medium | R6   |
| 3    | 블루-그린 포트 충돌                 | 🔴 Critical | Low    | R4   |
| 4    | 롤백 미작동                         | 🔴 Critical | Medium | R2   |
| 5    | REST API 포트 검증 부재 (음수 허용) | 🟡 Major    | Low    | R7   |
| 6    | 서비스 삭제 시 연결 미정리          | 🟡 Major    | Medium | R7   |
| 7    | deploy lock 부재                    | 🟡 Major    | Low    | R7   |
| 8    | 빌드 cancel 기능 없음               | 🟡 Major    | Medium | R7   |
| 9    | 크래시 알림 미감지                  | 🟡 Major    | Low    | R3   |
| 10   | alerts MCP↔REST 불일치              | 🟡 Major    | Medium | R6   |

### 리소스 정리

- ✅ `qa-verify-cancel` — archived
- ✅ `qa-verify-race` — archived
- ✅ `qa-verify-port65535` — archived
- ✅ `qa-verify-port99999` — archived
- ✅ `qa-verify-portneg` — archived
- ✅ `qa-verify-db` 서비스 — removed
- ✅ Docker 컨테이너 0개 잔여

### 한 줄 평

> **환경변수는 방탄하지만, 동시성 제어와 입력 검증이 전반적으로 미흡하다.** deploy lock, 포트 범위 검증, 서비스 의존성 추적, 빌드 cancel — 모두 DB에 필드는 있지만 로직이 없다. 구현만 넣으면 대부분 Low 난이도.

---

## 엣지 케이스 라운드 8 (2026-04-03)

**테스터**: OpenClaw Agent (claude-opus-4-6)  
**목적**: 서비스 삭제 후 재배포, 볼륨 경로 충돌, compose 의존성, deploy history 정확도, cleanup 안전성  
**테스트 프로젝트**: `qa-verify-svctest`, `qa-verify-compose`

---

### T1: 서비스 삭제 후 연결된 프로젝트 재배포

| 단계                                          | 동작                                       |
| --------------------------------------------- | ------------------------------------------ |
| PG 서비스 생성 + 프로젝트에 DATABASE_URL 설정 | ✅ DNS ping 정상                           |
| `remove_service` 호출                         | ✅ 삭제 성공 (연결 프로젝트 경고 **없음**) |
| `redeploy_project` 호출                       | ✅ 배포 성공 (nginx라 DB 불필요)           |
| 컨테이너 내 DNS 해석                          | ❌ `bad address` — 서비스 컨테이너 사라짐  |
| DATABASE_URL 환경변수                         | ⚠️ 여전히 존재 (삭제된 서비스 참조)        |

**발견**: `remove_service` 응답에 "연결된 프로젝트" 경고 없음. 앱이 DB를 실제로 사용하면 재배포 후 즉시 크래시.  
**심각도**: 🟡 Major

---

### T2: 볼륨 마운트 경로 충돌 🔴

| 단계                            | 동작                                               |
| ------------------------------- | -------------------------------------------------- |
| `add_volume(data-a, /app/data)` | ✅ 생성                                            |
| `add_volume(data-b, /app/data)` | ✅ 생성 (충돌 검증 **없음**!)                      |
| `list_volumes`                  | 2개 볼륨 모두 `/app/data` 마운트                   |
| `redeploy_project`              | ❌ Docker 에러: `Duplicate mount point: /app/data` |

**발견**: 같은 `mount_path`에 복수 볼륨 등록 가능. Docker가 거부할 때까지 문제 미감지.  
**수정 제안**: `add_volume` 시 기존 볼륨과 mount_path 중복 체크  
**심각도**: 🟡 Major — 사용자 실수 시 배포 불가

---

### T3: Compose 배포 서비스 의존성 순서

- quickpoll docker-compose.yml에 `depends_on` 없음
- plan의 `compose_services` 배열이 YAML 정의 순서를 따름 (api → web)
- `depends_on` 파싱은 AGENTS.md에 명시되어 있으나 실제 테스트 불가 (레포에 depends_on 없음)
- **결과**: ⚠️ 의존성 순서 테스트 불가 (depends_on 있는 레포 필요)

---

### T4: get_deploy_history 정확도 ✅

| 항목                    | API 응답            | DB 실제  | 일치               |
| ----------------------- | ------------------- | -------- | ------------------ |
| deploy count            | 5건                 | 5건      | ✅                 |
| status (success/failed) | 4S + 1F             | 4S + 1F  | ✅                 |
| duration                | `"1.6s"`            | `1630ms` | ✅ (1630ms ≈ 1.6s) |
| trigger                 | `"api"`             | `api`    | ✅                 |
| commit_sha              | `null` (이미지)     | (empty)  | ✅                 |
| 실패 기록               | 볼륨 충돌 실패 포함 | 동일     | ✅                 |

**결과**: ✅ deploy history가 DB와 완전히 일치. 정확하다.

---

### T5: cleanup_docker 후 running 프로젝트 영향 ✅

| cleanup 레벨              | 삭제됨 | running 컨테이너 영향 |
| ------------------------- | ------ | --------------------- |
| soft (dangling only)      | 0      | ✅ 27개 전부 정상     |
| standard (+build cache)   | 0      | ✅ 27개 전부 정상     |
| aggressive (+unused >24h) | 0      | ✅ 27개 전부 정상     |

4개 프로덕션 프로젝트 (loan-calculator, hotdeal-web, quickpoll-api, status-page) 개별 확인 — 모두 running 유지.

**결과**: ✅ 안전. Docker의 `--filter until=24h` 플래그가 사용 중 이미지를 보호.

---

### 라운드 8 요약

| 테스트                   | 결과                          | 심각도   |
| ------------------------ | ----------------------------- | -------- |
| T1: 서비스 삭제 → 재배포 | ⚠️ 끊어진 참조 방치           | 🟡 Major |
| T2: 볼륨 경로 충돌       | ❌ 중복 등록 허용 → 배포 실패 | 🟡 Major |
| T3: Compose 의존성       | ⚠️ 테스트 불가                | ⚪ Info  |
| T4: deploy history       | ✅ 정확                       | —        |
| T5: cleanup 안전성       | ✅ 영향 없음                  | —        |

### 신규 이슈

| ID        | 항목                                         | 심각도   | 난이도 |
| --------- | -------------------------------------------- | -------- | ------ |
| T2-VOLDUP | 볼륨 mount_path 중복 등록 허용               | 🟡 Major | Low    |
| T1-SVCREF | 서비스 삭제 시 프로젝트 연결 미정리 (재확인) | 🟡 Major | Medium |

### 1.0 블로커 누적 (전체 R6–R8)

| 순위 | 이슈                         | 심각도      | 난이도 | 출처  |
| ---- | ---------------------------- | ----------- | ------ | ----- |
| 1    | 한글 프로젝트명 → 영구 stuck | 🔴 Critical | Low    | R6    |
| 2    | MCP 동시 요청 → 서버 크래시  | 🔴 Critical | Medium | R6    |
| 3    | 블루-그린 포트 충돌          | 🔴 Critical | Low    | R4    |
| 4    | 롤백 미작동                  | 🔴 Critical | Medium | R2    |
| 5    | REST API 포트 검증 부재      | 🟡 Major    | Low    | R7    |
| 6    | 볼륨 mount_path 중복         | 🟡 Major    | Low    | R8    |
| 7    | 서비스 삭제 시 연결 미정리   | 🟡 Major    | Medium | R7/R8 |
| 8    | deploy lock 부재             | 🟡 Major    | Low    | R7    |
| 9    | 빌드 cancel 기능 없음        | 🟡 Major    | Medium | R7    |
| 10   | 크래시 알림 미감지           | 🟡 Major    | Low    | R3    |
| 11   | alerts MCP↔REST 불일치       | 🟡 Major    | Medium | R6    |

**Critical 4개, Major 7개** — Low 난이도 5개는 빠른 수정 가능.

### 리소스 정리

- ✅ `qa-verify-svctest` — archived
- ✅ `qa-verify-pg` 서비스 — removed
- ✅ 볼륨 data-a, data-b — removed
- ✅ Docker 컨테이너 0개 잔여
- ✅ cleanup_docker 후 running 27개 정상 확인

### 한 줄 평

> **deploy history와 cleanup은 만점.** 볼륨 경로 중복이 새로운 Major — add_volume에 간단한 unique 체크만 추가하면 된다. 서비스 의존성 추적은 이제 3번 연속 확인된 지속적 이슈.
