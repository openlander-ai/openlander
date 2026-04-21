# OpenLander 1.0.0 — 첫 24시간 운영 Runbook

**대상**: 1.0.0 GA 후 첫 24시간 운영자 (본인)
**목표**: 자가호스팅 + 단일 사용자 시나리오에서 발생할 수 있는 장애를 빠르게 진단/복구

---

## 0. 시작 전 체크리스트 (배포 직전)

```bash
# 1. 코드 최신
git fetch && git status     # 깨끗

# 2. 마이그레이션 0~6 모두 적용 가능 검증
npm test -- --run test/db/migration-replay.test.ts test/db/migration-realistic-data.test.ts test/db/migration-0006-backfill.test.ts

# 3. 로컬 인스턴스 health
curl -s http://localhost:10114/health | jq

# 4. PM2 restart count 확인 (95 같은 이상치 없는지)
pm2 list

# 5. Docker daemon 정상
docker info | head -3

# 6. .env / config.json 백업
cp ~/.openlander/openlander.db ~/.openlander/openlander.db.bak.$(date +%Y%m%d)
cp ~/.openlander/config.json ~/.openlander/config.json.bak.$(date +%Y%m%d)
```

---

## 1. 정기 모니터링 (매시간)

```bash
# Health
curl -s http://localhost:10114/health | jq

# PM2 restart 증가율 (정상: 0~1/h)
pm2 list

# Recovering 상태 stuck 프로젝트 (60분 watchdog 가 자동 처리)
sqlite3 ~/.openlander/openlander.db "SELECT id, name, status, recovering_started_at FROM projects WHERE status='recovering'"

# Deploy lock leak (5분 stale timeout 이지만 visibility 위해)
sqlite3 ~/.openlander/openlander.db "SELECT project_id, session_id, acquired_at FROM deploy_locks WHERE released_at IS NULL"

# Disk 사용률 (80% 초과시 자동 cleanup, 그래도 모니터)
df -h ~/.openlander/

# Docker 리소스
docker ps -a | wc -l
docker volume ls | wc -l
```

---

## 2. 장애 → 진단 → 복구 매트릭스

### 2.1 PM2 process 무한 restart (95+ in 1h)

**원인 후보**:

- LLM provider (Ollama 등) 다운 → recovery agent 호출 시 ECONNREFUSED → unhandled rejection
- DB schema mismatch (마이그레이션 미적용)
- Docker daemon 다운 + reconcile loop가 throw

**진단**:

```bash
pm2 logs openlander --err --lines 200 | tail -50
pm2 logs openlander --err --lines 1000 | grep -E "ECONNREFUSED|SqliteError|unhandled|ENOTFOUND"
```

**복구**:

- `Cannot connect to API.*localhost:11434`: Ollama 시작 (`ollama serve &`) 또는 OpenLander LLM provider 변경 (Settings → AI)
- `SqliteError: no such column`: 마이그레이션 미적용. `npx drizzle-kit migrate` 또는 자동 적용 (재시작 시).
- `Docker daemon not running`: `open -a Docker` (macOS) 또는 `systemctl start docker`

### 2.2 hotdeal-tracker 같은 compose 프로젝트가 'recovering' 24h stuck

**1.0 fix**: 60분 watchdog 가 자동으로 'error' 전이 (마이그레이션 0006 + container-state-reconciler).

**즉시 unblock**:

```bash
sqlite3 ~/.openlander/openlander.db "UPDATE projects SET status='error', recovering_started_at=NULL WHERE status='recovering'"
pm2 restart openlander
```

**근본 원인 (compose)**:

- `dockerfile_path` 가 temp dir 가리키면 다음 deploy fail. 마이그레이션 0006 가 NULL로 백필.
- Watch list: `sqlite3 ~/.openlander/openlander.db "SELECT id, name, dockerfile_path FROM projects WHERE dockerfile_path LIKE '/var/folders/%/openlander-%' OR dockerfile_path LIKE '/tmp/openlander-%'"`

### 2.3 Deploy 동시 진행 안 됨

**1.0 fix**: per-project lock — 다른 프로젝트는 동시 가능, 같은 프로젝트는 typed 409.

**검증**:

```bash
OPENLANDER_ADMIN_PASSWORD='your-pwd' npx playwright test --config=playwright-live.config.ts e2e/concurrent-deploy.spec.ts
```

**stuck deploy lock 강제 해제**:

```bash
sqlite3 ~/.openlander/openlander.db "DELETE FROM deploy_locks WHERE released_at IS NULL"
pm2 restart openlander
```

