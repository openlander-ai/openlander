# OpenCode vs OpenLander — 상세 비교 분석

> **작성일**: 2026-02-26  
> **대상**: anomalyco/opencode (v1.2.14, ★111k) vs OpenLander (v0.1.0)  
> **목적**: OpenCode의 아키텍처/패턴에서 OpenLander에 적용 가능한 요소 식별

---

## 1. 프로젝트 개요 비교

| 항목               | OpenCode                                 | OpenLander                                  |
| ------------------ | ---------------------------------------- | ------------------------------------------- |
| **목적**           | AI 코딩 어시스턴트 (코드 읽기/쓰기/편집) | AI 배포 에이전트 (repo → Docker → URL)      |
| **GitHub Stars**   | 111k                                     | Early stage                                 |
| **Contributors**   | 773명                                    | 소규모 팀                                   |
| **언어**           | TypeScript 51.6%, MDX 44.1%, Rust 0.6%   | TypeScript 100%                             |
| **런타임**         | Bun                                      | Node.js >= 22                               |
| **패키지 매니저**  | Bun workspace (monorepo)                 | npm (single package)                        |
| **라이선스**       | MIT                                      | MIT                                         |
| **TUI 프레임워크** | @opentui/solid (SolidJS 기반)            | Ink (React 기반) → @opentui/solid 전환 계획 |
| **데이터베이스**   | SQLite (Drizzle ORM)                     | SQLite (Drizzle ORM) ✅ 동일                |
| **HTTP 서버**      | Hono                                     | Hono ✅ 동일                                |
| **AI SDK**         | Vercel AI SDK                            | 직접 구현 (provider별 클래스)               |
| **설치 방식**      | curl, npm, brew, scoop, nix 등 다채널    | npm global                                  |
| **릴리즈 수**      | 724 releases                             | Pre-release                                 |

### 핵심 차이점

**OpenCode** = "코드를 작성하는 AI" — 파일 읽기/쓰기/편집, bash 실행, 코드 검색  
**OpenLander** = "앱을 배포하는 AI" — git clone → docker build → traefik routing → URL 제공

두 프로젝트는 **동일한 기술 스택** (TypeScript, SQLite/Drizzle, Hono, TUI)을 공유하지만 **도메인이 완전히 다름**. 이것이 비교 분석의 가치가 있는 이유 — 인프라 패턴을 직접 차용 가능.

---

## 2. 아키텍처 비교

### 2.1 전체 구조

```
OpenCode (Monorepo — Bun Workspace)
├── packages/opencode/      ← 핵심 CLI/TUI + 백엔드 서버
├── packages/sdk/js/         ← TypeScript SDK (OpenAPI 자동생성)
├── packages/app/            ← SolidJS 공유 앱 컴포넌트
├── packages/desktop/        ← Tauri 데스크톱 앱
├── packages/web/            ← Astro 문서 사이트
├── packages/ui/             ← 공유 UI 컴포넌트 라이브러리
├── packages/plugin/         ← 플러그인 SDK
├── packages/console/        ← 팀 관리 콘솔 (SolidJS + Drizzle + Stripe)
├── sdks/vscode/             ← VS Code 확장
├── infra/                   ← SST 인프라
└── nix/                     ← Nix 빌드 시스템
```

```
OpenLander (Single Package)
└── src/
    ├── agent/       ← AI 에이전트 (프롬프트, 레시피, 디버거)
    ├── cli/         ← CLI 진입점
    ├── config/      ← 설정 관리
    ├── db/          ← SQLite/Drizzle
    ├── events/      ← 이벤트 시스템
    ├── llm/         ← LLM 프로바이더 (Anthropic, Gemini, OpenAI, Ollama, OpenRouter)
    ├── mcp/         ← MCP 서버
    ├── pipeline/    ← 배포 파이프라인 (Docker, Git, Traefik, Cloudflare, etc.)
    ├── tools/       ← 도구 레지스트리
    ├── tui/         ← Ink TUI
    ├── web/         ← REST API
    ├── channels/    ← Slack/Discord/Telegram 봇
    ├── monitor/     ← 컨테이너 모니터링
    ├── webhook/     ← Git webhook 처리
    └── ipc/         ← IPC 통신
```

