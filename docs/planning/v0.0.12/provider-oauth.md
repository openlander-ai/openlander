# v0.0.12 — Provider OAuth (구독 로그인 인증)

> **작성일**: 2026-03-02
> **상태**: 📋 기획 완료
> **우선순위**: 높음 (온보딩 UX 핵심 개선)
> **의존성**: v0.0.9 온보딩 CLI 리팩토링 완료 후 진행
> **관련 결정**: DEC-013 (Provider OAuth 신설)

---

## 배경

현재 OpenLander의 LLM 프로바이더 설정은 API 키 수동 입력(BYOK)만 지원. 사용자가 이미 ChatGPT Plus, Claude Max 등 구독을 갖고 있어도 별도로 API 키를 발급받아 복사-붙여넣기 해야 함.

경쟁 도구들(OpenCode, Cline, Claude Code)은 이미 구독 기반 OAuth 인증을 지원하여 온보딩 마찰을 크게 줄임.

## 핵심 가치

**"이미 갖고 있는 구독으로 바로 시작"** — API 키 발급 과정 제거, 브라우저 로그인만으로 연결.

---

## 프로바이더별 인증 방식

### 12-1: OpenAI — Sign in with ChatGPT (OAuth PKCE)

**난이도**: 중 | **우선순위**: 1순위 (사용자 수 최다)

**플로우**:

```
$ openlander

  AI Provider: OpenAI (GPT)
  Auth method:
  ❯ 구독 로그인 (ChatGPT Plus/Pro)
    API Key 직접 입력

  Opening browser for authentication...
  ⟳ Waiting for login...
  ✓ Connected as user@email.com (ChatGPT Pro)
```

**기술 상세**:

- OAuth 2.0 PKCE (Proof Key for Code Exchange)
- Auth endpoint: `https://auth.openai.com/oauth/authorize`
- Token endpoint: `https://auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann` (OpenAI Codex 공식 Client ID)
- Redirect URI: `http://localhost:1455/auth/callback`
- Scopes: `openid profile email offline_access`

**구현 단계**:

1. CLI에서 localhost:1455에 임시 HTTP 서버 시작
2. PKCE code_challenge 생성 (SHA-256)
3. 브라우저에서 OpenAI 로그인 페이지 열기
4. 콜백으로 authorization code 수신
5. code + code_verifier로 access_token + refresh_token 교환
6. 토큰을 `~/.openlander/auth-tokens.json`에 저장 (config.json과 분리)
7. API 요청 시 Bearer 토큰 사용, 만료 시 refresh_token으로 자동 갱신

**참고 구현**:

- `github.com/open-hax/codex` — OpenCode용 Codex OAuth 플러그인
- `github.com/cline/cline` — Cline의 OpenAI Codex OAuth 구현

**주의사항**:

- 원격 서버(SSH)에서는 localhost 콜백 불가 → SSH 포트 포워딩 안내 또는 수동 URL 붙여넣기 fallback
- OpenAI의 정책 변경 가능성 → ToS 준수 노트 필수
- 개인 개발용만 지원 (상업적 재판매 금지)

---

### 12-2: Anthropic — Claude Setup Token

**난이도**: 하 | **우선순위**: 2순위

**플로우**:

```
  AI Provider: Anthropic (Claude)
  Auth method:
  ❯ 구독 로그인 (Claude Max)
    API Key 직접 입력

  To use your Claude subscription:
  1. Run: claude setup-token
  2. Copy the generated token
  Paste token: ****
  ✓ Connected (Claude Max)
```

**기술 상세**:

- Anthropic의 `claude` CLI가 `setup-token` 명령어로 OAuth 토큰 발급
- 사용자가 해당 토큰을 OpenLander에 붙여넣기
- OpenLander가 토큰으로 Anthropic API 접근

**구현 단계**:

1. `claude` CLI 설치 여부 확인
2. 설치되어 있으면 `claude setup-token` 실행 안내
3. 토큰 입력 받아 검증 (`/v1/messages` 테스트 호출)
4. 유효하면 `~/.openlander/auth-tokens.json`에 저장

**참고 구현**:

- `github.com/openclaw/openclaw` — setup-token 연동 패턴

---

### 12-3: OpenRouter — OAuth PKCE

**난이도**: 중 | **우선순위**: 3순위

**플로우**:

```
  AI Provider: OpenRouter
  Auth method:
  ❯ 로그인 (브라우저)
    API Key 직접 입력

  Opening browser for authentication...
  ⟳ Waiting for authorization...
  ✓ Connected (Free tier)
```

**기술 상세**:

- OAuth PKCE (공식 지원)
- Auth endpoint: `https://openrouter.ai/auth`
- Exchange endpoint: `POST https://openrouter.ai/api/v1/auth/keys`
- 콜백으로 code 수신 → code + code_verifier로 API 키 교환
- 발급된 키는 OpenLander 앱 전용 (사용자가 OpenRouter 대시보드에서 관리 가능)

**구현 단계**:

1. PKCE code_challenge 생성
2. 브라우저에서 `https://openrouter.ai/auth?callback_url=...&code_challenge=...` 열기
3. 콜백으로 authorization code 수신
4. `POST /api/v1/auth/keys`로 API 키 교환
5. 발급된 API 키를 config에 저장

**공식 문서**: https://openrouter.ai/docs/use-cases/oauth-pkce

---

### 12-4: Google Gemini — Application Default Credentials

**난이도**: 중~상 | **우선순위**: 4순위

**플로우**:

```
  AI Provider: Google Gemini
  Auth method:
  ❯ Google 계정 로그인
    API Key 직접 입력

  // gcloud 설치됨:
  Running: gcloud auth application-default login
  ✓ Authenticated as user@gmail.com

  // gcloud 미설치:
  Opening Google AI Studio...
  (https://aistudio.google.com/apikey)
  Paste your API key: ****
  ✓ Saved
```

**기술 상세**:

- **경로 A** (gcloud 있을 때): `gcloud auth application-default login` → ADC JSON 파일 생성 → Vertex AI API 사용
- **경로 B** (gcloud 없을 때): Google AI Studio 키 발급 페이지 오픈 → API 키 입력 (BYOK fallback)

**구현 단계**:

1. `gcloud` CLI 존재 여부 확인
2. 있으면 → `gcloud auth application-default login` 실행
3. ADC 파일 경로를 config에 저장
4. 없으면 → AI Studio 페이지 오픈 + API 키 입력 fallback

---

## 공통 아키텍처

### 토큰 저장소

```
~/.openlander/
├── config.json        # 기존 설정 (프로바이더, 모델 등)
└── auth-tokens.json   # OAuth 토큰 (access_token, refresh_token, expires_at)
```

- `auth-tokens.json`은 `config.json`과 분리 — 토큰은 민감 정보
- 파일 퍼미션 `0600` (소유자만 읽기/쓰기)

### 토큰 갱신

```typescript
interface ProviderAuth {
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp
  authMethod: 'oauth' | 'setup-token' | 'api-key';
}

// API 호출 전 자동 갱신
async function getValidToken(provider: string): Promise<string> {
  const auth = loadAuth(provider);
  if (auth.expiresAt && Date.now() > auth.expiresAt - 60000) {
    // 만료 1분 전 갱신
    return await refreshToken(auth);
  }
  return auth.accessToken;
}
```

### localhost 콜백 서버

OpenAI와 OpenRouter가 공유하는 임시 HTTP 서버:

```typescript
// 재사용 가능한 OAuth 콜백 핸들러
async function startCallbackServer(port: number): Promise<string> {
  // 1. http.createServer 시작
  // 2. 콜백 수신 대기
  // 3. authorization code 추출
  // 4. 서버 종료
  // 5. code 반환
}
```

### SSH/원격 환경 fallback

localhost 콜백이 불가능한 환경(SSH 접속 등):

```
  ⚠ Cannot open browser on this machine.
  Options:
  ❯ Manual URL (copy URL, login on another device, paste callback URL)
    API Key (직접 입력)
```

---

## CLI 온보딩 통합

v0.0.9에서 구현한 CLI 온보딩의 Step 2 (LLM Provider Setup)를 확장:

```
  ━━━ [2/3] AI Provider ━━━━━━━━━━━━━━━━━━━
  Choose your AI provider:
  ❯ OpenAI (ChatGPT Plus/Pro)
    Anthropic (Claude Max)
    Google Gemini
    OpenRouter (free)
    Ollama (local)

  Auth method:                         ← v0.0.12에서 추가
  ❯ 구독 로그인 (브라우저)
    API Key 직접 입력
```

**하위 호환**: API Key 직접 입력은 항상 사용 가능 (fallback).

---

## 구현 순서

| 순서 | 프로바이더    | 이유                                               |
| ---- | ------------- | -------------------------------------------------- |
| 1    | OpenAI        | 사용자 수 최다, 레퍼런스 구현 풍부                 |
| 2    | Anthropic     | 구현 가장 간단 (setup-token 붙여넣기)              |
| 3    | OpenRouter    | 공식 OAuth PKCE 문서 있음, 무료 사용자 온보딩 개선 |
| 4    | Google Gemini | gcloud 의존성 + 경로 분기 복잡                     |

---

## 신규/수정 파일 (예상)

### 신규

- `src/auth/oauth-callback.ts` — 공용 localhost 콜백 서버
- `src/auth/openai-oauth.ts` — OpenAI PKCE 플로우
- `src/auth/anthropic-auth.ts` — Anthropic setup-token 연동
- `src/auth/openrouter-oauth.ts` — OpenRouter PKCE 플로우
- `src/auth/google-auth.ts` — Google ADC / fallback
- `src/auth/token-store.ts` — auth-tokens.json 관리 + 자동 갱신

### 수정

- `src/cli/onboard-llm.ts` — 인증 방식 선택 분기 추가
- `src/llm/*.ts` — 각 프로바이더 클라이언트에서 토큰 기반 인증 지원
- `src/config/index.ts` — auth-tokens 경로 + 로드/저장

---

## 수용 기준 (AC)

- [ ] OpenAI: ChatGPT Plus/Pro 계정으로 브라우저 로그인 → API 접근 가능
- [ ] Anthropic: `claude setup-token` 토큰으로 API 접근 가능
- [ ] OpenRouter: 브라우저 로그인 → API 키 자동 발급
- [ ] Google: gcloud ADC 또는 AI Studio 키 → API 접근 가능
- [ ] 토큰 자동 갱신 (만료 전 refresh)
- [ ] SSH 환경에서 수동 URL fallback 동작
- [ ] BYOK (API Key 직접 입력) 항상 동작 (하위 호환)
- [ ] auth-tokens.json 퍼미션 0600
- [ ] 빌드 성공, 기존 테스트 통과

---

## ToS / 법적 고려사항

- OpenAI Codex OAuth는 **개인 개발용**만 지원. 상업적 API 재판매 금지.
- Anthropic setup-token은 Claude CLI의 공식 기능이지만 third-party 사용에 대한 명시적 허용/금지 확인 필요.
- 온보딩 시 ToS 준수 안내 문구 표시:
  ```
  ⚠ Using your subscription for personal development only.
     Commercial resale or multi-user sharing is not permitted.
  ```
