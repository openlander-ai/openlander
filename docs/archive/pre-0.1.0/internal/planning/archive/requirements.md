# OpenLander — 요구사항 정의서 v4.0

> **버전**: v0.0.1~v0.0.8 전체 | **구현율**: 90% (v0.0.4까지 완료) | **버전 맵**: [`version-map.md`](version-map.md)

> **v3 → v4 주요 변경**: 웹 UI → TUI (@opentui/solid) 전환, 버전별 구현 체크리스트 추가, TUI UI/UX 고도화 로드맵 추가

## 한 줄 정의

**"레포 URL을 주면 배포를 해주는 AI 에이전트"** — npm 한 줄로 설치, 터미널에서 채팅으로 배포하는 오픈소스 도구.

## 컨셉

v0.dev가 "디자인을 설명하면 코드를 만들어주는 에이전트"라면,
OpenLander는 **"레포를 주면 배포를 해주는 에이전트"**.

에이전틱 코딩(Cursor, Claude Code 등)으로 앱을 만들 수 있게 됐지만 배포를 모르는 사람들이 타겟.
터미널에서 대화하면 에이전트가 빌드하고, 배포하고, URL을 만들어준다.

---

## 왜 만들었는가 (Origin Story)

### 짧은 버전 (README / 발표용)

> AI 스타트업에서 일하면서 깨달았다.
> 에이전틱 코딩 덕분에 아이디어만 있으면 누구나 앱을 만들 수 있는 시대가 됐다.
> 그런데 배포는? 여전히 어렵다.
> 개발의 진입장벽은 무너졌는데, 배포의 진입장벽은 그대로다.
> 그래서 만들었다 — 배포를 대신 해주는 AI 에이전트.

### 긴 버전 (블로그용)

**1. 에이전틱 코딩이 만든 새로운 문제**

AI 스타트업에서 일하면서, 에이전틱 코딩의 생산성 폭발을 직접 경험했다. 아이디어만 있으면 백오피스 서비스든, 내부 도구든, 데모든 MVP 수준의 서비스를 마음껏 만들어낼 수 있었다.

문제는 그 다음이었다. 만들어진 서비스들이 개발서버에 Docker 컨테이너로 마구잡이로 올라갔다. 포트 충돌, 환경변수 꼬임, 도메인 미설정 — 컨테이너가 10개를 넘어가면서 관리가 불가능해졌다. 인프라 전담 인력이 없는 스타트업에서, 백엔드 개발자였던 내가 개발도 하고 배포도 하고 인프라 관리도 해야 했다.

**2. 나만의 문제가 아니었다**

주변을 보니 같은 문제를 겪는 사람이 훨씬 많았다. 게임 개발자, 기획자, 디자이너 — 에이전틱 코딩 덕분에 웹 서비스를 직접 만들 수 있게 된 사람들이 폭발적으로 늘었다. 코딩의 진입장벽은 AI가 무너뜨렸는데, 배포의 진입장벽은 그대로였다.

Coolify나 Dokploy 같은 셀프호스팅 도구가 있지만, 이것들도 Docker, 리버스 프록시, 환경변수 같은 인프라 지식을 전제한다. "에이전틱 코딩으로 앱을 만들었는데 배포를 어떻게 해?" — 이 질문에 답하는 도구가 없었다.

그리고 비용 문제. 클라우드에서 데모 서비스 하나씩 늘어날 때마다, 아무리 저렴한 인스턴스를 쓰더라도 비용이 쌓인다. 서비스 5개만 돌려도 월 $50~100, 10개면 $200+. 환경변수 관리나 IAM은 더더욱 복잡하고. 미니PC 한 대면 이 비용이 0이 된다.

**3. 에이전트가 답이다**

AI 에이전트 시대가 열리면서 생각했다 — 배포도 에이전트가 해줄 수 있지 않을까? 코드를 분석하고, 빌드하고, 배포하고, URL까지 만들어주는 — 마치 인프라 엔지니어를 옆에 둔 것 같은 경험.

**4. 최종 비전**

