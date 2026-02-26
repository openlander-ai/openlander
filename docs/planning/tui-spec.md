# OpenLander v1.0 — TUI 리팩토링 개발 스펙

## 핵심 방향 전환

**기존**: 웹 채팅 UI가 메인 인터페이스
**변경**: TUI (채팅 + 모니터링)가 메인, MCP는 고급 옵션

**피치 변경**:

- 기존: "AI agent that deploys your app from a chat"
- 변경: **"Give any coding agent the power to deploy"**

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────┐
│  인터페이스 (UI 레이어)                                   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  TUI (메인)   │  │  MCP 서버    │  │  CLI 명령어   │   │
│  │  채팅+모니터링 │  │  (고급 옵션)  │  │  (유틸리티)   │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │           │
│         └────────┬────────┴────────┬────────┘           │
│                  ↓                                      │
│         Unix Socket (IPC)                               │
│         ~/.openlander/openlander.sock                   │
│                  ↓                                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │  OpenLander Daemon (백그라운드)                    │    │
│  │                                                 │    │
│  │  ├─ Hono API (Unix socket 바인딩)                │    │
│  │  ├─ Agent (LLM 연동 — 의도 파악, 에러 설명)       │    │
│  │  ├─ SessionStore (세션별 채팅 히스토리)             │    │
│  │  ├─ Pipeline (git → build → run → traefik)       │    │
│  │  ├─ Docker 제어 (dockerode)                      │    │
│  │  ├─ Traefik 관리                                 │    │
│  │  ├─ Tunnel 관리 (TryCloudflare / Cloudflare)     │    │
│  │  └─ SQLite (상태, 로그, 환경변수, 채팅)            │    │
│  └─────────────────────────────────────────────────┘    │
│                  ↓                                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │  인프라                                          │    │
│  │  Docker + Traefik + Cloudflare                   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Daemon ↔ 클라이언트 통신

### IPC 방식: Unix Socket

```
경로: ~/.openlander/openlander.sock
프로토콜: HTTP over Unix Socket (Hono)
스트리밍: NDJSON (Newline-Delimited JSON)
```

### API 엔드포인트

```
# 채팅 (스트리밍)
POST /api/chat
Body: { sessionId: string, message: string }
Response: NDJSON 스트림
  → { type: "text", content: "클론 중..." }
  → { type: "tool_start", tool: "git_clone", args: {...} }
  → { type: "tool_result", tool: "git_clone", result: {...} }
  → { type: "text", content: "✅ 배포 완료!" }
  → { type: "done" }

# 프로젝트 목록
GET /api/projects
Response: { projects: Project[] }

# 프로젝트 상세
GET /api/projects/:id
Response: { project: Project, envVars: EnvVar[], deployLogs: DeployLog[] }

# 시스템 상태
GET /api/system/stats
Response: { cpu: number, memory: { used, total }, disk: { used, total }, containers: number, uptime: string }

# 프로젝트별 실시간 상태
GET /api/projects/:id/stats
Response: { cpu: number, memory: number, status: string }

# 로그 스트리밍
GET /api/projects/:id/logs?follow=true
Response: NDJSON 스트림 (실시간 로그)

# 빌드 진행률
GET /api/builds/:id/progress
Response: NDJSON 스트림
  → { type: "progress", percent: 67, step: "Installing dependencies..." }
  → { type: "complete" }

# 데몬 상태 (헬스체크)
GET /api/health
Response: { status: "ok", version: string, uptime: string }

# 활동 로그 스트리밍
GET /api/activity?follow=true
Response: NDJSON 스트림 (전체 활동 로그)
  → { type: "deploy", project: "backend", user: "dongbin", status: "success", time: "..." }
  → { type: "env_update", project: "frontend", user: "minsoo", key: "API_KEY", time: "..." }
```

---

## TUI 상세 설계

### 레이아웃

```
┌─ OpenLander ─────────────────────────────────────────────────────┐
│                                                                  │
│  ┌─ Chat ───────────────────────┬─ Dashboard ──────────────────┐ │
│  │                              │                              │ │
│  │  (채팅 영역)                  │  (모니터링 영역)              │ │
│  │                              │                              │ │
│  │                              │                              │ │
│  │                              │                              │ │
│  │                              │                              │ │
│  │                              │                              │ │
│  │                              │                              │ │
│  │                              │                              │ │
│  │                              │                              │ │
│  ├──────────────────────────────┤                              │ │
│  │ > _                          │                              │ │
│  └──────────────────────────────┴──────────────────────────────┘ │
│                                                                  │
│  [Tab] 패널 전환  [/] 슬래시 명령  [Ctrl+C] 종료  [?] 도움말     │
└──────────────────────────────────────────────────────────────────┘
```

**비율**: 좌측 채팅 60% / 우측 대시보드 40% (터미널 너비에 따라 반응형)
**최소 너비**: 80 컬럼. 미만이면 단일 패널 모드 (탭으로 전환)

### 좌측: 채팅 패널

```
┌─ Chat ──────────────────────────┐
│                                 │
│  You: backend 배포해줘           │
│                                 │
│  🔄 git clone 중...             │
│  ✅ git clone 완료 (2.3s)       │
│  🔄 docker build 중...          │
│  ████████████░░░░░░ 67%         │
│  ✅ docker build 완료 (38s)     │
│  🔄 컨테이너 시작 중...          │
│  ✅ 배포 완료!                   │
│                                 │
│  🔒 http://backend.local:10003  │
│                                 │
│  You: 외부에서 보여줘            │
│                                 │
│  ✅ Quick Share 활성화           │
│  🌐 https://shy-tiger-abc.try.. │
│  ⚠️  임시 URL. 재시작 시 변경됨  │
│                                 │
├─────────────────────────────────┤
│ > _                             │
└─────────────────────────────────┘
```

