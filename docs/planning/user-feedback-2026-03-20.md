# User Feedback Analysis — 2026-03-20

> **출처**: 실사용 QA 세션 피드백
> **분석일**: 2026-03-20
> **대상 버전**: v0.6.14
> **목적**: 다음 릴리즈에 반영할 개선사항 정리

---

## 우선순위 요약

| 순위 | 기능                                               | 난이도 | 임팩트 | 상태   |
| ---- | -------------------------------------------------- | ------ | ------ | ------ |
| 1    | `get_deploy_status`에 `build_step` 실시간 표시     | 저     | 높음   | 미착수 |
| 2    | `list_env_vars`에 변수 출처(source) 표시           | 저     | 중     | 미착수 |
| 3    | `create_deploy_plan` 응답에 `internal_url` 포함    | 저     | 중     | 미착수 |
| 4    | Image SHA skip (restart 시 변경 없으면 build 생략) | 저     | 높음   | 미착수 |
| 5    | Clone cache + 동시배포 dedup 통합                  | 중     | 높음   | 미착수 |
| 6    | MCP server heartbeat                               | 저     | 중     | 미착수 |
| 7    | MCP session resume (끊김 후 복구)                  | 중     | 높음   | 미착수 |
| 8    | CI 핵심 flow 자동 테스트                           | 중     | 높음   | 미착수 |
| 9    | MCP 도구 description 보강                          | 저     | 중     | 미착수 |
| 10   | Compose → dockerode 전환 (장기)                    | 고     | 높음   | 미착수 |

---

## 1. `build_step` 실시간 표시

### 피드백

> `get_deploy_status`에서 `phase: "building" + elapsed: "30s"`만 표시. Docker가 Step 8/11 중인지 Step 3/11 중인지 알 수 없음. 빌드가 2분 넘어가면 "멈춘 건지 느린 건지" 판단 불가.

### 현 상태

- `JobManager`가 6단계 phase만 추적: `queued | cloning | building | starting | done | failed`
- Docker `followProgress`로 실시간 스트리밍은 하고 있으나, MCP `get_deploy_status`는 `build_log_tail`(마지막 100줄)만 반환
- Web에서는 SSE로 빌드 로그 실시간 스트리밍 가능 (`deploy-timeline-stream-routes.ts`)

### 구현 방안

- `deploy-core.ts:776`의 `onProgress` 콜백에서 `/^Step (\d+)\/(\d+)\s*:\s*(.+)/` regex 파싱
- `JobStatus`에 `build_step`, `build_step_total`, `build_step_desc` 필드 추가
- `get_deploy_status` 응답에 포함

### 수정 파일

- `src/pipeline/job-manager.ts` — `JobStatus` 타입에 필드 추가
- `src/pipeline/deploy-core.ts` — onProgress에서 Step 파싱 → `jobManager.updateBuildStep()`
- `src/tools/defs/deploy.ts` — 응답에 `build_step` 포함

### 예상 응답 변화

```typescript
// Before
{ phase: "building", elapsed: "30s", build_log_tail: "..." }

// After
{ phase: "building", elapsed: "30s", build_step: "8/11", build_step_desc: "RUN pip install -r requirements.txt", build_log_tail: "..." }
```

---

## 2. `list_env_vars` 변수 출처 표시

### 피드백

> env var 7단계 우선순위가 과할 수 있음. "왜 이 값이 override됐지?" 디버깅할 때 어려움. 각 변수의 출처(source)를 표시하면 해결될 듯.

### 현 상태

- 7-level 우선순위: `auto < global secrets < project vars < production vars < environment vars < service vars < inline`
- `getInheritanceInfo()` 함수가 이미 `env.ts`에 구현되어 있음 (source 추적 지원)
- **Web API에서는 이미 노출** (`GET /projects/:id/environments/:envId/env`)
- **MCP `list_env_vars`에서는 미노출** — masked 값만 반환, 출처 없음

### 구현 방안

- `list_env_vars`에서 `getAllMasked()` 대신 `getInheritanceInfo()` 결과를 포함

### 수정 파일