궁극적으로는 LLM API 비용 없이 완전한 셀프호스팅으로 동작하는 것이 목표다. 배포라는 도메인은 범위가 좁아서, 소형 모델(8B~14B)을 파인튜닝하면 충분히 동작할 수 있다. 미니 PC 한 대에서 배포 에이전트가 로컬 모델로 돌아가면서, 팀의 모든 서비스를 관리하는 모습 — 이게 OpenLander의 최종 형태다.

### 블로그 제목 후보

- 🇬🇧 "Everyone can code now. Nobody can deploy. So I built an agent for that."
- 🇬🇧 "I built an AI agent that deploys your app — because coding got easy but deployment didn't"
- 🇰🇷 "에이전틱 코딩 시대, 배포만 남았다 — AI 배포 에이전트를 만든 이유"
- 🇰🇷 "코딩은 AI가 해주는 시대, 배포는 누가 해주나?"

### 비용 비교 (README용)

```
Cloud (5 services):      ~$100/month, forever
Mac Mini + OpenLander:   ~$600 once, $0/month
→ 6개월이면 본전
```

---

## 기술 스택

| 영역          | 기술                                        | 이유                                          |
| ------------- | ------------------------------------------- | --------------------------------------------- |
| 언어          | TypeScript                                  | npm 글로벌 설치 경험 (OpenCode/OpenClaw 방식) |
| 런타임        | Node.js ≥22                                 |                                               |
| 배포          | npm 패키지 (`npm i -g openlander`)          | 한 줄 설치                                    |
| **TUI**       | **@opentui/solid (SolidJS 기반 터미널 UI)** | **메인 인터페이스 — 터미널에서 직접 조작**    |
| Docker 제어   | dockerode                                   | Node.js Docker API                            |
| 리버스 프록시 | Traefik                                     | Docker 라벨 기반 자동 라우팅                  |
| 외부 접근     | TryCloudflare / Cloudflare Tunnel           | 무료 + 도메인 없이 시작 가능                  |
| AI 에이전트   | LLM API (BYOK)                              | Gemini Flash(무료) ~ Claude/GPT               |
| DB            | SQLite                                      | 프로젝트 상태, 배포 로그, 채팅                |

---

## 핵심 아키텍처

```
┌─────────────────────────────────────────────────┐
│  접근 채널                                       │
│  ├─ TUI (메인 — @opentui/solid 기반 터미널 UI)   │
│  ├─ REST API                                    │
│  ├─ MCP 서버 (v0.0.3 — 코딩 에이전트 연동)          │
│  └─ Slack/Discord/Telegram 봇 (v0.0.4)            │
└──────────────────┬──────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────┐
│  AI 에이전트 (1개)                               │
│  ├─ 의도 파악: "배포해줘" → deploy 명령           │
│  ├─ 명확화 질문: "어떤 프로젝트? 외부망?"          │
│  ├─ 에러 설명: "빌드 실패, sharp 호환성 문제"      │
│  └─ 환경변수 관리: "전체 프로젝트 키 교체"         │
│  ※ 판단만 함. 실행은 아래 파이프라인이 담당        │
└──────────────────┬──────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────┐
│  배포 파이프라인 (deterministic — 규칙 기반)      │
│  ├─ git_clone                                   │
│  ├─ docker build                                │
│  ├─ docker run (포트 자동 할당 + Traefik 라벨)   │
│  ├─ 외부 공개 (TryCloudflare / Tunnel)          │
│  ├─ 환경변수 관리                                │
│  ├─ 로그 조회                                    │
│  ├─ 중지 / 삭제 / 재시작                         │
│  └─ 실패 시 자동 롤백                            │
└──────────────────┬──────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────────┐
│  인프라                                          │
│  Docker + Traefik + Cloudflare + SQLite         │
└─────────────────────────────────────────────────┘
```

**핵심 원칙**: 실행은 deterministic, LLM은 대화/설명/에러 분석만.

---

## 에이전트 설계

### LLM 역할 (가벼움)

배포 도메인에서 LLM이 할 일은 세 가지뿐:

1. **의도 파악**: "배포해줘" → deploy 명령
2. **명확화 질문**: "어떤 프로젝트요? 외부망으로?" (TUI 내 인라인 질문)
3. **에러 설명**: 빌드 로그 → "sharp 패키지 문제예요, debian-slim로 바꿔볼까요?"

