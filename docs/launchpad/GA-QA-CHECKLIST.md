# OpenLander 1.0.0 GA QA Checklist

**작성일**: 2026-04-21
**대상**: 본인이 직접 ship 전 검증
**총 추정 시간**: 4.5h (Zero-Tolerance만), 5.5h (전체)

이 체크리스트는 7-day sprint 종료 후 본인이 직접 손으로 검증할 항목입니다. 자동 검증(테스트/타입체크/빌드)은 모두 통과했지만 **UI 동선 + 보안 + 실 사용자 시나리오는 본인 확인 필요**.

---

## 📊 현재 자동 검증 상태 (이미 통과)

| 영역                     | 상태                         | 증거                                                            |
| ------------------------ | ---------------------------- | --------------------------------------------------------------- |
| Backend unit/integration | ✅ 2689 PASS, 4 skip, 0 fail | `npm test`                                                      |
| TypeScript               | ✅ 0 errors                  | `npx tsc --noEmit`                                              |
| ESLint                   | ✅ 0 warnings                | `npm run lint`                                                  |
| Build                    | ✅ tsup + vite               | `npm run build`                                                 |
| PM2 runtime              | ✅ version 1.0.0 online      | `/health` 200                                                   |
| MIG smoke (fresh DB)     | ✅ MIG1 PASS                 | `docs/launchpad/reports/2026-04-20/MIG-migration-boot-smoke.md` |
| Verifier 독립 검증       | ✅ GO with caveats           | `docs/launchpad/reports/2026-04-21/day7-report.md`              |
| Doc/code 일치 (Codex)    | ✅ Day 7 fix 후              | (Day 7 doc fix executor 결과)                                   |

---

## 🚨 NO-GO 트리거 (단 1건이라도 발견 시 ship 보류)

- [ ] 데이터 손상 (Purge가 다른 프로젝트 영향)
- [ ] 보안 우회 (미인증 보호 라우트 진입)
- [ ] LLM 무한 호출 (recovery loop가 계속 돌면서 토큰 소비)
- [ ] 컨테이너 중복 생성 (같은 프로젝트 더블 deploy)
- [ ] 마이그레이션 실패 (rc.7 → 1.0 데이터 손실)

---

## ✅ Zero-Tolerance 체크리스트 (반드시 PASS)

### C1. NewProjectFlow (30분)

**Pre-condition**: 어드민 로그인 + LLM 등록됨, 임시 prefix `qa-c1-*`

**시나리오**:

- [ ] **C1S1 (한글 이름 거부, BUG-001)**: NewProjectFlow → name `qa-c1-한글` 입력 → Deploy
  - PASS: UI에서 즉시 거부 + 에러 메시지 + Network 탭에 `/projects/deploy` 호출 0회
  - FAIL: 서버 호출 발생 또는 거부 메시지 없음

- [ ] **C1S2 (포트 범위 거부, BUG-007)**: Docker Image 탭 → `nginx:alpine`, port `-1` → Deploy. port `0`, `99999` 도 시도
  - PASS: 세 케이스 모두 UI 즉시 거부 + 서버 호출 0회

- [ ] **C1S3 (Golden Path)**: Search 탭 → `openlander-ai/test-single-dockerfile` → name `qa-c1-ok` → Deploy
  - PASS: 90초 안에 ProjectDetail 진입 + status='running' + URL 카드 표시

- [ ] **C1S4 (Auto-detect)**: `openlander-ai/test-no-dockerfile` → name `qa-c1-auto` → Deploy
  - PASS: 120초 안에 status='running'

- [ ] **C1S5 (Image deploy)**: `nginx:alpine`, port 8080, name `qa-c1-img` → Deploy
  - PASS: clone/build skip하고 30초 안에 running

- [ ] **C1S6 (Build fail UX)**: `openlander-ai/test-build-fail` → name `qa-c1-fail`
  - PASS: 60초 안에 status='error' + timeline에 build 단계 빨간색 + 에러 expandable

