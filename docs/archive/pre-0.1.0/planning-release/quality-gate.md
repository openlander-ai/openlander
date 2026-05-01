# 정식 릴리즈 — 품질 게이트 스펙

> **작성일**: 2026-03-07
> **목적**: v0.2.0 이후 정식 릴리즈 전 반드시 통과해야 할 3가지 구조적 품질 항목 정의
> **배경**: 도그푸딩에서 SSH+토큰 충돌, compose 이벤트 미연결, 스트림 조기 종료 등 모듈 간 통합 버그가 반복 발견됨. 단위 테스트 665개 통과해도 이런 통합 버그를 못 잡는 구조적 한계.

---

## Q-1: E2E 시나리오 테스트

### 목표

핵심 배포 플로우를 수동 체크리스트 또는 통합 테스트로 검증. 매 릴리즈 전 전수 확인.

### 배포 진입점 (Entry Points)

| #   | 진입점          | 경로                                                                 | 비고                          |
| --- | --------------- | -------------------------------------------------------------------- | ----------------------------- |
| E1  | Web UI Deploy   | `POST /api/projects/deploy` → agent.chatStream → deploy_project tool | 주 사용 경로                  |
| E2  | Web UI Redeploy | `POST /api/projects/:id/redeploy`                                    | 기존 프로젝트 재배포          |
| E3  | Agent tool      | `deploy_project` in `src/agent/tools.ts`                             | 에이전트 자체 판단 시         |
| E4  | MCP tool        | `deploy_project` in `src/mcp/server.ts`                              | 외부 코딩 에이전트(Cursor 등) |
| E5  | Webhook         | `POST /api/webhooks/:projectId/{github\|gitlab\|bitbucket}`          | git push 자동 재배포          |
| E6  | Auto-Recovery   | `app.ts` eventBus.on('deploy:failed'/'compose:failed')               | 실패 후 자동 복구             |

### 배포 변형 (Deploy Variants)

| #   | 변형            | 파이프라인 경로                                            | 주요 이벤트                                                |
| --- | --------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| V1  | 단일 Dockerfile | clone → build → run → expose                               | deploy:start → clone → build → run → success               |
| V2  | docker-compose  | clone → detectCompose → deployCompose                      | deploy:start → clone → compose:start → compose:up          |
| V3  | Auto-Dockerfile | clone → autoDetect → generateDockerfile → build → run      | deploy:start → clone → auto-detect → build → run → success |
| V4  | Monorepo        | clone → scanDockerfiles → parallel child deploys           | deploy:start per child                                     |
| V5  | Blue-Green      | clone → build → run new → health check → swap → remove old | deploy:start → build → run → success                       |
| V6  | Preview         | clone → build → run (branch-specific)                      | deploy:start → success                                     |

### E2E 테스트 시나리오 (수동 체크리스트)

#### 시나리오 1: Public Repo + Dockerfile (V1, E1)

- **사전조건**: Dockerfile 있는 public repo (e.g. `traefik/whoami`)
- **절차**:
  1. Web UI에서 `https://github.com/traefik/whoami` 입력 → Deploy
  2. Timeline에서 clone → build → run → success 이벤트 순서 확인
  3. 프로젝트 상태 `running` 확인
  4. 할당된 URL 접속 확인
- **기대결과**: 프로젝트 running, URL 응답 200
- **확인방법**: `curl <project-url>` → 200 OK

#### 시나리오 2: Private Repo + SSH Key (V1, E1)

- **사전조건**: SSH 키 설정 완료, private repo
- **절차**:
  1. Web UI에서 private repo URL 입력 → Deploy
  2. git clone이 SSH URL로 변환되어 클론 성공 확인
  3. Timeline에서 전체 플로우 완료 확인
- **기대결과**: 프로젝트 running
- **확인방법**: `GET /api/projects/:id` → status: running

#### 시나리오 3: Private Repo + GitHub Token (V1, E1)

- **사전조건**: SSH 키 없음, GitHub OAuth 토큰 설정됨, private repo
- **절차**:
  1. SSH 키 경로 일시 제거
  2. Web UI에서 private repo 배포
  3. HTTPS + token injection으로 클론 성공 확인
- **기대결과**: 프로젝트 running
- **확인방법**: `GET /api/projects/:id` → status: running