코딩 에이전트처럼 복잡한 추론 불필요 → **Gemini Flash(무료)급으로 충분**.

### 에이전트 구조

- 에이전트 **1개** + 도구(함수) 23개
- 멀티 에이전트 아님 (오버엔지니어링)
- 빌드 에러 분석은 별도 LLM 호출 함수 (`analyzeBuildError(log)`)로 처리, 서브에이전트 아님
- 빌드 에러 레시피 시스템 (10개 패턴 — fast-path)

### 도구 목록

| 도구                | 설명                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `git_clone`         | GitHub 레포 클론                                                  |
| `docker_build`      | Dockerfile로 이미지 빌드                                          |
| `docker_run`        | 컨테이너 실행 (포트 할당 + Traefik 라벨)                          |
| `docker_stop`       | 컨테이너 중지                                                     |
| `docker_remove`     | 컨테이너 삭제                                                     |
| `get_logs`          | 컨테이너 로그 조회                                                |
| `list_projects`     | 실행 중 프로젝트 목록                                             |
| `set_env_vars`      | 환경변수 설정                                                     |
| `expose_public`     | 외부 URL 생성 (TryCloudflare)                                     |
| `unexpose_public`   | 외부 URL 제거                                                     |
| `map_domain`        | 프로젝트에 커스텀 도메인 매핑 (Cloudflare DNS + Tunnel + Traefik) |
| `list_domains`      | 도메인 매핑 현황 조회                                             |
| `get_system_stats`  | 호스트 리소스 확인                                                |
| `get_deploy_status` | 배포 진행 상태 실시간 조회                                        |
| `rollback`          | 직전 이미지로 롤백                                                |
| `blue_green_deploy` | 블루-그린 무중단 배포                                             |
| `provision_db`      | DB 자동 프로비저닝 (PostgreSQL sidecar)                           |
| `scan_dockerfiles`  | 모노레포 Dockerfile 경로 스캔                                     |
| `deploy_monorepo`   | 모노레포 병렬 배포                                                |
| `preview_deploy`    | 브랜치별 프리뷰 배포                                              |
| `detect_framework`  | 프레임워크 감지 + Dockerfile 템플릿 생성                          |
| `send_notification` | Slack/Discord/Telegram 알림 전송                                  |
| `debug_build`       | 빌드 에러 분석 (레시피 fast-path + LLM)                           |

---

## 외부 접근 3-tier

| 모드           | 대상          | 구현                     | 도메인 필요 |
| -------------- | ------------- | ------------------------ | ----------- |
| 🔒 Internal    | 같은 네트워크 | 로컬 IP + Traefik        | ❌          |
| 🌐 Quick Share | 데모/리뷰     | TryCloudflare (임시 URL) | ❌          |
| 🌐 Production  | 상시 공개     | Cloudflare Tunnel (영구) | ✅          |

- **기본값**: Internal (보안 우선)
- "외부에서 보여줘" → Quick Share 전환
- 프로젝트별 설정 저장, 재배포 시 유지
- 초기 세팅에서 Cloudflare 토큰 미입력 → Quick Share만 활성화

### 멀티 도메인 프로덕션 매핑

스타트업에서 여러 서비스를 각각 다른 도메인으로 운영하는 시나리오 지원.
Cloudflare에 등록된 여러 도메인을 프로젝트별로 자유롭게 매핑 가능.

**기술 구조:**

```
Cloudflare DNS (여러 도메인)
  api.myapp.com        ──┐
  app.myapp.com        ──┼──→ Cloudflare Tunnel (1개) ──→ Traefik ──→ 각 컨테이너
  admin.mycompany.io   ──┤
  demo.sideproject.dev ──┘
```

- Cloudflare Tunnel 1개가 여러 도메인/호스트네임을 동시 처리
- Traefik이 Host 헤더 기반으로 올바른 컨테이너로 라우팅
- SSL은 Cloudflare가 도메인별 자동 처리
- 내부적으로 두 단계: ① Cloudflare API로 DNS + Tunnel ingress 업데이트 ② Docker 컨테이너에 Traefik Host 라벨 설정