### 2.4 Docker 컨테이너 / volume 누수

**자동**: 디스크 80% 초과 시 자동 cleanup (dangling images, build cache, 24h 이상 unused images).

**수동**:

```bash
docker ps -a --filter status=exited --filter name=ol- | tail -n +2 | awk '{print $1}' | xargs -r docker rm
docker volume prune -f
docker image prune -af
```

### 2.5 OAuth 토큰 미인식 ("GitHub auth required" 영구 표시)

**원인**: prepared statement 캐시 race (Day 15 root cause). 1.0 fix 가 첫 PM2 restart 후 해소.

**복구**: `pm2 restart openlander` 1회.

### 2.6 LLM 응답 안 옴 / cooldown 진입

**1.0 fix**: 30분 in-memory cooldown (process restart 시 reset).

**진단**:

```bash
pm2 logs openlander --lines 100 | grep -E "LLM_UNREACHABLE|cooldown|recovery:failed"
```

**복구**:

- LLM provider 재시작 (Ollama: `ollama serve`)
- OR PM2 restart 로 cooldown reset

---

## 3. Rollback playbook (1.0 → rc.9 긴급 다운그레이드)

**경고**: 마이그레이션 0006이 적용된 상태에서 rc.9 코드로 돌아가면 schema 가 호환 안 될 수 있음. 신중히.

**옵션 A: code 만 rollback, schema는 forward-compatible 가정**:

```bash
git checkout v1.0.0-rc.9
npm install && npm run build
pm2 restart openlander
# rc.9 가 0006 schema 컬럼 (recovering_started_at) 무시 — 정상 동작 가능
```

**옵션 B: schema도 rollback (데이터 손실 위험)**:

```bash
# 마이그레이션 0006 reverse
sqlite3 ~/.openlander/openlander.db "ALTER TABLE projects DROP COLUMN recovering_started_at"
sqlite3 ~/.openlander/openlander.db "DELETE FROM __drizzle_migrations WHERE id=6"
# 그 다음 옵션 A
```

**옵션 C: backup으로 복구 (가장 안전)**:

```bash
pm2 stop openlander
cp ~/.openlander/openlander.db.bak.YYYYMMDD ~/.openlander/openlander.db
git checkout v1.0.0-rc.9
npm install && npm run build
pm2 start openlander
```

권장: **옵션 A** 시도 → 실패 시 옵션 C.

---

## 4. 알람 임계치 (1.0.x 에서 webhook hook 으로 자동화 예정)

| 항목                      | 정상 | 주의    | 위험 |
| ------------------------- | ---- | ------- | ---- |
| PM2 restart / hour        | 0-1  | 2-5     | 6+   |
| Deploy lock stale (>10분) | 0    | 1-2     | 3+   |
| Project 'recovering'      | 0    | 1       | 2+   |
| Disk 사용률               | <70% | 70-85%  | >85% |
| Process memory (MB)       | <300 | 300-500 | >500 |
| Container count           | <30  | 30-50   | 50+  |

---

## 5. 데이터 백업

**자동**: 없음 (1.0.x 백로그).

**수동 (매일)**:

```bash
DATE=$(date +%Y%m%d)
mkdir -p ~/openlander-backups/$DATE
cp ~/.openlander/openlander.db ~/openlander-backups/$DATE/
cp ~/.openlander/config.json ~/openlander-backups/$DATE/
cp ~/.openlander/master.key ~/openlander-backups/$DATE/   # ⚠️ 분리 보관
# 1주일 이상 backup 정리
find ~/openlander-backups -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} \;
```

---

## 6. 에스컬레이션

본인 = solo dev = 에스컬레이션 X. 대신:

1. 발생 시각 + 증상 + 진단 결과 + 복구 시도 기록 → `docs/postmortem/YYYY-MM-DD-{slug}.md`
2. 1.0.x 백로그 (`docs/launchpad/1-0-x-backlog.md`)에 patch 항목 추가
3. 같은 장애 2회 발생 시 1.0.x P0로 격상

---

## 부록: 빠른 명령어

```bash
# 헬스
curl -s http://localhost:10114/health | jq '.status'

# 재시작
pm2 restart openlander

# 로그 실시간
pm2 logs openlander --lines 30

# DB 컴팩션 (월 1회)
sqlite3 ~/.openlander/openlander.db "VACUUM"

# 모든 컨테이너 stop (긴급)
docker ps -q --filter name=ol- | xargs -r docker stop

# OpenLander 완전 종료
pm2 stop openlander && docker ps -q --filter name=ol- | xargs -r docker stop
```
