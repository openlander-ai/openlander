# v0.0.10 — Env & Secrets Management

> **상태**: ✅ 구현 완료 (2026-03) | **이전 문서**: `v0.0.9-10-unified-spec.md` (통합 기획서, 아카이브)
>
> 이 문서는 `v0.0.9-10-unified-spec.md`의 v0.0.10 파트에서 **Local Dev Mode를 완전히 제거**하고,
> 환경변수/시크릿 관리만 남긴 것이다.
> **v0.1.0 Web 전환 반영**: 10-4를 TUI /env 오버레이에서 Web Settings 페이지 Global Secrets 섹션으로 변경 (DEC-018).

---

## 개요

**한 줄 요약**: 프로젝트 간 공유되는 글로벌 시크릿과 .env 자동 감지로 배포 시 환경변수 누락을 방지한다.

**핵심 문제**: 현재 OpenLander의 환경변수는 프로젝트별 격리만 지원한다. 이 때문에:

- `OPENAI_API_KEY` 같은 공용 키를 프로젝트마다 따로 등록해야 함
- `.env.example`에 정의된 필수 변수를 빠뜨리고 배포 → 런타임 에러
- 시크릿이 평문으로 DB에 저장됨 (암호화 없음)

**해결 방향**: Global Secrets 테이블 + 암호화 + .env.example 감지.

---

## 현재 코드 상태 (AS-IS)

| 파일                      | 상태                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `src/db/schema.ts` L27-34 | `env_vars` 테이블: `projectId` 필수 — global scope 없음       |
| `src/tools/registry.ts`   | `set_env_var`, `get_env_vars` 도구: 프로젝트 ID 필수 파라미터 |
| `src/pipeline/deploy.ts`  | 배포 시 `.env.example` 체크 없음                              |

---

## 변경 범위

### 수정할 파일

| 파일                                 | 변경 내용                                      |
| ------------------------------------ | ---------------------------------------------- |
| `src/db/schema.ts`                   | `global_secrets` 테이블 추가                   |
| `src/db/queries.ts` (또는 해당 파일) | global secrets CRUD 함수                       |
| `src/pipeline/deploy.ts`             | `.env.example` 감지 + 누락 변수 체크 로직 추가 |
| `src/tools/registry.ts`              | 3개 도구 추가/수정                             |
| `src/tui/components/EnvOverlay.tsx`  | Global Secrets 탭 추가                         |

### 새로 생성할 파일

| 파일                | 용도                               |
| ------------------- | ---------------------------------- |
| `src/env/crypto.ts` | 시크릿 암호화/복호화 (AES-256-GCM) |
| `src/env/dotenv.ts` | .env.example 파싱 + 누락 변수 감지 |

---

## 기능별 상세

### 10-1: Global Secrets 테이블 + 암호화

**현재 상태 (AS-IS)**:
환경변수는 `env_vars` 테이블에 `projectId`와 함께 저장. 프로젝트가 없으면 저장 불가.

**목표 상태 (TO-BE)**:
`global_secrets` 테이블을 추가하여, 프로젝트와 무관한 전역 시크릿을 암호화 저장.

**데이터 모델**:

```sql
CREATE TABLE global_secrets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  key TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,      -- AES-256-GCM 암호화
  iv TEXT NOT NULL,                   -- Initialization Vector
  description TEXT,                   -- 선택적 설명 ("팀 공용 OpenAI 키")
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**암호화**:

```typescript
// src/env/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// 마스터 키: 최초 실행 시 자동 생성, ~/.openlander/master.key에 저장
// 또는 OPENLANDER_MASTER_KEY 환경변수로 전달 가능

