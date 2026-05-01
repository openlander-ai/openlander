# v0.0.12 — Provider OAuth (구독 로그인 인증)

> **작성일**: 2026-03-02 (초안) → 2026-03-05 (Web pivot 전면 재작성)
> **상태**: 📋 기획 완료
> **우선순위**: 높음 (온보딩 UX 핵심 개선)
> **의존성**: 없음 (v0.1.0 Web MVP 완료, v0.0.10 완료)
> **관련 결정**: DEC-013 (Provider OAuth 신설), DEC-020 (Web pivot 반영)

---

## 배경

현재 OpenLander의 LLM 프로바이더 설정은 API 키 수동 입력(BYOK)만 지원. 사용자가 이미 ChatGPT Plus, Claude Max 등 구독을 갖고 있어도 별도로 API 키를 발급받아 복사-붙여넣기 해야 함.

경쟁 도구들(OpenCode, Cline, Claude Code)은 이미 구독 기반 OAuth 인증을 지원하여 온보딩 마찰을 크게 줄임.

### 기존 스펙 대비 변경 사항 (Web Pivot)

| 항목          | 기존 (CLI 기준)                       | 변경 (Web 기준)                                |
| ------------- | ------------------------------------- | ---------------------------------------------- |
| 인터페이스    | CLI 프롬프트 (`@inquirer/prompts`)    | Web UI (SetupScreen + SettingsPage)            |
| OAuth 콜백    | 임시 HTTP 서버 스폰                   | Hono 라우트 `/api/auth/:provider/callback`     |
| 브라우저 열기 | `openInBrowser()` (child_process)     | `window.open()` 팝업                           |
| 토큰 저장     | `~/.openlander/auth-tokens.json` 파일 | DB `provider_auth` 테이블 (AES-256-GCM 암호화) |
| SSH fallback  | 수동 URL 붙여넣기                     | 불필요 (웹 = 브라우저 항상 있음)               |
| 의존성        | v0.0.9 CLI 온보딩                     | 없음 (DEC-017: Web 온보딩 채택)                |

## 핵심 가치

**"이미 갖고 있는 구독으로 바로 시작"** — API 키 발급 과정 제거, 브라우저 로그인만으로 연결.

---

## 스코프 정의

### 진짜 OAuth (팝업 플로우)

| 프로바이더     | 방식           | 사용자 경험                                                     |
| -------------- | -------------- | --------------------------------------------------------------- |
| **OpenAI**     | OAuth 2.0 PKCE | "Sign in with ChatGPT" 버튼 → 팝업 로그인 → 자동 연결           |
| **OpenRouter** | OAuth PKCE     | "Sign in with OpenRouter" 버튼 → 팝업 로그인 → API 키 자동 발급 |

### 향상된 BYOK (안내 개선)

| 프로바이더        | 방식          | 사용자 경험                                                        |
| ----------------- | ------------- | ------------------------------------------------------------------ |
| **Anthropic**     | 토큰 붙여넣기 | `claude setup-token` 안내 + 토큰 입력 (기존 API 키 입력과 동일 UX) |
| **Google Gemini** | API 키        | AI Studio 링크 제공 + API 키 입력 (현재와 동일)                    |

> **스코프 결정**: Anthropic은 표준 OAuth를 제공하지 않고, Google ADC는 CLI 전용(`gcloud`). 두 프로바이더는 "더 나은 안내" 수준의 UX 개선만 포함. 진짜 OAuth 구현은 OpenAI + OpenRouter 2개.

---

## 프로바이더별 상세

### 12-1: OpenAI — Sign in with ChatGPT (OAuth PKCE)

**난이도**: 중 | **우선순위**: 1순위 (사용자 수 최다)

**플로우**:

```
[Web UI — SetupScreen Step 1 또는 Settings > AI Model]

Provider: OpenAI (GPT)
┌─────────────────────────────────────┐
│  ❯ Sign in with ChatGPT            │ ← OAuth 버튼
│    Enter API Key manually           │ ← 기존 BYOK fallback
└─────────────────────────────────────┘

→ "Sign in with ChatGPT" 클릭
→ 팝업 창: auth.openai.com 로그인
→ 로그인 완료 → 콜백 → 팝업 닫힘
→ ✓ Connected as user@email.com (ChatGPT Pro)
```

