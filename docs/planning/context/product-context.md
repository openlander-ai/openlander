# OpenLander — 제품 핵심 지식

> 기획/아이데이션/우선순위 판단 시 참조하는 제품 지식 문서.
> **"이 기능이 가능한가? 어디에 영향을 주는가? 얼마나 걸리는가?"**를 판단하기 위한 것.
>
> **현재 버전**: v0.2.6 ✅ → v1.0.0 진행 중

---

## 제품 한 줄 정의

**"서버 상태를 알고, 먼저 말해주는 배포 에이전트"** — repo URL 하나 주면 clone → build → run → URL 완성.

핵심 차별점: 서버의 전체 상태를 인식하고, MCP를 통해 코딩 에이전트(Cursor/Claude Code)와 직접 통합. 빌드 실패 시 AI가 자동으로 분석하고 Dockerfile을 수정하여 재배포. 1차 타겟: 배포 볼륨에 압도당하는 DevOps/백엔드 엔지니어 (DEC-008).

---

## 사용 채널

| 채널              | 파일                                                 | 사용자                                | 특징                                                          |
| ----------------- | ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| **Web Dashboard** | `src/web/` + `web/`                                  | 브라우저 접속                         | React 19 SPA. **v0.2.0부터 메인 인터페이스.** Vercel-inspired |
| **MCP**           | `src/mcp/server.ts`                                  | IDE 에이전트 (Cursor, Claude Code 등) | 30개 도구를 MCP 프로토콜로 노출                               |
| **Bot**           | `src/channels/slack.ts`, `discord.ts`, `telegram.ts` | 팀 원격 관리                          | Slack/Discord/Telegram에서 자연어로 배포/관리                 |
| **REST API**      | `src/web/api/`                                       | 커스텀 통합                           | Hono 기반 HTTP API                                            |
| ~~**TUI**~~       | `src/tui/`                                           | ~~터미널 접속~~                       | ⚠️ v0.2.0에서 Web으로 피봇. **프리즈 상태** (신규 기능 없음)  |

**기획 시 고려**: 새 기능은 Web + MCP + Bot 채널에 영향. TUI는 프리즈.

---

## 배포 파이프라인 (핵심 플로우)

```
사용자 "이 레포 배포해줘" (Web/MCP/Bot)
       ↓
AI 에이전트 (LLM) — 의도 파악, 파라미터 추출
       ↓
도구 호출: deploy_project(repo_url, name, branch)
       ↓
┌─ Pipeline (결정론적, 규칙 기반) ──────────────┐
│ 1. secret-scan — 하드코딩 시크릿 감지 (12패턴)│
│ 2. git.ts       — clone (SSH/HTTPS)           │
│ 3. auto-detect  — Dockerfile 감지 or 자동 생성│
│ 4. preflight    — 포트/이름/리소스 사전 검증  │
│ 5. docker.ts    — docker build → image        │
│ 6. port.ts      — 빈 포트 할당                │
│ 7. docker.ts    — docker run (포트/라벨 설정)  │
│ 8. traefik.ts   — 리버스 프록시 라벨 설정      │
│ 9. env-inject   — 환경변수 주입               │
│ 10. health.ts   — 헬스체크 대기               │
└───────────────────────────────────────────────┘
       ↓
결과: http://project-name.{ip}.sslip.io
       ↓ (실패 시)
AI 자동 복구 — 분석 → Dockerfile 수정 → 재배포 (최대 3회)
```

**핵심 원칙**: LLM은 대화/해석/에러분석만. 배포 실행은 100% 결정론적 파이프라인. LLM이 판단해서 배포하지 않음.

---

## 도구 목록 (30개)

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

| 도구                  | 기능                                       |
| --------------------- | ------------------------------------------ |
| `set_env_vars`        | 환경변수 설정                              |
| `provision_database`  | PostgreSQL/MySQL/Redis 컨테이너 프로비저닝 |
| `debug_build_error`   | 빌드 실패 분석 (레시피 + LLM)              |
| `set_global_secret`   | 글로벌 시크릿 설정 (AES-256-GCM 암호화)    |
| `list_global_secrets` | 글로벌 시크릿 목록 조회                    |

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

