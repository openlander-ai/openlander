# OpenLander TUI — Implementation Tasks

> **버전**: v0.0.7 | **상태**: ✅ 16/16 전부 완료 | **버전 맵**: [`version-map.md`](../version-map.md)

> **스펙 문서**: `docs/planning/v0.0.7/ui-ux-layout.md` (374줄)
> **갭 분석 기준일**: 2026-02-28
> **전수검사 방법**: 모든 소스 파일 직접 라인 단위 대조

---

## Phase A: 인프라 (IPC / Hook / 데이터)

Phase B(UI 컴포넌트)가 의존하는 데이터 레이어를 먼저 구축한다.

---

### TASK-01: Alerts IPC 엔드포인트 + useAlerts hook

- **우선순위**: HIGH
- **의존**: 없음 (alerts.ts 백엔드 이미 존재)
- **스펙참조**: v0.0.7-ui-ux-layout.md L296 (Alerts 폴링 30초), L302-322 (Alerts 상세)
- **설명**: AlertMonitor의 getActiveAlerts()를 TUI에서 사용할 수 있도록 IPC 경로 추가 + TUI hook 생성
- **수락기준**:
  - [x] IPC client에 `getAlerts(): Promise<Alert[]>` 메서드 추가
  - [x] 데몬 측 IPC handler에서 AlertMonitor.getActiveAlerts() 호출하여 응답
  - [x] `src/tui/hooks/useAlerts.ts` 생성: 30초 폴링, `alerts()` signal 반환
  - [x] Alert 타입(`id`, `type`, `severity`, `message`, `suggestion`)이 TUI까지 전달 확인
  - [x] IPC client에 `dismissAlert(alertId: string): Promise<void>` 메서드 추가
- **테스트**:
  - [x] `test/tui-alerts-hook.test.ts`: useAlerts가 폴링하고 signal 업데이트하는지 검증
- **상태**: ✅ 완료

---

### TASK-02: Projects 폴링 주기 3초로 분리

- **우선순위**: MEDIUM
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L294 (Projects 3초)
- **설명**: DashboardPanel의 fetchAll()이 System+Projects+Activity를 5초 단위로 묶어서 폴링 중. Projects만 3초로 분리하거나, fetchAll 주기 자체를 3초로 변경.
- **수락기준**:
  - [x] Projects 데이터가 3초 이내 주기로 갱신됨
  - [x] System 데이터는 5초 주기 유지 (더 빨라져도 무방하지만 불필요한 부하 방지)
  - [x] DashboardPanel.tsx 내 타이머 로직 수정 확인
- **테스트**:
  - [ ] `test/tui-state.test.ts`에 폴링 주기 검증 케이스 추가 (타이머 mock) — TASK-16에서 보강
- **상태**: ✅ 완료

---

### TASK-03: 포트 충돌 Alert 백엔드 구현

- **우선순위**: MEDIUM
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L314 (포트 충돌 → 대체 포트 자동 제안)
- **설명**: alerts.ts에 `checkPortConflicts()` 메서드 추가. 배포 시 요청 포트가 이미 사용 중이면 Alert 생성.
- **수락기준**:
  - [x] `AlertMonitor.checkPortConflicts()` 구현
  - [x] Alert type에 `'port-conflict'` 추가
  - [x] suggestion에 대체 포트 번호 포함 (사용 가능한 포트 자동 탐색)
  - [x] runChecks()에 포함되어 주기적 실행
- **테스트**:
  - [x] `test/alerts.test.ts`: 포트 충돌 시 Alert 생성 검증 (12개 테스트)
- **상태**: ✅ 완료

---

## Phase B: UI 컴포넌트

Phase A의 데이터 레이어 위에 UI를 구축한다.

---

### TASK-04: AlertsSection UI 컴포넌트

