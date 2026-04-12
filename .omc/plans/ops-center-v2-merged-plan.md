# OpsCenterV2 개선 병합 계획 — UX 핵심 수정 + 미노출 데이터 활용

## TL;DR

> **Quick Summary**: 사용자가 직접 경험한 6가지 UX 문제(i18n 혼재, 정보 중복, 사이드바 부족, 세부정보 불일치)를 최우선 해결하고, 백엔드에 이미 존재하지만 미노출된 데이터(AI 메타데이터, 캐스케이드 그룹, CircuitBreaker 리셋)를 저비용으로 활용하여 운영 판단력을 높인다.
>
> **Deliverables**:
>
> - i18n 정합성 100% (심각도/이벤트/타이틀 한영 혼재 0건)
> - 스레드 정보 중복 제거 + 세부정보 인라인 표시
> - 사이드바 인시던트에 프로젝트명/시간/심각도 레이블 추가
> - AI 메타데이터, 캐스케이드 그룹, CB 리셋 버튼 노출
> - 에러/재연결/빈 상태에 대한 명확한 사용자 피드백
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: T1 → T2 → T7 → T8 → T9

---

## Context

### Original Request

운영(Operations) 메뉴 전반적인 개선사항 계획 수립 → OpsCenterV2 집중, UX/UI + 안정성.

### User Feedback (핵심 — 이 계획의 근거)

1. **심각도 태그 한/영 혼재** — "심각도 부분은 한글/영어가 섞여보이고, 태그도 뭔가 어색해"
2. **이벤트 타입 미번역** — "deploy:crash는 영문으로 그대로 나와"
3. **정보 중복** — "아래로 펼치면 중복되서 정보가 나와. 자동복구실패면, 아래 로우에 또 자동복구실패"
4. **세부정보 접근성** — "바로 세부정보가 나오면 될거같은데, 세부정보를 눌러야나옴. 그리고 세부정보가 어떤건있고 어떤건 없는데 차이를 모르겠음"
5. **사이드바 정보 부족** — "왼쪽 사이드바 현재 문제가 그냥 텍스트만 나와서 뭔지 모르겠음. 플젝이랑 시간도 같이 나와야할듯"
6. **판단 정보 부족** — "사용자가 정확하게 인지하고 판단할수있도록 정보가 필요"

### Merged Sources

- **우리 계획 (OMC)**: Phase 1-4 전체 (사용자 피드백 직접 반영)
- **Sisyphus 계획**: Task 4 (CB 리셋), Task 5 (AI 메타데이터), Task 6 (캐스케이드) — 저비용 고가치 항목만 선별

### 제외 항목 (별도 계획으로 분리)

- React Flow 의존성 그래프 (새 npm 의존성 필요, 사용자 미요청)
- 키보드 단축키 시스템 (nice-to-have)
- 인시던트 상세 슬라이드오버 (새 컴포넌트, 사용자 미요청)
- 시간범위 필터 로직 (백엔드 수정 필요)
- 인시던트 검색 (백엔드 수정 필요)
- V1 코드 제거 (사용자가 명시적으로 범위 제외)

---

## Work Objectives

### Core Objective

OpsCenterV2의 기존 UX 문제를 해결하여 사용자가 운영 상황을 정확히 인지하고 신속히 판단할 수 있도록 정보 명확성과 일관성을 확보한다.

### Concrete Deliverables

- 모든 심각도/이벤트/타이틀이 현재 언어 설정에 맞게 통일 (raw 영문 0건)
- 스레드 펼침 시 부모/자식 간 중복 정보 제거
- 짧은 세부정보(100자 미만)는 클릭 없이 인라인 표시, AI 진단은 항상 펼침
- 사이드바 인시던트에 프로젝트명 + 상대 시간 + 심각도 텍스트 표시
- AI 메타데이터(모델명, 토큰, 소요시간) 스레드 카드에 표시
- 캐스케이드 그룹 영향 프로젝트 뱃지 표시
- CircuitBreakerWidget 연결 + 리셋 버튼(확인 다이얼로그 포함)
- SSE 끊김/API 에러 시 상황별 배너 + 재시도
- 빈 상태 메시지 상황별 분리

### Definition of Done

- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] 모든 새 UI 문자열이 `t()` 사용 + en.ts/ko.ts 양쪽 업데이트
- [ ] 한국어 모드에서 raw 영문 키/타입 노출 0건
- [ ] 스레드 펼침 시 동일 텍스트 2회 이상 표시 0건

