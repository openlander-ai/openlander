# Recovery Architecture Findings — 2026-04-06

> 목적: 최근 조사에서 확인된 auto-recovery / OpsAgent / HealthMonitor 관련 구조 문제를 한 문서에 정리한다.
> 범위: 현재 구현 기준 문제 요약, 영향도, 아키텍처 결론, 긴급 우선순위.

---

## TL;DR

현재 문제의 핵심은 **복구 오케스트레이션이 분산되어 있고, deployment recovery와 operational recovery의 경계가 흐려져 있으며, 그 결과 큰 LLM 호출이 중복 발생할 수 있는 구조**라는 점이다.

가장 중요한 포인트는 다음 네 가지다.

1. 장애 1건에 대해 여러 recovery path가 동시에 반응할 수 있다.
2. runtime 장애가 `deploy:failed(step='run')`로 다시 흘러가며 도메인 경계를 오염시킨다.
3. auto-recovery 1회 호출 자체가 매우 무거워서, 중복 호출 시 비용이 빠르게 증가한다.
4. `stopProject` 같은 intentional stop은 recovery lane에 절대 들어가지 않도록 더 명시적 규칙이 필요하다.

---

## 확인된 문제점

### 1. 복구 경로 중복

현재 복구 반응 지점이 여러 군데에 분산되어 있다.

- `setupAutoRecovery()`
- `OpsAgent -> RecoveryPipeline`
- `HealthMonitor`
- `app.ts`의 인라인 restart / alert 경로

결과:

- restart 중복 가능
- diagnosis 중복 가능
- 같은 장애에 대한 recovery action 중복 가능

---

### 2. LLM 호출 중복 가능성

runtime 장애 시 LLM이 여러 경로에서 호출될 수 있다.

- `auto-recovery`의 `agent.chatStream()`
- `ops-recovery`의 `generateDiagnosis()`
- `health.ts`의 `diagnoseRuntimeCrash()`

정확히 모든 케이스에서 3중 호출이 발생한다고 단정할 수는 없지만, **구조적으로 중복 호출 가능성이 열려 있음**은 확인되었다.

---

### 3. Deployment Recovery / Operational Recovery 경계 불명확

현재 아래 두 recovery domain이 섞여 있다.

#### Deployment Recovery

- build 실패
- deploy 실패
- compose 실패
- env / Dockerfile / recipe 기반 수정
- 재배포

#### Operational Recovery

- container crash
- OOM
- restart loop
- degraded health
- runtime rollback / incident / circuit breaker

특히 runtime 문제를 `deploy:failed(step='run')`로 다시 publish하는 구조 때문에, deployment lane과 operations lane이 동시에 반응할 수 있다.

---

### 4. 이벤트 경계 설계 문제

가장 큰 구조 문제 중 하나는 **runtime incident가 deployment failure 이벤트로 재사용되는 점**이다.

문제:

- runtime incident가 deployment event bus로 역류함
- `auto-recovery`와 `OpsAgent`가 모두 반응할 수 있음
- 장애 도메인별 owner가 모호해짐

즉, 현재 문제는 단순한 버그가 아니라 **이벤트 모델이 도메인 경계를 제대로 표현하지 못하는 구조 문제**다.

---

### 5. `app.ts` 인라인 restart 경로

`alert:new -> docker.restart()` 같은 경로가 별도로 존재한다.

문제:

- recovery owner가 아님
- `OpsRecovery.restartContainer()`와 역할이 겹침
- restart 정책이 단일 owner로 수렴되지 않음

이 경로는 장기적으로 제거 대상이다.

---

### 6. Intentional stop 보호 규칙 부족

현재 graceful stop 관련 보호는 일부 존재한다.

- `container:stop` 이벤트 사용
- `docker-events.ts`는 `exitCode === 0` die 이벤트 무시
- `HealthMonitor`는 `running` 프로젝트만 감시

하지만 아키텍처 원칙으로는 아직 부족하다.

필요한 규칙:

- operator-initiated stop는 crash가 아니다
- planned shutdown은 deploy failure가 아니다
- archive / purge 전 stop는 recovery incident가 아니다

즉, **intentional lifecycle transition**을 failure domain과 명시적으로 분리해야 한다.

---

