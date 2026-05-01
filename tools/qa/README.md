# OpenLander QA Tooling

운영 도구 모음. 개발/dist에 포함되지 않음.

## soak-test.sh — 24h+ 장시간 부하 테스트

격리된 임시 인스턴스 (별도 port + 별도 dataDir + 별도 비번) 을 띄워서 운영자 데이터를 건드리지 않고 mixed workload 를 24h 돌림.

### 검증하는 것

- 메모리 누수 (PM2 RSS 증가율)
- DB 사이즈 / activity_log row 폭증
- Docker 컨테이너 / volume 누수 (qa-soak-\* 정리 안 됨 = leak)
- Open file descriptor / SSE listener 누수
- Per-project lock TTL 정상 만료 (30분 후 stale 정리)
- LLM unreachable cooldown 정상 reset
- Recovering watchdog 60분 timeout 작동
- 마이그레이션 0006 backfill 후 race 없음

### 사용법

```bash
# 시작 (기본: 24h, 5분 cycle, port 10116)
./tools/qa/soak-test.sh start

# 진행 상태 확인
./tools/qa/soak-test.sh status

# 1 cycle 만 (테스트용 — 별도 인스턴스 미리 떠 있어야 함)
./tools/qa/soak-test.sh once <project-id>

# 중단 + cleanup (qa-soak-* 컨테이너 / volume 강제 삭제)
./tools/qa/soak-test.sh stop
```

### 환경 변수

| 변수                | 기본값                 | 설명                      |
| ------------------- | ---------------------- | ------------------------- |
| `SOAK_PORT`         | `10116`                | 격리 인스턴스 listen 포트 |
| `SOAK_HOME`         | `$TMPDIR/ol-soak-{ts}` | 격리 dataDir              |
| `SOAK_PASSWORD`     | `soak-test-pwd`        | setup-password 값         |
| `SOAK_CYCLE_SEC`    | `300`                  | cycle 간격 (5분)          |
| `SOAK_DURATION_SEC` | `86400`                | 총 실행 시간 (24h)        |
| `SEED_REPO`         | `test-no-dockerfile`   | seed 프로젝트 git URL     |

### Cycle 구성

- 매 5분: `redeploy` seed + `create+purge` 일회용 프로젝트 + `/api/ops/activity` GET
- 매 30분 (6 cycle): `stop+start` seed (recovery exercise)
- 매 cycle 끝: `soak-metrics.sh` 호출 → JSON 한 줄 metrics.jsonl 기록

### 출력

`tools/qa/soak-logs/run-{YYYYMMDDTHHMMSS}/` 안에:

- `instance.log` — 격리 인스턴스 stdout/stderr
- `loop.log` — cycle 진행 로그
- `metrics.jsonl` — cycle 별 metric 한 줄
- `pid` — loop 프로세스 PID
- `instance.pid` — OpenLander 인스턴스 PID
- `seed.id` — seed 프로젝트 id
- `home` — 격리 dataDir 경로

### 24h 후 분석

```bash
RUN=$(ls -1d tools/qa/soak-logs/run-* | tail -1)

# memory growth
jq -s 'map(.pm2MemMb) | {start: .[0], end: .[-1], delta: (.[-1] - .[0])}' "$RUN/metrics.jsonl"

# restart count growth
jq -s 'map(.pm2RestartTotal) | {start: .[0], end: .[-1], delta: (.[-1] - .[0])}' "$RUN/metrics.jsonl"

# disk growth
jq -s 'map(.dbSizeKb) | {start: .[0], end: .[-1], delta: (.[-1] - .[0])}' "$RUN/metrics.jsonl"

# activity row count growth
jq -s 'map(.activityRows) | {start: .[0], end: .[-1], delta: (.[-1] - .[0])}' "$RUN/metrics.jsonl"

# leftover qa-soak-* 컨테이너 (정리 안 된 것)
docker ps -a --filter name=qa-soak- | head
```

### 합격 기준 (1.0 GA soak)

| 메트릭                    | 정상             | 위험                  |
| ------------------------- | ---------------- | --------------------- |
| pm2MemMb 24h delta        | < 200MB          | > 500MB (메모리 누수) |
| pm2RestartTotal 24h delta | 0–2              | 5+ (crash loop)       |
| pm2UnstableRestarts       | 0                | 1+ (즉시 No-Go)       |
| dbSizeKb 24h delta        | < 100MB          | > 1GB (활동 log 폭증) |
| projectsRecovering avg    | < 1              | > 2 (watchdog 동작 X) |
| qaContainers (잔존)       | 0 (cleanup 정상) | 5+ (leak)             |
| opsLatencyMs avg          | < 500ms          | > 2s (이슈)           |

### 안전

- 격리 dataDir + 격리 port → 운영 인스턴스 (10114) 영향 없음
- Docker 컨테이너 prefix `qa-soak-` 강제 → `stop` 시 자동 cleanup
- 본인 hotdeal-tracker 등에 절대 영향 없음
