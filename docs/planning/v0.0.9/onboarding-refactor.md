# v0.0.9 — 온보딩 CLI 리팩토링

> **작성일**: 2026-03-02
> **상태**: ⏸️ 보류 (DEC-017: Web 온보딩 채택으로 대체됨)
> **우선순위**: 높음 (도그푸딩 블로커)
> **관련 결정**: DEC-003 (온보딩 대규모 개편 중지), DEC-012 (CLI 온보딩 전환)

---

## 배경

v0.0.9 도그푸딩 중 온보딩에서 진행 불가 버그 발견:

1. **TUI 팝업 렌더링 깨짐** — OpenTUI `<box border>` 오버레이가 터미널에서 정상 렌더링 안 됨
2. **키 입력 불가** — `useKeyboard` 훅이 오버레이 모드에서 Enter/Esc 이벤트 전파 안 됨
3. **팝업 형식 UX 불만** — 사용자가 팝업 형식 온보딩을 원하지 않음
4. **플로우 구식** — Git SSH 셋업 + Traefik 수동 셋업이 온보딩에 있을 이유 없음

## 핵심 변경

**TUI 팝업 온보딩 → CLI 온보딩 (TUI 실행 전)**

사용자가 `openlander`를 실행하면, TUI가 뜨기 전에 CLI에서 필수 셋업을 완료하고, 끝나면 TUI로 진입.

---

## 플로우

```
$ openlander

  ━━━ [1/3] Docker ━━━━━━━━━━━━━━━━━━━━━━━━
  Checking Docker...
  ✓ Docker running

  ━━━ [2/3] AI Provider ━━━━━━━━━━━━━━━━━━━
  Choose your AI provider:
  ❯ OpenRouter (free, no credit card)
    Gemini (free tier available)
    Anthropic (Claude)
    OpenAI (GPT)
    Ollama (local)

  Enter your OpenRouter API key: ****
  ✓ Saved

  ━━━ [3/3] Git Authentication ━━━━━━━━━━━━
  Choose Git auth method:
  ❯ GitHub OAuth (Login via browser)
    SSH Key (auto-detect existing keys)
    Skip (public repos only)

  // OAuth 선택 시:
  Open this URL: https://github.com/login/device
  Enter code: ABCD-1234
  ⟳ Waiting for authorization...
  ✓ Connected as @username

  // SSH 선택 시:
  Found 2 SSH key(s):
  ❯ id_ed25519
    id_rsa
  ✓ SSH key configured

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Launching OpenLander...
```

---

## 단계 상세

### Step 1: Docker Check

**기존 구현 재사용**: `src/cli/onboard.ts` — `ensureDocker()`

- Docker 설치 확인
- 미설치 → 자동 설치 제안 (Linux) / 수동 안내 (macOS)
- 데몬 미실행 → 시작 시도
- 권한 문제 → docker 그룹 추가

**변경 없음** — 현재 CLI 코드 그대로 사용.

### Step 2: LLM Provider Setup (BYOK)

**신규 구현**: `src/cli/onboard-llm.ts`

- `@inquirer/prompts` 기반 (이미 의존성에 있음)
- 프로바이더 선택 → API 키 입력 → 모델 선택(기본값 제공) → `updateConfig()` 저장
- Ollama 선택 시 API 키 스킵

**재사용 데이터**:

- `LLM_PROVIDERS` 목록 (from `src/tui/onboarding/LlmSetup.tsx`)
- `MODEL_DEFAULTS` 맵 (from `src/tui/onboarding/LlmSetup.tsx`)

**향후 확장점**: v0.0.12에서 프로바이더별 OAuth 인증 추가 시, 이 단계에서 "구독 로그인 / API Key 직접 입력" 분기를 추가할 수 있도록 구조 설계.

### Step 3: Git Authentication

**재사용 + 신규**:

| 옵션                       | 소스                                | 구현                  |
| -------------------------- | ----------------------------------- | --------------------- |
| GitHub OAuth (Device Flow) | `src/git-providers/github-oauth.ts` | 기존 로직 재사용      |
| SSH Key                    | `src/tui/onboarding/GitSetup.tsx`   | SSH 키 탐지 로직 추출 |
| Skip                       | —                                   | `onNext()` 호출       |

