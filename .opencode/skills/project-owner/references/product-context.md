# OpenLander — 제품 핵심 지식

> PM이 기획/아이데이션/우선순위 판단 시 참조하는 제품 지식 문서.
> 코드를 짜기 위한 것이 아니라, **"이 기능이 가능한가? 어디에 영향을 주는가? 얼마나 걸리는가?"**를 판단하기 위한 것.

---

## 제품 한 줄 정의

**"서버 상태를 알고, 먼저 말해주는 배포 에이전트"** — repo URL 하나 주면 clone → build → run → URL 완성.

핵심 차별점: 서버의 전체 상태를 인식하고, MCP를 통해 코딩 에이전트(Cursor/Claude Code)와 직접 통합. 1차 타겟: 배포 볼륨에 압도당하는 DevOps/백엔드 엔지니어 (DEC-008).

---

## 사용 채널 (4가지)

| 채널         | 파일                                                 | 사용자                                | 특징                                                     |
| ------------ | ---------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| **TUI**      | `src/tui/`                                           | 직접 터미널 접속                      | 3모드 대시보드 + 채팅. 메인 인터페이스.                  |
| **MCP**      | `src/mcp/server.ts`                                  | IDE 에이전트 (Cursor, Claude Code 등) | 30개 도구를 MCP 프로토콜로 노출. **v0.0.9의 핵심 채널.** |
| **Bot**      | `src/channels/slack.ts`, `discord.ts`, `telegram.ts` | 팀 원격 관리                          | Slack/Discord/Telegram에서 자연어로 배포/관리.           |
| **REST API** | `src/web/`                                           | 커스텀 통합                           | HTTP API. 초기 MVP부터 존재.                             |

**기획 시 고려**: 새 기능은 4개 채널 중 어디에 영향을 주는가? TUI에만 영향이면 MCP/Bot 사용자는 접근 불가.

---

## 배포 파이프라인 (핵심 플로우)

```
사용자 "이 레포 배포해줘" (TUI/MCP/Bot)
       ↓
AI 에이전트 (LLM) — 의도 파악, 파라미터 추출
       ↓
도구 호출: deploy_project(repo_url, name, branch)
       ↓
┌─ Pipeline (결정론적, 규칙 기반) ──────────────┐
│ 1. git.ts       — clone (SSH/HTTPS)           │
│ 2. auto-detect  — Dockerfile 감지 or 자동 생성│
│ 3. docker.ts    — docker build → image        │
│ 4. port.ts      — 빈 포트 할당                │
│ 5. docker.ts    — docker run (포트/라벨 설정)  │
│ 6. traefik.ts   — 리버스 프록시 라벨 설정      │
│ 7. env-inject   — 환경변수 주입               │
│ 8. health.ts    — 헬스체크 대기               │
└───────────────────────────────────────────────┘
       ↓
결과: http://project-name.local:10003
```

**핵심 원칙**: LLM은 대화/해석/설명만. 배포 실행은 100% 결정론적 파이프라인. LLM이 판단해서 배포하지 않음.

---

## 도구 목록 (30개, 현재)

### 배포 & 라이프사이클 (9개)

| 도구                | 기능                            | 사용 빈도 |
| ------------------- | ------------------------------- | --------- |
| `deploy_project`    | 메인 배포 (clone → build → run) | 높음      |
| `stop_project`      | 컨테이너 중지                   | 중간      |
| `remove_project`    | 컨테이너 + DB 삭제              | 낮음      |
| `redeploy_project`  | 재빌드 + 재배포                 | 높음      |
| `restart_project`   | 컨테이너만 재시작 (빌드 없이)   | 중간      |
| `rollback_project`  | 직전 이미지로 롤백              | 낮음      |
| `deploy_blue_green` | 무중단 배포 (블루-그린)         | 낮음      |
| `preview_deploy`    | 브랜치별 프리뷰 배포            | 낮음      |
| `cleanup_preview`   | 프리뷰 정리                     | 낮음      |

### 정보 조회 (5개)

| 도구                | 기능                        |
| ------------------- | --------------------------- |
| `list_projects`     | 전체 프로젝트 목록          |
| `get_logs`          | 컨테이너 로그               |
| `get_system_stats`  | CPU/메모리/디스크           |
| `list_previews`     | 프리뷰 배포 목록            |
| `get_deploy_status` | 배포 진행 상태 (JobManager) |

### 환경변수 & DB & 시크릿 (5개)