**기술 상세**:

- OAuth 2.0 PKCE (Proof Key for Code Exchange)
- Auth endpoint: `https://auth.openai.com/oauth/authorize`
- Token endpoint: `https://auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann` (OpenAI Codex 공식 Client ID)
- Redirect URI: `http://localhost:{PORT}/api/auth/openai/callback`
- Scopes: `openid profile email offline_access`

**웹 팝업 플로우**:

1. 프론트엔드: `window.open(authUrl, 'openai-oauth', 'popup,width=500,height=700')` 실행
2. 백엔드: PKCE `code_verifier`를 생성하여 인메모리 저장 (state 파라미터와 매핑)
3. 팝업: OpenAI 로그인 → 인가 → `http://localhost:10003/api/auth/openai/callback?code=...&state=...`으로 리디렉트
4. 백엔드: `code + code_verifier`로 `access_token + refresh_token` 교환
5. 백엔드: 토큰을 DB에 암호화 저장 + LLM 클라이언트 hot-reload
6. 백엔드: 콜백 응답으로 `postMessage` 스크립트가 포함된 HTML 반환 → 팝업 닫힘
7. 프론트엔드: `message` 이벤트 수신 → 상태 업데이트 (✓ Connected)

**Redirect URI 이슈**:

Codex Client ID의 등록된 redirect URI는 `http://localhost:1455`로 고정되어 있을 수 있음. OpenLander는 `localhost:10003`.

- **선택지 A** (권장): 포트 1455에 임시 콜백 서버를 띄우고, 토큰 교환 후 메인 서버로 결과 전달. 기존 `openrouter-oauth.ts` 패턴과 동일.
- **선택지 B**: OpenAI에 자체 OAuth 앱 등록 → 우리 포트로 redirect URI 설정. 깔끔하지만 승인 절차 불확실.
- **구현 시 확인**: 실제로 Codex Client ID가 redirect URI를 검증하는지 먼저 테스트. 검증하지 않으면 선택지 B 불필요.

**참고 구현**:

- `github.com/openai/codex` — Codex CLI의 OAuth 구현
- `github.com/cline/cline` — Cline의 OpenAI Codex OAuth 구현

**주의사항**:

- OpenAI의 정책 변경 가능성 → ToS 준수 안내 표시 필수
- 개인 개발용만 지원 (상업적 재판매 금지)

---

### 12-2: OpenRouter — OAuth PKCE

**난이도**: 하 (기존 CLI 구현 존재) | **우선순위**: 2순위 (무료 티어, 진입장벽 최저)

**플로우**:

```
[Web UI]

Provider: OpenRouter
┌─────────────────────────────────────┐
│  ❯ Sign in with OpenRouter          │
│    Enter API Key manually            │
└─────────────────────────────────────┘

→ 팝업: openrouter.ai 로그인
→ 인가 → 콜백 → API 키 자동 발급
→ ✓ Connected (Free tier)
```

**기술 상세**:

- OAuth PKCE (공식 지원, 문서화됨)
- Auth endpoint: `https://openrouter.ai/auth`
- Exchange endpoint: `POST https://openrouter.ai/api/v1/auth/keys`
- `callback_url`이 **동적** (요청 시 전달) → redirect URI 등록 문제 없음
- 기존 구현: `src/cli/openrouter-oauth.ts` (249줄) — 로직 재사용 가능

**웹 전환 시 변경점**:

| 기존 (CLI)                              | 변경 (Web)                                  |
| --------------------------------------- | ------------------------------------------- |
| `createServer()` 임시 서버 (포트 19273) | Hono 라우트 `/api/auth/openrouter/callback` |
| `openInBrowser(authUrl)`                | `window.open(authUrl, 'popup')`             |
| `console.log()` 상태 출력               | React state 업데이트                        |
| 결과 → config.json 저장                 | 결과 → DB 저장 + hot-reload                 |

**공식 문서**: https://openrouter.ai/docs/use-cases/oauth-pkce

---

### 12-3: Anthropic — 토큰 안내 개선

**난이도**: 하 | **우선순위**: 3순위

