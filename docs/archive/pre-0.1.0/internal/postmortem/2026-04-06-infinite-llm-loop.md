# Postmortem: 15,000 LLM Calls in One Day

> 2026-04-06. AI 자동 복구 시스템이 무한 루프에 빠져 ~15K+ LLM 호출을 발생시킨 사고.
> 이 문서는 사고 경위, 근본 원인, 해결 과정, 그리고 얻은 교훈을 기록한다.

---

## 사고 요약

| 항목          | 내용                                                    |
| ------------- | ------------------------------------------------------- |
| **발생일**    | 2026-04-06                                              |
| **영향**      | ~15,000+ LLM API 호출, 호출당 ~16K 토큰, 비용 폭주      |
| **원인**      | PostmortemGenerator의 무한 LLM 호출 루프                |
| **감지**      | AI usage 대시보드에서 비정상적 비용 증가 확인           |
| **대응**      | PostmortemGenerator 이벤트 리스너 전면 비활성화 (긴급)  |
| **근본 해결** | Recovery Architecture 재설계 (RecoveryCoordinator 도입) |

---

## 타임라인

```
[04-06 10:00경]  AI usage 대시보드에서 이상 비용 감지
[04-06 10:49]    1차 수정: stopped/archived 프로젝트 crash recovery 스킵
[04-06 11:09]    추적: AI usage 로그에 projectId 추가하여 범인 식별
[04-06 11:24]    2차 수정: handleAutoRecovery, handleOom, checkPort에 가드 추가
[04-06 11:59]    진범 발견: PostmortemGenerator가 무한 LLM 호출의 실제 원인
[04-06 12:10]    3차 수정: status blacklist → whitelist 전환 (running만 허용)
[04-06 12:17]    긴급 조치: PostmortemGenerator 이벤트 리스너 전면 비활성화
```

6번의 패치를 거치며 점점 더 공격적인 수정을 했지만, 매번 다른 구멍이 터졌다.

---

## 무한 루프 메커니즘

```
error 상태 프로젝트 3개 (컨테이너가 살아있음)
         │
         ▼
Docker container restart (10초마다 반복)
         │
         ├── container:die 이벤트 발생
         │
         ├──→ auto-recovery: status guard → 통과 → recovery 시도
         │    → recovery:success 또는 recovery:exhausted 발행
         │
         ├──→ OpsAgent: status guard → 통과 → recovery 시도
         │    → recovery:success 또는 recovery:exhausted 발행
         │
         └──→ PostmortemGenerator: recovery:success/exhausted 리스닝
              → LLM 호출 (재시도 제한 없음, 30분 dedup만)
              → 완료
              → 10초 후 또 container restart → 루프 반복
```

**핵심**: 프로젝트가 `error` 상태인데 컨테이너가 계속 살아있었다. 기존 guard는 `stopped`/`archived`만 차단했고 `error`는 빠져나갔다.

---

## 근본 원인: 5개의 연결된 구조 문제

단일 버그가 아니라 아키텍처 수준의 결함이 5개 겹쳐서 발생했다.

### 1. 설정에서 AI 꺼도 멈추지 않음

사용자가 Settings에서 AI 기능을 비활성화했지만 LLM 호출이 계속됐다.

**원인**: HealthMonitor와 OpsAgent가 startup 시 받은 `aiProvider` 참조를 캐시. config 변경 시 서비스가 재시작되지 않아 이전 참조로 계속 LLM 호출.

```typescript
// 문제 코드: startup 시 캐시된 provider
constructor(aiProvider: ModelProxy | null) {
  this.aiProvider = aiProvider; // 설정 변경해도 이 참조는 안 바뀜
}
```

### 2. 프로젝트 정지/삭제 후에도 이벤트 발생

프로젝트를 stop/archive/delete해도 Docker 이벤트가 계속 발생했다.

**원인**:

- `stop`: 컨테이너를 정지만 하고 삭제하지 않음. `openlander.managed=true` 라벨 유지 → Docker 이벤트 계속 발생
- `archive`: DB에 `archived_at`을 설정하기 전에 컨테이너 삭제 → race condition으로 die 이벤트가 아직 active 상태로 처리됨
- EventBus에 프로젝트별 리스너 정리 메커니즘 없음

### 3. AI 동작이 UI에서 보이지 않음

AI가 백그라운드에서 15,000번 호출을 하는 동안 사용자가 알 방법이 없었다.

**원인**:

- `agent:event`가 EventBus에 발행되지만 소비자(UI)가 없음
- NotificationCenter에 AI 관련 이벤트 없음
- AI Usage 대시보드는 10초 폴링 — 실시간이 아님
- "AI가 현재 동작 중" 인디케이터 없음

### 4. 무한 재시도

복구에 실패해도 계속 재시도했다.

**원인**:

- auto-recovery: 1시간 윈도우 내 3회 제한 (있긴 했음)
- OpsAgent: circuit breaker 5회 (있긴 했음)
- **PostmortemGenerator: 재시도 제한 없음** (30분 dedup만) ← 무한루프의 직접 원인
- 3개 시스템이 독립적으로 LLM을 호출 → 최대 15회 LLM 호출 가능 per incident

### 5. PostmortemGenerator 동작 시점 불명확

어느 시점에 포스트모템을 생성해야 하는지 정의되지 않았다.

**원인**: `recovery:success`/`recovery:exhausted` 이벤트에 직접 반응하도록 구현. 이벤트가 반복 발생하면 포스트모템도 반복 생성 시도.

### 공통 근본 원인

> **7개 컴포넌트가 각자 독립적으로 EventBus에 구독하고, 각자의 guard만 체크하며, 서로의 존재를 모른다.** 하나라도 guard가 빠지면 사고로 이어지는 구조.

```
EventBus (글로벌, 아무나 구독 가능)
  ├── auto-recovery.ts    ← 자기 guard
  ├── ops-agent.ts        ← 자기 guard
  ├── health.ts           ← 자기 guard
  ├── postmortem.ts       ← 자기 guard (미흡)  ← 사고 원인
  ├── incident-reporter.ts← 자기 guard
  ├── rollback-watcher.ts ← 자기 guard
  └── alerts.ts           ← 자기 guard
```

---

## 긴급 대응

### 즉시 조치

1. PostmortemGenerator의 `start()` 메서드에서 모든 이벤트 리스너 비활성화
2. status guard를 blacklist(stopped/archived 제외) → whitelist(running만 허용)로 전환
3. AI usage 로그에 projectId, source 필드 추가하여 추적 가능하도록

### 긴급 조치의 한계

긴급 조치는 **현재 사고만 막은 것**이지 근본 원인을 해결하지 않았다:

- PostmortemGenerator 기능 자체가 비활성화됨 (기능 손실)
- 다른 컴포넌트에 같은 패턴의 구멍이 있을 수 있음
- 새로운 기능 추가 시 같은 실수 반복 가능

---

## 근본 해결: Recovery Architecture 재설계

### 핵심 변경: RecoveryCoordinator

7개 독립 구독자를 1개 Coordinator로 수렴:

```
AS-IS:  7개 컴포넌트 × 각자 guard = 하나라도 빠지면 사고
TO-BE:  RecoveryCoordinator 1개가 모든 guard 집행 → 단일 통제점
```

### 주요 설계 결정

1. **Single Owner**: 모든 recovery 이벤트 구독과 AI 호출은 RecoveryCoordinator 한 곳
2. **Fail-Stop**: 1회 복구 워크플로 실패 시 즉시 중단. 무한 재시도 없음
3. **Container 삭제 on Stop**: 이벤트 원천 자체를 제거
4. **Config 매번 읽기**: provider 캐시 금지. 설정 변경 즉시 반영
5. **상태 전환 소유권**: Detection Layer는 status 변경 금지. Coordinator만 status 변경
6. **recovering 상태 신설**: recovery 진행 중임을 명시적으로 표현