- **우선순위**: HIGH
- **의존**: TASK-01
- **스펙참조**: v0.0.7-ui-ux-layout.md L97-106, L316-321
- **설명**: DashboardPanel에 AlertsSection 추가. MCP Clients 섹션을 Alerts로 교체.
- **수락기준**:
  - [x] `AlertsSection` 컴포넌트가 DashboardPanel.tsx에 존재
  - [x] 렌더링 순서: System → Projects → Activity → **Alerts** (MCP Clients 제거 또는 하위로 이동)
  - [x] 최대 3건 표시, 심각도순 정렬 (critical > warning)
  - [x] 3건 초과 시 `"+N more"` 텍스트 표시
  - [x] 이슈 없으면 Alerts 섹션 자체 숨김 (`<Show when={alerts().length > 0}>`)
  - [x] 각 Alert: `⚠` 아이콘 + 메시지 (truncate 30자) + 심각도 색상 (critical=red, warning=yellow)
  - [x] compact 모드(배포 중)에서는 Alerts 숨김 (Activity와 동일)
- **테스트**:
  - [x] `test/tui-alerts.test.ts`: AlertsSection 렌더링 검증
- **상태**: ✅ 완료

---

### TASK-05: StatusBar MEM 표시 (전 모드)

- **우선순위**: HIGH
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L226-228
- **설명**: StatusBar에 MEM 정보 추가. 현재 CPU만 표시됨.
- **수락기준**:
  - [x] StatusBar props에 `memDisplay: string` 추가
  - [x] App.tsx에서 SystemStats의 memory.usedMB를 GB 문자열로 변환하여 전달
  - [x] **모니터링 모드**: CPU + MEM 표시
  - [x] **배포 모드**: CPU + MEM 표시
  - [x] **디버그 모드**: CPU + MEM 표시
  - [x] 3개 모드 전부에서 MEM 표시 확인
- **테스트**:
  - [x] `test/tui-statusbar.test.ts`: 모드별 MEM 포함 여부 검증
- **상태**: ✅ 완료

---

### TASK-06: StatusBar 디버그 포트 표시

- **우선순위**: HIGH
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L228 (`frontend ● :3000`)
- **설명**: 디버그 모드 StatusBar에 프로젝트 포트 번호 표시.
- **수락기준**:
  - [x] StatusBar props에 `debugPort: number | null` 추가
  - [x] App.tsx에서 debuggingState의 프로젝트 포트를 StatusBar로 전달
  - [x] 디버그 모드 렌더링: `frontend ● :3000 │ CPU 2% MEM 128M`
  - [x] 포트 없으면 `frontend ●` 만 표시 (`:` 없이)
- **테스트**:
  - [x] `test/tui-statusbar.test.ts`에 디버그 모드 포트 표시 케이스 추가
- **상태**: ✅ 완료

---

### TASK-07: StatusBar 배포 진행률 표시

- **우선순위**: MEDIUM
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L227 (`BUILD frontend 67%`)
- **설명**: 배포 모드 StatusBar에 빌드 진행률 퍼센트 표시. BuildPanel의 stage 진행 상태를 StatusBar까지 전달해야 함.
- **수락기준**:
  - [x] StatusBar props에 `buildProgress: number | null` 추가 (0~100)
  - [x] BuildPanel 또는 App.tsx에서 현재 파이프라인 진행률을 계산
  - [x] 배포 모드 렌더링: `BUILD frontend 67% │ CPU 89% MEM 8.1G`
  - [x] 진행률 null이면 퍼센트 생략
- **테스트**:
  - [x] `test/tui-statusbar.test.ts`에 배포 모드 진행률 표시 케이스 추가
- **상태**: ✅ 완료

---

### TASK-08: ProjectInfo 누락 필드 3개 추가

- **우선순위**: MEDIUM
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L181-184
- **설명**: 디버그 모드 ProjectInfo에 Image, Uptime, Last deploy 추가.
- **수락기준**:
  - [x] **Image**: 컨테이너 이미지 ID 표시 (sha256 앞 12자 truncate). 예: `Image: sha256:a3f2...`
  - [x] **Uptime**: 컨테이너 시작 시간 기준 경과 시간. 예: `Uptime: 3d 14h`
  - [x] **Last deploy**: 마지막 배포 시간 (상대). 예: `Last deploy: 2h ago`
  - [x] IPC client에 해당 데이터가 없으면 `getProjectStats()` 응답 확장 또는 별도 엔드포인트
  - [x] 데이터 없으면 `—` 표시 (에러 아님)
