# Web Deploy → Agent 경유 — 스펙 v2

> **버전**: v0.1.0 보완 (Web MVP 설계 갭 해소)  
> **관련 결정**: DEC-022 (Web 배포 에이전트 경유)  
> **작성일**: 2026-03-05  
> **갱신일**: 2026-03-06  
> **상태**: 구현 완료 — 도그푸딩 대기

---

## 변경 이력

| 일자       | 변경              | 사유                                                  |
| ---------- | ----------------- | ----------------------------------------------------- |
| 2026-03-05 | v1 초안           | 에이전트 경유 미적용 문제 발견                        |
| 2026-03-06 | v2 리뷰 반영 완료 | Tech Lead 리뷰 9개 이슈 반영 (아래 §0 참조)           |
| 2026-03-06 | v2.1 동시성 변경  | 429 차단 → 배포 큐(순차 처리)로 변경 (Tech Lead 검증) |
| 2026-03-06 | v2.1 구현 완료    | 7개 태스크 구현, 테스트 657건 통과. 도그푸딩 대기     |

---

## 0. Tech Lead 리뷰 이슈 반영 요약

| #   | 이슈                                         | 대응                                                                                            |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | AS-IS 엔드포인트 오류 (`/deploy/start` 아님) | §1 수정 — `POST /api/projects/deploy` → `pipeline.deploy()` (blocking)로 정정                   |
| 2   | `debug_build_error` 자동 호출 불가           | §4.1 신규 — 자동 호출 제거. 빌드 실패 시 에이전트 메시지로 안내, "Fix with AI" 버튼 유지        |
| 3   | 동시성/세션 격리 불가                        | §3.4 신규 — 배포 큐 도입 (순차 처리). 세션 격리는 Phase 2                                       |
| 4   | 두 스트림 병합 전략 미정의                   | §4.2 신규 — 단일 SSE 스트림 방식 채택 (NDJSON 빌드 스트림 제거, 에이전트 SSE만 사용)            |
| 5   | `projectId` 추출 경로 미정의                 | §3.2 명시 — `tool_result` 이벤트의 `result.projectId`에서 추출                                  |
| 6   | Redeploy 버튼 미고려                         | §3.3 신규 — Redeploy도 에이전트 경유로 변경                                                     |
| 7   | 공수 과소추정 (4일 → 6-9일)                  | §6 수정 — 7일로 조정                                                                            |
| 8   | LLM 미호출 fallback 미정의                   | §5 수락기준 #8 — 5초 타임아웃 후 직접 배포 fallback. 프롬프트에 `deploy_project` 필수 패턴 포함 |
| 9   | `tool_call.arguments` 시크릿 노출            | §3.1 명시 — 프론트엔드에서 `arguments` 표시 시 `env_vars` 키 마스킹                             |

---

## 1. 문제 정의

### 현재 상태 (AS-IS)

Web UI "Deploy" 클릭 시:

```
NewProjectFlow.tsx:112  →  deployProject(repo.cloneUrl, ...)
  → web/src/lib/api.ts:8  →  POST /api/projects/deploy
    → routes.ts:394  →  ctx.pipeline.deploy({ ... })  // blocking, 직접 호출
```

**에이전트를 경유하지 않아 다음 기능이 Web 배포에서 동작하지 않음:**

| 기능                                 | TUI/MCP/Bot |            Web UI            |
| ------------------------------------ | :---------: | :--------------------------: |
| `deploy_project` 도구                |     ✅      |     ❌ (파이프라인 직접)     |
| `debug_build_error` (빌드 실패 분석) |     ✅      |              ❌              |
| Smart Defaults (이전 배포 기반 제안) |     ✅      |              ❌              |
| `ask_user_question` (배포 중 질문)   |     ✅      |              ❌              |
| 에이전트 활동 로그 (타임라인)        |     ✅      |   ❌ (파이프라인 이벤트만)   |
| 빌드 실패 시 자동 분석               |     ✅      | ❌ ("Fix with AI" 별도 세션) |

### 아키텍처 원칙 위반

```
requirements.md:
  접근 채널 (TUI / REST API / MCP / Bot)  ← Web도 여기
      ↓
  AI 에이전트                               ← Web만 이걸 건너뜀
      ↓
  파이프라인

web-mvp.md 한줄정의:
  "Agent handles everything in background."   ← 실제로는 안 함
```

