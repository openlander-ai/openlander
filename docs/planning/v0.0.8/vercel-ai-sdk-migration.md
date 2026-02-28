# T-INFRA-03: Vercel AI SDK 마이그레이션 조사

> **버전**: v0.0.8 | **상태**: 조사 완료, 구현 미착수 | **버전 맵**: [`version-map.md`](version-map.md)

> 상태: 조사 완료 | 작성일: 2026-02-27

## 1. 현재 아키텍처

### LLM 추상화 (`src/llm/`)

| 파일            | 역할                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `index.ts`      | `LLMClient` 인터페이스, `createLLMClient()` 팩토리, `ChatMessage`/`LLMResponse`/`ToolCall` 타입 |
| `gemini.ts`     | Google Gemini 프로바이더 (REST API, `generativelanguage.googleapis.com`)                        |
| `anthropic.ts`  | Anthropic Claude 프로바이더 (`api.anthropic.com`)                                               |
| `openai.ts`     | OpenAI 프로바이더 (`api.openai.com`)                                                            |
| `openrouter.ts` | OpenRouter 프로바이더 (`openrouter.ai`)                                                         |
| `ollama.ts`     | Ollama 로컬 프로바이더 (`localhost:11434`)                                                      |

### 핵심 인터페이스

```typescript
interface LLMClient {
  chat(messages: ChatMessage[]): Promise<LLMResponse>;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
```

### 에이전트 루프 (`src/agent/`)

- `Agent.chat()` → LLM 호출 → tool call 감지 → 도구 실행 → 결과 피드백 → 반복
- 도구 정의: `src/agent/tools.ts` — 각 도구는 `name`, `description`, `parameters` (JSON Schema) 형식
- 스트리밍: `src/web/api/routes.ts`에서 SSE 스트림 (커스텀 구현)
- BYOK 모델: 사용자가 API 키를 직접 설정 (Gemini 무료 티어, OpenRouter 무료 모델 지원)

## 2. Vercel AI SDK 매핑

### 패키지 구조

| 현재 코드                  | Vercel AI SDK 등가물                      | 패키지                                   |
| -------------------------- | ----------------------------------------- | ---------------------------------------- |
| `GeminiProvider`           | `createGoogleGenerativeAI()`              | `@ai-sdk/google`                         |
| `AnthropicProvider`        | `createAnthropic()`                       | `@ai-sdk/anthropic`                      |
| `OpenAIProvider`           | `createOpenAI()`                          | `@ai-sdk/openai`                         |
| `OllamaProvider`           | `ollama()`                                | `ollama-ai-provider` (커뮤니티)          |
| `OpenRouterProvider`       | `openrouter()`                            | `@openrouter/ai-sdk-provider` (커뮤니티) |
| `createLLMClient()` 팩토리 | `createProviderRegistry()`                | `ai` (코어)                              |
| `LLMClient.chat()`         | `generateText()`                          | `ai` (코어)                              |
| 커스텀 SSE 스트리밍        | `streamText()` + `toDataStreamResponse()` | `ai` (코어)                              |
| JSON Schema 도구 정의      | Zod 스키마 + `tool()` 헬퍼                | `ai` (코어)                              |
| 수동 도구 실행 루프        | `maxSteps` 파라미터 (자동 루프)           | `ai` (코어)                              |

### 도구 정의 변환 예시

**현재:**

```typescript
{
  name: 'deploy_project',
  description: 'Deploy a project from a git repository',
  parameters: {
    type: 'object',
    properties: {
      repo_url: { type: 'string', description: '...' },
      branch: { type: 'string', description: '...' },
    },
    required: ['repo_url'],
  },
}
```

**Vercel AI SDK:**

```typescript
import { tool } from 'ai';
import { z } from 'zod';

tools: {
  deploy_project: tool({
    description: 'Deploy a project from a git repository',
    parameters: z.object({
      repo_url: z.string().describe('...'),
      branch: z.string().optional().describe('...'),
    }),
    execute: async ({ repo_url, branch }) => {
      return pipeline.startDeploy({ repoUrl: repo_url, branch });
    },
  }),
}
```

### 프로바이더 레지스트리