**채팅 메시지 타입별 렌더링:**

| 타입            | 렌더링                                  |
| --------------- | --------------------------------------- |
| 유저 메시지     | `You: {message}` (밝은 색)              |
| 에이전트 텍스트 | 일반 텍스트 (기본 색)                   |
| 도구 시작       | `🔄 {도구 설명} 중...` (노란색)         |
| 도구 성공       | `✅ {도구 설명} 완료 ({시간})` (녹색)   |
| 도구 실패       | `❌ {도구 설명} 실패` (빨간색)          |
| 빌드 진행       | `████░░░░ 67%` (프로그레스 바)          |
| URL             | 하이라이트 + 클릭 가능 (터미널 지원 시) |
| 경고            | `⚠️ {메시지}` (노란색)                  |
| 에러 상세       | 접이식 블록 (Enter로 펼치기)            |

**입력 영역:**

```
> backend 로그 보여줘              ← 자연어 (에이전트가 처리)
> /repo                           ← 레포 선택 → 배포
> /git                            ← Git 연결 관리
> /model                          ← LLM 모델 변경
> /env                            ← 환경변수 관리
> /compact                        ← 컨텍스트 압축
> /help                           ← 도움말
```

- 자연어와 슬래시 명령 모두 지원
- 자연어: LLM 에이전트가 의도 파악 후 도구 호출
- 슬래시 명령: LLM 거치지 않고 직접 실행 (빠름, 토큰 절약)
- Tab 자동완성: 프로젝트 이름, 명령어

### 우측: 대시보드 패널

```
┌─ Dashboard ────────────────────┐
│                                │
│ ▸ System          CPU 23%  ◼◼◻ │
│   MEM 4.2/16GB    Disk 45%    │
│   Docker 5 containers         │
│   Uptime 14d 3h               │
│                                │
│ ▸ Projects (5)                 │
│                                │
│   ● frontend   :3000  ✓  128M │
│     app.mysite.com             │
│   ● backend    :8080  ✓  256M │
│     api.mysite.com             │
│   ◐ worker     BUILD  67%     │
│     -                          │
│   ● redis      :6379  ✓   64M │
│     (internal)                 │
│   ● admin      :3001  ✓   96M │
│     admin.mycompany.io         │
│                                │
│ ▸ Activity                     │
│                                │
│   14:32 dongbin ✅ backend dep │
│         commit a3f2b1 (12s)    │
│   14:30 jihye  🔄 worker build │
│   14:28 dongbin ✅ env: API_K  │
│   14:15 minsoo ✅ frontend red │
│   13:42 jihye  ❌ demo failed  │
│                                │
│ ▸ MCP Clients                  │
│   ● Claude Code (connected)    │
│   ○ Cursor (disconnected)      │
│                                │
└────────────────────────────────┘
```

**대시보드 섹션:**

#### 1. System (항상 표시)

```
CPU 사용률:  숫자 + 미니 바 차트
메모리:      used/total (GB)
디스크:      used/total 또는 퍼센트
Docker:      실행 중 컨테이너 수
Uptime:      데몬 가동 시간
```

- 5초마다 갱신
- CPU/MEM이 80% 넘으면 빨간색 하이라이트

#### 2. Projects (항상 표시)

```
각 프로젝트:
  상태 아이콘: ● running (녹색), ◐ building (노란색), ○ stopped (회색), ✖ error (빨간색)
  이름
  포트 (내부)
  상태 표시: ✓ healthy, BUILD 67%, ERROR
  메모리 사용량
  도메인 (있으면 표시, 없으면 - 또는 internal)
```

- 프로젝트 이름은 최대 12자까지, 넘으면 말줄임
- 빌드 중인 프로젝트는 프로그레스 바 표시
- 3초마다 갱신

#### 3. Activity (항상 표시)

```
최근 활동 로그 (최대 10개 표시, 스크롤 가능)
  시간  상태아이콘  프로젝트명  액션
  예: 14:32 ✅ backend deployed (commit a3f2b1, 12s)
  예: 14:30 🔄 worker build started
  예: 13:42 ❌ demo build failed: sharp not found
```

- 실시간 스트리밍 (새 이벤트 발생 시 위에 추가)
- 에러는 빨간색, 빌드 중은 노란색

#### 4. MCP Clients (MCP 활성화 시만 표시)

```
연결된 MCP 클라이언트 목록
  ● Claude Code (connected) — 마지막 요청: 2분 전
  ○ Cursor (disconnected)
```

### 키보드 단축키

| 키        | 동작                                                           |
| --------- | -------------------------------------------------------------- |
| `Tab`     | 좌측/우측 패널 포커스 전환                                     |
| `Enter`   | 채팅 메시지 전송                                               |
| `↑` / `↓` | 채팅 히스토리 탐색 (포커스 좌측) / 프로젝트 선택 (포커스 우측) |
| `/`       | 슬래시 명령 모드 진입                                          |
| `Ctrl+L`  | 채팅 화면 클리어                                               |
| `Ctrl+C`  | 현재 실행 중인 작업 취소 / 두 번 누르면 종료                   |
| `q`       | 종료 (채팅 입력 중 아닐 때)                                    |
| `?`       | 도움말 오버레이                                                |
| `Esc`     | 오버레이/모달 닫기                                             |

### 반응형 동작

