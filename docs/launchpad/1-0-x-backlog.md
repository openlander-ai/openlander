# OpenLander 1.0.x Backlog

**작성일**: 2026-04-22 (Day 16, 5/1 GA freeze 까지 9일)
**상태**: 1.0 GA에서 의도적으로 제외, 1.0.x (5월 중순~말) 처리 예정

이 문서는 1.0 GA 작업 중에 발견했지만 의도적으로 deferral한 항목들 + cumulative critic / verifier가 1.0.x로 명시한 항목들의 단일 소스. 1.0 ship 후 첫 release sprint 입력으로 사용.

---

## P0 (1.0.x 첫 릴리스에 반드시)

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
