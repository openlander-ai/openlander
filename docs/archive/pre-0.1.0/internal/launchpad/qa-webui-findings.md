# QA 웹 UI + 에이전트 통합 테스트 — 전용 결과 파일

## 라운드 7 (2026-04-03)

### 테스트 환경

- **서버:** OpenLander dev build, 포트 10114
- **테스트 프로젝트:** `qa-webui-dfpath` (mono-test git), `qa-webui-envkeep` (nginx:alpine)
- **테스트 서비스:** `qa-webui-pg` (PostgreSQL 17)

### 테스트 결과

| #                             | 테스트 영역                     | 도구/API                         | 결과          | 비고                                                        |
| ----------------------------- | ------------------------------- | -------------------------------- | ------------- | ----------------------------------------------------------- |
| **Dockerfile 경로 버그 재현** |                                 |                                  |               |                                                             |
| DF1                           | 초기 배포 (auto-detect)         | `deploy`                         | ✅ PASS       | api/Dockerfile 자동 선택                                    |
| DF2                           | config 변경 (worker/Dockerfile) | `update_project_config`          | ✅ PASS       | DB에 worker/Dockerfile 저장 확인                            |
| DF3                           | redeploy(no_cache) 후 빌드 로그 | `get_build_log`                  | 🔴 BUG        | 여전히 "Using api/Dockerfile"                               |
| DF4                           | **근본 원인 추적**              | DB + 소스코드                    | 🔴 ROOT CAUSE | `deploy_configs` 테이블의 snapshot이 DB 설정을 덮어씀       |
| **Env Vars 유지**             |                                 |                                  |               |                                                             |
| EK1                           | env vars 설정 (3개)             | `set_env_vars`                   | ✅ PASS       |                                                             |
| EK2                           | stop 후 env vars 조회           | `list_env_vars`                  | ✅ PASS       | 3개 보존                                                    |
| EK3                           | start 후 env vars 조회          | `list_env_vars`                  | ✅ PASS       | 3개 보존                                                    |
| **서비스 User 관리**          |                                 |                                  |               |                                                             |
| SU1                           | DB 생성 (app_db)                | `create_service_database`        | ✅ PASS       | connectionString 포함                                       |
| SU2                           | 유저 생성 (app_reader)          | `create_service_user`            | ✅ PASS       | 자동 비밀번호 + DB 권한                                     |
| SU3                           | 동시 유저 생성 (app_writer)     | `create_service_user`            | ⚠️ ISSUE      | "tuple concurrently updated" race condition. 재시도 시 성공 |
| SU4                           | 유저 목록 확인                  | `exec_service_container`         | ✅ PASS       | openlander + app_reader + app_writer                        |
| SU5                           | 중복 유저 생성                  | `create_service_user`            | ⚠️ ISSUE      | 에러 없이 성공 + 비밀번호 변경됨 (암묵적 ALTER)             |
| **System Stats 정확도**       |                                 |                                  |               |                                                             |
| SS1                           | CPU cores/model                 | `get_system_stats` vs sysctl     | ✅ PASS       | 10 cores, Apple M4 일치                                     |
| SS2                           | Load average                    | `get_system_stats` vs uptime     | ✅ PASS       | 측정 시점 차이 범위 내                                      |
| SS3                           | Disk total/free                 | `get_system_stats` vs diskutil   | ✅ PASS       | APFS Container 기준 245.1GB / 34.0GB 완벽 일치              |
| SS4                           | Memory total                    | `get_system_stats` vs hw.memsize | ✅ PASS       | 16GB (17179.9MB = 16×1024×1024/1000²)                       |

### 발견사항

#### 🔴 Critical — Dockerfile 경로 버그 근본 원인

**파일:** `src/pipeline/build-deploy-config.ts` line 75
**원인:** `buildDeployConfig()`에서 merge 순서:

```
mergedFromStored = { ...dbConfig, ...storedConfig.snapshot }
return { ...mergedFromStored, ...runtimeOverrides }
```

`deploy_configs` 테이블의 snapshot이 이전 배포의 `dockerfilePath: 'api/Dockerfile'`을 담고 있어, DB의 `projects.dockerfile_path = 'worker/Dockerfile'`을 덮어씀.

**수정 제안:** snapshot보다 DB 프로젝트 설정이 우선되도록 merge 순서 변경:

```typescript
// before (bug)
mergedFromStored = { ...dbConfig, ...storedConfig.snapshot };
// after (fix)
mergedFromStored = { ...storedConfig.snapshot, ...dbConfig };
```

또는 `update_project_config` 시 `deploy_configs`의 snapshot도 같이 업데이트.

#### 🟡 Warning

1. **동시 유저 생성 race condition** — 두 `create_service_user`를 거의 동시에 호출하면 PostgreSQL에서 `tuple concurrently updated` 에러. 재시도로 해결 가능하지만 serialization 필요.

2. **중복 유저 생성 시 암묵적 비밀번호 변경** — 이미 존재하는 유저명으로 `create_service_user`를 호출하면 에러 없이 새 비밀번호로 덮어쓰여진다. 기존 연결이 끊어질 수 있음.

#### ℹ️ Info

3. **System stats 정확도 우수** — CPU/Disk/Memory 모두 OS 실제 값과 일치. Disk는 APFS Container 기준(맞음), Memory는 `hw.memsize` 기준(맞음).

4. **Env vars stop/start 보존** — stop → start 사이클에서 env vars가 안전하게 보존됨.

### 정리 (Cleanup)

- ✅ `qa-webui-dfpath` — purge 완료
- ✅ `qa-webui-envkeep` — purge 완료
- ✅ `qa-webui-pg` 서비스 — removed
- ✅ 잔여 qa-webui-\* 리소스: 0

### 누적 커버리지 (라운드 1~7)

| 카테고리                    | 테스트 수 | PASS    | FAIL/BUG | ISSUE |
| --------------------------- | --------- | ------- | -------- | ----- |
| 프로젝트 CRUD               | 12        | 12      | —        | —     |
| 배포 플로우                 | 17        | 14      | 3        | —     |
| 서비스 관리                 | 23        | 20      | —        | 3     |
| 인프라 (볼륨/시크릿/도메인) | 10        | 10      | —        | —     |
| 모니터링/시스템             | 13        | 13      | —        | —     |
| GitHub 연동                 | 4         | 4       | —        | —     |
| Preview/Share               | 5         | 5       | —        | —     |
| 빌드 디버그                 | 2         | 2       | —        | —     |
| 백업/복원                   | 10        | 8       | 2        | —     |
| MinIO 버킷                  | 8         | 7       | —        | 1     |
| Env Vars                    | 8         | 7       | 1        | —     |
| 웹훅                        | 5         | 4       | —        | 1     |
| 글로벌 시크릿               | 6         | 6       | —        | —     |
| **합계**                    | **123**   | **112** | **6**    | **5** |

### 우선 수정 필요 항목 (Critical)

1. 🔴 **deploy_configs snapshot이 DB 설정 덮어쓰기** — `build-deploy-config.ts` merge 순서 (근본 원인 확인됨)
2. 🔴 MCP ↔ HTTP env vars 이원화 (라운드 6에서 발견)
3. 🔴 Redis 백업 시 BGSAVE 미호출 (라운드 5에서 발견)

---

## 라운드 6 (2026-04-03)

### 테스트 환경

- **서버:** OpenLander dev build, 포트 10114
- **MCP:** 전 도구 정상
- **테스트 프로젝트:** `qa-webui-envtest` (nginx:alpine), `qa-webui-config` (mono-test git)
- **테스트 서비스:** `qa-webui-mongo` (MongoDB 8)

### 테스트 결과

