# OpenLander Build Failure Handling & Compose Mode Spec

> 이 문서는 `openlander-tui-layout-spec.md`의 부록이다.
> 빌드 실패 대응 범위와 멀티 서비스(Compose) 프로젝트 처리를 정의한다.

---

## Part 1: Build Failure Handling

### 핵심 원칙

**"누가 만든 파일이냐"로 대응 범위를 결정한다.**

- OpenLander 인프라 영역 → 자동 수정
- OpenLander가 생성한 빌드 설정 → 제안 후 승인받고 수정
- 유저 소스 코드 → 알려만 줌, 절대 수정 안 함

OpenLander는 "배포의 복잡성을 대신 처리하는 도구"이지 "코딩을 대신 해주는 도구"가 아니다.
Cursor/Claude Code가 코딩하고, OpenLander는 배포한다. 이 경계를 넘지 않는다.

---

### Tier 1: 자동 수정 (유저에게 안 물어봄)

환경/인프라 문제. 유저 코드와 무관. 100% 안전하게 고칠 수 있는 것.

| 실패 원인                     | 자동 대응                      | 채팅 표시                                 |
| ----------------------------- | ------------------------------ | ----------------------------------------- |
| 포트 충돌                     | 빈 포트 자동 할당              | `⚠ Port 3000 in use → reassigned to 3001` |
| Docker 캐시 깨짐              | `--no-cache`로 재빌드          | `⚠ Cache corrupted → rebuilding clean`    |
| 디스크 부족                   | dangling 이미지 정리 후 재시도 | `⚠ Disk low → cleaned 1.2GB, retrying`    |
| npm/pip install 네트워크 실패 | 최대 2회 재시도                | `⚠ Install failed → retrying (1/2)`       |

**규칙:**

- 자동 재시도는 최대 2회. 2회 실패 시 Tier 3처럼 에러 표시.
- 자동 수정 사실은 반드시 채팅에 1줄로 알려준다 (무음 수정 금지).

---

### Tier 2: 제안 후 수정 (유저 승인 필요)

Dockerfile, docker-compose, .dockerignore 등 OpenLander가 생성/관리하는 빌드 설정 문제.

| 실패 원인                               | 제안 내용                       |
| --------------------------------------- | ------------------------------- |
| 베이스 이미지에 필요 패키지 없음        | 대체 이미지 제안 + diff         |
| 빌드 스테이지 누락/오류                 | 수정된 Dockerfile diff          |
| .dockerignore 누락 (빌드 컨텍스트 과대) | .dockerignore 추가 제안         |
| 환경변수 누락                           | 필요한 변수 목록 + 값 입력 요청 |
| 멀티스테이지 빌드 최적화 가능           | 최적화 diff 제안                |

**채팅 UX:**

```
❌ Build failed: python3 not found in node:22-alpine

제안: 베이스 이미지를 node:22-slim으로 변경

  - FROM node:22-alpine
  + FROM node:22-slim

적용할까요? (y/n)
```

**규칙:**

- diff 형태로 변경 사항을 명확히 보여준다.
- 반드시 유저 승인(`y`) 후 적용. 자동 적용 금지.
- 승인 시 파일 수정 → 자동 재빌드.

---

### Tier 3: 알려만 줌 (수정 안 함)

유저의 소스 코드 문제. OpenLander의 책임 범위 밖.

| 실패 원인                          | 표시                      |
| ---------------------------------- | ------------------------- |
| TypeScript/컴파일 에러             | 에러 로그 원문 표시       |
| 테스트 실패                        | 실패 테스트 목록          |
| import/require 경로 오류           | 에러 로그 원문 표시       |
| 런타임 크래시 (컨테이너 즉시 종료) | 컨테이너 로그 마지막 50줄 |
| 문법 에러                          | 에러 로그 원문 표시       |

**채팅 UX:**

```
❌ Build failed at: npm run build

  src/index.ts:42:5 - error TS2345:
  Argument of type 'string' is not assignable
  to parameter of type 'number'

소스 코드 수정이 필요합니다.
수정 후 /deploy 로 다시 시도해주세요.
```

**규칙:**

- 에러 로그는 핵심 부분만 추출해서 보여준다 (전체 로그 덤프 금지).
- 전체 로그가 필요하면 디버깅 모드(프로젝트 선택)에서 확인 가능.
- 유저 코드 수정을 제안하지 않는다.

---

### 판단 플로우

```
빌드 실패 발생
  │
  ├─ 포트/디스크/네트워크/캐시 문제?
  │   └─ YES → Tier 1: 자동 수정 + 재시도
  │
  ├─ Dockerfile/.dockerignore/env 문제?
  │   └─ YES → Tier 2: diff 제안 → 승인 → 수정 → 재빌드
  │
  └─ 소스 코드 컴파일/런타임 에러?
      └─ YES → Tier 3: 에러 로그 표시 + 재배포 안내
```

---

### 구현 참고

