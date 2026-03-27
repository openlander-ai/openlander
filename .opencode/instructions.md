# OpenLander — Project Instructions

> 이 파일은 매 세션 자동 로드됨. 모든 작업에 적용되는 필수 규칙.

## 0. 위임 라우팅 (MANDATORY)

각 category는 해당 도메인 최적 모델로 라우팅된다.

### 제품 관점

- 기획 시: "유저에게 마법의 순간이 있는가? 제품 정체성과 충돌하지 않는가?"
- 기술적 검증: "기존 패턴과 일관성 있는가? 사이드 이펙트는 없는가?"
- 제품 컨텍스트: `docs/planning/context/` 참조

### Category + Skill 조합

| 작업 유형                | category           | load_skills                        |
| ------------------------ | ------------------ | ---------------------------------- |
| UI/UX, 프론트엔드        | visual-engineering | ["quality-gate"]                   |
| 백엔드, 파이프라인, 로직 | deep               | ["codebase-guide", "quality-gate"] |
| 단순 수정, 타입 수정     | quick              | ["quality-gate"]                   |
| 5줄 이내 trivial         | 직접               | —                                  |

## 1. 작업 시작 전 (MANDATORY)

- `docs/planning/version-map.md`를 읽고 현재 버전/진행 상태 파악
- 관련 릴리즈 문서 확인: `docs/planning/release/v1.0.0-roadmap.md`
- `AGENTS.md`에서 해당 모듈의 아키텍처/패턴 확인

## 2. 구현 중

- `lsp_diagnostics` 수시 확인 (변경 파일)
- `as any`, `@ts-ignore`, `@ts-expect-error` 금지
- 빈 catch 블록 `catch(e) {}` 금지 (최소한 주석이라도)
- 기존 코드 스타일 따르기:
  - 백엔드: `.js` 확장자 import (ESM), AppContext 패턴, Hono 라우트 팩토리
  - 프론트엔드: `cn()` 클래스 머저, `t()` i18n, `fetchWithAuth()` API 호출
  - 테스트: `test/` 디렉토리, Vitest, `.js` 확장자 import

## 3. 구현 후 검증 (하나라도 빠지면 미완료)

```
□ lsp_diagnostics: 변경 파일 전부 에러 0
□ npm run build: 성공 (exit code 0)
□ npm test: 전체 통과 (0 failures)
□ 테스트 존재: 새 기능/로직에 대응하는 테스트 코드가 있는지 확인
□ i18n: 사용자 노출 문자열에 t() 사용, en.ts + ko.ts 둘 다 업데이트
```

## 4. 완료 처리 (즉시, 배치 금지)

- todo 항목 즉시 `completed`로 변경
- **다음 작업으로 넘어가기 전에** 반드시 업데이트

## 5. 태스크 위임 시

- `load_skills=["quality-gate"]` **필수** (백엔드 작업이면 `codebase-guide`도 함께)
- 프롬프트에 **수락기준 전문** 포함
- 위임 결과 받으면 수락기준 1:1 검증 후 승인/반려

## 6. 빼먹기 방지 체크리스트

구현 완료 후 스스로에게 묻기:

```
1. 관련 모듈에 영향 주는 부분을 다 처리했나? (routes, tools, DB, frontend)
2. i18n 문자열을 en.ts/ko.ts 둘 다 추가했나?
3. 에러 처리가 OpenLanderError 패턴을 따르나?
4. MCP 도구에 영향이 있으면 mcpDescription도 업데이트했나?
5. _agent_guidance 필드를 건드리지 않았나?
```

## 7. 프론트엔드 작업 시

- React 19 + Tailwind CSS v3 + Radix UI 기반. `web/src/` 하위.
- 컴포넌트: shadcn/ui 스타일, CVA variants, `cn()` 클래스 머저
- 상태: React Context + custom hooks only (외부 라이브러리 금지)
- 데이터: native `fetch` + `fetchWithAuth()` + polling hooks (react-query/SWR 금지)
- 스타일: Tailwind utility classes, CSS variables (`web/src/index.css`)
- 라우팅: React Router 7 (`web/src/App.tsx`)

## 8. 백엔드 작업 시

- Hono 웹 프레임워크 (Express 아님). `src/web/` 하위.
- 라우트: `createXxxRoutes(ctx: AppContext): Hono` 팩토리 패턴
- DB: Drizzle ORM + SQLite. Repository 패턴 (`src/db/repos/*.repo.ts`)
- 에러: `OpenLanderError` 상속 (`src/errors.ts`). `code` + `statusCode` + `details`
- 도구: `ToolDef` 인터페이스 (`src/tools/defs/types.ts`). snake_case 이름 불변.
- 이벤트: `EventBus` (`src/events/index.ts`). 40+ 이벤트 타입.

## 9. 커밋 규칙

- 유저가 명시적으로 요청할 때만 커밋
- `.env`, credentials 등 시크릿 파일 커밋 금지
- pre-commit hook 실패 시 amend 하지 말고 새 커밋
- Conventional Commits: `feat(web):`, `fix(pipeline):`, `refactor(mcp):`, `test:`

## 10. 문서 체계 참조

```
docs/planning/
├── version-map.md              # SSOT — 전체 버전/스펙/상태 매핑
├── dev-lifecycle.md            # 개발 라이프사이클
├── quality-gate-coverage.md    # 품질 게이트 커버리지
├── release-checklist.md        # 릴리즈 체크리스트
├── v1-architecture-decision.md # v1 아키텍처 결정
│
├── context/                    # 제품 컨텍스트
│   ├── product-context.md
│   ├── architecture.md
│   ├── competitive.md
│   └── decision-log.md
│
├── release/                    # v1.0.0 릴리즈 문서
│   ├── v1.0.0-roadmap.md
│   ├── v1.0.0-web-ui-vision.md
│   ├── v1.0.0-ai-copilot.md
│   └── quality-gate.md
│
└── archive/                    # 과거 버전 아카이브 (v0.0.6 ~ v0.2.6)
```