### Must Have

- SeverityBadge에 info 심각도 분기 추가 + 번역 키 통일
- humanizeEventType()에 모든 이벤트 타입 번역 키 보강
- MainFeedGrid에서 실제 t 함수 전달 (identity 함수 대체)
- ThreadEventDenseRow에서 부모 타이틀과 동일 시 숨김
- IncidentRow에 projectName + relativeTime 표시
- AI 메타데이터, 캐스케이드 그룹 — 데이터 있는 경우에만 표시
- CB 리셋 시 확인 다이얼로그
- 에러 배너에 재시도 카운트 표시

### Must NOT Have (Guardrails)

- 새 백엔드 API 라우트 또는 엔드포인트 수정
- 새 npm 의존성 추가
- 새 `components/ui/` 프리미티브 생성 (기존 shadcn/Radix 사용)
- V1 컴포넌트 수정 또는 삭제
- `as any`, `@ts-ignore`, `@ts-expect-error` 사용
- 인시던트 관리 기능 (할당, 에스컬레이션, 노트)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 핵심 UX 수정, 3 parallel):
├── Task 1: i18n 정합성 (심각도 + 이벤트 타입 + 타이틀 번역)
├── Task 2: 스레드 중복 제거 + 세부정보 인라인 표시
└── Task 3: LeftRail 사이드바 개선 (프로젝트명/시간/심각도)

Wave 2 (After Wave 1 — 미노출 데이터 활용, 3 parallel):
├── Task 4: AI 메타데이터 표시
├── Task 5: 캐스케이드 그룹 시각화
└── Task 6: CircuitBreakerWidget 연결 + 리셋 버튼

Wave 3 (After Wave 2 — 에러/빈상태/감사, 3 parallel):
├── Task 7: 에러 처리 및 상태 피드백 강화
├── Task 8: 빈 상태 UI 통일
└── Task 9: i18n 전수 감사