- Tier 판단은 빌드 로그의 실패 시점(Docker step)으로 구분 가능
  - `COPY`, `RUN npm install` 실패 → Tier 1 또는 2
  - `RUN npm run build`, `RUN pytest` 실패 → Tier 3
- Tier 2의 diff 생성은 LLM 에이전트가 담당 (빌드 에러 + 현재 Dockerfile을 컨텍스트로 전달)
- Tier 1의 자동 수정은 데몬 내 하드코딩 (LLM 불필요)

---

## Part 2: Compose Mode (멀티 서비스 프로젝트)

### 배경

Opik, LiteLLM 같은 오픈소스 프로젝트는 레포 1개에 서비스 5~10개가 들어있다.
이런 프로젝트는 이미 검증된 `docker-compose.yml`을 갖고 있다.
OpenLander가 직접 오케스트레이션하지 않고, compose에 위임한다.

---

### 감지 → 분기

```
레포 클론 완료
  │
  ├─ docker-compose.yml 있음?
  │   └─ YES → Compose 모드 (멀티 서비스)
  │
  ├─ Dockerfile 있음?
  │   └─ YES → Single 모드 (기존 방식)
  │
  └─ 둘 다 없음?
      └─ 프로젝트 구조 분석 → 아래 'Auto-Detect' 참조
```

감지 대상 파일명: `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`

---

### Auto-Detect: Dockerfile도 Compose도 없는 프로젝트

Dockerfile과 docker-compose.yml 모두 없는 경우, 프로젝트 구조를 분석하여
단일 서비스인지 멀티 서비스인지 판단하고 적절한 빌드 설정을 생성한다.

**이 판단은 LLM 에이전트가 담당한다.** 프로젝트 구조가 너무 다양해서 룰 기반으로 커버 불가.

#### 에이전트에 전달하는 컨텍스트

데몬이 아래 정보를 수집하여 LLM에 전달한다:

```
1. 디렉토리 트리 (depth 3, node_modules/dist 제외)
2. 주요 설정 파일 내용:
   - package.json / requirements.txt / pyproject.toml / go.mod
   - turbo.json / nx.json / pnpm-workspace.yaml / lerna.json
   - 루트 및 하위 디렉토리의 패키지 매니저 설정
3. 진입점 후보: main.py, index.ts, app.py, server.js 등
```

#### 에이전트 판단 기준

```
단일 서비스 신호:
  - 루트에 package.json 1개 + src/ 디렉토리
  - 루트에 main.py / app.py
  - 명확한 단일 프레임워크 (Next.js, FastAPI, Express 등)
  → Dockerfile 1개 생성

멀티 서비스 신호:
  - apps/ 또는 services/ 하위에 독립 package.json 여러 개
  - turbo.json / nx.json / pnpm-workspace.yaml 존재
  - frontend + backend 분리 구조
  - 별도 DB/캐시가 필요한 구조
  → docker-compose.yml + 서비스별 Dockerfile 생성

판단 불가:
  - 구조가 모호하거나 비표준
  → 채팅으로 유저에게 질문
```

#### 판단 불가 시 채팅 UX

```
🔍 프로젝트 구조를 분석했습니다.

  apps/
  ├── web/         (Next.js)
  ├── api/         (Express)
  └── shared/      (공통 라이브러리)

이 프로젝트는 멀티 서비스로 보입니다.
다음과 같이 구성할까요?

  web     → :3000 (Next.js)
  api     → :8080 (Express)
  shared  → 빌드 의존성으로만 사용

맞으면 y, 수정하려면 알려주세요:
> _
```

#### 생성 후 플로우

```
에이전트가 Dockerfile 또는 docker-compose.yml 생성
  │
  ├─ Dockerfile 생성됨 → Single 모드 파이프라인 진입
  └─ docker-compose.yml 생성됨 → Compose 모드 파이프라인 진입
```

- 에이전트가 생성한 빌드 파일은 Tier 2 범위. 빌드 실패 시 에이전트가 수정안 제시.
- 생성된 파일은 프로젝트 디렉토리에 저장. 유저가 원하면 git commit 가능.

---

### Compose 모드 파이프라인

```
1. Clone
2. .env 처리 (아래 '환경변수 주입' 참조)
3. 포트 충돌 처리 (아래 '포트 충돌 처리' 참조)
4. docker compose up -d --build
5. 각 서비스 상태 모니터링
6. 외부 노출 서비스만 Traefik 연결
```

---

### 포트 충돌 처리

**원본 docker-compose.yml은 절대 수정하지 않는다.** Git dirty 방지.

충돌 발생 시 `docker-compose.override.yml`을 자동 생성하여 호스트 포트만 리맵한다:

```yaml
# docker-compose.override.yml (OpenLander 자동 생성)
# ⚠ Auto-generated by OpenLander — do not edit
services:
  litellm:
    ports:
      - '4001:4000' # 4000 충돌 → 4001로 remap
```

- Docker Compose는 원본 + override를 자동 병합한다 (Docker 공식 기능).
- 내부 포트(컨테이너 간 통신)는 건드리지 않는다. 호스트 포트만 변경.
- Tier 1 자동 수정에 해당. 채팅에 `⚠ Port 4000 in use → remapped to 4001 (override)` 표시.
- `.gitignore`에 `docker-compose.override.yml` 자동 추가 (없으면).

