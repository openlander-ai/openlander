# Recovery Architecture Redesign

> 2026-04-06 사고 대응 + 구조적 재설계.
> 이 문서는 `recovery-architecture-findings-2026-04-06.md`의 후속이며, 구체적 설계를 담는다.

---

## 배경: 2026-04-06 사고

PostmortemGenerator의 무한 LLM 호출 (~15K+ calls)로 비용 폭주. 긴급 대응으로 비활성화했지만, 조사 결과 5개의 연결된 구조 문제가 드러났다.

| #   | 문제                                                | 근본 원인                                                                                                    |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | 설정에서 AI 끄면 멈춰야 하는데 계속 호출됨          | Hot-reload 없음. HealthMonitor/OpsAgent가 startup 시 받은 provider 참조를 계속 사용                          |
| 2   | 프로젝트를 정지/아카이브/삭제해도 이벤트 계속 발생  | stop: 컨테이너 미삭제 (label 유지). archive: DB 갱신 전 Docker 이벤트 발생 (race). EventBus 리스너 정리 없음 |
| 3   | AI가 백그라운드에서 비용을 쓰는데 UI에서 알 수 없음 | agent:event 발행하지만 소비자 없음. NotificationCenter에 AI 이벤트 없음. 실시간 비용 카운터 없음             |
| 4   | 복구 실패해도 무한 재시도                           | PostmortemGenerator 재시도 제한 없음. auto-recovery(3) × OpsAgent(5) = 최대 15 LLM 호출                      |
| 5   | PostmortemGenerator 동작 시점 불명확                | 현재 완전 비활성화. 재활성화 조건 미정의                                                                     |

**공통 근본 원인**: 중앙 통제 계층(Coordination Layer)이 없다. 각 컴포넌트가 독립적으로 EventBus에 구독하고, 자기만의 guard만 체크하며, 서로의 존재를 모른다.

---

## 설계 원칙

```
1. Single Owner — 모든 AI 호출은 RecoveryCoordinator를 통해서만 발생한다.
2. Fail-Stop — 1회 자동 복구 워크플로 실패 시 즉시 중단 + 사용자 통보. 무한 재시도 없음.
3. Explicit Intent — operator-initiated stop/archive/delete는 어떤 복구 경로에도 진입하지 않는다.
4. Always Visible — AI가 돈을 쓰면 사용자가 실시간으로 볼 수 있어야 한다.
5. Survive Restart — coordinator 상태(incident, circuit breaker, budget)는 DB에 영속한다.
```

---

## 새 아키텍처

### 전체 흐름

