# Codebase Guide — OpenLander 코드베이스 지식

## When to Load This Skill

백엔드/파이프라인/인프라 로직 구현 시 로드. 특히:

- 파이프라인 함수 추가/수정 (`src/pipeline/`)
- MCP 도구 추가 (`src/tools/defs/`)
- DB 스키마/쿼리 변경 (`src/db/`)
- 라우트 추가/수정 (`src/web/api/`)
- 테스트 작성 (`test/`)
- 기존 코드 패턴을 따라야 하는 모든 작업

**함께 로드**: `quality-gate` (필수)

---

## 코드 컨벤션 (MANDATORY)

### 언어 & 모듈

- TypeScript strict mode, ESM (`.js` 확장자 import)
- `as any`, `@ts-ignore`, `@ts-expect-error` → **절대 금지**
- 빈 catch `catch(e) {}` → **금지** (주석이라도)
- 기존 함수 시그니처 변경 금지 → 새 함수 추가

### 파일 배치

```
새 파이프라인 함수   → src/pipeline/[관련 파일].ts에 추가
새 MCP 도구          → src/tools/defs/[카테고리].ts에 추가, src/tools/defs/index.ts에 등록
새 라우트            → src/web/api/[도메인]-routes.ts (createXxxRoutes 팩토리 패턴)
새 DB 레포           → src/db/repos/[테이블].repo.ts, src/db/index.ts에 등록
새 에러 클래스       → src/errors.ts (OpenLanderError 상속)
새 이벤트            → src/events/index.ts에 타입 추가
새 프론트엔드 컴포넌트 → web/src/components/[도메인]/
새 API 함수          → web/src/lib/api/[도메인].ts
새 테스트            → test/[모듈명]/[파일명].test.ts
```

### MCP 도구 추가 시

- `src/tools/defs/[카테고리].ts`에 ToolDef 추가
- `src/tools/defs/index.ts`의 해당 카테고리 배열에 등록
- 필수 필드: `name`(snake_case), `description`, `inputSchema`(Zod), `execute`
- 선택 필드: `mcpDescription` (MCP 클라이언트용 상세 설명), `targets` (`'agent'` | `'mcp'`)
- **이름은 불변** — MCP 클라이언트가 캐싱하므로 한번 정하면 변경 금지
- MCP/AI SDK 어댑터에 자동 노출 (별도 작업 불필요)

### 라우트 추가 시

- Hono 웹 프레임워크 (Express 아님)
- 팩토리 패턴: `export function createXxxRoutes(ctx: AppContext): Hono`
- `src/web/server.ts`에서 `app.route('/api', createXxxRoutes(ctx))` 등록
- 에러는 `OpenLanderError` throw → 글로벌 핸들러가 JSON 직렬화

### 함수 추가 시

- **기존 모듈에 추가 우선** — 새 파일은 정말 필요할 때만
- export 함수는 JSDoc 주석 필수
- 기존 함수 패턴 복사 → 필터/반환 타입 수정 → 기존 함수는 건드리지 않음

---

## 핵심 아키텍처 참조

### 의존성 주입: AppContext

`src/app.ts`의 `AppContext` 인터페이스가 모든 모듈을 연결:

```typescript
// 패턴: 모든 서비스는 ctx를 통해 접근
function createProjectRoutes(ctx: AppContext): Hono { ... }
// ctx.db, ctx.docker, ctx.pipeline, ctx.traefik, ctx.agent 등
```

### 배포 파이프라인 (3단계)

```
createPlan(opts)  →  updatePlan(planId, updates)  →  executePlan(planId)
     ↓                       ↓                            ↓
  DeployPlan            Fill env vars,              Non-blocking 실행
  (ready or             select Dockerfile,          즉시 반환
   needs_input)         provision services          get_deploy_status로 폴링
```

**원칙**: LLM은 에러 분석/복구만. 배포 실행은 100% 결정론적 파이프라인.

### 에러 처리 패턴

```typescript
// src/errors.ts — 모든 에러는 OpenLanderError 상속
class OpenLanderError extends Error {
  readonly code: string; // 'GIT_CLONE_FAILED' 등
  readonly statusCode: number; // HTTP 상태 코드
  readonly details?: Record<string, unknown>;
  toJSON(): Record<string, unknown>;
}
```

20+ 구체적 에러 클래스: `GitCloneError`, `DockerBuildError`, `ProjectNotFoundError` 등.

### 데이터베이스 패턴

```typescript
// Drizzle ORM + SQLite, Repository 패턴
// 스키마: src/db/schema.drizzle.ts
// 레포: src/db/repos/*.repo.ts
// 접근: ctx.db.projects.findById(id)
```

### 채널 구조

| 채널          | 위치                | 비고                   |
| ------------- | ------------------- | ---------------------- |
| Web Dashboard | `web/src/`          | React 19 + Vite        |
| REST API      | `src/web/api/`      | Hono 라우트            |
| MCP           | `src/mcp/server.ts` | 60+ 도구 노출          |
| Bot           | `src/channels/`     | Slack/Discord/Telegram |

**새 기능 추가 시**: 어떤 채널에 영향을 주는지 확인.

---

## 위임 프롬프트 구조

하위 에이전트에게 위임할 때 **반드시** 포함:

```
1. TASK: 정확히 무엇을 하는가 (한 문장)
2. FILES: 수정할 파일 경로 (정확히)
3. ACCEPTANCE: 수락기준
4. PATTERN: 기존 코드에서 참고할 패턴/파일
5. DO NOT: 하지 말 것
6. VERIFY: 완료 후 확인할 것 (build, test, diagnostics)
```

---

## 참조 문서

| 문서                           | 내용                          |
| ------------------------------ | ----------------------------- |
| `AGENTS.md`                    | 아키텍처, 디렉토리 구조, 패턴 |
| `docs/planning/version-map.md` | 전체 버전/스펙/상태 매핑      |
| `.opencode/instructions.md`    | 프로젝트 개발 규칙            |

---

## 금지 사항

- 스펙에 없는 기능 추가 (제안은 가능, 직접 구현 금지)
- 기존 함수 시그니처 변경 (하위 호환 깨짐)
- DB 스키마 변경 (명시되지 않은 한)
- MCP 도구 이름 변경 (클라이언트 캐시 깨짐)
- 테스트 삭제 (실패하면 고쳐야 함)
- `quality-gate` 스킬 없이 위임