Anthropic은 표준 OAuth를 제공하지 않음. `claude setup-token`은 Claude CLI의 기능이며, 발급된 토큰을 수동으로 복사해야 함. **현재 API 키 입력과 UX가 동일**하므로, 안내 문구 개선만 진행.

**변경 내용**:

프로바이더 선택 시 Anthropic 카드에 안내 텍스트 추가:

```
┌─────────────────────────────────────────┐
│ Anthropic Claude                        │
│                                         │
│ Enter your API key from                 │
│ console.anthropic.com/settings/keys     │
│                                         │
│ Or use Claude CLI subscription:         │
│ $ claude setup-token                    │
│ (Copy the generated token)              │
│                                         │
│ [Paste API key or token] [Connect]      │
└─────────────────────────────────────────┘
```

**구현**: SetupScreen과 SettingsPage의 Anthropic 선택 시 `<ProviderHelp>` 컴포넌트 표시. 별도 백엔드 작업 없음.

---

### 12-4: Google Gemini — 링크 안내 개선

**난이도**: 하 | **우선순위**: 4순위

Google ADC (`gcloud auth application-default login`)는 CLI 전용. 웹에서는 API 키 입력이 유일한 현실적 경로. **안내 링크 개선만 진행**.

**변경 내용**:

```
┌─────────────────────────────────────────┐
│ Google Gemini                   [Free]  │
│                                         │
│ Get your free API key:                  │
│ → aistudio.google.com/apikey            │
│                                         │
│ [Paste API key] [Connect]               │
└─────────────────────────────────────────┘
```

**구현**: Gemini 선택 시 AI Studio 링크가 포함된 `<ProviderHelp>` 컴포넌트 표시. 별도 백엔드 작업 없음.

---

## 온보딩 통합 (SetupScreen)

### 현재 온보딩 플로우 (3스텝)

```
Step 0: Welcome (Docker + Traefik 체크)
Step 1: Connect the Brain (프로바이더 선택 → API 키 입력 → Connect)
Step 2: Ready for Launch (GitHub 연결 optional → Start Deploying)
```

### 변경 후 온보딩 플로우 (동일 3스텝)

```
Step 0: Welcome (변경 없음)
Step 1: Connect the Brain (프로바이더 선택 → 인증 방식 선택 → Connect)
                           ↳ OpenAI/OpenRouter: OAuth 버튼 + API 키 fallback
                           ↳ Anthropic: API 키 + 안내 텍스트
                           ↳ Gemini: API 키 + AI Studio 링크
                           ↳ Ollama: 키 불필요 (변경 없음)
Step 2: Ready for Launch (변경 없음)
```

**핵심 원칙**: 스텝 수를 늘리지 않는다. Step 1 내부에서 인증 방식만 분기.

### UI 변경 상세

**프로바이더 선택 후** (OpenAI 또는 OpenRouter일 때):

```tsx
{/* OAuth 지원 프로바이더 */}
<div className="space-y-3">
  <Button onClick={handleOAuthLogin} className="w-full gap-2">
    <ExternalLink className="h-4 w-4" />
    Sign in with {providerName}
  </Button>
  <div className="relative">
    <div className="absolute inset-0 flex items-center">
      <span className="w-full border-t" />
    </div>
    <div className="relative flex justify-center text-xs">
      <span className="bg-bg-app px-2 text-muted-ol">or</span>
    </div>
  </div>
  <Input type="password" placeholder="Paste API key..." ... />
</div>
```

**프로바이더 선택 후** (Anthropic일 때):

```tsx
{/* 안내 텍스트 + API 키 입력 */}
<div className="space-y-3">
  <ProviderHelp provider="anthropic" />
  <Input type="password" placeholder="API key or setup-token..." ... />
</div>
```

---

## Settings 페이지 통합

Settings > AI Model 섹션에도 동일한 인증 방식 분기 적용.

**현재**: 프로바이더 선택 → API 키 입력 → Update Provider
**변경 후**: 프로바이더 선택 → OAuth 버튼 또는 API 키 → Update Provider

OAuth로 연결된 경우 상태 표시:

```
┌──────────────────────────────────────────────┐
│ ✓ Connected to OpenAI                        │
│   Authenticated via OAuth (ChatGPT Pro)      │
│   Token auto-refreshes                       │
│                                     [Switch] │
└──────────────────────────────────────────────┘
```

