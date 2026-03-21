# v0.0.8 — Vercel AI SDK 마이그레이션

> **버전**: v0.0.8 | **상태**: 구현 착수 | **버전 맵**: [`../version-map.md`](../version-map.md)
>
> **작성일**: 2026-02-27 (조사), **갱신일**: 2026-03-05 (구현 스펙으로 전환)
>
> **선행 완료**: v0.0.1~v0.0.12 전부 ✅ (정식 릴리즈 전 마지막 마일스톤)

---

## 개요

**한 줄 요약**: 자체 LLM 추상화(5개 프로바이더, ~990줄)를 Vercel AI SDK로 교체하여 유지보수 부담 제거 + 타입 안전성 강화.

**핵심 문제**: 현재 5개 프로바이더(`gemini.ts`, `anthropic.ts`, `openai.ts`, `openrouter.ts`, `ollama.ts`)가 각각 독립적으로 HTTP fetch, 메시지 변환, 도구 선언 변환, 응답 파싱을 구현. 프로바이더 추가/변경마다 ~200줄의 보일러플레이트 코드를 작성해야 함.

**해결 방법**: Vercel AI SDK (`ai` 패키지)의 `generateText`/`streamText` + Provider Registry로 통합. 도구 정의를 JSON Schema → Zod 스키마로 전환.

**사용자 영향**: 없음. 내부 리팩토링. 동일한 BYOK + 동일한 채팅 동작.

---

## 1. 현재 아키텍처 (AS-IS)

### LLM 추상화 (`src/llm/` — 6파일, 1,070줄)

| 파일            | 줄수 | 역할                                                          |
| --------------- | ---- | ------------------------------------------------------------- |
| `index.ts`      | 80   | `LLMClient` 인터페이스, `createLLMClient()` 팩토리, 공통 타입 |
| `gemini.ts`     | 191  | Google Gemini — REST API 직접 호출, 메시지/도구/응답 변환     |
| `anthropic.ts`  | 215  | Anthropic Claude — REST API 직접 호출                         |
| `openai.ts`     | 200  | OpenAI — REST API 직접 호출                                   |
| `openrouter.ts` | 193  | OpenRouter — OpenAI 호환 API                                  |
| `ollama.ts`     | 191  | Ollama — 로컬 REST API                                        |

### 에이전트 루프 (`src/agent/index.ts` — 413줄)

- `Agent.chat()`: 수동 for 루프 (MAX_TOOL_STEPS=10), 결과를 `[Tool Results]` 포맷 user 메시지로 주입
- `Agent.chatStream()`: 동일 루프 + `onEvent` 콜백으로 SSE 이벤트 발행
- 도구 실행: `executeTools()` — `Promise.all()`로 병렬 실행
- 히스토리 관리: 슬라이딩 윈도우 (MAX=40, KEEP=30)
- QuestionBridge: `ask_user_question` 도구 → `question` 이벤트 발행 → TUI/Web에서 응답 대기

### 도구 정의 (`src/agent/tools.ts` — 993줄, 31개 도구)

- 커스텀 `ToolDefinition` 인터페이스: `name`, `description`, `parameters: Record<string, ToolParameter>`, `execute`
- 파라미터: `{ type: 'string'|'number'|'boolean', description, required }`
- JSON Schema 형식이지만 커스텀 구조 (표준 JSON Schema도 아님)

### 스트리밍 (`src/web/api/routes.ts`)

- Hono `streamSSE()` → `Agent.chatStream()` → 이벤트별 `writeSSE({ event, data })`
- 이벤트 타입: `session`, `thinking`, `tool_call`, `tool_result`, `message`, `question`, `done`, `error`
- **토큰 레벨 스트리밍 없음** — LLM에서 전체 응답 받은 후 한 번에 `message` 이벤트 발행

### OAuth 토큰 (`src/llm/index.ts`)

- `LLMConfig.authToken?: string` — v0.0.12에서 추가
- `createLLMClient()`에서 `config.authToken ?? config.apiKey` 선택

---

## 2. 목표 아키텍처 (TO-BE)

### 새 LLM 추상화 (`src/llm/` — 1파일)

| 파일       | 역할                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| `index.ts` | `createProviderRegistry()` + `createModel()` 팩토리 + 공통 타입 재수출 |

5개 프로바이더 파일 **삭제**. SDK 프로바이더 패키지가 대체.

### 에이전트 루프 (`src/agent/index.ts`)

- `Agent.chat()`: `generateText({ model, tools, maxSteps: 10, ... })` 단일 호출
- `Agent.chatStream()`: `streamText({ model, tools, maxSteps: 10, ... })` + `onStepFinish` / `onChunk` 콜백
- **토큰 레벨 스트리밍 활성화** — 실시간 글자 표시

