# OpenLander Local Dev Mode & Environment Variable Management Spec

> v1.1 기획. 현재 v1.0(팀 개발서버 배포)과 독립적으로 개발 가능하되,
> 데몬 구조가 이를 수용할 수 있게 v1.0 설계 시 고려해야 한다.

---

## Part 1: Local Dev Mode

### 배경

개발자가 새 프로젝트에 투입되면 겪는 현실:

```
1. README 읽기 (있으면 다행)
2. docker-compose.yml 찾기 (없으면 직접 작성)
3. 환경변수 세팅 (.env 만들기)
4. docker compose up
5. 에러 → 버전 안 맞음 → 포트 충돌 → 30분~2시간 날림
6. 드디어 npm run dev
```

OpenLander Local Dev Mode는 이 과정을 채팅 한 줄로 줄인다.

---

### 핵심 개념

```
배포 모드:      git clone → build → run → expose (전체 서비스 컨테이너화)
로컬 개발 모드:  의존성만 컨테이너 → 내 코드는 로컬 실행
```

**내 코드는 건드리지 않는다.** 핫 리로드가 돼야 하니까 컨테이너에 넣지 않는다.
내 코드가 의존하는 인프라(DB, 캐시, 큐, 다른 서비스)만 OpenLander가 띄운다.

---

### 사용 시나리오

#### 시나리오 1: 의존성 인프라 즉석 실행

```
You: PostgreSQL 16이랑 Redis 띄워줘

✅ PostgreSQL 16 → localhost:5432
   user: postgres / pass: postgres / db: dev
✅ Redis 7 → localhost:6379

.env 생성할까요? (y/n)
> y

📄 .env 생성 완료:
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/dev
  REDIS_URL=redis://localhost:6379
```

#### 시나리오 2: 프로젝트 README/compose 기반 자동 분석

```
You: 이 프로젝트 로컬에서 개발하려면 뭐 필요해?

🔍 프로젝트 분석 중...

  docker-compose.yml 발견:
    - PostgreSQL 16 (port 5432)
    - Redis 7 (port 6379)
    - Elasticsearch 8 (port 9200)

  package.json 분석:
    - Node.js 20+ 필요
    - npm run dev → Next.js dev server

의존성 인프라를 띄울까요? (y/n)
> y

✅ PostgreSQL 16 → localhost:5432
✅ Redis 7 → localhost:6379
✅ Elasticsearch 8 → localhost:9200

이제 npm run dev 하면 됩니다.
```

#### 시나리오 3: DB 초기 데이터 적용

```
You: DB 띄우고 schema.sql 적용해줘

✅ PostgreSQL 16 → localhost:5432
🔄 Applying schema.sql...
✅ 12 tables created

시드 데이터도 있네요 (seed.sql). 적용할까요? (y/n)
> y

✅ 245 rows inserted
```

#### 시나리오 4: 다른 팀 서비스 로컬 실행

```
You: 프론트 개발하려는데 백엔드 API가 필요해.
     github.com/team/backend-api 최신 버전으로 띄워줘.

🔄 Cloning team/backend-api...
🔄 Building...
✅ backend-api → localhost:8080

API_URL=http://localhost:8080 을 .env에 추가할까요? (y/n)
```

이 경우는 배포 모드와 동일한 파이프라인을 쓰되, Traefik 도메인 연결 없이 localhost 포트만 노출.

#### 시나리오 5: 로컬 프로젝트 빌드 → 외부 접속

git repo가 아닌 로컬 디렉토리를 빌드하여 외부에서 접속 가능하게 한다.
ngrok 대체. Cloudflare Tunnel이 이미 OpenLander에 있으므로 추가 설치 없음.

```
You: 현재 디렉토리 빌드해서 외부에서 접속 가능하게 해줘

🔍 /home/dongbin/my-project 분석 중...
🔄 Building...
🔄 Cloudflare Tunnel 연결 중...
✅ https://my-project-abc123.openlander.dev

이 URL로 외부에서 접속 가능합니다.
/stop 으로 종료.
```

기존 배포 파이프라인에서 입력 소스만 다르다:

```
git repo:   clone → build → run → expose
로컬 경로:  copy  → build → run → expose
```

clone 대신 로컬 디렉토리를 Docker 빌드 컨텍스트로 사용하는 것뿐. 나머지 동일.

사용 사례:

- 클라이언트에게 데모 보여주기
- Stripe/Slack webhook 테스트 (외부 URL 필요)
- 동료에게 로컬 작업물 공유

주의: Cloudflare Tunnel 설정이 필요하다. 온보딩에서 스킵했으면 `/settings → Tunnel`에서 설정.

---

### 배포 모드와의 차이