Critical Path: T1 → T4 → T9 (i18n 흐름)
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3
```

### Dependency Matrix

| Task | Depends On | Blocks  | Wave |
| ---- | ---------- | ------- | ---- |
| 1    | —          | 4, 5, 9 | 1    |
| 2    | —          | 7, 8    | 1    |
| 3    | —          | 6       | 1    |
| 4    | 1          | 9       | 2    |
| 5    | 1          | 9       | 2    |
| 6    | 3          | 8       | 2    |
| 7    | 2          | 9       | 3    |
| 8    | 2, 6       | 9       | 3    |
| 9    | 1-8        | —       | 3    |

---

## TODOs

> Implementation + QA = ONE Task. Never separate.

---

### Wave 1: 핵심 UX 수정

---

- [ ] 1. i18n 정합성 — 심각도 + 이벤트 타입 + 타이틀 번역 통일

  **What to do**:

  **1-A: SeverityBadge 번역 키 통일**
  - `web/src/components/ops/SeverityBadge.tsx`:
    - Line 20: `t('operations.severity.critical')` → `t('opsV2.severity.critical')`
    - Line 32: `t('operations.severity.warning')` → `t('opsV2.severity.warning')`
    - Line 40: raw `severity` 표시 → `info` 분기 추가, `t('opsV2.severity.info')` 사용
  - `web/src/i18n/ko.ts` + `web/src/i18n/en.ts`: `opsV2.severity` 키 추가
    - ko: `{ critical: '위험', warning: '경고', info: '정보' }`
    - en: `{ critical: 'Critical', warning: 'Warning', info: 'Info' }`

  **1-B: 이벤트 타입 번역 보강**
  - `web/src/components/ops/utils.ts` (Lines 138-154):
    - `humanizeEventType()` 폴백 개선: 번역 키 없으면 `console.warn` 추가
  - `web/src/i18n/ko.ts` + `en.ts`의 `operations.events.*`에 누락 키 추가:
    - `recovery_started`, `recovery_failed`, `recovery_completed`
    - `approval_pending`, `approval_approved`, `approval_rejected`
    - `circuit_breaker_open`, `circuit_breaker_reset`
    - `ai_intervention`, `cascade_detected`, `cleanup`, `alert_sent`
  - `web/src/components/ops/v2/MainFeedGrid.tsx` Line 131:
    - `humanizeEventType(head.type, (k) => k)` → 실제 `t` 함수 전달로 교체

  **1-C: TITLE_PATTERNS 보강**
  - `web/src/components/ops/v2/MainFeedGrid.tsx` Lines 24-36:
    - 현재 패턴 검토 후 recovery/circuit breaker 관련 패턴 추가
    - `localizeTitle()` 폴백: 패턴 매칭 실패 시 `humanizeEventType()` 경유
  - `web/src/i18n/ko.ts` + `en.ts`: `opsV2.titles.*` 누락 키 추가

  **Must NOT do**:
  - 기존 `operations.severity.*` 키 삭제하지 않기 (다른 컴포넌트에서 사용 가능)
  - 기존 `operations.events.*` 키 변경하지 않기 (추가만)

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5, 9
  - **Blocked By**: None

  **References**:
  - `web/src/components/ops/SeverityBadge.tsx:20,32,40` — 번역 키 교체 위치
  - `web/src/components/ops/utils.ts:138-154` — humanizeEventType 폴백 로직
  - `web/src/components/ops/v2/MainFeedGrid.tsx:24-36` — TITLE_PATTERNS 정의
  - `web/src/components/ops/v2/MainFeedGrid.tsx:131` — identity 함수 대신 t 함수 전달
  - `web/src/i18n/ko.ts:490-499,524-527,639-641` — 기존 번역 키 위치
  - `web/src/i18n/en.ts:493-502,527-530,643-645` — 기존 번역 키 위치

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: 심각도 뱃지 한국어 통일
    Tool: Bash (grep)
    Steps:
      1. SeverityBadge.tsx에서 `opsV2.severity` 키 사용 확인
      2. ko.ts/en.ts에 `opsV2.severity.critical/warning/info` 키 존재 확인
      3. SeverityBadge에서 raw severity 문자열 직접 표시하는 코드 없음 확인
    Expected Result: 모든 심각도가 opsV2.severity.* 키 경유
    Failure Indicators: operations.severity.* 키 잔존, raw 문자열 표시

  Scenario: 이벤트 타입 번역 완전성
    Tool: Bash (grep)
    Steps:
      1. MainFeedGrid.tsx Line 131에서 identity 함수 `(k) => k` 제거 확인
      2. ko.ts의 operations.events.* 키 수 ≥ 20개 확인
      3. en.ts의 operations.events.* 키 수 = ko.ts와 동일 확인
    Expected Result: 모든 이벤트 타입에 양쪽 번역 존재
    Failure Indicators: identity 함수 잔존, 키 수 불일치

  Scenario: 빌드 확인
    Tool: Bash
    Steps:
      1. `npm run typecheck && npm run build`
    Expected Result: 에러 없이 성공
  ```

  **Commit**: YES
  - Message: `fix(web): unify severity/event i18n keys and eliminate raw English in ops center`
  - Files: `SeverityBadge.tsx`, `utils.ts`, `MainFeedGrid.tsx`, `ko.ts`, `en.ts`

---

