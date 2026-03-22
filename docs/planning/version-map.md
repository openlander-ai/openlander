# OpenLander — 버전 맵 & 스펙 관리 문서

> **작성일**: 2026-02-28
> **목적**: 모든 기획문서를 버전별로 매핑하고, 구현 상태를 한눈에 파악할 수 있는 단일 참조점(Single Source of Truth)

---

## 버전 타임라인

```
v0.0.1 ✅ ── ... ── v0.2.6 ✅ ── v0.3.0 ✅ ── v0.3.1 ✅ ── v0.4.0 ✅ ── v0.5.1 ✅ ── v0.6.0 ✅ ── v0.6.1 ✅ ── v0.6.2 ✅ ── v0.6.3 ✅ ── v0.6.4 ✅ ── v0.6.5 ✅ ── v0.6.6 ✅ ── v0.6.7 ✅ ── v0.6.8 ✅ ── v0.6.9 ✅ ── v0.6.10 ✅ ── v0.6.11 ✅ ── v0.6.12 ✅ ── v0.6.13 ✅ ── v0.6.14 ✅ ── v0.6.15 ✅ ── v0.7.0 ✅ ── v0.7.1 ✅ ── v0.7.2 ✅ ── v0.7.3 ✅ ── v0.8.0 ✅ ── v0.9.0 ✅ ── v0.9.3 ✅ ── v0.9.4 ✅ ── v0.9.5 ✅ ── v0.9.6 ✅ ── v0.9.7 ✅ ── v1.0.0 (TBD)
```

v0.0.1 ✅ ── ... ── v0.2.6 ✅ ── v0.3.0 ✅ ── v0.3.1 ✅ ── v0.4.0 ✅ ── v0.5.1 ✅ ── v0.6.0 ✅ ── v0.6.1 ✅ ── v0.6.2 ✅ ── v0.6.3 ✅ ── v0.6.4 ✅ ── v0.6.5 ✅ ── v0.6.6 ✅ ── v0.6.7 ✅ ── v0.6.8 ✅ ── v0.6.9 ✅ ── v0.6.10 ✅ ── v0.6.11 ✅ ── v0.6.12 ✅ ── v0.6.13 ✅ ── v0.6.14 ✅ ── v0.6.15 ✅ ── v0.7.0 ✅ ── v0.7.1 ✅ ── v0.7.2 ✅ ── v0.7.3 ✅ ── v0.8.0 ✅ ── v0.9.0 ✅ ── v0.9.3 ✅ ── v0.9.4 ✅ ── v0.9.5 ✅ ── v0.9.6 ✅ ── v0.9.7 ✅ ── v1.0.0 (TBD)

```

v0.0.1 ✅ ── ... ── v0.2.6 ✅ ── v0.3.0 ✅ ── v0.3.1 ✅ ── v0.4.0 ✅ ── v0.5.1 ✅ ── v0.6.0 ✅ ── v0.6.1 ✅ ── v0.6.2 ✅ ── v0.6.3 ✅ ── v0.6.4 ✅ ── v0.6.5 ✅ ── v0.6.6 ✅ ── v0.6.7 ✅ ── v0.6.8 ✅ ── v0.6.9 ✅ ── v0.6.10 ✅ ── v0.6.11 ✅ ── v0.6.12 ✅ ── v0.6.13 ✅ ── v0.6.14 ✅ ── v0.6.15 ✅ ── v0.7.0 ✅ ── v0.7.1 ✅ ── v0.7.2 ✅ ── v0.7.3 ✅ ── v0.8.0 ✅ ── v0.9.0 ✅ ── v0.9.3 ✅ ── v0.9.4 ✅ ── v0.9.5 ✅ ── v0.9.6 ✅ ── v0.9.7 ✅ ── v1.0.0 (TBD)

```

MVP 일상관리 MCP연동 멀티채널 TUI리팩토링 TUI마감 서버인식 ProviderOAuth 에이전트능동 Env관리 AI SDK Dashboard i18n+버그 Traefik DeployCtrl Domains Extended SharedMode