```typescript
import { experimental_createProviderRegistry as createProviderRegistry } from 'ai';

const registry = createProviderRegistry({
  google: createGoogleGenerativeAI({ apiKey: config.geminiKey }),
  anthropic: createAnthropic({ apiKey: config.anthropicKey }),
  openai: createOpenAI({ apiKey: config.openaiKey }),
  ollama: ollama,
  openrouter: openrouter,
});

// 사용
const result = await generateText({
  model: registry.languageModel('google:gemini-2.0-flash'),
  tools: { ... },
  maxSteps: 10,
  prompt: '...',
});
```

## 3. 마이그레이션 영향 분석

### 변경 범위

| 영역                | 파일 수      | 난이도   | 설명                                                                        |
| ------------------- | ------------ | -------- | --------------------------------------------------------------------------- |
| LLM 프로바이더 삭제 | 5            | 쉬움     | `gemini.ts`, `anthropic.ts`, `openai.ts`, `openrouter.ts`, `ollama.ts` 삭제 |
| LLM 인덱스 교체     | 1            | 중간     | `index.ts` → 레지스트리 패턴으로 전환                                       |
| 도구 정의 변환      | 1            | 중간     | JSON Schema → Zod 스키마 변환 (약 20개 도구)                                |
| 에이전트 루프       | 1            | **높음** | 수동 루프 → `maxSteps` 자동 루프로 전환. 가장 큰 변경점.                    |
| 스트리밍            | 1            | 중간     | 커스텀 SSE → `streamText().toDataStreamResponse()`                          |
| 테스트              | 3+           | 중간     | LLM 프로바이더 테스트 재작성, 도구 호출 테스트 수정                         |
| **합계**            | **~12 파일** |          |                                                                             |

### 새 의존성

```
ai: ^4.x              # 코어 (generateText, streamText, tool)
@ai-sdk/google: ^1.x  # Gemini
@ai-sdk/anthropic: ^1.x # Claude
@ai-sdk/openai: ^1.x  # OpenAI / OpenRouter 가능
ollama-ai-provider     # Ollama (커뮤니티)
@openrouter/ai-sdk-provider  # OpenRouter (공식)
zod: ^3.x              # 도구 파라미터 스키마
```

## 4. 리스크

| 리스크                   | 심각도  | 설명                                                                                                     |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| Ollama 프로바이더 안정성 | 🟡 중간 | 커뮤니티 유지보수. 공식 지원 아님.                                                                       |
| `maxSteps` 제어 부족     | 🟡 중간 | 현재 수동 루프에서 단계별 로깅/이벤트 발행 가능. `maxSteps`는 내부 루프라 중간 단계 커스터마이징 어려움. |
| 번들 사이즈 증가         | 🟢 낮음 | Vercel AI SDK + 5개 프로바이더 패키지. 서버사이드라 큰 문제 아님.                                        |
| BYOK 호환성              | 🟢 낮음 | Vercel AI SDK도 API 키 직접 설정 지원. 문제 없음.                                                        |
| 스트리밍 프로토콜 변경   | 🟡 중간 | Data Stream Protocol은 TUI 클라이언트 측 파서 수정 필요.                                                 |

## 5. 권장사항

### 결론: **마이그레이션 권장, 단 v0.0.7 이후**

**장점:**

- 프로바이더별 코드 ~1200줄 삭제 가능
- 도구 호출 타입 안전성 향상 (Zod)
- 새 프로바이더 추가 시 패키지 설치만으로 가능
- 스트리밍 구현 단순화

**단점:**

- 에이전트 루프 재작성 필요 (가장 큰 비용)
- 도구 20개의 파라미터를 Zod로 변환 필요
- 테스트 전면 재작성

### 우선순위

1. v0.0.6 기능 완성 후 마이그레이션 착수
2. 먼저 `zod` 도입하여 도구 스키마를 점진적 변환
3. 에이전트 루프를 `maxSteps` 호환 구조로 리팩토링
4. 프로바이더를 하나씩 교체 (Gemini → Anthropic → OpenAI → Ollama → OpenRouter)

### 예상 소요 시간: 2-3일 (풀타임 기준)