- `src/tools/defs/env.ts` — `list_env_vars` execute 함수 수정

### 예상 응답 변화

```typescript
// Before
{ variables: { DATABASE_URL: "post****5432" }, count: 3 }

// After
{
  variables: {
    DATABASE_URL: { value: "post****5432", source: "service", level: 6 },
    API_KEY: { value: "sk-****7890", source: "project", level: 3 },
    NODE_ENV: { value: "production", source: "auto", level: 1 }
  },
  count: 3
}
```

---

## 3. `create_deploy_plan`에 `internal_url` 포함

### 피드백

> `containerName` 필드가 추가된 건 좋지만, 사용자가 직접 `http://ol-hotdeal-api:8000`을 조합해야 함. 배포 시점에 안내가 필요.

### 현 상태

- `list_projects`가 `containerName: "ol-{name}"` 반환
- `get_service_credentials`는 서비스용 host/port 반환
- **프로젝트 간 내부 통신 URL을 안내하는 도구 없음**
- 컨테이너명: 프로젝트 `ol-{name}`, 서비스 `ol-svc-{name}`
- 모든 컨테이너가 `web` Docker network 공유

### 구현 방안 (2가지, 둘 다 해도 됨)

**A. `create_deploy_plan` 응답에 포함** (추천)

- plan 생성 시 `internal_url: "http://ol-{name}:{port}"` 자동 안내
- 수정: `src/pipeline/deploy-plan/engine.ts`, `types.ts`

**B. `get_project_internal_url` 도구 추가**

- project_name → `{ internal_url, container_name, port }` 반환
- 수정: `src/tools/defs/project-ops.ts`

---

## 4. Image SHA skip (빌드 캐시 강화)

### 피드백

> 코드 변경 없으면 캐시 히트가 보장되는 구조가 이상적. `restart_project` 할 때도 full build가 도는 경우 있음.

### 현 상태

- `restart_project` → `redeploy()` → `cloneRepo()` → `buildImage()` (항상 full flow)
- Docker layer cache는 동작하지만 clone은 항상 fresh
- `no_cache: true` 옵션으로 강제 full rebuild 가능

### 구현 방안

- build 전에 `docker images`로 `openlander/{name}:{commitSha}` 존재 확인
- 존재하면 build skip → 기존 이미지로 container만 재시작
- `git ls-remote`로 HEAD SHA 확인 → DB의 마지막 성공 배포 SHA와 비교

### 수정 파일

- `src/pipeline/deploy-core.ts` — build skip 로직
- `src/pipeline/docker.ts` — `imageExists(tag)` 헬퍼 추가

---

## 5. Clone cache + 동시배포 dedup 통합

### 피드백 (2건 통합)

> 빌드 시간이 매번 60~100초. no_cache=false에서도 clone → full build가 도는 경우 있음.
> 3개를 동시에 execute_deploy_plan 하면 같은 repo를 3번 clone하고 같은 Dockerfile을 3번 빌드함.

### 현 상태

- `git.ts:cloneRepo()` — 매번 `mkdtemp`로 새 temp dir 생성, `depth=1` shallow clone
- `execute_deploy_plan`에 concurrency control 없음
- 다른 프로젝트 간 동시 배포는 정상 동작 (각각 `fireAndForgetDeploy()`)
- 같은 프로젝트 중복 실행은 plan 상태 체크(`status !== 'ready'`)로 차단

### 구현 방안 (clone cache에 mutex를 얹어서 dedup 해결)

- `{repoUrl}:{branch}` 키로 clone dir을 persistent cache에 보관
- 재배포 시 `git fetch origin {branch} && git reset --hard origin/{branch}` (2초 이내)
- per-repo mutex: 동시 요청 시 첫 번째가 clone/fetch → 나머지는 완료 대기 후 같은 dir 사용
- 캐시 사이즈 제한: LRU eviction 또는 max 10개

### 수정 파일

- `src/pipeline/git.ts` — `cloneOrFetch()` 함수 + per-repo lock
- `src/pipeline/deploy-core.ts` — `cloneRepo()` 대신 `cloneOrFetch()` 호출

