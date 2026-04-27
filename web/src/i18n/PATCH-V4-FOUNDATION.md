# i18n PATCH — V4 Foundation (consolidated from PR1 + PR2-PR3 + PR4 + PR6)

> Per project rule: never directly edit `web/src/i18n/{en,ko}.ts` (parallel
> sessions merge those manually). This file consolidates all keys introduced
> by the Phase A megacommit (962bf1d) for a single manual merge pass.
> Source patches: PATCH-PR1.md, PATCH-PR2-PR3.md, PATCH-PR4.md, PATCH-PR6.md.

## Status

Components currently use hard-coded English strings. Wire-up via
`useLanguage().t()` is a follow-up pass (Phase B/C). This patch captures all
canonical key names so the substitution pass is a pure find-and-replace.

## Keys to add

Drop these blocks into `en.ts` and `ko.ts` at the matching positions.

### Sidebar — section labels

```ts
// en.ts
sidebar: {
  // ... existing keys ...
  workspace: 'Workspace',
  infrastructure: 'Infrastructure',
  integrations: 'Integrations',
  brandTagline: 'Agent-native PaaS for self-hosters',
  versionStamp: 'v1.0.0 · self-hosted',
},

// ko.ts
sidebar: {
  // ... existing keys ...
  workspace: '워크스페이스',
  infrastructure: '인프라',
  integrations: '연동',
  brandTagline: '셀프호스트를 위한 에이전트 네이티브 PaaS',
  versionStamp: 'v1.0.0 · 셀프호스트',
},
```

### Navigation items

```ts
// en.ts — add to existing nav object
nav: {
  // ... existing keys ...
  home: 'Home',
  activity: 'Activity',
  monitoring: 'Monitoring',
  logs: 'Logs',
  webServer: 'Web Server',
  mcpServer: 'MCP Server',
  gitProviders: 'Git Providers',
  sshKeys: 'SSH Keys',
  notifications: 'Notifications',
},

// ko.ts
nav: {
  // ... existing keys ...
  home: '홈',
  activity: '활동',
  monitoring: '모니터링',
  logs: '로그',
  webServer: '웹 서버',
  mcpServer: 'MCP 서버',
  gitProviders: 'Git 제공자',
  sshKeys: 'SSH 키',
  notifications: '알림',
},
```

### Shell — route labels (TopBar breadcrumb + Sidebar)

```ts
// en.ts
shell: {
  routes: {
    home: 'Home',
    activity: 'Activity',
    mcp: 'MCP Server',
    projects: 'Projects',
    services: 'Services',
    deployments: 'Deployments',
    monitoring: 'Monitoring',
    operations: 'Operations',
    overview: 'Overview',
    logs: 'Logs',
    settings: 'Settings',
    agent: 'Agent',
  },
},

// ko.ts
shell: {
  routes: {
    home: '홈',
    activity: '활동',
    mcp: 'MCP 서버',
    projects: '프로젝트',
    services: '서비스',
    deployments: '배포',
    monitoring: '모니터링',
    operations: '운영',
    overview: '개요',
    logs: '로그',
    settings: '설정',
    agent: '에이전트',
  },
},
```

### TopBar

```ts
// en.ts
topbar: {
  toggleSidebar: 'Toggle sidebar',
  agentChipTitle: 'Agent Command Center · MCP',
  agentLabel: 'Agent',
},

// ko.ts
topbar: {
  toggleSidebar: '사이드바 토글',
  agentChipTitle: '에이전트 사령부 · MCP',
  agentLabel: '에이전트',
},
```

### Home page

```ts
// en.ts
home: {
  statusAllHealthy: 'All {{count}} services running across {{projects}} projects.',
  statusNeedsAttention:
    '{{trouble}} of {{count}} services need attention · {{healthy}} running across {{projects}} projects',
  observedAt: 'observed {{time}}',
  activityCardTitle: 'Activity',
  activityCardSubtitle: "Everything that's happening — agents, humans, webhooks, system.",
  viewAll: 'View all',
},

// ko.ts
home: {
  statusAllHealthy: '{{count}}개 서비스가 {{projects}}개 프로젝트에서 모두 정상 실행 중',
  statusNeedsAttention:
    '{{count}}개 중 {{trouble}}개가 주의 필요 · {{projects}}개 프로젝트에서 {{healthy}}개 실행 중',
  observedAt: '{{time}} 관측됨',
  activityCardTitle: '활동',
  activityCardSubtitle: '에이전트, 사람, 웹훅, 시스템의 모든 활동',
  viewAll: '모두 보기',
},
```