### 도구 정의 (`src/agent/tools.ts`)

- AI SDK `tool()` 헬퍼 + Zod 스키마
- `execute` 함수를 `tool()` 내부에 통합
- 타입 안전한 파라미터 (런타임 검증 포함)

### 스트리밍 (`src/web/api/routes.ts`)

- 기존 SSE 이벤트 프로토콜 유지 (프론트엔드 변경 최소화)
- `streamText`의 `textStream` / `fullStream`에서 이벤트 매핑

---

## 3. 변경 범위

### 파일 변경 매트릭스

| 영역               | 파일                                    | 작업   | 난이도   |
| ------------------ | --------------------------------------- | ------ | -------- |
| 프로바이더 삭제    | `src/llm/gemini.ts`                     | 삭제   | 쉬움     |
| 프로바이더 삭제    | `src/llm/anthropic.ts`                  | 삭제   | 쉬움     |
| 프로바이더 삭제    | `src/llm/openai.ts`                     | 삭제   | 쉬움     |
| 프로바이더 삭제    | `src/llm/openrouter.ts`                 | 삭제   | 쉬움     |
| 프로바이더 삭제    | `src/llm/ollama.ts`                     | 삭제   | 쉬움     |
| LLM 팩토리 교체    | `src/llm/index.ts`                      | 재작성 | 중간     |
| 도구 정의 변환     | `src/agent/tools.ts`                    | 재작성 | 중간     |
| 에이전트 루프 교체 | `src/agent/index.ts`                    | 재작성 | **높음** |
| 스트리밍 어댑터    | `src/web/api/routes.ts`                 | 수정   | 중간     |
| MCP 서버 도구 등록 | `src/mcp/server.ts`                     | 수정   | 낮음     |
| 도구 레지스트리    | `src/tools/registry.ts`                 | 수정   | 낮음     |
| 앱 초기화          | `src/app.ts` (또는 Agent 생성부)        | 수정   | 낮음     |
| 테스트             | `tests/llm/`, `tests/agent/`            | 재작성 | 중간     |
| **합계**           | **~15 파일** (삭제 5 + 수정 8 + 테스트) |        |          |

### 새 의존성

```
ai: ^5.x                          # 코어 (generateText, streamText, tool, createProviderRegistry)
@ai-sdk/google: ^1.x              # Gemini
@ai-sdk/anthropic: ^1.x           # Claude
@ai-sdk/openai: ^1.x              # OpenAI
@openrouter/ai-sdk-provider: ^0.x # OpenRouter (공식)
ollama-ai-provider-v2: ^1.x       # Ollama (커뮤니티, v2)
zod: ^3.x                         # 도구 파라미터 스키마
```

### 삭제 코드량

- 5개 프로바이더 파일: **990줄 삭제**
- Agent 수동 루프: **~150줄 삭제** (generateText/streamText로 대체)
- 커스텀 ToolDefinition 인터페이스: **~15줄 삭제**

---

## 4. 기능별 상세

### 8-1: Provider Registry 구현

**AS-IS**: `createLLMClient()` switch문 → 각 프로바이더 클래스 인스턴스화

**TO-BE**:

```typescript
import { createProviderRegistry } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOllama } from 'ollama-ai-provider-v2';

export function createModel(config: LLMConfig) {
  const apiKey = config.authToken ?? config.apiKey;

  switch (config.provider) {
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })(config.model ?? 'gemini-2.0-flash');
    case 'anthropic':
      return createAnthropic({ apiKey })(config.model ?? 'claude-sonnet-4-20250514');
    case 'openai':
      return createOpenAI({ apiKey })(config.model ?? 'gpt-4o');
    case 'openrouter':
      return createOpenRouter({ apiKey })(config.model ?? 'openrouter/free');
    case 'ollama':
      return createOllama({ baseURL: config.ollamaBaseUrl })(config.model ?? 'llama3.2');
  }
}
```

**수락기준**:

- [ ] `createModel(config)` 함수가 5개 프로바이더 모두 지원
- [ ] OAuth `authToken` 우선순위 유지 (`authToken ?? apiKey`)
- [ ] 기존 `LLMConfig` 타입 하위 호환 유지
- [ ] 5개 프로바이더 파일 삭제 완료
- [ ] `createLLMClient()` 폐기 (호출부 전부 `createModel()`로 교체: `app.ts`, `setup-routes.ts`, `auth-routes.ts`)
- [ ] `LLMClient` 타입 사용처 전부 AI SDK `LanguageModel`로 교체: `agent/index.ts`, `agent/debugger.ts`, `pipeline/auto-detect.ts`
- [ ] `src/index.ts` 퍼블릭 API 내보내기 업데이트 (`createLLMClient` → `createModel`, `LLMClient` → `LanguageModel`)