### 서버 인식 (3개)

| 도구                  | 기능                                               |
| --------------------- | -------------------------------------------------- |
| `list_all_containers` | 전체 Docker 컨테이너 조회 (managed/unmanaged 구분) |
| `scan_ports`          | DB + Docker + OS 포트 합산 스캔                    |
| `get_container_stats` | 특정 컨테이너 CPU/메모리/네트워크 사용량           |

**기획 시 고려**: 도구 하나 추가 = Web API + MCP 도구 + Bot 채널 핸들러 + 테스트. 공수 최소 1-2일.

---

## Web Dashboard (v0.2.0~)

v0.2.0에서 TUI → Web으로 피봇. Vercel-inspired 라이트 모드 대시보드.

**주요 페이지**:

- **Projects Grid** — 전체 프로젝트 카드 + 상태
- **Project Detail** — 타임라인 + 배포 이력 + 도메인 + 환경변수 + Webhook + PR 프리뷰
- **Deployment Detail** — 빌드 로그 뷰어 + AI 분석 (인라인)
- **Services** — 공유 인프라 (PostgreSQL/MySQL/Redis/MongoDB + 커스텀 이미지)
- **Settings** — AI 프로바이더, GitHub 연결, 글로벌 시크릿, 서버 스캔
- **New Project** — 배포 플로우 (Git URL → 배포 → 결과)

**AI 통합 (v1.0.0)**:

- 빌드 실패 → AI 자동 분석 → Dockerfile 수정 → 재배포 (최대 3회)
- 배포 후 60초 헬스 감시 → 연속 실패 시 롤백 제안
- 시크릿 스캔, 포스트모템 자동 생성
- 에이전트 분석이 타임라인에 인라인 렌더링

---

## 온보딩 플로우

**현재 상태**: Web Setup Screen (v0.2.1~)

```
http://localhost:10114
  │
  ├─ Step 0: 언어 선택 (한국어/영어)
  ├─ Step 1: Welcome
  ├─ Step 2: LLM 프로바이더 설정
  │     ├─ BYOK: 프로바이더 선택 → API 키 입력 → 검증
  │     └─ OAuth: OpenAI/OpenRouter 팝업 로그인
  └─ Step 3: GitHub 연결 (OAuth / Skip)
```

**핵심 원칙**: 온보딩은 1회성 설정. 최대한 가볍게, 빠르게.

---

## LLM 통합

Vercel AI SDK 기반 5개 프로바이더 지원 (BYOK + OAuth):

| 프로바이더 | AI SDK 패키지           | 특징                               |
| ---------- | ----------------------- | ---------------------------------- |
| Gemini     | `@ai-sdk/google`        | **무료 티어** 가능. 진입장벽 최저. |
| OpenRouter | `@ai-sdk/openai` (호환) | 멀티 모델 라우팅. 무료 모델 존재.  |
| Anthropic  | `@ai-sdk/anthropic`     | Claude. 품질 최상.                 |
| OpenAI     | `@ai-sdk/openai`        | GPT. 범용.                         |
| Ollama     | `ollama-ai-provider`    | **완전 로컬**. API 키 불필요.      |

**인증 방식 2가지**:

- **BYOK**: API 키 수동 입력 (모든 프로바이더)
- **OAuth**: OpenAI (Codex PKCE) / OpenRouter (PKCE + 콜백) — 기존 구독 계정으로 로그인

**시스템 프롬프트 구조** (`prompts.ts`):

```
BASE_PROMPT (고정 ~120줄)
+ Context Snapshot (동적 — 프로젝트 상태, 시스템 리소스, 서버 전체 컨텍스트, 배포 히스토리)
+ Model Overlay (프로바이더별 미세 조정 2-10줄)
+ Auto-Recovery Mode (빌드 실패 시 활성화)
+ i18n Locale Directive (한/영)
```

**기획 시 고려**: Context Snapshot에 뭘 넣느냐가 에이전트 품질을 결정한다. 서버 전체 상태(컨테이너, 포트, 프록시) + 배포 히스토리 주입 완료.

---

## 외부 접근 (3단계 + Shared)

