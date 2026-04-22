# OpenLander 1.0.x Backlog

**작성일**: 2026-04-22 (Day 16, 5/1 GA freeze 까지 9일)
**상태**: 1.0 GA에서 의도적으로 제외, 1.0.x (5월 중순~말) 처리 예정

이 문서는 1.0 GA 작업 중에 발견했지만 의도적으로 deferral한 항목들 + cumulative critic / verifier가 1.0.x로 명시한 항목들의 단일 소스. 1.0 ship 후 첫 release sprint 입력으로 사용.

---

## P0 (1.0.x 첫 릴리스에 반드시)

### 0. UI Day-16 tri-review 잔여 항목 (2026-04-22 OMC triple pass)

`code-reviewer` + `critic` + `designer` 3-agent 교차 리뷰에서 SHIP-BLOCKER 3건은 1.0에서 fix, 나머지는 1.0.x로 deferred.

- **Dual-token 마이그레이션 완전 이행**: 커밋 `54c4f9c` 는 text 토큰만 옮김. `bg-bg-app/panel/subtle` 400+곳 잔존 (신규 primitive `PageHeader.tsx:22`, `page-empty-state.tsx:24` 포함). 커밋 헤드라인이 실제 범위를 과장. 1.0.x에서 codemod + Playwright 시각 회귀로 완료. OL 토큰은 `tailwind.config.js:71-75`에 아직 살아있어 정상 렌더 유지. (Why: D-9에 400+ replace는 회귀 기계. How to apply: codemod 준비되면 1주일 버퍼 확보 후 실행.)
- **`Incidents → Alerts` 영문 리네임 재검토**: 한국어 `장애`는 유지 (탁월). 영어 `Alerts`는 SRE 표준(PagerDuty/Datadog)과 충돌 가능. 30일 후 사용자 피드백 기반 재결정. 되돌릴 경우 i18n 값만 수정 (키 unchanged).
- **Incidents/Postmortem 내부 심볼 정리**: UI는 Alerts/Alert Reports로 리네임됐으나 API path (`/api/ops/incidents`, `/api/ops/postmortems`), URL param (`?tab=postmortems`), prop (`activeIncidentCount`), i18n 키 (`ops.postmortems`, `postmortemsTab`) 모두 옛 이름 유지 중. 2.0에서 coordinated rename.
- **PageEmptyState 채택 gap**: `DeploymentsList.tsx:176`, `RecoveryTab.tsx:199/230`, `MainFeedGrid.tsx:457/476`, `Overview.tsx:176/190/236` 아직 인라인 empty-state. 마이그 + PageEmptyState에 `size="sm"` variant 추가 (tab interior용 `p-6 / h-8 w-8`).
- **Badge 라이트모드 contrast 강화**: `yellow` variant (`bg-yellow-500/15 text-yellow-800`), `green` (`text-emerald-700`) 흰 카드 위에서 WCAG AA 4.5:1 미달 가능. 각 700→800 bump 또는 amber로 교체.
- **Navigation 일관성**: `AiFeaturesSection.tsx:277`의 `<a href="/settings?tab=operations">`를 `<Link to>` / `navigate()`로 교체 (풀 리로드 방지).
- **NewProjectFlow PageHeader 마이그**: `NewProjectFlow.tsx:171-180`이 PageHeader 구조를 수동 재구현. 1:1 교체 가능.
- **StatusDot/LoadingState**: 2026-04-22에 "orphan primitive 0 consumer"로 판단하여 삭제. 1.0.x에서 "상태 점이 자주 반복되는 곳" 3+곳 발견되면 재도입 검토.
- **ServicesPage 카드 일관성**: `rounded-xl border-2 border-dashed` / `rounded-xl border` / `rounded-md border/60 bg-bg-app/20` 3종 혼재. dokploy 정합성 위해 단일 카드 atom으로 통합.

### 1. LLM cooldown DB persist + `recovery:blocked` 이벤트

- **현재**: `src/pipeline/auto-recovery.ts` 의 LLM unreachable cooldown이 module-level `let` 변수 — process restart 시 0으로 reset.
- **위험**: PM2/systemd 가 crash-restart 후 한 번의 LLM retry cycle이 즉시 다시 fail → cooldown 다시 engage. 영향은 작지만 깨끗하지 않음.
- **Fix**: `circuit_breakers` 테이블 (또는 신규)에 cooldown 행 저장 + `recovery:blocked` 이벤트 emit (UI 가 "LLM 다운, 30분 후 재시도" 표시).
- **참고**: Day 15 verifier R2 보고서.

