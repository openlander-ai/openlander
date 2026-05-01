# Charter MIG: MigrationBoot_SMOKE

**Tier**: Zero-Tolerance
**예상 소요**: 30분
**격리**: 별도 `dataDir` + 별도 프로세스 (PM2 인스턴스 분리 또는 직접 실행)

## 1. Pre-condition

- (옵션 A) rc.5/rc.7 시기의 SQLite DB 스냅샷 보유 (사용자가 백업 보유 시)
- (옵션 B) rc.7 빌드를 새 dataDir로 1회 부팅 → 종료 → 그 dataDir로 rc.9 부팅 (스냅샷 없을 때)
- (옵션 C — 최소) 빈 dataDir로 rc.9 신규 부팅 (마이그레이션 0000~0005 순차 적용)
- 격리: `OPENLANDER_DATA_DIR=/tmp/qa-mig-{date}`로 설정, 기존 운영 DB 절대 건드리지 말 것

## 2. Scenarios

### MIG1_FRESH_BOOT_EMPTY_DB

빈 dataDir로 rc.9 부팅 → 60초 안에 `/api/setup/status` 200 응답 → `/login` 화면 진입 가능 → 로그인 후 `/overview`에 빈 상태 카드 노출.
**검증**: 콘솔/서버 로그에 `migration` 단어 5회 이상 + `error|FATAL` 0건. ai_usage_log CHECK 위반 0건.

### MIG2_RC7_TO_RC9_UPGRADE (옵션 A/B 보유 시)

rc.7 dataDir로 rc.9 부팅 → 마이그레이션 0003/0004/0005 순차 실행 → 기존 프로젝트 목록 정상 표시 → 각 프로젝트 status가 Docker 실제 상태와 reconcile.
**검증**: 부팅 30초 안에 `/api/projects` 200 + 기존 프로젝트 ≥ 1개 + `status='error'` 비율이 부팅 직후 대비 +20% 미만 (reconcile 차이 허용).

### MIG3_KILL_DURING_MIGRATION

부팅 시작 직후 5초 내 SIGTERM → 재시작 → 마이그레이션 idempotent 회복 → MIG1과 같은 PASS 기준.
**검증**: 두 번째 부팅 시 마이그레이션 로그가 첫 번째와 동일 (또는 "already applied" skip 메시지) + 데이터 손상 0건.

## 3. Output

`docs/launchpad/reports/2026-04-20/MIG-migration-boot-smoke.md` — 5섹션 형식.

특별 검증:

- 부팅 시간 (start → first 200): 초 단위 기록
- 마이그레이션 로그 grep: `applied|skipped|error` 라인 카운트
- DB 파일 크기 변화 (전/후)
- `sqlite3 dataDir/openlander.db ".tables"` 결과

## 4. Cleanup

```bash
pkill -f "OPENLANDER_DATA_DIR=/tmp/qa-mig"
rm -rf /tmp/qa-mig-*
```

## 5. Refs

- `src/db/index.ts:416-437` — DB open 시 마이그레이션 실행
- `src/db/migration.ts` — Drizzle Kit 통합
- `drizzle/0003_fix_check_constraints.sql`, `0004_restore_ai_usage_result_check.sql`, `0005_add_error_fields_to_ai_usage_log.sql`
- 핫스팟 #3 (`qa-webui-plan-v2-2026-04-20.md` §2)