### 근본 원인

v0.1.0 Web MVP 스펙 §3.1.4 New Project Flow에서 에이전트 경유 여부를 명시하지 않음. 구현 시 빠른 출시를 위해 파이프라인 직접 호출로 구현됨.

---

## 2. 목표 상태 (TO-BE)

Web UI "Deploy" 클릭 → 내부적으로 에이전트 `chatStream` 호출 → 에이전트가 `deploy_project` 도구 실행 → 파이프라인 → 타임라인에 에이전트 활동 표시.

```
[Web UI]
  사용자: "Deploy" 클릭 (repo=github.com/user/app, branch=main)
      ↓
[프론트엔드]
  POST /api/chat/stream { message: "Deploy {repo} branch {branch} as {name}" }
      ↓
[에이전트]
  의도 파악 → deploy_project(repo_url, branch, name) 도구 호출
      ↓
[파이프라인]
  clone → build → run → URL (결정론적, 기존과 동일)
      ↓
[타임라인]
  에이전트 SSE 이벤트(tool_call, tool_result, message, question) 표시
```

### 핵심 원칙 준수 확인

- **"LLM은 대화/해석/설명만"** ✅ — 사용자가 클릭으로 배포 결정. 에이전트는 실행 + 에러 분석.
- **"실행은 deterministic"** ✅ — 파이프라인은 변경 없음. 에이전트가 호출할 뿐.
- **"에이전트는 제안만 한다"** ✅ — 에이전트가 스스로 배포를 시작하지 않음. 사용자 클릭이 트리거.

---

## 3. 변경 범위

### 3.1 프론트엔드 변경

| 파일                                  | 변경                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `web/src/lib/api.ts`                  | `deployProject()` → `POST /api/chat/stream` 호출로 변경 (SSE 리턴)               |
| `web/src/pages/NewProjectFlow.tsx`    | `handleDeploy` → SSE 스트림 소비. `tool_result`에서 `projectId` 추출 후 이동     |
| `web/src/hooks/use-timeline.ts`       | 에이전트 SSE 이벤트를 타임라인 아이템으로 변환하는 로직 추가                     |
| `web/src/lib/event-types.ts`          | 에이전트 이벤트 타입 추가 (`agent_thinking`, `agent_tool_call`, `agent_message`) |
| `web/src/pages/ProjectDetailPage.tsx` | Redeploy 버튼 → 에이전트 경유로 변경 (§3.3)                                      |

**"Deploy" 클릭 시 전송할 메시지 형식:**

```
Deploy https://github.com/user/repo branch main as my-project
```

에이전트가 이 메시지에서 파라미터를 추출하여 `deploy_project` 도구를 호출.