- [ ] 2. 스레드 중복 정보 제거 + 세부정보 인라인 표시

  **What to do**:

  **2-A: 부모/자식 행 중복 제거**
  - `web/src/components/ops/v2/MainFeedGrid.tsx`:
    - `ThreadEventDenseRow` 컴포넌트 (Lines 166-265)에 `threadTitle` prop 추가
    - `titleText === threadTitle`이면 타이틀 텍스트 숨기고 시간/상태만 표시
    - 스레드 렌더링 시 (Lines 390-470) `threadTitle={thread.title}` 전달
    - 이벤트가 1개인 스레드: 부모행에 세부정보 인라인 표시 (별도 펼침 불필요)

  **2-B: 세부정보 자동 표시**
  - `ThreadEventDenseRow` (Lines 166-172, 205-262):
    - `hasDetails` 조건 유지: `!!event.description || !!event.aiMetadata?.diagnosisSummary`
    - 짧은 description (100자 미만): 클릭 없이 인라인 표시 (기존 토글 제거)
    - 긴 description (100자 이상): 기존 토글 유지하되 기본 펼침 상태로 변경
    - `aiMetadata.diagnosisSummary`: 항상 펼쳐서 표시 (중요 정보)
    - 세부정보 없는 이벤트: 버튼 미표시 (현재와 동일), 하지만 행 좌측에 `hasDetails` 여부를 시각적으로 구분 (작은 info 점 또는 없음)

  **Must NOT do**:
  - 스레드 그룹핑 로직(`groupIntoThreads`) 변경하지 않기
  - 이벤트 데이터 구조 변경하지 않기

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 7, 8
  - **Blocked By**: None

  **References**:
  - `web/src/components/ops/v2/MainFeedGrid.tsx:166-265` — ThreadEventDenseRow 컴포넌트
  - `web/src/components/ops/v2/MainFeedGrid.tsx:171` — hasDetails 조건
  - `web/src/components/ops/v2/MainFeedGrid.tsx:205-262` — 세부정보 렌더링 로직
  - `web/src/components/ops/v2/MainFeedGrid.tsx:390-470` — 부모 스레드 행 렌더링
  - `web/src/components/ops/v2/MainFeedGrid.tsx:410-431` — 부모행 타이틀 + 트리거 타입 표시

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: 부모/자식 타이틀 중복 제거
    Tool: Bash (grep)
    Steps:
      1. ThreadEventDenseRow에 threadTitle prop 존재 확인
      2. titleText === threadTitle일 때 타이틀 숨김 로직 확인
    Expected Result: 동일 타이틀 2회 표시 불가
    Failure Indicators: threadTitle prop 미사용, 조건부 숨김 없음

  Scenario: 짧은 세부정보 인라인 표시
    Tool: Bash (grep)
    Steps:
      1. description 길이 100자 기준 분기 로직 확인
      2. 100자 미만일 때 토글 없이 인라인 표시 확인
    Expected Result: 짧은 description은 항상 표시
    Failure Indicators: 길이 분기 없음, 모든 description에 토글 유지

  Scenario: 빌드 확인
    Tool: Bash
    Steps: `npm run typecheck && npm run build`
    Expected Result: 성공
  ```

  **Commit**: YES
  - Message: `fix(web): remove thread info duplication and inline short details in ops feed`
  - Files: `MainFeedGrid.tsx`

---

- [ ] 3. LeftRail 사이드바 개선 — 프로젝트명/시간/심각도

  **What to do**:

  **3-A: IncidentRow에 프로젝트명 + 시간 추가**
  - `web/src/components/ops/v2/LeftRail.tsx`:
    - `IncidentRow` props 확장 (Lines 58-98):
      - `projectName?: string` 추가
      - `lastEventTime?: string` 추가
    - 레이아웃 변경:
      ```
      ● [프로젝트명]              [3분 전]
        배포 실패 (×2)
      ```
    - `relativeTime()` 유틸 사용 (`utils.ts` Line 1-14)
    - collapsed 상태 (Lines 81-89): 아이콘 + 프로젝트명 첫 글자 표시

  **3-B: 인시던트 그룹핑에서 메타데이터 전달**
  - `LeftRail.tsx` Lines 213-225: 그룹핑 로직 수정
    - 그룹별 첫 인시던트의 `projectName` (또는 `project_id`에서 조회) 추출
    - 그룹 내 가장 최근 인시던트의 `created_at` 추출
    - `IncidentRow`에 `projectName`, `lastEventTime` 전달

  **3-C: 심각도 텍스트 레이블 추가**
  - `IncidentRow` Lines 68-73:
    - 현재 `w-2 h-2 rounded-full` dot에 SeverityBadge 컴포넌트 또는 텍스트 레이블 추가
    - critical 인시던트 행에 `bg-error/5` 배경 하이라이트

  **Must NOT do**:
  - LeftRail의 전체 레이아웃(48px/320px 전환) 변경하지 않기
  - 인시던트 데이터 구조 변경하지 않기

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `web/src/components/ops/v2/LeftRail.tsx:58-98` — IncidentRow 컴포넌트
  - `web/src/components/ops/v2/LeftRail.tsx:68-73` — 심각도 dot 스타일링
  - `web/src/components/ops/v2/LeftRail.tsx:75-79` — displayTitle 로직
  - `web/src/components/ops/v2/LeftRail.tsx:92-96` — IncidentRow 렌더링
  - `web/src/components/ops/v2/LeftRail.tsx:213-225` — 인시던트 그룹핑 로직
  - `web/src/components/ops/utils.ts:1-14` — relativeTime() 함수
  - `web/src/components/ops/SeverityBadge.tsx` — 심각도 뱃지 컴포넌트 재사용

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: 사이드바에 프로젝트명/시간 표시
    Tool: Bash (grep)
    Steps:
      1. IncidentRow에 projectName, lastEventTime prop 존재 확인
      2. relativeTime() 함수 import 확인
      3. 프로젝트명 렌더링 코드 확인
    Expected Result: 프로젝트명 + 상대 시간이 IncidentRow에 표시
    Failure Indicators: props 미추가, relativeTime 미사용

  Scenario: 심각도 텍스트 레이블
    Tool: Bash (grep)
    Steps:
      1. IncidentRow에서 SeverityBadge 또는 심각도 텍스트 렌더링 확인
      2. critical 행에 배경 하이라이트 클래스 확인
    Expected Result: dot 외에 텍스트 심각도 표시
    Failure Indicators: dot만 유지

  Scenario: 빌드 확인
    Tool: Bash
    Steps: `npm run typecheck && npm run build`
    Expected Result: 성공
  ```

  **Commit**: YES
  - Message: `fix(web): add project name, time, and severity label to ops sidebar incidents`
  - Files: `LeftRail.tsx`