### 8-2: 도구 정의 Zod 변환

**AS-IS**: 31개 도구가 커스텀 `ToolDefinition` 형식 (JSON Schema 유사)

**TO-BE**: AI SDK `tool()` + Zod 스키마

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export function createTools(ctx: AppContext, questionBridge?: QuestionBridge) {
  return {
    deploy_project: tool({
      description: '...',
      parameters: z.object({
        repo_url: z.string().describe('Git repository URL'),
        branch: z.string().optional().describe('Branch to deploy'),
        name: z.string().optional().describe('Project name'),
      }),
      execute: async ({ repo_url, branch, name }) => {
        // 기존 execute 로직 그대로
      },
    }),
    // ... 30개 더
  };
}
```

**핵심 주의사항**:

- `ask_user_question` 도구: QuestionBridge를 통해 에이전트 루프를 일시정지하는 특수 도구. AI SDK `tool()` 내부 `execute`에서 Promise 대기 시 스텝이 완료되지 않으므로 루프가 자연 일시정지됨. (Tech Lead 검증 완료)
- `deploy_project` 도구: `questionBridge`를 통한 Smart Defaults 확인 플로우 포함 — execute 내부에서 동기적으로 QuestionBridge 대기.

**수락기준**:

- [ ] 31개 도구 전부 Zod 스키마 변환 완료
- [ ] 커스텀 `ToolDefinition`, `ToolParameter` 인터페이스 삭제
- [ ] 모든 `required` 필드 → `.describe()` + optional/required 정확히 반영
- [ ] `zod` 의존성 추가
- [ ] execute 함수의 기존 로직 100% 보존

### 8-3: Agent 루프 리팩토링

**AS-IS**: `Agent.chat()` / `Agent.chatStream()` — 수동 for 루프 (MAX_TOOL_STEPS=10)

**TO-BE**: `generateText()` / `streamText()` + `stopWhen: stepCountIs(10)` (AI SDK v5 API)

```typescript
// chat() — 비스트리밍
async chat(userMessage: string, sessionId?: string): Promise<AgentResponse> {
  await this.refreshSystemPrompt();
  this.history.push({ role: 'user', content: userMessage });

  const result = await generateText({
    model: this.model,
    messages: this.history,
    tools: this.tools,
    stopWhen: stepCountIs(10),
    onStepFinish: (step) => {
      // 히스토리/DB 저장 로직
    },
  });

  // result.text, result.toolCalls, result.toolResults 처리
}