**자연어 매핑:**

```
유저: backend를 api.myapp.com으로 연결해줘
에이전트: ✅ https://api.myapp.com 접속 가능

유저: frontend는 app.myapp.com으로
에이전트: ✅ https://app.myapp.com 연결 완료

유저: 도메인 매핑 현황 보여줘
에이전트: 4개 프로젝트 연결 중:
         backend  → api.myapp.com
         frontend → app.myapp.com
         admin    → admin.mycompany.io
         demo     → demo.sideproject.dev
```

**온보딩 시 Cloudflare 세팅:**

- Cloudflare API 토큰 입력 (Zone 및 Tunnel 권한)
- 사용할 도메인 목록 자동 감지 (Cloudflare Zone 목록 조회)
- Tunnel 자동 생성 또는 기존 Tunnel 연결

---

## Git 접근 (Private Repo)

- **SSH key 방식** (OAuth 아님)
- 온보딩에서 SSH 키 경로 입력 또는 새 키 생성
- GitHub, GitLab, Bitbucket, Gitea 등 SSH 지원하는 모든 Git 호스팅 호환
- OAuth는 콜백 URL, 토큰 만료 관리 등 복잡도 높음 → SSH가 단순하고 범용적

```
openlander onboard

? Git SSH 키 경로: ~/.ssh/id_ed25519 (기본값)
  또는 새 키 생성할까요? [Y/n]
✅ SSH 키 등록 완료. GitHub/GitLab에 공개키를 추가하세요:
  ssh-ed25519 AAAAC3Nza... openlander@macmini
```

---

## 환경변수 관리

에이전트가 관리, TUI에서도 조회/수정 가능.

```
유저: my-app에 OPENAI_API_KEY 추가해줘
에이전트: ✅ 추가. 재배포할까요?

유저: 이 키 다른 프로젝트에도 쓰고 싶어
에이전트: other-app에도 추가할까요?

유저: OPENAI_API_KEY 바꿔야해, 전체 프로젝트 다 업데이트해줘
에이전트: 4개 프로젝트에서 사용 중. 전부 교체하고 재배포할까요?
```

- 값은 마스킹 상태로 표시 (`sk-****xxxx`)
- 평문 저장 금지 (최소한 파일 권한 제한)
- TUI에서 프로젝트별 환경변수 목록 확인 가능

---

## 설치 경험

```bash
# 설치
npm install -g openlander

# 실행 — TUI가 바로 뜸
openlander
# → Docker 설치 확인
# → Traefik 컨테이너 세팅
# → LLM API 키 입력 (또는 Gemini Flash 무료 선택)
# → (선택) Cloudflare 토큰
# → 완료 → TUI 대시보드 + 채팅 인터페이스

# 데몬 등록 (백그라운드 실행)
openlander onboard --install-daemon
```

---

## 핵심 유저 경험

```
유저: 이 레포 배포해줘 github.com/user/my-app

에이전트: 클론 중... ✅
         Dockerfile 확인 ✅
         빌드 중... ✅ (38초)
         컨테이너 실행 ✅
         🔒 http://my-app.local:10003

유저: 외부에서 보여줘

에이전트: ✅ https://shy-tiger-abc123.trycloudflare.com
         ⚠️ 임시 URL이에요. 재시작하면 바뀝니다.

유저: 환경변수에 DATABASE_URL 추가해줘

에이전트: ✅ 추가 + 재배포 완료 (12초)

유저: 로그 보여줘

에이전트: 최근 30줄:
         [14:32:01] Server started on port 3000
         [14:32:03] Database connected
         ...

유저: 서버 상태 어때?

에이전트: 프로젝트 7개 실행 중
         CPU 34%, 메모리 6.2/8GB (78%)
         ⚠️ demo-old 3주째 접속 없어요. 내릴까요?
```

---

## LLM 전략

| Phase        | LLM                                        | 설명                               |
| ------------ | ------------------------------------------ | ---------------------------------- |
| v0.0.1~0.0.2 | BYOK (Gemini Flash 무료 / Claude / OpenAI) | 유저가 API 키 입력                 |
| v0.0.3~0.0.4 | + Ollama (로컬 모델)                       | 완전한 셀프호스팅 가능             |
| v0.0.5+      | + 파인튜닝 모델 공개                       | dockmate-agent-8b HuggingFace 공개 |