function encrypt(plaintext: string, masterKey: Buffer): { encrypted: string; iv: string } { ... }
function decrypt(encrypted: string, iv: string, masterKey: Buffer): string { ... }
```

**배포 시 주입 규칙**:

```
프로젝트 env_vars (기존) + global_secrets (새로) → 합산하여 컨테이너에 주입
충돌 시: 프로젝트 변수가 글로벌 시크릿을 오버라이드
```

**수락기준**:

- [ ] `global_secrets` 테이블이 DB에 생성된다 (마이그레이션)
- [ ] 값이 AES-256-GCM으로 암호화되어 저장된다
- [ ] 마스터 키가 `~/.openlander/master.key`에 자동 생성된다
- [ ] 마스터 키가 없으면 최초 실행 시 생성하고 경고 메시지를 표시한다
- [ ] 배포 시 `global_secrets` + `env_vars`를 합산하여 주입한다
- [ ] 프로젝트 변수와 글로벌 시크릿이 같은 키를 가질 경우 프로젝트 변수가 우선한다
- [ ] 테스트: 암호화/복호화 round-trip, 키 충돌 오버라이드, 마스터 키 미존재 시 생성

---

### 10-2: .env.example 감지

**현재 상태 (AS-IS)**:
배포 시 `.env.example` 파일을 확인하지 않음. 필수 변수 누락 → 런타임 에러.

**목표 상태 (TO-BE)**:
`deploy_project` 파이프라인에서 `.env.example` 파싱 → 누락 변수 감지 → 사용자에게 입력 요청.

**구현 방향**:

```typescript
// src/env/dotenv.ts
interface EnvCheckResult {
  required: string[]; // .env.example에 정의된 키 목록
  provided: string[]; // global_secrets + env_vars에 존재하는 키
  missing: string[]; // 누락된 키
  optional: string[]; // default 값이 있는 키 (값이 비어있지 않은 것)
}

async function checkEnvRequirements(
  projectDir: string,
  projectId: string,
): Promise<EnvCheckResult> {
  // 1. .env.example 파싱 (KEY=default_value 형식)
  // 2. global_secrets에서 매칭되는 키 확인
  // 3. env_vars에서 프로젝트별 키 확인
  // 4. 누락된 키 목록 반환
}
```

**사용자에게 보이는 UX**:

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

**수락기준**:

- [ ] `deploy_project` 시작 시 프로젝트 디렉토리에 `.env.example`이 있으면 파싱한다
- [ ] 누락된 필수 변수가 있으면 빌드 전에 사용자에게 입력을 요청한다
- [ ] optional 변수(default 값 있음)는 경고만 표시하고 빌드를 차단하지 않는다
- [ ] 입력된 값은 프로젝트 `env_vars`에 저장된다 (재배포 시 다시 묻지 않음)
- [ ] `.env.example`이 없으면 이 단계를 스킵한다
- [ ] 테스트: .env.example 파싱, 누락 감지, optional 분류

---

### 10-3: 도구 추가/수정

#### 새 도구: `set_global_secret`

```typescript
{
  name: 'set_global_secret',
  description: 'Set a global secret that is available to all projects (encrypted)',
  parameters: {
    key: { type: 'string', description: 'Secret key name (e.g., OPENAI_API_KEY)' },
    value: { type: 'string', description: 'Secret value' },
    description: { type: 'string', description: 'Optional description', optional: true },
  },
  handler: async ({ key, value, description }) => {
    // 암호화 후 global_secrets 테이블에 저장
  },
}
```

#### 새 도구: `list_global_secrets`

```typescript
{
  name: 'list_global_secrets',
  description: 'List all global secrets (values are masked)',
  parameters: {},
  handler: async () => {
    // 키 + 마스킹된 값 (sk-...a3f2) 반환
  },
}
```

#### 기존 수정: `get_env_vars`

```typescript
// 기존: projectId 필수
// 변경: projectId 없으면 global_secrets 반환, 있으면 global + project 합산 반환
{
  name: 'get_env_vars',
  parameters: {
    projectId: { type: 'string', optional: true },  // optional로 변경
  },
  handler: async ({ projectId }) => {
    if (!projectId) {
      return await getGlobalSecrets();  // 마스킹된 값
    }
    const global = await getGlobalSecrets();
    const project = await getProjectEnvVars(projectId);
    return mergeEnvVars(global, project);  // project가 global 오버라이드
  },
}
```

**수락기준**:

- [ ] `set_global_secret`이 값을 암호화하여 저장한다
- [ ] `list_global_secrets`가 키 목록과 마스킹된 값을 반환한다
- [ ] `get_env_vars`에서 `projectId`가 optional이 되고, 없으면 global만 반환한다
- [ ] `get_env_vars`에서 `projectId` 제공 시 global + project 합산 결과를 반환한다
- [ ] MCP 서버에서도 3개 도구가 노출된다
- [ ] 마스킹 규칙: KEY, SECRET, TOKEN, PASSWORD, DSN 포함 키 → `sk-...a3f2` 형태
- [ ] 테스트: 도구별 정상/에러 시나리오

---

### 10-4: /env 오버레이 확장

**현재 상태 (AS-IS)**:
`/env` 명령이 프로젝트별 환경변수만 표시/관리.

**목표 상태 (TO-BE)**:
Global Secrets 탭을 추가하여, 전역 시크릿도 TUI에서 관리 가능.

**UI**:

```
┌─ Environment Variables ─────────────────────┐
│ [Global Secrets]  [frontend]  [api-server]   │  ← 탭
│                                              │
│ Global Secrets (3):                          │
│   OPENAI_API_KEY    = sk-...a3f2  🔒         │
│   SENTRY_DSN        = https://...  🔒        │
│   SLACK_WEBHOOK     = https://...  🔒        │
│                                              │
│ [a] Add  [d] Delete  [Enter] Edit  [q] Close │
└──────────────────────────────────────────────┘
```

**수락기준**:

- [ ] `/env` 오버레이에 Global Secrets 탭이 추가된다
- [ ] Global Secrets 탭에서 추가/삭제/수정이 가능하다
- [ ] 시크릿 값은 마스킹되어 표시된다
- [ ] 기존 프로젝트별 탭은 그대로 유지된다
- [ ] 키보드 네비게이션: Tab으로 탭 전환, a/d/Enter로 CRUD
- [ ] 테스트: 오버레이 렌더링 + 탭 전환

---

## 구현 순서 (의존성 기반)

```
Phase 1 (기반): 10-1 Global Secrets 테이블 + 암호화
   ↓ (테이블과 crypto가 준비되어야 아래 가능)