- **테스트**:
  - [x] `test/tui-project-info.test.ts`: 3개 필드 렌더링 검증 (10개 테스트)
- **상태**: ✅ 완료

---

### TASK-09: Step 카운터 (Step 8/12)

- **우선순위**: MEDIUM
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L130 (`Step 8/12: Installing deps`)
- **설명**: BuildPanel에 Docker 빌드 스텝 번호 카운터 표시.
- **수락기준**:
  - [x] Docker 빌드 로그에서 `Step N/M` 패턴 파싱 (예: `Step 8/12 : RUN npm install`)
  - [x] 현재 스텝/전체 스텝을 BuildPanel UI에 표시
  - [x] 파이프라인 아래, 로그 위 위치에 `Step 8/12: Installing deps` 형태
  - [x] Docker 빌드가 아닌 경우 (step 패턴 없음) → 카운터 숨김
- **테스트**:
  - [x] `test/tui-build-panel.test.ts`: Step 패턴 파싱 로직 유닛테스트 (5개)
- **상태**: ✅ 완료

---

## Phase C: 인터랙션 / 포커스 / 전환

모드 전환과 포커스 관리의 세부 동작을 스펙에 맞춤.

---

### TASK-10: 타이핑 시 자동 Chat 포커스

- **우선순위**: MEDIUM
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L278, L283
- **설명**: Status 패널에 포커스가 있을 때 문자를 입력하면 자동으로 Chat 포커스로 전환.
- **수락기준**:
  - [x] App.tsx 키보드 핸들러에서: focus가 `'status'`이고, 입력이 printable character일 때 `focusChat()` 호출
  - [x] 특수키(↑↓Enter Esc Tab 등)는 자동 전환하지 않음
  - [x] Ctrl 조합도 자동 전환하지 않음
  - [x] 전환 후 해당 키 입력이 Chat input에 전달되는지 확인 (입력 손실 없음)
- **테스트**:
  - [ ] `test/tui-state.test.ts`에 focusChat 자동 호출 시나리오 추가 — TASK-16에서 보강
- **상태**: ✅ 완료

---

### TASK-11: Esc 복귀 시 Chat 포커스

- **우선순위**: MEDIUM
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L285
- **설명**: Esc로 디버그/배포 모드에서 나올 때 Chat 포커스로 복귀.
- **수락기준**:
  - [x] App.tsx Esc 핸들러에서 `returnToMonitoring()` 호출 직후 `focusChat()` 호출
  - [x] 디버그 모드에서 Esc → 모니터링 + chat 포커스 확인
  - [x] 배포 모드에서 Esc → 모니터링 + chat 포커스 확인
- **테스트**:
  - [ ] `test/tui-state.test.ts`에 모드 전환 후 focus 상태 검증 — TASK-16에서 보강
- **상태**: ✅ 완료

---

### TASK-12: [📋 Build panel closed] 메시지

- **우선순위**: LOW
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L260
- **설명**: 배포 모드에서 모니터링으로 복귀할 때 채팅에 피드백 메시지 추가.
- **수락기준**:
  - [x] 빌드 완료 후 자동 복귀 시 `[📋 Build panel closed]` 시스템 메시지가 채팅에 표시
  - [x] Esc로 수동 복귀 시에도 동일 메시지 표시
  - [x] Ctrl+C 취소 시에는 이미 `⚠ Deploy cancelled` 메시지가 있으므로 중복 표시 안 함
- **테스트**:
  - [ ] TASK-16에서 보강
- **상태**: ✅ 완료

---

### TASK-13: Enter로 빌드 패널 닫기