### 2. `RECOVERING_TIMEOUT_MS` configurable

- **현재**: `src/monitor/container-state-reconciler.ts:19` 에 60분 hardcoded.
- **위험**: 큰 image 빌드 (Rails monolith 등)는 정상적으로 60분 초과 가능. 강제 'error' 전이 후 사용자 혼란.
- **Fix**: `OpenLanderConfig.ai.recovery.stuckTimeoutMs` 노출. 기본값 60분 유지.

### 3. OAuth defensive catch 좁히기

- **현재**: `src/db/repos/oauth.repo.ts` 가 `no such column|no such table` 만 swallow + rethrow 나머지. 이건 acceptable하나 다른 SqliteError 까지 silently 가려질 위험.
- **Fix**: `instanceof SqliteError` + error code 체크로 더 좁힘. log 메시지에 actionable text ("Run npx drizzle-kit migrate") 강화.

### 4. Drizzle prepared-statement cache race 다른 repo 검토

- **현재**: oauth.repo.ts 만 defensive. 같은 race가 project.repo.ts (`getProject`, `getProjectByName`), env.repo.ts 등 20+ 다른 read site에 영향 있을 가능성 (가설 미검증).
- **Fix**: (a) repro test 작성 → 다른 repo도 영향 확인 → (b) 영향 있으면 shared helper로 추출.

### 4a. Security review (Day 16) 발견 — multi-tenant 가능 시 P0 격상

Day 16 security-reviewer 결과 (single-tenant 1.0 ship-safe, 그러나 multi-user 1.0.x 시 필수):

- **B1 (MED)**: `src/errors.ts:375-385` `LLMUnreachableError.message` 가 raw cause string (hostname/port/code) 노출. → cause를 class label (`'connection_refused'`, `'dns_failed'`, `'timeout'`)로 sanitize.
- **B2 (MED)**: `DeployLockedError.details.lockedBySession` 이 sessionId 형식 (`${verb}-${projectId}-${timestamp}`) 노출 → admin 활동 leak. → hash 또는 `{lockedAt}` 만으로 좁힘.
- **E1 (LOW)**: `src/web/api/project-routes.ts:745, 801, 919, 970, 1174, 1222, 1254` lock sessionId 포맷에 cryptographic random 없음. Node single-thread 라 이론적 collision. → `crypto.randomBytes(4).toString('hex')` 추가.
- **E3 (LOW)**: `src/web/api/project-routes.ts:1189-1194` `/unarchive` 만 lock 누락. archive↔unarchive flap race 가능. → 다른 7곳과 같은 패턴.
- **G2 (LOW)**: 60min watchdog가 active deploy lock 존중 → genuinely stuck recovery 풀 admin 경로 없음. → admin-only `POST /api/projects/:id/force-reset-recovery`.
- **B3 (NIT)**: `DockerBuildError` 가 build log 마지막 2KB 노출 — secret-shaped token 가능성. → 정규식 redaction.
- **B4 (NIT)**: 마이그레이션 backfill 결과 audit 안 됨. → migration_audit 테이블.

### 4b. Codex Day 16 cross-check 발견 — 1.0.x로 deferred

Codex (gpt-5.4) cross-check가 NO-GO 판정한 1 CRITICAL + 3 HIGH + 1 MED. CRITICAL은 즉시 fix (TTL 15→30min, commit 추가됨). 나머지 HIGH 3건은 architecture 큰 작업이라 1.0.x로 deferred:

- **HIGH 1 — Lock manager AgentPool 의존**: `src/web/api/project-routes.ts` 7곳 모두 `if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(...))` 패턴 → LLM 비활성 install 에서 lock guard 전부 disable. → `src/lib/project-lock-manager.ts` 별도 module로 분리, `AppContext.lockManager` 추가, AI 여부 무관 항상 활성. (시도했으나 cascading API change로 48 test fail → revert. 1.0.x에 신중히 재시도.)