```

> ✅ = 완료 | 🧪 = 도그푸딩 중 | 🔧 = 진행 중 | 📋 = 기획/계획 | ❌ = 미착수
>
> **참고**: v0.0.5(파인튜닝)는 requirements.md에 정의되어 있으나, 로컬 LLM은 정식 릴리즈 이후로 연기됨. 정식 릴리즈 버전은 미정.

---

## 스펙 문서 ↔ 버전 매핑

| #      | 문서                                   | 경로                                         | 버전           | 구현율 | 상태                                                                                                                                                 |
| ------ | -------------------------------------- | -------------------------------------------- | -------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~1~~  | ~~요구사항 정의서~~                    | `archive/requirements.md`                    | v0.0.1~v0.0.8  | 90%    | 📦 아카이브 (TUI 시대 문서, Web pivot 후 무효)                                                                                                       |
| ~~2~~  | ~~TUI 리팩토링 스펙~~                  | `archive/v0.0.6/tui-spec.md`                 | v0.0.6         | 97%    | 📦 아카이브 (TUI freeze 후 무효)                                                                                                                     |
| ~~3~~  | ~~UI/UX 레이아웃~~                     | `archive/v0.0.7/ui-ux-layout.md`             | v0.0.7         | 95%    | 📦 아카이브 (TUI freeze 후 무효)                                                                                                                     |
| ~~4~~  | ~~빌드실패 + Compose~~                 | `archive/v0.0.6/ui-ux-build-compose.md`      | v0.0.6         | 100%   | 📦 아카이브                                                                                                                                          |
| ~~5~~  | ~~v0.0.6 상세 태스크~~                 | `archive/v0.0.6/tasks.md`                    | v0.0.6         | 97%    | 📦 아카이브                                                                                                                                          |
| ~~6~~  | ~~v0.0.7 구현 태스크~~                 | `archive/v0.0.7/implementation-tasks.md`     | v0.0.7         | 100%   | 📦 아카이브                                                                                                                                          |
| ~~7~~  | ~~Phase 1 개발계획~~                   | `archive/v0.0.7/phase1-plan.md`              | v0.0.7         | 100%   | 📦 아카이브                                                                                                                                          |
| 8      | **AI SDK 마이그레이션**                | `v0.0.8/vercel-ai-sdk-migration.md`          | v0.0.8         | 100%   | ✅ 구현 완료. 5개 프로바이더 삭제, AI SDK 통합, 31 도구 Zod 변환.                                                                                    |
| 9      | ~~마이그레이션 & 디스커버리~~          | ~~`v0.0.9-migration-discovery.md`~~ (삭제됨) | v0.0.9         | —      | `v0.0.9/server-awareness.md`로 재정의                                                                                                                |
| 10     | ~~Local Dev & Env~~                    | ~~`env-spec.md`~~ (삭제됨)                   | v0.0.10        | —      | `v0.0.10/env-secrets.md`로 재정의                                                                                                                    |
| 11     | ~~v0.0.9–v0.0.10 통합 기획서~~         | `archive/v0.0.9-10-unified-spec.md`          | v0.0.9–v0.0.10 | 0%     | ⚠ **아카이브** — 12, 13번으로 대체                                                                                                                   |
| 12     | **v0.0.9 Server Awareness**            | `v0.0.9/server-awareness.md`                 | v0.0.9         | 100%   | ✅ 구현+도그푸딩 완료 (DEC-016). 버그 11건 해결, E2E 검증 완료.                                                                                      |
| 13     | **v0.0.10 Env & Secrets**              | `v0.0.10/env-secrets.md`                     | v0.0.10        | 100%   | ✅ 구현 완료. 4개 파트 전부 구현.                                                                                                                    |
| 14     | **버그 트래커**                        | `v0.0.9/bugs.md`                             | v0.0.9         | —      | 11건 해결, 2건 이관 (BUG-008 미재현, BUG-009 결정대기)                                                                                               |
| 15     | **개발 라이프사이클**                  | `dev-lifecycle.md`                           | 전체           | —      | ✅ 11단계 플로우 + 역할 정의 완료                                                                                                                    |
| ~~16~~ | ~~v0.0.9 온보딩 리팩토링~~             | `archive/onboarding-refactor.md`             | v0.0.9         | —      | 📦 아카이브 (DEC-017: Web Setup Screen으로 대체)                                                                                                     |
| 17     | **v0.0.12 Provider OAuth**             | `v0.0.12/provider-oauth.md`                  | v0.0.12        | 100%   | ✅ 구현 완료. 백엔드 OAuth 라우트 + 프론트엔드 통합.                                                                                                 |
| 18     | **v0.1.0 Web MVP**                     | `v0.1.0/web-mvp.md`                          | v0.1.0         | 100%   | ✅ Phase 0-3 구현 완료, TUI→Web pivot                                                                                                                |
| 19     | **v0.0.11 Agent Proactivity**          | `v0.0.11/agent-proactivity.md`               | v0.0.11        | 90%    | ✅ Phase 1-3 완료, 도그푸딩 완료. 잔여 3건은 nice-to-have                                                                                            |
| 20     | **Web Deploy Agent 경유**              | `v0.1.0/web-deploy-agent-mediated.md`        | v0.1.0         | 90%    | 🧪 구현 완료, 도그푸딩 대기                                                                                                                          |
| 21     | **에이전트 경유 Dockerfile 수정 루프** | `v0.1.0/dockerfile-fix-loop.md`              | v0.1.0         | 100%   | ✅ 구현 완료. Tier 2.5 분류 + fixDockerfile + 파이프라인 루프 + Web UI 카드.                                                                         |
| 22     | **v0.2.0 Dashboard Redesign**          | `v0.2.0/dashboard-redesign.md`               | v0.2.0         | 100%   | ✅ 구현 완료. Phase 1~4 전부 완료, 채팅 삭제, 라이트 모드 전환.                                                                                      |
| 23     | **v0.2.0 버그 트래커**                 | `v0.2.0/bugs.md`                             | v0.2.0         | 100%   | ✅ BUG-014~017 전부 해결. Deploy UX 아키텍쳐 개선 (project-first 모델).                                                                              |
| 24     | **v0.2.0 Deploy UX 수정 스펙**         | `v0.2.0/deploy-ux-fix.md`                    | v0.2.0         | 100%   | ✅ 3 Phase 구현 완료. SSE→JSON deploy, agent event streaming, log panel.                                                                             |
| 25     | **v0.2.1 i18n + 버그 수정**            | — (커밋 내 독립 파일)                        | v0.2.1         | 100%   | ✅ i18n (한/영) + 빌드 에러 리포팅 + Redeploy UI 갱신 버그 수정.                                                                                     |
| 26     | **v1.0.0 AI Co-pilot**                 | `release/v1.0.0-ai-copilot.md`               | TBD            | 100%   | ✅ 백엔드 완료. 웹 AI UI는 MCP-first 전환(DEC-037)으로 스코프 아웃.                                                                                  |
| 27     | **v0.2.6 Shared Mode & PR Preview**    | `v0.2.6/shared-mode-pr-preview.md`           | v0.2.6         | 100%   | ✅ 3 Phase 구현 완료. Traefik File Provider + Quick Share + Shared 모드 + PR 프리뷰 + 16 bugfix. 535 tests (dead TUI tests 제거).                    |
| 28     | **Agent Enhancement Sprint**           | `.sisyphus/plans/agent-enhancement.md`       | TBD            | 100%   | ✅ P0-1 questionBridge fix, P0-2 채널 스트리밍, P1-1 MCP agent_execute_goal, P1-2 오케스트레이터. P1-3 UI는 MCP-first 전환(DEC-037)으로 스코프 아웃. |
| 29     | **v1.0.0 로드맵**                      | `release/v1.0.0-roadmap.md`                  | v1.0.0         | —      | 📋 v1.0까지 6단계 로드맵. MCP-first 전환 반영.                                                                                                       |
| 30     | **v0.8.0 MCP-First Web Pivot**         | `.sisyphus/plans/web-mcp-pivot.md`           | v0.8.0         | 100%   | ✅ 완료                                                                                                                                              |

---

## 버전별 상세

### v0.0.1 — 레포 → URL (MVP) ✅

**상태**: 완료 | **관련 문서**: `requirements.md` L386~397

| 항목                                                  | 상태 |
| ----------------------------------------------------- | ---- |
| git clone → docker build → docker run → Traefik → URL | ✅   |
| Dockerfile 있는 레포만 지원                           | ✅   |
| TUI 채팅 인터페이스 (기본)                            | ✅   |
| REST API                                              | ✅   |
| Internal + Quick Share (TryCloudflare)                | ✅   |
| 로그 확인, 중지/삭제, 환경변수 기본                   | ✅   |
| `npm i -g openlander` + `openlander onboard`          | ✅   |

---

### v0.0.2 — 일상 관리 ✅

**상태**: 완료 | **관련 문서**: `requirements.md` L398~407

| 항목                                            | 상태 |
| ----------------------------------------------- | ---- |
| 환경변수 변경 → 자동 재배포                     | ✅   |
| git push → 자동 재배포 (webhook)                | ✅   |
| 프로세스 모니터링 (헬스체크 + 알림)             | ✅   |
| 안 쓰는 컨테이너 감지 → 정리 제안               | ✅   |
| Production 모드 (Cloudflare Tunnel 영구 도메인) | ✅   |
| 멀티 도메인 매핑                                | ✅   |
| Ollama 지원 (로컬 LLM)                          | ✅   |

---

### v0.0.3 — 코딩 에이전트 연동 ✅

**상태**: 완료 | **관련 문서**: `requirements.md` L408~415

| 항목                                      | 상태 |
| ----------------------------------------- | ---- |
| MCP 서버 (23/23 tools synced)             | ✅   |
| 롤백 (직전 이미지)                        | ✅   |
| 블루-그린 무중단 배포                     | ✅   |
| DB 자동 프로비저닝 (PostgreSQL sidecar)   | ✅   |
| 빌드 에러 자동 디버깅 (레시피 10개 + LLM) | ✅   |

---

### v0.0.4 — 멀티 채널 + 고급 배포 ✅

**상태**: 완료 | **관련 문서**: `requirements.md` L416~424

| 항목                                    | 상태 |
| --------------------------------------- | ---- |
| Slack/Discord/Telegram 봇               | ✅   |
| Preview 배포 (브랜치별)                 | ✅   |
| Dockerfile 없는 레포 → 템플릿 자동 생성 | ✅   |
| 모노레포 지원 (parent-child, 병렬 빌드) | ✅   |
| 병렬 배포 (Promise.all 멀티 도구)       | ✅   |
| JobManager (배포 단계 실시간 트래킹)    | ✅   |

---

### v0.0.6 — TUI UI/UX 고도화 ✅ (97%) — 📦 아카이브

**상태**: 완료, TUI freeze 후 아카이브 | **관련 문서**: `archive/v0.0.6/` (이동됨)

| 관련 문서                               | 역할                                | 상태         |
| --------------------------------------- | ----------------------------------- | ------------ |
| `v0.0.6/tui-spec.md` (1387줄)           | TUI 전체 아키텍처 + UI 스펙         | ✅ 구현 완료 |
| `v0.0.6/tasks.md` (598줄)               | 상세 태스크 38/39 완료              | ✅ (97%)     |
| `v0.0.6/ui-ux-build-compose.md` (407줄) | Build Failure 3-Tier + Compose 처리 | ✅ 100%      |

**Phase별 진행**:

- Phase 1~7: ✅ 전체 완료 (35/35)
- Phase 8: 4/5 완료 (/env, /tunnel, GitLab, AI SDK 조사)

**미완료 항목**:

| 항목                               | 위치              | 비고                                 |
| ---------------------------------- | ----------------- | ------------------------------------ |
| ~~T-INFRA-01: i18n (다국어 지원)~~ | `v0.0.6/tasks.md` | ✅ v0.2.1에서 Web i18n으로 구현 완료 |

**v0.0.6 이후 추가 완료** (태스크 범위 외):

- GitHub OAuth Device Flow ✅
- Enter 키 버그 수정 ✅
- GitLab 지원 강화 ✅
- OAuth client_id 하드코딩 ✅

---

### v0.0.7 — TUI 마감 + UI 디테일 ✅ — 📦 아카이브

**상태**: 완료, TUI freeze 후 아카이브 | **관련 문서**: `archive/v0.0.7/` (이동됨)

| 관련 문서                                | 역할                                        | 상태          |
| ---------------------------------------- | ------------------------------------------- | ------------- |
| `v0.0.7/ui-ux-layout.md` (374줄)         | 3-모드 레이아웃 + 데이터 갱신 + Alerts 스펙 | ✅ 기준 스펙  |
| `v0.0.7/implementation-tasks.md` (323줄) | 갭 분석 → 16개 TASK                         | ✅ 16/16 완료 |
| `v0.0.7/phase1-plan.md` (472줄)          | Phase 1 레이아웃 아키텍처 상세              | ✅ 9스텝 완료 |

**TASK 완료 현황** (16/16):

| Phase      | TASK    | 내용                         | 상태 |
| ---------- | ------- | ---------------------------- | ---- |
| A 인프라   | TASK-01 | Alerts IPC + useAlerts hook  | ✅   |
| A 인프라   | TASK-02 | Projects 폴링 3초 분리       | ✅   |
| A 인프라   | TASK-03 | 포트 충돌 Alert 백엔드       | ✅   |
| B UI       | TASK-04 | AlertsSection 컴포넌트       | ✅   |
| B UI       | TASK-05 | StatusBar MEM 표시           | ✅   |
| B UI       | TASK-06 | StatusBar 디버그 포트        | ✅   |
| B UI       | TASK-07 | StatusBar 빌드 진행률        | ✅   |
| B UI       | TASK-08 | ProjectInfo 필드 추가        | ✅   |
| B UI       | TASK-09 | Step 카운터                  | ✅   |
| C 인터랙션 | TASK-10 | 타이핑 → Chat 포커스         | ✅   |
| C 인터랙션 | TASK-11 | Esc 포커스 복귀              | ✅   |
| C 인터랙션 | TASK-12 | Build closed 메시지          | ✅   |
| C 인터랙션 | TASK-13 | Enter 닫기                   | ✅   |
| D 정리     | TASK-14 | 섹션 순서 정리               | ✅   |
| D 정리     | TASK-15 | 미사용 hooks 정리            | ✅   |
| D 정리     | TASK-16 | 전체 테스트 보강 (564 tests) | ✅   |

**추가 버그 수정** (TASK 범위 외):

- ChatPanel 스크롤 버그 → `<scrollbox>` 교체 ✅
- DashboardPanel System "Loading..." 멈춤 → fetchAll catch 보장 ✅
- DashboardPanel MCP Clients 섹션 제거 (스펙 외) ✅
- DashboardPanel ProjectsSection 렌더링 버그 → else 분기 추가 ✅

**`v0.0.7/ui-ux-layout.md` 하단 "구현 우선순위" 체크박스 미체크 상태에 대해**:

> 문서 L325~354의 Phase 1~4 체크박스 `[ ]`는 **원본 기획 시점의 계획 체크리스트**이며,
> 실제 구현은 `v0.0.7/implementation-tasks.md`의 16개 TASK + `v0.0.7/phase1-plan.md`의 9스텝으로 실행되었다.
> 해당 항목들은 이미 구현 완료되었으나 원본 문서의 체크박스가 업데이트되지 않은 상태.

---

### v0.0.8 — AI SDK 마이그레이션 ✅

**상태**: 구현 완료 | **관련 문서**: `v0.0.8/vercel-ai-sdk-migration.md`

| 항목                          | 상태 | 비고                                                                   |
| ----------------------------- | ---- | ---------------------------------------------------------------------- |
| 현재 아키텍처 분석            | ✅   | 5개 LLM 프로바이더 + 자체 추상화                                       |
| Vercel AI SDK 호환성 조사     | ✅   | `ai@6.0.116` 패키지 평가 완료                                          |
| 마이그레이션 계획 수립        | ✅   | 5 Phase 점진적 마이그레이션                                            |
| Phase 1: 의존성 + 모델 팩토리 | ✅   | AI SDK 패키지 설치, `createModel()` 구현, 5개 프로바이더 삭제 (~990줄) |
| Phase 2: 도구 Zod 변환        | ✅   | 31개 도구 JSON Schema → `tool()` + Zod (993→829줄)                     |
| Phase 3: Agent 루프 전환      | ✅   | `generateText()`/`streamText()` + `stopWhen`, 레거시 인터페이스 제거   |
| Phase 4: 통합 검증            | ✅   | SSE 스트리밍, MCP 서버, tsup+vite 빌드 통과                            |
| Phase 5: 테스트 + 정리        | ✅   | 테스트 리라이트, LSP 0 에러                                            |

**구현 내역**:

- `src/llm/index.ts` — 재작성: `createModel()` → AI SDK `LanguageModel` 반환
- `src/llm/gemini.ts`, `anthropic.ts`, `openai.ts`, `openrouter.ts`, `ollama.ts` — 삭제 (~990줄)
- `src/agent/tools.ts` — 31개 도구 AI SDK `tool()` + Zod 변환
- `src/agent/index.ts` — Agent 루프 `generateText()`/`streamText()` 전환
- `src/agent/debugger.ts`, `src/pipeline/auto-detect.ts` — `LanguageModel` 전환
- `src/app.ts`, `src/web/api/setup-routes.ts`, `auth-routes.ts` — `createModel()` 사용
- `src/mcp/server.ts` — Record 기반 도구 조회로 수정

---

### v0.0.9 — Server Awareness (서버 상태 인식) ✅

**상태**: 구현 완료, 도그푸딩 완료 (DEC-016) | **관련 문서**: [`v0.0.9/server-awareness.md`](v0.0.9/server-awareness.md), [`v0.0.9/bugs.md`](v0.0.9/bugs.md)

> 기존 `archive/v0.0.9-10-unified-spec.md`의 v0.0.9 파트를 대폭 축소하여 재정의.
> Import 프로세스, Import 컨테이너 관리, coexist Traefik 모드, 온보딩 대규모 개편은 제거됨.

**핵심 가치**: OpenLander가 서버의 전체 상태(컨테이너, 포트, 프록시)를 인식하여 배포 시 충돌을 원천 방지.

| 파트                        | 내용                                                             | 상태 |
| --------------------------- | ---------------------------------------------------------------- | ---- |
| 9-1: 전체 컨테이너 스캔     | `listAllContainers()` — 라벨 필터 없이 전체 Docker 컨테이너 반환 | ✅   |
| 9-2: OS 레벨 포트 스캔      | `scanUsedPorts()` — DB + Docker + OS(ss/lsof) 합산               | ✅   |
| 9-3: 리버스 프록시 감지     | `detectReverseProxy()` — managed/external 2모드                  | ✅   |
| 9-4: 시스템 프롬프트 확장   | `buildContextSnapshot()`에 서버 전체 컨텍스트 주입               | ✅   |
| 9-5: 에이전트 도구 3개 추가 | `list_all_containers`, `scan_ports`, `get_container_stats`       | ✅   |
| 9-6: Dashboard Server 섹션  | 외부 컨테이너/포트/프록시 상태 표시                              | ✅   |
| 9-7: Preflight Check        | 배포 전 포트/이름/리소스/프록시 사전 검증 (**킬러 피처**)        | ✅   |

**제거된 항목** (기존 통합 기획서 대비):

- Import 프로세스 (DB 등록 + 관리 전환) — 감지만으로 충분
- coexist Traefik 모드 — 복잡도 대비 실용성 낮음
- 온보딩 대규모 개편 — 프록시 감지 정보만 추가

**추가 스코프** (도그푸딩 중 발견):

| 항목                | 내용                                                                          | 상태              |
| ------------------- | ----------------------------------------------------------------------------- | ----------------- |
| 온보딩 CLI 리팩토링 | TUI 팝업 온보딩 → CLI 스타일로 전환. Docker → LLM(BYOK) → Git(OAuth/SSH/Skip) | ⏸️ 보류 (DEC-017) |

> 관련 문서: [`v0.0.9/onboarding-refactor.md`](v0.0.9/onboarding-refactor.md)

---

### v0.0.10 — Env & Secrets Management ✅

**상태**: 구현 완료 | **관련 문서**: [`v0.0.10/env-secrets.md`](v0.0.10/env-secrets.md)

> 기존 `archive/v0.0.9-10-unified-spec.md`의 v0.0.10 파트에서 Local Dev Mode를 완전히 제거하고 환경변수/시크릿 관리만 남김.
> **v0.1.0 Web 전환 반영**: 10-4를 TUI /env 오버레이에서 Web Settings 페이지 Global Secrets 섹션으로 변경.

| 파트                    | 내용                                                                | 상태 |
| ----------------------- | ------------------------------------------------------------------- | ---- |
| 10-1: Global Secrets    | `global_secrets` 테이블 + AES-256-GCM 암호화 + master key           | ✅   |
| 10-2: .env.example 감지 | `checkEnvRequirements()` 구현 (파이프라인 통합은 향후)              | ✅   |
| 10-3: 도구 추가         | `set_global_secret`, `list_global_secrets` (Agent + MCP + Registry) | ✅   |
| 10-4: Web UI            | Settings 페이지 Global Secrets 섹션 (추가/조회/삭제)                | ✅   |

**구현 내역**:

- `src/env/crypto.ts` — 신규: AES-256-GCM 암호화/복호화, master key 자동생성 (~/.openlander/master.key)
- `src/db/schema.ts` + `schema.drizzle.ts` — global_secrets 테이블 추가
- `src/db/index.ts` — CRUD 4개 메서드 + 마이그레이션
- `src/pipeline/env.ts` — EnvManager 확장: setGlobalSecret, getGlobalSecrets, getMergedForDeploy
- `src/pipeline/env-inject.ts` — checkEnvRequirements() 함수 추가
- `src/pipeline/deploy.ts` — EnvManager 주입, 3곳 getEnvVars→getMergedForDeploy 교체
- `src/pipeline/blue-green.ts` — EnvManager 주입, getEnvVars→getMergedForDeploy 교체
- `src/agent/tools.ts` + `src/tools/registry.ts` — set_global_secret, list_global_secrets 도구 추가
- `src/mcp/server.ts` — MCP 도구 2개 추가
- `src/agent/prompts.ts` — 도구 행 + 사용 예시 + 컨텍스트 스냅샷에 글로벌 시크릿 표시
- `src/web/api/routes.ts` — GET/POST/DELETE /api/secrets 엔드포인트
- `web/src/lib/api.ts` — 클라이언트 함수 3개 + GlobalSecret 인터페이스
- `web/src/pages/SettingsPage.tsx` — Global Secrets 섹션 (리스트 + 추가 폼 + 삭제)

---

### v0.0.11 — Agent Proactivity (에이전트 능동성) ✅

**상태**: 90% 완료 (핵심 기능 전부 구현, 잔여 3건은 nice-to-have) | **관련 문서**: [`v0.0.11/agent-proactivity.md`](v0.0.11/agent-proactivity.md)

> 에이전트가 정보를 수동적으로 제공하는 것에서, **적절한 타이밍에 능동적으로 인사이트를 전달**하는 것으로 전환.
> **v2 변경사항**: TUI → Web 플랫폼 전환. Timeline Items 사용, 알림 시스템 추가, 11-4 Idle Scan 제거.

**핵심 가치**: "서버 상태를 알고, 먼저 말해주는 배포 에이전트"

| 파트                      | 내용                                                  | 상태      |
| ------------------------- | ----------------------------------------------------- | --------- |
| 11-1: Post-Deploy Insight | 배포 후 헬스체크/이전버전 정리/리소스 상태 자동 보고  | ✅        |
| 11-2: Anomaly Nudge       | 크래시/재시작 루프/리소스 포화 감지 → Timeline + 알림 | ✅        |
| 11-3: Smart Defaults      | 이전 배포 히스토리 기반 스마트 기본값 제안            | ✅        |
| ~~11-4: Idle Scan~~       | ~~유휴 시 미사용 컨테이너/이미지 정리 제안~~          | ❌ 제거됨 |

**Phase 1 구현 내역** (commit `3c5e640`):

- `src/pipeline/post-deploy-insight.ts` — 신규: 인사이트 생성 로직 (헬스체크, 이전 컨테이너, 리소스, 빌드 시간)
- `src/web/api/routes.ts` — deploy:success 후 insight NDJSON 이벤트 전송 + `POST /api/projects/:id/actions`
- `web/src/lib/event-types.ts` — insight 타입 + ActionButton 인터페이스
- `web/src/components/timeline/InsightCard.tsx` — 신규: severity별 스타일 + 액션 버튼

**Phase 2 구현 내역** (11-3 Smart Defaults):

- `src/agent/smart-defaults.ts` — 신규: 이전 배포 데이터 기반 스마트 기본값 생성 (포트/환경변수/clone 재사용/빌드실패 대응)
- `src/agent/tools.ts` — deploy_project 도구에 스마트 기본값 체크 추가 (QuestionBridge 통합)
- `src/agent/prompts.ts` — buildContextSnapshot()에 프로젝트별 배포 히스토리 주입 + Smart Defaults 프롬프트 섹션
- 프론트엔드 변경 없음 — 기존 InputRequestCard + QuestionBridge 파이프라인 재사용

**Phase 3 구현 내역** (11-2 Anomaly Nudge, commit `0604ec8`):

- `src/monitor/alerts.ts` — 기존 AlertMonitor 확장: 컨테이너 크래시 감지, 메모리 포화 감지(>90%), 소음 방지(3건/시간, 5분 쿨다운)
- `web/src/hooks/use-notifications.ts` — 신규: 알림 폴링 훅 (30초 간격)
- `web/src/components/layout/NotificationCenter.tsx` — 신규: 드롭다운 알림 패널 (severity별 스타일, 액션 버튼, dismiss)
- `web/src/components/layout/Header.tsx` — Bell 아이콘 + 배지 + 드롭다운 토글
- `web/src/components/layout/AppLayout.tsx` — useNotifications 훅 연결 + 알림 액션→채팅 라우팅

### v0.0.12 — Provider OAuth (인증 통합) ✅

**상태**: 구현 완료 | **관련 문서**: [`v0.0.12/provider-oauth.md`](v0.0.12/provider-oauth.md)

> LLM 프로바이더 구독 계정(ChatGPT Plus, OpenRouter 등)으로 OAuth 로그인하여 BYOK 설정 없이 사용 가능하게.
> **Web pivot 반영 (DEC-020)**: CLI → Web UI (SetupScreen + SettingsPage), 파일 → DB 암호화, 임시서버 → Hono 라우트.

**핵심 가치**: API 키 수동 입력 번거로움 제거 + 기존 구독 활용으로 진입장벽 최소화.

| 항목                                     | 내용                                                  | 상태 |
| ---------------------------------------- | ----------------------------------------------------- | ---- |
| 인프라: oauth_tokens DB + 토큰 저장/갱신 | AES-256-GCM 암호화, Hono OAuth 라우트, PKCE 공용 유틸 | ✅   |
| 12-1: OpenAI OAuth PKCE                  | 팝업 로그인 + 토큰 교환 (Codex Client ID)             | ✅   |
| 12-2: OpenRouter OAuth PKCE              | 팝업 로그인 + API 키 자동 발급 (기존 CLI 코드 재활용) | ✅   |
| 12-3: Anthropic 안내 개선                | `claude setup-token` 안내 텍스트 추가 (보조 UX)       | ✅   |
| 12-4: Gemini 안내 개선                   | AI Studio 링크 안내 추가 (보조 UX)                    | ✅   |
| 프론트엔드 통합                          | SetupScreen + SettingsPage에 OAuth 버튼 + 상태 표시   | ✅   |

**구현 내역**:

- `src/auth/pkce.ts` — 신규: PKCE generatePkce() + generateState() 유틸
- `src/auth/token-store.ts` — 신규: 토큰 암호화/복호화/저장/조회/삭제 + 만료 검사
- `src/auth/openrouter-web.ts` — 신규: OpenRouter Web OAuth (auth URL 생성 + 코드 교환)
- `src/web/api/auth-routes.ts` — 신규: Hono OAuth 라우트 4개 (start, callback, status, disconnect)
- `src/db/schema.ts` + `schema.drizzle.ts` — oauth_tokens 테이블에 auth_method, user_email, iv 컬럼 추가
- `src/db/index.ts` — OAuthTokenRow 인터페이스 확장 + upsertOAuthTokens 새 컬럼 지원
- `src/web/server.ts` — auth-routes 마운트
- `web/src/components/setup/OAuthButton.tsx` — 신규: OAuth 팝업 트리거 + postMessage 수신
- `web/src/components/setup/ProviderHelp.tsx` — 신규: Anthropic/Gemini 프로바이더별 안내
- `web/src/lib/api.ts` — OAuth API 클라이언트 함수 3개
- `web/src/components/setup/SetupScreen.tsx` — Step 1에 OAuth 버튼 + 'or' 구분선 + ProviderHelp 추가
- `web/src/pages/SettingsPage.tsx` — AI Model 섹션에 OAuth 상태 표시 + 연결/해제 UI 추가

**선행 조건**: 없음 (v0.1.0 Web MVP + v0.0.10 완료). 관련 결정: DEC-013, DEC-020.

### v0.2.0 — Dashboard Redesign ✅

**상태**: 구현 완료, 도그푸딩 버그 해결 + 자동 복구 구현 완료 | **관련 문서**: [`v0.2.0/dashboard-redesign.md`](v0.2.0/dashboard-redesign.md), [`v0.2.0/bugs.md`](v0.2.0/bugs.md), [`v0.2.0/deploy-ux-fix.md`](v0.2.0/deploy-ux-fix.md)

> **핵심 가치**: 채팅 인터페이스 제거 → Vercel-inspired 라이트 모드 대시보드. AI는 백그라운드 어시스트로 전환.
> **관련 결정**: DEC-023 (방향 전환), DEC-024 (라이트 모드), DEC-025 (MVP 스코프)

| Phase                               | 내용                                                                                             | 상태 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ---- |
| Phase 1 — 디자인 토큰 + 레이아웃    | 라이트 모드 CSS 변수, Cyber 효과 제거, 채팅 제거, 2컬럼 레이아웃                                 | ✅   |
| Phase 2 — 기존 페이지 전환          | Sidebar, ProjectsGrid, ProjectDetail 라이트 스타일 적용                                          | ✅   |
| Phase 3 — 신규 기능                 | Deployments 탭, DeploymentDetail 페이지, 빌드 로그 뷰어, AI Analysis 박스, 백엔드 API 2개        | ✅   |
| Phase 4 — 정리                      | Chat 컴포넌트 4개 삭제, use-chat.ts 삭제, Chat API 4개 엔드포인트 삭제, 빌드 검증                | ✅   |
| Phase 5 — 자동 복구 (Auto-Recovery) | deploy:failed → AI 자동 분석 → 질문 → env 설정 → 재배포. Fix with AI 버튼 제거, 상태 표시로 대체 | ✅   |

**구현 내역**:

- `web/src/index.css` — 라이트 모드 디자인 토큰 전체 교체, Cyber 효과 전부 제거
- `web/src/components/layout/AppLayout.tsx` — 채팅 imports/state/slide-over/FAB 제거, 2컬럼 레이아웃
- `web/src/components/layout/Header.tsx` — 채팅 토글 제거, glow 제거
- `web/src/pages/ProjectDetail.tsx` — Deployments 탭 + DeploymentsList 컴포넌트 추가
- `web/src/pages/DeploymentDetail.tsx` — 신규: 배포 상세 페이지 (빌드 로그 뷰어 + AI 분석 박스)
- `web/src/App.tsx` — DeploymentDetail 라우트 추가
- `web/src/lib/api.ts` — getProjectDeployments(), getDeploymentDetail() 추가
- `web/src/types/index.ts` — DeployLogSummary, DeployLogDetail 타입 추가
- `src/db/index.ts` — getDeployLog(deployId) 메서드 추가
- `src/web/api/routes.ts` — GET /deployments, GET /deployments/:deployId 추가, Chat API 4개 삭제
- 삭제: ChatPanel, ChatMessage, ToolCallCard, ChatInput, use-chat.ts

**도그푸딩 버그 해결** (BUG-014~017):

| 버그    | 제목                      | 해결 방법                                                                         | 상태 |
| ------- | ------------------------- | --------------------------------------------------------------------------------- | ---- |
| BUG-014 | ask_user_question 멈춤    | Deploy 엔드포인트 SSE→JSON 전환, project-first 생성, EventBus broadcast           | ✅   |
| BUG-015 | 에이전트 스트리밍 미노출  | agent:event → agent_thinking/tool_call/message NDJSON 매핑, toTimelineItem() 연결 | ✅   |
| BUG-016 | Running 타임라인 비어있음 | Running/error/stopped 상태에서 마지막 deploy log 요약 표시                        | ✅   |
| BUG-017 | 로그 탭 접근성            | Timeline 탭 내 접을 수 있는 LogPreview 미니 패널 추가                             | ✅   |

**수정된 파일**:

- `src/events/index.ts` — `agent:event` 타입 추가
- `src/web/api/routes.ts` — deploy 엔드포인트, build/stream, 타임라인 히스토리
- `web/src/lib/api.ts` — deployProject() 간소화
- `web/src/lib/event-types.ts` — agent 이벤트 타입 + toTimelineItem()
- `web/src/pages/NewProjectFlow.tsx` — SSE 제거, fetch→redirect
- `web/src/pages/ProjectDetail.tsx` — LogPreview 통합
- `web/src/components/timeline/LogPreview.tsx` — 신규: 로그 미니 패널
- `test/event-types.test.ts` — 신규: 3개 테스트

**자동 복구 (Auto-Recovery) 구현** (Phase 5):

| 항목                                       | 내용                                                                                         | 상태 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | ---- |
| deploy:failed/compose:failed 이벤트 리스너 | `app.ts` — 2초 딜레이 후 agent.chatStream() 자동 호출                                        | ✅   |
| 안전장치                                   | 최대 3회 재시도, 동일 에러 반복 감지, 인프라 에러 스킵                                       | ✅   |
| 프롬프트 개선                              | Auto-Recovery Mode 섹션, compose env 복구 워크플로우, options:[] 강제                        | ✅   |
| 스트림 유지                                | routes.ts — error 이벤트에서 NDJSON 스트림/reader loop 유지                                  | ✅   |
| UX 변경                                    | Fix with AI 버튼 → "AI is working on it..." 스피너로 교체                                    | ✅   |
| E2E 검증                                   | summary-god (monorepo compose, 11개 env) — deploy→fail→auto-recovery→question→answer→running | ✅   |

**수정된 파일** (자동 복구):

- `src/app.ts` — handleAutoRecovery() 이벤트 리스너 (L144-233)
- `src/agent/prompts.ts` — Auto-Recovery Mode + Compose env recovery + ask_user_question 규칙
- `src/web/api/routes.ts` — deploy:failed/compose:failed 스트림 유지, 5분 타임아웃
- `web/src/hooks/use-timeline.ts` — error 이벤트 reader loop 유지
- `web/src/components/timeline/TimelineItem.tsx` — Fix with AI → AI working 상태 표시

---

### v0.2.1 — i18n + 버그 수정 ✅

**상태**: 구현 완료 | **관련 커밋**: 11개 (fix 1 + feat 10)

> **핵심 가치**: 온보딩에서 언어 선택 (한국어/영어) → 에이전트 프롬프트 + 전체 UI 반영. 빌드 실패 시 에러 내용 타임라인 표시. Redeploy 후 UI 즉시 갱신.

| 항목                          | 내용                                                                               | 상태 |
| ----------------------------- | ---------------------------------------------------------------------------------- | ---- |
| i18n 백엔드                   | config.language (en/ko), LOCALE_DIRECTIVES 프롬프트 주입, agent hot-reload         | ✅   |
| i18n API                      | POST /setup/language, GET /setup/status 언어 필드, OAuth locale 전달               | ✅   |
| i18n 프론트엔드 인프라        | LanguageProvider, useLanguage() hook, t() dot-path lookup, en/ko 딕셔너리 (~316키) | ✅   |
| 온보딩 언어 선택 Step 0       | SetupScreen 4단계로 확장 (Language → Welcome → LLM → GitHub)                       | ✅   |
| 컴포넌트 t() 적용 (17개 파일) | 모든 하드코딩 문자열 → t() 호출로 교체                                             | ✅   |
| 빌드 에러 리포팅 버그         | deploy:failed 이벤트에 buildLog 포함, 타임라인에 접이식 로그 렌더링                | ✅   |
| Redeploy UI 갱신 버그         | ProjectsGrid에서 redeployProject() 성공 후 refetch() 호출                          | ✅   |

**수정된 파일** (33개):

- 백엔드 9개: config, prompts, agent, app, setup-routes, auth-routes, events, deploy, routes
- 프론트엔드 인프라 5개: i18n/context.tsx(NEW), i18n/en.ts(NEW), i18n/ko.ts(NEW), App.tsx, api.ts
- 컴포넌트 19개: SetupScreen, ProjectsGrid, ProjectDetail, NewProjectFlow, DeploymentDetail,
  SettingsPage, Header, DeployDialog, ProjectCard, DomainsPanel, EnvVarsTable, TimelineItem,
  TimelineFeed, InputRequestCard, LogViewer, CommandPalette, OAuthButton, ProviderHelp, event-types.ts

### v0.2.2 — Traefik Cutover + 시간대 수정 (P0) ✅

**상태**: ✅ 구현 완료 | **관련 커밋**: `62dc1f3`, `cf9ff53`

> **핵심 가치**: CF Tunnel → localhost:80 (Traefik 경유) 전환 완료. 시간대 표시 정확성 확보.
> **선행 조건**: v0.2.1 ✅
> **후행 조건**: v0.2.3 (블루-그린, 롤백 등 Traefik 경유가 선행되어야 정상 동작)

| Phase | 항목                   | 내용                                                                 | 상태 |
| ----- | ---------------------- | -------------------------------------------------------------------- | ---- |
| 1     | Traefik 전환 가이드    | CF Tunnel → localhost:80 전환 설정 스니펫 + 복사 가능 체크리스트     | ✅   |
| 2     | Traefik 경유 상태 확인 | Settings 페이지에 Reverse Proxy 상태 섹션 + CF Tunnel 가이드 추가    | ✅   |
| 3     | 시간대 버그 수정       | formatRelativeTime() 7곳 중복 → `web/src/lib/time.ts` 공통 유틸 추출 | ✅   |

**관련 아키텍처**:

- Traefik 라우팅: `buildTraefikLabels(projectName, containerPort)` → Host(`projectname.{ip}.sslip.io`)
- 현재 사용자 설정: CF Tunnel → 컨테이너 포트 직연결 (Traefik 미경유) → redeploy 시 포트 변경으로 터널 끊김
- 시간대: `formatRelativeTime()` / `timeAgo()` 3개 파일에 중복 구현. 공통 유틸로 추출 필요

---

### v0.2.3 — Core Deploy Controls (P1) ✅

**상태**: ✅ 구현 완료 | **관련 커밋**: `0062254`, `a1aeeb3`

> **핵심 가치**: 롤백, 블루-그린 무중단 배포, Webhook 자동 재배포, 프로젝트 Start — 백엔드에만 있던 핵심 배포 기능을 웹 UI로 노출.
> **선행 조건**: v0.2.2 ✅ (Traefik 경유 필수 — 블루-그린이 포트 직연결에서 깨짐)

| Phase | 항목              | 내용                                                                                                           | 상태 |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------------------- | ---- |
| 1     | 롤백 버튼         | ProjectDetail에 Rollback 버튼 + API 클라이언트 + 테스트 3개                                                    | ✅   |
| 2     | 블루-그린 배포 UI | Blue-Green 버튼 + `blueGreenProject()` API + 테스트 3개. `Zap` 아이콘, running 상태에서만 활성                 | ✅   |
| 3     | Webhook 설정 UI   | DB 2메서드 추가 + REST API 3개 (GET/POST/DELETE) + Config탭 Webhooks 패널 (URL/시크릿 복사, 토글) + 테스트 5개 | ✅   |
| 4     | Start 버튼        | Docker `startContainer()` + Pipeline `start()` + REST `POST /start` + 조건부 Start/Stop 버튼 + 테스트 4개      | ✅   |

**구현 내역**:

- `src/pipeline/docker.ts` — `startContainer()` 신규 메서드
- `src/pipeline/deploy.ts` — `start()` 신규 메서드 (자식 프로젝트 재귀 지원)
- `src/db/index.ts` — `getWebhookConfigs()`, `deleteWebhookConfig()` 신규 메서드
- `src/web/api/routes.ts` — `POST /start`, `GET/POST/DELETE /webhooks` 엔드포인트 6개 추가
- `web/src/lib/api.ts` — `blueGreenProject()`, `startProject()`, `getProjectWebhooks()`, `setProjectWebhook()`, `deleteProjectWebhook()` 추가
- `web/src/pages/ProjectDetail.tsx` — Blue-Green/Start 버튼 + WebhookPanel 컴포넌트 + Config Webhooks 탭
- `web/src/i18n/en.ts`, `ko.ts` — blueGreen, start, webhooks 관련 i18n 키 추가
- `test/web-routes.test.ts` — 15개 신규 테스트 (668 → 680, rollback 3 + blue-green 3 + webhook 5 + start 4)

---

### v0.2.4 — Domains & Visibility (P2) ✅

**상태**: ✅ 구현 완료 | **관련 커밋**: `e1e602f`

> **핵심 가치**: 도메인 매핑 CRUD 웹 UI + 서버 상태 스캔 읽기 전용 UI.

| Phase | 항목               | 내용                                                                                            | 상태 |
| ----- | ------------------ | ----------------------------------------------------------------------------------------------- | ---- |
| 1     | 도메인 매핑 CRUD   | DomainsPanel에 커스텀 도메인 추가/삭제 UI. 백엔드 API는 `domain-routes.ts`에 이미 구현됨        | ✅   |
| 2     | 서버 상태 스쳪 UI  | Settings에 Server Scan 섹션 — 외부 컨테이너 리스트, 포트, 프록시 상세. `ServerStatus` 타입 확장 | ✅   |
| 3     | 리소스 모니터링 UI | 기존 System Stats 섹션이 CPU/메모리/디스크 표시 — 추가 구현 불필요                              | ✅   |

**구현 내역**:

- `web/src/components/config/DomainsPanel.tsx` — 커스텀 도메인 섹션 추가 (add/delete + 리스트)
- `web/src/pages/SettingsPage.tsx` — Server Scan 섹션 추가 (외부 컨테이너 상세)
- `web/src/lib/api.ts` — `getProjectDomains()`, `addProjectDomain()`, `removeProjectDomain()` + `ServerStatus.externalContainers`
- `web/src/i18n/en.ts`, `ko.ts` — customDomains, serverScan 관련 i18n 키 추가

---

### v0.2.5 — Shared Services (Docker Image Runner) ✅ (partial)

**상태**: ✅ 부분 구현 완료 (공유 서비스만 구현, 프리뷰 배포/DB 백업은 스킵) | **관련 커밋**: TBD

> **핵심 가치**: 아무 Docker 이미지나 공유 인프라로 실행. MySQL, Redis뿐 아니라 litellm, opik, minio 등 범용 지원.
> **PM 결정**: v0.2.5 전체 스코프(프리뷰 배포, DB 백업)는 스킵. 공유 서비스 기능만 구현 후 품질 게이트 → 정식 릴리즈 진행.

| Phase | 항목                     | 내용                                                                                            | 상태 |
| ----- | ------------------------ | ----------------------------------------------------------------------------------------------- | ---- |
| 1     | DB 스키마 + 마이그레이션 | services 테이블 (범용 type, env_vars 컬럼). 기존 DB 마이그레이션 지원                           | ✅   |
| 2     | ServiceManager 클래스    | Docker 컨테이너 생성/시작/중지/삭제. 4개 템플릿(PostgreSQL/MySQL/Redis/MongoDB) + 커스텀 이미지 | ✅   |
| 3     | REST API                 | GET/POST/DELETE /services, start/stop, GET /services/templates                                  | ✅   |
| 4     | 프론트엔드               | /services 페이지 — 템플릿 퀵스타트 + 커스텀 이미지 폼 + 서비스 목록(연결정보/start/stop/remove) | ✅   |
| 5     | i18n                     | 서비스 관련 en/ko 번역 키 추가                                                                  | ✅   |
| 6     | API 테스트               | 9개 신규 테스트 (template/custom create, validation, CRUD, templates endpoint)                  | ✅   |

**Drop 항목** (PM 결정 — 스킵):

- 프리뷰 배포 UI (백엔드 구현 완료, 웹 UI 미구현)
- DB 프로비저닝 UI (기존 per-project provisioner는 그대로 유지)
- DB 백업 (S3)

---

### v0.2.6 — Shared Mode & PR Preview ✅

**상태**: ✅ 구현 완료, 품질 리뷰 완료 (783 tests) | **관련 문서**: `v0.2.6/shared-mode-pr-preview.md`

> Quick Share Traefik 통합 + 접근 코드(Shared 모드) + PR별 프리뷰 URL.
> **관련 결정**: DEC-023 UPDATE (정체성 재정의), DEC-035 UPDATE (Single-Track 통합)

| Phase | 항목                                   | 공수    | 상태 |
| ----- | -------------------------------------- | ------- | ---- |
| 1     | Traefik File Provider 활성화           | 0.5일   | ✅   |
| 2     | Quick Share Traefik 통합 + Shared 모드 | 2.5~3일 | ✅   |
| 3     | PR 프리뷰                              | 2~3일   | ✅   |

**구현 내역**:

Phase 1 — Traefik File Provider:

- `src/pipeline/traefik.ts` — File Provider Cmd lines, volume mount, `DYNAMIC_CONFIG_DIR` export

Phase 2 — Quick Share Traefik + Shared Mode:

- `src/pipeline/tunnel.ts` — Full rewrite: localhost:80 타겟, YAML gen/del, shared mode, bcryptjs BasicAuth
- `src/pipeline/deploy.ts` — `exposeTunnel()`, `getTunnel()`, `deployPreview()`, 'shared' visibility
- `src/db/schema.ts` + `schema.drizzle.ts` — `access_code`, `access_code_iv`, 'shared' CHECK
- `src/web/api/project-routes.ts` — `POST/DELETE /share` API 엔드포인트
- `web/src/components/sidebar/ShareDialog.tsx` — 신규: Share Sheet 컴포넌트
- `web/src/pages/ProjectDetail.tsx` — Share 버튼 (Expose 교체)
- `web/src/lib/api.ts` — `shareProject()`, `unshareProject()`
- `web/src/types/index.ts` — 'shared' visibility, accessCode 필드
- `web/src/i18n/en.ts`, `ko.ts` — `share.*` i18n 키
- `package.json` — bcryptjs + @types/bcryptjs 의존성 추가

Phase 3 — PR Preview:

- `src/webhook/index.ts` — PR 이벤트 핸들링 (GitHub/GitLab/Bitbucket — opened/synchronize/closed)
- `src/pipeline/deploy.ts` — `deployPreview()` 메서드
- `src/db/schema.ts` + `schema.drizzle.ts` — `is_preview`, `pr_number` 컬럼
- `src/web/api/project-routes.ts` — `GET/DELETE /previews` API 엔드포인트
- `web/src/components/timeline/PRPreviewsList.tsx` — 신규: PR 프리뷰 리스트 컴포넌트
- `web/src/pages/ProjectDetail.tsx` — Previews 탭
- `web/src/lib/api.ts` — `getProjectPreviews()`, `deleteProjectPreview()`
- `web/src/i18n/en.ts`, `ko.ts` — `prPreviews.*` i18n 키

품질 리뷰 (3건 blocking → 해결):

- GitHub PR 파싱 `number` 필드 fallback
- Share API 터널 미가용 시 graceful fail
- Tunnel YAML write 실패 cleanup

테스트 (+30 신규, 753 → 783):

- Tunnel YAML 생성 + BasicAuth hash (5)
- API share/unshare + previews (8)
- GitHub/GitLab/Bitbucket PR 파싱 (9)
- DB shared/preview 필드 (3)
- isPREvent edge cases (5)

---

### v0.3.0 — Developer Experience ✅

**상태**: 완료

| 항목                                 | 상태 |
| ------------------------------------ | ---- |
| Real-time Docker build log streaming | ✅   |
| ANSI color rendering                 | ✅   |
| xterm.js web terminal                | ✅   |
| WebSocket infrastructure             | ✅   |

---

### v0.3.1 — UI Polish & Stability ✅

**상태**: 완료

| 항목                                          | 상태 |
| --------------------------------------------- | ---- |
| Terminal shell probing for Alpine/slim images | ✅   |
| Log-first console layout                      | ✅   |
| Overview summary dashboard                    | ✅   |

---

### v0.4.0 — Deployments UX ✅

**상태**: 완료

| 항목                                     | 상태 |
| ---------------------------------------- | ---- |
| Deployments filters, richer history rows | ✅   |
| Detail metadata cards                    | ✅   |
| API UTC normalization                    | ✅   |
| Safer browser time parsing               | ✅   |

---

### v0.5.1 — Multi-Environment Support ✅

**상태**: 완료

| 항목                                              | 상태 |
| ------------------------------------------------- | ---- |
| Environment schema + multi-environment DB support | ✅   |
| Environment injection/scanning in deploy pipeline | ✅   |
| Environment-aware deploy orchestration            | ✅   |
| Environment management REST API routes            | ✅   |
| Webhook environment support                       | ✅   |

---

### v0.5.2 — Bugfix ✅

**상태**: 완료

| 항목                                | 상태 |
| ----------------------------------- | ---- |
| Dockerode CJS/ESM import crash fix  | ✅   |
| Release automation (release-it)     | ✅   |
| Historical git tags (v0.1.0~v0.5.1) | ✅   |

---

### v0.6.0 — 아키텍처 리빌드 + AI Co-pilot ✅

**상태**: 완료 — v0.5.1 이후 대규모 리팩토링 + 기능 추가

| 항목                                                                                                    | 상태 |
| ------------------------------------------------------------------------------------------------------- | ---- |
| **아키텍처**                                                                                            |      |
| TUI 런타임 완전 제거 (SolidJS/OpenTUI/IPC)                                                              | ✅   |
| Tool Registry 통합 — ToolDef 공유 + MCP/Agent 듀얼 어댑터 (14개 정의 파일)                              | ✅   |
| 결정론적 배포 파이프라인 — 배포 플로우에서 LLM 호출 완전 제거                                           | ✅   |
| **인프라**                                                                                              |      |
| 공유 인프라 (PostgreSQL/MySQL/Redis) — ServiceManager + 7개 MCP 도구                                    | ✅   |
| 서비스 페이지 전면 리디자인 — 카드 그리드, 상세 페이지, DB 탭, CPU/메모리/디스크 모니터링               | ✅   |
| DB 프로비저닝 UI (Databases 탭)                                                                         | ✅   |
| **배포 UX**                                                                                             |      |
| 프리미엄 배포 터미널 세션 UI — 10개 컴포넌트 (PhaseRail, StepGroup, LogBlock 등)                        | ✅   |
| 스마트 env 설정 — 인프라 분석 + .env.example 감지                                                       | ✅   |
| **MCP**                                                                                                 |      |
| MCP 도구 설명 강화 — 서비스 연결 패턴, 사용 힌트, 워크플로우 가이드                                     | ✅   |
| Webhook 도구 12개 (enable/disable/configure/list)                                                       | ✅   |
| MCP agent_execute_goal — 외부 클라이언트 고수준 목표 위임                                               | ✅   |
| Streamable HTTP transport (원격 LAN 접근)                                                               | ✅   |
| **AI**                                                                                                  |      |
| AI co-pilot 7기능 (자동 복구, 장애 리포트, 롤백 제안, env 감지, 포스트모템, 시크릿 스캔, 성공 인사이트) | ✅   |
| 채널 스트리밍 + 인터랙티브 컴포넌트 (Slack/Discord/Telegram)                                            | ✅   |
| **품질**                                                                                                |      |
| 23-framework auto-detect (Rails, Spring, Laravel, ASP.NET) + Dockerfile 템플릿                          | ✅   |
| Preflight warning checks (env completeness, Dockerfile syntax)                                          | ✅   |
| Coverage gates (lines 60%, branches 55%, functions 55%)                                                 | ✅   |

---

### v0.6.1 — Bugfix ✅

**상태**: 완료

| 항목                             | 상태 |
| -------------------------------- | ---- |
| Env vars merge (replace → merge) | ✅   |
| list_env_vars 도구 추가          | ✅   |
| HealthMonitor Docker fallback    | ✅   |

---

### v0.6.2 — Compose, Env Escaping, Traefik HTTP Provider ✅

**상태**: 완료

| 항목                                               | 상태 |
| -------------------------------------------------- | ---- |
| compose_services 파라미터 (서비스 선택 배포)       | ✅   |
| Secret file compose 마운트                         | ✅   |
| .env 파일 이스케이핑 (newline, $, backtick)        | ✅   |
| 빌드 로그 상세화 (--progress=plain, onProgress)    | ✅   |
| Redeploy port 충돌 fix                             | ✅   |
| Traefik File Provider → HTTP Provider 마이그레이션 | ✅   |
| buildLogTail (실패 응답에 로그 포함)               | ✅   |

---

### v0.6.3 — Port Stability & API Fix ✅

**상태**: 완료

| 항목                                                   | 상태 |
| ------------------------------------------------------ | ---- |
| allocatePort() preferredPort 옵션 추가                 | ✅   |
| redeploy 시 기존 포트 보존 (preferredPort 전달)        | ✅   |
| getUsedPorts() environments 테이블 포함                | ✅   |
| Project detail API camelCase 매핑 (publicUrl, repoUrl) | ✅   |
| remove_project 도구 설명에 포트 유실 경고 추가         | ✅   |

---

### v0.6.4 — Deploy Plan v2 (Non-blocking Execute + Deep Repo Analysis) ✅

**상태**: 완료

| 항목                                                      | 상태 |
| --------------------------------------------------------- | ---- |
| executePlan() 비동기 전환 (startDeploy + event listeners) | ✅   |
| createPlan() 깊은 레포 분석 (compose/Dockerfiles/env/vol) | ✅   |
| MCP 응답 전체 plan 상세 노출                              | ✅   |
| dockerfile_path + docker_target 파라미터 추가             | ✅   |
| estimated_seconds (이전 배포 기반 폴링 힌트)              | ✅   |

---

### v0.6.5 — Deploy Plan Bugfixes ✅

**상태**: 완료

| 항목                                                     | 상태 |
| -------------------------------------------------------- | ---- |
| deploy_only compose 서비스 선택 배포                     | ✅   |
| get_deploy_status에 build_log_tail 포함 (failed 시 30줄) | ✅   |
| update_deploy_plan 전체 plan 반환                        | ✅   |
| compose plan 라우팅 수정 (preferDockerfile 버그)         | ✅   |
| env regex 버그 수정 (\s\*가 \n 삼킴)                     | ✅   |
| env redaction 버그 수정 ([REDACTED] → 실제 값 저장)      | ✅   |
| deploy_environment 모드 전환 방지 (dockerfile_path 보존) | ✅   |
| 서브디렉토리 Dockerfile build context 자동 감지          | ✅   |
| Docker Compose 최소 버전 요구 (V2.3.0)                   | ✅   |

---

### v0.6.8 — Database Refactor ✅

**상태**: 완료 | **관련 문서**: `.sisyphus/plans/db-refactor.md`

> **핵심 가치**: 1708줄 God Object (`src/db/index.ts`) → 13개 도메인별 Repository 클래스 + 146줄 위임 파사드. 100% 하위호환성 유지.

| 항목                                               | 상태 |
| -------------------------------------------------- | ---- |
| ProjectRepo, EnvironmentRepo, EnvVarRepo 추출      | ✅   |
| GlobalSecretRepo, SecretFileRepo, ServiceRepo 추출 | ✅   |
| DeployLogRepo, TimelineRepo, ChatRepo 추출         | ✅   |
| DomainMappingRepo, OAuthRepo, WebhookRepo 추출     | ✅   |
| DeployPlanRepo 추출                                | ✅   |
| Row 타입 통합 (src/db/types.ts)                    | ✅   |
| 마이그레이션 로직 추출 (src/db/migration.ts)       | ✅   |
| 위임 파사드 (src/db/index.ts 146줄)                | ✅   |
| 소비자 파일 변경 없음 (100% 하위호환성)            | ✅   |
| 테스트 1419개 통과, 빌드 성공, tsc 성공            | ✅   |

---

### v0.6.9 — MCP Integration Bugfixes ✅

**상태**: 완료 | **관련 문서**: `.sisyphus/plans/mcp-bugfix.md`

> **핵심 가치**: DB 리팩토링 후 MCP 연동 깨진 4가지 버그 수정. Compose 배포 완료 인식, --progress 호환성, 원격 Docker IP 감지, 서비스 상태 동기화.

| 항목                                                     | 상태 |
| -------------------------------------------------------- | ---- |
| executePlan compose:up/compose:failed 이벤트 리스너 추가 | ✅   |
| --progress=plain 플래그 버전 체크 후 조건부 적용         | ✅   |
| DOCKER_HOST 환경변수에서 IP 자동 추출 (tcp/ssh)          | ✅   |
| 컨테이너 없는 서비스 'error' 상태 마킹 + log.warn        | ✅   |
| 테스트 1434개 통과, 빌드 성공, tsc 성공                  | ✅   |

---

### v0.6.11 — Deploy Hardening & QA ✅

**상태**: 완료

> **핵심 가치**: QA 과정에서 발견된 배포 안정성 문제 수정 + 운영 가시성 개선. 디스크 부족 사전 차단, 서비스 헬스체크, 내부 통신 지원.

| 항목                                                       | 상태 |
| ---------------------------------------------------------- | ---- |
| Dockerfile monorepo 라우팅 수정 (특정 dockerfile → single) | ✅   |
| --progress=plain 완전 제거                                 | ✅   |
| build_context DB 영속화 + restart 보존                     | ✅   |
| compose 자식 프로젝트 절대경로 크래시 수정                 | ✅   |
| resolved-failure 갭 수정 (deploy log 누락 방지)            | ✅   |
| 디스크 부족 시 preflight 실패 (0.5GB 미만)                 | ✅   |
| list_projects containerName 필드 추가                      | ✅   |
| 서비스 헬스 감지 (Docker health + 로그 PANIC/ERROR 스캔)   | ✅   |
| get_env_var 비마스킹 조회 도구                             | ✅   |
| get_deploy_status 빌드 중 buildLogTail 노출                | ✅   |
| get_build_log DEPLOY_IN_PROGRESS 상태 반환                 | ✅   |
| 빌드 실패 로그 30줄 → 100줄 확대                           | ✅   |

---

### v0.7.0 — Compose Rewrite (dockerode Direct) ✅

**상태**: 완료 | **관련 문서**: `.sisyphus/plans/compose-to-dockerode.md`

> **핵심 가치**: Docker Compose CLI 제거 → dockerode 직접 빌드/실행 전환. 오버헤드 제거, 에러 처리 개선, 고아 컨테이너 정리 자동화.

| 항목                                                | 상태 |
| --------------------------------------------------- | ---- |
| dockerode compose 빌드 (docker build + docker run)  | ✅   |
| Docker Compose CLI 제거 (compose.ts 리팩)           | ✅   |
| 고아 자식 컨테이너 정리 (orphan cleanup)            | ✅   |
| Compose YAML 확장 (x-openlander 라벨)               | ✅   |
| 프로젝트별 Docker 네트워크 격리 (ol-{name}-network) | ✅   |
| 테스트 1600+ 통과, 빌드 성공, tsc 성공              | ✅   |

---

### v0.7.1 — MCP Agent Guidance System ✅

**상태**: 완료

> **핵심 가치**: AI 에이전트가 MCP 도구 실행 후 docker CLI나 curl localhost로 빠지는 문제 해결. `_agent_guidance.next_steps[]` 통합 필드 + `docker_host` 팩트 기반 접근으로 에이전트를 올바른 다음 행동으로 유도.

| 항목                                                            | 상태 |
| --------------------------------------------------------------- | ---- |
| `getDockerHostType()` 유틸 함수 (`local`/`remote` 감지)         | ✅   |
| `_agent_guidance.next_steps[]` 통합 가이드 필드 (10개 도구)     | ✅   |
| `docker_host` 팩트 필드 (`get_deploy_status` done/failed)       | ✅   |
| `SERVER_INSTRUCTIONS`에 원격 Docker 규칙 한 줄 추가             | ✅   |
| description에서 "Docker host may be remote" 산문 경고 전부 제거 | ✅   |

---

### v0.7.3 — AI-Native Deploy ✅

**상태**: 완료

> **핵심 가치**: AI-native 플랫폼만 할 수 있는 차별화 기능. 에이전트 토큰 절약, 배포 전 실수 방지, 실패 시 즉시 진단.

| 항목                                                                        | 상태 |
| --------------------------------------------------------------------------- | ---- |
| `deploy` 원콜 도구 (create_plan → execute → wait 체이닝, 토큰 60-70% 절약)  | ✅   |
| `validate_deploy_plan` 사전 검증 (localhost 감지, placeholder, HEALTHCHECK) | ✅   |
| `auto_diagnosis` 실패 응답 포함 (category, tier, cause, suggested_action)   | ✅   |
| `get_deploy_status` 실패 시 auto_diagnosis 노출                             | ✅   |

---

### v0.7.2 — MCP DX Enhancement ✅

**상태**: 완료

> **핵심 가치**: MCP 클라이언트 경험 개선. 모든 64개 도구에 `mcpDescription` 추가, 에러 처리 패턴 통일, 상태 변경 도구에 구조화된 다음 단계 가이드 추가, 고아 도구 연결 체인 구성.

| 항목                                                                   | 상태 |
| ---------------------------------------------------------------------- | ---- |
| `mcpDescription` 모든 64개 도구에 추가 (간결한 목적 설명)              | ✅   |
| 에러 처리 통일 (throw 패턴, MCP `isError: true`)                       | ✅   |
| `_agent_guidance` 상태 변경 도구 (stop/remove/rollback/blue-green 등)  | ✅   |
| 고아 도구 연결 (preview→list_previews, webhook→get_webhook_config 등)  | ✅   |
| `deploy_monorepo` 폐기 (orchestrate_deploy로 유도)                     | ✅   |
| `SERVER_INSTRUCTIONS` 업데이트 (orchestrate_deploy 우선, wait=true 등) | ✅   |

---

### v0.7.3 — Deploy Pipeline Refactor + Bugfixes ✅

**상태**: 완료

> **핵심 가치**: deploy-core.ts의 519줄/433줄 거대 함수 분해. scan_dockerfiles/analyze_infrastructure/get_logs 버그 수정.

| 항목                                                  | 상태 |
| ----------------------------------------------------- | ---- |
| `deployEnvironment()` 오케스트레이션 추출 (519→251줄) | ✅   |
| `deployMonorepo()` 오케스트레이션 추출 (433→177줄)    | ✅   |
| `scan_dockerfiles` Dockerfile.\* 패턴 감지            | ✅   |
| `analyze_infrastructure` Python + 모노레포 지원       | ✅   |
| `get_logs` Docker multiplex 헤더 제거                 | ✅   |

---

### v0.6.15 — Deploy UX Quick Wins ✅

**상태**: 완료 | **관련 문서**: `.sisyphus/plans/deploy-ux-quick-wins.md`

> **핵심 가치**: MCP/배포 UX에서 반복적으로 불편했던 정보를 더 빨리, 더 정확하게 노출. 빌드 step 진행률, env source 추적, 내부 URL 가이드, MCP 설명 강화, 세션 정리까지 운영 피드백 기반 개선.

| 항목                                                    | 상태 |
| ------------------------------------------------------- | ---- |
| `get_deploy_status`에 Docker build step 진행률 추가     | ✅   |
| `list_env_vars(environment_name)` source 추적 추가      | ✅   |
| `create_deploy_plan` 응답에 `internal_url` 가이드 추가  | ✅   |
| MCP HTTP heartbeat/TTL/shutdown cleanup 보강            | ✅   |
| 핵심 MCP 도구 설명 보강 (compose 범위, env priority 등) | ✅   |
| 테스트 1578개 통과, `npm run typecheck` 통과            | ✅   |

---

### v0.6.10 — Deploy Pipeline Bugfixes ✅

**상태**: 완료 | **관련 문서**: `.sisyphus/plans/deploy-bugfixes.md`

> **핵심 가치**: 배포 파이프라인 5가지 UX 버그 수정 + dockerfile_path 라우팅 버그 수정. 컨테이너 충돌 오진단, agent/fallback 레이스, 질문 UI 렌더링, env var optional 감지, AI 에러 분석 다국어.

| 항목                                                         | 상태 |
| ------------------------------------------------------------ | ---- |
| dockerfile_path 제공 시 compose 감지 스킵 (라우팅 버그 수정) | ✅   |
| 컨테이너 이름 충돌 recipe 추가 + version-obsolete 후순위     | ✅   |
| env var optional/required 구분 (fallback value 감지)         | ✅   |
| BuildDebugger locale parameter + hot-reload                  | ✅   |
| agent/fallback 레이스 컨디션 방지 (thinking 이벤트 인식)     | ✅   |
| question 이벤트 핸들러 추가 (XML 렌더링 방지)                | ✅   |
| 프론트엔드 optional env var 뱃지                             | ✅   |
| 테스트 1460개 통과, 빌드 성공, tsc 성공                      | ✅   |

---

### v1.0.0 — Stable Release (TBD)

**상태**: TBD — 품질 안정화 진행 중 | **관련 문서**: [`release/v1.0.0-ai-copilot.md`](release/v1.0.0-ai-copilot.md)

> **핵심 가치**: AI를 에러 시 소방관에서, 배포 전체 라이프사이클의 "조용한 부조종사"로 전환.
> **관련 결정**: DEC-033 (AI 기능 전체 재설계), DEC-034 (인라인 AI 안 B 채택)

| Phase | 항목                         | 내용                                                                      | 상태 |
| ----- | ---------------------------- | ------------------------------------------------------------------------- | ---- |
| 1     | F-A: AI 자동 복구            | deploy:failed → agent.chatStream → 복구 시도 (최대 3회) — 기존 기능 강화  | ✅   |
| 1     | F-B: 자동 장애 리포트        | recovery:success/exhausted → Slack/Discord/Telegram 채널 브로드캐스트     | ✅   |
| 1     | F-C: 롤백 자동 제안          | 배포 후 60초간 헬스 감시 → 연속 3회 실패 시 rollback:suggested 이벤트     | ✅   |
| 1     | F-D: 환경변수 변경 감지      | 리디플로이 시 .env.example 스캔 → 새 키 발견 시 agent가 값 요청           | ✅   |
| 1     | F-E: 포스트모템 자동 생성    | recovery 후 마크다운 포스트모템 자동 생성 (success/exhausted)             | ✅   |
| 1     | F-F: 시크릿 스캔             | clone 후 하드코딩 API 키/자격증명 감지 (12개 패턴)                        | ✅   |
| 1     | F-G: 성공 인사이트 강화      | 빌드 시간 20% 임계값 비교, 이전 대비 인사이트 표시                        | ✅   |
| 2     | F-H: 인라인 AI 표시          | 빌드 실패 후 AI 분석이 같은 타임라인 흐름에서 인라인 렌더링 (안 B)        | ✅   |
| 2     | PostmortemCard UI            | 포스트모템 마크다운 뷰어 커포넌트 (expand/collapse)                       | ✅   |
| 3     | Oracle 코드 리뷰 수정        | 보안(동시성 직렬화), 신뢰성(타임아웃 증가), 리소스 정리(stop/unsubscribe) | ✅   |
| 3     | AI co-pilot 테스트           | secret-scan, postmortem, rollback-watcher — 50+ 신규 테스트               | ✅   |
| 4     | P0-1: questionBridge fix     | hot-reload 시 createTools()에 questionBridge 누락 수정 (4곳)              | ✅   |
| 4     | P0-2: 채널 스트리밍          | chatStream() + editMessage + sendInteractive (Slack/Discord/Telegram)     | ✅   |
| 4     | P1-1: MCP agent_execute_goal | 외부 클라이언트에서 고수준 목표 위임 → 에이전트 추론                      | ✅   |
| 4     | P1-2: 배포 오케스트레이터    | Kahn's topo sort + atomic rollback + 오케스트레이션 이벤트                | ✅   |
| 4     | P1-3: UI 도구 결과 카드      | tool_result structured display (백엔드+프론트엔드)                        | ⬜   |

**구현 내역** (18개 파일 신규/변경, 1346행 추가):

- `src/monitor/incident-reporter.ts` — 신규: 장애 리포트 생성 + 채널 브로드캐스트
- `src/monitor/postmortem.ts` — 신규: LLM 기반 포스트모템 마크다운 생성기
- `src/monitor/rollback-watcher.ts` — 신규: 배포 후 헬스 감시 → 롤백 제안
- `src/pipeline/secret-scan.ts` — 신규: 코드 내 하드코딩 시크릿 감지 (12개 패턴)
- `src/channels/base.ts` — ChannelManager.broadcast() 추가
- `src/app.ts` — 복구 결과 추적, 모듈 연결, 동시성 직렬화, 리소스 정리
- `src/events/index.ts` — recovery/secret/rollback 이벤트 타입 추가
- `web/src/components/timeline/PostmortemCard.tsx` — 신규: 포스트모템 UI
- `web/src/components/timeline/TimelineFeed.tsx` — 인라인 AI 분석 렌더링
- `web/src/components/timeline/TimelineItem.tsx` — AI 인사이트 카드 타입 추가
- `test/secret-scan.test.ts`, `test/postmortem.test.ts`, `test/rollback-watcher.test.ts` — 50+ 신규 테스트

**에이전트 강화 스프린트** (15개 파일 신규/변경, 2,000+ 행 추가):

- `src/mcp/server.ts` — agent_execute_goal 스키마 + 핸들러, questionBridge 수정
- `src/channels/base.ts` — chatStream 전환, editMessage, sendInteractive, QuestionBridge 연동
- `src/channels/slack.ts` — editMessage(chat.update), sendInteractive(blocks), interaction 핸들러
- `src/channels/discord.ts` — editMessage(PATCH), sendInteractive(ActionRow), MESSAGE_COMPONENT 핸들러
- `src/channels/telegram.ts` — editMessage(editMessageText), sendInteractive(InlineKeyboard), callback_query
- `src/pipeline/orchestrator.ts` — 신규: DeployOrchestrator (Kahn's sort, atomic rollback)
- `src/agent/tools.ts` — orchestrate_deploy 도구 추가
- `src/agent/prompts.ts` — 오케스트레이터 도구 설명
- `src/tools/registry.ts` — orchestrate_deploy 등록
- `src/events/index.ts` — 오케스트레이션 이벤트 타입 추가
- `test/orchestrator.test.ts` — 신규: 8 테스트 (topo sort, rollback, cycles)
- `test/channels.test.ts` — 스트리밍/인터랙티브 테스트 추가

### 정식 릴리즈 (v1.0.0 — TBD)

**상태**: 품질 안정화 진행 중 — 도그푸딩에서 다수 버그/개선점 발견

v0.6.3까지의 기능을 안정화하고 품질 검증 완료 후 릴리즈 예정. 날짜 미정.

#### 필수 품질 항목 (4건 전부 완료) ✅

| #   | 항목                        | 내용                                                                                                      | 우선순위  | 상태 |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------- | --------- | ---- |
| Q-1 | E2E 시나리오 테스트         | 수동 도그푸딩 체크리스트 20개 시나리오 (`docs/planning/release-checklist.md`). 릴리즈 전 1회 수동 실행    | 🔴 high   | ✅   |
| Q-2 | 이벤트 배선 검증            | `test/event-wiring.test.ts` — 정적 소스 스캔으로 emit↔subscribe 교차 검증. allow-list 기반 dead wire 감지 | 🔴 high   | ✅   |
| Q-3 | Config 조합 매트릭스 테스트 | `test/git-clone.test.ts` — SSH retry, 에러 분류, URL 변환, 호스트별 분기 등 11개 테스트 추가 (689→703)    | 🟠 medium | ✅   |
| Q-4 | AI co-pilot 테스트          | secret-scan, postmortem, rollback-watcher — 50+ 신규 테스트 (703→753)                                     | 🔴 high   | ✅   |

> **배경**: v0.2.0 도그푸딩에서 SSH+토큰 충돌, compose 이벤트 미연결, dead code 등 모듈 간 연결 버그가 반복 발견됨.
> 단위 테스트 783개 전부 통과해도 이런 통합 버그를 못 잡는 구조적 한계 → Q-2/Q-3/Q-4 자동 테스트 + Q-1 수동 체크리스트로 해결.

#### 정식 릴리즈 이후 로드맵 (경쟁사 대비 갭 — 실수요 발생 시 진행)

| #   | 항목                     | 내용                                                                                                | 우선순위  |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------- | --------- |
| F-1 | 웹 터미널                | xterm.js + WebSocket. 컨테이너 `docker exec` 셸 접근. 없어도 SSH로 가능하나 디버깅 편의성 향상      | 🟡 medium |
| F-2 | 자동 SSL (Let's Encrypt) | CF Tunnel 안 쓰는 사용자 대응. Traefik ACME 설정 추가 수준. CF Tunnel 권장 환경에서는 불필요        | 🟡 medium |
| F-3 | 멀티 서버                | Docker Swarm 모드 추가. 아키텍처 대공사 (Docker API, DB, Traefik, Tunnel 전부 변경). 실수요 시 진행 | 🟠 low    |
| F-4 | 팀/RBAC                  | 멀티 유저 + 역할 기반 접근 제어. 혼자 쓰는 타겟에서는 불필요. 팀 사용자 늘면 진행                   | 🟠 low    |
| F-5 | One-Click 앱 마켓        | 템플릿 기반 원클릭 배포. AI가 알아서 배포하는 게 우리 포지셔닝이라 우선순위 낮음                    | 🟠 low    |

> **기준**: 경쟁사(Coolify, Dokploy, CapRover, Easypanel) 대비 부족하지만, 현재 타겟(혼자 운영, CF Tunnel)에서는 급하지 않은 기능들.

---

### 로컬 LLM & 파인튜닝 (TBD — 정식 릴리즈 이후)

**상태**: 미래 스펙, 미착수 | **관련 문서**: `requirements.md` L425~429

| 항목                   | 내용                                 | 상태 |
| ---------------------- | ------------------------------------ | ---- |
| 파인튜닝 모델 공개     | openlander-agent-8b (HuggingFace)    | 📋   |
| Ollama 원클릭          | `ollama pull openlander-agent`       | 📋   |
| LLM API 비용 완전 제거 | 서브에이전트 구조에서 로컬 모델 활용 | 📋   |

> **연기 사유**: 로컬 LLM은 정식 릴리즈 이후 서브에이전트 아키텍처 도입 시 효과가 극대화됨. 현 단계에서는 BYOK(Gemini Flash 무료) 방식으로 충분.

---

---

## 미해결 항목 총정리

| #      | 항목                                   | 버전                 | 문서                                   | 우선순위                                         |
| ------ | -------------------------------------- | -------------------- | -------------------------------------- | ------------------------------------------------ |
| ~~1~~  | ~~i18n (다국어 지원)~~                 | v0.2.1               | 11 commits on main                     | ✅ Web i18n 구현 완료                            |
| ~~2~~  | ~~프로젝트 검색/필터~~                 | v0.0.6               | `archive/requirements.md`              | ❌ 제거 (TUI 아카이브)                           |
| 3      | ~~전체 컨테이너 스캔~~                 | v0.0.9               | `v0.0.9/server-awareness.md` 9-1       | ✅ 완료                                          |
| 4      | ~~OS 레벨 포트 스캔~~                  | v0.0.9               | `v0.0.9/server-awareness.md` 9-2       | ✅ 완료                                          |
| 5      | ~~리버스 프록시 감지~~                 | v0.0.9               | `v0.0.9/server-awareness.md` 9-3       | ✅ 완료                                          |
| 6      | ~~시스템 프롬프트 확장~~               | v0.0.9               | `v0.0.9/server-awareness.md` 9-4       | ✅ 완료                                          |
| 7      | ~~에이전트 도구 3개 추가~~             | v0.0.9               | `v0.0.9/server-awareness.md` 9-5       | ✅ 완료                                          |
| 8      | ~~Dashboard Server 섹션~~              | v0.0.9               | `v0.0.9/server-awareness.md` 9-6       | ✅ 완료                                          |
| 9      | ~~Preflight Check~~                    | v0.0.9               | `v0.0.9/server-awareness.md` 9-7       | ✅ 완료                                          |
| ~~10~~ | ~~Global Secrets + 암호화~~            | v0.0.10              | `v0.0.10/env-secrets.md` 10-1          | ✅ 완료                                          |
| ~~11~~ | ~~.env.example 감지~~                  | v0.0.10              | `v0.0.10/env-secrets.md` 10-2          | ✅ 완료                                          |
| ~~12~~ | ~~환경변수 도구 추가~~                 | v0.0.10              | `v0.0.10/env-secrets.md` 10-3          | ✅ 완료                                          |
| ~~13~~ | ~~/env 오버레이 확장~~                 | v0.0.10              | `v0.0.10/env-secrets.md` 10-4          | ✅ 완료                                          |
| ~~14~~ | ~~Vercel AI SDK 마이그레이션~~         | v0.0.8               | `v0.0.8/vercel-ai-sdk-migration.md`    | ✅ 완료                                          |
| 15     | 파인튜닝 모델                          | TBD(정식릴리즈 이후) | `requirements.md` L425~429             | 미래                                             |
| ~~16~~ | ~~Post-Deploy Insight~~                | v0.0.11              | `v0.0.11/agent-proactivity.md` 11-1    | ✅ 완료                                          |
| ~~17~~ | ~~Anomaly Nudge~~                      | v0.0.11              | `v0.0.11/agent-proactivity.md` 11-2    | ✅ 완료                                          |
| ~~18~~ | ~~Smart Defaults~~                     | v0.0.11              | ✅                                     |
| ~~19~~ | ~~Idle Scan~~                          | v0.0.11              | ❌                                     |
| ~~20~~ | ~~온보딩 CLI 리팩토링~~                | v0.0.9               | `v0.0.9/onboarding-refactor.md`        | ⏸️ 보류 (DEC-017)                                |
| ~~21~~ | ~~OAuth 인프라 (DB + 토큰 + 라우트)~~  | v0.0.12              | `v0.0.12/provider-oauth.md` 인프라     | ✅ 완료                                          |
| ~~22~~ | ~~OpenAI OAuth PKCE~~                  | v0.0.12              | `v0.0.12/provider-oauth.md` 12-1       | ✅ 완료                                          |
| ~~23~~ | ~~OpenRouter OAuth PKCE~~              | v0.0.12              | `v0.0.12/provider-oauth.md` 12-2       | ✅ 완료                                          |
| ~~24~~ | ~~Anthropic/Gemini 안내 개선~~         | v0.0.12              | `v0.0.12/provider-oauth.md` 12-3,4     | ✅ 완료                                          |
| ~~25~~ | ~~프론트엔드 OAuth 통합~~              | v0.0.12              | `v0.0.12/provider-oauth.md` 통합       | ✅ 완료                                          |
| ~~26~~ | ~~Web MVP Phase 1~~                    | v0.1.0               | `v0.1.0/web-mvp.md` Phase 1            | ✅ 완료                                          |
| ~~27~~ | ~~Web MVP Phase 2~~                    | v0.1.0               | `v0.1.0/web-mvp.md` Phase 2            | ✅ 완료                                          |
| ~~28~~ | ~~Web MVP Phase 3~~                    | v0.1.0               | `v0.1.0/web-mvp.md` Phase 3            | ✅ 완료                                          |
| ~~29~~ | ~~TUI Freeze~~                         | v0.1.0               | `v0.1.0/web-mvp.md` §3.4.4             | ✅ 완료                                          |
| ~~30~~ | ~~Web Deploy Agent 경유~~              | v0.1.0               | `v0.1.0/web-deploy-agent-mediated.md`  | 🧪 구현 완료, 도그푸딩 대기                      |
| ~~31~~ | ~~Dashboard Redesign Phase 1~~         | v0.2.0               | `v0.2.0/dashboard-redesign.md` Phase 1 | ✅ 완료                                          |
| ~~32~~ | ~~Dashboard Redesign Phase 2~~         | v0.2.0               | `v0.2.0/dashboard-redesign.md` Phase 2 | ✅ 완료                                          |
| ~~33~~ | ~~Dashboard Redesign Phase 3~~         | v0.2.0               | `v0.2.0/dashboard-redesign.md` Phase 3 | ✅ 완료                                          |
| ~~34~~ | ~~Dashboard Redesign Phase 4~~         | v0.2.0               | `v0.2.0/dashboard-redesign.md` Phase 4 | ✅ 완료                                          |
| ~~35~~ | ~~Dockerfile 자동 수정 루프~~          | v0.1.0               | `v0.1.0/dockerfile-fix-loop.md`        | ✅ 완료                                          |
| ~~36~~ | ~~BUG-014: ask_user_question 멈춤~~    | v0.2.0               | `v0.2.0/bugs.md`                       | ✅ 해결                                          |
| ~~37~~ | ~~BUG-015: 에이전트 스트리밍 미노출~~  | v0.2.0               | `v0.2.0/bugs.md`                       | ✅ 해결                                          |
| ~~38~~ | ~~BUG-016: Running 타임라인 비어있음~~ | v0.2.0               | `v0.2.0/bugs.md`                       | ✅ 해결                                          |
| ~~39~~ | ~~BUG-017: 로그 미니 패널~~            | v0.2.0               | `v0.2.0/bugs.md`                       | ✅ 해결                                          |
| ~~40~~ | ~~E2E 시나리오 테스트 (Q-1)~~          | 정식 릴리즈          | `version-map.md` 정식 릴리즈 섹션      | 🔧 스펙 정의 완료                                |
| ~~41~~ | ~~이벤트 배선 검증 (Q-2)~~             | 정식 릴리즈          | `version-map.md` 정식 릴리즈 섹션      | 🔧 스펙 정의 완료                                |
| ~~42~~ | ~~Config 조합 매트릭스 테스트 (Q-3)~~  | 정식 릴리즈          | `version-map.md` 정식 릴리즈 섹션      | 🔧 스펙 정의 완료                                |
| 43     | **자동 복구 (Auto-Recovery)**          | v0.2.0               | `version-map.md` v0.2.0 섹션           | ✅ 완료 (E2E 검증)                               |
| ~~44~~ | ~~i18n 백엔드 + 프론트엔드 + 온보딩~~  | v0.2.1               | 11 commits on main                     | ✅ 완료                                          |
| ~~45~~ | ~~빌드 에러 리포팅 버그~~              | v0.2.1               | 11 commits on main                     | ✅ 해결                                          |
| ~~46~~ | ~~Redeploy UI 갱신 버그~~              | v0.2.1               | 11 commits on main                     | ✅ 해결                                          |
| ~~47~~ | ~~Traefik Cutover~~                    | v0.6.2               | `version-map.md` v0.2.2 섹션           | ✅ HTTP Provider로 마이그레이션 완료             |
| 48     | **롤백 버튼 UI**                       | v0.2.2               | `version-map.md` v0.2.2 섹션           | ✅ v0.2.2에서 구현 완료                          |
| 49     | **블루-그린 배포 UI**                  | v0.2.2               | `version-map.md` v0.2.2 섹션           | ✅ v0.2.2에서 구현 완료                          |
| 50     | **Webhook 설정 UI + API**              | v0.2.2               | `version-map.md` v0.2.2 섹션           | ✅ v0.2.2에서 구현 완료                          |
| 51     | ~~**프로젝트 Start 버튼**~~            | v0.2.3               | `version-map.md` v0.2.3 섹션           | ~~MCP-first 전환으로 불필요 (DEC-037)~~          |
| 52     | **도메인 매핑 CRUD UI**                | v0.2.3               | `version-map.md` v0.2.3 섹션           | ✅ v0.2.3에서 구현 완료                          |
| 53     | **서버 상태 스캔 UI**                  | v0.2.4               | `version-map.md` v0.2.4 섹션           | ✅ v0.2.4에서 구현 완료                          |
| 54     | ~~**리소스 모니터링 UI**~~             | v0.2.4               | `version-map.md` v0.2.4 섹션           | ~~MCP-first. 모니터링은 web에 있음 (DEC-037)~~   |
| 55     | ~~**프리뷰 배포 UI**~~                 | v0.2.5               | `version-map.md` v0.2.5 섹션           | ~~백엔드 완료. MCP-first로 UI 불필요 (DEC-037)~~ |
| 56     | ~~**DB 프로비저닝 UI**~~               | v0.2.5               | `version-map.md` v0.2.5 섹션           | ~~MCP에서 provision_database로 대체 (DEC-037)~~  |
| 57     | ~~**DB 백업 (S3)**~~                   | v0.2.5               | `version-map.md` v0.2.5 섹션           | ~~미정~~                                         |
| F-1    | 웹 터미널                              | 정식 릴리즈 이후     | `version-map.md` 정식 릴리즈 섹션      | 🟡 실수요 시                                     |
| F-2    | 자동 SSL (Let's Encrypt)               | 정식 릴리즈 이후     | `version-map.md` 정식 릴리즈 섹션      | 🟡 실수요 시                                     |
| F-3    | 멀티 서버                              | 정식 릴리즈 이후     | `version-map.md` 정식 릴리즈 섹션      | 🟠 실수요 시                                     |
| F-4    | 팀/RBAC                                | 정식 릴리즈 이후     | `version-map.md` 정식 릴리즈 섹션      | 🟠 실수요 시                                     |
| F-5    | One-Click 앱 마켓                      | 정식 릴리즈 이후     | `version-map.md` 정식 릴리즈 섹션      | 🟠 실수요 시                                     |

---

## 문서 아카이브 이력

| 날짜    | 조치                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------- |
| 2026-02 | `v0.0.9-10-unified-spec.md` → `archive/` 이동 (v0.0.9/v0.0.10으로 분리)                           |
| 2026-03 | v0.0.6 스펙 3개, v0.0.7 스펙 3개, analysis 2개, onboarding-refactor, requirements.md → `archive/` |
| &nbsp;  | 이유: TUI freeze (v0.1.0) + Web pivot 후 TUI 시대 문서 무효화. README.md 현행화 완료.             |
| 2026-03 | `v0.0.9/dogfooding.md` → `archive/dogfooding-v0.0.9.md` 이동 (v0.2.0 도그푸딩 시작으로 아카이브)  |

---

## 검증 기준

**2026-03-19 기준 (v0.6.3)**:

```