**무료 사용 참고:**

- OpenRouter 무료 모델 (신용카드 불필요, 일 200요청 제한) → 배포 에이전트는 호출 빈도가 낮아서 사실상 충분
- OpenCode Zen처럼 자체 무료 티어 제공도 검토 가능 (Big Pickle, MiniMax 등 무료 모델 활용)
- 온보딩에서 "OpenRouter 무료 계정으로 시작하기" 옵션 제공하면 진입장벽 최소화

**파인튜닝 데이터 수집:**

- 에이전트 Tool Use 호출 로깅 (opt-in)
- 합성 데이터 병행: 다양한 레포 시나리오 시뮬레이션
- 도메인이 좁아서 (Docker, 포트, 도메인) 소형 모델로 충분

---

## 접근 채널

| 채널                     | Phase  | 사용 상황                              |
| ------------------------ | ------ | -------------------------------------- |
| **TUI (@opentui/solid)** | v0.0.1 | 메인 인터페이스 (터미널 채팅+대시보드) |
| REST API                 | v0.0.1 | TUI가 호출 + 외부 연동 기반            |
| MCP 서버                 | v0.0.3 | Claude Code/Cursor에서 배포 명령       |
| Slack/Discord/Telegram   | v0.0.4 | 이동 중 배포/관리                      |

**MCP 시나리오 (킬러 기능):**

```
# Claude Code에서
"이 프로젝트 맥미니에 배포해줘"
→ MCP로 OpenLander 호출 → 배포 → URL 반환
```

**노트북 → 맥미니 시나리오:**

```
[노트북 - Cursor/Claude Code]
"빌드하고 푸시하고 배포까지 해줘"
     │ git push + MCP/API call
     ▼
[맥미니 - OpenLander]
     │ pull → build → deploy
     ▼
✅ URL 반환
```

---

## 버전 로드맵 + 구현 체크리스트

### v0.0.1 — 레포 → URL (MVP) ✅ Complete

- [x] git clone → docker build → docker run → Traefik → URL
- [x] Dockerfile 있는 레포만 지원
- [x] TUI 채팅 인터페이스 (기본)
- [x] REST API
- [x] Internal + Quick Share (TryCloudflare)
- [x] 로그 확인
- [x] 중지/삭제
- [x] 환경변수 기본 관리
- [x] `npm i -g openlander` + `openlander onboard`

### v0.0.2 — 일상 관리 ✅ Complete

- [x] 환경변수 변경 → 자동 재배포
- [x] git push → 자동 재배포 (webhook)
- [x] 프로세스 모니터링 (헬스체크 + 알림)
- [x] 안 쓰는 컨테이너 감지 → 정리 제안
- [x] Production 모드 (Cloudflare Tunnel 영구 도메인)
- [x] 멀티 도메인 매핑 (프로젝트별 커스텀 도메인 연결)
- [x] Ollama 지원 (로컬 LLM)

### v0.0.3 — 코딩 에이전트 연동 ✅ Complete

- [x] MCP 서버 (Claude Code, Cursor, OpenCode 연동) — 23/23 tools synced
- [x] 롤백 (직전 이미지)
- [x] 블루-그린 무중단 배포 (Traefik 라벨 스위칭)
- [x] DB 자동 프로비저닝 (PostgreSQL sidecar)
- [x] 빌드 에러 자동 디버깅 강화 (레시피 10개 + LLM 분석)

### v0.0.4 — 멀티 채널 + 고급 배포 ✅ Complete

- [x] Slack/Discord/Telegram 봇
- [x] Preview 배포 (브랜치별)
- [x] Dockerfile 없는 레포 → 템플릿 자동 생성 (Next.js, FastAPI, Gradio, Streamlit)
- [x] 모노레포 지원 (parent-child 프로젝트 모델, 병렬 빌드)
- [x] 병렬 배포 (Promise.all 기반 멀티 도구 실행)
- [x] JobManager (배포 단계 실시간 트래킹)

