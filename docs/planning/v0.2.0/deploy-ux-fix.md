# v0.2.0 배포 UX 수정 — 통합 스펙

> **관련 버그**: BUG-014 (blocking), BUG-015 (major), BUG-016 (major), BUG-017 (minor)
> **작성일**: 2026-03-07
> **상태**: PM 작성 → Tech Lead 구현 대기

---

## 0. 요약

4개 버그의 공통 근본 원인: **2-phase SSE→NDJSON 구조**와 **pre-project agent 실행**.

해결 방향: **Project-First 이벤트 모델** — 프로젝트를 먼저 생성하고, 모든 이벤트(에이전트 + 파이프라인 + 질문)를 project-scoped로 통합.

---

## 1. 현재 문제 (AS-IS)

```
NewProjectFlow "Deploy 클릭"
  → POST /api/projects/deploy (SSE stream 시작)
    → agent.chatStream("Deploy https://...")
      → 에이전트: ask_user_question ← ⚠️ projectId 없음, UI 없음 → 멈춤
      → 에이전트: deploy_project → pipeline.startDeploy()
        → projectId 생성 (여기서야 비로소!)
          → deploy:start 이벤트 → questionBridge.setActiveProject(projectId)
    → tool_result에서 projectId 추출
  → navigate('/projects/:id')
    → build/stream 연결 (NDJSON)
      → 파이프라인 이벤트만 보임 (에이전트 이벤트 없음)
      → running이면 "Already running" 한 줄만 보이고 종료
```

**문제 정리:**

1. `ask_user_question`이 `deploy_project` 이전에 호출되면 projectId 없음 → question:pending 미발행 → UI 없음 → 무한 대기
2. 에이전트 SSE 이벤트는 NewProjectFlow에서 flat text로만 표시
3. build/stream은 파이프라인 이벤트만 전달, 에이전트 이벤트 없음
4. running 상태면 "Already running" 한 줄로 즉시 종료

---

## 2. 목표 상태 (TO-BE)

```
NewProjectFlow "Deploy 클릭"
  → POST /api/projects/deploy
    → 프로젝트 row 즉시 생성 (projectId 확보)
    → questionBridge.setActiveProject(projectId)
    → JSON 응답: { projectId, projectName }
  → navigate('/projects/:id') ← 즉시 redirect
    → build/stream 연결
      → 에이전트 이벤트 (thinking, tool_call, question_pending, tool_result, message)
      → 파이프라인 이벤트 (cloning, building, starting, complete)
      → 질문 카드 렌더링 (InputRequestCard — 기존 동작)
      → running 상태면 마지막 배포 히스토리 표시
```

**핵심 변경: deploy 엔드포인트가 SSE 스트림이 아닌 JSON을 반환하고, 모든 실시간 이벤트는 build/stream으로 통합.**

---

## 3. Phase 1: BUG-014 수정 — ask_user_question 멈춤 (blocking)

### 3.1 백엔드 변경

#### `POST /api/projects/deploy` (routes.ts:391-535)

**변경**: SSE 스트림 → JSON 응답. 프로젝트를 먼저 생성하고 에이전트를 백그라운드로 실행.

```
AS-IS: SSE stream (agent.chatStream 전체를 스트리밍)
TO-BE: JSON { projectId, projectName, status: "building" }
       + 에이전트를 백그라운드로 fire-and-forget
```

**구현 방향:**

1. `pipeline.startDeploy()` 호출 대신, 프로젝트 row만 먼저 생성 (DB insert)
2. `questionBridge.setActiveProject(projectId)` 호출
3. `agent.chatStream(message, onEvent, sessionId)` 를 fire-and-forget으로 실행
4. 에이전트의 onEvent 콜백에서 이벤트를 EventBus로 브로드캐스트 → build/stream이 수신
5. JSON 응답으로 `{ projectId, projectName, status: "building" }` 반환

**중요**: 5초 fallback 타이머(AC-9) 유지. 에이전트가 deploy_project 호출 안 하면 직접 배포.

