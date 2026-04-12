# OpenLander 버그 리포트 — 2026-04-03

> 오픈클로 자율 QA 8라운드 (123개 테스트) + 수동 코드 분석 기반
> 총 Critical 6개, Major 9개 발견. 이 문서는 수정 담당자를 위한 상세 리포트.

---

## Critical — 1.0 출시 전 반드시 수정

### BUG-001: 프로젝트명 유효성 검증 없음 → 한글/특수문자 입력 시 영구 building stuck

**심각도**: 🔴 Critical  
**난이도**: Low  
**재현율**: 100%

**재현 방법**:

```
create_deploy_plan → name: "qa-verify-한글" → execute_deploy_plan
```

**증상**:

- Docker 컨테이너명은 `[a-zA-Z0-9][a-zA-Z0-9_.-]*`만 허용
- OpenLander가 검증 없이 수용 → Docker 컨테이너 생성 실패
- 프로젝트가 `building` 상태에서 영구 stuck
- `building` 상태의 프로젝트는 archive 불가 → `ARCHIVE_BUILDING_PROJECT` 에러
- **수동 DB 수정 외에 복구 방법 없음**

**수정 위치**: 프로젝트 생성 경로 (create_deploy_plan, REST API 등)

**수정 제안**:

1. 프로젝트명 유효성 검증 추가: `/^[a-z0-9][a-z0-9-]*$/`
2. building 상태 타임아웃 — 일정 시간 후 자동 error 전환
3. force archive 기능 추가 (building 상태여도 아카이브 가능)

---

### BUG-002: MCP 동시 요청 시 서버 크래시

**심각도**: 🔴 Critical  
**난이도**: Medium  
**재현율**: 100%

**재현 방법**:

```
4개의 deploy MCP 호출을 동시에 실행
```

**증상**:

- `MCP error -32000: Connection closed` — MCP 서버 연결 끊김
- 프로젝트 레코드 4개가 DB에 `building` 상태로 생성되지만 빌드 미완료
- MCP 자동 재연결 불가 — 게이트웨이 + OpenLander 서버 모두 재시작 필요
- 재시작 후 stale building 프로젝트들이 cleanup 됨

**관련 코드**:

- MCP 서버: `src/mcp/server.ts`
- 배포 파이프라인: `src/pipeline/deploy-core.ts`
- DB에 `deploy_lock_session`, `deploy_lock_at` 필드가 존재하나 미활용

**수정 제안**:

1. MCP 서버에 동시 요청 제한 (semaphore 또는 request queue)
2. deploy 시 프로젝트별 lock 적용 — 이미 building 상태면 거부
3. DB의 `deploy_lock_session`, `deploy_lock_at` 필드 활용

---

### BUG-003: 블루-그린 배포 100% 실패 — 포트 충돌

**심각도**: 🔴 Critical  
**난이도**: Low  
**재현율**: 100%

**재현 방법**:

```
deploy_blue_green(project_name: "any-running-project")
```

**증상**:

- `Bind for 0.0.0.0:PORT failed: port is already allocated`

**근본 원인** (`src/pipeline/deploy-core.ts` 1460-1475줄):

```
1. green 컨테이너를 newPort로 실행 → health check 통과
2. blue(기존) 컨테이너 중지/삭제
3. promoted 컨테이너를 같은 newPort로 실행 시도
4. ❌ green 컨테이너가 아직 newPort를 점유 중 → 포트 충돌
5. green 정리 (너무 늦음)
```

**수정 제안**:

- green 컨테이너를 `docker rename`으로 promoted 이름으로 승격 — 다운타임 0, 새 컨테이너 불필요
- 또는 green 컨테이너를 먼저 중지한 뒤 promoted 컨테이너를 시작

---

### BUG-004: 롤백 기능 미작동 — 이전 이미지 미보존

**심각도**: 🔴 Critical  
**난이도**: Medium  
**재현율**: 100%

**재현 방법**:

```
프로젝트를 2번 배포 → rollback_project 호출 → "No previous image available for rollback"
```