### Activity page

```ts
// en.ts
activity: {
  pageTitle: 'Activity',
  pageSubtitle: 'Audit log — deploys, config changes, service crashes, MCP connections.',
  filterActor: 'Actor',
  filterProject: 'Project',
  filterAll: 'All',
  filterAllProjects: 'All projects',
  filterMcp: 'MCP',
  filterHuman: 'Human',
  filterWebhook: 'Git',
  filterSystem: 'System',
  bucketJustNow: 'Just now',
  bucketEarlierToday: 'Earlier today',
  bucketYesterday: 'Yesterday',
  emptyFiltered: 'No activity matches these filters.',
  emptyAll: 'No activity yet.',
},

// ko.ts
activity: {
  pageTitle: '활동',
  pageSubtitle: '감사 로그 — 배포, 설정 변경, 서비스 충돌, MCP 연결',
  filterActor: '주체',
  filterProject: '프로젝트',
  filterAll: '전체',
  filterAllProjects: '전체 프로젝트',
  filterMcp: 'MCP',
  filterHuman: '사람',
  filterWebhook: 'Git',
  filterSystem: '시스템',
  bucketJustNow: '방금 전',
  bucketEarlierToday: '오늘 이전',
  bucketYesterday: '어제',
  emptyFiltered: '해당 필터에 맞는 활동이 없습니다.',
  emptyAll: '아직 활동이 없습니다.',
},
```

### MCP Server page

```ts
// en.ts
mcp: {
  pageTitle: 'MCP Server',
  pageSubtitle: 'Where Claude and other agents reach OpenLander.',
  status: 'Status',
  statusConnected: 'Connected',
  statusReconnecting: 'Reconnecting…',
  statusDisconnected: 'Disconnected',
  lastCall: 'last call · {{time}}',
  endpoint: 'Endpoint',
  copy: 'Copy',
  toolsExposed: 'Tools exposed',
  toolsHint: 'deploy, logs, restart, scale, env, …',
  callsToday: 'Calls today',
  agentsActive: '{{count}} agent active',
  agentsActivePlural: '{{count}} agents active',
  connectedAgentsTitle: 'Connected agents',
  connectedAgentsSubtitle: 'Live MCP sessions. Disconnecting terminates the session immediately.',
  disconnect: 'Disconnect',
  recentCallsTitle: 'Recent agent calls',
  recentCallsSubtitle: 'MCP-triggered events only. Full history under Activity.',
  fullTimeline: 'Full timeline →',
  callsCount: '{{count}} call today',
  callsCountPlural: '{{count}} calls today',
  connectedAgo: 'connected {{time}}',
},

// ko.ts
mcp: {
  pageTitle: 'MCP 서버',
  pageSubtitle: 'Claude와 다른 에이전트가 OpenLander에 접속하는 곳',
  status: '상태',
  statusConnected: '연결됨',
  statusReconnecting: '재연결 중…',
  statusDisconnected: '연결 끊김',
  lastCall: '마지막 호출 · {{time}}',
  endpoint: '엔드포인트',
  copy: '복사',
  toolsExposed: '노출된 도구',
  toolsHint: 'deploy, logs, restart, scale, env, …',
  callsToday: '오늘 호출',
  agentsActive: '{{count}}개 에이전트 활동 중',
  agentsActivePlural: '{{count}}개 에이전트 활동 중',
  connectedAgentsTitle: '연결된 에이전트',
  connectedAgentsSubtitle: '활성 MCP 세션. 연결 해제 시 즉시 세션이 종료됩니다.',
  disconnect: '연결 해제',
  recentCallsTitle: '최근 에이전트 호출',
  recentCallsSubtitle: 'MCP 트리거 이벤트만. 전체 이력은 활동 페이지에서.',
  fullTimeline: '전체 타임라인 →',
  callsCount: '오늘 {{count}}번 호출',
  callsCountPlural: '오늘 {{count}}번 호출',
  connectedAgo: '{{time}} 연결됨',
},
```

### Project view

