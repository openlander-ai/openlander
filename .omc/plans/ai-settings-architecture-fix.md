# AI 설정 아키텍처 수정 계획

**생성일:** 2026-04-09
**상태:** 초안 (사용자 확인 대기)
**복잡도:** HIGH
**영향 범위:** 백엔드 7파일, 프론트엔드 5파일, 테스트 3파일

---

## RALPLAN-DR 요약

### 설계 원칙 (Principles)

1. **단일 진실 소스 (Single Source of Truth)**: 복구 자동화 설정은 하나의 경로(`ops.recovery.automation`)에서만 관리한다. `ai.autoRecovery.enabled`는 AI 에이전트 생성 여부만 제어하고, 실행 정책은 ops에서 통합 관리한다.
2. **점진적 자율성 (Progressive Autonomy)**: 사용자가 단계별(restart, diagnosis, apply_fixes, rollback)로 `auto`/`confirm`을 세밀하게 제어할 수 있어야 한다. "자동 복구 켜기"는 모든 단계를 `auto`로 설정하는 편의 기능이다.
3. **타입 안전성 (Type Safety)**: `AIModelFeature` 타입은 실제 사용되는 모든 기능을 포함해야 하며, 런타임에서 무시되는 설정은 존재하면 안 된다.
4. **설정 변경 투명성 (Change Transparency)**: 핫 리로드되는 설정과 재시작이 필요한 설정은 UI에서 명확하게 구분해야 한다.
5. **하위 호환성 (Backward Compatibility)**: 기존 config.json의 구조를 깨뜨리지 않고, 마이그레이션 경로를 제공한다.

### 의사결정 드라이버 (Decision Drivers)

1. **사용자 혼란 해소**: "자동 복구"가 3곳에 흩어져 있어 ON/OFF가 직관적이지 않다 — 가장 시급한 UX 문제
2. **기능 완결성**: 백엔드 API가 존재하지만 UI가 없는 자동화 정책 설정 — 구현 대비 비용이 낮음
3. **타입 시스템 정합성**: `secretScan`/`rollbackSuggestion`의 모델 라우팅 누락 — 사용자가 선택한 모델이 무시됨

### 대안 분석 (Viable Options)

#### Option A: 통합 리팩터링 (권장)

- **설명**: `auto-recovery.ts`의 DecisionEngine 게이트에 `automationPolicy` 연동을 추가하고, Operations 설정 UI에 자동화 정책 편집기를 구축한다. AI Features 탭에서는 에이전트 활성화만 담당하고, 복구 정책은 Operations로 이관한다.
- **장점**: 사용자 멘탈 모델과 일치, 기존 백엔드 API 재활용, 점진적 구현 가능
- **단점**: UI 변경 범위가 넓음 (2개 설정 탭 모두 수정), 기존 사용자 학습 곡선
- **리스크**: 설정 마이그레이션 시 기존 config.json 호환성 검증 필요

#### Option B: DecisionEngine에 자동화 정책 직접 주입

- **설명**: `DecisionEngine.classify()`에 `automationPolicy`를 주입하여, `auto` 모드인 도구는 `ALLOW`를 반환하도록 수정. UI 변경 최소화.
- **장점**: 백엔드만 수정, 빠른 구현
- **단점**: 두 개의 복구 파이프라인(auto-recovery, ops-recovery)이 각각 다른 방식으로 정책을 참조하게 됨. UI에서 정책 제어 불가 상태 지속.
- **리스크**: 아키텍처 부채 증가. "자동 복구"의 의미가 여전히 분산됨.

#### Option C: 설정 완전 통합 (과도한 리팩터링)

- **설명**: `ai.autoRecovery`와 `ops.recovery`를 하나의 네임스페이스로 병합. config.json 스키마 변경.
- **무효화 사유**: config.json 스키마 변경은 모든 기존 설치에 마이그레이션을 강제하며, 이 프로젝트의 v1.x 안정성 단계에서 과도한 변경임. Option A가 config 스키마를 유지하면서 동일한 UX 효과를 달성함.