| #                            | 테스트 영역                      | 도구/API                       | 결과     | 비고                                                                                     |
| ---------------------------- | -------------------------------- | ------------------------------ | -------- | ---------------------------------------------------------------------------------------- |
| **MongoDB 서비스**           |                                  |                                |          |                                                                                          |
| MG1                          | MongoDB 생성 (template)          | `create_service`               | ✅ PASS  | mongo:8, healthy, 자동 자격증명                                                          |
| MG2                          | CRUD (대량 insert 200건)         | `exec_service_container`       | ✅ PASS  | 200 docs + unique index + multikey index                                                 |
| MG3                          | 백업 (2 collections, 203 docs)   | `backup_service`               | ✅ PASS  | 504KB tar.gz                                                                             |
| MG4                          | 복원 (drop 후)                   | `restore_service`              | ✅ PASS  | 2 collections + 203 docs + 3 indexes 전부 복구                                           |
| MG5                          | stop/start                       | `stop_service`/`start_service` | ✅ PASS  |                                                                                          |
| MG6                          | stop 상태 health 표시            | `get_service_status`           | ⚠️ ISSUE | status=stopped인데 health=healthy로 표시                                                 |
| **MinIO 파일 업로드**        |                                  |                                |          |                                                                                          |
| MI1                          | 버킷 생성 + 파일 3개 업로드      | `exec_service_container`       | ✅ PASS  | 19B text + 14B json + 100KB binary                                                       |
| MI2                          | 파일 목록/다운로드               | mc ls/cat                      | ✅ PASS  | recursive listing, 내용 검증                                                             |
| MI3                          | 비어있지 않은 버킷 삭제          | `delete_bucket`                | ⚠️ ISSUE | `--force` 없어 실패. MCP 도구에 force 옵션 부재                                          |
| MI4                          | exec로 `mc rb --force` 우회      | `exec_service_container`       | ✅ PASS  |                                                                                          |
| **대량 Env Vars**            |                                  |                                |          |                                                                                          |
| EV1                          | 50개 env vars 설정 (성능)        | HTTP POST                      | ✅ PASS  | **21ms** — 매우 빠름                                                                     |
| EV2                          | 50개 env vars 조회 (성능)        | HTTP GET                       | ✅ PASS  | **9ms**                                                                                  |
| EV3                          | MCP vs HTTP env vars 일치        | `list_env_vars` vs HTTP        | 🔴 ISSUE | MCP는 프로젝트 레벨만 반환, HTTP API는 environment 레벨 포함. 50개가 MCP에서 보이지 않음 |
| **프로젝트 Config 업데이트** |                                  |                                |          |                                                                                          |
| CF1                          | Dockerfile 경로 변경             | `update_project_config`        | ✅ PASS  | DB에 저장됨                                                                              |
| CF2                          | 변경 후 redeploy 반영            | `redeploy_project`             | 🔴 BUG   | DB에 `web/Dockerfile`이지만 빌드는 여전히 `api/Dockerfile` 사용                          |
| CF3                          | no_cache 재배포로도 반영 안 됨   | `redeploy(no_cache)`           | 🔴 BUG   | 동일 — 빌드 파이프라인이 DB의 dockerfile_path를 무시                                     |
| **에러 상태 정확도**         |                                  |                                |          |                                                                                          |
| ER1                          | API ↔ Docker 상태 27개 전수 비교 | HTTP + docker inspect          | ✅ PASS  | **27/27 일치, 0 mismatches**                                                             |

### 발견사항

#### 🔴 Critical

1. **`update_project_config` dockerfile_path 적용 안 됨** — DB에 `web/Dockerfile`이 저장되었음을 확인했으나, `redeploy` 및 `redeploy(no_cache)` 모두 여전히 자동 감지된 `api/Dockerfile`을 사용. 빌드 파이프라인이 `deploy_configs`나 `projects` 테이블의 값을 참조하지 않는 것으로 추정.
   - **재현:** `deploy(mono-test)` → api/Dockerfile 자동 선택 → `update_project_config(web/Dockerfile)` → `redeploy(no_cache)` → 빌드 로그에 여전히 "Using api/Dockerfile"