### 왜 별도 "빌드 큐 시스템"이 불필요한가

- Docker layer cache가 첫 빌드 후 자동으로 동작
- Clone mutex가 네트워크/디스크 I/O 중복을 제거
- 남은 빌드 오버헤드는 Docker 자체가 처리

---

## 6. MCP Server Heartbeat

### 피드백

> 이 세션에서 MCP가 3번 끊겼음. 긴 QA 세션에서 반복적으로 끊기면 작업 흐름이 크게 깨짐.

### 현 상태

- HTTP transport: heartbeat/keep-alive 없음
- 세션 끊기면 404 반환, 클라이언트가 새 세션 시작 필요
- reconnection 로직 전무
- Stdio transport: blocking, 연결 안정적

### 구현 방안

- SSE/streamable HTTP에 30초 간격 ping event 전송
- transport idle timeout 연장 (현재 SDK 기본값)

### 수정 파일

- `src/mcp/server.ts` — heartbeat interval 추가

---

## 7. MCP Session Resume

### 피드백

> (6번과 연계) 끊겨도 기존 세션 복구가 가능해야 함.

### 현 상태

- `mcp-session-id`로 세션 식별하지만, sessions Map에서 삭제되면 복구 불가 (404)
- 세션 상태는 in-memory Map에만 존재

### 구현 방안

- 세션 끊김 시 즉시 삭제 대신 TTL 부여 (5분)
- 같은 `mcp-session-id`로 재접속 시 기존 서버 인스턴스 재연결
- TTL 만료 후 정리

### 수정 파일

- `src/mcp/server.ts` — `onsessionclosed`에서 즉시 삭제 대신 TTL 설정

---

## 8. CI 핵심 Flow 자동 테스트

### 피드백

> 회귀가 잦았다 — 하나 고치면 다른 게 깨지는 패턴. 자동화 테스트가 없어서 수동 QA에 의존.

### 현 상태

- CI: lint → typecheck → test:coverage → build (unit/integration만)
- Docker/compose 관련 테스트는 전부 mock (`vi.mock('node:child_process')`)
- Playwright E2E 2개 있으나 API 모킹, CI에서 실행 안 함
- characterization test가 compose redeploy 갭을 문서화하고 있음

### 구현 방안

- 핵심 시나리오 integration test 추가: `plan create → execute → restart`
- Docker 의존 테스트는 별도 CI job (Docker-in-Docker 또는 self-hosted runner)
- 기존 characterization test의 갭을 실제 테스트로 전환

### 수정 파일

- `test/` — 신규 integration test 파일
- `.github/workflows/ci.yml` — Docker 테스트 job 추가

---

## 9. MCP 도구 Description 보강

### 피드백

> MCP 도구 description 보강 — 에이전트가 삽질 안 하게.

### 현 상태

- 도구 description이 기본적인 수준
- compose 지원 범위, 내부 URL 규칙, env var 우선순위 등이 description에 없음
- 에이전트가 시행착오로 학습해야 함

### 구현 방안

- `create_deploy_plan`: compose 지원 기능 목록 명시
- `list_projects`: `containerName`과 내부 통신 방법 안내
- `set_env_vars`: 7-level 우선순위 설명
- compose 관련 도구: 지원하는 YAML 필드 명시

### 수정 파일

- `src/tools/defs/*.ts` — 각 도구의 description 문자열 보강

### 현재 Compose 지원 범위 (description에 포함할 내용)

| Compose YAML 필드                         | 지원 |
| ----------------------------------------- | ---- |
| `services[].build` (context, dockerfile)  | ✅   |
| `services[].ports`                        | ✅   |
| `services[].environment`                  | ✅   |
| `services[].depends_on` (키만, 조건 무시) | ✅   |
| `services[].env_file`                     | ✅   |
| `services[].volumes` (pass-through)       | ✅   |
| `services[].profiles`                     | ✅   |
| `services[].image`                        | ✅   |
| `services[].command`                      | ❌   |
| `services[].entrypoint`                   | ❌   |
| `services[].healthcheck`                  | ❌   |
| `services[].restart`                      | ❌   |
| `services[].networks`                     | ❌   |
| `networks:` top-level                     | ❌   |
| `volumes:` top-level                      | ❌   |
| `secrets:` / `configs:` top-level         | ❌   |