### 2.2 Client-Server 아키텍처

#### OpenCode: 완전한 Client-Server 분리

```
[TUI] ──┐
[Desktop]──┤                 ┌──────────┐
[VS Code] ──┼── SDK (HTTP) ──→│ Hono 서버 │──→ Session/LLM/Tools
[Web App] ──┤                 └──────────┘
[Console]──┘                      ↑
                            SSE 이벤트 스트림
```

- **SDK 패키지**: OpenAPI spec에서 자동 생성된 type-safe 클라이언트
- **SSE (Server-Sent Events)**: 40+ 이벤트 타입으로 실시간 상태 동기화
- **Instance Scoping**: 디렉토리별 독립 DB/설정/프로바이더 상태
- **Multi-client 지원**: 동일 서버에 TUI, Desktop, IDE가 동시 접속 가능

#### OpenLander: 통합형 (Embedded)

```
[TUI] ←→ [Agent/Pipeline] ←→ [Docker/Traefik]
  ↕
[REST API] ←→ [Channels (Slack/Discord)]
```

- 서버와 클라이언트가 단일 프로세스
- REST API는 외부 채널 (Slack 등) 연동용
- MCP 서버로 외부 AI 도구에서 접근 가능

### 📌 적용 가능 패턴: Client-Server 분리

> **추천도: ★★★★☆ (높음)**
>
> OpenLander도 원격 제어 시나리오 (모바일에서 배포 제어, 팀 대시보드)가 로드맵에 있다면,
> OpenCode처럼 SDK + SSE 기반 client-server 분리를 **v0.5 이후** 도입 고려.
> 현 단계에선 과도한 엔지니어링이 될 수 있음.

---

## 3. 핵심 시스템별 상세 비교

### 3.1 AI Provider 시스템

#### OpenCode

```typescript
// 75+ 프로바이더 지원 via Vercel AI SDK
// 프로바이더 로딩 계층:
// 1. 환경변수 (최우선)
// 2. auth.json (OAuth/API 토큰)
// 3. config 파일
// 4. Models.dev 기본값

// 주요 특징:
- Vercel AI SDK 기반 추상화
- ProviderTransform: 프로바이더별 메시지/스키마 변환
- Models.dev 통합: 모델 메타데이터 자동 로드
- OpenCode Zen: 자체 프록시 게이트웨이
- Provider 핫스왑: 런타임 중 프로바이더 변경
```

#### OpenLander

```typescript
// 5개 프로바이더 직접 구현
// src/llm/
├── anthropic.ts   // Claude
├── gemini.ts      // Google Gemini (기본)
├── openai.ts      // OpenAI
├── openrouter.ts  // OpenRouter
└── ollama.ts      // 로컬 Ollama
```

### 📌 적용 가능 패턴: Provider 추상화 강화

> **추천도: ★★★☆☆ (중간)**
>
> **현재 OpenLander 방식도 충분** — 배포 에이전트에 75개 프로바이더가 필요하지 않음.
> 다만 다음은 차용 가치 있음:
>
> 1. **ProviderTransform 패턴**: 프로바이더별 메시지 포맷 차이를 transform 레이어에서 처리
> 2. **auth.json 기반 인증 관리**: API 키를 환경변수가 아닌 파일 기반으로 관리
> 3. **Models.dev 통합**: 모델 메타데이터 (context window, pricing) 자동 로드

---

### 3.2 에이전트 시스템

#### OpenCode: 다중 에이전트 + 커스텀 에이전트

```yaml
# .opencode/agents/review.md (마크다운 파일로 에이전트 정의)
---
model: anthropic/claude-sonnet-4-5
permission:
  write: deny
  bash: ask
mode: primary
description: 코드 리뷰 전용 에이전트
color: '#FF5733'
steps: 50
---
코드 리뷰를 수행하는 에이전트입니다...
```

**핵심 특징:**

- **빌트인 에이전트**: `build` (풀 액세스), `plan` (읽기 전용), `general` (서브에이전트)
- **커스텀 에이전트**: 마크다운 파일로 정의, YAML frontmatter + 프롬프트 본문
- **에이전트 모드**: `primary` (Tab 전환), `subagent` (@이름 호출), `all`
- **Permission 시스템**: 도구별 allow/deny/ask 제어, glob 패턴 지원
- **Steps 제한**: 무한 루프 방지를 위한 반복 횟수 제한
- **에이전트 컬러**: UI에서 시각적 구분