Phase 2 (활용): 10-2 .env.example 감지 + 10-3 도구 추가 (병렬 가능)
   ↓
Phase 3 (UI):  10-4 /env 오버레이 확장
```

---

## 테스트 계획

### 단위 테스트

| 함수/모듈                 | 테스트 파일                      | 핵심 시나리오                                     |
| ------------------------- | -------------------------------- | ------------------------------------------------- |
| `encrypt()` / `decrypt()` | `test/env/crypto.test.ts`        | round-trip, 잘못된 키, 손상된 데이터              |
| `checkEnvRequirements()`  | `test/env/dotenv.test.ts`        | 파싱, 누락 감지, optional 분류, .env.example 없음 |
| global_secrets CRUD       | `test/db/global-secrets.test.ts` | 생성, 읽기, 업데이트, 삭제, 중복 키               |
| 도구 3개                  | `test/tools/env-tools.test.ts`   | 정상, 에러, 마스킹                                |

### 통합 테스트 시나리오

1. **글로벌 시크릿 등록 → 프로젝트 배포** → 시크릿이 컨테이너에 주입됨
2. **프로젝트 변수와 글로벌 시크릿 키 충돌** → 프로젝트 변수 우선
3. **.env.example에 필수 변수 3개, 1개 누락** → 배포 전 입력 요청 → 저장 → 빌드 진행
4. **마스터 키 없이 시작** → 자동 생성 + 경고

---

## 제거된 항목 (기존 v0.0.9-10-unified-spec.md 대비)

| 제거된 기능                                          | 이유                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Local Dev Mode 전체 (Part 3)                         | 핵심 가치("서버 상태를 아는 배포 에이전트")와 관련 없음. 사용자 피드백 대기. |
| User Overrides (3단계 스코프 중 3번째)               | Local Dev Mode 제거에 따라 불필요. Global + Project 2단계면 충분.            |
| 멀티유저 포트 자동 분리                              | Local Dev Mode 제거에 따라 불필요                                            |
| 볼륨 관리                                            | Local Dev Mode 제거에 따라 불필요                                            |
| Import된 컨테이너 환경변수 매핑 (Part 4.4)           | v0.0.9에서 Import 제거에 따라 불필요                                         |
| 파일 기반 .env 저장 (`~/.openlander/projects/*.env`) | DB(SQLite)에 저장. 파일 기반은 동기화 문제 발생.                             |

---

## 미래 고려사항 (이 버전에서 구현하지 않음)

- **User Overrides**: Local Dev Mode 도입 시 함께 추가
- **환경변수 변경 알림**: Activity 로그에 변경 이력 표시 → 추후 알림 시스템 고도화 시
- **Vault 연동**: HashiCorp Vault, AWS Secrets Manager 등 외부 시크릿 매니저 연동 → 엔터프라이즈 기능
- **환경별 분리**: staging/production 환경 분리 → 현재는 프로젝트 단위로 충분