---

### Wave 2: 미노출 데이터 활용 (Sisyphus 선별 항목)

---

- [ ] 4. AI 메타데이터 표시

  **What to do**:
  - `web/src/components/ops/v2/MainFeedGrid.tsx`:
    - 스레드 카드에 `ActivityItem.aiMetadata` 정보 표시
    - 표시 형태: 작은 뱃지/인라인 — "claude-3.5-sonnet · 1,234 tokens · 2.3s"
    - `aiMetadata`가 있는 이벤트에만 표시 (없으면 숨김)
    - `diagnosisSummary`는 Task 2에서 이미 인라인 표시 처리됨 — 여기서는 모델/토큰/시간만
    - `durationMs` → 읽기 쉬운 형태 포맷 (예: 2300 → "2.3s", 65000 → "1m 5s")
    - `tokensUsed` → 천 단위 콤마 (예: 1234 → "1,234")
  - i18n 키 추가 (en.ts + ko.ts): `opsV2.ai.model`, `opsV2.ai.tokens`, `opsV2.ai.duration`

  **Must NOT do**:
  - 모든 이벤트에 AI 영역 표시하지 않기 (데이터 있을 때만)
  - 토큰 비용 계산하지 않기

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: Task 9
  - **Blocked By**: Task 1 (i18n 키 구조 안정화)

  **References**:
  - `web/src/components/ops/v2/MainFeedGrid.tsx` — 스레드 카드 렌더링
  - `web/src/lib/api/operations.ts` — `ActivityItem.aiMetadata: { model, tokensUsed, durationMs, diagnosisSummary }`
  - `web/src/components/ops/utils.ts:relativeTime()` — 시간 포맷 유틸 참고

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: AI 메타데이터 표시
    Tool: Bash (grep)
    Steps:
      1. MainFeedGrid.tsx에서 aiMetadata.model, tokensUsed, durationMs 접근 코드 확인
      2. 조건부 렌더링 (aiMetadata 존재 시에만) 확인
      3. i18n 키 존재 확인
    Expected Result: AI 메타데이터 조건부 표시 코드 존재
    Failure Indicators: 무조건 표시, 포맷 미적용

  Scenario: 빌드 확인
    Tool: Bash
    Steps: `npm run typecheck && npm run build`
    Expected Result: 성공
  ```

  **Commit**: YES
  - Message: `feat(web): display AI metadata in ops activity feed`
  - Files: `MainFeedGrid.tsx`, `ko.ts`, `en.ts`

---

- [ ] 5. 캐스케이드 그룹 시각화

  **What to do**:
  - `web/src/components/ops/v2/MainFeedGrid.tsx`:
    - `ActivityItem.cascadeGroup` (`string[]` — 영향받은 프로젝트 ID 목록) 시각화
    - 캐스케이드 그룹이 있는 스레드에 표시:
      - 연결된 프로젝트명 뱃지 (예: "연쇄 영향: project-a, project-b")
      - 좌측 강조 바 또는 배경색으로 시각 구분
    - `cascadeGroup`이 없거나 빈 배열이면 미표시
  - i18n 키 추가: `opsV2.cascade.label`, `opsV2.cascade.affected`

  **Must NOT do**:
  - 캐스케이드 분석/원인 추적 기능 추가하지 않기 (표시만)

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6)
  - **Blocks**: Task 9
  - **Blocked By**: Task 1 (i18n 키 구조 안정화)

  **References**:
  - `web/src/components/ops/v2/MainFeedGrid.tsx` — 캐스케이드 데이터 접근 위치
  - `web/src/lib/api/operations.ts` — `ActivityItem.cascadeGroup: string[]`
  - `web/src/components/ops/SeverityBadge.tsx` — 뱃지 스타일링 패턴 참고

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: 캐스케이드 시각화
    Tool: Bash (grep)
    Steps:
      1. MainFeedGrid.tsx에서 cascadeGroup 접근 코드 확인
      2. 조건부 렌더링 (비어있지 않을 때만) 확인
      3. i18n 키 존재 확인
    Expected Result: 캐스케이드 조건부 표시 코드 존재
    Failure Indicators: 무조건 표시, 빈 배열 시에도 표시

  Scenario: 빌드 확인
    Tool: Bash
    Steps: `npm run typecheck && npm run build`
    Expected Result: 성공
  ```

  **Commit**: YES
  - Message: `feat(web): add cascade group visualization in ops feed`
  - Files: `MainFeedGrid.tsx`, `ko.ts`, `en.ts`