### v0.0.5 — 완전한 셀프호스팅

- [ ] 파인튜닝 모델 공개 (openlander-agent-8b)
- [ ] Ollama 원클릭: `ollama pull openlander-agent`
- [ ] LLM API 비용 완전 제거 가능

### v0.0.6 — TUI UI/UX 고도화 ✅ Complete (97%)

> 백엔드 기능(v0.0.1~v0.0.4)이 모두 완료된 상태. 이제 **인터페이스 품질**에 집중.
> 레퍼런스: Claude Code / OpenCode의 깔끔한 터미널 UI (동일한 TS + @opentui/solid 스택).

**구현 완료:**

- [x] ChatView — 전체 대화 히스토리 스크롤, 유저/에이전트 메시지 구분 (색상/아이콘)
- [x] 에이전트 스트리밍 — `chatStream()` 연동, thinking/tool_call/tool_result/message 실시간 표시
- [x] ToolCallDisplay — 도구 호출 인라인 표시 (아이콘 + 상태 + 소요시간)
- [x] 슬래시 커맨드 시스템 — 9개 커맨드: /repo, /git, /model, /tunnel, /env, /compact, /clear, /exit, /help
- [x] SlashCommandPicker — `/` 입력 시 자동완성 드롭다운 (↑↓ 탐색, Tab 완성, Enter 실행)
- [x] ChatInput — 슬래시 커맨드 감지, 입력 히스토리 (↑↓), 포커스 스타일링
- [x] 오버레이 시스템 — 풀스크린 오버레이 (RepoOverlay, GitOverlay, ModelOverlay, TunnelOverlay, EnvOverlay, HelpOverlay)
- [x] 전용 오버레이 — /repo, /git, /model, /tunnel, /env, /help 각각 전용 오버레이
- [x] HelpOverlay — /help로 전체 명령어 + 키보드 단축키 안내
- [x] Dashboard 레이아웃 개편 — 채팅 중심 (기본), 사이드바 토글 (Tab)
- [x] 상태바 — 프로젝트 수, 실행 상태, 컨텍스트 기반 힌트
- [x] 입력 히스토리 — ↑↓로 이전 입력 탐색 (50개 보관)

**남은 고도화 항목:**

#### 1. 채팅 영역 추가 개선

- [x] 멀티라인 입력 지원
- [x] 코드 블록 / 로그 블록 신택스 하이라이팅
- [x] 마크다운 렌더링 (커스텀 파서)

#### 2. 에이전트 상호작용 추가

- [x] 배포 파이프라인 진행률 시각화 (StatusBar 퍼센트 표시)
- [x] 명확화 질문 시 선택지 UI (QuestionDock)

#### 3. 대시보드 추가 고도화

- [x] 프로젝트 카드 UI (상태/포트 표시 — 카드 스타일은 부분 구현)
- [x] 시스템 리소스 미니 그래프 (CPU/MEM/DSK ProgressBar)
- [ ] 프로젝트 검색/필터
- [x] 로그 뷰어 (디버깅 모드 LogViewer)

#### 4. 레이아웃 & 테마