#### 시나리오 4: Compose Deploy + Auto-Recovery (V2 + E6)

- **사전조건**: compose 프로젝트 (e.g. `summary-god`), env vars 미설정
- **절차**:
  1. Web UI에서 compose 프로젝트 배포
  2. env 누락으로 실패 확인
  3. 자동 복구 트리거 확인 (Timeline에 "AI is working on it..." 표시)
  4. 에이전트 질문 카드 표시 확인
  5. KEY=VALUE 입력 → 에이전트가 set_env_vars → deploy_project 호출
  6. 재배포 성공 확인
- **기대결과**: 프로젝트 running, env vars 설정됨
- **확인방법**: `GET /api/projects/:id` → status: running, envVars populated

#### 시나리오 5: Dockerfile Fix Loop (V1, E1)

- **사전조건**: 빌드 실패하는 Dockerfile이 있는 repo (또는 테스트용 repo)
- **절차**:
  1. 배포 시작
  2. 빌드 실패 → BuildRecovery classify → tier 2.5 (autoFixable)
  3. `fixDockerfile` 호출 → `build:dockerfile-fixed` 이벤트
  4. 수정된 Dockerfile로 재빌드 → 성공
- **기대결과**: 자동 수정 후 프로젝트 running
- **확인방법**: deploy log에 `build:dockerfile-fixed` 기록 확인

#### 시나리오 6: Webhook Auto-Redeploy (V1, E5)

- **사전조건**: 이미 배포된 프로젝트, GitHub webhook 설정
- **절차**:
  1. repo에 push
  2. webhook 수신 확인
  3. 자동 재배포 실행 확인
  4. 새 commit SHA 반영 확인
- **기대결과**: 최신 코드로 재배포 완료
- **확인방법**: deploy log에 새 commit SHA 기록

#### 시나리오 7: MCP Deploy (V1, E4)

- **사전조건**: MCP 클라이언트 연결 가능
- **절차**:
  1. MCP `deploy_project` tool 호출
  2. 배포 완료 확인
- **기대결과**: 프로젝트 running
- **확인방법**: MCP tool 응답 + `GET /api/projects/:id` → running

### 구현 방향

- **Phase 1**: 수동 체크리스트 (위 시나리오) — 릴리즈 전 수동 실행
- **Phase 2**: API 기반 자동화 테스트 (`vitest` + `fetch`) — CI/CD 통합
- **우선순위**: 시나리오 1, 2, 4 먼저 (가장 자주 사용되는 경로)

---

## Q-2: 이벤트 배선 검증

### 목표

EventBus의 모든 emit이 대응하는 subscriber를 가지는지 프로그래밍적으로 검증. 새 이벤트 추가 시 web 연결 누락 방지.

### 현재 이벤트 매핑 (2026-03-07 기준)

#### EMIT 목록

| 이벤트                   | 소스 파일                            | 라인          |
| ------------------------ | ------------------------------------ | ------------- |
| `deploy:start`           | deploy.ts, blue-green.ts             | 231, 98       |
| `deploy:clone`           | deploy.ts                            | 270           |
| `deploy:auto-detect`     | deploy.ts                            | 318           |
| `deploy:build`           | deploy.ts, blue-green.ts             | 347, 115      |
| `deploy:run`             | deploy.ts, blue-green.ts             | 373, 137      |
| `deploy:success`         | deploy.ts, blue-green.ts, preview.ts | 448, 171, 129 |
| `deploy:crash`           | deploy.ts                            | 402           |
| `deploy:failed`          | deploy.ts, blue-green.ts             | 600, 191      |
| `deploy:rollback`        | deploy.ts                            | 856           |
| `build:inform`           | deploy.ts                            | 520, 580      |
| `build:dockerfile-fixed` | deploy.ts                            | 546           |
| `build:suggest`          | deploy.ts                            | 572           |
| `container:stop`         | deploy.ts                            | 914           |
| `container:remove`       | deploy.ts                            | 938           |
| `container:start`        | routes.ts                            | 358           |
| `tunnel:url`             | deploy.ts                            | 952           |
| `agent:event`            | app.ts, routes.ts                    | 193/211, 473  |
| `question:pending`       | question-bridge.ts                   | 91            |
| `question:answered`      | question-bridge.ts                   | 116           |