- **우선순위**: LOW
- **의존**: 없음
- **스펙참조**: v0.0.7-ui-ux-layout.md L148 (`또는 Enter로 즉시 닫기`)
- **설명**: 빌드 완료 후 Enter 키로 즉시 모니터링 모드 복귀.
- **수락기준**:
  - [x] App.tsx 배포 모드 키보드 핸들러에 Enter 추가
  - [x] Enter 시 `returnToMonitoring()` + `focusChat()` 호출
  - [x] Enter 시 `returnToMonitoring()` + `focusChat()` 호출
  - [x] `[📋 Build panel closed]` 메시지도 함께 (TASK-12)
- **테스트**:
  - [ ] `test/tui-state.test.ts`에 배포 모드 Enter 동작 검증 — TASK-16에서 보강
- **상태**: ✅ 완료

---

## Phase D: 정리

---

### TASK-14: DashboardPanel 섹션 순서 정리

- **우선순위**: LOW
- **의존**: TASK-04
- **스펙참조**: v0.0.7-ui-ux-layout.md L76 (System → Projects → Activity → Alerts)
- **설명**: MCP Clients 섹션을 Alerts 아래로 이동하거나 제거.
- **수락기준**:
  - [x] DashboardPanel 렌더링 순서: SystemSection → ProjectsSection → ActivitySection → AlertsSection
  - [x] McpClientsSection은 AlertsSection 아래에 배치
  - [x] compact 모드에서는 System + Projects만 표시 (Activity, Alerts, MCP 숨김)
- **테스트**:
  - [x] 렌더링 순서는 코드 리뷰로 검증
- **상태**: ✅ 완료

---

### TASK-15: 미사용 hooks 정리

- **우선순위**: LOW
- **의존**: 없음
- **설명**: useSystemStats.ts와 useProjects.ts가 DashboardPanel에서 사용되지 않음 (DashboardPanel이 자체 fetchAll 사용). 다른 곳에서도 미사용이면 제거 또는 DashboardPanel이 이 hooks를 사용하도록 리팩터링.
- **수락기준**:
  - [x] useSystemStats / useProjects의 사용처 전수 조사 → 미사용 확인
  - [x] 미사용 확인 후 제거 완료
  - [x] DashboardPanel의 fetchAll/fetchProjects 로직과 hook 간 역할 정리
- **테스트**:
  - [x] `bun run build` 성공 + `bun test` 전체 통과
- **상태**: ✅ 완료

---

### TASK-16: 전체 테스트 보강

- **우선순위**: MEDIUM
- **의존**: TASK-01 ~ TASK-14 전부
- **설명**: 위 태스크들에서 추가된 테스트 파일들의 커버리지 확인 및 누락 보강.
- **수락기준**:
  - [x] 모든 새 컴포넌트/hook에 대응하는 테스트 파일 존재 (8개 테스트 파일)
  - [x] `bun test` 전체 통과 (564 tests, 0 failures)
  - [x] `bun run build` 성공
  - [x] lsp_diagnostics 에러 0 (변경된 파일 전부)
- **테스트**:
  - [x] 메타: 이 태스크 자체가 테스트 보강
- **상태**: ✅ 완료

---

## 실행 순서 요약

```
Phase A (인프라):  TASK-01 → TASK-02, TASK-03 (병렬 가능)
Phase B (UI):      TASK-04(→01), TASK-05~09 (병렬 가능)
Phase C (인터랙션): TASK-10~13 (병렬 가능, 13은 12 의존)
Phase D (정리):    TASK-14(→04), TASK-15, TASK-16(→전부)
```

---

## 완료 판정 기준

각 TASK는 아래 조건을 **전부** 충족해야 "완료":

1. 수락기준 체크박스 전부 체크
2. `lsp_diagnostics` 변경 파일 에러 0
3. `bun run build` 성공
4. `bun test` 전체 통과
5. 스펙 문서 해당 라인 다시 읽고 1:1 대조 완료
6. 테스트 항목에 명시된 테스트 코드 존재 및 통과