**결정: Option A (통합 리팩터링)**

- Option B는 핵심 UX 문제(UI에서 정책 제어 불가)를 해결하지 못함
- Option C는 하위 호환성 비용이 이점을 초과함

---

## 태스크 흐름 (Task Flow)

### Wave 1: 타입 시스템 및 백엔드 기반 (병렬 실행 가능)

#### Task 1.1: `AIModelFeature` 타입에 누락된 기능 추가

**파일:**

- `src/llm/model-registry.ts`
- `src/web/api/setup-routes.ts`

**작업 내용:**

- `AIModelFeature` union 타입에 `'secretScan' | 'rollbackSuggestion'` 추가
- `AI_MODEL_FEATURES` 배열에 두 항목 추가
- `setup-routes.ts:503-510`의 `featureRoutingKeys` 배열에 두 항목 추가 (현재 6개 → 8개)

**수용 기준:**

- `AIModelFeature` 타입이 8개 기능을 모두 포함
- AI Features UI에서 `secretScan`/`rollbackSuggestion`의 모델을 선택하면 `ModelRegistry`에 라우트가 실제로 등록됨
- `createModelProxy(registry, 'secretScan')`이 선택된 모델을 반환하는 단위 테스트 통과

---

#### Task 1.2: `auto-recovery.ts`에 자동화 정책 연동

**파일:**

- `src/pipeline/auto-recovery.ts` (핵심 변경)
- `src/monitor/ops-config-resolver.ts` (import만)
- `src/monitor/ops-agent.ts` (`reloadConfig`의 `recovery.automation` deep merge 수정)

**아키텍트 리뷰 반영 사항:**

- `DecisionEngine.classify()`는 `REQUIRE_APPROVAL` (high-risk) 도구만 승인 게이트를 트리거함
- `create_deploy_plan`, `execute_deploy_plan` 등은 medium-risk → `NOTIFY_THEN_ALLOW` → **승인 게이트에 도달하지 않음**
- 따라서 도구→단계 매핑은 현재 승인 게이트를 거치는 `HIGH_RISK_DEFAULTS` 도구에 대해서만 유효

**작업 내용:**

- `SetupAutoRecoveryParams`에 `getAutomationPolicy: (projectId: string) => RecoveryAutomationPolicy | null` 콜백 추가
- 승인 게이트 로직을 **2단계**로 변경 (라인 ~449):
  1. 도구명 → `ConfigurableRecoveryStep` 매핑 시도
  2. 매핑 성공 + `automationPolicy[step] === 'auto'` → `decisionEngine.classify()` 결과와 **무관하게** 승인 건너뜀
  3. 매핑 성공 + `automationPolicy[step] === 'confirm'` → 기존 `REQUIRE_APPROVAL` 동작 유지
  4. 매핑 실패 (테이블에 없는 도구) → 기존 DecisionEngine 로직 폴백
  5. 정책이 `null` → 기존 DecisionEngine 로직 전체 유지
- 매핑 테이블 (`TOOL_TO_RECOVERY_STEP`):
  - `rollback_project`, `remove_project` → `rollback` (HIGH_RISK, 현재도 승인 필요)
  - `platform_force_remove`, `remove_service`, `remove_volume` → `rollback` (HIGH_RISK)
  - `create_database`, `platform_cleanup_orphans`, `platform_reconcile` → `apply_fixes` (HIGH_RISK)
  - 매핑되지 않는 도구 (medium/low risk) → DecisionEngine 폴백