#### OpenLander: 단일 에이전트 + 레시피

```
src/agent/
├── index.ts    ← 단일 AI 에이전트
├── prompts.ts  ← 시스템 프롬프트
├── recipes.ts  ← 배포 레시피 (결정론적)
├── debugger.ts ← 빌드 에러 분석기
└── tools.ts    ← 에이전트 도구 정의
```

**핵심 특징:**

- 단일 에이전트 모델 (대화 + 배포)
- 레시피 기반 빠른 경로 (deterministic execution)
- LLM은 대화/명확화/에러 설명만 담당
- 배포 결정은 rule-based

### 📌 적용 가능 패턴: 마크다운 기반 에이전트 정의

> **추천도: ★★★★★ (매우 높음)**
>
> OpenLander의 "코딩 에이전트 통합" 로드맵(v0.6)에 핵심적으로 적용 가능:
>
> 1. **마크다운 에이전트 정의**: `.openlander/agents/deploy-expert.md` 형식으로 전문 에이전트 정의
> 2. **에이전트 모드 분리**: `deploy` (실행), `diagnose` (읽기 전용 분석), `monitor` (모니터링)
> 3. **Permission 시스템**: Docker 명령, 포트 변경 등 위험 동작에 대한 allow/deny/ask 제어
> 4. **Steps 제한**: 무한 배포 루프 방지
>
> **구체적 활용 예시:**
>
> ```yaml
> # .openlander/agents/cautious-deploy.md
> ---
> permission:
>   docker-build: allow
>   docker-run: ask # 컨테이너 실행 전 확인
>   tunnel-public: ask # 퍼블릭 노출 전 확인
>   port-allocate: allow
> steps: 20
> ---
> 신중한 배포 에이전트. 모든 위험 동작 전에 사용자 확인을 받습니다.
> ```

---

### 3.3 도구(Tool) 시스템

#### OpenCode: 3단 도구 레지스트리 + Permission + Plugin Hook

```
도구 소스:
1. 빌트인: read, write, edit, bash, grep, list, task
2. MCP 서버: 외부 도구 (Model Context Protocol)
3. 플러그인: 커스텀 도구

도구 실행 흐름:
AI 호출 → ToolPart(pending) → Plugin beforeHook
→ Permission check → 실행(running)
→ Plugin afterHook → 결과 저장(completed/error)
→ 결과를 AI에 피드백

상태 머신: pending → running → completed | error

특이점:
- ctx.metadata(): 실행 중 UI 상태 실시간 업데이트
- ctx.ask(): 권한 확인 (allow/deny/ask)
- toModelOutput(): 결과를 AI에 맞게 변환
- SubtaskPart: 서브에이전트에 작업 위임
```

#### OpenLander: 심플한 도구 레지스트리

```
src/tools/
├── index.ts     ← 도구 내보내기
├── registry.ts  ← 레지스트리
└── types.ts     ← 타입 정의

도구 실행: AI가 function call → 파이프라인 실행 (deterministic)
```

### 📌 적용 가능 패턴: 도구 실행 상태 머신 + Plugin Hook

> **추천도: ★★★★★ (매우 높음)**
>
> 배포 작업은 시간이 오래 걸림 → **상태 추적이 핵심**:
>
> 1. **도구 상태 머신 (pending → running → completed/error)**
>    - 현재 OpenLander의 파이프라인은 각 step이 상태를 가지지만,
>      도구 레벨에서 통일된 상태 관리가 없음
>    - OpenCode처럼 ToolPart 형태로 통일하면 TUI에서 진행 상황 표시가 쉬워짐
> 2. **Plugin Hook (before/after)**
>    - 배포 전후 커스텀 액션 (Slack 알림, 로그 수집, 메트릭 전송)
>    - `.openlander/plugins/slack-notify.ts` → 배포 완료 시 자동 Slack 알림
> 3. **ctx.metadata() 패턴**
>    - Docker build 진행률, git clone 상태 등을 실시간으로 TUI에 반영
>    - `ctx.metadata({ title: "Building... (Layer 5/12)", progress: 42 })`

