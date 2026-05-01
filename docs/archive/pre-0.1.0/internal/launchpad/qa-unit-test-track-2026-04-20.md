# OpenLander 1.0.0 — Unit/Integration Test Track

**작성일**: 2026-04-20
**상위 문서**: `qa-webui-plan-v2-2026-04-20.md`
**목적**: UI Playwright 차터로 잡을 수 **없는** 영역. Codex 리뷰가 명시: UI에서 검증 시도하면 _false sense of safety_. 별도 단위/통합 테스트로 닫아야 함.
**1.0 GA 게이트**: 본 트랙의 P0 항목은 GA 차단 사유.

---

## 1. 왜 별도 트랙인가

| 영역                                  | UI로 검증 시도하면 발생하는 문제                                                                                             | 올바른 검증 위치                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| compose ResourceLimits                | UI는 "설정 저장"만 노출, 실제 `HostConfig.Memory/CpuShares` 값을 보여주지 않음. UI PASS여도 silent failure                   | `runComposeService` 단위 테스트 + `docker inspect` 통합 테스트 |
| NDJSON event ordering                 | `/api/ops/activity?follow=true`는 2초 간격 snapshot flush. UI에서 `container:die → recovery:started` 정확한 순서 확인 불가능 | hook(`useOpsCenterData`) 단위 + route 통합                     |
| Docker abstraction 회귀               | 컨테이너가 "떠 있는지"는 UI로 보이지만 healthcheck/labels/restartPolicy 등 옵션은 못 봄                                      | `docker.test.ts`에 service-adapter 6종 옵션 검증 추가          |
| RecoveryCoordinator 부분 실패 swallow | 외곽 try/catch가 partial failure를 숨김(`recovery-coordinator.ts:326-340`). UI에선 그냥 "정상 보임"                          | mock fault injection 단위 테스트                               |
| Drizzle migration legacy bridge       | UI는 마이그레이션 후 화면만 봄. 마이그레이션 자체의 idempotency / 부분 실패 회복 검증 불가                                   | migration replay 단위 테스트                                   |

---

## 2. P0 (1.0 GA 차단 사유)

### U-P0-1. compose ResourceLimits 적용 검증 (또는 UI 비활성)

- **현황**: `src/pipeline/docker/container.ts:120` TODO — `runComposeService`에 `HostConfig.Memory/CpuShares` 미적용. 사용자가 Settings에서 limits 설정해도 compose 컨테이너는 무제한
- **할 일** (둘 중 하나):
  - **(a) 1.0 안에 구현**: `runComposeService`에 `RunComposeServiceOptions.memoryLimitBytes/cpuShares` 추가, 모든 호출처 wire, 통합 테스트로 `docker inspect` 결과 검증
  - **(b) 1.0에선 명시적 비지원**: `ResourceLimitsPanel.tsx`에서 compose 프로젝트엔 panel 비활성 + "compose는 v1.1.0에서 지원" 메시지. UI 차터 C6에 검증 시나리오 추가
- **권장**: (b) — GA 직전 새 코드 risk 회피
- **Owner**: TBD
- **검증**: Playwright + docker inspect 통합 테스트 1개

### U-P0-2. RecoveryCoordinator partial-failure 가시화

- **현황**: `recovery-coordinator.ts:326-340, 393-408`의 try/catch 경로가 (B) OpsAgent enqueue, (C) PSM transition, (D) `recovery:started` emit 중 일부 실패해도 D를 발사. 결과: status='running'인데 recovery 이벤트가 흐름
- **할 일**: 단위 테스트 — db.getProject가 BUSY 던지도록 mock → handleContainerFailure 호출 → 후속 emit이 차단되는지 OR 명확한 `recovery:partial-failure` 이벤트가 나오는지
- **검증 코드**: `test/monitor/recovery-coordinator.partial-failure.test.ts` (신규)

### U-P0-3. Migration 0003/0004/0005 idempotency + rc.7 시기 데이터 회복