✅ npm run build — 성공
✅ vitest — 1014+ pass
✅ lsp_diagnostics — 0 errors
✅ v0.6.1 — env vars merge fix, list_env_vars, healthcheck Docker fallback
✅ v0.6.2 — compose service filtering, secret file mount, env escaping,
build log detail, redeploy port fix, Traefik HTTP Provider
✅ v0.6.3 — port stability on redeploy, environments port tracking, public URL API fix

```

---

## 버그 워크플로우

```

사용자 "이거 안 돼"
↓
AI: version-map.md에서 관련 버전/스펙 찾기
↓
AI: bugs.md "활성 버그"에 BUG-NNN 추가
↓
AI: gh issue create --label "bug,[version]" (버그 이슈 생성)
↓
AI: 버그 수정 + npm test 통과
↓
AI: bugs.md → 해결됨 + gh issue close

```

**참조**: `v0.0.9/bugs.md` 워크플로우 섹션, `.opencode/instructions.md` §9

**GitHub Issues Labels**: `bug`, `v0.0.6`~`v0.0.10`, `priority:high`, `priority:low`

---

### v0.1.0 — Web MVP ✅

**상태**: 구현 완료 | **관련 문서**: [`v0.1.0/web-mvp.md`](v0.1.0/web-mvp.md), [`v0.1.0/tech-lead-review.md`](v0.1.0/tech-lead-review.md), [`v0.1.0/web-deploy-agent-mediated.md`](v0.1.0/web-deploy-agent-mediated.md), [`v0.1.0/dockerfile-fix-loop.md`](v0.1.0/dockerfile-fix-loop.md)

> **핵심 가치**: TUI→Web pivot. 웹을 **히어로 화면**으로 하여, **“repo 연결해서 딸깍”** — Connect repo, click, done. Agent handles everything in background.

**UI/UX 디자인**: [`docs/design/web-mvp-ui-ux.md`](../../design/web-mvp-ui-ux.md)

| Phase                  | 내용                                                                          | 상태                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --- |
| Phase 0 — Architecture | TUI freeze, SPA serving, React Router, build verification                     | ✅                                                                            |
| Phase 1 — Core         | Theme, Layout, Projects Grid, New Project, Timeline, NDJSON Streaming         | ✅                                                                            |
| Phase 2 — Essential    | Agent Intervention (full-stack), Log Viewer, Config (env+domains), Onboarding | ✅                                                                            |
| Phase 3 — Polish       | Chat (Cmd+.), Settings, Command Palette (Cmd+K), Motion, Responsive           | ✅                                                                            |
|                        | **추가 보완 스펙**                                                            | Dockerfile 자동 수정 루프 (에이전트 경유) — Next.js 15/Node 18 등 케이스 해결 | ✅  |

**Architecture Tasks**:

| 항목                                                        | 상태 |
| ----------------------------------------------------------- | ---- |
| SPA Serving from Hono Daemon                                | ✅   |
| NDJSON Event Type 확장 (6종)                                | ✅   |
| CLI-lite Commands (deploy, status, logs, open, projects ls) | ✅   |
| TUI Freeze (git tag `tui-last` @ e927b30)                   | ✅   |

**의사결정 기록**: [`references/decision-log.md`](../../references/decision-log.md)

---

### v0.8.0 — MCP-First Web Pivot (2026-03-21)

**상태**: ✅ 완료 | **관련 문서**: `.sisyphus/plans/web-mcp-pivot.md`

> **핵심 가치**: 웹 대시보드를 AI 어시스턴트 UI에서 모니터링 중심으로 전환. LLM을 옵셔널화하여 Docker만으로 서버 시작 가능. 자동 복구를 이중 모드(LLM/프로그래밍)로 구현.

| 항목                                | 내용                                                                                         | 상태 |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | ---- |
| 웹 AI 어시스턴트 UI 제거            | ChatInput, ChatMessageList, ToolCallGroup, ThinkingIndicator 등 8개 컴포넌트 삭제            | ✅   |
| AI 타임라인 카드 제거               | ErrorAnalysisCard, InsightCard, PostmortemCard, DockerfileFixedCard, FixProposalCard 삭제    | ✅   |
| AI 웹 라우트 제거                   | chat-routes.ts (POST /agent/chat), auth-routes.ts (OpenAI/OpenRouter OAuth) 삭제             | ✅   |
| AI API 함수 제거                    | debugBuild(), chatWithAgent(), getPostmortem() 프론트엔드 api.ts에서 제거                    | ✅   |
| src/agent/ 디렉토리 정리            | Agent 클래스 → src/llm/agent.ts, BuildDebugger → src/pipeline/build-debugger.ts 이동 후 삭제 | ✅   |
| RecoveryCard 타임라인 컴포넌트 추가 | 자동 복구 이벤트(start, success, failed, exhausted) 타임라인 표시                            | ✅   |
| 시스템 상태 바 추가                 | 대시보드에 Docker, Traefik, MCP 상태 표시                                                    | ✅   |
| 옵셔널 API 키 설정                  | 설정 및 온보딩 플로우 단순화 — Docker 체크 → GitHub(선택) → API 키(선택)                     | ✅   |
| 자동 복구 이중 모드                 | LLM 모드(에이전트 분석) + 프로그래밍 모드(레시피 매칭 + 단일 재시도)                         | ✅   |

---

### v0.9.0 — Web Agent Mode (2026-03-21)

**상태**: ✅ 완료 | **관련 문서**: `.sisyphus/plans/web-agent-mode.md`

> **핵심 가치**: 웹 대시보드에 ChatGPT 스타일의 AI 에이전트 모드 추가. 풀스크린 채팅 인터페이스, 실시간 도구 호출 시각화, 멀티 세션 지원, 마크다운 렌더링.

| 항목                 | 내용                                                           | 상태 |
| -------------------- | -------------------------------------------------------------- | ---- |
| 에이전트 모드 UI     | 풀스크린 채팅 인터페이스, 사이드바 모드 토글 (Dashboard/Agent) | ✅   |
| NDJSON 스트리밍 채팅 | 실시간 도구 호출 시각화, 접이식 도구 호출 카드 (인자/결과)     | ✅   |
| 멀티 세션 지원       | 서버 측 DB 영속성, 세션 생성/전환/삭제                         | ✅   |
| 마크다운 렌더링      | react-markdown + rehype-highlight 코드 신택스 하이라이팅       | ✅   |
| 에이전트 질문 UI     | 클릭 가능한 옵션 버튼, 빈 상태 제안 칩                         | ✅   |
| LLM 미설정 게이트    | Settings 리다이렉트 포함                                       | ✅   |
| 세션 관리 API        | 6개 신규 라우트 (채팅 스트리밍, 질문 처리, 세션 관리)          | ✅   |
| Agent 클래스 확장    | 세션 전환 + 비동기 뮤텍스 동시 접근 안전성                     | ✅   |
| Database 확장        | ChatRepo, Database, SessionStore에 deleteSession() 추가        | ✅   |
| E2E 테스트           | Playwright 에이전트 모드 네비게이션 테스트                     | ✅   |

---

### v0.9.1 — Dashboard UX Polish (2026-03-22)

**상태**: ✅ 완료 | **관련 문서**: `.sisyphus/plans/dashboard-ux-polish.md`

> **핵심 가치**: 대시보드 UI/UX 세부 개선. 테이블 뷰 토글, 콘솔 로그 색상 강조, 사이드바 에러 섹션 시각화, 배포 트리거 라벨 구분, 시스템 이슈 드롭다운, 배포 터미널 공간 최적화.

| 항목                 | 내용                                                       | 상태 |
| -------------------- | ---------------------------------------------------------- | ---- |
| 테이블 뷰 토글       | 카드/테이블 뷰 전환, localStorage 영속성                   | ✅   |
| 콘솔 로그 색상       | 에러 빨강, 경고 노랑, 디버그 흐림                          | ✅   |
| 사이드바 에러 섹션   | 에러/빌드 중 프로젝트 시각적 분리, "⚠️ Issues" 헤더        | ✅   |
| 배포 트리거 라벨     | Agent Deploy, Webhook, API Call 구분 아이콘/라벨           | ✅   |
| 시스템 이슈 드롭다운 | 클릭 가능한 상태 카드, Traefik 오프라인/에러 프로젝트 표시 | ✅   |
| 배포 터미널 최적화   | 유휴 시 공간 감소, 활성 빌드 시 로그 영역 확대             | ✅   |
| 시각적 개선          | 문장형 라벨, 채워진 상태 배지, 카드 호버 효과              | ✅   |

---

### v0.9.2 — Dark Theme & Component Refactor (2026-03-22)

**상태**: ✅ 완료

> **핵심 가치**: 다크 Zinc 테마 전체 적용, 명령 팔레트 추가, 프로젝트 통계 모니터링 도구, 대규모 컴포넌트 리팩토링으로 코드 유지보수성 향상.

| 항목                | 내용                                                                         | 상태 |
| ------------------- | ---------------------------------------------------------------------------- | ---- |
| Dark Zinc 테마      | 전체 앱 다크 모드 전환, 카드 깊이, 글로우 도트, AI 아이덴티티 색상           | ✅   |
| 채팅 버블           | 다크 테마 최적화 마크다운 렌더링, 발신자 표시                                | ✅   |
| 터미널              | 점 그리드 배경 패턴, AI 배포 그래디언트 테두리                               | ✅   |
| get_project_stats   | 컨테이너별 CPU, 메모리, 재시작 횟수, 가동 시간 모니터링 도구                 | ✅   |
| 명령 팔레트         | 그룹, AI 폴백, 최근 명령, 키보드 힌트                                        | ✅   |
| Deploy wait=true    | 이벤트/페이즈 순서 버그 수정 — `get_deploy_status(wait=true)` 단일 호출 해결 | ✅   |
| 컨테이너 존재 에러  | `restart_project` 안내 추가                                                  | ✅   |
| 채팅 세션 제목      | 첫 메시지를 제목으로 표시 (기존: "New conversation")                         | ✅   |
| api.ts 분할         | 1,066줄 → 도메인 모듈 (projects, services, system, chat)                     | ✅   |
| SettingsPage 분할   | 1,139줄 → 탭 컴포넌트                                                        | ✅   |
| ProjectsGrid 분할   | 545줄 → 대시보드 컴포넌트                                                    | ✅   |
| ProjectDetail 분할  | 590줄 → 포커스된 컴포넌트                                                    | ✅   |
| NewProjectFlow 분할 | 588줄 → 스텝 컴포넌트                                                        | ✅   |
| 디렉토리 병합       | `sidebar/` → `layout/`, `terminal/` → `deploy-terminal/`                     | ✅   |

---

### v0.9.3 — Light Theme with Rose Brand (2026-03-22)

**상태**: ✅ 완료

> **핵심 가치**: 다크 Zinc 테마에서 클린 라이트 테마로 전환. Rose (#F43F5E)를 브랜드 색상으로 통일. Render/Vercel 스타일의 모던 대시보드 구현.

| 항목                | 내용                                                             | 상태 |
| ------------------- | ---------------------------------------------------------------- | ---- |
| 라이트 테마 전환    | 다크 Zinc → 클린 화이트/라이트 그레이 배경                       | ✅   |
| Rose 브랜드 색상    | 블루/시안 → Rose (#F43F5E) 통일 (accent + AI identity)           | ✅   |
| 상태 색상 조정      | 라이트 배경에 최적화된 상태 색상 (green-600, amber-600, red-600) | ✅   |
| 텍스트 색상 반전    | 다크 텍스트 (zinc-950) + 라이트 배경 조합                        | ✅   |
| 카드 섀도우 최적화  | 라이트 배경용 미묘한 섀도우 (0.04-0.08 opacity)                  | ✅   |
| 채팅 버블 업데이트  | prose-invert 제거, 라이트 테마 대비 최적화                       | ✅   |
| 상태 도트 글로우    | 라이트 배경용 글로우 섀도우 (green/red/amber)                    | ✅   |
| AI 온라인 펄스      | Rose 색상 펄스 + 섀도우                                          | ✅   |
| 터미널 점 그리드    | 다크 → 라이트 (zinc-300) 또는 제거                               | ✅   |
| AI 배포 테두리      | Rose 그래디언트 (cyan-purple → rose-pink)                        | ✅   |
| 코드 블록 다크 유지 | 가독성을 위해 터미널/코드 블록은 다크 유지                       | ✅   |

---

### v0.9.4 — Light Theme Refinements & Deployment Tracking ✅

**상태**: ✅ 완료 | **관련 커밋**: 7개 (sidebar, overview, terminal, theme cleanup, trigger_detail)

> **핵심 가치**: Light Rose 테마 완성 + 배포 트리거 추적 인프라 + 사이드바/오버뷰 레이아웃 최적화

| 항목                      | 내용                                                                       | 상태 |
| ------------------------- | -------------------------------------------------------------------------- | ---- |
| 사이드바 레이아웃 개선    | 검색바 (⌘K), ISSUES 섹션 분리, New Project 하단 이동, 레포 이름 툴팁       | ✅   |
| 오버뷰 탭 레이아웃 최적화 | 터미널 컴팩트 모드 (idle 220px), Infrastructure + Quick Actions 2컬럼 배치 | ✅   |
| 터미널 스타일 정리        | 점 그리드 제거, VS Code 다크 배경 (#1E1E1E)                                | ✅   |
| 다크 테마 잔여 정리       | 34개 하드코딩 다크 색상 제거 (18개 파일), 라이트 테마 변수 통일            | ✅   |
| 배포 트리거 추적 인프라   | deploy_logs.trigger_detail 컬럼 추가, 타입 정의, API 연결                  | ✅   |
| 배포 트리거 라벨 개선     | getDeploymentTriggerLabel() 확장 (triggerDetail 우선, fallback 매핑)       | ✅   |

**구현 내역**:

- `src/db/schema.drizzle.ts` — trigger_detail 컬럼 추가
- `src/db/types.ts` — DeployLogRow.trigger_detail 필드
- `src/db/repos/deploy-log.repo.ts` — createDeployLog(triggerDetail?) 파라미터
- `src/web/api/project-routes.ts` — API 응답에 triggerDetail 포함
- `web/src/types/index.ts` — DeployLogSummary.triggerDetail 필드
- `web/src/lib/deployments.ts` — getDeploymentTriggerLabel() 개선
- `web/src/components/layout/Sidebar.tsx` — 검색바, 레이아웃 개선
- `web/src/components/project/OverviewTab.tsx` — 터미널 컴팩트, 2컬럼 레이아웃
- `web/src/components/deploy-terminal/TerminalFrame.tsx` — 점 그리드 제거
- 18개 파일 다크 색상 정리 (agent/, command/, timeline/, shared/, ui/, pages/, hooks/)

---

### v0.9.6 — Agent Chat & Deployments UI Polish ✅

**상태**: ✅ 완료 | **관련 커밋**: 1개 (style: agent chat & deployments UI polish)

> **핵심 가치**: Agent Chat 버블/코드블록/세션 아키텍처 전면 개선, Deployments 리스트 Vercel 스타일 compact 재설계. 기능 변경 없이 순수 UI/UX + 아키텍처 개선.

| 항목                                    | Before                                                    | After                                                                    | 상태 |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ | ---- |
| Agent Chat 버블                        | `rounded-lg` 네모, AI 버블 `bg-bg-panel`(#fafafa ≈ 흰색) | iMessage `rounded-[18px_18px_4px_18px]`, `w-fit`, `bg-bg-subtle`, shadow | ✅   |
| 코드 블록                              | 검은 배경+검은 글자, hljs CSS 없음, 복사 불가             | github-dark 구문 강조, `text-zinc-100`, 언어 헤더 바 + Copy 버튼        | ✅   |
| Chat 세션 상태관리                     | Sidebar/AgentPage 각각 독립 useState 인스턴스             | React Context 단일 인스턴스 (ChatSessionsProvider)                       | ✅   |
| Thinking 인디케이터                    | 회색 `animate-bounce` 3개 점                              | Bot 아이콘 + 브랜드 컬러 pulse + `bounce-dot` 커스텀 keyframe           | ✅   |
| Streaming 인디케이터                   | 헤더 바 우측 `● Streaming` 뱃지                           | 메시지 영역 내 ThinkingIndicator로 통합                                  | ✅   |
| Deployments 행                         | `p-3 rounded-lg border` 카드형 (~68px)                    | `py-2.5 px-4 divide-y` 1줄 행 (~44px), justify-between 가로 꽉 채움    | ✅   |
| Deployments 시각 위계                  | 모든 텍스트 비슷한 크기/굵기, status pill 뱃지            | trigger `font-semibold` 1순위, status 플레인 텍스트, 메타 우측 정렬     | ✅   |
| AI deploy border                       | `border-image` → 4면 핑크 + radius 충돌                   | `border-left: 2px solid #f43f5e` 좌측만                                  | ✅   |