2. **MCP ↔ HTTP API env vars 불일치** — MCP `set_env_vars`는 프로젝트 레벨, HTTP API `POST /environments/:envId/env`는 environment 레벨에 저장. MCP `list_env_vars`는 프로젝트 레벨만 반환하여 HTTP로 설정한 env vars가 보이지 않음. 웹 UI에서 설정한 환경변수가 MCP 에이전트에서 확인 불가.

#### 🟡 Warning

3. **서비스 stopped인데 health=healthy** — `stop_service` 후 status=stopped이지만 health=healthy로 표시. health 필드가 리셋되지 않음.

4. **`delete_bucket` force 옵션 부재** — 파일이 있는 버킷 삭제 불가. `exec_service_container`로 `mc rb --force` 우회 필요.

#### ℹ️ Info

5. **Env vars 성능** — 50개 설정 21ms, 조회 9ms. 대량 환경변수도 성능 문제 없음.

6. **에러 상태 정확도** — 27개 프로젝트 전체 API↔Docker 상태 100% 일치. running/error/stopped 모두 정확.

7. **MongoDB 전체 라이프사이클** — template 생성, 대량 데이터, 인덱스, 백업/복원, stop/start 모두 정상.

### 정리 (Cleanup)

- ✅ `qa-webui-envtest` — purge 완료
- ✅ `qa-webui-config` — purge 완료
- ✅ `qa-webui-mongo` 서비스 — removed
- ✅ MinIO `qa-files` 버킷 — force deleted
- ✅ 잔여 qa-webui-\* 리소스: 0

### 누적 커버리지 (라운드 1~6)

| 카테고리                    | 테스트 수 | PASS   | FAIL/BUG | ISSUE |
| --------------------------- | --------- | ------ | -------- | ----- |
| 프로젝트 CRUD               | 12        | 12     | —        | —     |
| 배포 플로우                 | 13        | 11     | 2        | —     |
| 서비스 관리                 | 18        | 17     | —        | 1     |
| 인프라 (볼륨/시크릿/도메인) | 10        | 10     | —        | —     |
| 모니터링/시스템             | 9         | 9      | —        | —     |
| GitHub 연동                 | 4         | 4      | —        | —     |
| Preview/Share               | 5         | 5      | —        | —     |
| 빌드 디버그                 | 2         | 2      | —        | —     |
| 백업/복원                   | 10        | 8      | 2        | —     |
| MinIO 버킷                  | 8         | 7      | —        | 1     |
| Env Vars                    | 5         | 4      | 1        | —     |
| 웹훅                        | 5         | 4      | —        | 1     |
| 글로벌 시크릿               | 6         | 6      | —        | —     |
| **합계**                    | **107**   | **99** | **5**    | **3** |

### 우선 수정 필요 항목 (Critical)

1. `update_project_config` dockerfile_path 반영 안 됨 (build pipeline)
2. MCP ↔ HTTP env vars 이원화 (project-level vs environment-level)
3. Redis 백업 시 BGSAVE 미호출 (라운드 5에서 발견)

---

## 라운드 5 (2026-04-03)

### 테스트 환경

- **서버:** OpenLander dev build, 포트 10114
- **MCP:** 전 도구 정상 동작
- **테스트 프로젝트:** `qa-webui-main` (nginx:alpine 이미지)
- **테스트 서비스:** `qa-webui-pg` (PostgreSQL 17), `qa-webui-redis` (Redis 8)

### 테스트 결과