```
터미널 너비 ≥ 80:   좌우 분할 (60:40)
터미널 너비 < 80:   단일 패널 모드
  - Tab으로 Chat ↔ Dashboard 전환
  - 하단 상태바에 요약 표시: "5 projects | CPU 23% | 1 building"
```

### 색상 테마

```
기본 색상 (다크 터미널 기준):
  배경:        터미널 기본 배경
  일반 텍스트:  터미널 기본 전경
  유저 메시지:  Bold + Cyan
  에이전트:     기본 전경
  성공:        Green (#00FF00 계열)
  경고:        Yellow (#FFFF00 계열)
  에러:        Red (#FF0000 계열)
  진행 중:     Yellow
  URL:         Underline + Blue
  프로젝트명:  Bold
  비활성 텍스트: Dim/Gray
  테두리:       Dim/Gray
  섹션 제목:    Bold + White
```

---

## 슬래시 명령 상세

> 슬래시 명령은 9개로 제한. 배포/로그/중지/재시작 등 운영 작업은 자연어 채팅으로 처리.

| 명령어     | 설명                    | 비고                          |
| ---------- | ----------------------- | ----------------------------- |
| `/repo`    | 레포 선택 → 배포 트리거 | 오버레이에서 레포 선택        |
| `/git`     | Git 연결 관리           | SSH 키, 인증 설정             |
| `/model`   | LLM 모델 변경           | 프로바이더/모델 선택          |
| `/tunnel`  | Cloudflare Tunnel 설정  | Quick Share / 프로덕션 도메인 |
| `/env`     | 환경변수 관리           | 프로젝트별 조회/수정          |
| `/compact` | 컨텍스트 압축           | 채팅 히스토리 요약            |
| `/clear`   | 화면 클리어             |                               |
| `/exit`    | 종료                    |                               |
| `/help`    | 도움말                  | 명령어 + 단축키 안내          |

**자연어로 대체된 작업** (슬래시 커맨드 아님):

- 배포: "github.com/user/repo 배포해줘"
- 로그: "backend 로그 보여줘"
- 중지/시작/재시작: "backend 중지해줘"
- 상태: "서버 상태 어때?"
- 정리: "안 쓰는 컨테이너 정리해줘"
- 알림 전체 보기: "알림 전체 보여줘"

### 자동완성 규칙

- `/` 입력 시: 명령어 목록 표시
- 명령어 뒤 `<project>`: 등록된 프로젝트 이름 자동완성
- Tab 키로 순환
- 명령어 설명은 자동완성 팝업에 표시

---

## MCP 서버 설계

### 등록 방법

```bash
# 자동 등록 (권장)
openlander mcp install --claude-code    # Claude Code에 자동 등록
openlander mcp install --cursor         # Cursor에 자동 등록

# 수동 등록
claude mcp add openlander -- openlander mcp

# MCP 서버 모드 직접 실행 (디버깅용)
openlander mcp
```

`openlander mcp install --claude-code`가 하는 일:

1. Claude Code MCP 설정 파일 경로 탐색
2. openlander 엔트리 자동 추가
3. "✅ Claude Code에 MCP 등록 완료. Claude Code를 재시작하세요."

### MCP 도구 목록

**고수준 (한 마디로 끝나는 것들):**

| 도구       | 설명            | 입력                                                            |
| ---------- | --------------- | --------------------------------------------------------------- |
| `deploy`   | 레포 배포       | `{ repo: string, name?: string, env?: Record<string, string> }` |
| `redeploy` | 재빌드 + 재배포 | `{ project: string }`                                           |

**개별 도구 (세밀한 제어):**

| 도구               | 설명          | 입력                                                                  |
| ------------------ | ------------- | --------------------------------------------------------------------- |
| `list_projects`    | 프로젝트 목록 | `{}`                                                                  |
| `get_project`      | 프로젝트 상세 | `{ project: string }`                                                 |
| `get_logs`         | 컨테이너 로그 | `{ project: string, lines?: number }`                                 |
| `stop_project`     | 중지          | `{ project: string }`                                                 |
| `start_project`    | 시작          | `{ project: string }`                                                 |
| `restart_project`  | 재시작        | `{ project: string }`                                                 |
| `remove_project`   | 삭제          | `{ project: string }`                                                 |
| `set_env`          | 환경변수 설정 | `{ project: string, key: string, value: string, redeploy?: boolean }` |
| `get_env`          | 환경변수 조회 | `{ project: string }`                                                 |
| `expose`           | 외부 공개     | `{ project: string }`                                                 |
| `unexpose`         | 외부 해제     | `{ project: string }`                                                 |
| `map_domain`       | 도메인 매핑   | `{ project: string, domain: string }`                                 |
| `get_system_stats` | 시스템 상태   | `{}`                                                                  |

### MCP ↔ Daemon 통신

MCP 서버도 Unix Socket을 통해 Daemon에 연결.
단, MCP 도구는 **LLM 에이전트를 거치지 않고 직접 파이프라인 호출**.
(호출하는 쪽이 이미 에이전트이므로, 이중 에이전트를 방지)

```
Claude Code → MCP 도구 호출 → OpenLander MCP 서버
  → Unix Socket → Daemon API → Pipeline 직접 실행
  → 결과 반환 → Claude Code에 표시
```

단, `deploy`는 예외적으로 에이전트를 거칠 수 있음 (빌드 에러 분석 등).

---

## CLI 명령어

TUI와 별개로, 비대화형 CLI 명령도 제공.
스크립트/CI에서 사용하거나, 빠른 조회용.