```
┌─────────────────────────────────────────────────────────────┐
│                     DETECTION LAYER                          │
│                                                              │
│  DockerEventListener        HealthMonitor                    │
│  ─ container:died           ─ health:degraded (NEW)          │
│  ─ container:oom            ─ health:recovered               │
│                                                              │
│  DeployPipeline                                              │
│  ─ deploy:failed                                             │
│  ─ compose:failed                                            │
│                                                              │
│  ⚠️ Detection Layer는 raw event만 발행.                      │
│     LLM 호출 절대 금지. recovery 판단 절대 금지.             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  RECOVERY COORDINATOR (NEW)                   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 1. Eligibility Gate                                  │    │
│  │    ✓ project.status === 'running'?                   │    │
│  │    ✓ project.archived_at === null?                   │    │
│  │    ✓ 설정에서 AI 활성화?  (매번 현재 config 읽기)    │    │
│  │    ✓ operator suppression window 아닌가?             │    │
│  │    ✓ 글로벌 LLM 예산 초과 아닌가?                   │    │
│  │    ✓ 해당 프로젝트 circuit breaker 닫혀 있나?        │    │
│  │    ✓ 동일 incident 이미 활성 중 아닌가? (dedup)      │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│                    gate 통과                                  │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 2. Incident 생성 (fingerprint 기반 dedup)            │    │
│  │    - fingerprint = hash(projectId + errorSignature)  │    │
│  │    - TTL: 30분 이내 동일 fingerprint → 기존 incident │    │
│  │    - 프로젝트당 1개 active incident만 허용           │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 3. Lane 라우팅                                       │    │
│  │    - deploy session active → Deployment Recovery     │    │
│  │    - 그 외 (service live) → Operational Recovery     │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 4. Visibility Events (NDJSON activity stream)        │    │
│  │    - recovery:started  (incident 생성됨)             │    │
│  │    - recovery:progress (deterministic step 진행)     │    │
│  │    - ai:invoked        (LLM 호출 시작, model, est)   │    │
│  │    - ai:progress       (토큰 카운트, tool 호출)      │    │
│  │    - ai:completed      (최종 비용, 결과)             │    │
│  │    - recovery:resolved (복구 성공)                   │    │
│  │    - recovery:stopped  (복구 중단, 사용자 개입 필요) │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 5. 글로벌 제한 집행                                  │    │
│  │    - 시간당 최대 LLM 복구 호출 수 (기본: 10)        │    │
│  │    - 프로젝트당 동시 1 incident                      │    │
│  │    - 프로젝트 circuit breaker (3 failures → open)    │    │
│  │    - 전체 상태 DB 영속 (프로세스 재시작 보호)        │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────┬──────────────────────┬───────────────────────┘
               │                      │
   ┌───────────▼──────────┐  ┌────────▼──────────────────┐
   │ Deployment Recovery  │  │ Operational Recovery      │
   │ Executor             │  │ Executor                  │
   │                      │  │                           │
   │ 담당:                │  │ 담당:                     │
   │ - deploy:failed      │  │ - container:died          │
   │ - compose:failed     │  │ - container:oom           │
   │ - build 실패         │  │ - health:degraded         │
   │                      │  │ - restart loop            │
   │ 워크플로:            │  │                           │
   │ 1. recipe 매칭       │  │ 워크플로:                 │
   │ 2. recipe 있으면 적용│  │ 1. container restart      │
   │    → redeploy        │  │ 2. 30초 health check      │
   │ 3. recipe 없으면     │  │ 3. 실패 시 LLM diagnosis  │
   │    LLM 1회 호출      │  │    (1회만, 결과 기록)     │
   │ 4. 성공/실패 보고    │  │ 4. rollback 시도          │
   │                      │  │ 5. 성공/실패 보고         │
   │ ⚠️ LLM 최대 1회     │  │                           │
   │ ⚠️ 전체 워크플로     │  │ ⚠️ LLM 최대 1회          │
   │    실패 → 즉시 중단  │  │ ⚠️ 전체 워크플로          │
   │    + 사용자 통보     │  │    실패 → 즉시 중단       │
   └──────────────────────┘  │    + 사용자 통보          │
                              └────────────────────────────┘
               │                      │
               └──────────┬───────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    POST-INCIDENT LAYER                        │
│                                                              │
│  PostmortemGenerator                                         │
│  - v1: 수동 전용 (MCP tool: generate_postmortem)             │
│  - v2: 자동 (복구 성공 후 5분 안정 확인 → 큐잉)             │
│        프로젝트당 24시간 1회 제한                             │
│        project.status === 'running' 재확인                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 상세 설계

### 1. RecoveryCoordinator

**위치**: `src/monitor/recovery-coordinator.ts` (NEW)

**역할**: 유일한 recovery 이벤트 구독자. 모든 AI 호출의 단일 진입점.

```typescript
class RecoveryCoordinator {
  // 이벤트 구독 (유일한 구독자)
  private subscriptions: Set<() => void>;

  // Eligibility Gate
  private checkEligibility(event: RecoveryEvent): EligibilityResult;

  // Incident 관리
  private findOrCreateIncident(event: RecoveryEvent): Incident;

  // Lane 라우팅
  private routeToExecutor(incident: Incident): void;

  // 글로벌 제한
  private isGlobalBudgetExceeded(): boolean;
  private isProjectCircuitOpen(projectId: string): boolean;

  // Operator suppression
  private isOperatorSuppressed(projectId: string): boolean;
  private suppressProject(projectId: string, durationMs: number): void;
}
```

**핵심**: config를 캐시하지 않는다. 매 operation마다 `ctx.config`에서 현재값을 읽는다.

```typescript
// ❌ 기존: startup 시 캐시
constructor(aiProvider: ModelProxy | null) {
  this.aiProvider = aiProvider; // 설정 변경해도 반영 안 됨
}

// ✅ 새 설계: 매번 현재 config 읽기
private isAiEnabled(): boolean {
  return this.ctx.config.ai.autoRecovery.enabled;
}
```

### 2. Eligibility Gate

Gate 통과 조건 (ALL must pass):

```typescript
interface EligibilityResult {
  eligible: boolean;
  reason?: string; // 거부 사유 (로깅 + UI 표시용)
}

