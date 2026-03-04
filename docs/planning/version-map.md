# OpenLander — 버전 맵 & 스펙 관리 문서

> **작성일**: 2026-02-28
> **목적**: 모든 기획문서를 버전별로 매핑하고, 구현 상태를 한눈에 파악할 수 있는 단일 참조점(Single Source of Truth)

---

## 버전 타임라인

```
v0.0.1 ✅ ── v0.0.2 ✅ ── v0.0.3 ✅ ── v0.0.4 ✅ ── v0.0.6 ✅ ── v0.0.7 ✅ ── v0.0.9 ✅ ── v0.1.0 ✅ ── v0.0.11 ✅ ── v0.0.12 📋 ── v0.0.10 📋 ── v0.0.8 📋 ── 정식릴리즈(TBD)
```

v0.0.1 ✅ ── v0.0.2 ✅ ── v0.0.3 ✅ ━─ v0.0.4 ✅ ── v0.0.6 ✅ ── v0.0.7 ✅ ── v0.0.9 ✅ ── v0.1.0 ✅ ── v0.0.11 ✅ ── v0.0.12 📋 ── v0.0.10 📋 ── v0.0.8 📋 ┬ 정식릴리즈(TBD)

```

 MVP      일상관리    MCP연동    멀티채널    TUI리팩토링  TUI마감     서버인식    ProviderOAuth 에이전트능동  Env관리     AI SDK
```

> ✅ = 완료 | 🧪 = 도그푸딩 중 | 🔧 = 진행 중 | 📋 = 기획/계획 | ❌ = 미착수
>
> **참고**: v0.0.5(파인튜닝)는 requirements.md에 정의되어 있으나, 로컬 LLM은 정식 릴리즈 이후로 연기됨. 정식 릴리즈 버전은 미정.

---

## 스펙 문서 ↔ 버전 매핑

| #   | 문서                           | 경로                                         | 버전           | 구현율 | 상태                                                            |
| --- | ------------------------------ | -------------------------------------------- | -------------- | ------ | --------------------------------------------------------------- |
| 1   | 요구사항 정의서                | `requirements.md`                            | v0.0.1~v0.0.8  | 90%    | v0.0.4까지 완료, v0.0.6 체크 완료                               |
| 2   | TUI 리팩토링 스펙              | `v0.0.6/tui-spec.md`                         | v0.0.6         | 97%    | 38/39 태스크 완료                                               |
| 3   | UI/UX 레이아웃                 | `v0.0.7/ui-ux-layout.md`                     | v0.0.7         | 95%    | 16/16 TASK 완료 + 버그 수정                                     |
| 4   | 빌드실패 + Compose             | `v0.0.6/ui-ux-build-compose.md`              | v0.0.6         | 100%   | 전체 구현 완료                                                  |
| 5   | v0.0.6 상세 태스크             | `v0.0.6/tasks.md`                            | v0.0.6         | 97%    | 38/39 완료 (i18n 1개 남음)                                      |
| 6   | v0.0.7 구현 태스크             | `v0.0.7/implementation-tasks.md`             | v0.0.7         | 100%   | 16/16 전부 완료                                                 |
| 7   | Phase 1 개발계획               | `v0.0.7/phase1-plan.md`                      | v0.0.7         | 100%   | 9개 스텝 전부 완료                                              |
| 8   | AI SDK 마이그레이션            | `v0.0.8/vercel-ai-sdk-migration.md`          | v0.0.8         | 조사만 | 조사 완료, 구현 미착수                                          |
| 9   | ~~마이그레이션 & 디스커버리~~  | ~~`v0.0.9-migration-discovery.md`~~ (삭제됨) | v0.0.9         | —      | `v0.0.9/server-awareness.md`로 재정의                           |
| 10  | ~~Local Dev & Env~~            | ~~`env-spec.md`~~ (삭제됨)                   | v0.0.10        | —      | `v0.0.10/env-secrets.md`로 재정의                               |
| 11  | ~~v0.0.9–v0.0.10 통합 기획서~~ | `archive/v0.0.9-10-unified-spec.md`          | v0.0.9–v0.0.10 | 0%     | ⚠ **아카이브** — 12, 13번으로 대체                              |
| 12  | **v0.0.9 Server Awareness**    | `v0.0.9/server-awareness.md`                 | v0.0.9         | 100%   | ✅ 구현+도그푸딩 완료 (DEC-016). 버그 11건 해결, E2E 검증 완료. |
| 13  | **v0.0.10 Env & Secrets**      | `v0.0.10/env-secrets.md`                     | v0.0.10        | 0%     | ✅ 기획 완료, 미착수                                            |
| 14  | **버그 트래커**                | `v0.0.9/bugs.md`                             | v0.0.9         | —      | 11건 해결, 2건 이관 (BUG-008 미재현, BUG-009 결정대기)          |
| 15  | **개발 라이프사이클**          | `dev-lifecycle.md`                           | 전체           | —      | ✅ 11단계 플로우 + 역할 정의 완료                               |
| 16  | **v0.0.9 온보딩 리팩토링**     | `v0.0.9/onboarding-refactor.md`              | v0.0.9         | 0%     | 📋 기획 완료, 구현 미착수                                       |
| 17  | **v0.0.12 Provider OAuth**     | `v0.0.12/provider-oauth.md`                  | v0.0.12        | 0%     | 📋 기획 완료, 미착수                                            |
| 18  | **v0.1.0 Web MVP**             | `v0.1.0/web-mvp.md`                          | v0.1.0         | 100%   | ✅ Phase 0-3 구현 완료, TUI→Web pivot                           |
| 19  | **v0.0.11 Agent Proactivity**  | `v0.0.11/agent-proactivity.md`               | v0.0.11        | 90%    | ✅ Phase 1-3 완료, 도그푸딩 완료. 잔여 3건은 nice-to-have       |

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

