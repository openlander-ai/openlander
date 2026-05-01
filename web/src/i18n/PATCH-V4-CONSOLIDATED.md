# i18n Patch — v4 Design Migration (Consolidated A–F)

> Status: PATCH FILE — do NOT edit web/src/i18n/{en,ko}.ts directly.
> User merges manually per the i18n shared-file rule.

This file consolidates all new i18n keys added across Phases A–F of the
v4 design migration. Merge into `web/src/i18n/en.ts` and `web/src/i18n/ko.ts`.

---

## Phase C keys (Home, ProjectsGrid, Activity, ErrorSurface)

### English (en.ts)

```ts
// Home page
home_status_healthy: 'Healthy',
home_status_crashed: 'Crashed',
home_status_all_healthy: 'All services healthy',
home_status_some_crashed: '{count} service{plural} crashed',
home_section_projects: 'Projects',
home_section_activity: 'Recent Activity',
home_empty_projects: 'No projects yet',
home_empty_projects_hint: 'Create your first project to get started.',

// ProjectsGrid
projects_filter_placeholder: 'Filter projects…',
projects_empty_title: 'No projects',
projects_empty_body: 'Create a project to deploy your first service.',
projects_empty_action: 'New project',
projects_status_healthy: 'Healthy',
projects_status_crashed: 'Crashed',
projects_status_unknown: 'Unknown',

// ErrorSurface
error_blame_your_config: 'Your config',
error_blame_external: 'External',
error_blame_our_bug: 'Our bug',
error_fix_hint_label: 'Fix hint',
error_code_refs_label: 'Code refs',
```

### Korean (ko.ts)

```ts
// Home page
home_status_healthy: '정상',
home_status_crashed: '장애',
home_status_all_healthy: '모든 서비스 정상',
home_status_some_crashed: '{count}개 서비스 장애',
home_section_projects: '프로젝트',
home_section_activity: '최근 활동',
home_empty_projects: '프로젝트가 없습니다',
home_empty_projects_hint: '첫 번째 프로젝트를 만들어 시작하세요.',

// ProjectsGrid
projects_filter_placeholder: '프로젝트 필터…',
projects_empty_title: '프로젝트 없음',
projects_empty_body: '프로젝트를 만들어 첫 번째 서비스를 배포하세요.',
projects_empty_action: '새 프로젝트',
projects_status_healthy: '정상',
projects_status_crashed: '장애',
projects_status_unknown: '알 수 없음',

// ErrorSurface
error_blame_your_config: '설정 오류',
error_blame_external: '외부 원인',
error_blame_our_bug: '내부 버그',
error_fix_hint_label: '해결 방법',
error_code_refs_label: '코드 참조',
```

---

## Phase D keys (InfraMap, LogViewer)

### English (en.ts)

```ts
// InfraMap
inframap_demo_label: 'Sample data',
inframap_demo_hint: 'Showing sample topology. Deploy a project to see real services.',
inframap_node_healthy: 'healthy',
inframap_node_crashed: 'crashed',
inframap_agent_badge_title: 'Agent acted on this service recently',
inframap_empty_title: 'No services',
inframap_empty_body: 'This project has no services configured yet.',

// LogViewer states
logviewer_state_connecting: 'Connecting…',
logviewer_state_live: 'Live',
logviewer_state_reconnecting: 'Reconnecting',
logviewer_state_backfilling: 'Backfilling…',
logviewer_state_ended_fail: 'Failed',
logviewer_state_ended_success: 'Done',
logviewer_state_errored: 'Stream error',
logviewer_state_cancelled: 'Cancelled',
logviewer_action_copy: 'Copy',
logviewer_action_download: 'Download',
logviewer_action_kill: 'Kill build',
```

### Korean (ko.ts)

```ts
// InfraMap
inframap_demo_label: '샘플 데이터',
inframap_demo_hint: '샘플 토폴로지를 표시 중입니다. 프로젝트를 배포하면 실제 서비스가 표시됩니다.',
inframap_node_healthy: '정상',
inframap_node_crashed: '장애',
inframap_agent_badge_title: '에이전트가 최근 이 서비스에서 작업했습니다',
inframap_empty_title: '서비스 없음',
inframap_empty_body: '이 프로젝트에 아직 구성된 서비스가 없습니다.',

// LogViewer states
logviewer_state_connecting: '연결 중…',
logviewer_state_live: '라이브',
logviewer_state_reconnecting: '재연결 중',
logviewer_state_backfilling: '백필 중…',
logviewer_state_ended_fail: '실패',
logviewer_state_ended_success: '완료',
logviewer_state_errored: '스트림 오류',
logviewer_state_cancelled: '취소됨',
logviewer_action_copy: '복사',
logviewer_action_download: '다운로드',
logviewer_action_kill: '빌드 중단',
```