```bash
# 실행 (처음이면 온보딩 → TUI, 이미 설정했으면 바로 TUI)
openlander                          # 메인 진입점. 이것만 기억하면 됨.

# 데몬 관리
openlander start                    # 데몬만 시작 (TUI 없이, 백그라운드)
openlander stop                     # 데몬 중지
openlander restart                  # 데몬 재시작
openlander status                   # 데몬 상태 확인

# 비대화형 명령 (TUI 없이)
openlander deploy <repo>            # 배포 후 종료
openlander list                     # 프로젝트 목록 출력
openlander logs <project>           # 로그 출력 후 종료

# 설정
openlander config                   # 설정 보기/수정
openlander config reset             # 설정 초기화 (온보딩 다시 실행)

# MCP
openlander mcp                      # MCP 서버 모드 (stdio)
openlander mcp install --claude-code  # Claude Code에 등록
openlander mcp install --cursor       # Cursor에 등록
```

### 실행 흐름

```
$ openlander
  ↓
  config.json 존재?
    ├─ No  → 온보딩 (Screen 1~6, 각 화면 full clear)
    │         → Enter → TUI 진입
    └─ Yes → 새 버전?
              ├─ Yes → 패치노트 1장 → Enter → TUI
              └─ No  → 데몬 연결/시작 → TUI 바로 진입
```

---

## 온보딩 플로우

### 진입점: `openlander` 한 번이면 끝

```
$ openlander
  ↓
  ~/.openlander/config.json 존재?
    ├─ No  → 온보딩 시작
    └─ Yes → 데몬 연결/시작 → TUI 바로 진입
             (새 버전이면 패치노트 한 번 표시)
```

별도 `openlander setup` 명령 없음. 첫 실행에 자동으로 온보딩.

### 화면 전환 방식

Claude Code처럼 **각 단계마다 화면을 완전히 새로 그림** (clear screen).
스크롤 방식 아님. 각 화면이 독립적. 입력/선택 후 다음 화면으로 전환.

### Screen 1: Welcome

```
╭─────────────────────────────────────────────╮
│                                             │
│            🚀 OpenLander v1.0.0             │
│                                             │
│   Give any coding agent the power to deploy │
│                                             │
│                                             │
│   [Enter] Get started                       │
│                                             │
╰─────────────────────────────────────────────╯
```

### Screen 2: Docker 확인 (자동, 입력 불필요)

```
╭─────────────────────────────────────────────╮
│                                             │
│  [1/5] Checking Docker...                   │
│                                             │
│  ✅ Docker v27.1.1 detected                 │
│  ✅ Docker daemon is running                │
│                                             │
│  [Enter] Continue                           │
│                                             │
╰─────────────────────────────────────────────╯
```

Docker 없으면:

```
╭─────────────────────────────────────────────╮
│                                             │
│  [1/5] Checking Docker...                   │
│                                             │
│  ❌ Docker not found                        │
│                                             │
│  Install Docker first:                      │
│  https://docs.docker.com/get-docker/        │
│                                             │
│  [Enter] Retry  [q] Quit                    │
│                                             │
╰─────────────────────────────────────────────╯
```

### Screen 3: Git 저장소 연동 ⭐ (핵심)

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git Repository Access                │
│                                             │
│  > GitHub Login  (opens browser)            │
│    GitLab Login  (opens browser)            │
│    SSH Key       (works over remote/SSH)    │
│    Skip          (public repos only)        │
│                                             │
╰─────────────────────────────────────────────╯
```

- **GitHub/GitLab Login**: OAuth Device Flow. 로컬 환경에서 편리.
- **SSH Key**: 원격 SSH 접속 시, 또는 Bitbucket/Gitea 등 OAuth 미지원 호스팅.
- 구현 순서: SSH (v1.0) → OAuth (v1.1)

#### OAuth (GitHub Login) 선택 시:

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git — GitHub Login                   │
│                                             │
│  Enter this code on GitHub:                 │
│                                             │
│         ┌───────────────┐                   │
│         │  ABCD-1234    │                   │
│         └───────────────┘                   │
│                                             │
│  https://github.com/login/device            │
│  (browser opened automatically)             │
│                                             │
│  Waiting for authorization...  ◐            │
│                                             │
╰─────────────────────────────────────────────╯
```

인증 후:

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git — GitHub Login                   │
│                                             │
│  ✅ GitHub: authenticated as @dongbin       │
│  Access: private repositories ✅             │
│                                             │
│  [Enter] Continue                           │
│                                             │
╰─────────────────────────────────────────────╯
```

- Device Flow 사용 (원격 SSH 환경에서도 동작, 폰으로도 인증 가능)
- 로컬이면 브라우저 자동 오픈, 원격이면 URL 직접 접속
- 토큰은 config.json에 저장, git credential helper 등록
- 토큰 만료 시 자동 refresh

#### SSH Key 선택 시:

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git — SSH Key                        │
│                                             │
│  > Use existing key                         │
│    Generate new key                         │
│                                             │
╰─────────────────────────────────────────────╯
```

**"Use existing key" 선택 시:**

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git — SSH Key                        │
│                                             │
│  Found SSH keys:                            │
│                                             │
│  > ~/.ssh/id_ed25519                        │
│    ~/.ssh/id_rsa                            │
│    Enter custom path                        │
│                                             │
╰─────────────────────────────────────────────╯
```

선택 후:

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git Repository Access                │
│                                             │
│  ✅ Using ~/.ssh/id_ed25519                 │
│                                             │
│  Testing connection...                      │
│  ✅ GitHub: authenticated as @dongbin       │
│                                             │
│  [Enter] Continue                           │
│                                             │
╰─────────────────────────────────────────────╯
```