|          | 배포 모드            | 로컬 개발 모드         | 로컬 경로 배포               |
| -------- | -------------------- | ---------------------- | ---------------------------- |
| 입력     | git repo URL         | 채팅 (인프라명)        | 로컬 디렉토리 경로           |
| 대상     | 내 코드 전체         | 의존성 인프라만        | 내 코드 전체                 |
| 빌드     | 내 코드 빌드         | 공식 이미지 pull       | 내 코드 빌드                 |
| 네트워크 | Traefik → 도메인     | localhost 포트         | Cloudflare Tunnel → 외부 URL |
| 목적     | 팀에 서비스 제공     | 내 로컬 개발 환경 구성 | 데모/테스트/공유             |
| 속도     | 분 단위 (clone+빌드) | 초 단위 (이미지 pull)  | 분 단위 (빌드)               |

---

### 볼륨/데이터 영속성

```
기본 동작:
  - DB 데이터는 Docker named volume에 저장
  - /stop 해도 데이터 유지
  - 명시적으로 삭제해야 사라짐

채팅 UX:
  You: PostgreSQL 데이터 초기화해줘

  ⚠ dev_postgres_data 볼륨을 삭제합니다.
     모든 데이터가 사라집니다. 계속할까요? (y/n)
```

---

### 대시보드 표시

Status 패널에서 배포 프로젝트와 로컬 인프라를 구분 표시:

```
▸ Projects (배포)
  ● frontend  :3000  128M
    app.mysite.com

▸ Infra (로컬 개발)
  ● postgres  :5432  128M   vol: 240MB
  ● redis     :6379  32M
  ● elastic   :9200  512M   vol: 1.2GB
```

Infra 섹션은 로컬 인프라가 실행 중일 때만 표시.
볼륨 사이즈 표시 (DB는 데이터가 쌓이므로 디스크 관리 필요).

---

### 로컬 개발 모드 전용 기능

#### 포트 포워딩 자동 관리

같은 서버에서 여러 개발자가 인프라를 띄우면 포트가 충돌한다.

```
dongbin:  postgres → :5432
jihye:    postgres → :5433 (5432 충돌 → 자동 할당)
```

유저별로 포트 대역을 자동 할당하고, 생성되는 .env에 실제 할당된 포트 반영.

#### DB GUI 연결 정보

인프라 띄운 후 GUI 툴(DBeaver, pgAdmin 등) 연결 정보를 바로 보여준다:

```
✅ PostgreSQL 16 → localhost:5432

  연결 정보:
  Host:     localhost
  Port:     5432
  User:     postgres
  Password: postgres
  Database: dev

  연결 문자열:
  postgres://postgres:postgres@localhost:5432/dev
```

#### 헬스체크

인프라가 실제로 ready 상태인지 확인 후 완료 메시지 표시.

```
✅ PostgreSQL 16 → localhost:5432 (ready, accepting connections)
```

단순히 컨테이너 started가 아니라, 실제 연결 가능한 상태까지 확인.
PostgreSQL은 `pg_isready`, Redis는 `redis-cli ping`, Elasticsearch는 `/_cluster/health` 등.

---

### 구현 우선순위

1. 채팅으로 단일 인프라 실행 (postgres, redis 등)
2. .env 자동 생성
3. 프로젝트 분석 → 필요한 인프라 자동 감지
4. 볼륨 관리 (데이터 초기화)
5. schema/seed 자동 적용
6. 멀티유저 포트 자동 분리
7. 다른 팀 서비스 로컬 실행
8. 로컬 경로 빌드 → Cloudflare Tunnel 외부 노출

---

## Part 2: Environment Variable Management

### 배경

팀이 OpenLander를 쓰면 즉시 부딪히는 문제:

```
"이 프로젝트 배포하려면 OPENAI_API_KEY 어디서 가져와?"
"누가 DB 패스워드 바꿨어? 내 서비스 터졌는데"
"API key를 .env에 평문으로 넣으라고?"
```

Jenkins의 Credentials Store, GitHub Actions의 Secrets처럼
OpenLander도 환경변수/시크릿 중앙 관리가 필요하다.

---

### 환경변수 스코프