---

## 공통 아키텍처

### 토큰 저장소

DB `provider_auth` 테이블 (v0.0.10 `global_secrets`와 동일한 AES-256-GCM 암호화 패턴):

```sql
CREATE TABLE provider_auth (
  provider    TEXT PRIMARY KEY,   -- 'openai' | 'openrouter'
  auth_method TEXT NOT NULL,      -- 'oauth' | 'api-key'
  access_token_enc  BLOB,        -- AES-256-GCM 암호화
  refresh_token_enc BLOB,        -- AES-256-GCM 암호화 (nullable)
  expires_at  INTEGER,           -- Unix timestamp (nullable)
  user_email  TEXT,              -- OAuth 인증 시 사용자 이메일
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
```

**config.json과의 관계**:

- `config.json`의 `llm.apiKey`는 **하위 호환** 유지 (BYOK 사용자)
- OAuth 인증 시: `provider_auth` 테이블에서 토큰을 가져와 사용
- 우선순위: `provider_auth` (OAuth) > `config.json` (BYOK)

### 토큰 갱신

```typescript
// src/auth/token-store.ts
interface ProviderAuth {
  provider: string;
  authMethod: 'oauth' | 'api-key';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userEmail?: string;
}

// LLM 호출 직전 자동 갱신
async function getValidToken(provider: string): Promise<string> {
  const auth = await loadProviderAuth(provider);
  if (!auth) return getFallbackApiKey(provider); // config.json fallback

  if (auth.expiresAt && Date.now() > (auth.expiresAt - 60_000) * 1000) {
    return await refreshProviderToken(auth);
  }
  return auth.accessToken;
}
```

### 백엔드 OAuth 라우트

```
GET  /api/auth/:provider/start     — PKCE 생성 + auth URL 반환
GET  /api/auth/:provider/callback  — 콜백 수신 + 토큰 교환 + 팝업 닫기 HTML 반환
GET  /api/auth/status              — 현재 인증 상태 반환
POST /api/auth/:provider/disconnect — OAuth 연결 해제
```

### 팝업 → 부모 창 통신

콜백 성공 시 반환하는 HTML:

```html
<script>
  window.opener?.postMessage({ type: 'oauth-success', provider: '...' }, '*');
  window.close();
</script>
```

프론트엔드:

```typescript
useEffect(() => {
  const handler = (e: MessageEvent) => {
    if (e.data?.type === 'oauth-success') {
      refetch(); // 상태 새로고침
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, []);
```

---

## 구현 순서

| 순서 | 파트             | 내용                                                        | 이유                                    |
| ---- | ---------------- | ----------------------------------------------------------- | --------------------------------------- |
| 1    | 인프라           | `provider_auth` 테이블 + 토큰 저장/갱신 + OAuth 라우트 뼈대 | 모든 프로바이더 공통 기반               |
| 2    | OpenRouter OAuth | PKCE 팝업 플로우 (기존 CLI 코드 재활용)                     | 가장 간단, callback_url 동적, 검증 용이 |
| 3    | OpenAI OAuth     | PKCE 팝업 플로우 (redirect URI 이슈 해결 포함)              | 사용자 수 최다, redirect URI 검증 필요  |
| 4    | 프론트엔드 통합  | SetupScreen + SettingsPage 수정                             | 백엔드 완성 후 연결                     |
| 5    | 안내 개선        | Anthropic/Gemini `<ProviderHelp>` 컴포넌트                  | 최소 작업, 마지막                       |

> 기존 스펙 대비 변경: OpenRouter를 OpenAI보다 먼저 구현. 이유: callback_url이 동적이라 redirect URI 이슈가 없어 인프라 검증에 적합.

---

## 신규/수정 파일 (예상)

### 신규