**새 EventBus 이벤트 (에이전트 활동 브로드캐스트):**

```typescript
'agent:event' → { projectId: string, event: ChatStreamEvent & { timestamp: string } }
```

agent.chatStream의 onEvent 콜백에서 이 이벤트를 emit.

#### `GET /api/projects/:id/build/stream` (routes.ts:559+)

**변경**: 에이전트 이벤트도 수신하여 NDJSON으로 전달.

추가 구독:

```typescript
eventBus.on('agent:event', (payload) => {
  if (payload.projectId !== project.id) return;
  const item = mapAgentEventToNDJSON(payload.event);
  if (item) write(item);
});
```

에이전트 이벤트 → NDJSON 매핑:

- `thinking` → `{ type: 'status', message: 'Agent is analyzing...' }`
- `tool_call` → `{ type: 'status', message: 'Calling {toolName}...' }` (+ question_pending은 기존 핸들러가 처리)
- `tool_result` → `{ type: 'status', message: '{toolName} completed' }`
- `message` → `{ type: 'status', message: event.content }`

### 3.2 프론트엔드 변경

#### `web/src/lib/api.ts` — `deployProject()`

**변경**: SSE 스트림 소비 → 단순 JSON fetch + redirect.

```typescript
// AS-IS: SSE stream 소비, projectId 추출, onEvent 콜백
// TO-BE:
export async function deployProject(
  repoUrl: string,
  branch?: string,
  name?: string,
): Promise<DeployResult> {
  const res = await fetch('/api/projects/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: repoUrl, branch, name }),
  });
  return res.json();
}
```

`onEvent` 콜백 파라미터 제거. SSE 소비 로직 전부 제거.

#### `web/src/pages/NewProjectFlow.tsx`

**변경**: SSE 이벤트 핸들링 제거. deploy → JSON 응답 → 즉시 navigate.

```typescript
const handleDeploy = async (repo: GitRepo) => {
  setDeploying(true);
  setDeployStatus('Starting deployment...');
  try {
    const result = await deployProject(repo.cloneUrl, repo.defaultBranch, repo.name);
    if (result.projectId) {
      navigate(`/projects/${result.projectId}`);
    } else {
      setError(result.error ?? 'Deploy failed');
      setDeploying(false);
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Deploy failed');
    setDeploying(false);
  }
};
```

`deployStatus` 상태는 단순화 가능 — "Starting deployment..." 한 줄이면 됨. 이후 모든 진행 상황은 ProjectDetail 타임라인에서 표시.

### 3.3 수락기준

- [ ] **P1-AC-1**: Deploy 클릭 → JSON 응답에 projectId 포함 → 즉시 /projects/:id로 이동
- [ ] **P1-AC-2**: /projects/:id 타임라인에 에이전트 이벤트 표시 (thinking, tool_call, message)
- [ ] **P1-AC-3**: ask_user_question 호출 시 타임라인에 InputRequestCard 렌더링 → 사용자 답변 가능 → 에이전트 재개
- [ ] **P1-AC-4**: LLM 미설정 시 기존 직접 배포 fallback 유지
- [ ] **P1-AC-5**: 5초 내 deploy_project 미호출 시 직접 배포 fallback 유지
- [ ] **P1-AC-6**: 기존 테스트 통과 (0 regression)
- [ ] **P1-AC-7**: Redeploy 버튼도 동일 흐름 적용 (에이전트 경유, 기존 프로젝트)

### 3.4 변경하지 않는 것

- `src/agent/tools.ts` — ask_user_question 도구 그대로
- `src/agent/question-bridge.ts` — 기존 로직 유지 (setActiveProject 타이밍만 변경)
- `src/pipeline/deploy.ts` — 파이프라인 로직 그대로
- `web/src/components/timeline/InputRequestCard.tsx` — 기존 질문 카드 그대로
- TUI/MCP/Bot 채널 — 영향 없음

---

## 4. Phase 2: BUG-015 + BUG-016 — 에이전트 스트리밍 + 타임라인 히스토리