#### SUBSCRIBE 목록 (routes.ts + app.ts)

| 이벤트                   | 구독 위치                          | 비고                   |
| ------------------------ | ---------------------------------- | ---------------------- |
| `deploy:start`           | routes.ts:242,648 / app.ts:134     | ✅ 매칭                |
| `deploy:clone`           | routes.ts:249,655                  | ✅ 매칭                |
| `deploy:build`           | routes.ts:256,666                  | ✅ 매칭                |
| `deploy:run`             | routes.ts:263,677                  | ✅ 매칭                |
| `deploy:success`         | routes.ts:270,688 / app.ts:137     | ✅ 매칭                |
| `deploy:failed`          | routes.ts:278,736 / app.ts:140,224 | ✅ 매칭                |
| `compose:up`             | routes.ts:170,806                  | ✅ 매칭                |
| `compose:failed`         | routes.ts:173,819 / app.ts:231     | ✅ 매칭                |
| `compose:start`          | routes.ts:795                      | ✅ 매칭                |
| `build:autofix`          | routes.ts:749                      | ⚠️ emit 미확인 (동적?) |
| `build:suggest`          | routes.ts:760                      | ✅ 매칭                |
| `build:inform`           | routes.ts:771                      | ✅ 매칭                |
| `build:dockerfile-fixed` | routes.ts:783                      | ✅ 매칭                |
| `agent:event`            | routes.ts:831                      | ✅ 매칭                |
| `question:pending`       | routes.ts:872                      | ✅ 매칭                |

#### 갭 분석

| 이벤트                  | 상태                                                     | 조치                                        |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------- |
| `deploy:auto-detect`    | emit O, subscribe X                                      | 🟡 web에 표시 안 됨 — 정보성, 낮은 우선순위 |
| `deploy:crash`          | emit O, subscribe X                                      | 🔴 크래시 이벤트 web 미표시 — 확인 필요     |
| `deploy:rollback`       | emit O, subscribe X                                      | 🟡 롤백 이벤트 web 미표시                   |
| `container:stop`        | emit O, subscribe X                                      | 🟡 정보성                                   |
| `container:remove`      | emit O, subscribe X                                      | 🟡 정보성                                   |
| `container:start`       | routes에서 emit, subscribe 없음                          | 🟡 내부 트리거용                            |
| `tunnel:url`            | emit O, subscribe X                                      | 🟡 URL 할당 이벤트 미표시                   |
| `question:answered`     | emit O, subscribe X                                      | 🟡 내부 bridge용                            |
| `build:autofix`         | subscribe O, emit 미확인                                 | ⚠️ dead subscriber 또는 동적 emit           |
| `compose:start/up/down` | subscribe O, emit 소스 미확인 (compose.ts에서 emit 추정) | ⚠️ 확인 필요                                |

### 테스트 구현

