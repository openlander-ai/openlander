# OpenLander — PM을 위한 기술 아키텍처

> 코드를 짜기 위한 문서가 아니다. PM이 **"이 기능은 기술적으로 가능한가? 어디를 건드려야 하나? 공수가 얼마나 드는가?"**를 판단하기 위한 기술 지도.

---

## 전체 구조도

```
┌─────────────────────────────────────────────────────┐
│  User Interfaces (진입점)                            │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐            │
│  │ TUI  │  │ MCP  │  │ Bot  │  │ REST │            │
│  │ (터미널)│ (IDE)  │ (Slack │  │ API  │            │
│  │      │  │      │  │ 등)  │  │      │            │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘            │
│     └────────┬┴─────────┴────────┘                  │
│              ↓                                       │
│  ┌─────────────────────┐                            │
│  │  AI Agent (LLM)     │  ← 대화/해석/설명만        │
│  │  prompts.ts + LLM   │                            │
│  └──────────┬──────────┘                            │
│             ↓ 도구 호출                              │
│  ┌─────────────────────┐                            │
│  │  Tools (25개)       │  ← 에이전트가 호출하는 API  │
│  │  registry.ts        │                            │
│  └──────────┬──────────┘                            │
│             ↓                                        │
│  ┌─────────────────────┐                            │
│  │  Pipeline (결정론적) │  ← 실제 실행               │
│  │  20개 모듈          │                            │
│  └──────────┬──────────┘                            │
│             ↓                                        │
│  ┌──────┐ ┌───────┐ ┌───────┐ ┌────────┐           │
│  │Docker│ │Traefik│ │SQLite │ │Cloudflare│          │
│  │      │ │(Proxy)│ │(DB)   │ │(Tunnel)  │          │
│  └──────┘ └───────┘ └───────┘ └─────────┘           │
└─────────────────────────────────────────────────────┘
```

---

## 소스 디렉토리 맵 (PM 관점)

```
src/
├── agent/          # AI 에이전트 (프롬프트, 도구 바인딩)
│   └── prompts.ts  # ★ 시스템 프롬프트 = 에이전트 두뇌. v0.0.9 핵심 수정 대상.
├── tools/          # 에이전트 도구 25개 (registry.ts에 전부)
│   └── registry.ts # ★ 기능 추가 = 여기에 도구 추가
├── pipeline/       # 배포 파이프라인 (20개 모듈)
│   ├── deploy.ts   # 메인 배포 오케스트레이터
│   ├── docker.ts   # Docker 빌드/실행/관리
│   ├── port.ts     # 포트 할당 ★ v0.0.9 수정 대상
│   ├── traefik.ts  # 리버스 프록시 ★ v0.0.9 수정 대상
│   ├── git.ts      # Git clone (SSH/HTTPS)
│   ├── env-inject.ts    # 환경변수 주입
│   ├── dockerfile-gen.ts # 자동 Dockerfile 생성
│   ├── auto-detect.ts    # 프레임워크 자동 감지
│   ├── build-recovery.ts # 빌드 실패 디버깅 (3-Tier)
│   ├── blue-green.ts     # 무중단 배포
│   ├── compose.ts        # Docker Compose 지원
│   ├── db-provision.ts   # DB 프로비저닝
│   ├── preview.ts        # 프리뷰 배포
│   ├── job-manager.ts    # 배포 단계 트래킹
│   └── ...
├── tui/            # TUI (SolidJS + OpenTUI)
│   ├── components/ # 20+ 컴포넌트
│   ├── state/      # 전역 상태 (focus, mode, overlay)
│   └── commands/   # 슬래시 명령
├── mcp/            # MCP 서버 (IDE 에이전트 연동)
│   └── server.ts   # ★ 모든 도구를 MCP 프로토콜로 노출
├── channels/       # 봇 (Slack, Discord, Telegram)
├── llm/            # LLM 프로바이더 5개
├── db/             # SQLite + Drizzle ORM
├── monitor/        # 헬스체크, 시스템 통계, 알림
├── config/         # 앱 설정
├── ipc/            # 프로세스 간 통신 (daemon ↔ TUI)
├── events/         # 이벤트 시스템
├── git-providers/  # GitHub/GitLab OAuth
├── web/            # REST API
├── webhook/        # Git push webhook
└── cli/            # CLI 엔트리포인트 (openlander 명령어)
```

---

## 공수 추정 가이드

기능의 복잡도를 **영향받는 레이어 수**로 추정한다:

### 1-레이어 변경 (1-2일)

하나의 모듈만 수정. 다른 곳에 영향 없음.