---

- [ ] 6. CircuitBreakerWidget 연결 + 리셋 버튼

  **What to do**:
  - `web/src/components/ops/v2/CircuitBreakerWidget.tsx`: 이미 존재하나 미렌더링 — 확인 후 연결
  - `web/src/components/ops/v2/LeftRail.tsx`:
    - CircuitBreakerRow (Lines 125-154)에 리셋 버튼 추가
    - `state === 'open'`인 경우에만 리셋 버튼 표시
    - 클릭 시 기존 Radix AlertDialog로 확인: "서킷브레이커를 리셋하면 자동 복구가 다시 활성화됩니다. 계속하시겠습니까?"
    - `resetCircuitBreaker(projectId)` API 호출 (이미 존재)
    - 성공/실패 시 toast 알림
  - `web/src/pages/OpsCenterV2.tsx`: CircuitBreakerWidget이 미렌더링이면 연결
  - i18n 키 추가: 리셋 버튼 라벨, 확인 다이얼로그 텍스트, toast 메시지

  **Must NOT do**:
  - 새 UI 프리미티브 생성하지 않기 (기존 AlertDialog, Button, toast 사용)
  - CircuitBreaker 상태 직접 변경하지 않기 (API 통해서만)

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Task 8
  - **Blocked By**: Task 3 (사이드바 구조 안정화)

  **References**:
  - `web/src/components/ops/v2/CircuitBreakerWidget.tsx` — 기존 위젯 확인
  - `web/src/components/ops/v2/LeftRail.tsx:125-154` — CircuitBreakerRow
  - `web/src/components/ops/v2/ThreadApprovalActions.tsx` — AlertDialog + API + toast 패턴 참고
  - `web/src/components/ops/CircuitBreakerMap.tsx` — V1 리셋 UX 참고
  - `web/src/lib/api/operations.ts:resetCircuitBreaker(projectId)` — 기존 API 함수
  - `web/src/components/ui/alert-dialog.tsx` — Radix AlertDialog

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: CB 리셋 버튼 + 확인 다이얼로그
    Tool: Bash (grep)
    Steps:
      1. LeftRail에서 resetCircuitBreaker API 함수 import 확인
      2. AlertDialog 사용 확인
      3. state === 'open'일 때만 리셋 버튼 조건부 표시 확인
      4. i18n 키 존재 확인
    Expected Result: open 상태 CB에 리셋 버튼 + 확인 다이얼로그 코드 존재
    Failure Indicators: 확인 없이 바로 리셋, 모든 상태에 버튼 표시

  Scenario: 빌드 확인
    Tool: Bash
    Steps: `npm run typecheck && npm run build`
    Expected Result: 성공
  ```

  **Commit**: YES
  - Message: `feat(web): wire circuit breaker reset with confirmation in ops center`
  - Files: `LeftRail.tsx`, `CircuitBreakerWidget.tsx`, `OpsCenterV2.tsx`, `ko.ts`, `en.ts`

---

### Wave 3: 에러 처리 + 마무리

---

- [ ] 7. 에러 처리 및 상태 피드백 강화

  **What to do**:

  **7-A: 에러 타입 분류**
  - `web/src/hooks/use-ops-center-data.ts`:
    - 현재 `error: string | null` → 에러 객체로 확장: `{ type: 'connection_lost' | 'api_error' | 'timeout', message: string, retryCount?: number }`
    - SSE 끊김 시: `type: 'connection_lost'`, retryCount 포함
    - REST API 실패 시: `type: 'api_error'`, HTTP 상태 포함
    - 타임아웃 시: `type: 'timeout'`

  **7-B: 에러 배너 UI**
  - `web/src/pages/OpsCenterV2.tsx`:
    - 재연결 중: 상단 노란색 배너 + 스피너 + "실시간 연결 재시도 중 (2/5)"
    - 완전 실패: 빨간색 배너 + "연결에 실패했습니다" + 수동 재시도 버튼
    - 성공 복귀: 배너 자동 사라짐
  - i18n 키 추가: `opsV2.errors.connectionLost`, `opsV2.errors.retrying`, `opsV2.errors.apiError`, `opsV2.errors.retry`

  **Must NOT do**:
  - use-ops-center-data.ts의 SSE/REST 연결 로직 자체를 변경하지 않기 (에러 보고만 강화)

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9)
  - **Blocks**: Task 9
  - **Blocked By**: Task 2 (MainFeedGrid 구조 안정화)

  **References**:
  - `web/src/hooks/use-ops-center-data.ts:45-60` — 상태 초기화
  - `web/src/hooks/use-ops-center-data.ts:101` — 현재 에러 설정
  - `web/src/hooks/use-ops-center-data.ts:104-115,183-194,203-214` — 재시도 로직
  - `web/src/hooks/use-ops-center-data.ts:286-291` — retry() 함수
  - `web/src/pages/OpsCenterV2.tsx` — 에러 배너 추가 위치

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: 에러 타입 분류
    Tool: Bash (grep)
    Steps:
      1. use-ops-center-data.ts에서 에러 객체 타입 정의 확인
      2. connection_lost, api_error, timeout 분기 확인
    Expected Result: 에러 타입별 분류 코드 존재
    Failure Indicators: 단순 string 에러 유지

  Scenario: 에러 배너 UI
    Tool: Bash (grep)
    Steps:
      1. OpsCenterV2.tsx에서 에러 배너 렌더링 코드 확인
      2. isReconnecting 시 노란색 배너 + 재시도 카운트 표시 확인
      3. error 시 빨간색 배너 + 재시도 버튼 확인
      4. i18n 키 존재 확인
    Expected Result: 상황별 에러 배너 코드 존재
    Failure Indicators: 에러 시 UI 피드백 없음

  Scenario: 빌드 확인
    Tool: Bash
    Steps: `npm run typecheck && npm run build`
    Expected Result: 성공
  ```

  **Commit**: YES
  - Message: `fix(web): add error banners with retry feedback to ops center`
  - Files: `use-ops-center-data.ts`, `OpsCenterV2.tsx`, `ko.ts`, `en.ts`