function checkEligibility(projectId: string, event: RecoveryEvent): EligibilityResult {
  const project = db.getProject(projectId);

  // 1. 프로젝트 상태 확인
  if (!project) return { eligible: false, reason: 'project_not_found' };
  if (project.status !== 'running' && project.status !== 'recovering')
    return { eligible: false, reason: `status_${project.status}` };
  if (project.archived_at) return { eligible: false, reason: 'archived' };

  // 2. AI 설정 확인 (매번 현재 config 읽기)
  if (!ctx.config.ai.autoRecovery.enabled) return { eligible: false, reason: 'ai_disabled' };

  // 3. Operator suppression window
  if (isOperatorSuppressed(projectId)) return { eligible: false, reason: 'operator_suppressed' };

  // 4. 글로벌 LLM 예산
  if (isGlobalBudgetExceeded()) return { eligible: false, reason: 'global_budget_exceeded' };

  // 5. Circuit breaker
  if (db.isCircuitBreakerOpen(projectId))
    return { eligible: false, reason: 'circuit_breaker_open' };

  // 6. 중복 incident
  if (db.hasActiveIncident(projectId)) return { eligible: false, reason: 'incident_active' };

  return { eligible: true };
}
```

**Gate 거부 시**: `recovery:blocked` 이벤트 발행 → UI Activity Feed에 표시.
사용자가 "왜 복구 안 하지?"를 알 수 있게.

### 3. 프로젝트 상태 전환 소유권 (CRITICAL)

**문제**: 현재 `health.ts`와 `app.ts`가 crash 감지 시 `project.status = 'error'`로 변경한다.
Gate가 `running`만 허용하면, 복구해야 할 사고를 gate가 막아버린다.

**해결**: 상태 전환 소유권을 명확히 분리한다.

```
상태 전환 소유자:

  Detection Layer (health.ts, docker-events.ts):
    → 상태 변경 금지. 이벤트만 발행.
    → health.ts의 db.updateProject(status='error') 제거
    → app.ts의 인라인 status='error' 변경 제거

  RecoveryCoordinator:
    → recovery 시작: status → 'recovering' (NEW)
    → recovery 성공: status → 'running'
    → recovery 실패: status → 'error'

  사용자 action (lifecycle):
    → stop:    status → 'stopped'
    → archive: archived_at 설정
    → delete:  DB 삭제
    → start:   status → 'running' (컨테이너 재생성 후)

  Deploy Pipeline:
    → 배포 시작: status → 'building'
    → 배포 성공: status → 'running'
    → 배포 실패: status는 변경하지 않음 (Coordinator가 recovery 판단)
```

**상태 전환 다이어그램**:

```
                    ┌─────────┐
         start      │         │  deploy success
        ┌──────────→│ running │←────────────────┐
        │           │         │                  │
        │           └────┬────┘                  │
        │                │                       │
        │      crash/failure detected            │
        │      (Coordinator가 gate 통과)          │
        │                │                       │
        │           ┌────▼──────┐          ┌─────┴─────┐
        │           │recovering │──성공──→│  running   │
        │           └────┬──────┘          └───────────┘
        │                │
        │          실패 (circuit open)
        │                │
   ┌────┴────┐     ┌────▼────┐
   │ stopped │     │  error  │
   └─────────┘     └─────────┘
   (사용자 stop)   (Coordinator만 설정)
```

**Gate 조건**: `project.status === 'running'`만 새 recovery 워크플로 시작 가능.
`recovering`은 이미 active recovery가 있으므로 `already_active`로 차단됨.

### 4. Operator Suppression Window

프로젝트에 대한 의도적 조작(stop/archive/redeploy) 시 일시적으로 recovery를 차단:

```typescript
// stop/archive/delete 호출 시
coordinator.suppressProject(projectId, 60_000); // 60초 suppression

// 이 window 동안 해당 project의 Docker 이벤트는 gate에서 거부됨
// → race condition 해결: archive 중 Docker die 이벤트가 와도 무시
```

**in-memory only**: `Map<projectId, expiresAt>`로 충분. 60초 단명 데이터에 DB 불필요. 프로세스 재시작 시 초기화돼도 안전 (Docker도 같이 재시작하므로 이벤트 원천이 없음). circuit breaker + incident만 DB 영속.

### 4. Incident Fingerprinting & Dedup

```typescript
interface RecoveryIncident {
  id: string;
  project_id: string;
  fingerprint: string; // hash(projectId + normalizedError)
  status: 'active' | 'resolved' | 'stopped';
  created_at: number;
  resolved_at: number | null;
  lane: 'deployment' | 'operational';
  workflow_result: 'pending' | 'recovered' | 'failed';
  llm_calls_made: number; // 이 incident 내 LLM 호출 수
}

