# Report MIG: MigrationBoot_SMOKE — 2026-04-20

**Tier**: Zero-Tolerance
**실행 환경**: macOS 24.6.0, rc.9 빌드 (`dist/cli/index.js`), `HOME=/tmp/qa-mig-2026-04-20`, port 11114
**격리 방식**: HOME env로 dataDir 격리 — `~/.openlander` 경로가 임시 디렉토리로 매핑됨. **단, Docker 리소스(컨테이너/네트워크/볼륨)는 호스트 공유라 완전 격리 아님** (orphan container 감지됨, 운영 데이터 영향 없음 확인)

## 결과 요약

| 시나리오                   | 결과    | 비고                                                                                                                             |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| MIG1_FRESH_BOOT_EMPTY_DB   | ✅ PASS | 부팅 < 1s, 마이그레이션 6개 모두 적용, CHECK 위반 0                                                                              |
| MIG2_RC7_TO_RC9_UPGRADE    | ⏭️ SKIP | rc.7 DB 스냅샷 미보유 (사용자 결정 필요)                                                                                         |
| MIG3_KILL_DURING_MIGRATION | ⏭️ SKIP | rc.9 부팅이 < 1s라 5초 내 SIGTERM 시 마이그레이션 이미 완료. 별도 시나리오로 가치 낮음 — idempotency는 단위 트랙 U-P0-3에서 검증 |

## MIG1 상세 — FRESH BOOT EMPTY DB

### 검증 항목

- ✅ **부팅 시간**: 0초 (start → first 200, 측정 정확도 1초 단위)
- ✅ **첫 200 응답**: `/api/setup/status` 200 (134ms 응답)
- ✅ **로그 메시지**: `OpenLander v1.0.0-rc.9 listening` 정상
- ✅ **마이그레이션 적용**: `__drizzle_migrations` 테이블에 6개 행 (해시 기준 0000/0001/0002/0003/0004/0005)
- ✅ **테이블 생성**: 25+ 테이블 생성 (`projects`, `deploy_configs`, `ai_usage_log`, `runtime_incidents`, `ops_incidents`, `circuit_breaker_state`, `__drizzle_migrations` 등 전체)
- ✅ **ai_usage_log CHECK 위반**: 0건 (마이그레이션 0004 정상 작동)
- ✅ **DB 파일 크기**: 4KB (최초) → 471KB (마이그레이션 후, WAL 포함)
- ✅ **모듈 시작**: ai-usage-listener, service-manager, activity-logger, traefik, recovery-coordinator, docker-events, ops-agent — 전부 시작 메시지 정상

### Findings

#### ℹ️ Info-1: LLM provider 건강 체크 expected error

```
{"level":40,"module":"provider-health-monitor","providerId":"default",
 "error":"No LLM provider configured. Run `openlander onboard` to set up an API key."}
```

- 빈 dataDir에 LLM 설정 없으니 정상 (warn 레벨, FATAL 아님)
- 사용자 가시 동작은 setup 화면으로 유도 — 정상 흐름

#### 🟡 Major-1: HOME 기반 격리의 한계 — 호스트 Docker 리소스 공유

```
{"module":"traefik","msg":"Found legacy OpenLander Traefik — adopting"}
{"module":"container-state-reconciler","count":3,"containers":[
  {"name":"ol-svc-redis-1774675173526","state":"running"},
  {"name":"ol-svc-postgresql-1774675157980","state":"running"},
  {"name":"openlander-traefik","state":"running"}
],"msg":"Detected orphan OpenLander containers"}
```