- [ ] **C1S7 (Monorepo dockerfile path, BUG-005)**: `openlander-ai/test-monorepo` → dockerfile path 설정 → Deploy → Settings에서 path 변경 → Redeploy
  - PASS: 두 번째 deploy에서 새 path가 빌드 로그에 반영

**Cleanup**: 위 5개 프로젝트 Purge → `docker ps -a --filter name=qa-c1-` 잔여 0

---

### C3. Recovery / Rollback / Blue-Green (60분)

**Pre-condition**: `qa-c3-bg` (test-single-dockerfile) + `qa-c3-crash` (test-runtime-crash) 둘 다 running. LLM 등록됨. circuit breaker closed.

**시나리오**:

- [ ] **C3S1 (Rollback, BUG-004)**: `qa-c3-bg` Redeploy 2회 → Rollback → 첫 deployment 선택 → Confirm
  - PASS: 60초 안에 status='running' + timeline에 ENETUNREACH/ECONNREFUSED 0건
  - FAIL: rollback 실패 또는 네트워크 에러

- [ ] **C3S2 (Blue-Green health check, BUG-003)**: `qa-c3-bg` → Blue-Green → health check path `/` → Confirm
  - PASS: 30초 헬스체크 통과 + 신구 컨테이너 전환 + 기존 컨테이너 status='running' 30초 유지 (`docker ps`)
  - FAIL: 헬스체크 실패 + 기존 컨테이너 stopped

- [ ] **C3S3 (B-G failed fallback, BUG-016)**: 인위적 빌드 실패 (잘못된 PORT env) → Blue-Green Confirm
  - PASS: 신규 실패 시 기존 컨테이너 계속 running + UI 명확한 실패 메시지

- [ ] **C3S4 (Auto-recovery 표시, R1)**: `qa-c3-crash` 진입 → 다른 터미널 `docker kill qa-c3-crash`
  - PASS: 60초 안에 activity feed에 `container:die` → `recovery:started` → `recovery:success` 또는 `recovery:exhausted`

- [ ] **C3S5 (Recovering 중 Stop, CC1)**: C3S4 진행 중 status='recovering' 보일 때 Stop 클릭 → Confirm
  - PASS: 30초 안에 status='stopped' 안정 + activity feed 모순 없음

**Cleanup**: `qa-c3-bg`, `qa-c3-crash` Purge

---

### C4. Danger Actions + Services (45분)

**Pre-condition**:

- `qa-c4-purge-target` (test-single-dockerfile, running)
- `qa-c4-archive-target` (test-single-dockerfile, running)
- `qa-c4-svc-consumer` (test-env-required, env에 DATABASE_URL 주입)
- `qa-c4-pg` (PostgreSQL 17 service)

**시나리오**:

- [ ] **C4S1 (Stop confirm)**: `qa-c4-archive-target` → Stop → Confirm dialog → Cancel → Stop → Confirm
  - PASS: Cancel 시 변화 없음. Confirm 시 30초 안에 stopped

- [ ] **C4S2 (Archive/Unarchive)**: Archive → Confirm → 'Show Archived' off일 때 안 보임 → on → 보임 → Unarchive
  - PASS: 토글 정확 + Unarchive 후 즉시 표시

- [ ] **C4S3 (Purge text match)**: `qa-c4-purge-target` → Purge → 부분 이름 입력 → Confirm disabled 확인 → 정확한 이름 → Confirm
  - PASS: 부분 매칭 시 disabled. Purge 후 ProjectsGrid에서 사라짐 + `docker ps -a` 잔여 0
  - FAIL: 부분 매칭으로 Confirm 가능 또는 다른 프로젝트 영향

- [ ] **C4S4 (Double redeploy lock, BUG-002)**: redeploy 50ms 간격 10회
  - PASS: 2회차 이후 disabled 또는 거부 토스트 + 컨테이너 중복 생성 0
  - FAIL: 동시 빌드 발생 또는 409 Conflict