- 예: 새 빌드 레시피 추가 (`build-recovery.ts`만)
- 예: LLM 프롬프트 수정 (`prompts.ts`만)
- 예: Dashboard 표시 항목 추가 (`DashboardPanel.tsx`만)

### 2-레이어 변경 (3-5일)

파이프라인 + 도구, 또는 도구 + TUI.

- 예: 새 도구 추가 → `registry.ts` + MCP 노출 + 테스트
- 예: 배포 전 체크 추가 → `pipeline` + `registry.ts` + `prompts.ts`

### 3-레이어 이상 (1-2주)

파이프라인 + 도구 + TUI + DB 스키마 변경.

- 예: v0.0.9 Server Awareness (pipeline 3파일 + tools + prompts + TUI)
- 예: v0.0.10 Global Secrets (DB 스키마 + crypto + tools + TUI)

### 위험 신호 (스코프 경고)

- DB 스키마 변경 → 마이그레이션 필요, 기존 데이터 호환 고려
- 온보딩 플로우 변경 → 신규 사용자 경험 전체 영향
- 도구 시그니처 변경 → MCP 클라이언트 하위 호환성 깨짐
- 외부 API 의존 → Cloudflare, GitHub 등 서비스 장애 시 영향

---

## 기술적 제약 (PM이 알아야 할 것)

### 런타임

- **Bun** 전용 (Node.js 호환 but Bun 전용 API 사용 — bun:sqlite 등)
- TUI는 **OpenTUI** (Zig 네이티브, SolidJS 렌더러) — React/Ink 아님
- ESM only, `.js` 확장자 필수

### Docker 의존

- Docker daemon이 반드시 실행 중이어야 함
- `dockerode` 라이브러리로 Docker API 호출
- 컨테이너 ↔ Traefik: Docker 라벨 기반 라우팅

### 싱글 프로세스

- 데몬 1개 + TUI 1개 (IPC 통신)
- 멀티유저 = 같은 서버, 같은 데몬, 같은 DB
- 동시 배포는 JobManager가 관리

### 데이터

- SQLite = 파일 1개. 백업 쉬움. 하지만 동시 쓰기 제한.
- 환경변수 평문 저장 (v0.0.10에서 암호화 예정)
- Docker 이미지/볼륨은 Docker가 관리 (OpenLander DB에는 메타데이터만)

### 네트워크

- Traefik이 80/8080 포트 점유 (하드코딩 — v0.0.9에서 개선)
- Cloudflare Tunnel은 선택적 (없어도 로컬 사용 가능)
- 포트 10000-10999 대역을 OpenLander가 사용 (자동 할당)

---

## 확장 포인트 (기능 추가가 쉬운 곳)

| 확장점               | 방법                                 | 예시                      |
| -------------------- | ------------------------------------ | ------------------------- |
| 새 도구 추가         | `registry.ts`에 객체 추가            | `get_server_context` 도구 |
| 새 LLM 프로바이더    | `src/llm/`에 파일 추가               | DeepSeek, Mistral         |
| 새 봇 채널           | `src/channels/`에 파일 추가          | Line, WhatsApp            |
| 새 빌드 레시피       | `build-recovery.ts` 배열에 추가      | Ruby, Go 빌드 에러 패턴   |
| 새 Dockerfile 템플릿 | `dockerfile-gen.ts`에 분기 추가      | Deno, Bun 프레임워크      |
| Dashboard 섹션       | `DashboardPanel.tsx`에 컴포넌트 추가 | Server 섹션 (v0.0.9)      |
| 슬래시 명령          | `src/tui/commands/`에 추가           | /stats, /deploy           |
| DB 테이블            | `schema.ts` + 마이그레이션           | global_secrets (v0.0.10)  |

---

## 병목/약점 (PM이 기획 시 우회해야 할 것)

| 약점              | 설명                                                 | 우회                                                    |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| TUI 테스트 어려움 | OpenTUI 렌더링은 unit test 불가. 상태 로직만 테스트. | UI 변경은 수동 확인 필수. 상태를 분리하여 테스트.       |
| LLM 비결정성      | 같은 입력에 다른 출력. 에이전트 행동 예측 불가.      | 도구 시그니처를 명확히 하여 LLM 역할 최소화.            |
| 동시 배포 경합    | JobManager가 큐잉하지만, Docker 자원 경합 가능.      | 배포 수 제한 또는 순차 실행 옵션.                       |
| Cloudflare 의존   | 외부 접근이 Cloudflare에 종속.                       | 대안 터널 (ngrok 등) 추가 가능하지만 우선순위 낮음.     |
| SQLite 동시성     | WAL 모드지만, 높은 동시 쓰기에는 부적합.             | 1인/소규모 팀 대상이라 현재 충분. 스케일 시 PostgreSQL. |
