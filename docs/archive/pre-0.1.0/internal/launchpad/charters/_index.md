# QA Charter Index — v2 (Lean)

**상위 플랜**: `../qa-webui-plan-v2-2026-04-20.md`
**별도 트랙**: `../qa-unit-test-track-2026-04-20.md`

## 실행 순서

| 순서 | Charter                                                           | Tier | 추정 |
| ---- | ----------------------------------------------------------------- | ---- | ---- |
| 1    | [MIG MigrationBoot smoke](MIG-migration-boot-smoke.md)            | ZT   | 30분 |
| 2    | [C1 NewProjectFlow](C1-newproject-flow.md)                        | ZT   | 30분 |
| 3    | [C3 Recovery/Rollback/BG](C3-recovery-rollback-bluegreen.md)      | ZT   | 60분 |
| 4    | [C4 DangerActions/Services](C4-danger-actions-services.md)        | ZT   | 45분 |
| 5    | [C6 Settings/Auth/Security](C6-settings-auth-security.md)         | ZT   | 45분 |
| 6    | [C5 OpsCenter/Alerts](C5-opscenter-alerts.md)                     | ZT   | 60분 |
| 7    | [C2 ProjectDetail Timeline](C2-projectdetail-timeline-runtime.md) | BE   | 30분 |
| 8    | [C7 Dashboard/List smoke](C7-dashboard-list-smoke.md)             | BE   | 30분 |

**ZT 6개 합계: ~4.5시간** (Minimal Go)
**풀 8개 합계: ~5.5시간** (Full Go)

## 결과 저장

`../reports/{YYYY-MM-DD}/{charter-id}.md` 형식.

## Cleanup 검증 (모든 차터 종료 후)

```bash
docker ps -a --filter name=qa- | wc -l   # 1 (헤더만)
docker volume ls --filter name=qa- | wc -l   # 1
```