```ts
// en.ts
project: {
  // ... existing keys ...
  topology: 'Topology',
  topologyAllHealthy: 'all healthy',
  topologyCrashed: '{{count}} crashed',
  topologyEmpty: 'No services yet — your topology will appear here once you create one.',
  topologyLonely: 'No dependencies declared. Add one in compose.yml with depends_on.',
  topologyDense: 'grouped view',
  topologyLaneEntry: 'Entry',
  topologyLaneApp: 'App',
  topologyLaneData: 'Data',
  servicesTab: 'Services',
  activityTab: 'Activity',
  activityEmpty: 'No activity for {{project}} yet. When you (or an agent) deploys, restarts, or changes anything in this project, it will appear here.',
  noServices: 'No services in this project yet.',
  addService: 'Add service',
  lastDeploy: 'last deploy {{time}}',
  createdOn: 'created {{date}}',
},

// ko.ts
project: {
  // ... existing keys ...
  topology: '토폴로지',
  topologyAllHealthy: '모두 정상',
  topologyCrashed: '{{count}}개 충돌',
  topologyEmpty: '아직 서비스가 없습니다 — 서비스를 만들면 토폴로지가 여기 나타납니다.',
  topologyLonely: '선언된 의존성이 없습니다. compose.yml의 depends_on에 추가하세요.',
  topologyDense: '그룹 뷰',
  topologyLaneEntry: '진입',
  topologyLaneApp: '앱',
  topologyLaneData: '데이터',
  servicesTab: '서비스',
  activityTab: '활동',
  activityEmpty: '{{project}} 프로젝트의 활동이 아직 없습니다. 사람이나 에이전트가 배포, 재시작, 변경을 하면 여기 표시됩니다.',
  noServices: '이 프로젝트에는 아직 서비스가 없습니다.',
  addService: '서비스 추가',
  lastDeploy: '마지막 배포 {{time}}',
  createdOn: '{{date}} 생성됨',
},
```

### InfraMap

```ts
// en.ts
infraMap: {
  topology: 'Topology',
  servicesCount_one: '{{count}} service',
  servicesCount_other: '{{count}} services',
  groupedView: 'grouped view',
  allHealthy: 'all healthy',
  crashedCount: '{{count}} crashed',
  emptyMessage: 'No services yet — your topology will appear here once you create one.',
  lonelyHint: 'No dependencies declared. Add one in compose.yml with depends_on.',
  popoverStatus: 'status',
  popoverImage: 'image',
  popoverCpuMem: 'cpu · mem',
  popoverClickToOpen: 'Click to open service →',
  sampleDataChip: 'Sample data',
  sampleDataTooltip: 'Backend topology endpoint unavailable — showing sample data',
},

// ko.ts
infraMap: {
  topology: '토폴로지',
  servicesCount_one: '{{count}}개 서비스',
  servicesCount_other: '{{count}}개 서비스',
  groupedView: '그룹 뷰',
  allHealthy: '모두 정상',
  crashedCount: '{{count}}개 충돌',
  emptyMessage: '아직 서비스가 없습니다 — 서비스를 만들면 토폴로지가 여기 나타납니다.',
  lonelyHint: '선언된 의존성이 없습니다. compose.yml의 depends_on에 추가하세요.',
  popoverStatus: '상태',
  popoverImage: '이미지',
  popoverCpuMem: 'cpu · mem',
  popoverClickToOpen: '서비스 열기 →',
  sampleDataChip: '샘플 데이터',
  sampleDataTooltip: '백엔드 topology 엔드포인트를 사용할 수 없어 샘플 데이터를 표시합니다',
},
```

### Service detail

```ts
// en.ts
service: {
  // ... existing keys ...
  tabs: {
    general: 'General',
    environment: 'Environment',
    domains: 'Domains',
    deployments: 'Deployments',
    logs: 'Logs',
    monitoring: 'Monitoring',
    advanced: 'Advanced',
  },
  generalSourceTitle: 'Source',
  generalBuildTitle: 'Build',
  generalRuntimeTitle: 'Runtime',
  generalProvider: 'Provider',
  generalRepository: 'Repository',
  generalBranch: 'Branch',
  generalBuildPath: 'Build path',
  generalMethod: 'Method',
  generalDockerfile: 'Dockerfile',
  generalTargetStage: 'Target stage',
  generalCache: 'Cache',
  generalCpu: 'CPU',
  generalMemory: 'Memory',
  generalLast60s: 'last 60s',
  generalMemoryLimit: '{{value}} limit',
  generalPublicUrl: 'Public URL',
  envTitle: 'Environment variables',
  envAdd: 'Add',
  domainsTitle: 'Domains',
  domainsAdd: 'Add domain',
  domainsAutoIssued: 'Auto-issued via sslip.io. Add a custom domain to override.',
  monitoringRange: 'Time range',
  monitoringContainer: 'Container',
  monitoringCpuTitle: 'CPU',
  monitoringMemoryTitle: 'Memory',
  monitoringRequestsTitle: 'Requests / s',
  monitoringErrorRateTitle: 'Error rate',
  advancedStub: 'Network, resources, and entrypoint overrides land here.',
  deploy: 'Deploy',
  deploying: 'Deploying…',
  deployRunning: 'Running',
  deployDone: 'Done',
  deployFailed: 'Failed',
  deployCancelled: 'Cancelled',
  deployKill: 'Kill',
  deployView: 'View',
},

// ko.ts (mirror — same keys, Korean values)
service: {
  // ...
  tabs: {
    general: '일반',
    environment: '환경 변수',
    domains: '도메인',
    deployments: '배포',
    logs: '로그',
    monitoring: '모니터링',
    advanced: '고급',
  },
  // (...remaining Korean values)
},
```