| 도구                 | 기능                                       |
| -------------------- | ------------------------------------------ |
| `set_env_vars`       | 환경변수 설정                              |
| `provision_database` | PostgreSQL/MySQL/Redis 컨테이너 프로비저닝 |
| `debug_build_error`  | 빌드 실패 분석 (레시피 + LLM)              |
| `set_global_secret`  | 글로벌 시크릿 설정 (AES-256-GCM 암호화)    |
| `list_global_secrets`| 글로벌 시크릿 목록 조회                     |

### 외부 접근 & 도메인 (4개)

| 도구              | 기능                                   |
| ----------------- | -------------------------------------- |
| `expose_public`   | TryCloudflare 임시 URL                 |
| `unexpose_public` | 공개 URL 해제                          |
| `map_domain`      | 커스텀 도메인 매핑 (Cloudflare Tunnel) |
| `list_domains`    | 도메인 매핑 목록                       |

### Git & 모노레포 (4개)

| 도구                  | 기능                      |
| --------------------- | ------------------------- |
| `scan_dockerfiles`    | 레포에서 Dockerfile 탐색  |
| `deploy_monorepo`     | 모노레포 멀티 서비스 배포 |
| `list_github_repos`   | GitHub/GitLab 레포 목록   |
| `search_github_repos` | GitHub/GitLab 레포 검색   |

### 서버 인식 (3개) — v0.0.9 신규

| 도구                  | 기능                                               |
| --------------------- | -------------------------------------------------- |
| `list_all_containers` | 전체 Docker 컨테이너 조회 (managed/unmanaged 구분) |
| `scan_ports`          | DB + Docker + OS 포트 합산 스캔                    |
| `get_container_stats` | 특정 컨테이너 CPU/메모리/네트워크 사용량           |

**기획 시 고려**: 도구 하나 추가 = TUI 도구 + MCP 도구 + Bot 채널 핸들러 + 테스트. 공수 최소 1-2일.

---

## TUI 3모드 시스템

```
Monitoring (기본)  ←→  Deploying (배포 중)  ←→  Debugging (로그 조회)
     │                      │                       │
 Dashboard +           BuildPanel +             LogViewer +
 ChatPanel             ChatPanel               ProjectInfo +
                                               ChatPanel
```

- **Monitoring**: 시스템 상태, 프로젝트 목록, 활동 로그. 유휴 상태.
- **Deploying**: 배포 진행 시 자동 전환. 파이프라인 단계 + 빌드 로그.
- **Debugging**: 프로젝트 선택 → 로그 스트리밍. 컨테이너 디버깅.

**슬래시 명령 (9개)**: `/repo`, `/git`, `/model`, `/tunnel`, `/env`, `/compact`, `/clear`, `/exit`, `/help`

모든 명령은 오버레이(모달)로 표시. 중첩 메뉴 없이 플랫.

## 온보딩 플로우

**현재 상태**: TUI 팝업 형식 → CLI 스타일로 전환 예정 (DEC-012)

```
openlander
  │
  ├─ Step 1: Docker 체크 (src/cli/onboard.ts — 기존)
  ├─ Step 2: LLM 프로바이더 설정 (src/cli/onboard-llm.ts — 신규)
  │     └─ BYOK: 프로바이더 선택 → API 키 입력 → 검증
  ├─ Step 3: Git 인증 (src/cli/onboard-git.ts — 신규)
  │     └─ GitHub OAuth / SSH / Skip
  └─ TUI 진입 (온보딩 완료 후)
```

**핵심 원칙**: 온보딩은 1회성 설정. 최대한 가볍게, 빠르게. TUI는 일상 사용에만 집중.

> 관련 문서: `docs/planning/v0.0.9/onboarding-refactor.md`

---

## LLM 통합

Vercel AI SDK 기반 5개 프로바이더 지원 (BYOK — Bring Your Own Key):

| 프로바이더 | AI SDK 패키지                    | 특징                               |
| ---------- | -------------------------------- | ---------------------------------- |
| Gemini     | `@ai-sdk/google`                | **무료 티어** 가능. 진입장벽 최저. |
| OpenRouter | `@ai-sdk/openai` (호환)          | 멀티 모델 라우팅. 무료 모델 존재.  |
| Anthropic  | `@ai-sdk/anthropic`             | Claude. 품질 최상.                 |
| OpenAI     | `@ai-sdk/openai`                | GPT. 범용.                         |
| Ollama     | `ollama-ai-provider`            | **완전 로컬**. API 키 불필요.      |

**시스템 프롬프트 구조** (`prompts.ts`):