- **`confirm` 모드 범위**: `REQUIRE_APPROVAL` 도구에만 적용. `NOTIFY_THEN_ALLOW` 도구는 `confirm` 모드에서도 승인 불필요 (기존 동작 유지)
- **중요: `restart`/`diagnosis` 단계의 한계**: `HIGH_RISK_DEFAULTS`에 restart/diagnosis에 해당하는 도구가 없으므로, 이 두 단계의 정책은 `auto-recovery.ts`에서는 적용 불가. `ops-recovery.ts`에서만 4단계 모두 제어 가능. UI에서 이 차이를 명시해야 함 (Task 2.1 참조)
- **승인 우회 시 감사 로그**: `auto` 모드로 승인 게이트를 건너뛸 때, `recovery:approval-auto-skipped` 이벤트를 emit하여 activity_log에 기록. 프로덕션에서 "왜 자동 실행됐는지" 추적 가능
- **정책 스냅샷**: 복구 세션 시작 시 `getAutomationPolicy(projectId)` 결과를 캐싱하여, 복구 중 정책 변경이 진행 중인 세션에 영향을 주지 않도록 함

**수용 기준:**

- `automationPolicy.rollback === 'auto'`일 때 `rollback_project` 도구가 승인 없이 실행됨
- `automationPolicy.rollback === 'confirm'`일 때 기존과 동일하게 승인 팝업 표시
- 정책이 `null`(복구 비활성화)이면 모든 도구가 기존 DecisionEngine 로직 사용
- 매핑되지 않는 도구는 기존 DecisionEngine 로직으로 폴백
- `HIGH_RISK_DEFAULTS`의 모든 도구가 `TOOL_TO_RECOVERY_STEP`에 매핑됨을 검증하는 테스트 포함
- 기존 테스트 깨지지 않음

---

#### Task 1.3: `codingPlan.enabled` 데드 설정 처리

**파일:**

- `src/config/index.ts`
- `src/web/api/setup-routes.ts`

**작업 내용:**

- 런타임에서 `codingPlan.enabled`를 확인하는 코드가 전무하므로, 두 가지 선택:
  - (a) 설정과 UI를 유지하되 "Coming Soon" 배지 추가 (최소 변경)
  - (b) 향후 코딩 플랜 기능이 구현될 때까지 기본값을 `enabled: false`로 변경하고 UI에서 비활성화 표시
- **결정: (a)** — 이미 config에 존재하므로 제거보다 명시가 안전

**수용 기준:**

- UI에서 `codingPlan` 토글 옆에 "Coming Soon" 또는 동등한 표시가 보임
- 토글을 켜도 실제 동작에 영향 없음이 명시적으로 문서화됨

---

### Wave 2: 프론트엔드 UI 구축 (Wave 1 완료 후)

#### Task 2.1: 자동화 정책 편집기 UI 구축

**파일:**

- `web/src/components/settings/OperationsSettings.tsx` (주요 변경)
- `web/src/lib/api/operations.ts` (API 클라이언트 추가)
- `web/src/i18n/en.ts`, `web/src/i18n/ko.ts` (번역 키 추가)

**작업 내용:**

- `OperationsSettings.tsx`에 "복구 자동화 정책" 카드 추가:
  - 4개 단계(restart, diagnosis, apply_fixes, rollback) 각각에 `auto`/`confirm` 토글
  - "전체 자동" 마스터 토글 (모든 단계를 `auto`로 설정하는 편의 기능)
  - 현재 유효 정책 표시 (3-tier 병합 결과)
  - **파이프라인 적용 범위 안내**: `restart`/`diagnosis` 토글 옆에 "컨테이너 복구에만 적용" 표시, `apply_fixes`/`rollback` 토글 옆에 "모든 복구에 적용" 표시 — 두 파이프라인 간 정책 적용 범위 차이를 사용자에게 투명하게 전달
- `operations.ts`에 API 클라이언트 함수 추가:
  - `fetchAutomationDefaults()` → `GET /api/ops/automation/defaults`
  - `updateAutomationDefaults(automation)` → `PUT /api/ops/config` (기존 `ops.recovery.automation` 필드 활용)
  - `fetchProjectAutomation(projectId)` → `GET /api/ops/projects/:projectId/automation`
  - `updateProjectAutomation(projectId, automation)` → `PUT /api/ops/projects/:projectId/automation`