- [ ] **C4S5 (Volume duplicate, BUG-008)**: Settings → Volumes → 같은 mount path 2회 추가
  - PASS: UI 즉시 거부 + 명확한 에러

- [ ] **C4S6 (Service create + link, S1)**: ServicesPage → PostgreSQL 17 → name `qa-c4-pg` → Create → Connection 탭 → connection string 복사 → `qa-c4-svc-consumer` Settings → DATABASE_URL 추가 → Redeploy
  - PASS: 프로젝트 status='running' (env 주입 성공)

- [ ] **C4S7 (Service delete warn, BUG-009 의심)**: `qa-c4-pg` → Delete 클릭
  - 확인: 다이얼로그 뜨나? 사용 프로젝트 경고 표시? 삭제 후 env vars 어떻게?
  - PASS (이상): 다이얼로그 + 사용 프로젝트 경고 + cleanup 결과 노출
  - FAIL (BUG-009 미해결): 즉시 삭제 → No-Go 사유

**Cleanup**: 모두 Purge

---

### C5. OpsCenter + Alerts (60분)

**Pre-condition**: `qa-c5-crash` (test-runtime-crash) running. LLM 등록됨.

**시나리오**:

- [ ] **C5S1 (Tabs render)**: /operations → 6탭 (Live/Incidents/Approvals/Postmortems/Patterns/Usage) 전환
  - PASS: 각 탭 console.error 0건 + 비예상 4xx/5xx 0건

- [ ] **C5S2 (Keyboard shortcuts)**: Live 탭 → j (next), k (prev), / (focus search), ? (help), Esc (close)
  - PASS: 모든 단축키 정상

- [ ] **C5S3 (SSE backfill + live)**: 페이지 로드 → DevTools Network → 'backfill-complete' 도달 모니터
  - PASS: backfill 후 live 전환, 중복 row 0

- [ ] **C5S4 (Incident from crash, BUG-013/014)**: `docker kill qa-c5-crash` → Live + Incidents 탭 모니터
  - PASS: 70초 안에 (a) Live feed에 container:die, (b) Incidents 탭 신규 row, (c) ProjectDetail Operations 탭 같은 incident
  - FAIL: 셋 중 하나라도 누락 또는 카운트 불일치

- [ ] **C5S5 (Incident slideover)**: 새 incident 클릭 → slideover → 이벤트 타임라인 → Esc 닫힘
  - PASS: slideover 정확 + Esc 동작

- [ ] **C5S6 (Circuit breaker open/reset, O2)**: crash 5회 반복 → CircuitBreakerWidget에 'open' → Reset → Confirm
  - PASS: 5회 실패 후 open + Reset 후 closed

- [ ] **C5S7 (Postmortem auto-gen, O3)**: C5S4 후 5분 안정성 창 대기 → Postmortems 탭
  - PASS: 5~10분 안에 postmortem 카드 + LLM 분석 텍스트
  - Note: LLM 비용 발생, 잔액 확인

**Cleanup**: `qa-c5-crash` Purge

---

### C6. Settings + Auth + Security (45분)

**Pre-condition**: 어드민 로그인. LLM 등록됨. `qa-c6-compose` (test-compose-multi, running) — 1개 시나리오만 사용

**시나리오**:

- [ ] **C6S1 (Settings tabs)**: /settings → 7탭 (System/Security/Proxy/GitHub/AI/Operations/MCP) 전환
  - PASS: 각 탭 console.error 0 + 4xx/5xx 0

- [ ] **C6S2 (LLM test, SE1)**: AI 탭 → Test Connection
  - PASS: 5초 안에 성공 토스트

- [ ] **C6S3 (ResourceLimits profile, SE2)**: 어떤 git/image 프로젝트 → Settings → Resources → 'small' → Save → Redeploy → `docker inspect` HostConfig.Memory가 536870912 (512MB)
  - PASS: 메모리 limit 정확