**아키텍처 변경 상세 — Chat 세션 Context**:

- **문제**: `useChatSessions()`가 커스텀 훅(Context 아님)이라 호출할 때마다 독립 `useState` 생성. Sidebar(인스턴스A)와 AgentPage(인스턴스B)가 `activeSessionId`는 URL params로 동기화했지만 `sessions[]` 배열은 동기화 안 됨
- **증상**: AgentPage에서 메시지 전송 후 `refreshSessions()` → B의 sessions만 갱신 → Sidebar(A)는 계속 `firstMessage: undefined` → "New conversation" 도배
- **해결**: `ChatSessionsProvider` Context로 단일 인스턴스 공유 → B의 `refreshSessions()`가 A도 동시 갱신

**구현 내역**:

- `web/src/components/agent/MessageBubble.tsx` — 버블 스타일 + CodeBlock 컴포넌트 (언어 헤더/복사)
- `web/src/components/agent/ThinkingIndicator.tsx` — Bot 아이콘 + bounce-dot 리디자인
- `web/src/components/agent/ChatLayout.tsx` — Streaming 인디케이터 헤더에서 제거
- `web/src/contexts/chat-sessions.tsx` — **신규**: ChatSessionsProvider + Context 기반 useChatSessions
- `web/src/components/layout/AppLayout.tsx` — ChatSessionsProvider 래핑
- `web/src/components/layout/Sidebar.tsx` — import 경로 hooks → contexts
- `web/src/pages/AgentPage.tsx` — import 경로 hooks → contexts
- `web/src/components/project/DeploymentsList.tsx` — compact 1줄 행 + justify-between
- `web/src/index.css` — `ai-deploy-border` border-image → border-left solid
- `web/src/components/project/DeploymentsList.tsx` — Compact 1줄 행 + justify-between
- `web/src/index.css` — ai-deploy-border 수정