> Phase 1 완료 후 진행. Phase 1에서 에이전트 이벤트가 build/stream으로 전달되면, 여기선 **표현의 풍부함**과 **히스토리 persist**에 집중.

### 4.1 에이전트 이벤트 타임라인 카드 (BUG-015)

Phase 1에서 에이전트 이벤트를 `status` 타입으로 매핑했다면, Phase 2에서는 전용 타입으로 렌더링:

- `agent_thinking` → "🧠 Analyzing..." 접힌 카드 (펼치면 thinking 내용)
- `agent_tool_call` → "🛠️ Calling deploy_project" 카드 (arguments 표시, env_vars 마스킹)
- `agent_message` → 에이전트 메시지 카드

**변경 파일:**

- `web/src/lib/event-types.ts` — BuildStreamEvent에 에이전트 타입 추가 (`agent_thinking`, `agent_tool_call`, `agent_message`)
- `web/src/lib/event-types.ts:toTimelineItem()` — 에이전트 이벤트 → TimelineItem 매핑 추가
- `web/src/components/timeline/TimelineItem.tsx` — 에이전트 카드 렌더링 추가
- 백엔드 `routes.ts` build/stream — 에이전트 이벤트를 전용 타입으로 전달 (Phase 1의 `status` 매핑 대신)

**NOTE**: `agentEventToTimelineItem()` 함수가 이미 존재 (dead code). 이를 활용.

### 4.2 타임라인 히스토리 (BUG-016)

running 상태에서도 마지막 배포 정보를 보여준다.

**변경:**

- 백엔드 `routes.ts`의 `fresh.status === 'running'` 분기:
  - `deploy_logs` 테이블에서 마지막 배포 로그 조회
  - 히스토리 이벤트 burst 전송
  - 마지막에 `{ type: 'complete', message: 'Currently running (deployed Xm ago)' }` 전송
- error/stopped 상태도 마찬가지로 마지막 배포 히스토리 표시

### 4.3 수락기준

- [ ] **P2-AC-1**: 배포 타임라인에 에이전트 thinking/tool_call/message 카드가 구분되어 표시
- [ ] **P2-AC-2**: tool_call 카드에 arguments 표시, env_vars는 마스킹
- [ ] **P2-AC-3**: running 프로젝트 타임라인에 마지막 배포 히스토리 표시
- [ ] **P2-AC-4**: error/stopped 프로젝트도 마지막 배포 히스토리 표시
- [ ] **P2-AC-5**: 기존 테스트 통과

---

## 5. Phase 3: BUG-017 — 로그 미니 패널 (optional)

타임라인 탭 내에 접을 수 있는 "Live Logs" 미니 패널 추가.

- 배포 중: 기본 열림
- idle: 기본 접힘
- 클릭으로 Logs 탭 전환

### 수락기준

- [ ] **P3-AC-1**: 타임라인 탭 하단에 접을 수 있는 로그 패널 존재
- [ ] **P3-AC-2**: 배포 중 자동 열림
- [ ] **P3-AC-3**: 프로젝트 running 시 접힌 상태

---

## 6. 실행 순서

| Phase | 대상       | 공수    | 선행 |
| ----- | ---------- | ------- | ---- |
| 1     | BUG-014    | 2~4일   | 없음 |
| 2     | BUG-015+16 | 2~4일   | P1   |
| 3     | BUG-017    | 0.5~1일 | 없음 |

---

## 7. 리스크

| 리스크                                    | 확률 | 대응                                      |
| ----------------------------------------- | ---- | ----------------------------------------- |
| 에이전트가 프로젝트 생성 전에 실패        | 낮음 | DB에서 orphan project 정리 로직 추가 검토 |
| fire-and-forget 에이전트 에러 누락        | 중간 | onEvent에서 error 이벤트도 EventBus 전달  |
| deploy_logs 구조가 에이전트 이벤트 부적합 | 중간 | Phase 2에서 별도 테이블 또는 JSON 칼럼    |