**"Generate new SSH key" 선택 시:**

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git Repository Access                │
│                                             │
│  🔄 Generating SSH key...                   │
│  ✅ Created ~/.ssh/openlander_ed25519       │
│                                             │
│  Add this public key to your Git provider:  │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... │   │
│  │ openlander@macmini                   │   │
│  └──────────────────────────────────────┘   │
│  [c] Copy to clipboard                      │
│                                             │
│  Where to add:                              │
│  • GitHub:  Settings → SSH Keys → New       │
│  • GitLab:  Preferences → SSH Keys          │
│  • Bitbucket: Settings → SSH Keys           │
│                                             │
│  [Enter] I've added it, continue            │
│                                             │
╰─────────────────────────────────────────────╯
```

Enter 후 연결 테스트:

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git Repository Access                │
│                                             │
│  Testing connection...                      │
│  ✅ GitHub: authenticated as @dongbin       │
│                                             │
│  [Enter] Continue                           │
│                                             │
╰─────────────────────────────────────────────╯
```

테스트 실패 시:

```
╭─────────────────────────────────────────────╮
│                                             │
│  [2/5] Git Repository Access                │
│                                             │
│  Testing connection...                      │
│  ❌ GitHub: permission denied               │
│                                             │
│  The public key might not be added yet.     │
│                                             │
│  [r] Retry  [s] Skip  [Enter] Show key      │
│                                             │
╰─────────────────────────────────────────────╯
```

### Screen 4: LLM Provider

```
╭─────────────────────────────────────────────╮
│                                             │
│  [3/5] AI Provider                          │
│                                             │
│  OpenLander uses AI to understand your      │
│  commands and explain errors.               │
│                                             │
│  Select a provider:                         │
│                                             │
│  > OpenRouter  (free, no credit card)       │
│    Gemini      (free tier available)        │
│    Anthropic   (Claude)                     │
│    OpenAI      (GPT)                        │
│    Custom      (OpenAI-compatible URL)      │
│                                             │
╰─────────────────────────────────────────────╯
```

**OpenRouter 선택 시:**

```
╭─────────────────────────────────────────────╮
│                                             │
│  [3/5] AI Provider — OpenRouter             │
│                                             │
│  Get a free API key (no credit card):       │
│  https://openrouter.ai/keys                 │
│                                             │
│  API Key: sk-or-v1-________________         │
│                                             │
│  [Enter] Verify                             │
│                                             │
╰─────────────────────────────────────────────╯
```

검증 후:

```
╭─────────────────────────────────────────────╮
│                                             │
│  [3/5] AI Provider — OpenRouter             │
│                                             │
│  ✅ API key verified                        │
│  Model: google/gemini-2.0-flash-exp:free    │
│                                             │
│  [Enter] Continue                           │
│                                             │
╰─────────────────────────────────────────────╯
```

### Screen 5: Traefik Setup (자동)

```
╭─────────────────────────────────────────────╮
│                                             │
│  [4/5] Setting up Traefik...                │
│                                             │
│  🔄 Creating Docker network...              │
│  ✅ Network: openlander-network             │
│  🔄 Starting Traefik container...           │
│  ✅ Traefik ready on port 80                │
│                                             │
│  [Enter] Continue                           │
│                                             │
╰─────────────────────────────────────────────╯
```

### Screen 6: 완료 + 보안 고지 + 패치노트

```
╭─────────────────────────────────────────────╮
│                                             │
│  [5/5] Ready!                               │
│                                             │
│  ⚠️  OpenLander will:                       │
│  • Manage Docker containers on this machine │
│  • Control Traefik routing (port 80)        │
│  • Clone repositories via SSH               │
│                                             │
│  Data: ~/.openlander/                       │
│  Projects: ~/.openlander/projects/          │
│  Config: ~/.openlander/config.json          │
│                                             │
│  ──────────────────────────────────         │
│                                             │
│  📋 What's new in v1.0.0                    │
│  • TUI: Chat + live dashboard               │
│  • MCP: Claude Code & Cursor integration    │
│  • Quick Share via TryCloudflare            │
│  • Slash commands for power users           │
│                                             │
│  [Enter] Start OpenLander                   │
│                                             │
╰─────────────────────────────────────────────╯
```

Enter → 화면 클리어 → TUI 진입:

```
┌─ Chat ────────────────────┬─ Dashboard ───────────────┐
│                           │ System       CPU 2%       │
│  Welcome! 👋              │ MEM 0.3/16GB              │
│                           │                           │
│  Try:                     │ Projects (0)              │
│  "deploy github.com/..."  │ No projects yet           │
│  or type /help            │                           │
│                           │ Activity                  │
├───────────────────────────┤ ✅ Setup complete          │
│ > _                       │                           │
└───────────────────────────┴───────────────────────────┘
```

### 재실행 시 (이미 설정 완료)

```
$ openlander
  → config.json 확인 → 데몬 시작 → 바로 TUI 진입
  (1초 이내)
```

새 버전 업데이트 후 첫 실행:

```
$ openlander
  → 패치노트 화면 1장 → [Enter] → TUI 진입
```

### 온보딩 구현 노트

- 각 Screen은 @opentui/solid 컴포넌트 1개. 시그널로 현재 단계 관리.
- 화면 전환 시 `console.clear()` 활용.
- 키보드: ↑↓ 선택, Enter 확인, q 종료, r 재시도.
- 자동 단계(Docker 확인, Traefik 세팅)는 스피너 표시 후 결과.
- SSH key 테스트: `ssh -T git@github.com` 실행해서 결과 파싱.

---

## 설정 파일

경로: `~/.openlander/config.json`