---

### v0.9.5 — Overview Redesign & Critical Fixes ✅

**상태**: ✅ 완료 | **관련 커밋**: 3개 (migration fix, status fix, overview redesign)

> **핵심 가치**: Overview 탭 완전 재설계 (카드 6개 → 플랫 프로그레시브 디스클로저), 배포 트리거 DB 마이그레이션 추가, 상태 표시 불일치 해결

| 항목                                    | 내용                                                                                 | 상태 |
| --------------------------------------- | ------------------------------------------------------------------------------------ | ---- |
| Overview 탭 재설계                      | 6개 카드 제거, 플랫 섹션 + 프로그레시브 디스클로저 (412→160 줄)                     | ✅   |
| Deploy Pipeline 자동 확장               | 빌드 중 또는 스트리밍 중 자동 확장, 유휴 시 축소                                    | ✅   |
| Details 섹션 축소 가능                  | Port, Branch, Image, Environments 2컬럼 그리드                                      | ✅   |
| trigger_detail DB 마이그레이션          | ALTER TABLE deploy_logs ADD COLUMN trigger_detail 추가 (Deployments API 500 해결)   | ✅   |
| 상태 표시 불일치 해결                  | OverviewTab 독립 getProject() 제거, displayProject 사용으로 통일                    | ✅   |

