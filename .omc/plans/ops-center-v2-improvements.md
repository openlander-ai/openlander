# OpsCenterV2 UX/UI 개선 계획

> **범위**: OpsCenterV2 메인 대시보드 집중 개선
> **목표**: 사용자가 운영 상황을 정확히 인지하고 판단할 수 있도록 정보 명확성과 UI 일관성 확보

---

## 요구사항 요약

사용자 피드백 기반 핵심 문제:

1. 심각도 태그 한/영 혼재
2. 감지 이벤트 타입 영문 그대로 노출 (`deploy:crash`)
3. 스레드 펼칠 때 정보 중복 (부모행 = 자식행)
4. 세부정보 버튼 유무 기준 불명확
5. 왼쪽 사이드바 "현재 문제" — 프로젝트명/시간 누락
6. 에러 발생 시 사용자 판단을 위한 정보 부족

---

## 인수 기준 (Acceptance Criteria)

- [ ] AC-1: 모든 심각도 표시가 현재 언어 설정에 맞게 통일 (한국어면 전부 한국어, 영어면 전부 영어)
- [ ] AC-2: 모든 이벤트 타입이 사용자 언어로 번역되어 표시 (raw 영문 키 노출 0건)
- [ ] AC-3: 스레드 펼칠 때 부모행과 첫 자식행 간 중복 정보 제거
- [ ] AC-4: 세부정보가 있는 이벤트는 바로 표시하거나, 없는 경우 명확한 시각적 구분
- [ ] AC-5: 왼쪽 사이드바 인시던트에 프로젝트명 + 상대 시간 표시
- [ ] AC-6: API 에러 시 사용자에게 구체적 피드백 (재시도 버튼, 에러 유형 안내)

---

## 구현 단계

### Phase 1: i18n 정합성 (심각도 + 이벤트 타입 번역)

#### Step 1-1: SeverityBadge 번역 키 통일

**파일**: `web/src/components/ops/SeverityBadge.tsx`

**현재 문제**:

- Line 20: `t('operations.severity.critical')` → 번역은 되지만, `opsV2` 네임스페이스와 불일치
- Line 40: `severity` 값을 그대로 표시 (info 등 critical/warning 외 값은 번역 없음)

**변경 사항**:

1. `info` 심각도에 대한 분기 추가 (현재 critical/warning만 처리)
2. 번역 키를 `opsV2.severity.critical`, `opsV2.severity.warning`, `opsV2.severity.info`로 통일
3. i18n 파일에 `opsV2.severity.*` 키 추가:
   - `ko.ts`: `{ critical: '위험', warning: '경고', info: '정보' }`
   - `en.ts`: `{ critical: 'Critical', warning: 'Warning', info: 'Info' }`

**검증**: SeverityBadge가 사용되는 모든 곳(MainFeedGrid, LeftRail, IncidentCard)에서 한/영 혼재 없음 확인

---

#### Step 1-2: 이벤트 타입 번역 누락 해소

**파일**: `web/src/components/ops/utils.ts` (Lines 138-154)

**현재 문제**:

- `humanizeEventType()` 함수가 번역 키 없으면 raw 영문을 title-case로 표시
- `extractEventType()`에서 `ai:*` → `ai_intervention` 변환은 되지만, 다른 접두사 패턴 누락 가능

**변경 사항**:

1. `i18n/ko.ts`의 `operations.events.*`에 누락 키 보강:
   - 현재 있는 키: `deploy_crash`, `container_exit`, `health_check_fail`, `oom_kill`, `restart_loop`, `build_failure`, `port_conflict`, `dns_resolution`, `image_pull`, `unknown`
   - 추가 필요: `recovery_started`, `recovery_failed`, `recovery_completed`, `approval_pending`, `approval_approved`, `approval_rejected`, `circuit_breaker_open`, `circuit_breaker_reset`, `ai_intervention`, `cascade_detected`, `cleanup`, `alert_sent`
2. `en.ts`에도 동일 키 추가
3. `humanizeEventType()` 폴백 로직 개선: 번역 키 없으면 로그 경고 + 폴백도 번역 시도

**파일**: `web/src/components/ops/v2/MainFeedGrid.tsx` (Line 131)

**현재 문제**:

- `humanizeEventType(head.type, (k) => k)` — identity 함수를 번역 함수 대신 전달

**변경 사항**:

- 실제 `t` 함수 전달로 교체

**검증**: Activity Feed에서 영문 raw 키가 표시되는 이벤트 0건 확인

---

#### Step 1-3: MainFeedGrid 내 TITLE_PATTERNS 보강