| 모드        | 구현                             | 도메인 필요 | 용도          |
| ----------- | -------------------------------- | ----------- | ------------- |
| Internal    | Traefik 로컬                     | ✗           | 같은 네트워크 |
| Quick Share | Traefik File Provider (임시)     | ✗           | 데모/리뷰     |
| Shared      | Quick Share + 접근 코드 (bcrypt) | ✗           | 제한된 공유   |
| Production  | Cloudflare Tunnel (영구)         | ✓           | 프로덕션      |

> v0.2.6에서 Quick Share가 TryCloudflare → Traefik File Provider로 전환. 접근 코드 보호 (Shared 모드) 추가.

---

## 데이터 저장

- **SQLite** (Drizzle ORM, `src/db/`)
  - `projects` — 프로젝트 메타데이터 (access_code, is_preview, pr_number 포함)
  - `env_vars` — 환경변수 (프로젝트별)
  - `deploy_logs` — 배포 로그
  - `domain_mappings` — 도메인 매핑
  - `preview_deploys` — 프리뷰 배포
  - `global_secrets` — AES-256-GCM 암호화 시크릿
  - `oauth_tokens` — OAuth 토큰 (암호화 저장)
  - `services` — 공유 인프라 서비스
- **Docker** — 컨테이너, 이미지, 볼륨 (Docker daemon이 관리)
- **파일시스템** — Git clone 경로, 설정 파일 (`~/.openlander/`), master.key

---

## 모니터링 & AI 능동성

| 모듈              | 파일                              | 기능                                              |
| ----------------- | --------------------------------- | ------------------------------------------------- |
| Health Check      | `monitor/health.ts`               | 컨테이너 헬스 체크 루프 (30초). 실패 시 알림      |
| System Stats      | `monitor/stats.ts`                | CPU/MEM/Disk OS 레벨 수집                         |
| Alerts            | `monitor/alerts.ts`               | 크래시 감지, 메모리 포화(>90%), 소음 방지         |
| Incident Reporter | `monitor/incident-reporter.ts`    | 장애 리포트 → Slack/Discord/Telegram 브로드캐스트 |
| Postmortem        | `monitor/postmortem.ts`           | LLM 기반 포스트모템 마크다운 자동 생성            |
| Rollback Watcher  | `monitor/rollback-watcher.ts`     | 배포 후 60초 헬스 감시 → 연속 실패 시 롤백 제안   |
| Post-Deploy       | `pipeline/post-deploy-insight.ts` | 배포 후 인사이트 (헬스/리소스/빌드시간)           |
| Smart Defaults    | `agent/smart-defaults.ts`         | 이전 배포 히스토리 기반 스마트 기본값 제안        |
| Secret Scan       | `pipeline/secret-scan.ts`         | clone 후 하드코딩 시크릿 감지 (12개 패턴)         |

---

## 빌드 실패 디버깅 (4-Tier)

```
Tier 1: 레시피 매칭 (10개 패턴, 즉시 해결)
  → "npm ERR! peer dep" → 자동 --legacy-peer-deps 추가
  → "port already in use" → 포트 재할당

Tier 2: LLM 분석 (레시피 실패 시)
  → 빌드 로그 전체를 LLM에 전달, 원인 분석 + 수정 제안

Tier 2.5: Dockerfile 자동 수정 (v1.0.0)
  → fixDockerfile() → 수정된 Dockerfile로 재빌드 (최대 3회 루프)

Tier 3: 사용자 개입 (자동 복구도 실패 시)
  → 포스트모템 자동 생성 + 채널 브로드캐스트
```

---

## 주요 수치

- 소스 코드: `src/` 하위 ~20개 디렉토리
- 도구: 30개 (Web + MCP + Bot 동시 노출)
- LLM 프로바이더: 5개 (BYOK + OAuth)
- 테스트: 783개+ (vitest)
- i18n: 한국어/영어 (~316키)
- 외부 의존성: ai (Vercel AI SDK), dockerode, drizzle-orm, cloudflare, bcryptjs
- DB 테이블: 8개 (projects, env_vars, deploy_logs, domain_mappings, preview_deploys, global_secrets, oauth_tokens, services)
- 파이프라인 파일: 20개+ (`src/pipeline/`)