### v0.0.6 — TUI UI/UX 고도화 ✅ (97%)

**상태**: 거의 완료 | **관련 문서**: `v0.0.6/tui-spec.md`, `v0.0.6/tasks.md`, `v0.0.6/ui-ux-build-compose.md`

| 관련 문서                               | 역할                                | 상태         |
| --------------------------------------- | ----------------------------------- | ------------ |
| `v0.0.6/tui-spec.md` (1387줄)           | TUI 전체 아키텍처 + UI 스펙         | ✅ 구현 완료 |
| `v0.0.6/tasks.md` (598줄)               | 상세 태스크 38/39 완료              | ✅ (97%)     |
| `v0.0.6/ui-ux-build-compose.md` (407줄) | Build Failure 3-Tier + Compose 처리 | ✅ 100%      |

**Phase별 진행**:

- Phase 1~7: ✅ 전체 완료 (35/35)
- Phase 8: 4/5 완료 (/env, /tunnel, GitLab, AI SDK 조사)

**미완료 항목**:

| 항목                           | 위치              | 비고          |
| ------------------------------ | ----------------- | ------------- |
| T-INFRA-01: i18n (다국어 지원) | `v0.0.6/tasks.md` | 우선순위 낮음 |

**v0.0.6 이후 추가 완료** (태스크 범위 외):

- GitHub OAuth Device Flow ✅
- Enter 키 버그 수정 ✅
- GitLab 지원 강화 ✅
- OAuth client_id 하드코딩 ✅

---

### v0.0.7 — TUI 마감 + UI 디테일 ✅

**상태**: 완료 | **관련 문서**: `v0.0.7/ui-ux-layout.md`, `v0.0.7/implementation-tasks.md`, `v0.0.7/phase1-plan.md`

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

### v0.0.8 — AI SDK 마이그레이션 📋

**상태**: 조사 완료, 구현 미착수 | **관련 문서**: `v0.0.8/vercel-ai-sdk-migration.md`

| 항목                      | 상태 | 비고                             |
| ------------------------- | ---- | -------------------------------- |
| 현재 아키텍처 분석        | ✅   | 5개 LLM 프로바이더 + 자체 추상화 |
| Vercel AI SDK 호환성 조사 | ✅   | `ai` 패키지 평가 완료            |
| 마이그레이션 계획 수립    | ✅   | 점진적 마이그레이션 방안 도출    |
| 실제 마이그레이션         | ❌   | 미착수                           |

**마이그레이션 범위** (구현 시):

- `src/llm/` 디렉토리 5개 프로바이더 → Vercel AI SDK 통합
- 스트리밍 인터페이스 교체
- Tool calling 인터페이스 통일

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

| 항목                | 내용                                                                          | 상태 |
| ------------------- | ----------------------------------------------------------------------------- | ---- |
| 온보딩 CLI 리팩토링 | TUI 팝업 온보딩 → CLI 스타일로 전환. Docker → LLM(BYOK) → Git(OAuth/SSH/Skip) | 📋   |

> 관련 문서: [`v0.0.9/onboarding-refactor.md`](v0.0.9/onboarding-refactor.md)