- **현황**: 0004는 ai_usage_log CHECK 제약 복구. 기존 행 중 새 enum에 안 맞는 값 있으면 startup fail 가능
- **할 일**: rc.7 데이터 시드 fixture로 마이그레이션 replay 테스트. 0003 → 0004 → 0005 순차 + 중간 강제 종료 → 재시작 시 idempotent 회복
- **검증 코드**: `test/db/migration-replay.test.ts` (신규)

### U-P0-4. Deploy lock vs Recovery race

- **현황**: `RecoveryCoordinator.handleDeployFailed`는 deploy lock 체크 안 함(`recovery-coordinator.ts:148-179` eligibility gate에 lock 항목 없음). deploy 직후 lock release → recovery 시작 → 사용자 redeploy 동시 진행 가능
- **할 일**: 단위 테스트 — deploy lock 보유 상태에서 container:die 발사 → recovery가 lock을 보고 skip하는지 확인. 안 하면 코드 fix
- **검증 코드**: `test/monitor/recovery-deploy-lock.test.ts` (신규)

---

## 3. P1 (Should — 1.0.x 패치 가능)

### U-P1-1. NDJSON ordering 단위 테스트

- **할 일**: `useOpsCenterData` hook 단위 테스트로 backfill→sentinel→live 전환, dedupe, reconnect 로직 검증
- **현재 상태**: hook 단위 테스트 일부 있음(`web/src/lib/__tests__/timeline-agent-events.test.ts`), backfill sentinel 경로 미커버

### U-P1-2. Docker service-adapter 6종 healthcheck/restartPolicy 검증

- **할 일**: `test/docker.test.ts` 확장 — postgres/mysql/mongo/redis/minio/rabbitmq 각각 createContainer 호출 시 HostConfig/HealthCheck/Labels 옵션 검증
- **사유**: Docker abstraction 전면 리팩터(`c700bca` 외 4건) 후 service-adapters 회귀 발생 가능

### U-P1-3. Stream cancel/abort tracking 정확성

- **할 일**: `tracking-middleware.ts` (`35f3bd6` 신규) 단위 테스트 — abort 시 `ai_usage_log` 1건만 정확히 기록 (double-write/누락 0)

### U-P1-4. ProjectStateManager bypass fallback 호출 케이스 차단

- **할 일**: `recovery-coordinator.ts:11-18`의 `createFallbackStateManager`가 호출되는 모든 경로 식별 + 단위 테스트로 PSM 정상 주입 시 fallback 0회 호출 검증

---

## 4. 실행 순서

1. **U-P0-1 결정**: (a) 구현 vs (b) UI 비활성. 즉시 결정 필요. 권장 (b)
2. **U-P0-1(b) 구현 + UI 차터 C6에 검증 시나리오 추가** — 30분 코드 + 차터 1줄
3. **U-P0-2~4 단위 테스트 신규 작성** — 각 1~2시간, 병렬 가능 (다른 파일)
4. **U-P1 작업** — GA 후 1.0.1에서 진행 가능

---

## 5. Owner / Tracking

| ID      | 권장 진행 방식                                                      | 추정               |
| ------- | ------------------------------------------------------------------- | ------------------ |
| U-P0-1  | 사용자 결정 → executor agent                                        | 30분(b) / 2시간(a) |
| U-P0-2  | tracer agent로 partial-failure 시퀀스 추적 → executor로 테스트 작성 | 2시간              |
| U-P0-3  | rc.7 DB 스냅샷 확보 후 executor                                     | 2~3시간            |
| U-P0-4  | tracer + executor                                                   | 1~2시간            |
| U-P1-\* | 1.0.x 마일스톤                                                      | —                  |

---

## 6. UI 트랙(`qa-webui-plan-v2`)과의 관계

- **UI 트랙이 실패 발견 시**: 본 트랙으로 isolation 위임 (UI에서 보이는 증상의 진짜 원인을 단위로 reproduce)
- **본 트랙이 PASS여도 UI 트랙 통과 별도 필요** (사용자 가시 동작 확인)
- **본 트랙 P0 4건 중 1건이라도 미완 → 1.0 GA 차단**

본 트랙은 *코드 변경*을 동반하므로 UI 트랙(주로 검증)과 다른 owner/리뷰 사이클이 적합.