### 7. 비용 계산식 자체는 대체로 정상

현재까지 확인된 기준으로는 cost math bug 증거는 약하다.

- `src/llm/transparency.ts`에서 모델별 가격표 사용
- input / output token 기준 단순 계산
- UI는 DB 저장값을 조회하여 표시

따라서 비용 문제의 핵심은 계산식보다 **호출 구조**에 가깝다.

---

### 8. auto-recovery 1회 호출 자체가 무거움

한 번의 recovery call 안에 이미 많은 문맥이 들어간다.

- system prompt
- context snapshot
- recovery message
- build log 일부
- agent guidance
- multi-step tool loop

그래서 **4만~5만 토큰 수준의 단일 호출 자체는 충분히 가능**하다.

---

### 9. “세션 누적 폭증”보다 “큰 호출 반복”이 더 유력

현재 auto-recovery는 recovery attempt마다 새 session을 만들기 때문에, 같은 세션이 끝없이 누적되는 구조로 보이지는 않는다.

더 유력한 설명:

- 매 호출이 원래 무거운 full-context prompt임
- 그 호출이 중복 recovery path 때문에 자주 반복됨

즉 비용 폭증은 **conversation history accumulation**보다는 **heavy prompt repetition**에 더 가깝다.

---

### 10. 대시보드 해석 주의

AI usage는 global aggregate로 보일 수 있다.

섞일 수 있는 action type:

- `auto_recovery`
- `build_debugger`
- `monitor_alert`
- `web_agent`

따라서 dashboard 숫자를 그대로 “전부 auto-recovery 비용”으로 해석하면 오판 가능성이 있다.

---

## 구조적 결론

### 권장 아키텍처 방향

완전한 “OpsAgent 단일 통합”보다는, **Recovery domain을 두 lane으로 분리**하는 것이 더 적합하다.

#### 1. Deployment Recovery

소유자:

- `src/pipeline/auto-recovery.ts`

담당 범위:

- `deploy:failed`
- `compose:failed`
- build 실패
- recipe / build debugger / Dockerfile / env 수정
- 재배포

#### 2. Operational Recovery

소유자:

- `src/monitor/ops-agent.ts`
- `src/monitor/ops-recovery.ts`

담당 범위:

- `container:die`
- `container:oom`
- `container:missing`
- steady-state health degradation
- incident / restart / rollback / circuit breaker

---

### 핵심 원칙

```text
[Deploy in progress]   -> Deployment Recovery only
[Service already live] -> Operational Recovery only
```

그리고 별도 규칙:

```text
Intentional stop != crash
Intentional stop != deploy failure
Intentional stop != recovery incident
```

---

## 가장 시급한 이슈

현재 가장 시급한 건 **intentional stop가 recovery lane으로 잘못 해석되지 않도록 규칙을 고정하는 것**이다.

특히 `stopProject` 관련해서는 다음 문장을 아키텍처 규칙으로 고정할 필요가 있다.

> operator-initiated stop는 어떤 recovery lane에도 들어가면 안 된다.

필요한 개념:

- Recovery Eligibility Gate
  - 이 이벤트가 복구 대상인가?
  - operator action인가?
  - project가 stopping / stopped / archived 상태인가?
  - deploy session active인가?

이 gate를 통과한 이벤트만 recovery owner에게 전달되어야 한다.

---

## 삭제 전 기준 정리

문제 프로젝트를 삭제하기 전 기준으로, 이번 조사에서 확인된 우선순위는 다음과 같다.

### P0

1. 중복 recovery path 존재
2. restart / diagnosis owner 중복
3. runtime event를 deploy failure로 재사용하는 구조
4. heavy auto-recovery prompt 반복 호출

### P1

5. intentional stop 보호 규칙 명문화 필요
6. dashboard 해석 시 action type 분리 필요

### P2

7. recovery timeline과 AI usage dashboard의 책임 구분 정리
8. context snapshot 범위 축소 및 중복 주입 제거

---

## 한 줄 결론

현재 auto-recovery / OpsAgent 문제의 본질은 **복구 로직이 여러 owner에 분산된 상태에서 도메인 경계 없이 이벤트를 재사용하고 있어, 비싼 LLM 호출과 recovery action이 중복 발생할 수 있는 구조**라는 점이다.