---

### v0.0.10 — Env & Secrets Management 📋

**상태**: 기획 완료, 구현 미착수 | **관련 문서**: [`v0.0.10/env-secrets.md`](v0.0.10/env-secrets.md)

> 기존 `archive/v0.0.9-10-unified-spec.md`의 v0.0.10 파트에서 Local Dev Mode를 완전히 제거하고 환경변수/시크릿 관리만 남김.

| 파트                     | 내용                                                            | 상태 |
| ------------------------ | --------------------------------------------------------------- | ---- |
| 10-1: Global Secrets     | `global_secrets` 테이블 + AES-256-GCM 암호화                    | 📋   |
| 10-2: .env.example 감지  | 배포 시 누락 변수 감지 → 입력 요청                              | 📋   |
| 10-3: 도구 추가          | `set_global_secret`, `list_global_secrets`, `get_env_vars` 수정 | 📋   |
| 10-4: /env 오버레이 확장 | Global Secrets 탭 추가                                          | 📋   |

**제거된 항목** (기존 통합 기획서 대비):

- Local Dev Mode 전체 — 핵심 가치와 무관, 사용자 피드백 대기
- User Overrides (3단계 스코프) — 2단계(Global + Project)로 충분
- 멀티유저 포트 분리 — Local Dev Mode 제거에 따라 불필요

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

### v0.0.12 — Provider OAuth (인증 통합) 📋

**상태**: 기획 완료, 구현 미착수 | **관련 문서**: [`v0.0.12/provider-oauth.md`](v0.0.12/provider-oauth.md)

> LLM 프로바이더 구독 계정(ChatGPT Plus, Claude Max 등)으로 직접 인증하여 BYOK 설정 없이 사용 가능하게.

**핵심 가치**: API 키 수동 입력 번거로움 제거 + 기존 구독 활용으로 진입장벽 최소화.

| 항목                        | 내용                                                    | 상태 |
| --------------------------- | ------------------------------------------------------- | ---- |
| 12-1: OpenAI OAuth PKCE     | Codex CLI OAuth 플로우 (`app_EMoamEEZ73f0CkXaXp7hrann`) | 📋   |
| 12-2: Anthropic Token Setup | `claude setup-token` 스타일 토큰 설정                   | 📋   |
| 12-3: OpenRouter OAuth PKCE | PKCE 인증 + 콜백                                        | 📋   |
| 12-4: Google ADC            | Application Default Credentials / AI Studio 키          | 📋   |
| 12-5: 토큰 저장 & 리프레시  | AES-256-GCM 암호화 저장 + 자동 갱신                     | 📋   |

**선행 조건**: v0.0.9 온보딩 CLI 리팩토링 완료 (BYOK 플로우가 베이스라인)

### 정식 릴리즈 (TBD)

**상태**: 버전 미정, 미착수

v0.0.12까지의 기능을 안정화하고 정식 릴리즈. 문서 정비, 테스트 커버리지 강화, 온보딩 UX 최종 점검. 버전 번호는 개발 진행 상황에 따라 결정.

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

## requirements.md v0.0.6 "남은 고도화 항목" 실제 구현 상태

> `requirements.md` L451~481에 체크 안 된 항목들이 있으나, 다수가 실제로는 구현됨.
> 문서 체크박스가 업데이트되지 않은 것.

| 항목                        | requirements.md | 실제 상태    | 구현 위치                              |
| --------------------------- | --------------- | ------------ | -------------------------------------- |
| 멀티라인 입력               | `[ ]`           | ✅ 구현됨    | Phase 7 (v0.0.6-tasks.md T-TUI-23)     |
| 코드 블록 신택스 하이라이팅 | `[ ]`           | ✅ 구현됨    | Phase 7                                |
| 마크다운 렌더링             | `[ ]`           | ✅ 구현됨    | Phase 7                                |
| 배포 진행률 시각화          | `[ ]`           | ✅ 부분 구현 | StatusBar 빌드 진행률 (TASK-07)        |
| 선택지 UI                   | `[ ]`           | ✅ 구현됨    | QuestionBridge / QuestionDock          |
| 프로젝트 카드 UI            | `[ ]`           | ✅ 부분 구현 | ProjectsSection 개선 (v0.0.7)          |
| 시스템 리소스 바 차트       | `[ ]`           | ✅ 구현됨    | CPU/MEM ProgressBar (tui-spec Phase 2) |
| 프로젝트 검색/필터          | `[ ]`           | ❌ 미구현    | —                                      |
| 로그 뷰어                   | `[ ]`           | ✅ 구현됨    | 디버깅 모드 LogViewer (Phase 4)        |
| 반응형 레이아웃             | `[ ]`           | ✅ 구현됨    | Phase 1 (60:40 / 65:35 / 단일)         |
| 보더/구분선 스타일          | `[ ]`           | ✅ 구현됨    | Phase 7 보더 통일                      |
| 컬러 팔레트 통일            | `[ ]`           | ✅ 구현됨    | Signal Green #36f0a0 통일              |
| Vim-style j/k               | `[ ]`           | ✅ 구현됨    | Phase 7                                |
| Ctrl+L 클리어               | `[ ]`           | ✅ 구현됨    | Phase 7                                |