### LogViewer

```ts
// en.ts
log: {
  pillConnecting: 'Connecting…',
  pillLive: 'Live · {{dur}}',
  pillReconnecting: 'Reconnecting · {{dur}}',
  pillBackfilling: 'Backfilling…',
  pillDone: 'Done · {{dur}}',
  pillFailed: 'Failed · {{dur}}',
  pillStreamError: 'Stream error · {{dur}}',
  pillCancelled: 'Cancelled · {{dur}}',
  reconnectingNotice: 'Connection lost — reconnecting…',
  backfillingNotice: 'Reconnected — backfilling missed lines. Earlier lines may not be captured.',
  killBuild: 'Kill build',
  copyVisible: 'Copy',
  copyVisibleTitle: 'Copy visible range',
  download: 'Download',
  downloadTitle: 'Download full log',
  jumpToLatest: 'Jump to latest',
  olderSlabsNotice: 'Showing the most recent {{cap}} of {{total}} lines.',
  olderSlabsCta: 'Download full log',
  phaseClone: 'Cloning repository',
  phasePull: 'Pulling base images',
  phaseBuild: 'Building images',
  phaseCreate: 'Creating containers',
  phaseStart: 'Starting containers',
  phaseHealth: 'Waiting for health',
  successTitle: 'Deployment succeeded',
  successAppLiveAt: 'Your app is live at:',
  successInternal: 'Internal: {{url}} (for inter-container calls)',
  failureFix: 'Likely fix:',
  failureCopySummary: 'Copy summary',
  failureCopyAsClaude: 'Copy as Claude prompt',
  failureViewCompose: 'View compose',
  failureRedeploy: 'Re-deploy',
  cancelledTitle: 'Build cancelled',
  cancelledBody: 'The stream was killed before this build finished. The previous deploy is still serving traffic.',
  cancelledRedeploy: 'Re-deploy',
  cancelledCopyPartial: 'Copy partial log',
},

// ko.ts mirror (values TBD — defer to i18n wire-up PR)
```

### Monitoring tab

```ts
// en.ts
monitoring: {
  cardCpu: 'CPU',
  cardMemory: 'Memory',
  cardRequests: 'Requests / s',
  cardErrorRate: 'Error rate',
  cpuSubAvg: 'avg over {{range}}',
  memorySubLimit: '512 MB limit',
  requestsSubP95: 'p95: {{p95}} · {{range}}',
  errorSubHttp5xx: 'HTTP 5xx · last hour',
  containerLabel: 'Container',
  containerPrimary: 'ol-{{name}} (primary)',
  containerReplaced: 'ol-{{name}} (replaced)',
},

// ko.ts
monitoring: {
  cardCpu: 'CPU',
  cardMemory: '메모리',
  cardRequests: '초당 요청',
  cardErrorRate: '오류율',
  cpuSubAvg: '{{range}} 평균',
  memorySubLimit: '512 MB 한계',
  requestsSubP95: 'p95: {{p95}} · {{range}}',
  errorSubHttp5xx: 'HTTP 5xx · 지난 1시간',
  containerLabel: '컨테이너',
  containerPrimary: 'ol-{{name}} (기본)',
  containerReplaced: 'ol-{{name}} (교체됨)',
},
```

### Notifications settings