---

- [ ] 8. 빈 상태 UI 통일

  **What to do**:
  - 각 섹션의 빈 상태 검토 및 통일:
    - `MainFeedGrid.tsx` (Lines 320-330): 활동 없음
    - `LeftRail.tsx`: 인시던트 없음, 승인 대기 없음, CB 없음
  - 빈 상태 유형 분리:
    - 필터 적용 중 빈 결과: "선택한 필터에 해당하는 활동이 없습니다" + 필터 초기화 링크
    - 전체 빈 상태: "현재 운영 활동이 없습니다. 모든 시스템이 정상입니다."
  - 일관된 패턴: muted 텍스트 + 간결한 설명 (아이콘은 기존 패턴 따름)
  - i18n 키 추가/확인

  **Must NOT do**:
  - 새 빈 상태 전용 컴포넌트 만들지 않기 (인라인 패턴 사용)

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 9)
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 2 (MainFeedGrid), 6 (CB 위젯)

  **References**:
  - `web/src/components/ops/v2/MainFeedGrid.tsx:320-330` — 기존 빈 상태
  - `web/src/components/ops/v2/LeftRail.tsx:277,296,319` — 기존 빈 상태 메시지

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: 빈 상태 일관성
    Tool: Bash (grep)
    Steps:
      1. MainFeedGrid와 LeftRail의 빈 상태 i18n 키 확인
      2. 필터 적용 시 별도 메시지 분기 확인
    Expected Result: 모든 빈 상태에 i18n 키 사용, 상황별 분리
    Failure Indicators: 하드코딩 문자열, 단일 메시지만 사용

  Scenario: 빌드 확인
    Tool: Bash
    Steps: `npm run typecheck && npm run build`
    Expected Result: 성공
  ```

  **Commit**: YES
  - Message: `fix(web): unify empty states across ops center sections`
  - Files: `MainFeedGrid.tsx`, `LeftRail.tsx`, `ko.ts`, `en.ts`

---

- [ ] 9. i18n 전수 감사

  **What to do**:
  - Task 1-8에서 추가된 모든 i18n 키가 en.ts와 ko.ts 양쪽에 존재하는지 전수 확인
  - raw 키가 UI에 표시되는 곳 grep으로 검색
  - 하드코딩 문자열 있으면 `t()` 호출로 교체
  - 한국어 번역 품질 확인 (기술 용어는 영어 유지: Docker, Container, Circuit Breaker)
  - en.ts와 ko.ts 간 키 수 일치 검증

  **Must NOT do**:
  - 기존 (변경하지 않은) 번역 키 수정하지 않기
  - 새 i18n 시스템 도입하지 않기

  **Recommended Agent Profile**: `executor` (model=sonnet)

  **Parallelization**:
  - **Can Run In Parallel**: YES (but ideally last)
  - **Parallel Group**: Wave 3 (with Tasks 7, 8)
  - **Blocks**: None
  - **Blocked By**: Tasks 1-8 (모든 i18n 변경 완료 후)

  **References**:
  - `web/src/i18n/en.ts` — 영어 번역 파일
  - `web/src/i18n/ko.ts` — 한국어 번역 파일
  - `web/src/i18n/context.tsx` — `useLanguage()` 훅, `t()` 함수

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: 한국어 번역 완전성
    Tool: Bash
    Steps:
      1. ko.ts에서 opsV2.* 키 수 추출
      2. en.ts에서 opsV2.* 키 수 추출
      3. 양쪽 키 수 일치 확인
      4. 새로 추가한 파일들에서 t() 미사용 하드코딩 문자열 grep
    Expected Result: 키 수 일치, 하드코딩 문자열 0건
    Failure Indicators: 키 수 불일치, 하드코딩 발견

  Scenario: 최종 빌드 확인
    Tool: Bash
    Steps: `npm run typecheck && npm run build && npm run lint`
    Expected Result: 전부 성공
  ```

  **Commit**: YES
  - Message: `chore(web): audit and fix i18n coverage for ops center`
  - Files: `ko.ts`, `en.ts`