---

### 3.4 세션 관리

#### OpenCode

```
Session (SQLite)
├── id, title, agent, model
├── messages[]
│   └── parts[] (text, reasoning, file, tool, agent, subtask, compaction, snapshot)
├── fork() — 세션 분기 (히스토리 보존)
├── share() — 공유 링크 생성
├── compaction — 컨텍스트 압축 (토큰 절약)
└── revert — VCS 스냅샷 복원

특이점:
- MessageV2 part-based 구조: 메시지를 파트 단위로 분리 저장
- Compaction: 오래된 대화를 요약하여 토큰 절약
- Session fork: 대화 분기점에서 새 세션 생성
- VCS snapshot: 코드 변경 전후 git 상태 저장
```

#### OpenLander

```
Session (SQLite/Drizzle)
├── projects — 배포된 프로젝트
├── messages — 대화 이력
├── deployments — 배포 이력
├── containers — 컨테이너 상태
└── env_vars — 환경변수

특이점:
- 배포 중심 데이터 모델
- 프로젝트 ↔ 컨테이너 ↔ 배포 관계
```

### 📌 적용 가능 패턴: Context Compaction + Session Fork

> **추천도: ★★★★☆ (높음)**
>
> 1. **Context Compaction**
>    - 배포 대화가 길어지면 이전 대화를 요약하여 토큰 절약
>    - 특히 디버깅 대화에서 유용 (에러 로그가 길 때)
> 2. **Part-based 메시지 구조**
>    - 현재 단순 text 메시지 → part 구조로 전환
>    - `{ type: "deploy-log", content: "..." }`, `{ type: "error-analysis", content: "..." }`
>    - TUI에서 파트별로 다른 렌더링 가능 (로그는 코드블록, 에러는 빨간색 등)

---

### 3.5 설정(Configuration) 시스템

#### OpenCode: 다층 설정 + 변수 치환

```
설정 우선순위 (높은 것이 우선):
1. OPENCODE_CONFIG_CONTENT (런타임 인라인)
2. OPENCODE_CONFIG (환경변수 파일 경로)
3. ./opencode.json (프로젝트)
4. ~/.config/opencode/opencode.json (글로벌)
5. .well-known/opencode (조직)
6. 기본값

변수 치환:
- {env:API_KEY} — 환경변수
- {file:./secret.txt} — 파일 내용
- {secret:KEY} — auth.json

JSON Schema 검증:
- https://opencode.ai/config.json 에서 스키마 제공
- IDE 자동완성 지원
```

#### OpenLander

```
src/config/index.ts
- 단일 설정 파일
- 환경변수 기반
```

### 📌 적용 가능 패턴: 다층 설정 + JSON Schema

> **추천도: ★★★★☆ (높음)**
>
> 1. **다층 설정**: `~/.config/openlander/` (글로벌) + `./openlander.json` (프로젝트)
>    - 글로벌: 기본 LLM 키, 선호 프로바이더
>    - 프로젝트: 배포 설정, 도메인, 환경변수
> 2. **{env:VAR} 변수 치환**: 설정 파일에서 환경변수 참조
>    ```json
>    {
>      "llm": { "apiKey": "{env:GEMINI_API_KEY}" },
>      "cloudflare": { "token": "{file:./cf-token.txt}" }
>    }
>    ```
> 3. **JSON Schema 배포**: `https://openlander.dev/config.json`
>    - VS Code / 기타 에디터에서 자동완성

---

### 3.6 이벤트 시스템

#### OpenCode: Bus + SSE + Database Effect

```typescript
// 패턴: Database.effect() → 트랜잭션 커밋 후에만 이벤트 발행
Database.use(async (tx) => {
  await tx.insert(messages).values(data);
  Database.effect(() => {
    Bus.publish('message.updated', { sessionID, messageID });
  });
});

// 40+ 이벤트 타입:
// session.created, session.updated, session.deleted
// message.updated, message.removed
// message.part.updated, message.part.delta, message.part.removed
// permission.requested, permission.responded
// mcp.tools.changed, mcp.connected
// tui.session.select, tui.command.execute
```