```
┌─────────────────────────────────────┐
│ Global Secrets                      │  ← 전체 프로젝트 공용
│   OPENAI_API_KEY=sk-...             │
│   DOCKER_REGISTRY_TOKEN=...         │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Project: frontend               │ │  ← 프로젝트 전용
│ │   API_URL=https://api.mysite.com│ │
│ │   NODE_ENV=production           │ │
│ │                                 │ │
│ │ ┌───────────────────────────┐   │ │
│ │ │ User: dongbin             │   │ │  ← 개인 오버라이드
│ │ │   DEBUG=true              │   │ │
│ │ │   API_URL=http://localhost│   │ │
│ │ └───────────────────────────┘   │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

3단계 스코프. 좁은 스코프가 넓은 스코프를 오버라이드한다:

```
적용 우선순위: User > Project > Global
```

---

### 스코프 상세

#### Global Secrets (전체 공용)

모든 프로젝트에서 사용하는 시크릿.

```
예시:
  OPENAI_API_KEY       → 팀 공용 API 키
  ANTHROPIC_API_KEY    → 팀 공용 API 키
  DOCKER_REGISTRY      → 프라이빗 레지스트리 주소
  SENTRY_DSN           → 에러 트래킹
  SLACK_WEBHOOK_URL    → 알림
```

- 설정 권한: 관리자 (서버 소유자)
- 읽기: 모든 프로젝트 빌드/실행 시 자동 주입
- 채팅에서 값 표시 시 마스킹: `sk-...a3f2`

#### Project Variables (프로젝트 전용)

특정 프로젝트에만 필요한 변수.

```
예시:
  DATABASE_URL         → 이 프로젝트 전용 DB
  REDIS_URL            → 이 프로젝트 전용 캐시
  API_URL              → 연동 서비스 주소
  NODE_ENV             → production / development
  PORT                 → 서비스 포트
```

- 설정 권한: 해당 프로젝트 배포자
- 배포 시 자동 주입
- 프로젝트 간 격리 (frontend의 변수가 backend에 안 들어감)

#### User Overrides (개인 오버라이드)

개발자별 로컬 개발 시 사용하는 오버라이드.

```
예시:
  DEBUG=true                          → 디버그 모드
  API_URL=http://localhost:8080       → 로컬 API 연결
  LOG_LEVEL=verbose                   → 상세 로그
```

- 다른 사람에게 영향 없음
- 로컬 개발 모드에서 주로 사용
- 배포 모드에서는 적용되지 않음 (실수 방지)

---

### 저장

```
~/.openlander/
├── secrets.enc          ← Global Secrets (암호화)
├── projects/
│   ├── frontend.env     ← Project Variables
│   └── backend.env
└── users/
    ├── dongbin.env      ← User Overrides
    └── jihye.env
```

#### 암호화

- Global Secrets는 반드시 암호화 저장 (평문 저장 금지)
- 암호화 키: 온보딩 시 자동 생성, `~/.openlander/master.key`에 저장
- Project Variables: 민감한 값은 암호화, 일반 값은 평문
- User Overrides: 평문 (개인 개발용이라 민감도 낮음)

---

### 채팅 UX

#### 시크릿 등록

```
You: OPENAI_API_KEY 등록해줘

🔑 어떤 스코프로 저장할까요?
  1. Global (모든 프로젝트)
  2. frontend (프로젝트 전용)
  3. 내 개인 오버라이드

> 1

값을 입력해주세요:
> sk-proj-abc...

✅ OPENAI_API_KEY → Global에 저장 (암호화됨)
```

#### 시크릿 확인

```
You: frontend 프로젝트 환경변수 보여줘

📋 frontend 환경변수:

  Global (상속):
    OPENAI_API_KEY    = sk-...a3f2  🔒
    SENTRY_DSN        = https://...  🔒

  Project:
    DATABASE_URL      = postgres://...  🔒
    API_URL           = https://api.mysite.com
    NODE_ENV          = production

  User (dongbin):
    DEBUG             = true
    LOG_LEVEL         = verbose
```

마스킹 규칙:

- 키 이름에 KEY, SECRET, TOKEN, PASSWORD, DSN 포함 → 값 마스킹 (`sk-...a3f2`)
- 나머지 → 평문 표시
- `--reveal` 플래그로 전체 값 표시 가능

#### 배포 시 자동 주입

```
You: frontend 배포해줘

🔄 Deploying frontend...
📋 환경변수 주입:
   Global: 2개 (OPENAI_API_KEY, SENTRY_DSN)
   Project: 3개 (DATABASE_URL, API_URL, NODE_ENV)
   Total: 5개
🔨 Building...
```

유저 오버라이드는 배포 모드에서 적용하지 않음 (명시적으로 안내):

```
ℹ User override (DEBUG=true) 는 배포에 적용되지 않습니다.
  로컬 개발 모드에서만 사용됩니다.
```

---

### 슬래시 명령

```
/env                    전체 환경변수 목록 (현재 프로젝트 또는 글로벌)
/env set KEY=VALUE      환경변수 설정 (스코프 선택 UI 표시)
/env rm KEY             환경변수 삭제
/env export             현재 프로젝트 .env 파일 생성/다운로드
```

---

### 변경 알림

환경변수가 변경되면 영향받는 프로젝트에 알림:

```
Activity 로그:
  15:03 dongbin 🔑 Updated OPENAI_API_KEY (global)
         → 영향: frontend, backend, worker

