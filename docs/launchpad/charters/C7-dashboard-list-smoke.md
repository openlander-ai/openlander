# Charter C7: Dashboard_AND_LIST_SMOKE

**Tier**: Best-Effort
**예상 소요**: 30분

## 1. Pre-condition

- C1~C6 완료 후 잔존 데이터 없음
- 또는 빈 상태에서도 실행 가능 (빈 상태 UX 검증)
- 임시 프로젝트 2개 (다양한 상태):
  - `qa-c7-running` (running)
  - `qa-c7-stopped` (stopped)

## 2. Scenarios

### C7S1_OVERVIEW_DASHBOARD_RENDER

/overview → KPI 6 카드, Live Activity Feed, Needs Attention, Project Health Grid.
**PASS**: 모든 섹션 console.error 0건 + 폴링 정상 동작 (10s 간격).

### C7S2_OVERVIEW_KPI_NUMBERS_NONZERO

running 프로젝트 ≥ 1 상태에서 KPI 카드 값 확인.
**PASS**: '활성 배포' 카드가 0이 아닌 정확한 카운트.

### C7S3_PROJECTS_GRID_VIEW_TOGGLE

/projects → Grid/Table 토글 → 새로고침 후 토글 상태 유지(localStorage).
**PASS**: 토글 동작 + 페이지 새로고침 후 유지.

### C7S4_PROJECTS_GRID_FILTER_ARCHIVED

'Show Archived' 체크박스 토글 → 아카이브된 프로젝트(있다면) 표시 변화.
**PASS**: 체크 시 archived 보임, off 시 안 보임.

### C7S5_DEPLOYMENTSLIST_FILTER

/deployments → status 필터 4개 버튼 (all/success/failed/building) 클릭.
**PASS**: 각 필터에 맞는 row만 표시.

### C7S6_DEPLOYMENTSLIST_TO_DETAIL

DeploymentsList row 클릭 → DeploymentDetail 진입.
**PASS**: build/runtime log 영역 표시 + Back 버튼으로 복귀.

### C7S7_EMPTY_STATES (빈 상태에서)

빈 상태 (모든 프로젝트 purge 후) → /overview, /projects, /deployments 진입.
**PASS**: 빈 상태 카피 + CTA 버튼 노출 (Create Project 등).

## 3. Output

표준 5섹션. 표 위주 (best-effort라 발견사항 위주).

## 4. Cleanup

```bash
docker ps -a --filter name=qa-c7-
```

## 5. Refs

- `web/src/pages/Overview.tsx`
- `web/src/pages/ProjectsGrid.tsx`
- `web/src/pages/DeploymentsList.tsx`
- `web/src/pages/DeploymentDetail.tsx`