#### OpenLander

```
src/events/index.ts — 기본 이벤트 시스템
```

### 📌 적용 가능 패턴: Database Effect 패턴

> **추천도: ★★★★★ (매우 높음)**
>
> **현재 문제**: DB 저장과 이벤트 발행이 분리되어 있으면, DB 실패 시 잘못된 이벤트가 발행될 수 있음
>
> **OpenCode 패턴 적용:**
>
> ```typescript
> // 트랜잭션 커밋 후에만 이벤트 발행
> Database.use(async (tx) => {
>   await tx.insert(deployments).values(deployment);
>   Database.effect(() => {
>     events.emit('deployment.completed', { projectId, url });
>     // Slack/Discord 알림도 여기서
>   });
> });
> ```
>
> 이렇게 하면 배포 기록이 DB에 확실히 저장된 후에만 알림이 전송됨.

---

### 3.7 MCP (Model Context Protocol)

#### OpenCode

```
- MCP 클라이언트: 외부 MCP 서버에서 도구를 로드하여 AI에 제공
- MCP OAuth: OAuth 기반 인증 지원
- 도구, 리소스, 프롬프트 전체 지원
- 설정: opencode.json의 mcp 섹션에서 서버 정의
```

#### OpenLander

```
src/mcp/server.ts — MCP 서버 (23개 도구 제공)
- OpenLander를 MCP 서버로 노출
- Claude Code, Cursor 등에서 OpenLander 도구 사용 가능
```

### 📌 적용 가능 패턴: MCP 클라이언트 추가

> **추천도: ★★★☆☆ (중간)**
>
> 현재 OpenLander는 MCP 서버만 제공. MCP 클라이언트를 추가하면:
>
> - 외부 모니터링 도구, 보안 스캐너 등을 AI 에이전트가 활용 가능
> - 예: Sentry MCP → 배포 후 에러 자동 모니터링
> - 우선순위는 낮음 (현 단계에서는 불필요)

---

### 3.8 플러그인 시스템

#### OpenCode: 완전한 플러그인 아키텍처

```
플러그인 정의:
1. TypeScript 파일 (.opencode/plugins/my-plugin.ts)
2. 마크다운 파일 (YAML frontmatter + 코드블록)
3. npm 패키지

플러그인 기능:
- 커스텀 도구 등록
- 라이프사이클 훅 (beforeTool, afterTool, beforeSession, afterSession)
- 설정 스키마 (Zod)
- 의존성 관리
- 이벤트 구독

플러그인 로딩:
1. 설정 소스 스캔 (글로벌, 프로젝트, 환경변수)
2. 스키마 검증 (Zod)
3. 모듈 임포트 (dynamic import)
4. 레지스트리 등록
5. 핫 리로드 지원
```

#### OpenLander: 없음

### 📌 적용 가능 패턴: 경량 플러그인 시스템

> **추천도: ★★★★☆ (높음, 단 v0.5+ 이후)**
>
> 현재는 과도하지만, 커뮤니티 성장 시 필수:
>
> 1. **1단계 (v0.5)**: Hook 기반 확장
>    ```typescript
>    // .openlander/hooks/post-deploy.ts
>    export default {
>      'deploy.after': async (ctx) => {
>        await fetch(ctx.config.slackWebhook, {
>          method: 'POST',
>          body: JSON.stringify({ text: `배포 완료: ${ctx.project.url}` }),
>        });
>      },
>    };
>    ```
> 2. **2단계 (v0.6+)**: 풀 플러그인 (커스텀 빌드팩, 커스텀 클라우드 프로바이더)

---

### 3.9 TUI 아키텍처

#### OpenCode: @opentui/solid (SolidJS Terminal Rendering)

```
특징:
- SolidJS 기반 터미널 렌더링 엔진
- 반응형 시그널 기반 상태 관리
- 테마 시스템 (커스텀 컬러, 프리셋)
- 키바인드 커스터마이징
- 에이전트별 컬러 코딩
- 자동 스크롤
- 국제화 (i18n)
- 명령어 시스템 (/command)
- 자동완성 (프롬프트 입력, @에이전트 호출)
```

#### OpenLander: Ink (React Terminal UI)

