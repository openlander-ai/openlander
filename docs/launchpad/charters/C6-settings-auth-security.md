# Charter C6: Settings_AUTH_SECURITY

**Tier**: Zero-Tolerance
**예상 소요**: 45분

## 1. Pre-condition

- 어드민 로그인 완료
- LLM 등록됨 (재테스트 가능 상태)
- 추가 임시 프로젝트 1개: `qa-c6-compose` (test-compose-multi, running) — 단 1개의 시나리오에만 사용

## 2. Scenarios

### C6S1_SETTINGS_TABS_RENDER

/settings → 7탭 (System/Security/Proxy/GitHub/AI/Operations/MCP) 전환.
**PASS**: 각 탭 console.error 0건 + 비예상 4xx/5xx 0건.

### C6S2_LLM_TEST_CALL (SE1)

AI 탭 → 등록된 provider → Test Connection 버튼.
**PASS**: 5초 안에 성공 토스트.
**FAIL**: 401/타임아웃/에러 토스트.

### C6S3_RESOURCE_LIMITS_PROFILE_CHANGE (SE2, runContainer 경로만)

어떤 git/image 프로젝트의 Settings → Resources → 프로파일을 'small'로 변경 → Save → Redeploy → `docker inspect {container}` HostConfig.Memory가 536870912 (512MB)인지 확인.
**PASS**: 메모리 limit 정확 적용.

### C6S4_RESOURCE_LIMITS_COMPOSE_DISABLED (U-P0-1 검증)

`qa-c6-compose` (compose 프로젝트) → Settings → Resources 섹션.
**PASS**: 패널이 비활성 상태로 표시 + "compose v1.1.0에서 지원" 메시지 노출 (data-testid="resource-limits-compose-unsupported").
**FAIL**: 일반 패널이 노출되어 사용자가 limits를 설정할 수 있게 보임 (silent failure 위험).

### C6S5_PASSWORD_CHANGE_NEXT_LOGIN_REQUIRES_NEW (SE5, scope-corrected)

Security 탭 → 비밀번호 변경 → Save → 즉시 logout → 옛 비번으로 /login → 새 비번으로 /login.
**PASS**: 옛 비번 401, 새 비번 200.
**SKIP/1.0.x**: "변경 직후 기존 세션 자동 만료" 는 1.0에서 미구현(`src/web/api/auth-routes.ts:188`). 1.0.x에서 broadcast invalidation 추가 예정.

### C6S6_AUTH_PROTECTED_REDIRECT (A1, scope-corrected)

로그아웃 → 직접 URL `http://localhost:10114/projects` 접근.
**PASS**: 401 후 /login 리다이렉트 + 로그인 후 /projects 진입(원래 경로 복귀는 1.0 미구현 — `web/src/pages/LoginPage.tsx:19`이 항상 `/projects`로 보냄. 1.0.x 백로그).
**FAIL**: 비인증 상태로 보호 라우트 진입 가능 (보안 회귀).

### C6S7_TOKEN_NOT_IN_URL (보안)

어떤 페이지든 진입 후 URL bar 확인. 새로고침 후 다시 확인.
**PASS**: URL에 token/Bearer/sessionId 같은 sensitive 값 0개.
**FAIL**: 토큰 또는 세션 ID가 query string/path에 노출.

### C6S8_SSE_REQUIRES_AUTH (보안)

로그아웃 상태에서 직접 `curl http://localhost:10114/api/ops/activity?follow=true` 시도 (또는 /api/projects/{id}/build/stream).
**PASS**: 401 응답 + body에 sensitive 데이터 0개.
**FAIL**: 200 응답 또는 일부 이벤트 leak.

### C6S9_CSRF_ON_MUTATING (보안)

로그인 상태에서 다른 origin(예: `http://example.com`) 페이지에서 fetch로 POST `/api/projects/{id}/stop` 시도 (cookie 자동 동봉).
대안: curl로 origin 헤더 없이 요청.
**PASS**: 거부 (403 또는 인증 실패).
**Note**: Hono의 cookie-based 세션 + Bearer 동시 지원 — Bearer 토큰이 세션 우회 수단인지 검증.

### C6S10_LOGOUT_SENSITIVE_RESIDUE (보안)

로그아웃 후 브라우저 back 버튼 → 캐시된 페이지에 sensitive 값 (이메일, 토큰, 프로젝트 이름) 잔존 여부.
**PASS**: 캐시된 데이터 노출되더라도 새 fetch 시도 즉시 401 → /login 리다이렉트.
**FAIL**: 토큰/사용자 정보가 그대로 보임 + 새 페이지 fetch 가능.

## 3. Output

표준 5섹션 + 특별 항목:

- C6S4: 스크린샷 (compose 프로젝트의 Resources 패널 비활성 메시지)
- C6S7~C6S10: 보안 시나리오는 PASS/FAIL과 함께 상세 재현 절차 + curl 명령어 첨부

## 4. Cleanup

```bash
# 비밀번호는 변경 후 본인이 기억
# qa-c6-compose Purge
docker ps -a --filter name=qa-c6-
```

## 5. Refs

- `web/src/components/config/ResourceLimitsPanel.tsx` (U-P0-1 fix)
- `web/src/pages/SettingsPage.tsx`
- `src/web/api/auth-routes.ts`
- 핫스팟 #9 (Cloudflare/Traefik domain routing status-bypass)
