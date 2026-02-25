# OpenLander — Claude Project Instructions

## 프로젝트 한 줄 정의

"레포 URL을 주면 배포를 해주는 AI 에이전트" — npm 한 줄로 설치하고, 채팅으로 배포하는 오픈소스 도구.

## 기술 스택

- **Runtime**: Node.js + TypeScript
- **배포**: npm 글로벌 패키지 (`npm i -g openlander`)
- **웹 UI**: 채팅 기반 (프레임워크 미정, 가벼운 걸로)
- **Docker 제어**: dockerode
- **리버스 프록시**: Traefik (Docker 라벨 기반)
- **외부 접근**: TryCloudflare (임시 URL, 도메인 불필요) / Cloudflare Tunnel (영구)
- **LLM**: BYOK (Gemini Flash 무료 / Claude / OpenAI 등). OpenRouter 무료 티어 지원. 복잡한 추론 불필요.
- **Git 접근**: SSH key 방식 (OAuth 아님). GitHub/GitLab/Bitbucket/Gitea 범용 호환.
- **DB**: SQLite (프로젝트 상태, 배포 로그, 채팅 히스토리)
- **Platform**: Linux (primary), macOS (secondary). Windows 미지원.

## 핵심 아키텍처

```
사용자 (웹 채팅 UI)
    ↓
에이전트 (LLM — 의도 파악 + 대화 + 에러 설명)
    ↓
배포 파이프라인 (deterministic — 규칙 기반 순차 실행)
    ├─ git clone
    ├─ docker build (Dockerfile 있으면 그대로, 없으면 안내)
    ├─ docker run (포트 자동 할당 + Traefik 라벨)
    └─ 외부 공개 (TryCloudflare / Cloudflare Tunnel)
    ↓
인프라 (Docker + Traefik + Cloudflare)
```

**핵심 원칙**: 실행은 deterministic (규칙 기반), LLM은 대화/설명/에러 분석만 담당.

## LLM 전략

- BYOK: Gemini Flash(무료), OpenRouter 무료 티어, Claude, OpenAI 등
- OpenRouter 무료 모델 → 신용카드 불필요, 배포 에이전트 호출 빈도면 사실상 충분
- 온보딩에서 "OpenRouter 무료로 시작하기" 옵션 제공

## 설치 경험 (목표)

```bash
npm install -g openlander
openlander onboard    # 대화형: Docker 확인, Traefik 세팅, API 키 입력
# → http://localhost:3000 에 웹 채팅 UI
```

## 에이전트 구조

- 에이전트 1개 + 도구(함수) 10개 내외
- 멀티 에이전트 아님. 오케스트레이터 + 서브에이전트 구조 아님.
- LLM은 의도 파악, 명확화 질문, 에러 요약 용도

## 외부 접근 3-tier

| 모드          | 대상          | 구현                     | 도메인 필요 |
| ------------- | ------------- | ------------------------ | ----------- |
| 🔒 Internal    | 같은 네트워크 | 로컬 IP + Traefik        | ❌           |
| 🌐 Quick Share | 데모/리뷰     | TryCloudflare (임시 URL) | ❌           |
| 🌐 Production  | 상시 공개     | Cloudflare Tunnel (영구) | ✅           |

- 기본값: Internal (안전)
- "외부에서 보여줘" → Quick Share 전환
- 프로젝트별 설정 저장, 재배포 시 유지
- **멀티 도메인 매핑**: 여러 도메인을 Cloudflare에 등록하고 프로젝트별로 커스텀 도메인 연결 가능
  - Cloudflare Tunnel 1개 → Traefik Host 라벨로 라우팅
  - `map_domain`, `list_domains` 도구로 자연어 매핑

## Git 접근

- **SSH key 방식** (OAuth 아님)
- 온보딩에서 키 경로 입력 또는 새 키 생성
- GitHub/GitLab/Bitbucket/Gitea 등 SSH 지원하는 모든 Git 호스팅 호환

## 코딩 컨벤션

- TypeScript strict mode
- ESM (import/export)
- 에러 핸들링: 모든 Docker/시스템 호출에 try-catch + 유저 친화적 에러 메시지
- 환경변수: 평문 저장 금지 (최소한 파일 권한 제한)
- 로깅: 모든 배포 작업 SQLite에 기록

## 하지 말 것

- 멀티 에이전트 구조 만들지 말 것
- AST 파싱이나 정적 분석기 직접 만들지 말 것
- 프레임워크 자동 감지 기능 v0.1에 넣지 말 것 (Dockerfile 있는 레포만 지원)
- Docker Compose로 패키징하지 말 것 (npm 패키지로 배포)
- 보안/인증/RBAC v0.1에 넣지 말 것
- 블루-그린 배포 v0.1에 넣지 말 것 (v0.3)
- 멀티 도메인 매핑 v0.1에 넣지 말 것 (v0.2)

## 버전별 스코프 (넘지 말 것)

- **v0.1**: git clone → docker build → docker run → Traefik → URL. 웹 채팅 UI. REST API. Internal + Quick Share. 환경변수 기본 관리.
- **v0.2**: 자동 재배포, 모니터링, Production 도메인, 멀티 도메인 매핑, Ollama
- **v0.3**: MCP 서버, 롤백, 블루-그린 무중단 배포, DB 프로비저닝
- **v0.4**: Slack/Discord/Telegram 봇, 프레임워크 자동 감지 + 템플릿
- **v0.5**: 파인튜닝 모델 공개