```
src/tui/
├── App.tsx            ← 메인 앱
├── components/        ← UI 컴포넌트
├── commands/          ← 명령어
├── context/           ← React Context
├── hooks/             ← 커스텀 훅
├── onboarding/        ← 온보딩 플로우
├── dashboard-utils.ts ← 대시보드 유틸
├── theme.ts           ← 테마
└── index.tsx          ← 진입점
```

### 📌 적용 가능 패턴: TUI 고도화

> **추천도: ★★★★★ (매우 높음) — 로드맵에 이미 있음 (v0.6)**
>
> OpenLander 로드맵에 "OpenCode-inspired UI/UX"가 이미 있으므로:
>
> 1. **@opentui/solid 전환**: 이미 package.json에 @opentui/solid 의존성 존재
>    - Ink(React) → @opentui/solid(SolidJS) 마이그레이션
>    - SolidJS의 세밀한 반응성이 터미널 UI에 더 적합
> 2. **테마 시스템**: OpenCode의 테마 프리셋 참고
> 3. **키바인드 커스터마이징**: 사용자가 단축키 변경 가능
> 4. **에이전트 스위칭 UI**: Tab으로 에이전트 전환 (deploy ↔ diagnose ↔ monitor)
> 5. **자동 스크롤 시스템**: 빌드 로그 출력 시 자동 스크롤

---

### 3.10 Desktop / IDE 확장

#### OpenCode

```
- Desktop: Tauri (Rust) + SolidJS
  - CLI를 sidecar로 내장
  - 네이티브 기능 (클립보드, 업데이터, 윈도우 상태)

- VS Code 확장:
  - 터미널에서 CLI 실행
  - 언어 서버 통합

- Web App:
  - Astro 기반 문서 사이트
```

#### OpenLander

```
- web/ 디렉토리 존재 (REST API)
- MCP 서버로 IDE 연동
```

### 📌 적용 가능 패턴: Tauri Desktop (장기)

> **추천도: ★★☆☆☆ (낮음, 장기 로드맵)**
>
> 현 단계에서는 불필요. TUI가 주 인터페이스.
> 팀/엔터프라이즈 확장 시 고려.

---

## 4. 적용 우선순위 요약

### 🔴 즉시 적용 (v0.4-v0.5)

| 패턴                  | 설명                            | 구현 난이도 | 임팩트 |
| --------------------- | ------------------------------- | ----------- | ------ |
| **Database Effect**   | DB 커밋 후에만 이벤트 발행      | 낮음        | 높음   |
| **도구 상태 머신**    | pending→running→completed/error | 중간        | 높음   |
| **ctx.metadata()**    | 실시간 진행률 UI 업데이트       | 중간        | 높음   |
| **다층 설정**         | 글로벌 + 프로젝트 설정 분리     | 중간        | 높음   |
| **Part-based 메시지** | 메시지를 파트 단위로 분리       | 중간        | 중간   |

### 🟡 중기 적용 (v0.5-v0.6)

| 패턴                       | 설명                     | 구현 난이도 | 임팩트    |
| -------------------------- | ------------------------ | ----------- | --------- |
| **마크다운 에이전트 정의** | .openlander/agents/\*.md | 중간        | 매우 높음 |
| **Permission 시스템**      | 도구별 allow/deny/ask    | 중간        | 높음      |
| **Plugin Hook**            | before/after 커스텀 액션 | 중간        | 높음      |
| **Context Compaction**     | 긴 대화 요약             | 높음        | 중간      |
| **@opentui/solid 전환**    | Ink → SolidJS TUI        | 높음        | 높음      |
| **{env:VAR} 변수 치환**    | 설정 파일 변수 치환      | 낮음        | 중간      |
| **JSON Schema**            | 설정 파일 스키마 배포    | 낮음        | 중간      |

### 🟢 장기 적용 (v0.7+)

| 패턴                     | 설명                     | 구현 난이도 | 임팩트    |
| ------------------------ | ------------------------ | ----------- | --------- |
| **Client-Server 분리**   | SDK + SSE 아키텍처       | 높음        | 높음      |
| **풀 플러그인 시스템**   | 커스텀 빌드팩/프로바이더 | 매우 높음   | 매우 높음 |
| **커스텀 에이전트 모드** | primary/subagent/all     | 중간        | 중간      |
| **MCP 클라이언트**       | 외부 도구 로드           | 중간        | 중간      |
| **Tauri Desktop**        | 데스크톱 앱              | 매우 높음   | 중간      |
| **OpenAPI SDK 자동생성** | type-safe API 클라이언트 | 높음        | 중간      |