```json
{
  "llm": {
    "provider": "openrouter",
    "apiKey": "sk-or-v1-xxxx",
    "model": "google/gemini-2.0-flash-exp:free"
  },
  "git": {
    "sshKeyPath": "~/.ssh/id_ed25519"
  },
  "docker": {
    "socketPath": "/var/run/docker.sock"
  },
  "traefik": {
    "network": "openlander-network",
    "dashboardPort": 8080
  },
  "cloudflare": {
    "apiToken": null,
    "tunnelId": null
  },
  "server": {
    "socketPath": "~/.openlander/openlander.sock"
  },
  "portRange": {
    "start": 10000,
    "end": 10999
  }
}
```

---

## 데이터 디렉토리

```
~/.openlander/
├── config.json              # 설정
├── openlander.sock          # Unix socket (데몬 실행 시)
├── openlander.pid           # 데몬 PID 파일
├── openlander.db            # SQLite 데이터베이스
├── logs/
│   └── daemon.log           # 데몬 로그 (파일 로테이션)
└── projects/
    ├── my-app/              # git clone 위치
    ├── backend/
    └── frontend/
```

---

## 프로젝트 구조 (리팩토링 후)

```
openlander/
├── package.json
├── tsconfig.json
├── bin/
│   └── openlander.ts                 # CLI 엔트리포인트
├── src/
│   ├── cli/
│   │   ├── index.ts                  # CLI 명령어 라우팅 (openlander → 온보딩/TUI 분기)
│   │   └── commands.ts               # 비대화형 CLI 명령 (deploy, list, logs 등)
│   │
│   ├── daemon/
│   │   ├── index.ts                  # 데몬 엔트리포인트
│   │   ├── server.ts                 # Hono API (Unix socket)
│   │   ├── routes/
│   │   │   ├── chat.ts               # POST /api/chat (스트리밍)
│   │   │   ├── projects.ts           # GET/POST /api/projects
│   │   │   ├── system.ts             # GET /api/system/stats
│   │   │   └── activity.ts           # GET /api/activity (SSE)
│   │   └── session.ts                # SessionStore (세션별 히스토리)
│   │
│   ├── agent/
│   │   ├── index.ts                  # 에이전트 코어 (LLM 연동)
│   │   ├── tools.ts                  # 도구 정의
│   │   └── prompts.ts                # 시스템 프롬프트
│   │
│   ├── pipeline/
│   │   ├── deploy.ts                 # 배포 파이프라인
│   │   ├── docker.ts                 # dockerode
│   │   ├── traefik.ts                # Traefik 라벨
│   │   ├── tunnel.ts                 # TryCloudflare / Cloudflare
│   │   ├── git.ts                    # git clone/pull
│   │   ├── port.ts                   # 포트 할당
│   │   └── env.ts                    # 환경변수
│   │
│   ├── monitor/
│   │   ├── healthcheck.ts            # 헬스체크
│   │   └── stats.ts                  # 시스템 리소스
│   │
│   ├── tui/
│   │   ├── index.ts                  # TUI 엔트리포인트
│   │   ├── app.tsx                   # 루트 컴포넌트 (@opentui/solid)
│   │   ├── components/
│   │   │   ├── Layout.tsx            # 좌우 분할 레이아웃
│   │   │   ├── ChatPanel.tsx         # 좌측 채팅 패널
│   │   │   ├── ChatInput.tsx         # 입력 영역 + 슬래시 명령
│   │   │   ├── ChatMessage.tsx       # 메시지 렌더링
│   │   │   ├── DashboardPanel.tsx    # 우측 대시보드
│   │   │   ├── SystemStats.tsx       # 시스템 정보
│   │   │   ├── ProjectList.tsx       # 프로젝트 목록
│   │   │   ├── ActivityLog.tsx       # 활동 로그
│   │   │   ├── McpClients.tsx        # MCP 연결 상태
│   │   │   ├── ProgressBar.tsx       # 프로그레스 바
│   │   │   ├── StatusBar.tsx         # 하단 상태바
│   │   │   └── HelpOverlay.tsx       # 도움말 오버레이
│   │   ├── onboarding/
│   │   │   ├── index.tsx             # 온보딩 컨트롤러 (단계 상태 관리)
│   │   │   ├── Welcome.tsx           # Screen 1: Welcome
│   │   │   ├── DockerCheck.tsx       # Screen 2: Docker 확인
│   │   │   ├── GitSetup.tsx          # Screen 3: Git SSH 연동 ⭐
│   │   │   ├── LlmSetup.tsx         # Screen 4: LLM 선택
│   │   │   ├── TraefikSetup.tsx      # Screen 5: Traefik
│   │   │   ├── Ready.tsx             # Screen 6: 완료 + 패치노트
│   │   │   └── PatchNotes.tsx        # 버전 업데이트 시 패치노트
│   │   ├── hooks/
│   │   │   ├── useChat.ts            # 채팅 스트리밍 훅
│   │   │   ├── useProjects.ts        # 프로젝트 목록 폴링
│   │   │   ├── useSystemStats.ts     # 시스템 상태 폴링
│   │   │   ├── useActivity.ts        # 활동 로그 스트리밍
│   │   │   └── useDaemon.ts          # 데몬 연결 관리
│   │   └── client.ts                 # IPC 클라이언트 (Unix socket)
│   │
│   ├── mcp/
│   │   ├── index.ts                  # MCP 서버 엔트리포인트
│   │   ├── tools.ts                  # MCP 도구 정의
│   │   └── install.ts                # MCP 자동 등록
│   │
│   ├── db/
│   │   ├── index.ts                  # SQLite 연결
│   │   └── schema.ts                 # 테이블 정의
│   │
│   └── llm/
│       ├── index.ts                  # LLM 프로바이더 추상화
│       ├── openrouter.ts             # OpenRouter (무료 포함)
│       ├── gemini.ts                 # Gemini Flash
│       ├── anthropic.ts              # Claude
│       ├── openai.ts                 # OpenAI
│       └── custom.ts                # OpenAI-compatible 커스텀 엔드포인트
│
├── templates/
│   ├── nextjs.Dockerfile
│   ├── fastapi.Dockerfile
│   └── ...
└── test/
```