Alerts:
  ⚠ OPENAI_API_KEY 변경됨 — 3개 프로젝트 재배포 필요?
```

재배포는 자동으로 하지 않는다. 알림만 표시하고 유저가 결정.

---

### .env.example 연동

프로젝트에 `.env.example`이 있으면, 등록된 환경변수와 대조:

```
You: frontend 배포해줘

⚠ .env.example에 정의되었지만 설정되지 않은 변수:
   STRIPE_SECRET_KEY     (required)
   SENDGRID_API_KEY      (optional, default: "")

STRIPE_SECRET_KEY를 입력해주세요:
> sk_test_...

✅ STRIPE_SECRET_KEY → frontend (Project)에 저장
🔄 Building...
```

---

### 기존 Compose 프로젝트 환경변수 처리

Compose Mode(Part 2 of build-failure-spec)와의 연동:

```
compose 프로젝트 배포 시:
  1. .env.example 파싱 → 미설정 변수 확인
  2. Global Secrets에서 매칭되는 키 자동 주입
  3. 나머지 미설정 변수 → 유저에게 입력 요청
  4. .env 생성 → docker compose up
```

예시:

```
.env.example:
  OPENAI_API_KEY=         ← Global에 이미 있음 → 자동 주입
  DATABASE_URL=           ← compose 내부 서비스 → 자동 추론
  CUSTOM_API_KEY=         ← 없음 → 유저에게 입력 요청
```

---

### 구현 우선순위

#### Phase 1 (v1.0에 포함 가능)

1. Project Variables — 프로젝트별 .env 파일 관리
2. 배포 시 자동 주입
3. /env 명령어 기본

#### Phase 2 (v1.1 로컬 개발 모드와 함께)

4. Global Secrets — 암호화 저장
5. User Overrides — 개인 오버라이드
6. 3단계 스코프 병합 로직
7. 변경 알림
8. .env.example 자동 대조

---

## 슬래시 명령 종합 (최종 확정)

### 슬래시 명령 9개 (피커에 표시)

```
설정 (GUI 피커 오버레이):
  /repo       레포 선택 → 배포 (GitHub/GitLab/Bitbucket 통합 목록)
  /git        Git 연결 관리 (멀티 프로바이더)
  /model      LLM 프로바이더 변경
  /tunnel     Cloudflare Tunnel 설정
  /env        환경변수 관리

TUI 시스템:
  /compact    컨텍스트 압축
  /clear      화면 클리어
  /exit       종료
  /help       도움말
```

### 삭제된 슬래시 (채팅 자연어로 대체)

```
/stop       → "중지해줘"
/restart    → "재시작해줘"
/logs       → "로그 보여줘" 또는 Status 패널에서 프로젝트 Enter
```

모든 명령을 최상위에 노출한다. `/settings` 같은 중첩 메뉴 없이 `/` 입력 시 9개 명령이 바로 보인다.

```
You: /

┌─ Commands ───────────────────────────┐
│ /repo       레포 선택 → 배포          │
│ /git        Git 연결 관리             │
│ /model      LLM 모델 변경            │
│ /tunnel     Cloudflare Tunnel 설정   │
│ /env        환경변수 관리             │
│ /compact    컨텍스트 압축             │
│ /clear      화면 클리어               │
│ /exit       종료                      │
│ /help       도움말                    │
└──────────────────────────────────────┘
```

### /git 상세

여러 Git 프로바이더 동시 연결을 지원한다.

```
You: /git

┌─ Git Connections ────────────────────┐
│ ● GitHub    SSH key (dongbin)        │
│ ● GitLab    SSH key (dongbin)        │
│ ○ Bitbucket Not connected            │
│                                      │
│ [Enter 수정] [a 추가] [d 삭제]        │
└──────────────────────────────────────┘
```

config 구조:

```json
{
  "git": [
    { "provider": "github", "method": "ssh", "keyPath": "~/.ssh/id_ed25519" },
    { "provider": "gitlab", "method": "ssh", "keyPath": "~/.ssh/id_ed25519" }
  ]
}
```

`/repo` 실행 시 연결된 모든 프로바이더의 레포를 통합 표시:

```
You: /repo

┌─ Your Repositories ──────────────────┐
│   GitHub                             │
│ > dongbin/my-frontend      2d ago    │
│   dongbin/api-server       5d ago    │
│                                      │
│   GitLab                             │
│   team/billing-service     1w ago    │
│   team/auth-service        3d ago    │
│                                      │
│   [↑↓ 선택] [Enter 배포] [q 닫기]    │
└──────────────────────────────────────┘
```