- **글로벌 기본값 수정**: 별도 엔드포인트 추가 대신 기존 `PUT /api/ops/config`에 `recovery.automation` 필드를 포함하여 전송 (기존 API가 이미 `ops.recovery.automation`을 지원함)
- 번역 키 추가 (ko/en)

**수용 기준:**

- Operations 설정 탭에서 4개 복구 단계의 auto/confirm을 개별 토글 가능
- "전체 자동" 토글을 켜면 4개 모두 `auto`로 전환됨
- 설정 저장 후 API 응답의 `effective` 정책이 UI에 반영됨
- 한국어/영어 번역 완비

---

#### Task 2.2: AI Features 탭에 설정 안내 개선

**파일:**

- `web/src/components/settings/AiFeaturesSection.tsx`
- `web/src/i18n/en.ts`, `web/src/i18n/ko.ts`

**작업 내용:**

- `autoRecovery` 토글 아래에 안내 텍스트 추가: "AI 에이전트 활성화 여부를 제어합니다. 복구 시 승인 정책은 Operations 설정에서 관리합니다." (링크 포함)
- `codingPlan` 항목에 "Coming Soon" 배지 추가
- 핫 리로드/재시작 구분 표시:
  - 모델 변경 → "즉시 적용" 아이콘/텍스트
  - enabled 토글 → "재시작 필요" 아이콘/텍스트
  - `setup-routes.ts`의 응답에 `requiresRestart` 필드 추가 검토 (백엔드 변경 최소화를 위해 프론트엔드 하드코딩도 허용)

**수용 기준:**

- `autoRecovery` 토글 아래에 Operations 설정 링크가 표시됨
- `codingPlan`에 "Coming Soon" 배지 표시
- enabled 토글 변경 시 "재시작 필요" 표시가 나타남
- 모델 변경 시 "즉시 적용" 표시가 나타남 (또는 변경 표시 없이 즉시 반영)

---

### Wave 3: 통합 및 검증 (Wave 2 완료 후)

#### Task 3.1: 통합 테스트 및 E2E 검증

**파일:**

- `test/pipeline/auto-recovery.test.ts` (기존 또는 신규)
- `test/monitor/ops-config-resolver.test.ts` (기존 또는 신규)
- `test/web/api/ops-routes.test.ts` (기존 확장)

**작업 내용:**

- `auto-recovery` 자동화 정책 연동 테스트:
  - `automationPolicy.rollback = 'auto'` → 승인 게이트 우회 확인
  - `automationPolicy.rollback = 'confirm'` → 승인 게이트 동작 확인
  - 정책 `null` → 기존 DecisionEngine 로직 유지 확인
- `ops-config-resolver` 3-tier 병합 테스트:
  - DEFAULT → global override → project override 순서 확인
  - `isAutopilot()` 함수 정확성 확인
- UI 자동화 정책 API 라운드트립 테스트:
  - PUT → GET → 값 일치 확인

**수용 기준:**

- 모든 신규 테스트 통과
- 기존 테스트 회귀 없음
- `npm test` 전체 통과

---

## 의존성 다이어그램

```
Wave 1 (병렬):
  Task 1.1 (타입 수정) ──┐
  Task 1.2 (정책 연동) ──┼──→ Wave 2
  Task 1.3 (dead 설정)  ──┘
                              │
Wave 2 (병렬):                │
  Task 2.1 (정책 UI)  ────┐  │
  Task 2.2 (AI 탭 개선) ──┼──→ Wave 3
                           │
Wave 3:                    │
  Task 3.1 (통합 테스트) ──┘
```

---

## 리스크 평가

### 높은 리스크