// 동일 fingerprint + 30분 이내 → 기존 incident 재사용 (새 워크플로 안 만듦)
// 프로젝트당 active incident 1개만 허용
```

### 5. 복구 워크플로: "1회 시도 후 중단" 정의

**"1회 복구 시도"** = Coordinator가 관리하는 **하나의 incident 워크플로**:

```
Deployment Recovery 워크플로:
  1. [Deterministic] recipe 매칭 → 적용 → redeploy
  2. [LLM] recipe 없거나 recipe 실패 → LLM 1회 호출 → 결과 적용 → redeploy
  3. 여기서 실패 → STOP. circuit breaker open. 사용자에게 알림.

Operational Recovery 워크플로:
  1. [Deterministic] container restart
  2. [Health Check] 30초 대기 → health OK → resolved
  3. [LLM] health 실패 → LLM diagnosis 1회 → deterministic fix 시도
  4. [Rollback] 여전히 실패 → rollback 시도
  5. 여기서 실패 → STOP. circuit breaker open. 사용자에게 알림.

공통 규칙:
  - LLM 호출은 워크플로 전체에서 최대 1회
  - deterministic action은 허용 (restart, recipe, rollback)
  - 워크플로 실패 → 재시도 없음, 즉시 중단
  - circuit breaker open → 사용자가 직접 reset할 때까지 해당 프로젝트 자동 복구 차단

LLM 호출 중 중단 (multi-tool step):
  - agent.chatStream()은 tool을 여러 번 호출할 수 있음 (MAX_TOOL_STEPS=10)
  - Executor는 각 tool_call 이벤트 콜백에서 coordinator.shouldContinue(projectId)를 체크
  - shouldContinue = project.status === 'running' && !suppressed && !budgetExceeded
  - false면 chatStream 조기 종료 (더 이상 tool 실행 안 함)
```

### 6. Project Stop = Container 삭제

```
기존 stop:
  docker.stopContainer() → DB status='stopped'
  ❌ 컨테이너 존재 (label 유지) → Docker 이벤트 계속 발생

새 stop:
  coordinator.suppressProject(projectId, 60s)  // suppression window
  → docker.stopContainer()
  → docker.removeContainer()                    // 컨테이너 삭제
  → DB status='stopped'
  ❌ 컨테이너 없음 → Docker 이벤트 발생 불가

  ※ volume, network, config, image는 유지
  ※ start 시 컨테이너 재생성 (기존 image 사용)
```

**pause/resume이 필요하면**: 별도 feature로 명시적 구현. stop과 혼동 금지.

### 7. 이벤트 모델 정리

#### 변경 사항

```
삭제할 이벤트:
  - deploy:failed(step='run')에서 runtime crash 표현 ← 도메인 오염의 원인

새로 분리:
  - runtime:crash       (container:died의 상위 개념, coordinator가 발행)
  - health:degraded     (기존 deploy:failed(step='run') 대체)
  - health:recovered

recovery 이벤트 정리:
  - recovery:started    (incident 생성, lane 결정)
  - recovery:progress   (워크플로 단계 진행)
  - recovery:resolved   (복구 성공)
  - recovery:stopped    (복구 중단, 사용자 개입 필요)
  - recovery:blocked    (gate에서 거부됨 + 사유)

AI 가시성 이벤트 (NEW):
  - ai:invoked          (LLM 호출 시작 — model, estimated tokens)
  - ai:progress         (streaming 진행 — accumulated tokens, tool calls)
  - ai:completed        (LLM 호출 완료 — final tokens, cost, result)
```

#### HealthMonitor 변경

```typescript
// ❌ 기존: runtime 문제를 deploy:failed로 발행
eventBus.emit('deploy:failed', { projectId, error, step: 'run' });

// ✅ 새 설계: 전용 이벤트
eventBus.emit('health:degraded', { projectId, consecutiveFailures, lastError });
```

### 8. UI 가시성

기존 NDJSON activity stream (`/api/activity?follow=true`)을 확장:

```
Activity Feed에 추가되는 카드 타입:

┌─ recovery:started ─────────────────────────────────────┐
│ 🔄 프로젝트 "myapp" 자동 복구 시작                     │
│ Lane: Operational | Trigger: container crash            │
│ 12:05:30                                                │
└─────────────────────────────────────────────────────────┘