**`tool_call.arguments` 표시 시 시크릿 마스킹 (이슈 #9):**

프론트엔드에서 `tool_call` 이벤트의 `arguments`를 타임라인에 표시할 때:

- `env_vars` 키의 값은 `***` 로 마스킹
- `ssh_key_path` 등 민감 경로는 `[redacted]` 표시
- 구현: `toTimelineItem()` 내 sanitize 함수 추가

### 3.2 `projectId` 추출 경로 (이슈 #5)

배포 후 프론트엔드가 `/projects/:id` 페이지로 이동하려면 `projectId`가 필요.

**현재** (직접 호출): `POST /api/projects/deploy` 응답에 `projectId` 포함.

**변경 후** (에이전트 경유): 에이전트 SSE 스트림의 `tool_result` 이벤트에서 추출.

```typescript
// use-chat.ts 또는 NewProjectFlow.tsx 내 SSE 핸들러
if (eventType === 'tool_result' && data.toolName === 'deploy_project' && data.success) {
  const projectId = data.result?.projectId;
  if (projectId) {
    navigate(`/projects/${projectId}`);
  }
}
```

`deploy_project` 도구의 `execute` 반환값 (`tools.ts:102`):

```typescript
return { ...result, hint: 'Use get_deploy_status to check progress.' };
// result = StartDeployResult { projectId, projectName, status }
```

→ `tool_result.result.projectId` 확정.

### 3.3 Redeploy 버튼 (이슈 #6)

**현재**: `POST /api/projects/:id/redeploy` → `pipeline.redeploy()` 직접 호출.

**변경**: Redeploy 버튼 클릭 시에도 에이전트 경유:

```
POST /api/chat/stream { message: "Redeploy project {projectName}" }
```

에이전트가 `deploy_project` (기존 프로젝트면 재배포) 또는 `restart_project` 호출.

**예외**: LLM 미설정 시 기존 `POST /api/projects/:id/redeploy` 직접 호출 fallback (§5 수락기준 #8).

### 3.4 동시성 제어 (이슈 #3)

**현재 문제점:**

- `Agent.history`가 전역 (`src/agent/index.ts:38`) — 동시 요청 시 대화 이력 충돌
- `QuestionBridge.pendingResolve`가 단일 (`src/agent/question-bridge.ts:52`) — 동시 질문 충돌
- `QuestionBridge.setQuestionHandler`가 매 호출 시 덮어쓰기 (`index.ts:168`) — 세션 A 질문이 세션 B 스트림으로 배달 가능

**v0.1.0 대응: 배포 큐 (순차 처리)**

에이전트의 전역 상태 문제를 우회하기 위해, 배포 요청을 큐에 넣고 순차적으로 처리한다.

```typescript
// src/agent/deploy-queue.ts (신규)
export class DeployQueue {
  private queue: Array<{ resolve: () => void; sessionId: string }> = [];
  private running = false;
  private readonly TIMEOUT_MS = 120_000; // 2분 하드 타임아웃 (stuck 방지)

  /** 큐에 추가. running이면 대기, 아니면 즉시 실행. */
  async enqueue(): Promise<void> { ... }

  /** 현재 대기 위치 반환 */
  getQueueLength(): number { return this.queue.length; }

  /** 현재 처리 중인지 */
  isRunning(): boolean { return this.running; }
}
```

**동작 흐름:**

1. 배포 요청 → `deployQueue.enqueue()` → "queued" 상태로 즉시 SSE 이벤트 전송
2. 큐 앞에 도달하면 → `chatStream` 호출 → 에이전트가 `deploy_project` 실행
3. 완료/실패 → 다음 큐 아이템 처리
4. job당 2분 하드 타임아웃 (stuck 방지)

**프론트엔드 UX:**

- 큐에 대기 중이면: `{ type: 'queued', position: 2, message: '2번째 대기 중입니다' }` SSE 이벤트
- 처리 시작 시: `{ type: 'thinking' }` SSE 이벤트 (기존과 동일)

**추가 변경: `reply` API에 `request_id` 연결 (Tech Lead 권고)**

현재 `routes.ts:1189`에서 `request_id`를 받지만 사용하지 않음. 이를 연결하여 Phase 2 확장 대비:

```typescript
// routes.ts: POST /api/question/reply
ctx.questionBridge.reply(body.request_id, body.answers.map(...));

// question-bridge.ts: reply 시그니처 변경
reply(requestId: string, answers: QuestionAnswer[]): void { ... }
```

v0.1.0에서는 내부적으로 requestId를 무시해도 되지만, API 계약은 맞춰둔다.

**Phase 2 (후속 버전)**: `Agent` 세션 격리 (`Map<sessionId, ChatMessage[]>`), `QuestionBridge` requestId 기반 멀티플렉싱, `setQuestionHandler` → 핸들러 Map 전환.

### 3.5 백엔드 변경

| 파일                           | 변경                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `src/web/api/routes.ts`        | `POST /api/projects/deploy` — LLM 설정 시 에이전트 경유, 미설정 시 기존 직접 호출 |
| `src/agent/index.ts`           | SSE 이벤트에 `timestamp` 필드 추가                                                |
| `src/agent/deploy-queue.ts`    | **신규** — 배포 큐 (순차 처리, 하드 타임아웃)                                     |
| `src/agent/question-bridge.ts` | `reply(requestId, answers)` 시그니처 변경 (API 계약 정리)                         |

**`POST /api/projects/deploy` 변경:**

```typescript
api.post('/projects/deploy', async (c) => {
  const body = await c.req.json<{ repo_url: string; branch?: string; name?: string; ... }>();

  // LLM 미설정 또는 에이전트 미생성 → 기존 직접 호출 (fallback)
  if (!ctx.agent) {
    const result = await ctx.pipeline.deploy({ ... });
    return c.json(result, result.success ? 200 : 500);
  }

  // 에이전트 경유: 큐에 넣고 순차 처리
  const message = `Deploy ${body.repo_url}${body.branch ? ` branch ${body.branch}` : ''}${body.name ? ` as ${body.name}` : ''}`;

  // 에이전트 경유: chatStream SSE로 변환
  const message = `Deploy ${body.repo_url}${body.branch ? ` branch ${body.branch}` : ''}${body.name ? ` as ${body.name}` : ''}`;
  const sessionId = nanoid(12);

  return streamSSE(c, async (s) => {
    let toolCallCount = 0;
    const timeout = setTimeout(async () => {
      // 5초 내 tool_call 없으면 직접 배포 fallback (이슈 #8)
      if (toolCallCount === 0) {
        const result = await ctx.pipeline.deploy({ ... });
        await s.writeSSE({ event: 'fallback', data: JSON.stringify(result) });
      }
    }, 3000);

    await ctx.agent.chatStream(
      message,
      async (event) => {
        if (event.type === 'tool_call') toolCallCount++;
        // timestamp 추가
        const eventWithTs = { ...event, timestamp: new Date().toISOString() };
        await s.writeSSE({ event: event.type, data: JSON.stringify(eventWithTs) });
      },
      sessionId,
    );

    clearTimeout(timeout);
  });
});
```

### 3.6 변경하지 않는 것

- `src/agent/tools.ts` — `deploy_project` 도구 그대로
- `src/pipeline/deploy.ts` — 파이프라인 로직 그대로
- `src/agent/question-bridge.ts` — `reply` 시그니처만 변경 (requestId 추가). 내부 로직은 Phase 2
- `POST /api/deploy/start` — 기존 fire-and-forget API 유지 (외부 통합용)

---

## 4. 타임라인 통합 (핵심)

### 4.1 빌드 실패 시 에이전트 동작 (이슈 #2)

**문제**: `deploy_project` 도구는 `startDeploy()` (fire-and-forget)를 호출. 에이전트는 빌드 완료/실패를 알 수 없으므로 `debug_build_error`를 자동 호출할 수 없음.

**해결: 자동 `debug_build_error` 호출을 제거하고, 기존 "Fix with AI" 경로를 유지**

```
[에이전트] 🛠️ Calling deploy_project(repo=..., branch=main)
[tool_result] { projectId: "abc", status: "building" }
[에이전트] 📝 배포가 시작되었습니다. 빌드 진행 상황은 타임라인에서 확인하세요.
```

빌드 실패 시:

- NDJSON 빌드 스트림 (`/api/projects/:id/build/stream`)의 `error` 이벤트로 실패 감지 (기존)
- 타임라인에 "Fix with AI" 버튼 표시 (기존 `debug-build` API 호출)
- 에이전트가 자동으로 실패를 분석하지는 않음

**Phase 2 계획** (후속 버전):

- `deploy_project` 도구를 `deploy()` (blocking) 호출로 변경하여 결과를 에이전트에게 반환
- 또는 EventBus `deploy:failed` 이벤트를 에이전트 컨텍스트에 주입하는 메커니즘 추가
- 이때 에이전트가 `debug_build_error`를 자동 호출 가능

### 4.2 스트림 전략 (이슈 #4)

**문제**: 에이전트 SSE와 NDJSON 빌드 스트림 두 개가 동시에 존재. 타임스탬프 형식 불일치, 중복 이벤트, 병합 순서 문제.

**해결: 이중 스트림 방식 (순차적)**

Deploy 과정에서 두 스트림을 다음과 같이 사용:

1. **Phase A — 에이전트 SSE** (`POST /api/chat/stream`):
   - `thinking` → `tool_call(deploy_project)` → `tool_result({ projectId, status: "building" })` → `message`
   - `tool_result`에서 `projectId`를 추출한 시점에서 Phase A 종료

2. **Phase B — 빌드 NDJSON** (`GET /api/projects/:id/build/stream`):
   - `projectId` 획득 후 자동으로 빌드 스트림 연결
   - `status(cloning)` → `status(building)` → `status(starting)` → `complete` or `error`

**프론트엔드 구현:**

```typescript
// NewProjectFlow.tsx
// Phase A: 에이전트 SSE 스트림
const sseResponse = await fetch('/api/chat/stream', { method: 'POST', body: ... });
// SSE 이벤트 소비... tool_result에서 projectId 획득

// Phase B: projectId 획득 후 빌드 스트림으로 전환
navigate(`/projects/${projectId}`);
// ProjectDetailPage에서 기존 useTimeline() 훅으로 빌드 스트림 소비
```

**장점:**

- 기존 빌드 스트림 코드 재사용 (타임라인, 진행률 바 등)
- 스트림 병합 로직 불필요
- 타임스탬프 불일치 문제 회피

**타임라인 표시:**

```
[agent]   🧠 Analyzing deploy request...        ← Phase A (에이전트 SSE)
[agent]   🛠️ deploy_project(repo=..., branch=main)
[agent]   ✅ Deploy started (projectId: abc123)
           --- 페이지 전환 → /projects/abc123 ---
[status]  Starting deployment...                  ← Phase B (기존 빌드 NDJSON)
[status]  Cloning repository (a1b2c3d)
[status]  Docker image built (38s)
[status]  Starting container on port 3000
[complete] Deploy complete — http://my-app.localhost
```

### 4.3 에이전트 SSE 이벤트에 timestamp 추가 (이슈 #4 보완)

현재 `Agent.chatStream` (`index.ts:332`)의 SSE 이벤트에는 `timestamp`가 없음.

**변경**: `onEvent` 콜백 호출 시 `timestamp` 필드를 추가:

```typescript
// routes.ts: POST /api/chat/stream 핸들러 내
await ctx.agent.chatStream(
  body.message,
  async (event) => {
    const eventWithTs = { ...event, timestamp: new Date().toISOString() };
    await s.writeSSE({ event: event.type, data: JSON.stringify(eventWithTs) });
  },
  sessionId,
);
```

→ `Agent` 클래스 자체는 변경하지 않음. 라우터 레벨에서 timestamp 주입.

---

## 5. 수락기준

- [ ] **AC-1**: Web UI "Deploy" 클릭 시 에이전트(`chatStream`)를 거쳐 `deploy_project` 도구가 호출됨 — 🔧 코드 완료, 🔲 도그푸딩
  - 검증: 브라우저 Network 탭에서 `POST /api/projects/deploy` 요청 → SSE 스트림, `tool_call(deploy_project)` 이벤트 확인
- [ ] **AC-2**: `tool_result` 이벤트에서 `projectId`를 추출하여 `/projects/:id` 페이지로 자동 이동 — 🔧 코드 완료, 🔲 도그푸딩
  - 검증: 배포 시작 후 ProjectDetailPage로 리다이렉트, URL에 올바른 projectId
- [ ] **AC-3**: ProjectDetailPage에서 기존 NDJSON 빌드 스트림으로 타임라인 표시 (기존 동작 유지) — 🔧 코드 완료, 🔲 도그푸딩
  - 검증: 타임라인에 clone → build → run → complete 이벤트 순서대로 표시
- [ ] **AC-4**: Smart Defaults가 Web 배포에서도 동작 — `ask_user_question` 이벤트가 렌더링됨 — 🔧 코드 완료, 🔲 도그푸딩
  - 검증: 이전에 배포한 적 있는 레포를 다시 배포 시 Smart Defaults 질문 카드 표시
- [ ] **AC-5**: `ask_user_question` 이벤트가 채팅 또는 타임라인 내 InputRequestCard로 렌더링됨 — 🔧 코드 완료, 🔲 도그푸딩
  - 검증: 에이전트가 질문하면 UI에 카드 표시, 답변 제출 시 에이전트 재개
- [x] **AC-6**: 기존 TUI/MCP/Bot 채널에 영향 없음 (회귀 없음) — ✅ 검증 완료
  - 검증: 전체 테스트 스위트 **657개 통과** (기존 643 + 신규 14), question-bridge reply 시그니처 변경 영향 없음
- [ ] **AC-7**: Redeploy 버튼도 에이전트 경유 — 🔧 코드 완료, 🔲 도그푸딩
  - 검증: ProjectDetailPage에서 Redeploy 클릭 시 에이전트 SSE 스트림 사용
- [x] **AC-8**: LLM 미설정 시 기존 `pipeline.deploy()` 직접 호출로 fallback — ✅ 검증 완료
  - 검증: `ctx.agent === null` 분기 테스트 통과 (`web-routes.test.ts`)
- [ ] **AC-9**: LLM이 5초 내 `deploy_project`를 호출하지 않으면 직접 배포 fallback — 🔧 코드 완료, 🔲 도그푸딩
  - 검증: LLM 응답 지연/환각 시 5초 후 자동으로 직접 배포 진행
- [x] **AC-10**: 동시 배포 요청 시 큐에 대기 → 순차 처리됨 — ✅ 검증 완료
  - 검증: `deploy-queue.test.ts` 5개 테스트 통과 (FIFO, 타임아웃, 이중 해제 안전성)
- [x] **AC-11**: `tool_call` 이벤트 표시 시 `env_vars` 값이 마스킹됨 — ✅ 검증 완료
  - 검증: `sanitize-tool-args.test.ts` 8개 테스트 통과 (env_vars→\*\*\*, ssh_key→[redacted])

---

## 6. 구현 순서 (제안)

| 순서 | 태스크                                                             | 기간  | 비고                    |
| ---- | ------------------------------------------------------------------ | ----- | ----------------------- |
| 1    | 배포 큐 (`deploy-queue.ts`) + `reply` requestId 연결               | 0.5일 | 백엔드 기반             |
| 2    | routes.ts 에이전트 경유 분기 + fallback + timestamp 주입           | 1일   | 백엔드 핵심             |
| 3    | NewProjectFlow: Deploy → SSE 스트림 + projectId 추출 + 페이지 이동 | 1.5일 | 프론트엔드 핵심         |
| 4    | ProjectDetailPage: Redeploy → 에이전트 경유                        | 0.5일 | 프론트엔드 보완         |
| 5    | 타임라인에 에이전트 이벤트 아이템 타입 추가 (Phase A 구간)         | 1일   | tool_call, message 매핑 |
| 6    | tool_call arguments 시크릿 마스킹                                  | 0.5일 | sanitize 함수           |
| 7    | 통합 테스트 + 도그푸딩                                             | 2일   | E2E 검증, 회귀 테스트   |

**총 공수**: ~7일

---

## 7. 리스크

| 리스크                                         | 확률 | 대응                                              |
| ---------------------------------------------- | ---- | ------------------------------------------------- |
| LLM 응답 지연으로 배포 시작이 느려짐           | 중간 | 5초 fallback 타임아웃 (AC-9)                      |
| LLM rate limit 초과 (무료 티어)                | 낮음 | fallback: 에이전트 없이 직접 배포 (AC-8)          |
| LLM이 `deploy_project` 호출 실패 (환각)        | 낮음 | 5초 fallback + 프롬프트에 deploy 패턴 명시 (AC-9) |
| 동시 배포 시 대기 시간                         | 중간 | 큐 대기 + position 표시로 UX 명확화 (AC-10)       |
| `tool_result` 형식 변경 시 projectId 추출 실패 | 낮음 | 타입 체크 + nullish 시 에러 메시지 표시           |

---

## 8. Phase 2 (후속 버전) 범위

v0.1.0에서 명시적으로 **하지 않는 것**:

1. **에이전트 세션 격리**: `Agent.history` → `Map<sessionId, ChatMessage[]>`, `refreshSystemPrompt`/`trimHistory` 세션별, per-session mutex
2. **`QuestionBridge` 멀티플렉싱**: `pendingResolve` → `Map<requestId, resolve>`, `setQuestionHandler` → 핸들러 Map (세션별 라우팅)
3. **`deploy_project` blocking 전환**: `startDeploy()` → `deploy()`로 변경, 빌드 결과를 에이전트에게 반환
4. **자동 `debug_build_error` 호출**: 빌드 실패 시 에이전트가 자동으로 분석 시작
5. **단일 통합 스트림**: 에이전트 SSE + 빌드 NDJSON을 하나의 스트림으로 통합

이들은 v0.1.0에서 에이전트 경유 기본 동작이 안정화된 이후에 진행.

---

## 9. 관련 문서

- `docs/planning/v0.1.0/web-mvp.md` — §3.1.4 New Project Flow (이 스펙으로 보완)
- `.opencode/skills/project-owner/references/decision-log.md` — DEC-022
- `.opencode/skills/project-owner/references/product-context.md` — 배포 파이프라인 플로우
- `docs/planning/archive/requirements.md` — 핵심 아키텍처 다이어그램