---

## 5. 이미 공유하고 있는 기술 스택

OpenLander와 OpenCode가 **이미 동일하게 사용 중**인 기술:

| 기술                         | 용도                   | 비고                  |
| ---------------------------- | ---------------------- | --------------------- |
| **TypeScript (ESM, strict)** | 핵심 언어              | ✅ 동일               |
| **SQLite + Drizzle ORM**     | 로컬 데이터 저장       | ✅ 동일               |
| **Hono**                     | HTTP 서버              | ✅ 동일               |
| **Zod**                      | 스키마 검증            | ✅ 동일               |
| **@opentui/solid**           | TUI 프레임워크         | ✅ 의존성 이미 추가됨 |
| **MCP SDK**                  | Model Context Protocol | ✅ 동일               |
| **solid-js**                 | 반응형 프레임워크      | ✅ 동일               |
| **nanoid**                   | ID 생성                | ✅ 동일               |
| **picocolors**               | 터미널 색상            | ✅ 동일               |

이는 OpenCode 패턴을 **코드 레벨에서 직접 차용**할 수 있음을 의미 — 기술적 호환성이 매우 높음.

---

## 6. OpenCode에는 없고 OpenLander에만 있는 것

OpenLander의 **고유 강점** (OpenCode가 참고할 만한 것):

| 기능                        | 설명                                     |
| --------------------------- | ---------------------------------------- |
| **배포 파이프라인**         | Git → Docker → Traefik → URL 전체 자동화 |
| **컨테이너 오케스트레이션** | Blue-green 배포, 롤백, 헬스체크          |
| **인프라 관리**             | Traefik 자동 라우팅, DNS 관리            |
| **터널링**                  | TryCloudflare / Cloudflare Tunnel 통합   |
| **자동 Dockerfile**         | 프로젝트 분석 → Dockerfile 자동 생성     |
| **레시피 시스템**           | 결정론적 배포 (LLM 의존 ✕)               |
| **빌드 디버거**             | 빌드 에러 분석 + 자동 수정               |
| **멀티채널 봇**             | Slack/Discord/Telegram에서 배포 관리     |
| **DB 프로비저닝**           | PostgreSQL/MySQL/Redis 자동 생성         |
| **Monorepo 지원**           | Dockerfile 스캔, 병렬 빌드               |
| **비용 모델**               | Mac Mini + OpenLander = $0/월            |

---

## 7. 결론 및 권장 액션

### 즉시 실행 (이번 주)

1. **`Database.effect()` 패턴 도입** — `src/events/index.ts` + `src/db/` 연동
2. **도구 실행 상태 머신** — `src/tools/types.ts`에 `ToolState` 타입 추가
3. **`ctx.metadata()`** — 배포 진행률 실시간 표시 인프라

### 다음 스프린트

4. **다층 설정 시스템** — `~/.config/openlander/` + `./openlander.json`
5. **Part-based 메시지** — 대화 메시지를 파트 단위로 구조화
6. **설정 변수 치환** — `{env:VAR}`, `{file:path}` 지원

### v0.6 마일스톤

7. **마크다운 에이전트 정의** — `.openlander/agents/*.md`
8. **@opentui/solid TUI 전환** — 이미 의존성 있으므로 마이그레이션만
9. **Plugin Hook 시스템** — `deploy.before` / `deploy.after`

---

> **핵심 인사이트**: OpenCode는 "코딩 AI"로서 세계 최고 수준(111k stars)의 아키텍처를 보유.
> OpenLander는 "배포 AI"라는 **다른 도메인**이지만, 동일한 기술 스택을 공유하므로
> OpenCode의 **인프라 패턴** (이벤트, 설정, 플러그인, 에이전트)을 거의 그대로 차용할 수 있음.
> 도메인 로직(배포 파이프라인)은 OpenLander의 고유 강점으로 유지.