---

### 환경변수 주입

대부분의 오픈소스 compose는 `.env` 파일을 요구한다.

**처리 플로우:**

```
.env.example 또는 .env.sample 있음?
  │
  ├─ YES → 파싱하여 필요한 변수 목록 표시
  │        유저에게 값 입력 요청
  │        입력 완료 → .env 생성 → compose up
  │
  └─ NO → .env 없이 compose up 시도
          환경변수 에러 발생 시 Tier 2로 처리
```

**채팅 UX:**

```
📋 litellm requires environment variables:

  OPENAI_API_KEY=        (required)
  DATABASE_URL=          (default: postgres://...)
  REDIS_URL=             (default: redis://redis:6379)

기본값이 있는 항목은 자동 설정됩니다.
OPENAI_API_KEY를 입력해주세요:
> _
```

**규칙:**

- `.env.example`에 기본값이 있는 변수: 자동 설정 (유저에게 안 물어봄)
- 기본값 없는 변수(API 키 등): 유저에게 입력 요청
- 내부 서비스 URL(DB, Redis 등)은 compose 네트워크 기반으로 자동 설정
  - 예: `DATABASE_URL=postgres://postgres:password@db:5432/litellm`
  - compose의 서비스명이 호스트명이므로 자동 추론 가능
- 생성된 `.env`는 프로젝트 디렉토리에 저장, `.gitignore`에 추가

---

### 대시보드 표시

Compose 프로젝트는 접이식 그룹으로 표시한다.

```
▼ litellm (compose, 3 services)     ← 펼친 상태
  ● litellm   :4001  256M
    llm.mysite.com
  ● db         —     128M
  ● redis      —     64M

▶ opik (compose, 5 services)        ← 접은 상태

● my-api    :8080  128M             ← 일반 프로젝트
  api.mysite.com
```

- 기본: 접힌 상태 (한 줄로 서비스 수만 표시)
- `Enter`로 펼침/접음 토글
- 펼치면 개별 서비스별 상태/포트/메모리 표시
- 외부 도메인이 있는 서비스만 URL 표시
- 내부 전용 서비스(db, redis)는 포트 대신 `—` 표시

---

### 디버깅 모드 (Compose 프로젝트)

Compose 프로젝트 선택 시, 어떤 서비스의 로그를 볼지 선택 단계가 추가된다.

```
┌─ Chat ─────────────────────┬─ litellm ─────────────────────┐
│                             │ ▸ Services                    │
│ You: /logs litellm          │   > ● litellm  :4001  256M   │
│                             │     ● db        —     128M   │
│ Select a service:           │     ● redis     —     64M    │
│                             │                               │
│                             │ [↑↓ 선택] [Enter 로그 보기]    │
│                             │                               │
└─────────────────────────────┴───────────────────────────────┘
```

서비스 선택 후 → 기존 디버깅 모드(Info + Logs)와 동일.

또는 직접 지정: `/logs litellm/db` → db 서비스 로그 바로 표시.

---

### Compose 관련 슬래시 명령

| 명령                           | 동작                                     |
| ------------------------------ | ---------------------------------------- |
| `/deploy <repo>`               | compose 감지 시 자동으로 Compose 모드    |
| `/logs <project>`              | 서비스 선택 UI 표시                      |
| `/logs <project>/<service>`    | 특정 서비스 로그 직접 표시               |
| `/stop <project>`              | `docker compose down` (전체 서비스 중지) |
| `/restart <project>`           | `docker compose restart`                 |
| `/restart <project>/<service>` | 특정 서비스만 재시작                     |

---

### OpenLander가 해야 할 것 / 하지 말아야 할 것

**해야 할 것:**

- `docker-compose.yml` 감지하여 `docker compose up` 실행
- 포트 충돌 시 `docker-compose.override.yml`로 호스트 포트 리맵
- `.env.example` 파싱하여 환경변수 입력 가이드
- 서비스 그룹 단위로 상태 표시
- 외부 포트 있는 서비스만 Traefik 도메인 연결
- `docker compose logs -f [service]`로 서비스별 로그 스트리밍

**하지 말아야 할 것:**

- 원본 docker-compose.yml 수정 (override 파일만 사용)
- 서비스 의존성 순서를 직접 계산 (`depends_on`이 이미 정의됨)
- compose 파일 최적화/리팩토링 시도
- 서비스 간 네트워크를 직접 구성 (compose 기본 네트워크 사용)
- 개별 서비스를 compose 밖에서 독립 관리

---

### 구현 우선순위

1. compose 파일 감지 + `docker compose up -d --build`
2. 서비스 그룹 대시보드 표시 (접이식)
3. 포트 충돌 → override 자동 생성
4. `.env.example` 파싱 → 환경변수 입력 UX
5. 서비스별 로그 스트리밍
6. Traefik 연결 (외부 노출 서비스만)
