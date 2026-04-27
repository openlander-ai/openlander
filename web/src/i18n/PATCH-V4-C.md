# i18n Patch — Phase C (Page rewrites + PageHeader migration)

> User merges manually into `web/src/i18n/{en,ko}.ts` per the i18n shared-file rule.

## New keys (EN → KO)

### Home page (v4 hero)

```ts
// EN
'home.status.eyebrow': 'System status · just now',
'home.status.allHealthy': 'All {total} services running across {projects} projects.',
'home.status.crashed': '{crashed} of {total} services crashed · {healthy} running across {projects} projects.',
'home.projects.title': 'Projects',
'home.projects.viewAll': 'View all',
'home.projects.noProjects': 'No projects yet.',
'home.projects.createOne': 'Create one',
'home.activity.title': 'Recent activity',
'home.activity.subtitle': 'Audit log of deploys, config changes, and agent calls.',
'home.activity.viewAll': 'View all',

// KO
'home.status.eyebrow': '시스템 상태 · 방금 전',
'home.status.allHealthy': '{projects}개 프로젝트에서 {total}개의 서비스가 모두 실행 중입니다.',
'home.status.crashed': '{total}개 서비스 중 {crashed}개가 충돌 · {projects}개 프로젝트에서 {healthy}개 실행 중.',
'home.projects.title': '프로젝트',
'home.projects.viewAll': '전체 보기',
'home.projects.noProjects': '아직 프로젝트가 없습니다.',
'home.projects.createOne': '만들기',
'home.activity.title': '최근 활동',
'home.activity.subtitle': '배포, 설정 변경, 에이전트 호출 감사 로그.',
'home.activity.viewAll': '전체 보기',
```

### ProjectsGrid (v4 single-column list)

```ts
// EN
'projects.description': 'Create and manage your projects',
'projects.empty.title': "You don't have any projects yet",
'projects.empty.description': 'A project bundles related services — web, api, worker, db — that share environment and deploy together.',
'projects.empty.cta': 'Create your first project',
'projects.controls.filterPlaceholder': 'Filter projects…',
'projects.controls.tags': 'Tags',
'projects.controls.newestFirst': 'Newest first',
'projects.status.running': 'Running',
'projects.status.deploying': 'Deploying',
'projects.status.crashing': 'Crashing',
'projects.status.stopped': 'Stopped',
'projects.status.idle': 'Idle',

// KO
'projects.description': '프로젝트 생성 및 관리',
'projects.empty.title': '아직 프로젝트가 없습니다',
'projects.empty.description': '프로젝트는 환경을 공유하고 함께 배포되는 web, api, worker, db 등 관련 서비스를 묶습니다.',
'projects.empty.cta': '첫 번째 프로젝트 만들기',
'projects.controls.filterPlaceholder': '프로젝트 필터…',
'projects.controls.tags': '태그',
'projects.controls.newestFirst': '최신순',
'projects.status.running': '실행 중',
'projects.status.deploying': '배포 중',
'projects.status.crashing': '충돌 중',
'projects.status.stopped': '중지됨',
'projects.status.idle': '유휴',
```

### ErrorSurface (v4 error taxonomy)

```ts
// EN
'errorSurface.blame.yourConfig': 'your config',
'errorSurface.blame.external': 'external',
'errorSurface.blame.ourBug': 'our bug',

// KO
'errorSurface.blame.yourConfig': '설정 문제',
'errorSurface.blame.external': '외부 문제',
'errorSurface.blame.ourBug': '시스템 오류',
```

## Removed keys (consumers deleted)

- `overview.title` — Overview.tsx deleted, route redirects to /home
- Pages that had `PageHeader` wrappers removed: `settings.title`, `settings.description`,
  `deploymentsList.title`, `services.title`, `opsV2.page.title` — these keys still exist in
  the i18n files but are no longer rendered via PageHeader (they may be used elsewhere; keep).

## Open questions

None — all structural changes are documented above.