- **HIGH 2 — Pipeline boundary lock 누락**: `src/pipeline/deploy-core.ts:1992, 2046, 2090` `pipeline.stop/archive/remove` 자체에 lock 없음. MCP tools (`src/tools/defs/project-ops.ts:61, 385`) 가 직접 호출 시 우회. `src/monitor/rollback-watcher.ts:145, src/monitor/ops-recovery.ts:589` 도 동일. → 7곳 fix는 web route 에서만 작동. boundary lock으로 모든 entry point 보호 필요.

- **HIGH 3 — Watchdog deferral indefinite**: `src/monitor/container-state-reconciler.ts:154` 가 `getDeployLockInfo()` 결과 있으면 timeout skip. `src/db/repos/project.repo.ts:418` `getDeployLockInfo` 자체가 expired row 정리 안 함. → `getDeployLockInfo` 가 `>30min` 자동 NULL 반환 또는 정리. 1.0 ship 시 새 30min TTL이 cleanExpiredDeployLocks에 자동 적용되므로 부분 mitigation.

- **MED — Test 강화**: `test/web/api/danger-actions-lock.test.ts` 가 mock pipeline 의존, real DB lock expiry / AI-disabled mode / throw-path release 미검증. → integration test 추가.

### 5. 첫 24h ops 알림 hook

- **현재**: GA 첫 24h 사용자가 problem 생기면 알 방법 없음 (dashboard 봐야 함).
- **Fix**: 옵션 (1) Slack/Discord webhook outgoing notification on circuit-breaker open / recovery:failed / unhandledRejection. 옵션 (2) email digest. 1.0.x P0 — operator UX 핵심.

---

## P1 (1.0.x 두 번째 릴리스 / 첫 점검 후)

### 6. Webhook skip reason `'project_busy'` enum 추가

- **현재**: `src/webhook/index.ts` 가 lock contention 시 `'recovering'` enum으로 매핑 — UI에 misleading 메시지.
- **Fix**: skip reason enum에 `'project_busy'` 추가 + UI label.

### 7. Auto-recovery / rollback path lock 적용

- **현재**: `src/monitor/ops-recovery.ts:590`, `src/monitor/rollback-watcher.ts:147`, `src/tools/defs/compose.ts:242` 가 `pipeline.rollback` 직접 호출 (in-memory lock 우회). DB-level `withDeployLock` 이 backup으로 보호.
- **Fix**: 위 3곳에도 `agentPool.acquireProjectLock` 적용. user redeploy + auto rollback race 시 typed 409 표면화.

### 8. `relative()` path traversal guard

- **현재**: compose.ts 가 `relative(clonePath, composePath)` 저장. clonePath 밖이면 `..` 시작 — 이론적 보안 위험.
- **Fix**: `if (rel.startsWith('..')) throw new Error('compose path escapes clone root')`.

### 9. Migration 0006 LIKE 패턴 cross-platform

- **현재**: `/var/folders/%/openlander-%`, `/tmp/openlander-%` 등 _nix 패턴만. Windows `C:\Users\...\AppData\Local\Temp\openlander-_` 미커버.
- **Fix**: Windows 패턴 추가 또는 마이그레이션 0007에 보완.

### 10. Per-Agent QuestionBridge (옵션 B 풀 적용)

- **현재**: `pendingResolve` 가 requestId multiplex. AgentPool helpers (`replyToQuestion` 등) production callers에서 호출 안 됨 (dead code).
- **Fix**: `project-routes.ts`, `chat-routes.ts`, `channels/*` 에서 ctx.questionBridge 직접 호출 → agentPool helper 경유로 변경. dead code 제거.

### 11. DeployQueue 파일 + `AppContext.deployQueue` 필드 제거

- **현재**: 마커로만 남음. `src/pipeline/deploy-queue.ts` + `app.ts:391` `new DeployQueue()` + `:181` 필드.
- **Fix**: 모든 호출 사이트 정리됐으니 파일 + 필드 삭제. `auto-recovery.ts:305` `void deployQueue` 도 함께 제거.

---

## P2 (1.0.x 후순위 / 가능하면)

### 12. cli/index.ts unhandledRejection 핸들러 모든 command에 적용

- **현재**: default + start command 만 등록. mcp / recover command 등 다른 entry는 미등록.
- **Fix**: helper를 모든 command 시작점에서 호출.

### 13. 권한 분리 (multi-user roles)

- **현재**: 단일 row auth, role 필드 future use. admin 만 존재.
- **Fix**: role enum 활성화 + 권한 행렬 정의. multi-user SaaS 시나리오용.