---

## Verification Strategy

### Build Verification (Every Task)

```bash
npm run typecheck  # TypeScript 에러 없음
npm run build      # 빌드 성공
```

### Final Verification (Wave 3 완료 후)

```bash
npm run typecheck && npm run build && npm run lint
```

### Manual Spot Checks

- 한국어 모드: 운영 센터 전체에서 raw 영문 키/타입 0건
- 영어 모드: 한국어 문자열 잔존 0건
- 스레드 펼침: 동일 텍스트 2회 표시 0건
- 사이드바: 프로젝트명 + 시간 표시 확인
- SSE 끊김 시: 에러 배너 표시 확인

---

## Commit Strategy

| Wave | Message                                          | Key Files                                |
| ---- | ------------------------------------------------ | ---------------------------------------- |
| 1    | `fix(web): unify severity/event i18n keys...`    | SeverityBadge, utils, MainFeedGrid, i18n |
| 1    | `fix(web): remove thread info duplication...`    | MainFeedGrid                             |
| 1    | `fix(web): add project name, time to sidebar...` | LeftRail                                 |
| 2    | `feat(web): display AI metadata in ops feed`     | MainFeedGrid, i18n                       |
| 2    | `feat(web): add cascade group visualization`     | MainFeedGrid, i18n                       |
| 2    | `feat(web): wire circuit breaker reset...`       | LeftRail, CB Widget, i18n                |
| 3    | `fix(web): add error banners with retry...`      | use-ops-center-data, OpsCenterV2, i18n   |
| 3    | `fix(web): unify empty states...`                | MainFeedGrid, LeftRail, i18n             |
| 3    | `chore(web): audit i18n coverage...`             | ko.ts, en.ts                             |

---

## Success Criteria

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] 9 tasks completed
- [ ] 사용자 피드백 6건 전부 해결
- [ ] typecheck + build + lint 모두 통과
- [ ] 한국어 모드에서 raw 영문 0건
- [ ] 스레드 중복 정보 0건
- [ ] 사이드바에 프로젝트명 + 시간 표시