**파일**: `web/src/components/ops/v2/MainFeedGrid.tsx` (Lines 24-36)

**현재 문제**:

- `TITLE_PATTERNS`에 정의된 패턴만 번역, 나머지는 원문 그대로

**변경 사항**:

1. 현재 패턴 검토 후 누락 패턴 추가 (recovery 관련, circuit breaker 관련)
2. `localizeTitle()` 폴백: 패턴 매칭 실패 시 `humanizeEventType()` 경유하여 번역 시도
3. i18n 파일에 `opsV2.titles.*` 키 보강

**검증**: 타이틀 영역에 영문이 혼재되는 케이스 0건

---

### Phase 2: 정보 중복 제거 + 세부정보 개선

#### Step 2-1: 스레드 펼침 시 중복 정보 제거

**파일**: `web/src/components/ops/v2/MainFeedGrid.tsx`

**현재 문제**:

- 부모 스레드 행 (Lines 390-470): 프로젝트명 + 타이틀 + 심각도 + 상태 + 이벤트 수 + 시간
- 첫 번째 자식 이벤트 행 (ThreadEventDenseRow, Lines 166-265): 시간 + 이벤트명(=부모 타이틀과 동일) + 심각도 + 상태
- "자동복구실패" 같은 타이틀이 부모행과 자식행 모두에 표시

**변경 사항**:

1. `ThreadEventDenseRow`에서 부모 스레드 타이틀과 동일한 경우 타이틀 숨김 처리
   - `threadTitle` prop 추가 → `titleText === threadTitle`이면 타이틀 생략하고 시간/상태만 표시
2. 자식 이벤트가 1개인 경우: 부모행에 세부정보를 인라인 표시 (별도 펼침 불필요)
3. 자식 이벤트가 2개 이상인 경우: 부모행은 요약, 자식행은 시간 + 고유 정보만 표시

**검증**: 펼쳤을 때 동일 텍스트가 2번 이상 나타나는 경우 0건

---

#### Step 2-2: 세부정보 표시 로직 개선

**파일**: `web/src/components/ops/v2/MainFeedGrid.tsx` (Lines 166-172, 205-262)

**현재 문제**:

- `hasDetails = !!event.description || !!event.aiMetadata?.diagnosisSummary` (Line 171)
- 이 조건에 해당하지 않는 이벤트는 세부정보 버튼 자체가 없음
- 사용자는 왜 어떤 건 버튼이 있고 어떤 건 없는지 알 수 없음

**변경 사항**:

1. 세부정보가 있는 이벤트: 자동 펼침 (클릭 불필요) — description이 짧으면 (100자 미만) 인라인 표시
2. 세부정보가 없는 이벤트: "추가 정보 없음" 같은 별도 표시 불필요, 대신 세부정보가 있는 이벤트와 시각적으로 구분
   - 세부정보 있는 행: 좌측에 작은 인포 아이콘 또는 약간 다른 배경
3. AI 진단 결과(`aiMetadata.diagnosisSummary`)는 항상 펼쳐서 표시 (중요 정보)

**검증**: 세부정보가 있는 이벤트의 내용이 클릭 없이 바로 확인 가능

---

### Phase 3: 왼쪽 사이드바(LeftRail) 개선

#### Step 3-1: IncidentRow에 프로젝트명/시간 추가

**파일**: `web/src/components/ops/v2/LeftRail.tsx` (Lines 58-98)

**현재 문제**:

- `IncidentRow`가 triggerType 기반 타이틀만 표시 (Line 75-79)
- 프로젝트명 없음, 시간 없음
- 사이드바만 보면 어떤 프로젝트의 어떤 시점 문제인지 파악 불가

**변경 사항**:

1. `IncidentRow` props 확장: `projectName`, `lastEventTime` 추가
2. 레이아웃 변경:
   ```
   ● [프로젝트명]          [3분 전]
     배포 실패 (×2)
   ```
3. 그룹핑 로직 수정 (Lines 213-225): 그룹별 `projectName`, 가장 최근 이벤트 시간 추출
4. `relativeTime()` 유틸 활용 (`utils.ts` Line 1-14)
5. collapsed 상태에서는 아이콘 + 프로젝트명 첫 글자 표시

**검증**: 사이드바 인시던트 항목에 프로젝트명과 상대 시간이 표시됨

---

#### Step 3-2: 사이드바 심각도 표시 강화

**파일**: `web/src/components/ops/v2/LeftRail.tsx` (Lines 68-73)

**현재 문제**:

- 심각도가 작은 색상 dot으로만 표시 (`w-2 h-2 rounded-full`)
- 레이블 없이 색상만으로는 구분 어려움

**변경 사항**:

1. dot 옆에 심각도 텍스트 레이블 추가 (SeverityBadge 컴포넌트 재사용, size=sm)
2. critical 인시던트는 배경 하이라이트 (`bg-error/5`)

**검증**: 사이드바에서 심각도를 텍스트로 확인 가능

---

### Phase 4: 에러 처리 및 상태 피드백 강화

#### Step 4-1: API 에러 시 사용자 피드백 개선

**파일**: `web/src/pages/OpsCenterV2.tsx`, `web/src/hooks/use-ops-center-data.ts`

**현재 문제**:

- `use-ops-center-data.ts`에서 에러를 string으로만 저장 (Line 101)
- SSE 연결 끊김, API 실패 등 상황별 구체적 안내 부족

**변경 사항**:

1. 에러 타입 분류:
   - `connection_lost`: SSE 연결 끊김 → "실시간 연결이 끊어졌습니다. 재연결 중..." + 재시도 카운트
   - `api_error`: REST API 실패 → "데이터를 불러올 수 없습니다" + 구체적 HTTP 상태
   - `timeout`: 응답 없음 → "서버 응답이 없습니다"
2. OpsCenterV2에 에러 배너 컴포넌트 추가:
   - 재연결 중: 상단에 노란색 배너 + 스피너 + "재연결 시도 중 (2/5)"
   - 완전 실패: 빨간색 배너 + 수동 재시도 버튼
3. i18n 키 추가: `opsV2.errors.connectionLost`, `opsV2.errors.apiError`, `opsV2.errors.timeout`, `opsV2.errors.retrying`

**검증**: SSE 끊김/API 에러 시 사용자가 현재 상태와 대응 방법을 명확히 인지 가능

---

#### Step 4-2: 빈 상태(Empty State) 개선

**파일**: `web/src/components/ops/v2/MainFeedGrid.tsx` (Lines 320-330)

**현재 문제**:

- 활동이 없을 때 단순 텍스트만 표시

**변경 사항**:

1. 빈 상태 메시지를 상황별로 분리:
   - 필터 적용 중 빈 결과: "선택한 필터에 해당하는 활동이 없습니다" + 필터 초기화 버튼
   - 전체 빈 상태: "현재 운영 활동이 없습니다. 모든 시스템이 정상입니다." + 아이콘
2. i18n 키 추가

**검증**: 빈 상태 시 사용자가 왜 비어있는지 이해 가능

---

## 위험 및 완화

| 위험                                         | 영향 | 완화 방안                                             |
| -------------------------------------------- | ---- | ----------------------------------------------------- |
| i18n 키 추가 시 기존 번역 깨짐               | 중   | 기존 키 유지하고 새 키만 추가, 폴백 체인 유지         |
| 세부정보 자동 펼침으로 피드 길어짐           | 중   | 100자 미만만 인라인, 긴 내용은 기존 토글 유지         |
| LeftRail 레이아웃 변경으로 반응형 깨짐       | 중   | collapsed 모드 별도 테스트, 기존 48px/320px 전환 유지 |
| ThreadEventDenseRow 타이틀 숨김 시 정보 손실 | 저   | 부모행에 이미 동일 정보 있으므로 손실 없음            |

---

## 검증 단계

1. **i18n 검증**: 한국어/영어 각각 전환하며 raw 영문 키 노출 여부 전수 확인
2. **레이아웃 검증**: 데스크톱(1920px) + 태블릿(768px) + 모바일(375px) 반응형 확인
3. **데이터 검증**: 인시던트 0건 / 1건 / 다수건 시나리오별 표시 확인
4. **에러 시나리오**: SSE 끊김 시뮬레이션, API 500 에러 시뮬레이션

---

## 구현 순서 및 예상 영향

| 순서 | Phase                          | 수정 파일 수 | 영향 범위                                            |
| ---- | ------------------------------ | ------------ | ---------------------------------------------------- |
| 1    | Phase 1 (i18n 정합성)          | 5개          | SeverityBadge, utils.ts, MainFeedGrid, ko.ts, en.ts  |
| 2    | Phase 2 (중복 제거 + 세부정보) | 1개          | MainFeedGrid.tsx                                     |
| 3    | Phase 3 (사이드바 개선)        | 1개          | LeftRail.tsx                                         |
| 4    | Phase 4 (에러 처리)            | 3개          | OpsCenterV2.tsx, use-ops-center-data.ts, ko.ts/en.ts |