**근본 원인**:

- 모든 빌드가 `openlander/{name}:latest` 태그 사용 (`src/pipeline/deploy-core.ts:702`)
- 새 빌드가 `:latest`를 덮어쓰면서 이전 Docker 이미지 소멸
- DB에 `previous_image_tag` 필드 있지만, Docker 이미지가 이미 사라진 후라 무의미
- 롤백 코드(`src/pipeline/deploy/rollback.ts:60-90`)가 `previous_image_tag`로 찾지만 실제 이미지 없음

**관련 파일**:

- 이미지 태깅: `src/pipeline/deploy-core.ts:702`
- 모노레포: `src/pipeline/deploy/monorepo-orchestrator.ts:46`
- DB 업데이트: `src/pipeline/deploy/orchestrator.ts:568-585`
- 롤백 실행: `src/pipeline/deploy/rollback.ts:37-90`
- DB 스키마: `src/db/schema.drizzle.ts:28-29, 82-83`

**수정 제안**:

1. 빌드 전 기존 이미지를 `openlander/{name}:prev-{timestamp}` 태그로 보존
2. DB의 `previous_image_tag`에 보존된 태그 저장
3. 롤백 시 보존된 태그의 이미지로 컨테이너 교체

---

### BUG-005: update_project_config의 dockerfile_path가 redeploy에 반영 안 됨

**심각도**: 🔴 Critical  
**난이도**: Low  
**재현율**: 100%

**재현 방법**:

```
1. 모노레포 배포 → api/Dockerfile 자동 선택
2. update_project_config(dockerfile_path: "worker/Dockerfile")
3. DB에 worker/Dockerfile 저장 확인됨
4. redeploy_project(no_cache: true)
5. 빌드 로그: 여전히 "Using api/Dockerfile"
```

**근본 원인** (`src/pipeline/build-deploy-config.ts` 약 75줄):

```typescript
// BUG: snapshot이 DB 설정을 덮어씀
mergedFromStored = { ...dbConfig, ...storedConfig.snapshot };
```

`deploy_configs` 테이블의 snapshot이 이전 배포의 `dockerfilePath: 'api/Dockerfile'`을 담고 있어, `projects` 테이블의 `dockerfile_path = 'worker/Dockerfile'`을 덮어씀.

**수정 제안**:

```typescript
// FIX: DB 프로젝트 설정이 snapshot보다 우선
mergedFromStored = { ...storedConfig.snapshot, ...dbConfig };
```

또는 `update_project_config` 시 `deploy_configs`의 snapshot도 같이 업데이트.

---

### BUG-006: Redis 백업 시 BGSAVE 미호출 → 빈 백업 → 데이터 손실

**심각도**: 🔴 Critical  
**난이도**: Low  
**재현율**: 높음 (dump.rdb가 아직 없는 경우 100%)

**재현 방법**:

```
1. create_service(template: "redis")
2. redis-cli SET hello world
3. backup_service(service_name)  // BGSAVE 없이 볼륨만 복사
4. redis-cli FLUSHALL
5. restore_service(service_name)
6. redis-cli DBSIZE → 0  // 데이터 손실!
```

**증상**:

- `backup_service`가 Redis 볼륨을 단순 복사
- Redis는 비동기 RDB 스냅샷 방식이라 `BGSAVE` 없이는 `/data/dump.rdb` 미존재 가능
- 빈 백업(94B) 생성 → 복원 시 데이터 전량 손실
- 수동으로 `BGSAVE` 실행 후 백업하면 정상 복원됨 (252B)

**관련 파일**: `src/pipeline/service-adapters/shared.ts` 또는 백업 관련 코드

**수정 제안**:

- `backup_service`에서 Redis 타입 서비스 감지 시:
  1. `docker exec {container} redis-cli BGSAVE` 실행
  2. `LASTSAVE` 폴링으로 완료 대기
  3. 그 후 볼륨 복사

---

## Major — 우선 수정 권장

### BUG-007: REST API 포트 범위 검증 부재

**난이도**: Low