**결론**: 14개 중 13개 구현됨. `프로젝트 검색/필터`만 미구현 (우선순위 낮음).

---

## 미해결 항목 총정리

| #      | 항목                       | 버전                 | 문서                                | 우선순위   |
| ------ | -------------------------- | -------------------- | ----------------------------------- | ---------- |
| 1      | i18n (다국어 지원)         | v0.0.6               | `v0.0.6/tasks.md` T-INFRA-01        | 낮음       |
| 2      | 프로젝트 검색/필터         | v0.0.6               | `requirements.md` L468              | 낮음       |
| 3      | ~~전체 컨테이너 스캔~~     | v0.0.9               | `v0.0.9/server-awareness.md` 9-1    | ✅ 완료    |
| 4      | ~~OS 레벨 포트 스캔~~      | v0.0.9               | `v0.0.9/server-awareness.md` 9-2    | ✅ 완료    |
| 5      | ~~리버스 프록시 감지~~     | v0.0.9               | `v0.0.9/server-awareness.md` 9-3    | ✅ 완료    |
| 6      | ~~시스템 프롬프트 확장~~   | v0.0.9               | `v0.0.9/server-awareness.md` 9-4    | ✅ 완료    |
| 7      | ~~에이전트 도구 3개 추가~~ | v0.0.9               | `v0.0.9/server-awareness.md` 9-5    | ✅ 완료    |
| 8      | ~~Dashboard Server 섹션~~  | v0.0.9               | `v0.0.9/server-awareness.md` 9-6    | ✅ 완료    |
| 9      | ~~Preflight Check~~        | v0.0.9               | `v0.0.9/server-awareness.md` 9-7    | ✅ 완료    |
| 10     | Global Secrets + 암호화    | v0.0.10              | `v0.0.10/env-secrets.md` 10-1       | 중간       |
| 11     | .env.example 감지          | v0.0.10              | `v0.0.10/env-secrets.md` 10-2       | 중간       |
| 12     | 환경변수 도구 추가         | v0.0.10              | `v0.0.10/env-secrets.md` 10-3       | 중간       |
| 13     | /env 오버레이 확장         | v0.0.10              | `v0.0.10/env-secrets.md` 10-4       | 중간       |
| 14     | Vercel AI SDK 마이그레이션 | v0.0.8               | `v0.0.8/vercel-ai-sdk-migration.md` | 낮음(연기) |
| 15     | 파인튜닝 모델              | TBD(정식릴리즈 이후) | `requirements.md` L425~429          | 미래       |
| ~~16~~ | ~~Post-Deploy Insight~~    | v0.0.11              | `v0.0.11/agent-proactivity.md` 11-1 | ✅ 완료    |
| ~~17~~ | ~~Anomaly Nudge~~          | v0.0.11              | `v0.0.11/agent-proactivity.md` 11-2 | ✅ 완료    |
| ~~18~~ | ~~Smart Defaults~~         | v0.0.11              | ✅                                  |
| ~~19~~ | ~~Idle Scan~~              | v0.0.11              | ❌                                  |
| 20     | 온보딩 CLI 리팩토링        | v0.0.9               | `v0.0.9/onboarding-refactor.md`     | 높음       |
| 21     | OpenAI OAuth PKCE          | v0.0.12              | `v0.0.12/provider-oauth.md` 12-1    | 중간       |
| 22     | Anthropic Token Setup      | v0.0.12              | `v0.0.12/provider-oauth.md` 12-2    | 중간       |
| 23     | OpenRouter OAuth PKCE      | v0.0.12              | `v0.0.12/provider-oauth.md` 12-3    | 중간       |
| 24     | Google ADC                 | v0.0.12              | `v0.0.12/provider-oauth.md` 12-4    | 중간       |
| 25     | 토큰 저장 & 리프레시       | v0.0.12              | `v0.0.12/provider-oauth.md` 12-5    | 중간       |
| ~~26~~ | ~~Web MVP Phase 1~~        | v0.1.0               | `v0.1.0/web-mvp.md` Phase 1         | ✅ 완료    |
| ~~27~~ | ~~Web MVP Phase 2~~        | v0.1.0               | `v0.1.0/web-mvp.md` Phase 2         | ✅ 완료    |
| ~~28~~ | ~~Web MVP Phase 3~~        | v0.1.0               | `v0.1.0/web-mvp.md` Phase 3         | ✅ 완료    |
| ~~29~~ | ~~TUI Freeze~~             | v0.1.0               | `v0.1.0/web-mvp.md` §3.4.4          | ✅ 완료    |