### 14. RTL i18n 지원

- **현재**: 한국어/영어 LTR 만. RTL 미지원.
- **Fix**: tailwind dir 처리 + 텍스트 alignment 자동화.

### 15. Multi-process / cluster 지원

- **현재**: single-process / single-tenant 명시 (Day 12 docs).
- **Fix**: in-memory 상태 (PKCE map, AgentPool, lock) DB-backed 으로 이전.

### 16. C2 ProjectDetail UI E2E

- **현재**: Best-Effort 차터, operator 시각 검증.
- **Fix**: Playwright UI driver로 5탭 자동화. 메모리 누수 검증 포함 (1시간 ops feed open).

### 17. BUG-009 service delete warning UX

- **현재**: backend 가드 없이 즉시 삭제. 1.0 차터에서 Must로 격상 후 operator 수동 검증.
- **Fix**: ServiceDetail 에서 사용 중인 프로젝트 카운트 표시 + input verification + cleanup 결과 노출.

---

## P3 / NIT

### 18. CSP `connect-src ws: wss:` 좁힘

- **현재**: Day 13 follow-up 에 narrow 적용됨 (commit `c43dd75`)이지만 본인 인스턴스 PM2 미restart로 OLD CSP 보임. PM2 restart 후 자동 해결.
- **Fix**: 작업 없음. 검증만.

### 19. LLMUnreachableError 메시지의 "PM2 95 times" 참조 제거

- **현재**: errors.ts 의 doc comment 에 내부 incident 참조. 사용자 facing X (단 문서화 시 가려야).
- **Fix**: 1.0.x cleanup 시 doc 정리.

### 19a. Lock TTL 단일 상수로 추출 (1.0 GA B3 후속)

- **현재**: 1.0 GA B3 에서 `PROJECT_LOCK_TIMEOUT_MS` (15분) 와 `cleanExpiredDeployLocks` default (15분) 를 일치시켰지만, 두 곳에 중복된 숫자로 박혀 있음. `RECOVERING_TIMEOUT_MS` (60분) 는 의도적으로 더 김.
- **Fix**: `src/llm/agent-pool.ts` 의 `PROJECT_LOCK_TIMEOUT_MS` 를 단일 source 로 두고 `project.repo.ts`/`db/index.ts` 가 import 하도록 정리. 한 곳만 바꾸면 둘 다 따라가게.

### 19b. ops-recovery / rollback-watcher / compose tools lock 적용 (1.0 GA B1/B2 후속)

- **현재**: 1.0 GA B1 + B2 에서 `/rollback`, `/stop`, `/archive`, `/purge`, DELETE `/projects/:id` 5 개 route 에 `agentPool.acquireProjectLock` 적용. 그러나 백로그 #7 에서 언급한 `ops-recovery.ts:590`, `rollback-watcher.ts:147`, `tools/defs/compose.ts:242` 는 여전히 `pipeline.rollback` 직접 호출 — DB-level `withDeployLock` 만 보호.
- **Fix**: 백로그 #7 과 함께 처리.

### 20. e2e/concurrent-deploy.spec.ts 정리

- **현재**: 본인 인스턴스 비번 안 받으면 skip. 좋음. 단 archived 시 fallback 개선.
- **Fix**: cleanup 강화.

---

## 운영 모니터링 (1.0.x 포지셔닝)

이 항목들은 1.0.x 가 아닌 운영 도구 신설:

- **로그 회전**: pino 기본 winston 미적용. 운영 시 `~/.openlander/error.log` 무한 증가.
- **Rate limiting**: auth login (brute force), deploy/redeploy (DoS), MCP server (cost 폭증)
- **LLM token spend cap**: 사용자별 / 일별 하드 캡 (현재 cooldown 만)
- **Graceful shutdown**: SIGTERM 시 in-flight deploy 처리 (현재 force kill)
- **Backup / disaster recovery**: `~/.openlander/openlander.db` 자동 backup → S3 등
- **메트릭 노출**: Prometheus / OpenMetrics endpoint

---

## 처리 상태 추적

이 백로그는 1.0 GA ship 후 GitHub Project Board 로 이전. 각 항목 별 issue 생성 + assignee + ETA. 1.0.x 첫 릴리스 (예: 5월 15일) target.