| #                        | 테스트 영역                         | 도구/API                   | 결과     | 비고                                                    |
| ------------------------ | ----------------------------------- | -------------------------- | -------- | ------------------------------------------------------- |
| **서비스 백업/복원**     |                                     |                            |          |                                                         |
| S1                       | PG 백업 (스키마+데이터+인덱스)      | `backup_service`           | ✅ PASS  | 6.5MB tar.gz                                            |
| S2                       | PG 복원 후 데이터 검증              | `restore_service`          | ✅ PASS  | 5행 + `idx_products_category` 인덱스 복구               |
| S3                       | Redis 백업 (BGSAVE 없이)            | `backup_service`           | 🔴 FAIL  | 94 bytes — dump.rdb 미포함, 빈 디렉토리만               |
| S4                       | Redis 복원 (빈 백업)                | `restore_service`          | 🔴 FAIL  | DBSIZE=0, 데이터 복구 안 됨                             |
| S5                       | Redis 수동 BGSAVE 후 백업           | `backup_service`           | ✅ PASS  | 252 bytes — dump.rdb 포함                               |
| S6                       | Redis 복원 (BGSAVE 백업)            | `restore_service`          | ✅ PASS  | 2 keys 복구 (hello, world)                              |
| **MinIO 버킷 CRUD**      |                                     |                            |          |                                                         |
| B1                       | 버킷 다중 생성                      | `create_bucket` ×3         | ✅ PASS  | qa-uploads, qa-backups, qa-temp                         |
| B2                       | 버킷 목록                           | `list_buckets`             | ✅ PASS  | 4개 (기존 1 + 신규 3)                                   |
| B3                       | 중복 버킷 생성                      | `create_bucket`            | ✅ PASS  | 적절한 에러: "you already own it"                       |
| B4                       | 버킷 삭제                           | `delete_bucket` ×3         | ✅ PASS  |                                                         |
| B5                       | 존재하지 않는 버킷 삭제             | `delete_bucket`            | ✅ PASS  | 적절한 에러: "does not exist"                           |
| **아카이브/복원 사이클** |                                     |                            |          |                                                         |
| A1                       | env vars + webhook 설정 후 아카이브 | `archive_project`          | ✅ PASS  |                                                         |
| A2                       | 아카이브 상태 env vars 보존         | `list_env_vars`            | ✅ PASS  | 5개 모두 보존                                           |
| A3                       | 아카이브 상태 webhook 보존          | `get_webhook_config`       | ✅ PASS  | enabled=true 상태 유지                                  |
| A4                       | 아카이브 상태 배포 이력 보존        | `get_deploy_history`       | ✅ PASS  | 2건 보존                                                |
| A5                       | 언아카이브                          | `unarchive_project`        | ✅ PASS  | 새 포트(10047) 할당                                     |
| A6                       | 언아카이브 후 재배포                | `redeploy_project`         | ✅ PASS  | 4초, running                                            |
| **웹훅 관리**            |                                     |                            |          |                                                         |
| W1                       | 웹훅 활성화                         | `enable_webhook`           | ✅ PASS  | ID + secret + path 반환                                 |
| W2                       | 웹훅 비활성화                       | `disable_webhook`          | ✅ PASS  | enabled=false 전환                                      |
| W3                       | 웹훅 재활성화                       | `enable_webhook`           | ⚠️ ISSUE | 새 ID + 새 secret 생성됨 (기존 GitHub 설정과 호환 깨짐) |
| W4                       | 웹훅 서명 검증                      | HTTP POST (invalid)        | ✅ PASS  | "Signature verification failed"                         |
| **글로벌 시크릿**        |                                     |                            |          |                                                         |
| G1                       | 시크릿 생성 (일반값)                | `set_global_secret`        | ✅ PASS  |                                                         |
| G2                       | 시크릿 생성 (특수문자)              | `set_global_secret`        | ✅ PASS  | `p@$$w0rd!#%^&*()` 등 저장 성공                         |
| G3                       | 시크릿 생성 (긴 JWT)                | `set_global_secret`        | ✅ PASS  | 200+ chars                                              |
| G4                       | 시크릿 목록 (마스킹)                | `list_global_secrets`      | ✅ PASS  | 앞3자+\*\*\*\*+뒤4자 패턴                               |
| G5                       | 시크릿 업데이트 (덮어쓰기)          | `set_global_secret`        | ✅ PASS  | 값 + description 모두 업데이트                          |
| G6                       | 시크릿 삭제                         | `DELETE /api/secrets/:key` | ✅ PASS  |                                                         |