---

## 10. Compose → dockerode 전환 (장기)

### 피드백

> Compose의 구조적 제약 — env_file, container_name, 전체 서비스 validate 같은 Docker Compose 자체 동작 때문에 우회가 많았음. 장기적으로 compose를 직접 실행하지 않고 OpenLander가 compose를 해석해서 개별 Docker 빌드+실행하는 게 더 안정적일 수 있음.

### 현 구조의 근본 문제

OpenLander가 compose.yml의 90%를 이미 직접 처리 (파싱, 필터링, 의존성 정렬, 포트 관리, env 생성, 헬스체크). 하지만 마지막 실행만 `docker compose up`에 위임. Compose CLI가 자기 방식대로 동작하려 하면서 충돌 발생 → override hack 3개 누적:

1. **env_file placeholder hack** — 배포 안 할 서비스의 env_file도 compose가 검증해서 실패 → 빈 파일 touch
2. **port remapping hack** — compose의 포트 바인딩이 OpenLander 포트와 충돌 → override.yml로 재매핑
3. **secret mount hack** — OpenLander 시크릿을 compose가 모름 → override.yml에 volume mount 주입

### Compose CLI vs dockerode 비교

|                                | Compose CLI 유지 (현재)                                  | dockerode 전환 (제안)                           |
| ------------------------------ | -------------------------------------------------------- | ----------------------------------------------- |
| **사용자 경험**                | compose.yml 작성                                         | compose.yml 작성 (동일)                         |
| **지원 기능 경계**             | 모호 (compose가 하는 것 + OpenLander가 파싱하는 것 혼재) | 명확 (OpenLander가 파싱하는 것 = 지원하는 것)   |
| **시스템 의존성**              | Docker + Compose V2                                      | Docker만                                        |
| **회귀 리스크**                | override hack 3개 유지                                   | hack 제거, 코드 감소                            |
| **MCP description**            | "compose 지원하는데 일부만" (설명 어려움)                | "이 필드들 지원" (명확)                         |
| **디버깅**                     | compose CLI 로그 + OpenLander 로그 이중 추적             | OpenLander 로그만                               |
| **Dockerfile 프로젝트와 통합** | 별도 파이프라인 (compose.ts vs deploy-core.ts)           | 동일 파이프라인 — build+run 로직 공유           |
| **버전 호환**                  | Compose V2.1.0+ 강제, 플래그 버전별 분기                 | Docker Engine API만 (항상 JSON, 버전 분기 없음) |

### 기술적 feasibility

**dockerode로 1:1 대체 가능한 것 (gap 없음):**

- `compose up --build` → `docker.buildImage()` + `docker.runContainer()`
- `compose stop/rm` → `docker.stopContainer()` + `docker.removeContainer()`
- `compose ps` → `docker.listAllContainers()` + label filter
- `compose logs` → `docker.getLogs()`

**OpenLander가 이미 직접 구현한 것 (compose CLI 없이도 동작):**