- MCP Zod 스키마: `exclusiveMinimum: 0` 있으나 `maximum: 65535` 없음
- REST API: 포트 범위 검증 완전 부재 — 음수(-1)도 DB에 저장됨
- 99999 같은 무효 포트도 Docker 실행 시까지 감지 안 됨

**수정**: Zod 스키마에 `.max(65535)` 추가 + REST API 입력 검증

### BUG-008: 볼륨 mount_path 중복 등록 허용

**난이도**: Low

- 같은 `mount_path`에 2개 볼륨 등록 가능 → Docker `Duplicate mount point` 에러로 배포 실패
- `add_volume` 시 기존 볼륨과 mount_path 중복 체크 없음

**수정**: `add_volume`에서 기존 볼륨의 mount_path와 중복 검사

### BUG-009: 서비스 삭제 시 연결 프로젝트 미경고

**난이도**: Medium

- `remove_service` 응답에 "이 서비스를 사용 중인 프로젝트" 경고 없음
- 삭제된 서비스의 DNS를 참조하는 env var가 프로젝트에 남음
- 앱이 DB를 실제로 사용하면 재배포 후 즉시 크래시

**수정**: `remove_service` 시 env vars에서 해당 서비스 DNS를 참조하는 프로젝트 목록 반환

### BUG-010: deploy lock 부재

**난이도**: Low

- 같은 프로젝트에 동시 redeploy → Docker 409 Conflict
- DB에 `deploy_lock_session`, `deploy_lock_at` 필드가 이미 존재하나 미활용

**수정**: deploy 시작 시 lock 획득, 이미 building이면 거부

### BUG-011: 크래시 알림 미감지

**난이도**: Low

- `HealthMonitor`가 크래시 감지하지만 `RuntimeIncident`만 기록, Alert 미생성
- `AlertMonitor`는 30초 폴링으로 감지하지만, `state.Running=true`(restart 중)로 오판하는 경우 있음
- `state.Restarting` + `RestartCount` 체크 누락

**수정**: HealthMonitor 크래시 감지 시 AlertMonitor에 직접 alert 생성 호출

### BUG-012: alerts MCP↔REST 불일치

**난이도**: Medium

- MCP `get_alerts`: `count: 0, alerts: []`
- REST `/api/alerts`: `count: null, alerts: [3개]`
- 에이전트가 알림을 인지하지 못함

### BUG-013: MCP↔HTTP env vars 이원화

**난이도**: Medium

- MCP `set_env_vars`는 프로젝트 레벨 저장
- HTTP API `POST /environments/:envId/env`는 environment 레벨 저장
- MCP `list_env_vars`는 프로젝트 레벨만 반환 → 웹 UI에서 설정한 env vars가 에이전트에서 안 보임

### BUG-014: 빌드 cancel 기능 없음

**난이도**: Medium

- `stop_project`은 기존 컨테이너만 중지, 진행 중 빌드는 무시
- `archive_project`은 DB 상태만 변경, 빌드는 완료까지 진행
- 리소스 낭비 + 사용자 기대와 다른 동작

### BUG-015: 웹훅 re-enable 시 새 secret 발급

**난이도**: Low

- `disable_webhook` → `enable_webhook`하면 ID와 secret이 모두 변경됨
- GitHub에서 webhook secret을 재설정해야 함

---

## 참고: 잘 동작하는 것

| 영역                       | 결과                      |
| -------------------------- | ------------------------- |
| 환경변수 특수문자/멀티라인 | 10/10 완벽                |
| deploy history 정확도      | DB와 100% 일치            |
| cleanup_docker 안전성      | running 프로젝트 무영향   |
| 프로젝트 상태 일관성       | 27개 API↔Docker 100% 일치 |
| system stats               | OS 실제 값과 일치         |
| PostgreSQL 백업/복원       | 완벽                      |
| 아카이브/복원 사이클       | env+webhook+history 보존  |
| restart policy             | unless-stopped 정상 동작  |
| 글로벌 시크릿 마스킹       | 일관된 패턴               |