### 발견사항

#### 🔴 Critical

1. **Redis 백업 시 BGSAVE 미실행** — `backup_service`가 Redis 볼륨을 단순 복사하지만, Redis는 비동기 RDB 스냅샷 방식이라 `BGSAVE`를 먼저 실행하지 않으면 `/data/dump.rdb`가 존재하지 않을 수 있음. 결과: **빈 백업 → 복원 시 데이터 손실**.
   - 재현: 새 Redis 서비스 → 데이터 입력 → `backup_service` → `FLUSHALL` → `restore_service` → DBSIZE=0
   - 수정 제안: `backup_service`에서 Redis 타입 서비스 감지 시 `docker exec redis-cli BGSAVE` + `LASTSAVE` 대기 후 볼륨 복사

#### 🟡 Warning

2. **웹훅 re-enable 시 새 secret 발급** — `disable_webhook` → `enable_webhook`하면 ID와 secret이 모두 변경됨. GitHub에서 webhook secret을 재설정해야 하므로 운영 시 주의 필요. 대안: enable이 기존 비활성 webhook을 재활성화하는 방식이면 더 안전.

3. **purge 후 같은 이름으로 재생성 시 env vars 잔여** — 프로젝트를 purge(영구 삭제) 후 동일 이름으로 재생성하면 이전의 env vars가 남아있음. `env_vars` 테이블이 project name 기반으로 보이며, purge가 env_vars를 정리하지 않는 것으로 추정.

#### ℹ️ Info

4. **세션 토큰 만료** — 테스트 중 세션 만료 발생 (이전 토큰 → 새 토큰으로 전환). MCP 도구는 자체 인증이라 영향 없지만, HTTP API 직접 호출 시 주의.

5. **Redis 백업 크기** — BGSAVE 후 백업이 252 bytes로 매우 작음 (2 keys). PG는 동일 수준 데이터에 6.5MB. Redis 백업의 효율성이 훨씬 높음.

6. **글로벌 시크릿 마스킹** — 앞 3자 + `****` + 뒤 4자 패턴으로 일관됨. 특수문자 포함 값도 마스킹 정상 동작.

### 정리 (Cleanup)

- ✅ `qa-webui-main` — purge 완료
- ✅ `qa-webui-pg` 서비스 — removed
- ✅ `qa-webui-redis` 서비스 — removed
- ✅ MinIO 버킷 3개 — deleted
- ✅ 글로벌 시크릿 5개 — deleted
- ✅ 잔여 리소스: 0

### 요약

| 카테고리         | 테스트 수 | PASS   | FAIL  | ISSUE |
| ---------------- | --------- | ------ | ----- | ----- |
| 서비스 백업/복원 | 6         | 4      | 2     | —     |
| MinIO 버킷       | 5         | 5      | —     | —     |
| 아카이브/복원    | 6         | 6      | —     | —     |
| 웹훅 관리        | 4         | 3      | —     | 1     |
| 글로벌 시크릿    | 6         | 6      | —     | —     |
| **합계**         | **27**    | **24** | **2** | **1** |

### 한 줄 평

> **Redis 백업에 BGSAVE 미호출이 Critical 버그로 확인됨.** BGSAVE를 수동으로 실행하면 복원은 정상 동작하므로, `backup_service`에 BGSAVE 전처리 추가가 필수. 나머지 PostgreSQL 백업/복원, MinIO 버킷 CRUD, 아카이브 사이클, 글로벌 시크릿은 안정적.