- [ ] **C6S4 (Compose ResourceLimits disabled, U-P0-1)**: `qa-c6-compose` → Settings → Resources
  - PASS: 패널 비활성 + "compose v1.1.0" 메시지 (data-testid="resource-limits-compose-unsupported")
  - FAIL: 일반 패널 노출 → silent failure 위험

- [ ] **C6S5 (Password change session, SE5)**: Security → 비밀번호 변경 → Save
  - PASS: 변경 후 기존 세션 만료 → /login 리다이렉트
  - FAIL: 세션 유지 (보안 회귀)

- [ ] **C6S6 (Auth redirect, A1)**: 로그아웃 → 직접 URL `http://localhost:10114/projects` 접근
  - PASS: 401 → /login 리다이렉트 + 로그인 후 /projects 자동 복귀

- [ ] **C6S7 (Token not in URL, 보안)**: 어떤 페이지든 진입 후 URL bar 확인 + 새로고침 후 다시
  - PASS: URL에 token/Bearer/sessionId 0
  - FAIL: 토큰/세션 ID 노출

- [ ] **C6S8 (SSE auth required, 보안)**: 로그아웃 상태에서 `curl http://localhost:10114/api/ops/activity?follow=true`
  - PASS: 401 + body에 sensitive 데이터 0
  - FAIL: 200 또는 일부 이벤트 leak

- [ ] **C6S9 (CSRF, 보안)**: 로그인 상태에서 다른 origin에서 fetch로 POST `/api/projects/{id}/stop` 시도 (cookie 자동 동봉)
  - 또는: curl로 origin 헤더 없이 요청
  - PASS: 거부 (403 또는 인증 실패)

- [ ] **C6S10 (Logout sensitive residue, 보안)**: 로그아웃 후 브라우저 back 버튼 → 캐시된 페이지 → sensitive 값 잔존?
  - PASS: 캐시 데이터 보여도 새 fetch 시도 즉시 401 → /login

**Cleanup**: `qa-c6-compose` Purge. 비밀번호 본인이 기억

---

## 🟡 Best-Effort (시간 되면)

### C2. ProjectDetail Timeline (30분, BE)

- C2S1 5탭 전환 console.error 0
- C2S2 Overview KPI nonzero (BUG-017)
- C2S3 Timeline live smoke
- C2S4 Runtime log stream
- C2S5 Reconnect

### C7. Dashboard / List Smoke (30분, BE)

- C7S1 Overview render
- C7S2 KPI nonzero
- C7S3 ProjectsGrid view toggle (localStorage 유지)
- C7S4 Show Archived
- C7S5 DeploymentsList filter
- C7S6 DeploymentsList → DeploymentDetail
- C7S7 빈 상태 CTA

---

## ✅ Final GA Gate (위 ZT 5 PASS 후)

- [ ] ZT 5 차터 모두 PASS (또는 critical 발견 0)
- [ ] No-Go 트리거 0건
- [ ] `docker ps -a --filter name=qa-` 잔여 0 (cleanup 완료)
- [ ] PM2 `openlander v1.0.0` 정상
- [ ] CHANGELOG.md 1.0.0 항목 본인 검토 완료
- [ ] migration-rc7-to-rc9.md 본인 검토 완료

위 모두 PASS하면 → ship.

---

## ❌ Critical 발견 시

1. 즉시 fix → 1.0.0-rc.10 빌드 → 이 체크리스트 영향 부분 재실행
2. 또는 발견사항 1.0.x 백로그 등록 후 ship 결정 (위험도 평가)

## 결과 기록

발견사항은 `docs/launchpad/reports/2026-04-21/manual-qa-{date}.md` 형식으로 본인이 작성. 시나리오 ID + PASS/FAIL + 증거 (스크린샷, 로그, curl 응답).