// chatStream() — 스트리밍
async chatStream(userMessage: string, onEvent, sessionId?) {
  const result = streamText({
    model: this.model,
    messages: this.history,
    tools: this.tools,
    stopWhen: stepCountIs(10),
    onStepFinish: async (step) => {
      // tool_call, tool_result 이벤트 발행
    },
  });

  // result.textStream → message 이벤트 스트리밍
  // result.fullStream → 전체 이벤트 매핑
}
```

**핵심 과제 — QuestionBridge 통합**:

현재 `ask_user_question` 도구가 호출되면 에이전트 루프가 일시정지되고, 사용자 응답을 기다린 후 재개된다. AI SDK의 `stopWhen`에서도 `tool.execute()` 내부에서 Promise를 대기하면 자연스럽게 루프가 일시정지되므로, 기존 패턴이 그대로 작동한다. (검증 완료: execute는 async이므로 Promise resolve까지 스텝 미완료 → 루프 대기)

**수락기준**:

- [ ] `Agent.chat()` → `generateText()` 기반으로 교체
- [ ] `Agent.chatStream()` → `streamText()` 기반으로 교체
- [ ] 기존 `ChatStreamEvent` 타입 호환 (프론트엔드 변경 없이 작동)
- [ ] QuestionBridge 동작 검증 (ask_user_question → 일시정지 → 응답 → 재개)
- [ ] 히스토리 슬라이딩 윈도우 유지
- [ ] DB 저장 로직 유지
- [ ] `LLMClient` 인터페이스 제거 (AI SDK `LanguageModel`로 대체)

### 8-4: Web 스트리밍 어댑터

**AS-IS**: `routes.ts`에서 `streamSSE()` → `Agent.chatStream(onEvent)`

**TO-BE**: 동일한 SSE 프로토콜 유지, 내부만 AI SDK 연결 변경

**핵심 원칙**: 프론트엔드(`web/src/`) 변경 없음. 기존 SSE 이벤트 프로토콜 그대로 유지.

- `session` → 세션 ID
- `thinking` → LLM 처리 중
- `tool_call` → 도구 호출 시작
- `tool_result` → 도구 실행 결과
- `message` → 텍스트 응답 (토큰 단위 가능)
- `question` → 사용자 입력 요청
- `done` → 완료
- `error` → 에러

**토큰 레벨 스트리밍 업그레이드**:

기존에는 LLM이 전체 응답을 반환한 후 한 번에 `message` 이벤트를 보냈다. AI SDK `streamText()`로 교체하면 토큰 단위로 `message` 이벤트를 발행할 수 있다. 프론트엔드의 `use-chat-stream.ts`가 여러 `message` 이벤트를 연결하여 표시하는지 확인 필요.

**수락기준**:

- [ ] 프론트엔드 변경 없이 채팅 동작 정상
- [ ] SSE 이벤트 타입/형식 하위 호환
- [ ] 토큰 레벨 스트리밍 작동 확인 (선택적 — 프론트엔드 준비 안 되면 기존처럼 전체 응답 한 번에 전송)

---

## 5. 구현 순서

### Phase 1: 의존성 + Provider (8-1)

1. `bun add ai @ai-sdk/google @ai-sdk/anthropic @ai-sdk/openai @openrouter/ai-sdk-provider ollama-ai-provider-v2 zod`
2. `src/llm/index.ts` 재작성 — `createModel()` 팩토리
3. 기존 `LLMConfig`, `ChatMessage` 타입 유지 (하위 호환)
4. 5개 프로바이더 파일 삭제
5. 빌드 통과 확인

### Phase 2: 도구 변환 (8-2)

1. `src/agent/tools.ts` — 31개 도구 Zod 변환
2. 커스텀 `ToolDefinition` / `ToolParameter` 인터페이스 제거
3. 빌드 통과 확인

### Phase 3: Agent 루프 (8-3)

1. `src/agent/index.ts` — `generateText`/`streamText` 기반 재작성
2. QuestionBridge 통합 검증
3. 히스토리/DB 저장 로직 보존
4. 빌드 통과 확인

### Phase 4: 스트리밍 + 정리 (8-4)

1. `src/web/api/routes.ts` — 스트리밍 어댑터 수정
2. MCP 서버 (`src/mcp/server.ts`) 도구 등록 수정
3. 전체 빌드 (tsup + vite) 통과 확인
4. 테스트 실행 — 기존 테스트 수정/통과

---

## 6. 리스크

| 리스크                                      | 심각도  | 완화 방안                                                                        |
| ------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| QuestionBridge 일시정지가 maxSteps에서 불가 | 🔴 높음 | execute 내부 Promise 대기 방식 사전 검증. 안 되면 수동 루프 유지.                |
| Ollama 커뮤니티 프로바이더 불안정           | 🟡 중간 | `ollama-ai-provider-v2` 최신 버전 확인. 문제 시 `@ai-sdk/openai` 호환 모드 대체. |
| 토큰 스트리밍 → 프론트엔드 미지원           | 🟢 낮음 | 프론트엔드 변경 선택적. 기존처럼 전체 응답 한 번에 전송 fallback 가능.           |
| 31개 도구 Zod 변환 중 타입 불일치           | 🟡 중간 | 도구별 빌드 확인. `z.string()` / `z.number()` / `z.boolean()` 단순 매핑.         |
| AI SDK 버전 호환 (v5 vs v4)                 | 🟢 낮음 | 최신 안정 버전 사용. `createProviderRegistry` API 안정화 확인.                   |

---

## 7. 테스트 계획

### 자동 테스트

- 기존 LLM 프로바이더 단위 테스트 → 삭제 (프로바이더 파일 삭제에 따라)
- `createModel()` 팩토리 → 각 프로바이더별 모델 생성 테스트
- 도구 Zod 스키마 → 파라미터 파싱 정상 동작 테스트
- Agent 루프 → 모킹된 모델로 tool call → result → final text 흐름 테스트

### 수동 도그푸딩 체크리스트

- [ ] Gemini Flash로 "Deploy github.com/openlander-ai/demo-app" → 정상 배포
- [ ] 배포 중 Smart Defaults 확인 → QuestionBridge 팝업 작동
- [ ] "Show me the logs" → get_logs 도구 호출 → 로그 표시
- [ ] "Stop the project" → stop_project 도구 호출 → 컨테이너 중지
- [ ] Settings에서 프로바이더 변경 (Gemini → OpenAI 등) → 정상 전환
- [ ] OAuth 인증 프로바이더도 정상 동작 (v0.0.12 연동)

---

## 8. 의사결정 이력

| 결정                    | 내용                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| DEC-006 (2026-02)       | v0.0.8 연기: 사용자 가치 없는 내부 개선 → v0.0.9~v0.0.12 먼저                                 |
| DEC-021 (2026-03, 신규) | v0.0.8 착수: 정식 릴리즈 전 마지막 마일스톤. 프로바이더 유지보수 부담 해소 + Zod 타입 안전성. |