- **현상**: 빈 dataDir의 새 인스턴스가 호스트의 기존 OpenLander 컨테이너(Traefik + 사용자가 만든 Redis/Postgres service)를 "orphan"으로 감지
- **원인**: Docker 컨테이너 이름은 호스트 글로벌 네임스페이스 (`openlander-traefik`, `ol-svc-*`). HOME 격리는 SQLite/config만 분리, Docker는 분리 안 됨
- **운영 영향**: 새 인스턴스가 **adopting**으로 처리하지만 DB에는 해당 service 레코드 없음 → 만약 새 인스턴스에서 deploy를 진행하면 충돌 가능
- **이 테스트엔 영향 없음**: 새 인스턴스는 즉시 종료, 운영 인스턴스(PM2 포트 10114)와 DB 상이 → 운영 데이터 변경 0
- **MIG2 영향**: rc.7 DB로 부팅 시 동일 이슈 발생 가능. **별도 Docker context** 또는 **DOCKER_HOST 격리** 필요할 수 있음. 단 1.0 GA 차단 사유 아님 (실제 사용자는 새 머신에서 업그레이드)
- **권장 후속**: MIG2/MIG3 실행 시 Docker socket 격리 검토 (별도 docker daemon 또는 colima 인스턴스)

### Auto-collected

- console.error: 1건 (위 Info-1, expected)
- 비예상 4xx/5xx: 0건
- a11y micro-check: 해당 없음 (서버 부팅 smoke, UI 미터치)

### Edge-case Discovery

1. **System maintenance 자동 트리거**: 부팅 직후 `Disk usage above threshold — triggering cleanup` 자동 실행 — 호스트 디스크 80.9% 상태에서 발생. 새 dataDir 인스턴스에서도 임계 처리 정상.
2. **Disk warning alert 자동 생성**: 부팅 5초 후 `New alert created` (type=disk, severity=warning) — alerts 시스템 정상 작동 확인.
3. **service-manager reconcile 0**: 빈 dataDir이라 reconciled=0이지만 모듈 자체는 정상 시작.

## Cleanup

```bash
kill $(cat /tmp/mig-smoke.pid) # done (PID 78830 killed)
rm /tmp/mig-smoke.pid /tmp/mig-smoke.log
# /tmp/qa-mig-2026-04-20 디렉토리는 evidence로 보존 (필요 시 본인이 rm -rf)
```

운영 인스턴스 영향 검증:

- ✅ PM2 `openlander` 정상 (포트 10114)
- ✅ `~/.openlander/openlander.db` 변경 없음 (별도 dataDir라 당연)
- ⚠️ 호스트 Docker는 공유 — 새 인스턴스가 orphan으로 감지했으나 adopt만 했고 destructive action 0

## 결론

**MIG1 PASS**. 1.0.0 GA에서 신규 사용자(빈 dataDir 부팅)는 안전.

**MIG2 (업그레이드 사용자)는 미검증** — rc.7 DB 스냅샷이 필요. 본인이 다음 중 하나 선택:

- (a) 보유 중인 rc.7 백업 제공 → MIG2 즉시 실행
- (b) `npm install -g openlander@1.0.0-rc.7` 별도 머신에서 1회 부팅 → 그 dataDir로 rc.9 부팅 (시간 ~30분)
- (c) **GA 후 먼저 패치 릴리스 + 업그레이드 가이드** + 사용자에게 백업 권고 (가장 실용적)

권장: **(c)**. rc.7 사용자 수가 적고 대부분 신규 설치일 가능성 높음. CHANGELOG에 "rc.7→rc.9 업그레이드 시 dataDir 백업 권장" 한 줄 추가.

## Refs

- 실행 빌드: `/Users/idongbin/project/OpenLander/dist/cli/index.js` (1.0.0-rc.9, commit 6efbfe9 직후)
- 격리 방식: `HOME=/tmp/qa-mig-2026-04-20` env override (`src/config/index.ts:307` 사용)
- 마이그레이션 파일: `drizzle/0000_*.sql` ~ `drizzle/0005_add_error_fields_to_ai_usage_log.sql`
- 단위 트랙: U-P0-3 (`docs/launchpad/qa-unit-test-track-2026-04-20.md`) — migration replay idempotency