상세 설계: `docs/planning/recovery-architecture-redesign.md`

---

## 업계 맥락

이 사고는 업계에서 이미 인식된 실패 패턴이다.

**Uncoordinated Multi-Agent Conflict** (Tacnode, 2026.01):

> "여러 AI 에이전트가 조정 없이 같은 데이터에 동작하면, 서로 모순되는 행동을 한다."

**OpenClaw 사건** (Reddit, 2026):

> "에이전트가 혼란에 빠지면 무한 추론 루프에 진입... 128K 컨텍스트 윈도우 전체를 API에 반복적으로 보냈다."

**BSWEN** (2026.03):

> "자율 AI 에이전트를 배포했다... $5이어야 할 작업에 $400이 나왔다."

해결 패턴인 Supervisor/Coordinator Pattern은 Microsoft Azure, LiveKit, Databricks 등에서 2024-2026년에 정립되었다. 다만 **"LLM + 실제 인프라 조작 + 비용 제어"를 결합한 프로덕션 레퍼런스**는 아직 없다.

---

## 교훈

### 1. EventBus는 커플링을 숨긴다

EventBus 패턴은 기존 코드를 수정하지 않고 기능을 추가할 수 있게 해준다. 이것이 장점이자 독이다. 코드 레벨에서는 커플링이 보이지 않지만, 런타임에 여러 구독자가 같은 이벤트에 반응하면서 예측 불가능한 상호작용이 발생한다.

**체크리스트**: EventBus에 새 구독자를 추가할 때, "이 이벤트를 이미 누가 듣고 있는지" 반드시 확인.

### 2. Guard는 분산하면 안 된다

7개 컴포넌트가 각자 guard를 구현하면, 하나라도 빠지거나 불완전하면 사고가 난다. Guard는 한 곳에서 집행해야 한다. 각 컴포넌트는 "내가 호출됐으면 이미 자격 검증이 끝난 것"으로 가정하고 순수 로직만 담당해야 한다.

### 3. Blacklist보다 Whitelist

`stopped`/`archived`를 제외하는 blacklist 방식은 새로운 상태(`error`)가 추가될 때 자동으로 뚫린다. `running`만 허용하는 whitelist 방식은 명시적으로 허용하지 않은 모든 상태를 차단한다.

### 4. AI가 돈을 쓰면 사용자가 알아야 한다

AI가 백그라운드에서 $100를 쓰고 있는데 사용자가 모른다면, 이건 기능이 아니라 사고다. 모든 AI 호출은 실시간으로 가시화되어야 한다.

### 5. 이벤트 원천을 제거하라

Guard를 아무리 정교하게 만들어도, 이벤트 원천(컨테이너)이 살아있으면 언젠가 뚫린다. `stop` 시 컨테이너를 삭제하여 이벤트 자체가 발생할 수 없게 만드는 것이 가장 확실한 해결이다.

### 6. 자율 에이전트에는 코딩 에이전트와 다른 안전장치가 필요하다

코딩 에이전트는 실수해도 `git checkout`으로 되돌린다. 인프라 에이전트는 실수하면 서비스가 죽는다. 자율 에이전트가 실제 인프라를 조작하려면 Eligibility Gate, Budget Enforcement, Circuit Breaker, Operator Suppression, Status Ownership, Visibility 같은 추가 안전장치가 필수다.

---

## 관련 문서

- `docs/launchpad/recovery-architecture-findings-2026-04-06.md` — 사고 당일 분석
- `docs/planning/recovery-architecture-redesign.md` — 아키텍처 재설계 상세
- `docs/planning/ai-architecture-vision.md` — 장기 AI 아키텍처 비전

## 외부 참고

- Microsoft Azure: "AI Agent Orchestration Patterns" (2026.02)
- Tacnode: "8 Coordination Patterns That Actually Work" (2026.01)
- BSWEN: "How to Stop AI Agents From Infinite Loops" (2026.03)
- Runcycles: "AI Agent Budget Patterns" (2026.03)