**구현 내역**:

- `web/src/components/project/OverviewTab.tsx` — 완전 재작성 (412→160 줄)
- `web/src/components/project/SummaryDashboard.tsx` — 삭제 (더 이상 사용 안 함)
- `src/db/migration.ts` — trigger_detail ALTER TABLE 마이그레이션 추가
- 제거된 컴포넌트: SummaryDashboard, Infrastructure Info card, Quick Actions card, LogPreview

---

### v0.9.7 — Backend Refactoring & MCP Service Access ✅

**상태**: ✅ 완료 | **관련 커밋**: 4개

> **핵심 가치**: 3대 대형 파일 리팩토링 (-37%, 1285줄 제거) + MCP 서비스 도구에 서버 IP 접근 정보 추가 + 테스트 스위트 전체 그린

| 항목 | 내용 | 상태 |
| --- | --- | --- |
| service-manager.ts 리팩토링 | 어댑터 패턴 (PostgreSQL/MySQL/Redis/MongoDB), 1406→817줄 (-42%) | ✅ |
| setup-routes.ts 리팩토링 | 도메인별 분리 (cloudflare/github/mcp), 819→234줄 (-71%) | ✅ |
| project-routes.ts 리팩토링 | 공유 헬퍼 3개 추출, 39개 중복 제거, 1285→1174줄 (-9%) | ✅ |
| MCP 서비스 externalAccess | list_services, create_service, get_service_status, get_service_credentials에 서버 IP (LAN/VPN) 접근 정보 추가 | ✅ |
| 테스트 스위트 그린 | vitest 1462 pass / 0 fail. 41개 pre-existing 실패 수정 | ✅ |

**구현 내역**:

- `src/pipeline/service-adapters/` — 신규 디렉토리: types.ts, shared.ts, postgres-adapter.ts, mysql-adapter.ts, redis-adapter.ts, mongo-adapter.ts, index.ts
- `src/pipeline/service-manager.ts` — 어댑터 팩토리 위임으로 전환 (1406→817줄)
- `src/web/api/setup-routes.ts` — 코어 핸들러만 남기고 도메인별 분리 (819→234줄)
- `src/web/api/setup/` — 신규: cloudflare-routes.ts, github-routes.ts, mcp-routes.ts, shared.ts
- `src/web/api/helpers/project-helpers.ts` — 신규: 3개 공유 헬퍼
- `src/web/api/project-routes.ts` — 39개 중복 인스턴스 헬퍼로 대체
- `src/tools/defs/service.ts` — getServiceExternalAccess(), getExternalConnectionStrings() 추가

```