```
BASE_PROMPT (고정 ~120줄)
 Context Snapshot (동적 — 프로젝트 상태, 시스템 리소스, 서버 전체 컨텍스트)
+ Model Overlay (프로바이더별 미세 조정 2-10줄)
```

**기획 시 고려**: Context Snapshot에 뭘 넣느냐가 에이전트 품질을 결정한다. v0.0.9에서 서버 전체 상태(컨테이너, 포트, 프록시)를 주입 완료.

**v0.0.12 Provider OAuth (구현 완료)**:

BYOK(API 키 수동 입력) 외에, LLM 프로바이더 구독 계정으로 직접 인증하는 방식 추가:
- OpenAI: Codex CLI OAuth PKCE (`app_EMoamEEZ73f0CkXaXp7hrann`)
- Anthropic: `claude setup-token` 스타일 토큰 설정
- OpenRouter: OAuth PKCE + 콜백
- Google: Application Default Credentials / AI Studio 키

> 관련 문서: `docs/planning/v0.0.12/provider-oauth.md` | 의사결정: DEC-013

---

## 외부 접근 (3단계)

| 모드        | 구현                     | 도메인 필요 | 용도          |
| ----------- | ------------------------ | ----------- | ------------- |
| Internal    | Traefik 로컬             | ✗           | 같은 네트워크 |
| Quick Share | TryCloudflare (임시)     | ✗           | 데모/리뷰     |
| Production  | Cloudflare Tunnel (영구) | ✓           | 프로덕션      |

---

## 데이터 저장

- **SQLite** (Drizzle ORM, `src/db/`)
  - `projects` — 프로젝트 메타데이터
  - `env_vars` — 환경변수 (프로젝트별)
  - `deploy_logs` — 배포 로그
  - `domain_mappings` — 도메인 매핑
  - `preview_deploys` — 프리뷰 배포
- **Docker** — 컨테이너, 이미지, 볼륨 (Docker daemon이 관리)
- **파일시스템** — Git clone 경로, 설정 파일 (`~/.openlander/`)

---

## 모니터링 시스템

| 모듈         | 파일                | 기능                                          |
| ------------ | ------------------- | --------------------------------------------- |
| Health Check | `monitor/health.ts` | 컨테이너 헬스 체크 루프 (30초). 실패 시 알림. |
| System Stats | `monitor/stats.ts`  | CPU/MEM/Disk OS 레벨 수집.                    |
| Alerts       | `monitor/alerts.ts` | IPC 기반 알림 (포트 충돌, 헬스 실패 등)       |

**v0.0.9에서 해결된 한계**:

- ~~자체 배포 컨테이너만 모니터링~~ → `listAllContainers()`로 전체 컨테이너 스캔
- ~~포트 충돌 감지 불가~~ → `scanUsedPorts()` + `preflightCheck()`로 사전 차단
- ~~외부 프록시 감지 불가~~ → `detectReverseProxy()`로 managed/external 모드 지원

**남은 한계** (v0.0.11에서 해결 계획):

- 크래시 원인 분석 없음 (단순 "unhealthy" 알림만) → Anomaly Nudge
- 배포 성공률 추적 없음 → Post-Deploy Insight
- 에이전트가 능동적으로 정보 제공 안 함 → Agent Proactivity 전체

---

## 빌드 실패 디버깅 (3-Tier)

```
Tier 1: 레시피 매칭 (10개 패턴, 즉시 해결)
  → "npm ERR! peer dep" → 자동 --legacy-peer-deps 추가
  → "port already in use" → 포트 재할당

Tier 2: LLM 분석 (레시피 실패 시)
  → 빌드 로그 전체를 LLM에 전달, 원인 분석 + 수정 제안

Tier 3: 사용자 개입 (LLM도 실패 시)
  → "빌드 실패. 로그를 확인하고 수동으로 수정해주세요."
```

---

## 주요 수치

- 소스 코드: `src/` 하위 ~20개 디렉토리
- 도구: 30개 (Web+MCP+Bot 동시 노출) — v0.0.10에서 28→30
- LLM 프로바이더: 5개
- 슬래시 명령: 9개
- 테스트: 632개 (vitest)
- 외부 의존성: ai (Vercel AI SDK), dockerode, drizzle-orm, cloudflare 관련
- DB 테이블: 7개 (projects, env_vars, deploy_logs, domain_mappings, preview_deploys, global_secrets, oauth_tokens)
- 파이프라인 파일: 20개 (`src/pipeline/`)