---

## 문서 불일치 & 업데이트 필요 사항

| 위치                              | 문제                                                | 권장 조치                                           |
| --------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `requirements.md` L433            | v0.0.6 "🎯 In Progress" 표시                        | ✅ "✅ Complete (97%)" 로 변경 완료                 |
| `requirements.md` L457~482        | v0.0.6 남은 고도화 체크박스 미체크                  | ✅ 구현된 13건 체크 처리 완료                       |
| `v0.0.7-ui-ux-layout.md` L329~355 | 하단 "구현 우선순위" 체크박스 미체크                | ✅ 검증된 13건 체크, 미확인 3건 유지                |
| `v0.0.6-tui-spec.md` L1           | 제목이 "v0.1.0"으로 표기되어 있었음                 | ✅ "v0.0.6" 으로 정정 완료                          |
| `README.md` 로드맵                | v0.0.7 "In Progress"                                | ✅ v0.0.7 Done + v0.0.8/v0.0.9/v0.0.10 행 추가 완료 |
| `v0.0.6-tasks.md` L12             | 진행률 "38/39" 정확하나 v0.0.6 이후 추가작업 미반영 | → 하단 "추가 작업" 섹션은 반영됨, OK                |

---

## 검증 기준

**2026-03-04 기준 빌드/테스트/E2E 상태**:

```
✅ tsup build — 성공 (backend + DTS)
✅ vite build — 성공 (web)
✅ lsp_diagnostics — 0 errors
✅ lint-staged — 통과
✅ E2E deploy — traefik/whoami Chat→Agent→Clone→Build→Container→URL 성공
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
AI: 버그 수정 + bun test 통과
    ↓
AI: bugs.md → 해결됨 + gh issue close
```

**참조**: `v0.0.9/bugs.md` 워크플로우 섹션, `.opencode/instructions.md` §9

**GitHub Issues Labels**: `bug`, `v0.0.6`~`v0.0.10`, `priority:high`, `priority:low`

---

### v0.1.0 — Web MVP ✅

**상태**: 구현 완료 | **관련 문서**: [`v0.1.0/web-mvp.md`](v0.1.0/web-mvp.md), [`v0.1.0/tech-lead-review.md`](v0.1.0/tech-lead-review.md)

> **핵심 가치**: TUI→Web pivot. 웹을 **히어로 화면**으로 하여, **“repo 연결해서 딸깍”** — Connect repo, click, done. Agent handles everything in background.

**UI/UX 디자인**: [`docs/design/web-mvp-ui-ux.md`](../../design/web-mvp-ui-ux.md)

| Phase                  | 내용                                                                          | 상태 |
| ---------------------- | ----------------------------------------------------------------------------- | ---- |
| Phase 0 — Architecture | TUI freeze, SPA serving, React Router, build verification                     | ✅   |
| Phase 1 — Core         | Theme, Layout, Projects Grid, New Project, Timeline, NDJSON Streaming         | ✅   |
| Phase 2 — Essential    | Agent Intervention (full-stack), Log Viewer, Config (env+domains), Onboarding | ✅   |
| Phase 3 — Polish       | Chat (Cmd+.), Settings, Command Palette (Cmd+K), Motion, Responsive           | ✅   |

**Architecture Tasks**:

| 항목                                                        | 상태 |
| ----------------------------------------------------------- | ---- |
| SPA Serving from Hono Daemon                                | ✅   |
| NDJSON Event Type 확장 (6종)                                | ✅   |
| CLI-lite Commands (deploy, status, logs, open, projects ls) | ✅   |
| TUI Freeze (git tag `tui-last` @ e927b30)                   | ✅   |

**의사결정 기록**: [`references/decision-log.md`](../../references/decision-log.md)

---