- **auto-recovery 승인 게이트 변경 (Task 1.2)**: 이 파일은 실제 프로덕션 복구 파이프라인의 핵심. 도구명 → 단계 매핑이 잘못되면 의도치 않은 자동 실행(예: 승인 없는 롤백) 발생 가능.
  - **완화**: 매핑 테이블을 상수로 정의하고, 매핑되지 않는 도구는 기존 DecisionEngine 로직으로 폴백. 테스트에서 모든 HIGH_RISK_DEFAULTS 도구의 매핑 검증.

### 중간 리스크

- **OperationsSettings UI 확장 (Task 2.1)**: 기존 컴포넌트에 새로운 섹션 추가. 상태 관리가 복잡해질 수 있음.
  - **완화**: 자동화 정책 섹션을 별도 컴포넌트(`AutomationPolicyEditor`)로 분리.

### 낮은 리스크

- **AIModelFeature 타입 확장 (Task 1.1)**: 타입 추가는 기존 코드에 영향 없음. `setup-routes.ts`의 배열 추가만 필요.
- **codingPlan Coming Soon 배지 (Task 1.3)**: UI 전용 변경, 백엔드 영향 없음.

---

## 범위 제외 (명시적 비포함)

다음 항목은 이 계획의 범위에 포함하지 않음:

1. **`ops.production_only` UI**: 현재 사용 빈도 낮음. 별도 이슈로 추적.
2. **CircuitBreaker 파라미터 UI** (`max_failures`, `window_hours`, `half_open_probe_interval_ms`): 고급 설정으로 별도 "Advanced" 섹션에서 다룰 것.
3. **`localModel.*` UI**: 로컬 모델 설정은 별도 기능 세트.
4. **`ai.autoRecovery.enabled`와 `ops.recovery.enabled`의 완전 병합**: config 스키마 변경 없이, UI 안내 텍스트로 관계를 명확히 하는 것이 이 계획의 접근법.

---

## ADR (Architecture Decision Record)

### Decision

`auto-recovery.ts`의 DecisionEngine 기반 승인 게이트에 `RecoveryAutomationPolicy`를 연동하고, Operations 설정 UI에 자동화 정책 편집기를 추가한다.

### Drivers

1. "자동 복구" 설정이 3곳에 분산되어 사용자 혼란 유발
2. 백엔드 자동화 정책 API는 완성되어 있으나 UI 부재
3. `secretScan`/`rollbackSuggestion` 모델 라우팅 타입 누락

### Alternatives Considered

- **Option B (DecisionEngine 직접 주입)**: UI 변경 없이 백엔드만 수정. 자동화 정책 UI 부재 문제 미해결.
- **Option C (설정 완전 통합)**: config.json 스키마 변경 필요. 하위 호환성 비용 과다.

### Why Chosen

Option A는 기존 config 스키마를 유지하면서 UX 문제를 해결하고, 이미 구현된 백엔드 API를 활용한다. 구현 비용 대비 효과가 가장 높다.

### Consequences

- Operations 설정 탭이 더 복잡해짐 (자동화 정책 섹션 추가)
- `auto-recovery.ts`에 `ops-config-resolver` 의존성 추가
- 두 복구 파이프라인이 동일한 정책 데이터를 읽지만, **적용 범위가 다름**: ops-recovery는 4개 단계 모두에 적용 (restart, diagnosis, apply_fixes, rollback), auto-recovery는 HIGH_RISK 도구 관련 단계(rollback, apply_fixes)에만 적용. restart/diagnosis 정책은 auto-recovery에서는 효과 없음
- `reloadConfig`에서 `recovery.automation` deep merge 보장 필요

### Follow-ups

- `ops.production_only`, CircuitBreaker 파라미터 등 UI-less 설정에 대한 후속 계획
- `ai.autoRecovery.enabled`와 `ops.recovery.enabled`의 관계를 문서화하는 사용자 가이드
- `codingPlan` 기능 실제 구현 시 "Coming Soon" 배지 제거