┌─ ai:invoked ───────────────────────────────────────────┐
│ 🤖 AI 분석 시작 (claude-sonnet-4-20250514)                      │
│ 예상 비용: ~$0.08 | 토큰: ~16K                         │
│ 12:05:35                                                │
└─────────────────────────────────────────────────────────┘

┌─ ai:completed ─────────────────────────────────────────┐
│ 🤖 AI 분석 완료                                        │
│ 비용: $0.12 | 토큰: 22K | 소요: 8.3초                  │
│ 결과: container restart 권장                            │
│ 12:05:43                                                │
└─────────────────────────────────────────────────────────┘

┌─ recovery:stopped ─────────────────────────────────────┐
│ ⛔ 프로젝트 "myapp" 자동 복구 중단                     │
│ 사유: 워크플로 실패 — 사용자 확인 필요                  │
│ 총 비용: $0.12 | Circuit breaker 활성화됨               │
│ 12:06:15                                                │
└─────────────────────────────────────────────────────────┘

┌─ recovery:blocked ─────────────────────────────────────┐
│ 🚫 프로젝트 "myapp" 복구 차단됨                        │
│ 사유: AI 설정 비활성화                                  │
│ 12:07:00                                                │
└─────────────────────────────────────────────────────────┘
```

NotificationCenter에도 `recovery:started`, `recovery:stopped` 추가.

### 9. PostmortemGenerator

**v1 (즉시)**: 수동 전용

```
- MCP tool: generate_postmortem(projectId)
- Web API: POST /api/projects/:id/postmortem
- 사용자가 명시적으로 요청할 때만 실행
- Coordinator의 글로벌 LLM 예산에 포함
```

**v2 (추후)**: 조건부 자동

```
- 복구 성공(recovery:resolved) 후 5분 안정 확인
- project.status === 'running' 재확인
- 프로젝트당 24시간 1회 제한
- 글로벌 LLM 예산 내에서만 실행
- Coordinator를 통해서만 LLM 호출
```

---

## 삭제/변경 대상

### 삭제

| 대상                                             | 사유                                                        |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `app.ts` 인라인 restart 경로                     | recovery owner가 아님. Coordinator로 수렴                   |
| `app.ts`의 crash 시 `status='error'` 직접 변경   | Detection Layer status 변경 금지. Coordinator만 status 변경 |
| `health.ts`의 `db.updateProject(status='error')` | Detection Layer status 변경 금지. Coordinator만 status 변경 |
| `health.ts`의 `deploy:failed(step='run')` 발행   | 도메인 오염. `health:degraded`로 대체                       |
| `health.ts`의 `diagnoseRuntimeCrash()` 직접 호출 | Detection Layer에서 LLM 호출 금지. Coordinator가 판단       |

### 변경

| 대상               | 변경 내용                                                                   |
| ------------------ | --------------------------------------------------------------------------- |
| `auto-recovery.ts` | Coordinator의 Deployment Recovery Executor로 전환. 직접 EventBus 구독 제거  |
| `ops-agent.ts`     | Coordinator의 Operational Recovery Executor로 전환. 직접 EventBus 구독 제거 |
| `ops-recovery.ts`  | RecoveryPipeline → Operational Executor의 내부 구현으로 축소                |
| `docker-events.ts` | 변경 없음 (이미 Detection Layer 역할)                                       |
| `health.ts`        | `deploy:failed` → `health:degraded` 이벤트로 변경. LLM 호출 제거            |
| `postmortem.ts`    | start()의 이벤트 구독 완전 제거. 수동 호출 인터페이스만 유지                |
| `lifecycle.ts`     | `stop` → container 삭제 추가. suppression window 연동                       |

---

## 동작 정의

### 프로젝트 상태별 AI Ops 동작

Coordinator Eligibility Gate의 판단 기준. **모든 AI 동작은 이 매트릭스를 따른다.**

| 프로젝트 상태 | Docker 컨테이너   | 자동 복구                | LLM 호출      | Health 모니터링 | PostmortemGenerator | 비고                                                        |
| ------------- | ----------------- | ------------------------ | ------------- | --------------- | ------------------- | ----------------------------------------------------------- |
| `running`     | 존재              | ✅ 허용 (새 워크플로)    | ✅ 허용       | ✅ 활성         | 수동 허용           | 정상 운영                                                   |
| `recovering`  | 존재              | ❌ 차단 (already_active) | 진행 중 1회만 | ✅ 활성         | ❌ 차단             | Coordinator가 recovery 중. 새 워크플로 차단                 |
| `building`    | 없거나 생성 중    | ❌ 차단                  | ❌ 차단       | ❌ 비활성       | ❌ 차단             | 배포 파이프라인이 제어 중                                   |
| `stopped`     | **없음** (삭제됨) | ❌ 차단                  | ❌ 차단       | ❌ 비활성       | ❌ 차단             | 컨테이너 없으므로 이벤트 자체가 불가                        |
| `error`       | **없음** (삭제됨) | ❌ 차단                  | ❌ 차단       | ❌ 비활성       | ❌ 차단             | Coordinator가 recovery 실패 시 설정. 사용자가 직접 redeploy |
| `archived`    | **없음** (삭제됨) | ❌ 차단                  | ❌ 차단       | ❌ 비활성       | ❌ 차단             | unarchive 후 redeploy 필요                                  |
| 삭제됨        | **없음**          | N/A                      | N/A           | N/A             | N/A                 | DB에서 프로젝트 자체가 없음                                 |

**핵심**: `running`만 새 recovery 워크플로 시작 가능. `recovering`은 이미 진행 중이므로 중복 차단. 그 외 상태는 AI 동작 일체 없음.

**상태 전환 소유권**: Detection Layer는 status 변경 금지. Coordinator와 사용자 action만 status 변경 가능. (상세: 상세 설계 §3)

### LLM 설정별 동작

| 설정 상태                                         | 자동 복구             | Operational Recovery            | Postmortem | 비고                             |
| ------------------------------------------------- | --------------------- | ------------------------------- | ---------- | -------------------------------- |
| API key 미설정 (provider 없음)                    | recipe만 (LLM 없이)   | restart + rollback만 (LLM 없이) | ❌ 불가    | deterministic 동작만 허용        |
| `config.ai.autoRecovery.enabled = false`          | ❌ 전체 차단          | ❌ 전체 차단                    | ❌ 차단    | recovery:blocked 발행            |
| `config.ai.operationalMonitoring.enabled = false` | ✅ 배포 복구 허용     | ❌ 차단                         | ❌ 차단    | 배포 실패만 복구                 |
| 글로벌 LLM 시간당 한도 초과                       | recipe만 (LLM 없이)   | restart + rollback만 (LLM 없이) | ❌ 차단    | deterministic은 계속, LLM만 차단 |
| circuit breaker open (프로젝트)                   | ❌ 해당 프로젝트 차단 | ❌ 해당 프로젝트 차단           | ❌ 차단    | 사용자가 reset할 때까지          |

**핵심**: LLM이 없어도 deterministic 복구(recipe, restart, rollback)는 동작한다. LLM은 "추가 지능"이지 필수가 아님.

### 프로젝트 Lifecycle 전환 시 동작

각 operator action이 AI Ops에 미치는 영향:

#### Stop (running → stopped)

```
1. coordinator.suppressProject(projectId, 60s)   // 즉시 suppression
2. docker.stopContainer(containerId)              // 컨테이너 정지
3. docker.removeContainer(containerId)            // 컨테이너 삭제 ← NEW
4. db.updateProject(status='stopped')             // DB 갱신
5. eventBus.emit('container:stop', {...})          // lifecycle 이벤트