- [x] 반응형 레이아웃 (80/120 분기, 60:40 / 65:35 / 단일)
- [x] 깔끔한 보더/구분선 스타일 (theme.ts)
- [x] 커러 팔레트 통일 (Signal Green #36f0a0)

#### 5. 키보드 UX 추가

- [x] Vim-style 네비게이션 (j/k 이동, 8개+ 컨포넌트)
- [x] Ctrl+L 화면 클리어

---

## DB 스키마

```sql
-- 프로젝트
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    github_repo_url TEXT,
    branch TEXT,
    status TEXT DEFAULT 'stopped', -- running/stopped/building/error
    visibility TEXT DEFAULT 'internal', -- internal/quick-share/production
    assigned_port INTEGER,
    container_id TEXT,
    image_tag TEXT,
    previous_image_tag TEXT, -- 롤백용
    public_url TEXT,
    parent_project_id TEXT, -- 모노레포용
    dockerfile_path TEXT, -- 모노레포 서비스별 경로
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 도메인 매핑
CREATE TABLE domain_mappings (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    domain TEXT NOT NULL UNIQUE,        -- api.myapp.com
    cloudflare_zone_id TEXT,
    cloudflare_dns_record_id TEXT,
    status TEXT DEFAULT 'active',       -- active/pending/error
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 환경변수
CREATE TABLE env_vars (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL, -- 암호화 또는 파일 권한 제한
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 배포 로그
CREATE TABLE deploy_logs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    status TEXT, -- success/failed/cancelled
    trigger TEXT, -- chat/webhook/api
    commit_sha TEXT,
    build_log TEXT,
    duration_seconds INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 채팅 히스토리
CREATE TABLE chat_history (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT, -- user/assistant
    content TEXT,
    tool_calls TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 프로젝트 구조

```
openlander/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli/
│   │   └── commands.ts            # CLI 명령어
│   ├── tui/                       # TUI (@opentui/solid 기반)
│   │   ├── index.tsx              # TUI 엔트리포인트
│   │   ├── App.tsx                # 메인 앱 (Setup ↔ Dashboard 전환)
│   │   ├── components/
│   │   │   ├── Header.tsx         # 상단 바 (시스템 리소스)
│   │   │   ├── Dashboard.tsx      # 메인 대시보드
│   │   │   ├── ChatInput.tsx      # 채팅 입력/출력
│   │   │   ├── ProjectList.tsx    # 프로젝트 목록 (좌측 패널)
│   │   │   ├── ProjectDetail.tsx  # 프로젝트 상세 (우측 패널)
│   │   │   ├── SystemOverview.tsx # 시스템 통계
│   │   │   └── SetupFlow.tsx      # 온보딩 (대화형)
│   │   └── hooks/
│   │       ├── useChat.ts         # 에이전트 채팅 hook
│   │       ├── useProjects.ts     # 프로젝트 목록 hook
│   │       └── useSystemStats.ts  # 시스템 리소스 hook
│   ├── agent/
│   │   ├── index.ts               # 에이전트 코어 (agentic loop, 히스토리, 스트리밍)
│   │   ├── tools.ts               # 도구 정의 (23개, LLM function calling용)
│   │   ├── prompts.ts             # 시스템 프롬프트 (동적 상태 주입)
│   │   ├── recipes.ts             # 빌드 에러 레시피 (10 패턴)
│   │   └── debugger.ts            # BuildDebugger (레시피 fast-path + LLM)
│   ├── pipeline/
│   │   ├── deploy.ts              # 배포 파이프라인 (deploy, monorepo, rollback, blue-green)
│   │   ├── job-manager.ts         # JobManager (배포 단계 트래커)
│   │   ├── docker.ts              # Docker 제어 (dockerode)
│   │   ├── traefik.ts             # Traefik 라벨 관리
│   │   ├── tunnel.ts              # TryCloudflare / Cloudflare Tunnel
│   │   ├── git.ts                 # git clone
│   │   ├── port.ts                # 포트 할당 관리
│   │   └── env.ts                 # 환경변수 관리
│   ├── monitor/
│   │   ├── healthcheck.ts         # 헬스체크 크론
│   │   └── stats.ts               # 시스템 리소스 조회
│   ├── mcp/
│   │   └── server.ts              # MCP 서버 (23 tools, Zod 스키마)
│   ├── channels/                  # 외부 채널 (Slack/Discord/Telegram)
│   ├── db/
│   │   ├── index.ts               # SQLite 연결 + 마이그레이션
│   │   └── schema.ts              # 테이블 정의
│   ├── llm/
│   │   ├── index.ts               # LLM 프로바이더 추상화 (5개)
│   │   ├── gemini.ts              # Gemini Flash
│   │   ├── anthropic.ts           # Claude
│   │   ├── openai.ts              # OpenAI
│   │   └── ollama.ts              # Ollama (로컬)
│   └── app.ts                     # AppContext 와이어링
├── templates/                     # Dockerfile 템플릿
│   ├── nextjs.Dockerfile
│   ├── fastapi.Dockerfile
│   ├── gradio.Dockerfile
│   └── streamlit.Dockerfile
└── test/
```

---

## Coolify와의 포지셔닝 차이

|            | Coolify                 | OpenLander                     |
| ---------- | ----------------------- | ------------------------------ |
| 비유       | 셀프서비스 주유소       | 풀서비스 주유소                |
| 인터페이스 | 대시보드 (폼/버튼)      | TUI 채팅 (자연어)              |
| 타겟       | 인프라 지식 있는 개발자 | 에이전틱 코딩으로 앱 만든 사람 |
| 설치       | docker compose          | npm i -g                       |
| 설정       | 유저가 직접             | 에이전트가 판단                |
| 관계       | 경쟁 아님               | 다른 카테고리, 공존 가능       |

---

## 보안 (Phase 1 최소)

- 외부 공개 기본값 OFF
- 배포 전 "이렇게 배포할 건데, 진행할까요?" 확인
- 환경변수 평문 저장 금지
- Cloudflare Tunnel = IP 비노출 + SSL 강제 + DDoS 방어

---

## 하지 말 것 (Anti-Scope)

- 멀티 에이전트 구조 만들지 말 것 — 에이전트 1개 + 도구(함수) 10개 내외 구조 유지
- AST 파싱이나 정적 분석기 직접 만들지 말 것
- 프레임워크 자동 감지 기능 v0.0.1에 넣지 말 것 (Dockerfile 있는 레포만 지원)
- Docker Compose로 패키징하지 말 것 (npm 패키지로 배포)
- 보안/인증/RBAC v0.0.1에 넣지 말 것
- 블루-그린 배포 v0.0.1에 넣지 말 것 (v0.0.3)
- 멀티 도메인 매핑 v0.0.1에 넣지 말 것 (v0.0.2)

---

## 리스크 & 대응

| 리스크                         | 대응                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| 에이전트 판단 실패 → 신뢰 붕괴 | 실행은 deterministic, LLM은 대화만. 모든 실패에 명확한 에러 + 롤백 |
| 배포 중간 실패 → 좀비 상태     | 파이프라인에 트랜잭션 패턴. 실패 시 역순 롤백                      |
| 스코프 팽창 → 완성 지연        | v0.0.1은 "레포 → URL" 한 가지만 완벽하게                           |
| 1인 메인테이너 번아웃          | 이슈 주 1회 정리. README에 🚧 Early Stage 명시                     |
| 파인튜닝 데이터 부족           | 합성 데이터 생성 병행                                              |

---

## Go-to-Market

### README 필수 요소

- 30초 GIF: 터미널에서 채팅으로 배포하는 데모
- 한 줄 피치: "AI agent that deploys your app from a chat"
- 설치 한 줄: `npm i -g openlander`
- 비용 비교표: Cloud vs Mac Mini

### 출시일 동시 게시

- Hacker News: "Show HN: OpenLander – AI agent that deploys your app via chat"
- Reddit: r/selfhosted, r/homelab, r/webdev, r/devops
- X(Twitter): GIF + 한 줄 피치
- 한국: 긱뉴스, 디스콰이엇, 커리어리

### 출시 후

- 빌딩 스토리 블로그 (한국어 원본 → AI 영문 번역)
- dev.to, Medium에 영문 게시
- MCP 지원 시 2차 바이럴 노림

### PR 잘 붙는 구조

```
templates/nextjs.Dockerfile     ← 누구나 쉽게 PR
templates/fastapi.Dockerfile
templates/gradio.Dockerfile
recipes/node-gyp-fix.md         ← 자주 나오는 이슈 해결
recipes/prisma-build.md
```

---

## 프로젝트 평가

| 항목        | 점수 (10점) | 근거                                         |
| ----------- | ----------- | -------------------------------------------- |
| 아이디어    | 9           | 에이전틱 코딩 붐 + 배포 페인포인트 + 빈 시장 |
| 타이밍      | 8           | AI 에이전트 트렌드와 정확히 맞물림           |
| 차별점      | 8           | Coolify와 카테고리 자체가 다름               |
| 실현 가능성 | 8           | 에이전틱 코딩으로 빠른 개발 가능             |
| 지속 가능성 | 6           | 1인 메인테이너. 스코프 관리가 생존 조건      |
| **종합**    | **8**       | **아이디어 강력, 실행 속도가 관건**          |