**GitHub OAuth 플로우**:

1. `requestDeviceCode()` → user_code + verification_uri 출력
2. `openInBrowser(verification_uri)` → 브라우저 자동 오픈
3. `pollForAccessToken()` → 대기 + 토큰 수신
4. `validateToken()` → GitHub API로 사용자 확인
5. `updateConfig({ gitProviders: { github: { token, username, authMethod: 'oauth' } } })`

**SSH Key 플로우**:

1. `~/.ssh/` 디렉토리 스캔 → 기존 키 목록 표시
2. 키 없으면 → ed25519 키 자동 생성
3. 선택된 키 → GitHub SSH 테스트
4. `updateConfig({ git: { sshKeyPath } })`

---

## 제거/비활성화 대상

### 삭제할 파일

- `src/tui/onboarding/Welcome.tsx`
- `src/tui/onboarding/DockerCheck.tsx`
- `src/tui/onboarding/GitSetup.tsx`
- `src/tui/onboarding/LlmSetup.tsx`
- `src/tui/onboarding/TraefikSetup.tsx`
- `src/tui/onboarding/Ready.tsx`
- `src/tui/onboarding/index.tsx` (컨트롤러)

### 유지할 파일

- `src/tui/onboarding/PatchNotes.tsx` — TUI 진입 후 패치노트 표시에 사용 가능

### 수정할 파일

- `src/tui/App.tsx` — `setup` 모드 분기 제거. CLI 온보딩 완료 후 바로 메인 모드 진입.
- `src/cli/index.ts` — 온보딩 플로우 진입점. `ensureDocker()` → `setupLlm()` → `setupGit()` → TUI 실행.
- `src/cli/onboard.ts` — 기존 Docker 체크 유지 + export 정리.

### 신규 파일

- `src/cli/onboard-llm.ts` — LLM 프로바이더 CLI 셋업
- `src/cli/onboard-git.ts` — Git 인증 CLI 셋업

---

## Traefik 처리

온보딩에서 제거. 대신:

- TUI 초기화 시 `ctx.traefik.start()` 자동 실행 (백그라운드)
- 실패해도 non-fatal — 경고만 표시
- 현재 `src/tui/onboarding/TraefikSetup.tsx`의 로직을 `src/app.ts` 초기화로 이동

---

## 기술 스택

- **CLI 인터랙션**: `@inquirer/prompts` (select, input, confirm, password)
- **스타일링**: `picocolors` (이미 사용 중)
- **OAuth**: `src/git-providers/github-oauth.ts` (기존)
- **설정 저장**: `updateConfig()` (기존)

---

## 온보딩 재실행 조건

`openlander` 실행 시 다음 조건으로 온보딩 필요 여부 판단:

```typescript
function needsOnboarding(config: OpenLanderConfig): boolean {
  // Docker는 매번 체크 (데몬 상태 변할 수 있음)
  // LLM 프로바이더 미설정이면 온보딩 필요
  return !config.llm?.provider || !config.llm?.apiKey;
}
```

- Git 인증은 선택사항(Skip 가능)이므로 온보딩 조건에 포함하지 않음
- Docker는 매 실행 시 상태 체크 (온보딩과 별개)

---

## 수용 기준 (AC)

- [ ] `openlander` 실행 시 CLI에서 Docker → LLM → Git 셋업 진행
- [ ] Enter/Esc/화살표 키 정상 동작
- [ ] 각 단계 스킵/재시도 가능
- [ ] 온보딩 완료 후 TUI 정상 진입 (팝업 없음)
- [ ] 기존 `~/.openlander/config.json`이 있으면 온보딩 스킵
- [ ] GitHub OAuth Device Flow 정상 동작
- [ ] SSH 키 자동 탐지 + 선택 정상 동작
- [ ] Traefik이 TUI 초기화 시 백그라운드로 자동 시작
- [ ] TUI 온보딩 컴포넌트 6개 삭제됨
- [ ] 648+ 테스트 통과, 빌드 성공