```typescript
// test/event-wiring.test.ts
import { describe, it, expect } from 'vitest';

// 소스에서 추출한 이벤트 목록
const EMITTED_EVENTS = [
  'deploy:start',
  'deploy:clone',
  'deploy:auto-detect',
  'deploy:build',
  'deploy:run',
  'deploy:success',
  'deploy:crash',
  'deploy:failed',
  'deploy:rollback',
  'build:inform',
  'build:dockerfile-fixed',
  'build:suggest',
  'container:stop',
  'container:remove',
  'container:start',
  'tunnel:url',
  'agent:event',
  'question:pending',
  'question:answered',
] as const;

const SUBSCRIBED_EVENTS = [
  'deploy:start',
  'deploy:clone',
  'deploy:build',
  'deploy:run',
  'deploy:success',
  'deploy:failed',
  'compose:start',
  'compose:up',
  'compose:failed',
  'build:autofix',
  'build:suggest',
  'build:inform',
  'build:dockerfile-fixed',
  'agent:event',
  'question:pending',
] as const;

// 의도적으로 web에서 구독하지 않는 이벤트 (내부용)
const INTERNAL_ONLY = [
  'question:answered', // bridge 내부 통신
  'container:start', // 내부 트리거
] as const;

// web 표시가 필요하지만 현재 누락된 이벤트 → 확인 필요
const KNOWN_GAPS = [
  'deploy:auto-detect', // 정보성, 낮은 우선순위
  'deploy:crash', // 🔴 크래시는 표시해야 할 수 있음
  'deploy:rollback', // 롤백 상태 표시
  'container:stop', // 정보성
  'container:remove', // 정보성
  'tunnel:url', // URL 할당 표시
] as const;

describe('Event Wiring', () => {
  it('every emitted event should have a subscriber or be explicitly internal', () => {
    const subscribed = new Set(SUBSCRIBED_EVENTS);
    const internal = new Set(INTERNAL_ONLY);
    const knownGaps = new Set(KNOWN_GAPS);

    for (const event of EMITTED_EVENTS) {
      const isHandled = subscribed.has(event) || internal.has(event) || knownGaps.has(event);
      expect(
        isHandled,
        `Event "${event}" is emitted but has no subscriber and is not in allowlist`,
      ).toBe(true);
    }
  });

  it('every subscriber should have a matching emit source', () => {
    const emitted = new Set(EMITTED_EVENTS);
    // compose events are emitted from compose.ts (need separate verification)
    const COMPOSE_EVENTS = ['compose:start', 'compose:up', 'compose:failed'];
    const DYNAMIC_EVENTS = ['build:autofix']; // verify emit source

    for (const event of SUBSCRIBED_EVENTS) {
      if (COMPOSE_EVENTS.includes(event) || DYNAMIC_EVENTS.includes(event)) continue;
      expect(emitted.has(event), `Subscriber for "${event}" but no emit found`).toBe(true);
    }
  });
});
```

### 구현 방향

1. 위 테스트 파일을 `test/event-wiring.test.ts`로 생성
2. compose.ts에서 emit하는 이벤트 확인하여 EMITTED_EVENTS에 추가
3. `build:autofix` emit 소스 확인 — dead subscriber면 제거
4. `deploy:crash` web 표시 여부 결정 (PM 판단)

---

## Q-3: Config 조합 매트릭스 테스트

### 목표

`cloneRepo()`의 SSH 키/토큰/URL 타입 조합을 체계적으로 테스트. 유사한 config 분기가 있는 모듈에도 적용.

### 클론 분기 로직 (`src/pipeline/git.ts`)

```
cloneRepo(options)
  ├─ normalizeRepoUrl(url) → HTTPS prefix 보정
  ├─ if sshKeyPath && url.startsWith('http')
  │   └─ toSshUrl(url) → SSH URL로 변환 (github/gitlab/bitbucket만)
  ├─ if !sshKeyPath && url.includes('github.com') && token exists
  │   └─ https://x-access-token:<token>@github.com/... 주입
  ├─ git clone 시도 (depth, branch 옵션)
  ├─ if 실패 && auth-like error && URL이 HTTPS
  │   └─ SSH fallback: toSshUrl → GIT_SSH_COMMAND 재시도
  └─ 에러 분류: GitAuthError / GitBranchNotFoundError / GitRepoNotFoundError / GitCloneError
```

### 테스트 매트릭스

| #   | SSH Key | Token | URL Type            | 예상 동작                     | 예상 결과                       |
| --- | ------- | ----- | ------------------- | ----------------------------- | ------------------------------- |
| C1  | ✅      | ✅    | HTTPS github        | SSH 변환 (SSH 우선)           | SSH clone 성공                  |
| C2  | ✅      | ✅    | SSH github          | SSH 그대로 사용               | SSH clone 성공                  |
| C3  | ✅      | ❌    | HTTPS github        | SSH 변환                      | SSH clone 성공                  |
| C4  | ✅      | ❌    | SSH github          | SSH 그대로 사용               | SSH clone 성공                  |
| C5  | ❌      | ✅    | HTTPS github        | Token injection               | HTTPS+token clone 성공          |
| C6  | ❌      | ✅    | SSH github          | SSH 그대로 (token 미사용)     | SSH clone 시도 → 키 없으면 실패 |
| C7  | ❌      | ❌    | HTTPS public        | 인증 없이 clone               | 성공 (public repo)              |
| C8  | ❌      | ❌    | HTTPS private       | 인증 실패 → SSH fallback 시도 | GitAuthError                    |
| C9  | ❌      | ❌    | SSH github          | SSH 시도 (키 없음)            | GitAuthError                    |
| C10 | ✅      | ❌    | HTTPS gitlab        | SSH 변환 (gitlab 지원)        | SSH clone 성공                  |
| C11 | ❌      | ✅    | HTTPS gitlab        | Token 미주입 (github만)       | 인증 없이 시도 → 실패           |
| C12 | —       | —     | `owner/repo` (bare) | normalizeRepoUrl → HTTPS 변환 | C5~C9 중 해당 케이스로          |