```ts
// en.ts
notifications: {
  title: 'Notifications',
  subtitle: 'Generic webhook. Pick the events you care about; OpenLander POSTs JSON to your URL.',
  body: '1.0 ships a single, transport-agnostic webhook. Wire it to n8n, IFTTT, your own bot, or a Discord/Slack incoming webhook.',
  fieldUrl: 'Webhook URL',
  urlPlaceholder: 'https://example.com/openlander-webhook',
  fieldEvents: 'Events',
  saveButton: 'Save webhook',
  saveButtonSaving: 'Saving…',
  saveButtonHint: 'Add a URL to enable save.',
  toastSaved: 'Webhook saved',
  toastSaveFailed: 'Failed to save webhook',
  futureTitle: 'Future providers',
  futureSubtitle: "Discord / Slack / Email presets land in v1.1. They'll point at the same webhook plumbing.",
  futureAddPreset: 'Add preset (v1.1)',
},

notificationEvents: {
  'deploy.started': 'Deploy started',
  'deploy.completed': 'Deploy completed',
  'deploy.failed': 'Deploy failed',
  'service.crashed': 'Service crashed',
  'service.recovered': 'Service recovered',
},

// ko.ts mirrors
notifications: {
  title: '알림',
  subtitle: '일반 웹훅. 알림받을 이벤트를 선택하세요. OpenLander가 해당 URL로 JSON을 POST합니다.',
  body: '1.0은 전송 방식에 무관한 단일 웹훅을 제공합니다. n8n, IFTTT, 자체 봇, Discord/Slack incoming webhook 등에 연결하세요.',
  fieldUrl: '웹훅 URL',
  urlPlaceholder: 'https://example.com/openlander-webhook',
  fieldEvents: '이벤트',
  saveButton: '웹훅 저장',
  saveButtonSaving: '저장 중…',
  saveButtonHint: 'URL을 입력하면 저장이 활성화됩니다.',
  toastSaved: '웹훅이 저장되었습니다',
  toastSaveFailed: '웹훅 저장에 실패했습니다',
  futureTitle: '향후 제공 예정',
  futureSubtitle: 'Discord / Slack / Email 프리셋은 v1.1에 추가됩니다. 동일한 웹훅 시스템을 사용합니다.',
  futureAddPreset: '프리셋 추가 (v1.1)',
},

notificationEvents: {
  'deploy.started': '배포 시작',
  'deploy.completed': '배포 완료',
  'deploy.failed': '배포 실패',
  'service.crashed': '서비스 충돌',
  'service.recovered': '서비스 복구',
},
```

### Service health strings

```ts
// en.ts
serviceHealth: {
  healthy: 'healthy',
  crashed: 'crashed',
},

// ko.ts
serviceHealth: {
  healthy: '정상',
  crashed: '충돌',
},
```

### Settings sub-pages

```ts
// en.ts
settings: {
  // ... existing keys ...
  webServerTitle: 'Web Server',
  webServerSubtitle: 'Traefik / reverse proxy configuration.',
  gitProvidersTitle: 'Git Providers',
  gitProvidersSubtitle: 'Connect GitHub for repository access. SSH and PAT supported.',
  sshKeysTitle: 'SSH Keys',
  sshKeysSubtitle: 'Repo access keys. Used for cloning private repositories.',
  notificationsTitle: 'Notifications',
  notificationsSubtitle: 'Generic webhook. Pick the events you care about; OpenLander POSTs JSON to your URL.',
  notificationsUrlLabel: 'Webhook URL',
  notificationsEvents: 'Events',
  notificationsSave: 'Save webhook',
  notificationsSaveDisabledHint: 'Save is disabled — backend endpoint pending.',
  notificationsFutureProviders: 'Future providers',
  notificationsFutureBlurb: "Discord / Slack / Email presets land in v1.1. They'll point at the same webhook plumbing.",
  notificationsAddPreset: 'Add preset (v1.1)',
},

// ko.ts mirror (values TBD — defer to i18n wire-up PR)
```

### Error class keys (deferred to i18n wire-up PR)

The 16 error class titles + fix hints in `web/src/lib/errorClasses.ts` are
English-only. When wiring `useLanguage().t()`, switch to key-based lookup:

```ts
errorClasses: {
  CONFIG_MISSING: { title: '…', fixHint: '…' },
  GIT_ACCESS_DENIED: { title: '…', fixHint: '…' },
  // … 14 more entries
},
```

Deferred: strings already match GUIDE-05 §2 verbatim — no semantic risk in
shipping English-only until the wire-up PR.

## Merge notes

- Source patches: PATCH-PR1.md, PATCH-PR2-PR3.md, PATCH-PR4.md, PATCH-PR6.md
  (all deleted; keys consolidated here, duplicates removed).
- Do not directly edit `en.ts` / `ko.ts` from this session.
- After merging, run `npm run typecheck` to verify no key-shape mismatches.
- Audit existing collisions: legacy `nav.overview`, `nav.deployments`, etc.
  must be preserved.