| 파일                                        | 역할                                                          |
| ------------------------------------------- | ------------------------------------------------------------- |
| `src/auth/token-store.ts`                   | provider_auth DB CRUD + AES-256-GCM 암호화/복호화 + 토큰 갱신 |
| `src/auth/pkce.ts`                          | PKCE 공용 유틸 (code_verifier, code_challenge 생성)           |
| `src/auth/openai-oauth.ts`                  | OpenAI OAuth PKCE 플로우 (URL 생성, 토큰 교환)                |
| `src/auth/openrouter-oauth.ts`              | OpenRouter OAuth PKCE 플로우 (기존 CLI 코드 리팩토링)         |
| `src/web/api/auth-routes.ts`                | Hono OAuth 라우트 (start, callback, status, disconnect)       |
| `web/src/components/setup/ProviderHelp.tsx` | 프로바이더별 안내 컴포넌트 (Anthropic, Gemini)                |
| `web/src/components/setup/OAuthButton.tsx`  | OAuth 팝업 트리거 + postMessage 수신 컴포넌트                 |

### 수정

| 파일                                       | 변경 내용                                            |
| ------------------------------------------ | ---------------------------------------------------- |
| `src/db/schema.ts` + `schema.drizzle.ts`   | `provider_auth` 테이블 추가                          |
| `src/db/index.ts`                          | provider_auth CRUD 메서드 + 마이그레이션             |
| `src/llm/index.ts`                         | `createLLMClient()`에서 provider_auth 토큰 우선 사용 |
| `src/llm/openai.ts`                        | Bearer 토큰 인증 지원 (API 키 외)                    |
| `src/llm/openrouter.ts`                    | OAuth 발급 키 사용 경로 추가                         |
| `src/web/server.ts`                        | auth-routes 마운트                                   |
| `src/web/api/setup-routes.ts`              | `/setup/status`에 OAuth 연결 상태 포함               |
| `web/src/components/setup/SetupScreen.tsx` | Step 1에 OAuth 분기 UI 추가                          |
| `web/src/pages/SettingsPage.tsx`           | AI Model 섹션에 OAuth 버튼 + 연결 상태 표시          |
| `web/src/lib/api.ts`                       | OAuth 관련 API 클라이언트 함수 추가                  |

---

## 수용 기준 (AC)

### OAuth 플로우

- [ ] OpenAI: "Sign in with ChatGPT" 버튼 → 팝업 로그인 → 자동 연결 → API 호출 성공
- [ ] OpenRouter: "Sign in with OpenRouter" 버튼 → 팝업 로그인 → API 키 자동 발급 → API 호출 성공
- [ ] 토큰 자동 갱신 동작 (만료 1분 전 refresh_token으로 갱신)
- [ ] OAuth 연결 해제 (Disconnect) 후 BYOK로 전환 가능

### 온보딩 통합

- [ ] SetupScreen Step 1: OAuth 지원 프로바이더 선택 시 "Sign in" 버튼 노출
- [ ] SetupScreen Step 1: OAuth 비지원 프로바이더 선택 시 기존 API 키 입력 유지
- [ ] 온보딩 완료 후 OAuth 인증 상태가 유지됨 (DB 저장)

### Settings 통합

- [ ] Settings > AI Model: OAuth 연결 상태 표시 ("Connected via OAuth")
- [ ] Settings > AI Model: 프로바이더 변경 시 OAuth 또는 API 키 선택 가능

### 안내 개선

- [ ] Anthropic 선택 시 `claude setup-token` 안내 텍스트 표시
- [ ] Gemini 선택 시 AI Studio 링크 (`aistudio.google.com/apikey`) 표시

### 하위 호환

- [ ] BYOK (API Key 직접 입력) 항상 동작 — OAuth는 선택사항
- [ ] 기존 config.json의 apiKey로 설정된 사용자에게 영향 없음
- [ ] OAuth 미사용 시 provider_auth 테이블은 빈 상태로 정상 동작

### 기술

- [ ] 토큰은 AES-256-GCM 암호화되어 DB에 저장
- [ ] `tsup build` + `vite build` 성공
- [ ] 기존 테스트 통과
- [ ] `lsp_diagnostics` 0 errors

---

## ToS / 법적 고려사항

- OpenAI Codex OAuth는 **개인 개발용**만 지원. 상업적 API 재판매 금지.
- Anthropic setup-token은 Claude CLI의 공식 기능이지만 third-party 사용에 대한 명시적 허용/금지 확인 필요.
- 온보딩/Settings에서 OAuth 연결 시 ToS 안내 표시:
  ```
  ⚠ Using your subscription for personal development only.
     Commercial resale or multi-user sharing is not permitted.
  ```