결과:
- 컨테이너 없음 → Docker 이벤트 발생 불가
- suppression window → stop 중 발생한 die 이벤트도 gate에서 차단
- 진행 중이던 recovery 있으면 → 완료까지 대기 (강제 중단 안 함)
  단, recovery 내부에서 다음 LLM 호출 전 project status 재확인 → 중단
```

#### Archive (running → archived)

```
1. coordinator.suppressProject(projectId, 60s)   // 즉시 suppression
2. db.archiveProject(projectId)                   // DB 먼저 갱신 ← 순서 변경
3. docker.stopContainer(containerId)              // 컨테이너 정지
4. docker.removeContainer(containerId)            // 컨테이너 삭제
5. docker.removeImage(imageTag)                   // 이미지 삭제
6. eventBus.emit('project:archive', {...})

결과:
- DB 먼저 갱신 → race condition 해결 (die 이벤트 와도 archived 상태)
- suppression window → 이중 보호
```

#### Delete/Purge (any → 삭제)

```
1. coordinator.suppressProject(projectId, 60s)
2. docker.stopContainer() + removeContainer()     // 모든 관련 컨테이너
3. docker.removeProjectNetwork()
4. db.deleteProject(projectId)                     // DB에서 삭제

결과:
- 프로젝트 자체가 없음 → Eligibility Gate에서 project_not_found로 차단
```

#### Redeploy (running → building → running)

```
1. coordinator.suppressProject(projectId, 120s)   // 더 긴 suppression (빌드 시간)
2. db.updateProject(status='building')
3. [배포 파이프라인 실행]
4. 성공 → db.updateProject(status='running')       // recovery 다시 가능
   실패 → deploy:failed 발행 → Coordinator → Deployment Recovery