---

## TUI 기술 스택

| 라이브러리                     | 용도                                              |
| ------------------------------ | ------------------------------------------------- |
| **@opentui/solid** (+ SolidJS) | TUI 프레임워크. SolidJS 기반으로 터미널 UI 렌더링 |
| **chalk**                      | 색상                                              |

**@opentui/solid를 선택한 이유:**

- SolidJS 기반이라 세밀한 반응성 + 경량 렌더링
- Ink(React) 대비 번들 크기 및 성능 우위
- OpenCode TUI 스택과 동일 (검증된 선택)

---

## 스트리밍 프로토콜 (NDJSON)

TUI ↔ Daemon 채팅 스트리밍은 NDJSON 사용.

```typescript
// 채팅 스트림 메시지 타입
type ChatStreamMessage =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; tool: string; description: string }
  | { type: 'tool_progress'; tool: string; percent: number; step?: string }
  | { type: 'tool_result'; tool: string; success: boolean; result?: any; error?: string }
  | { type: 'url'; url: string; label?: string }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string; detail?: string }
  | { type: 'confirm'; message: string; id: string } // 유저 확인 요청
  | { type: 'done' };
```

**TUI 클라이언트 사용 예:**

```typescript
// src/tui/client.ts
async function* chatStream(sessionId: string, message: string) {
  const res = await fetch(`http://unix:${SOCKET_PATH}:/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ sessionId, message }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as ChatStreamMessage;
    }
  }
}
```

---

## 핵심 유저 플로우

### 플로우 1: 처음 설치 → 첫 배포

```
$ npm i -g openlander
$ openlander
  → Screen 1: Welcome → [Enter]
  → Screen 2: Docker ✅ → [Enter]
  → Screen 3: Git SSH key 선택 → ✅ authenticated → [Enter]
  → Screen 4: LLM provider → OpenRouter → key 입력 → ✅ → [Enter]
  → Screen 5: Traefik ✅ → [Enter]
  → Screen 6: 보안 고지 + 패치노트 → [Enter]
  → TUI 진입

  [Chat]
  You: github.com/user/my-app 배포해줘

  🔄 Cloning repository...
  ✅ Clone complete (2.1s)
  🔄 Dockerfile found. Building...
  ████████████████████ 100%
  ✅ Build complete (45s)
  🔄 Starting container...
  ✅ Deployed!
  🔒 http://my-app.local:10003

  [Dashboard]
  ● my-app  :10003  ✓ OK  128MB
```

### 플로우 2: 코딩 에이전트에서 MCP로 배포

```
$ openlander mcp install --claude-code
  ✅ Claude Code에 MCP 등록 완료

  [Claude Code에서]
  User: 이 프로젝트 배포해줘
  Claude Code: (OpenLander MCP deploy 호출)
    → Deploying to OpenLander...
    → ✅ http://my-project.local:10004

  [OpenLander TUI 대시보드에 새 프로젝트 자동 표시]
```

### 플로우 3: 일상 관리

```
  [TUI Chat]
  You: backend 로그 보여줘
  → (최근 50줄 표시)

  You: 환경변수에 REDIS_URL 추가해줘
  → ✅ 추가. 재배포할까요? (y/n)
  You: y
  → 🔄 Redeploying...
  → ✅ 재배포 완료 (8s)

  You: 프로젝트 상태 보여줘
  → (전체 프로젝트 상태 테이블)

  You: 서버 리소스 어때?
  → CPU 45%, 메모리 6.2/16GB (39%)
    ⚠️ demo-old 프로젝트 3주째 접속 없습니다. 내릴까요?
```

---

## 확인(confirm) 플로우

위험한 작업은 반드시 유저 확인을 거침.

```
You: demo 프로젝트 삭제해줘

⚠️ demo 프로젝트를 삭제합니다.
   컨테이너, 이미지, 환경변수가 모두 삭제됩니다.
   이 작업은 되돌릴 수 없습니다.
   계속할까요? (y/n)