- YAML 파싱, Profile 필터링, Dependency 정렬 (Kahn's algorithm)
- Port 충돌 감지/해결, Env file 생성/주입, Health check, Traefik 네트워크 연결

**유일한 gap: 서비스 간 DNS**

- Compose는 자동으로 `http://backend:8000` 같은 서비스 간 통신 제공
- 하지만 이건 compose 마법이 아니라 **Docker 네트워크 기능** — 같은 network의 컨테이너는 container name으로 접근 가능
- OpenLander가 프로젝트별 네트워크 생성 (`client.createNetwork('ol-myproject')`) → 각 서비스 join → 동일 효과
- 이미 `web` 네트워크에 모든 컨테이너를 연결하고 있으므로 구조적으로 가능

### 전환 전략 (점진적)

```
Phase 1: compose.yml 파싱에 누락 필드 추가 (command, entrypoint, restart)
         → 지원 범위 확대, compose CLI 의존은 유지
Phase 2: dockerode로 build+run 경로 추가 (Dockerfile 프로젝트와 코드 공유)
         → 새 경로를 opt-in으로 테스트
Phase 3: compose CLI 호출을 dockerode로 하나씩 교체
         → override hack 하나씩 제거
Phase 4: compose CLI 의존성 완전 제거
         → checkComposeVersion() 삭제, override hack 전부 삭제
```

Phase 1-2만으로도 큰 개선. 사용자 compose.yml은 변화 없음.

### 수정 파일 (전체 전환 시)

- `src/pipeline/compose.ts` — CLI spawn 호출을 dockerode 호출로 교체
- `src/pipeline/docker.ts` — compose 서비스용 build/run 메서드 추가
- `src/pipeline/deploy-core.ts` — compose/dockerfile 프로젝트 파이프라인 통합
- 삭제 가능: override 관련 함수들 (`writeOverride`, `writeSecretOverride`, `touchMissingEnvFiles`)

---

## 추가 로드맵 아이디어 (피드백 기반)

### 단기 — 안정화

| 아이디어                           | 현 상태                                                                                                  | 판단                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| compose `container_name` 충돌 방어 | `compose down --remove-orphans` 호출하지만 에러 swallow. `forceCleanConflicts()`는 Dockerfile 프로젝트만 | 에러 swallow → `log.warn`으로 격상 + compose 프로젝트도 `forceCleanConflicts` 적용 |

### 중기 — 기능

| 아이디어                                           | 현 상태                                                                                                       | 판단                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Secret file → compose 마운트                       | **이미 구현** (`writeSecretOverride()`가 override.yml에 volume mount 주입)                                    | 추가 작업 불필요. dockerode 전환 시 직접 `Binds`로 대체되면 더 깔끔해짐        |
| Service Discovery (DB 감지 → 자동 생성 → URL 주입) | `create_deploy_plan`이 compose에서 postgres/redis 감지 + `PlanService` 생성. Dockerfile 프로젝트에서는 미지원 | Dockerfile 프로젝트에서도 코드 분석 기반 DB 감지 → 자동 provisioning 확장 가능 |
| Health check 기반 배포 상태                        | `waitForHealthy()` 존재. Docker inspect 기반 폴링                                                             | "컨테이너 떴지만 앱 크래시" 감지 정확도 개선 필요 — HTTP 200 체크 추가         |

### 장기 — 차별화

| 아이디어                            | 현 상태                                | 판단                                                                   |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| PR lifecycle (preview → production) | v0.2.6에서 PR preview deploy 이미 구현 | merge → production 자동은 webhook 확장으로 가능                        |
| OpenLander 스킬/프리셋              | MCP description 보강(#9)의 확장        | 에이전트에게 최적 배포 패턴을 주입하는 시스템 프롬프트 또는 skill 파일 |
| 웹 관제탑                           | MCP 세션 로그가 Web UI에 미노출        | MCP 호출 히스토리를 DB에 저장 → Web에서 타임라인 표시                  |

---

## 아키텍처 소감 (참고)

### 긍정적

- `deploy_configs` 스냅샷 — 18개 진입점을 한 곳으로 모은 것은 기술 부채를 제대로 갚은 것. 성공 배포마다 스냅샷 + 실패 시 fallback은 Heroku/Railway도 하는 패턴
- 에러 메시지 품질 — 3줄 "Docker build failed" → Docker step-by-step + 서비스별 원인 특정. 디버깅 가능성 차원이 다름
- 원격 Docker 구조 안정적 — Docker API over TCP/SSH 추상화 잘 됨

### 참고 사항

- env var 7단계 우선순위는 코드에 명시적이지만, 사용자 디버깅 관점에서 출처 표시 필요 → **#2에서 해결**
- 회귀 빈도 → **#8 (CI 테스트)로 해결**
- Compose 구조적 제약 → **#10 (dockerode 전환)으로 장기 해결**