### 파이프라인 분기 매트릭스

| #   | 조건                                        | 분기                              | 테스트 포인트        |
| --- | ------------------------------------------- | --------------------------------- | -------------------- |
| P1  | compose 파일 존재                           | → composePipeline.deployCompose   | compose 감지 정확성  |
| P2  | compose 파일 없음 + Dockerfile 존재         | → 표준 build → run                | Dockerfile 경로 감지 |
| P3  | compose 없음 + Dockerfile 없음              | → autoDetect → generateDockerfile | 자동 생성 정확성     |
| P4  | compose + env_file 참조 + .env.example 존재 | → 자동 env 파일 생성              | env template 파싱    |
| P5  | compose + env_file 참조 + .env.example 없음 | → 빈 env 파일 생성                | 빈 파일 생성 확인    |
| P6  | 빌드 실패 + tier 2.5 (autoFixable)          | → fixDockerfile → 재빌드          | Dockerfile 수정 루프 |
| P7  | 빌드 실패 + tier 1 (recipe match)           | → attemptTier1Fix                 | 레시피 기반 수정     |
| P8  | Quick Share visibility                      | → TryCloudflare tunnel            | tunnel URL 생성      |

### 테스트 구현

```typescript
// test/clone-matrix.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Clone Config Matrix', () => {
  // Mock git operations, config loading
  // Test each C1-C12 scenario

  describe('SSH Key + Token priority', () => {
    it('C1: SSH key takes priority over token for HTTPS GitHub URL', () => {
      // sshKeyPath=set, token=set, url=https://github.com/...
      // Expected: URL converted to git@github.com:..., token NOT injected
    });

    it('C5: Token injected when no SSH key for HTTPS GitHub URL', () => {
      // sshKeyPath=null, token=set, url=https://github.com/...
      // Expected: URL becomes https://x-access-token:<token>@github.com/...
    });

    it('C8: Auth failure with no credentials for private HTTPS repo', () => {
      // sshKeyPath=null, token=null, url=https://github.com/private/repo
      // Expected: clone fails → SSH fallback → GitAuthError
    });

    it('C11: GitLab token NOT injected (GitHub only)', () => {
      // sshKeyPath=null, token=set, url=https://gitlab.com/...
      // Expected: no token injection, plain HTTPS clone
    });
  });
});
```

### 구현 방향

1. `test/clone-matrix.test.ts` — cloneRepo unit tests with mocked git
2. `test/pipeline-branch.test.ts` — compose/Dockerfile detection 분기 테스트
3. 기존 `cloneRepo` 함수의 git 호출을 mockable하게 리팩토링 필요할 수 있음

---

## 구현 우선순위

| 순서 | 항목                      | 공수            | 이유                            |
| ---- | ------------------------- | --------------- | ------------------------------- |
| 1    | Q-2 이벤트 배선 테스트    | 반나절          | 가장 작은 공수, 즉시 CI 효과    |
| 2    | Q-3 Clone 매트릭스 테스트 | 반나절~1일      | 반복 발견된 SSH/token 버그 방지 |
| 3    | Q-1 E2E 수동 체크리스트   | 1일 (수동 실행) | QA 진행과 병행 가능             |
| 4    | Q-1 E2E 자동화            | 1~2일           | Phase 2, CI 통합 시             |

---

## 수락기준

- [ ] Q-2: `test/event-wiring.test.ts` 통과, 갭 이벤트 처리 방향 결정
- [ ] Q-3: `test/clone-matrix.test.ts` 통과, C1~C12 중 최소 핵심 8개 커버
- [ ] Q-1: 시나리오 1, 2, 4 수동 실행 완료 + 결과 기록
- [ ] 전체 `npm test` 통과