> y
✅ demo 프로젝트 삭제 완료.
```

**확인이 필요한 작업:**

- 프로젝트 삭제 (`remove`)
- 전체 환경변수 일괄 변경
- 프로덕션 도메인 연결/해제
- `cleanup` (미사용 리소스 정리)

**확인이 불필요한 작업:**

- 배포, 재배포
- 중지, 시작, 재시작
- 로그 조회
- 환경변수 단건 추가

---

## 멀티유저 지원

개발서버에 OpenLander 데몬 1개, 여러 개발자가 SSH로 접속해서 각자 TUI/MCP 사용.

### 세션 식별

TUI 접속 시 자동으로 세션 ID 생성. 활동 로그에 사용자 구분 표시.

```typescript
// 세션 ID = 시스템 유저명 + 타임스탬프
sessionId: `${os.userInfo().username}-${Date.now()}`;
```

활동 로그에 표시:

```
14:32 dongbin  ✅ backend deployed (a3f2b1)
14:30 jihye    🔄 frontend build started
14:28 minsoo   ✅ env updated: API_KEY
```

### 프로젝트 Deploy Lock

동일 프로젝트 동시 배포 방지. SQLite에 락 관리.

```sql
ALTER TABLE projects ADD COLUMN deploy_lock_session TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN deploy_lock_at DATETIME DEFAULT NULL;
```

```
개발자 A: backend 배포해줘 → 🔄 배포 중...
개발자 B: backend 배포해줘 → ⏳ Currently being deployed by dongbin. Queued (#1).
```

- 배포 시작 시 lock 획득, 완료/실패 시 해제
- 타임아웃: 10분 이상 lock 유지 시 자동 해제 (좀비 방지)
- 다른 프로젝트는 병렬 배포 가능

### 대시보드 공유

모든 TUI 클라이언트가 동일한 대시보드(프로젝트 상태, 활동 로그)를 봄.
한 명이 배포하면 다른 사람 대시보드에도 실시간 반영.

---

## 에러 처리 UX

### 빌드 실패 시

```
  🔄 Building...
  ████████████░░░░░░░░ 60%
  ❌ Build failed!

  Error: npm install failed
  → sharp@0.33.2: node-gyp rebuild failed

  💡 에이전트 분석:
  sharp 패키지가 현재 Dockerfile의 alpine 이미지에서
  네이티브 빌드에 실패했습니다.

  제안:
  1. Dockerfile에서 FROM node:20-slim으로 변경
  2. 또는 --platform=linux/amd64 플래그 추가

  시도해볼까요? (y/n)
```

### 데몬 연결 실패 시

```
  ⚠️ OpenLander daemon에 연결할 수 없습니다.

  시도:
  1. openlander start (데몬 시작)
  2. openlander setup (초기 설정)

  [r] 재시도  [s] 데몬 시작  [q] 종료
```

### 포트 충돌 시

```
  🔄 Starting container on port 10003...
  ⚠️ Port 10003 is in use by project "old-app"

  💡 자동으로 다음 포트 (10004)를 할당할까요?
     아니면 old-app을 중지할까요?

  [1] 10004 사용  [2] old-app 중지  [c] 취소
```

---

## 버전 로드맵 (업데이트)

### v1.0 — TUI + MCP 리팩토링 (현재)

- [ ] Daemon/클라이언트 분리 (Unix socket IPC)
  - [ ] TUI 메인 인터페이스 (@opentui/solid)
  - [ ] 온보딩 (화면 전환형, Git SSH 연동 + LLM + Docker/Traefik)
  - [ ] 좌우 분할 레이아웃
  - [ ] 채팅 패널 (자연어 + 슬래시 명령)
  - [ ] 대시보드 패널 (프로젝트, 시스템, 활동)
  - [ ] 반응형 (단일 패널 모드)
  - [ ] 키보드 단축키
- [ ] MCP 서버 (고급 옵션)
  - [ ] MCP 도구 정의
  - [ ] `openlander mcp install` 자동 등록
- [ ] CLI 유틸리티 명령어
- [ ] 기존 파이프라인 유지 (git, docker, traefik, tunnel)
- [ ] 웹 UI 제거 (또는 비활성화)

### v1.1 — 안정화

- [ ] GitHub/GitLab OAuth Device Flow (온보딩 원클릭 로그인)
- [ ] 빌드 프로그레스 정확도 개선
- [ ] 에러 분석 LLM 품질 개선
- [ ] 다양한 레포 테스트 + 호환성
- [ ] README 영문 정비 + GIF 제작

### v1.2 — 커뮤니티 출시

- [ ] Show HN + Reddit + 긱뉴스
- [ ] 블로그: "Everyone can code now. Nobody can deploy."
- [ ] 피드백 기반 우선순위 조정

---

## 개발 우선순위 (이번 스프린트)

```
1. Daemon 분리 (Unix socket + Hono API)
   → 기존 웹서버를 소켓 바인딩으로 변경
   → SessionStore 구현

2. 온보딩 (@opentui/solid)
   → 화면 전환형 단계별 온보딩
   → Git SSH 연동 (핵심), LLM 설정, Docker/Traefik 확인
   → config.json 존재 시 스킵

3. TUI 기본 프레임 (@opentui/solid)
   → Layout, ChatPanel, DashboardPanel 골격
   → IPC 클라이언트

4. 채팅 스트리밍 연결
   → useChat 훅 → NDJSON 파싱 → 메시지 렌더링

5. 대시보드 연결
   → useProjects, useSystemStats 훅 → 실시간 갱신

6. 슬래시 명령
   → ChatInput에서 / 감지 → 자동완성 → 직접 실행

7. MCP 서버
   → MCP SDK로 도구 정의 → Unix socket 연결

8. CLI 명령어
   → openlander start/stop/status/deploy/list
```

---

## README 구조 (출시용)

````markdown
# 🚀 OpenLander

**Give any coding agent the power to deploy.**

[30초 TUI GIF — 채팅으로 배포하는 장면]

## Why?

Everyone can code now. Nobody can deploy.
AI coding agents build your app — OpenLander deploys it.

## Install

​`bash
npm i -g openlander
openlander              # that's it.
​`

## Demo

[TUI GIF] [MCP GIF]

## How it works

​`
You: "deploy github.com/user/app"
OpenLander: clone → build → run → URL ✅
​`

## MCP Integration (optional)

​```bash
openlander mcp install --claude-code

# Now in Claude Code: "deploy this to my server"

​```

## Cost

Cloud (5 services): ~$100/month
Mac Mini + OpenLander: ~$600 once, then $0

## vs Coolify?

Coolify is a great PaaS dashboard.
OpenLander is an AI agent — no dashboard needed.
````