결과:
- building 상태 동안 operational recovery 차단
- 배포 실패 시에만 deployment recovery 진입
```

#### Start (stopped → running)

```
1. [컨테이너 재생성 + 시작]                        // 기존 이미지 사용
2. db.updateProject(status='running')
3. 이 시점부터 Coordinator가 recovery 허용

결과:
- 새 컨테이너이므로 이전 상태의 이벤트 없음
- running 상태 전환 후 정상적으로 모니터링 시작
```

### 동시성 / 엣지 케이스

| 시나리오                               | 동작                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| **deploy 중 container crash**          | building 상태 → gate 차단. 배포 파이프라인이 자체 에러 핸들링                     |
| **recovery 중 사용자가 stop**          | suppression 등록 → 진행 중 recovery는 각 tool step에서 shouldContinue 체크 → 중단 |
| **recovery 중 사용자가 redeploy**      | suppression 등록 → 진행 중 recovery 중단 → 새 배포 시작                           |
| **recovery 중 같은 프로젝트 또 crash** | activeRecoveries에 이미 있음 → gate 차단 (already_active)                         |
| **2개 프로젝트 동시 crash**            | 각각 독립 처리. 글로벌 LLM 예산만 공유                                            |
| **recovery 성공 직후 바로 또 crash**   | circuit breaker가 아직 안 열렸으면 → 새 워크플로 허용 (1회)                       |
| **프로세스 재시작**                    | in-memory activeRecoveries/suppressions 초기화됨 → 안전 (Docker도 재시작)         |
| **LLM API 타임아웃/에러**              | 워크플로 실패로 처리 → circuit breaker open → recovery:stopped                    |
| **LLM 호출 중 config 변경 (AI off)**   | 진행 중 chatStream은 다음 tool step에서 shouldContinue → false → 조기 종료        |

---

## 마이그레이션 계획

### Phase 1a: Coordinator + 안전장치 (1-2일) — 세션 1

**목표**: 사고 재발 차단. 기존 코드 구조 최소 변경.

1. `RecoveryCoordinator` 생성 (~200-300줄) — Eligibility Gate + suppression + 글로벌 LLM 예산
2. `lifecycle.ts`: stop/archive → 컨테이너 삭제 + suppression window + archive DB-first 순서 변경
3. `health.ts`: `deploy:failed(step=run)` → `health:degraded` 변경, LLM 직접 호출 제거
4. `postmortem.ts`: EventBus 구독 완전 제거, 수동 호출 인터페이스만 유지
5. `events/index.ts`: 새 이벤트 타입 추가 (`health:degraded`, `recovery:blocked`, `recovery:stopped`)
6. `app.ts`: Coordinator 생성 + EventBus 구독 연결

**이 시점에서 Coordinator는 gate만 수행하고, 통과 시 기존 auto-recovery/OpsAgent를 그대로 호출.**
기존 guard는 아직 남겨둠 (이중 보호). 충돌 없음 — Coordinator가 먼저 거부하므로.

### Phase 1b: Executor 전환 + 가시성 (1-2일) — 세션 2

**목표**: 기존 recovery 로직을 Executor로 전환. 직접 EventBus 구독 제거.

1. auto-recovery → `DeploymentRecoveryExecutor`로 리팩토링 (EventBus 구독 제거, guard 제거)
2. OpsAgent recovery → `OperationalRecoveryExecutor`로 리팩토링 (recovery 이벤트 구독 제거)
3. Executor에 `shouldContinue(projectId)` 체크 추가 (각 tool step마다)
4. `app.ts` 인라인 restart 경로 제거
5. Activity Feed에 `recovery:blocked`, `recovery:stopped` 카드 추가
6. 기존 개별 guard 제거 (Coordinator가 완전 대체)
7. 테스트: coordinator + lifecycle integration test

### Phase 2: 확장 (안정화 후)

- incident fingerprinting + dedup
- ai:invoked/completed visibility events
- NotificationCenter 연동
- PostmortemGenerator 조건부 자동 (v2)
- `container:missing` → Coordinator 라우팅 (현재 OpsAgent 직접 구독으로 Eligibility Gate 우회 중)

---

## 검증 기준

각 항목에 검증 방법과 기대 결과를 명시.

### Phase 1a 검증

| #   | 검증 항목                          | 검증 방법                                                                                      | 기대 결과                                                                          |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | stop 후 Docker 이벤트 미발생       | 프로젝트 stop → `docker ps -a --filter label=openlander.project={name}`                        | 컨테이너 없음 (출력 0건)                                                           |
| 2   | archive 후 Docker 이벤트 미발생    | 프로젝트 archive → 동일 docker ps 확인                                                         | 컨테이너 없음                                                                      |
| 3   | Gate: non-running 상태 차단        | `test/recovery-coordinator.test.ts`: status='stopped' 프로젝트에 container:died 이벤트 주입    | `checkEligibility` 반환: `{ eligible: false, reason: 'status_stopped' }`           |
| 4   | Gate: AI 설정 비활성화 차단        | `test/recovery-coordinator.test.ts`: config.ai.autoRecovery.enabled=false 상태에서 이벤트 주입 | `{ eligible: false, reason: 'ai_disabled' }` + `recovery:blocked` 이벤트 발행 확인 |
| 5   | Gate: 글로벌 LLM 예산 차단         | `test/recovery-coordinator.test.ts`: llmCallTimestamps를 한도까지 채운 후 이벤트 주입          | `{ eligible: false, reason: 'global_budget_exceeded' }`                            |
| 6   | health.ts 이벤트 변경              | `test/health.test.ts`: crash loop 감지 시 발행 이벤트 확인                                     | `health:degraded` 발행. `deploy:failed(step=run)` 미발행                           |
| 7   | health.ts status 변경 제거         | `test/health.test.ts`: crash 감지 후 project.status 확인                                       | status 변경 없음 (여전히 'running')                                                |
| 8   | PostmortemGenerator 자동 호출 없음 | `test/postmortem.test.ts`: recovery:success 이벤트 발행 후 대기                                | LLM 호출 없음. agent.chat 미호출 확인 (vi.fn mock)                                 |
| 9   | 상태 전환: recovering              | `test/recovery-coordinator.test.ts`: gate 통과 → executor 호출 전 status 확인                  | project.status === 'recovering'                                                    |
| 10  | 상태 전환: recovery 성공           | `test/recovery-coordinator.test.ts`: executor 성공 반환 후 status 확인                         | project.status === 'running'                                                       |
| 11  | 상태 전환: recovery 실패           | `test/recovery-coordinator.test.ts`: executor 실패 반환 후 status + circuit breaker 확인       | project.status === 'error', circuit breaker open                                   |

### Phase 1b 검증

| #   | 검증 항목                        | 검증 방법                                                                                         | 기대 결과                                                    |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 12  | auto-recovery EventBus 구독 제거 | `grep -r "eventBus.on" src/pipeline/auto-recovery.ts`                                             | 0건 (직접 구독 없음)                                         |
| 13  | OpsAgent recovery 구독 제거      | `grep -r "deploy:failed\|container:die\|container:oom" src/monitor/ops-agent.ts` 중 recovery 관련 | recovery 이벤트 구독 0건 (alerting/digest 구독은 유지)       |
| 14  | shouldContinue 동작              | `test/recovery-coordinator.test.ts`: executor 실행 중 project.status를 'stopped'로 변경           | shouldContinue → false, chatStream 조기 종료 확인            |
| 15  | 중복 recovery 차단               | `test/recovery-coordinator.test.ts`: 같은 projectId로 동시 2개 이벤트 주입                        | 첫 번째만 처리, 두 번째는 `already_active`로 차단            |
| 16  | Activity Feed 표시               | `curl /api/activity?follow=true` 스트림에서 recovery:blocked 이벤트 확인                          | NDJSON 라인에 `type: 'recovery:blocked'`, `reason` 필드 포함 |
| 17  | CI 전체 통과                     | `npm run lint && npm run typecheck && npm test && npm run build`                                  | exit code 0                                                  |

---

## 관련 문서

- `docs/launchpad/recovery-architecture-findings-2026-04-06.md` — 선행 분석
- `docs/planning/ai-architecture-vision.md` — 장기 AI 아키텍처 (Phase 1-4)
