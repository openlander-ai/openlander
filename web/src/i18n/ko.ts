export const translations = {
  aiOps: {
    title: 'AI Ops Briefing',
    beta: 'Beta',
    projectDescription:
      '이 Project에서 읽기 전용 운영 브리핑을 켭니다. OpenLander는 증거를 요약하지만 restart, redeploy, rollback, env 수정은 자동으로 하지 않습니다.',
    noAutomation: '자동 변경 없음',
    mode: {
      off: 'Off',
      briefing: 'Briefing',
      inherit: 'Inherit',
    },
    resolvedMode: 'Resolved',
    budget: 'Budget',
    settingsBriefingsHint:
      'Incident briefing은 Project AI Ops 탭에서 봅니다. 이 화면은 opt-in과 budget 설정만 다룹니다.',
    loading: '불러오는 중...',
    empty: '아직 브리핑이 없습니다.',
    emptyTitle: '아직 incident briefing이 없습니다',
    emptyDescription:
      'AI Ops Briefing을 켜면 crash, deploy 실패, route-health 증거가 여기에 표시됩니다.',
    detailTitle: 'AI Ops briefing',
    detailDescription:
      'severity와 suggested call은 OpenLander 규칙이 결정합니다. LLM 텍스트는 설명 전용입니다.',
    tokens: 'Tokens',
    cost: 'Cost',
    llmCalls: 'LLM calls',
    suggestedCall: 'Suggested MCP call',
    evidence: 'Evidence',
    agentHandoff: {
      title: 'Agent handoff',
      description:
        '증거 범위에 묶인 prompt를 복사합니다. Token이나 credential은 포함하지 않습니다.',
      copy: 'Handoff 복사',
      copied: '복사됨',
    },
    actions: {
      viewEvidence: 'Evidence 보기',
      viewProjectBriefings: 'Project AI Ops 보기',
      openInAgent: 'Agent에서 열기',
      verifyAfterFix: '수정 후 검증',
      verifyCopied: '검증 call 복사됨',
      acknowledge: '확인',
      resolve: '종료',
    },
    status: {
      unresolved: '미종료',
      open: 'Open',
      acknowledged: 'Acknowledged',
      resolved: 'Resolved',
      all: 'All',
    },
    inbox: {
      title: 'AI Ops Inbox',
      subtitle: 'Project 전체의 열린 incident briefing입니다.',
      configure: 'Project 보기',
      clearTitle: '모니터링 중인 Project에 열린 briefing이 없습니다',
      clearDescription:
        'AI Ops가 켜진 Project에서 crash, deploy 실패, route-health 증거가 생기면 여기에 모입니다.',
      attentionTitle: '미종료 briefing {count}개',
      attentionDescription: '먼저 Agent에서 열고, 수정 후 검증한 뒤 사람이 직접 종료하세요.',
      emptyEyebrow: '대기 중인 작업 없음',
      emptyTitle: '열린 AI Ops briefing이 없습니다',
      emptyDescription:
        'AI Ops가 켜진 Project는 crash, deploy 실패, route-health 증거를 감지합니다. 검토할 일이 생기기 전까지 이 inbox는 조용합니다.',
    },
    projectInbox: {
      title: 'AI Ops briefings',
      description: '각 리소스를 열지 않고 이 Project의 운영 브리핑을 한 곳에서 봅니다.',
      configure: 'AI Ops 설정',
      enabledTitle: '이 Project에서 briefing이 켜져 있습니다',
      enabledDescription:
        'OpenLander가 crash, deploy 실패, route-health 증거로 읽기 전용 incident briefing을 만듭니다.',
      disabledTitle: '이 Project에서 briefing이 꺼져 있습니다',
      disabledDescription:
        '이 Project의 incident briefing을 만들려면 Project Settings에서 AI Ops Briefing을 켜세요.',
      serviceFilter: 'Service',
      allServices: 'All services',
      serviceUnavailable: '선택한 service를 더 이상 찾을 수 없습니다.',
      servicePolicyFollows: 'Project setting을 따름: {mode}',
      servicePolicyOverride: 'Service override: {mode}',
      emptyEyebrowEnabled: '대기 중인 작업 없음',
      emptyEyebrowDisabled: 'Project opt-in 필요',
      emptyTitle: '조건에 맞는 briefing이 없습니다',
      emptyDescription:
        '이 Project에 incident가 생기면 deterministic evidence와 agent handoff prompt가 여기에 표시됩니다.',
      emptyDescriptionDisabled:
        '현재 이 Project의 AI Ops가 꺼져 있어 새 crash와 route-health 이벤트가 briefing을 만들지 않습니다.',
    },
    error: {
      load: 'AI Ops 브리핑을 불러오지 못했습니다.',
      save: 'AI Ops 정책 저장에 실패했습니다.',
      status: '브리핑 상태를 변경하지 못했습니다.',
    },
  },
  aiProviders: {
    title: 'AI Providers',
    subtitle:
      'AI Ops briefing summary에 사용할 모델 provider를 연결합니다. Provider 설정만으로 AI Ops가 켜지지는 않습니다.',
    connected: 'Connected',
    loading: 'AI provider 설정을 불러오는 중...',
    policyTitle: 'Provider 연결과 Project opt-in은 분리됩니다',
    policyBody:
      'Provider를 저장해도 Project에서 AI Ops Briefing을 켜기 전까지 LLM summary는 실행되지 않습니다. severity와 suggested call은 계속 OpenLander 규칙이 결정합니다.',
    currentProvider: '선택한 provider: {provider}',
    form: {
      provider: 'Provider',
      model: 'Model',
      apiKey: 'API key',
      apiKeyPlaceholder: 'API key를 붙여넣으세요',
      apiKeyPlaceholderConfigured: '저장된 key를 유지하려면 비워두세요',
      apiKeyHint: '암호화되어 저장되며 API 응답이나 UI에 다시 표시되지 않습니다.',
      baseUrl: 'Base URL',
      baseUrlHint: 'OpenRouter 같은 OpenAI-compatible provider에 사용합니다.',
    },
    actions: {
      save: 'Save provider',
      test: 'Test connection',
      disconnect: 'Disconnect',
    },
    status: {
      saved: 'AI provider가 저장되었습니다. Project AI Ops는 Briefing을 켜기 전까지 Off입니다.',
      deleted: 'AI provider 연결이 해제되었습니다.',
      testPassed: 'Connection test passed.',
    },
    error: {
      load: 'AI provider 설정을 불러오지 못했습니다.',
      save: 'AI provider 저장에 실패했습니다.',
      test: 'Connection test failed.',
      delete: 'AI provider 연결 해제에 실패했습니다.',
    },
    scope: {
      title: 'AI Ops와 연결되는 방식',
      subtitle: 'OpenLander는 provider 설정과 briefing 실행 위치를 분리합니다.',
      provider: {
        title: 'AI Providers',
        body: 'Summary 생성을 위한 OpenAI-compatible, Anthropic 또는 Gemini API key를 연결합니다.',
      },
      project: {
        title: 'Project AI Ops',
        body: 'Project 단위로 명시적으로 켭니다. Provider를 설정해도 기본값은 Off입니다.',
      },
      service: {
        title: 'Service override',
        body: 'Application별로 inherit, off, briefing을 별도로 선택합니다.',
      },
    },
  },
  resources: {
    // Chrome — section title + form labels + dropdown options + buttons + status.
    title: 'Resource Limits',
    profile: 'Memory Profile',
    profiles: {
      micro: 'Micro (256 MB)',
      small: 'Small (512 MB)',
      medium: 'Medium (1 GB)',
      large: 'Large (2 GB)',
      custom: 'Custom',
    },
    customMemory: 'Custom Memory (MB)',
    save: 'Save',
    saving: 'Saving...',
    saved: 'Saved',
    loading: 'Loading...',
    // Content — descriptive copy + hints + notices + errors.
    description:
      '메모리 및 CPU 제한을 설정하여 cascade failure를 방지합니다. 변경사항은 다음 배포 시 적용됩니다.',
    customMemoryHint: '최소 64 MB',
    appliesOnRedeploy: '변경사항은 다음 배포 시 적용됩니다',
    noLimit: '메모리 제한이 설정되지 않았습니다',
    noLimitWarning: '메모리 제한을 설정하면 cascade failure를 방지할 수 있습니다.',
    loadFailed: '리소스 제한을 불러오지 못했습니다',
    saveFailed: '리소스 제한 저장에 실패했습니다',
    composeNotSupported:
      'docker-compose 프로젝트에는 아직 리소스 제한이 적용되지 않습니다. v1.1.0에서 지원 예정입니다.',
    warning: {
      hostMemory:
        '호스트 메모리 사용률이 {percent}%입니다. 컨테이너 제한을 줄이거나 호스트 리소스를 늘려보세요.',
    },
  },
  common: {
    // Chrome — link text.
    viewAll: 'View all',
    count: {
      // Content — count phrases with units. Korean does not mark plural
      // on counted nouns, so _one and _other resolve to the same string.
      // Keys mirror en.ts so call sites can switch by count uniformly.
      deployableServices_one: 'Application {count}개',
      deployableServices_other: 'Application {count}개',
      services_one: '리소스 {count}개',
      services_other: '리소스 {count}개',
      projects_one: '프로젝트 {count}개',
      projects_other: '프로젝트 {count}개',
    },
    relative: {
      // Content — relative-time labels rendered by lib/time.formatRelativeTime
      // when a t() callback is passed. Un-migrated callers continue to see
      // the English fallback ('2m ago' etc.).
      justNow: '방금',
      minutes: '{count}분 전',
      hours: '{count}시간 전',
      days: '{count}일 전',
    },
  },
  nav: {
    // Chrome — primary nav labels.
    overview: 'Overview',
    projects: 'Projects',
    deployments: 'Deployments',
  },
  login: {
    // Chrome — form label + button + status.
    password: 'Password',
    signingIn: 'Signing in...',
    signIn: 'Sign In',
    // Content — page-level prompts, loading states, errors.
    signInPrompt: '로그인하여 계속하기',
    errorGeneric: '로그인에 실패했습니다. 다시 시도해주세요.',
    checkingStatus: '서버 상태 확인 중...',
    loadingLabel: '불러오는 중',
  },
  sidebar: {
    collapse: '사이드바 접기',
    expand: '사이드바 펼치기',
    primaryNavAria: '주요 탐색',
    versionAria: '버전',
  },
  topBar: {
    // Chrome — short prefix label + status sentinel match agent-chip parallel
    // with status pills elsewhere (idle stays English like Running/Stopped).
    agentChipPrefix: 'Agent',
    agentIdleStatus: 'idle',
    // Content — sidebar toggle + breadcrumb a11y labels + descriptive tooltip.
    sidebarToggleLabel: '사이드바 토글',
    breadcrumbAria: '경로 탐색',
    agentChipTitle: '에이전트 활동 — 에이전트가 한 작업을 확인하세요',
  },
  agentGuide: {
    // Chrome — bare-verb footer button.
    closeButton: 'Close',
    // Content — identity label + a11y prose + helper prompts. agentName
    // follows the "generic placeholder until backend exposes
    // clientInfo.name" comment in AgentGuideDialog and reads natively
    // in Korean.
    agentName: '내 에이전트',
    closeDialogLabel: '대화상자 닫기',
    connectAria: '에이전트 연결',
    wrongAgentPrompt: '다른 에이전트를 연결해야 하나요?',
    switchAgentCta: '변경하기 →',
    identityStrip: {
      // Content — '· last active {time}' template, restructured for ko word
      // order. connectedOverMcp is descriptor prose, translated.
      lastActiveLine: '마지막 활동: {time}',
      connectedOverMcp: 'MCP로 연결됨',
    },
    connectBanner: {
      // Content — banner title + body. setupAgent is Chrome (verb-noun
      // CTA, parallel with 'New Project').
      title: '먼저 에이전트를 연결하세요',
      body: 'Claude나 다른 MCP 지원 에이전트를 OpenLander /mcp 엔드포인트에 연결하세요. 이 토큰은 MCP 도구용이며 /api 직접 호출용이 아닙니다.',
      setupAgent: 'Set up agent',
    },
    copy: {
      // Chrome — bare verb + post-action verb (button state labels).
      label: 'Copy',
      success: 'Copied',
      // Content — disabled state explanation (used as both tooltip and
      // visible label) + tooltip prose for the enabled state.
      disabledMessage: '먼저 에이전트를 연결하세요',
      enabledTitle: '프롬프트 복사',
    },
  },
  account: {
    popover: {
      // aria-label / title attribute — kept in Korean so Korean screen
      // readers and on-hover tooltips read naturally to ko users
      // (Content register override on the form-label Chrome default).
      openLabel: '설정 메뉴 열기',
      menuLabel: '설정 메뉴',
      // Visible chrome — same English string as en.ts (Chrome register
      // per docs/i18n-policy.md).
      triggerLabel: 'Settings',
      changePassword: 'Change password',
      switchLanguage: 'Switch language',
      signOut: 'Sign out',
    },
    changePassword: {
      // Chrome — modal chrome and form labels stay English in ko.ts.
      title: 'Change password',
      close: 'Close',
      currentLabel: 'Current password',
      newLabel: 'New password',
      confirmLabel: 'Confirm new password',
      cancel: 'Cancel',
      submit: 'Update password',
      saving: 'Saving…',
      // Content — hints and errors stay locale-native.
      minHint: '최소 {count}자 이상.',
      tooShort: '새 비밀번호는 최소 {count}자 이상이어야 합니다.',
      mismatch: '새 비밀번호와 확인 값이 일치하지 않습니다.',
      failed: '비밀번호 변경에 실패했습니다.',
    },
  },
  activity: {
    filter: {
      type: {
        // Chrome — tab strip labels.
        label: 'Type',
        all: 'All',
        deploy: 'Deployments',
        config: 'Config',
        // Renamed from "Crashes" — broader bucket for events the
        // platform itself emits (crash + recovery).
        system: 'System',
        crash: 'Crashes',
        mcp: 'MCP',
      },
    },
    page: {
      // Chrome — page heading.
      title: 'Activity',
      // Content — descriptive subtitle + empty state, shared with the
      // Recent-activity peek on Home.
      subtitle:
        '활동 감사 로그 — 탭에서 배포 / MCP / 시스템 이벤트 / 설정 변경 활동을 선택해 보세요.',
      emptyState:
        '아직 활동이 없습니다. 트리거, 배포, 에이전트 실행, 인시던트가 발생하면 여기에 표시됩니다.',
    },
  },
  overview: {
    // Chrome — page title + KPI tile labels.
    title: 'Overview',
    kpi: {
      activeDeploys: 'Active Deploys',
      recoveries: 'Recoveries',
      approvals: 'Approvals',
      incidents: 'Alerts',
      services: 'Unhealthy Resources',
      aiSpend: 'AI Spend',
    },
    activity: {
      // Chrome — section title.
      title: 'Live Activity',
      // Content — empty state + formatted display.
      empty: '아직 활동이 없습니다.',
      timeAgo: '{time} 전',
    },
    attention: {
      // Chrome — section title.
      title: 'Needs Attention',
      // Content — empty state + formatted display.
      empty: '모든 시스템이 정상입니다.',
      projectError: '{name} 배포 실패',
      pendingApprovals: '승인 대기 {count}건',
      unhealthyServices: '비정상 리소스 {count}개',
    },
    health: {
      // Chrome — section title.
      title: 'Project Health',
    },
    // Content — empty state.
    empty: '아직 활동이 없습니다. 첫 번째 프로젝트를 배포하여 실시간 업데이트를 확인하세요.',
  },
  pulse: {
    // Chrome — status pills.
    deploying: 'Deploying',
    recovery: 'Recovery',
    approval: 'Approval',
    incidents: 'Alerts',
    aiSpend: 'AI Spend',
  },
  monitoring: {
    // Chrome — page heading + filter option + status pills + metric
    // labels. Health states are machine-readable wire values
    // (see useMonitoring's MonitoringServiceView['health']), so they
    // stay English under the Hybrid rule.
    pageTitle: 'Monitoring',
    allProjects: 'All projects',
    unattached: 'Unattached',
    metrics: {
      cpu: 'CPU',
      mem: 'MEM',
    },
    health: {
      healthy: 'Healthy',
      healthyStale: 'Healthy · stale',
      unhealthy: 'Unhealthy',
      unhealthyStale: 'Unhealthy · stale',
      unknown: 'Unknown',
    },
    // Content — descriptive subtitle + empty states + footer + relative
    // time (seconds-precision since the poll cadence is 15s).
    pageSubtitle:
      '리소스별 CPU와 메모리를 한눈에 확인합니다. 행을 클릭하면 리소스 상세 차트로 이동합니다.',
    empty: {
      noServices:
        '아직 리소스가 없습니다. 에이전트에게 배포해 달라고 말해보세요. 측정값이 여기에 나타납니다.',
      noSamples: '아직 측정값이 있는 리소스가 없습니다.',
    },
    excludedFooter: '리소스 {total}개 중 {shown}개 표시 — {excluded}개는 측정값 없음',
    relative: {
      never: '없음',
      seconds: '{count}초 전',
      minutes: '{count}분 전',
      hours: '{count}시간 전',
      days: '{count}일 전',
    },
  },
  home: {
    hero: {
      // Content — hero status prose on /home.
      statusJustNow: '시스템 상태 · 방금 전',
      noProjects:
        '아직 프로젝트가 없습니다. 에이전트에게 배포해 달라고 말해보세요. 작업이 시작되면 여기에 나타납니다.',
      allHealthy: '{projects}에서 {services} 모두 정상 실행 중입니다.',
      someCrashed: '프로젝트 {total}개 중 {crashed}개 크래시 · {healthy}개 정상 (총 {services})',
      lastDeploy: '최근 배포',
    },
    projects: {
      // Chrome — section title + status pill + aria label.
      sectionTitle: 'Projects',
      crashedPill: 'crashed',
      openProject: 'Open {name} project',
      // Content — empty state + inline action link.
      emptyText: '아직 프로젝트가 없습니다.',
      createOne: '새로 만들기',
    },
    recentActivity: {
      // Chrome — section title.
      sectionTitle: 'Recent activity',
      // Content — section subtitle.
      sectionSubtitle: '배포, 설정 변경, 에이전트 호출의 감사 로그입니다.',
    },
  },
  setup: {
    welcome: {
      title: 'OpenLander입니다',
      subtitle: '레포지토리를 주세요. 나머지는 제가 처리합니다.',
      dockerRequired: '계속하려면 Docker가 실행 중이어야 합니다.',
    },
    github: {
      // Chrome.
      title: 'Ready for Launch',
      switchAccount: 'Switch account',
      // Content — descriptive copy stays Korean.
      subtitle: '레포지토리 배포를 시작하려면 GitHub 계정을 연결하세요.',
      description: '비공개 레포지토리 배포용입니다. 공개 레포는 없어도 됩니다.',
      connectedAs: '{username} 계정으로 연결됨',
    },
    password: {
      // Chrome.
      title: 'Set Password',
      placeholder: 'Password',
      confirmPlaceholder: 'Confirm password',
      submit: 'Set Password & Continue',
      saving: 'Setting up...',
      // Content — descriptions + hints + errors stay Korean.
      subtitle: '대시보드를 비밀번호로 보호하세요.',
      lengthHint: '최소 8자 이상이어야 합니다.',
      mismatch: '비밀번호가 일치하지 않습니다',
      empty: '비밀번호를 입력해주세요',
      tooShort: '비밀번호는 최소 8자 이상이어야 합니다',
      errorGeneric: '비밀번호 저장에 실패했습니다. 다시 시도해주세요.',
    },
    mcp: {
      // Chrome.
      title: 'Connect AI Coding Tools',
      manualSetup: 'Manual setup instructions',
      skipForNow: 'Skip for now',
      startDeploying: 'Start Deploying',
      generateToken: 'Generate MCP token',
      generating: 'Generating…',
      tokenName: 'Setup wizard',
      instanceName: 'Instance name',
      instanceHelp: '이 이름이 MCP 클라이언트 설정의 server key로 사용됩니다.',
      instanceDefaultWarning: '여러 OpenLander 서버를 연결한다면 구분 가능한 이름으로 바꾸세요.',
      saveInstance: 'Save name',
      savingInstance: 'Saving…',
      instanceSaveFailed: 'MCP 인스턴스 이름을 저장하지 못했습니다.',
      tryAfterConnect: '연결 후 이렇게 말해보세요:',
      tryPrompt: '{name}에 이 앱 배포해줘',
      // Content.
      subtitle: 'Claude Code, Cursor 또는 모든 MCP 클라이언트에서 배포하세요.',
      copyPrompt: '아래를 AI 코딩 도구에 붙여넣으세요:',
      noTokenYet: '아직 발급된 MCP 토큰이 없습니다. 생성하면 연동 설정을 확인할 수 있습니다.',
      tokenAlreadyIssued:
        'MCP 토큰(olp_…{suffix})이 이미 발급되어 있습니다. 설정 코드에 사용할 새 토큰을 받으려면 사이드바의 Your Agent에서 재발급하세요. 기존 토큰은 무효화됩니다.',
      tokenError:
        'MCP 토큰을 자동으로 발급하지 못했습니다. 설정을 완료한 뒤 Your Agent에서 직접 발급할 수 있습니다.',
      legacyTokenRotated:
        '기존에 사용하던 레거시 API 토큰(ol_…)이 설정 과정에서 무효화되었습니다. 해당 토큰을 사용 중인 MCP 클라이언트는 위의 신규 토큰으로 갱신해주세요.',
    },
    common: {
      // Chrome — bare verbs.
      back: 'Back',
      continue: 'Continue',
      getStarted: 'Get Started',
      refreshStatus: 'Refresh Status',
    },
    infra: {
      // Chrome — status pills.
      dockerEngine: 'Docker Engine',
      traefikProxy: 'Traefik Proxy',
      running: 'Running',
      stopped: 'Stopped',
      // Content — surfaced as a toast when SetupScreen clamps step back
      // to Infrastructure because Docker stopped responding.
      dockerReturned: 'Docker가 실행되고 있지 않아 Infrastructure 단계로 되돌아갔습니다.',
    },
  },
  notifications: {
    // Chrome — section title.
    title: 'Notifications',
    // Content — empty state.
    empty: '알림이 없습니다',
    type: {
      // Content — sentence-shape notification kind labels read more clearly
      // in Korean (these are descriptive diagnostic categories, not pill
      // statuses).
      'container-crash': '컨테이너 시작 실패',
      'restart-loop': '재시작 루프',
      'resource-saturation': '리소스 할당량 초과',
      disk: '디스크 부족',
      'inactive-project': '장기 미사용 상태',
      'dangling-images': '미사용 중인 이미지',
      'port-conflict': '포트 충돌',
      'orphan-container': '고아 컨테이너',
    },
    action: {
      // Chrome — action buttons.
      view_logs: 'View Logs',
      view_stats: 'View Details',
      cleanup_disk: 'Clean Up',
      cleanup_images: 'Clean Up',
      view_details: 'View Details',
    },
  },
  newProject: {
    // Chrome — modal title + tab labels + form labels + button.
    title: 'New Project',
    myRepos: 'My Repos',
    search: 'Search',
    dockerImage: 'Docker Image',
    portLabel: 'Port (Optional)',
    portPlaceholder: '80',
    commandLabel: 'Command (Optional)',
    deployImage: 'Deploy Image',
    // Content — descriptive prompts, error copy, placeholder hints.
    selectRepo: '배포할 레포지토리를 선택하세요',
    noReposFound: '검색 결과가 없습니다:',
    githubNotConnected: 'GitHub가 연결되지 않았습니다. 설정에서 계정을 추가하세요.',
    fetchFailed: '레포지토리를 가져오는데 실패했습니다',
    searchPlaceholder: '레포지토리 검색...',
    imagePlaceholder: '예: nginx:latest 또는 ghcr.io/user/app:v1',
    commandPlaceholder: '예: --model-id BAAI/bge-m3',
  },
  projects: {
    // Chrome — page title + primary action + CTA button + controls.
    title: 'Projects overview',
    pageTitle: 'Projects',
    newProject: 'New Project',
    tags: 'Tags',
    newestFirst: 'Newest first',
    moreOptions: 'More options',
    createFirst: 'Create your first project',
    deployFirstApp: 'Deploy your first app',
    // Content — page subtitle + placeholders + empty state + descriptive
    // copy + relative-time formatted strings + errors.
    pageSubtitle: '프로젝트를 생성하고 관리합니다.',
    filterPlaceholder: '프로젝트 검색…',
    emptyTitle: '아직 프로젝트가 없습니다',
    emptyDescription:
      'Project는 관련 Application, Compose, Database/Cache/Storage 리소스를 묶어줍니다.',
    searchEmpty: '"{query}"와 일치하는 프로젝트가 없습니다',
    deployedAgo: '배포 · {time}',
    createdAgo: '생성 · {time}',
    monitored: '프로젝트 {count}개 모니터링 중',
    noProjects: '프로젝트가 없습니다',
    connectGithub: 'GitHub 레포지토리를 연결하면 에이전트가 나머지를 처리합니다.',
    error: {
      invalidName:
        '프로젝트 이름은 소문자 또는 숫자로 시작해야 하며, 소문자, 숫자, 하이픈만 포함할 수 있습니다',
    },
    filter: {
      // Chrome — toggle labels.
      showArchived: 'Show archived',
      hideArchived: 'Hide archived',
    },
    create: {
      // Chrome — modal heading + buttons + form labels.
      title: 'Create project',
      cancel: 'Cancel',
      submit: 'Create project',
      submitting: 'Creating...',
      nameLabel: 'Project display name',
      namePlaceholder: 'Hotdeal Tracker',
      // Content — descriptive prose + close-aria + errors.
      description:
        'Project는 관련 Application, Compose, Database/Cache/Storage 리소스의 workspace입니다.',
      closeAria: '프로젝트 만들기 대화상자 닫기',
      errors: {
        nameRequired: '프로젝트 이름을 입력하세요.',
        fallback: '프로젝트 생성에 실패했습니다.',
      },
    },
    card: {
      // Chrome — card field labels + badges.
      archivedBadge: 'archived',
      partiallyArchivedBadge: 'Partially archived',
      lastDeploy: 'Last deploy',
      branch: 'Branch',
      endpoint: 'Endpoint',
      public: 'public',
    },
    archive: {
      // Chrome — button.
      button: 'Archive',
      remainingButton: 'Archive remaining',
      // Content — toast + confirmation prose.
      success: '프로젝트가 보관되었습니다',
      description:
        '이 프로젝트를 보관하시겠습니까? 컨테이너는 중지되지만 모든 구성과 기록은 보존됩니다.',
      remainingDescription:
        '이 Project의 남은 활성 Application을 아카이브하시겠습니까? 이미 아카이브된 Application은 그대로 유지됩니다.',
    },
    unarchive: {
      // Chrome — button.
      button: 'Restore',
      // Content — toast.
      success: '프로젝트가 복원되었습니다',
    },
    purge: {
      // Chrome — destructive button + modal title + confirm button.
      button: 'Delete permanently',
      title: 'Delete project permanently',
      confirm: 'Delete permanently',
      // Content — confirmation prose + input placeholder (hint).
      description: '이 작업은 되돌릴 수 없습니다. 확인을 위해 프로젝트 이름을 입력하세요.',
      inputPlaceholder: '프로젝트 이름 입력',
    },
  },
  projectDetail: {
    // Content — descriptive copy.
    notFound: '프로젝트를 찾을 수 없습니다',
    notFoundSubtitle: 'id "{id}"에 해당하는 프로젝트가 없습니다',
    backToHome: '← Back to Home',
    noDeployments: '아직 배포가 없습니다',
    confirmDelete: '이 프로젝트를 삭제하시겠습니까?',
    tabs: {
      // Chrome — nav tabs.
      services: 'Resources',
      aiOps: 'AI Ops',
      settings: 'Settings',
    },
    diagnosis: {
      // Content — error/notice copy.
      noFixes: '구체적인 해결책이 반환되지 않았습니다.',
      fixFailed: 'AI로 수정 실패',
    },
    // Content — success toasts.
    redeploySuccess: '프로젝트 리디플로이 중...',
    stopSuccess: '프로젝트 중지됨',
    startSuccess: '프로젝트 시작됨',
    archiveSuccess: '프로젝트 아카이브됨',
    deleteSuccess: '프로젝트 삭제됨',
    // Chrome — back button.
    goBack: 'Back',
    danger: {
      // Chrome — nav label + section headings.
      nav: 'Danger',
      title: 'Danger zone',
      archiveTitle: 'Archive project',
      partialArchiveTitle: 'Archive remaining Applications',
      restoreTitle: 'Restore project',
      deleteTitle: 'Permanently delete project',
      // Content — descriptive copy + error.
      description: 'Project를 아카이브하거나 영구 삭제합니다.',
      archiveBody: '컨테이너를 중지하고 기본 목록에서 숨기되 설정은 보존합니다.',
      partialArchiveBody:
        '일부 Application이 이미 아카이브되어 있습니다. Project 아카이브를 완료하려면 남은 활성 Application을 아카이브하세요.',
      restoreBody: '보관된 프로젝트를 기본 프로젝트 목록으로 되돌립니다.',
      deleteBody: 'Project, Application, 컨테이너, 설정, 기록을 삭제합니다.',
      purgeDescription:
        'Project와 관련 런타임 리소스를 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
      unarchiveDescription: '보관된 프로젝트를 활성 프로젝트 목록으로 복원합니다.',
      archivedServicesTitle: 'Archived Applications',
      archivedServicesBody:
        '아카이브된 Application은 기본 목록에서 숨겨집니다. 여기에서 복원하거나 typed confirmation으로 영구 삭제하세요.',
      archivedServicesLoading: '아카이브된 Application을 불러오는 중…',
      archivedServicesEmpty: '이 Project에 아카이브된 Application이 없습니다.',
      archivedServicesLoadError: '아카이브된 Application을 불러오지 못했습니다',
      archivedServiceId: 'service_id: {id}',
      archivedServiceArchivedAt: '아카이브 시간 {value}',
      restoreService: 'Restore',
      deleteService: 'Delete',
      deleteArchivedServiceHint:
        '{slug}를 입력하면 이 아카이브된 Application을 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
      deleteArchivedServiceInputLabel: '{slug} 삭제 확인 입력',
      error: '프로젝트 작업에 실패했습니다',
    },
    addResourceWithAgent: '에이전트에게 Database/Cache 추가 요청',
    env: {
      // Chrome — form labels + buttons + status.
      add: 'Add',
      paste: 'Paste .env',
      cancel: 'Cancel',
      import: 'Parse & import',
      key: 'Key',
      value: 'Value',
      showValue: 'Show value',
      hideValue: 'Hide value',
      delete: 'Delete variable',
      save: 'Save',
      saving: 'Saving…',
      // Content — section copy, errors, hints, success toasts.
      title: 'Application 환경 변수',
      description:
        '이 변수들은 이 Application/Compose workload에만 적용됩니다. 먼저 저장한 뒤, 실행 중인 컨테이너에 반영하려면 다시 배포하세요.',
      loading: '환경 변수를 불러오는 중…',
      empty: '이 Application에 설정된 환경 변수가 없습니다.',
      pasteTitle: '.env 내용 붙여넣기',
      saved: '환경 변수를 저장했습니다.',
      savedNeedsRedeploy:
        '환경 변수를 저장했습니다. 변경사항을 반영하려면 이 Application을 재배포하세요.',
      unsavedChanges: '저장되지 않은 변경사항입니다. 저장하거나 새로고침해서 버릴 수 있습니다.',
      loadError: '환경 변수를 불러오지 못했습니다',
      saveError: '환경 변수 저장에 실패했습니다',
      duplicateKey: '중복된 환경 변수 키: {key}',
      invalidKey:
        '잘못된 환경 변수 키: {key}. 키는 영문자나 밑줄(_)로 시작해야 하며 영문자·숫자·밑줄만 사용할 수 있습니다.',
    },
    addService: {
      // Chrome — modal title + source option labels + form labels + buttons.
      title: 'Add application',
      descriptionPrefix: 'Project',
      git: 'From GitHub',
      image: 'From image',
      template: 'From template',
      templateDescription: 'Curated stacks',
      soon: '곧 출시',
      serviceName: 'Application name',
      repo: 'GitHub repository',
      branch: 'Branch',
      dockerfilePath: 'Dockerfile path',
      dockerTarget: 'Docker target',
      buildContext: 'Build context',
      imageReference: 'Image reference',
      containerPort: 'Container port',
      cancel: 'Cancel',
      create: 'Create application',
      creating: 'Creating…',
      // Content — descriptive copy + hints + error messages + success toast.
      descriptionSuffix: '· Git 또는 image 소스를 고르고 Application 이름을 지정하세요.',
      gitDescription: '레포지토리에서 빌드',
      imageDescription: 'OCI 이미지 pull',
      templateSoon: '템플릿은 곧 제공됩니다.',
      templateBody:
        '큐레이션된 스택(Postgres, Redis, n8n, Plausible, Umami)은 v0.2에서 제공될 예정입니다. 지금은 GitHub 또는 이미지 소스를 사용하세요.',
      serviceNameHint: '{path} 경로에 사용됩니다.',
      imageReferenceHint:
        'Docker Hub, GHCR 또는 OCI 레지스트리. 태그를 고정하세요 — :latest는 배포마다 달라질 수 있습니다.',
      success: '{name} Application을 배포 중입니다.',
      errorName:
        'Application 이름을 입력하거나 OpenLander가 이름을 추론할 수 있는 소스를 입력하세요.',
      errorRepo: 'GitHub 레포지토리 URL을 입력하세요.',
      errorImage: '이미지 레퍼런스를 입력하세요.',
      errorPort: '포트는 양의 정수여야 합니다.',
      errorCreate: 'Application 생성에 실패했습니다',
    },
    serviceDelete: {
      // Chrome — card title + modal title + form label + buttons.
      title: 'Delete this Application',
      confirmTitle: 'Delete Application',
      confirmLabel: 'Type',
      deleting: 'Deleting…',
      confirmButton: 'Delete Application',
      // Content — descriptive body + confirmation prose + error + checkbox label.
      body: '컨테이너와 Application 소유 설정을 제거합니다. Project 볼륨은 명시적으로 선택하지 않으면 보존됩니다.',
      confirmDescription:
        '실행 중인 컨테이너를 중지/제거하고 Application 소유 환경 변수, 도메인, 리소스 설정을 삭제합니다. Project 볼륨은 기본 보존됩니다.',
      deleteVolumes: '이 Project의 마지막 Application일 때 Project 소유 Docker 볼륨도 삭제합니다.',
      error: 'Application 삭제에 실패했습니다',
    },
    serviceLifecycle: {
      // Chrome — section heading.
      title: 'Application lifecycle',
      archivedBadge: '아카이브됨',
    },
    serviceArchive: {
      // Chrome — card title + modal title + buttons.
      title: '이 Application 아카이브',
      confirmTitle: 'Application 아카이브',
      archiving: '아카이브 중…',
      confirmButton: 'Application 아카이브',
      // Content — descriptive body + confirmation prose + error.
      body: '런타임을 중지하고 설정과 기록은 보존한 채 이 Application을 아카이브 상태로 표시합니다.',
      confirmDescription:
        '런타임을 중지하고 Application을 아카이브 상태로 표시합니다. 설정, 환경 변수, 도메인, 기록은 보존됩니다.',
      error: 'Application 아카이브에 실패했습니다',
    },
    serviceRestore: {
      // Chrome — card title + modal title + buttons.
      title: '이 Application 복원',
      confirmTitle: 'Application 복원',
      restoring: '복원 중…',
      confirmButton: 'Application 복원',
      // Content — descriptive body + confirmation prose + error.
      body: '아카이브된 Application을 다시 활성 라이프사이클로 되돌립니다. 런타임은 복원 후 재배포로 시작하세요.',
      confirmDescription:
        '아카이브 표시를 해제합니다. 컨테이너를 자동으로 시작하지는 않으므로, 복원 후 Application을 재배포하세요.',
      error: 'Application 복원에 실패했습니다',
    },
    servicesGuide: {
      empty:
        '아직 이 Project에 리소스가 없습니다. Application을 추가하거나 에이전트에게 Database/Cache/Storage 리소스를 추가해 달라고 요청하세요.',
      help: 'Project는 workspace입니다. Resources는 연결된 Application, Compose, Database, Cache, Storage입니다. MCP 후속 작업은 service_id를 사용하는 것이 가장 안전합니다.',
      banner:
        '아래 목록은 이 Project의 Application, Compose, Database/Cache/Storage 리소스를 함께 보여줍니다. 후속 작업에는 표시된 MCP service_id를 사용하세요.',
      archivedVisible:
        '아카이브된 Application도 표시 중입니다. Application을 열어 복원하거나 Application Danger zone에서 삭제할 수 있습니다.',
      showArchived: 'Show archived Applications',
      hideArchived: 'Hide archived Applications',
      loadingArchived: 'Loading archived Applications…',
      archivedLoadError: '아카이브된 Application을 불러오지 못했습니다: {message}',
      serviceId: 'MCP service_id: {id}',
      serviceIdTooltip:
        '선택한 Application/Compose/Database/Cache/Storage 리소스의 호환 id입니다. MCP 후속 작업에는 이 service_id를 전달하세요.',
    },
    domains: {
      // Chrome — action button + retry + badge.
      add: 'Add domain',
      legacyBadge: 'legacy CF',
      retry: 'Retry',
      // Content — empty state + descriptive hints + tooltip + load error + aria.
      empty: '아직 연결된 도메인이 없습니다.',
      emptyExternal:
        'Infrastructure-only 모드입니다. 라우팅은 외부 프록시(nginx, Caddy, Apache 등)에서 관리하세요.',
      tlsHint: 'v0.1에서는 TLS를 외부 프록시가 책임집니다. ACME 자동 발급은 v0.2 예정입니다.',
      dnsHint:
        'A/AAAA/CNAME 레코드를 OpenLander가 실행되는 서버를 가리키도록 직접 설정하세요. OpenLander는 DNS를 자동 관리하지 않습니다.',
      legacyTooltip:
        '이 매핑은 v0.1 이전 Cloudflare 통합 시 생성되었습니다. 현재는 호환 모드로 동작 중이며, 삭제 시 OpenLander 매핑만 제거됩니다. 외부 DNS 레코드는 그대로 유지됩니다.',
      removeAria: '도메인 제거',
      loadError: '도메인 목록을 불러오지 못했습니다. 목록이 최신이 아닐 수 있습니다.',
      dialog: {
        // Chrome — dialog title + form labels + buttons.
        title: 'Add domain',
        domain: 'Domain',
        path: 'Path',
        advanced: 'Advanced',
        stripPrefix: 'Strip path prefix',
        upstreamPathPrefix: 'Upstream path',
        targetPort: 'Target port',
        submit: 'Add domain',
        cancel: 'Cancel',
        submitting: 'Adding…',
        // Content — placeholders that include hint text + hint copy.
        domainPlaceholder: 'api.example.com',
        upstreamPathPlaceholder: '/backend (선택)',
        targetPortPlaceholder: '{port} (컨테이너 포트)',
        targetPortPlaceholderNone: '서비스 컨테이너 포트',
        stripPrefixHint:
          '컨테이너로 전달할 때 경로 접두사를 제거합니다 (대부분의 non-root 경로에 필요).',
      },
      delete: {
        // Chrome — modal chrome.
        title: 'Remove domain',
        confirm: 'Remove',
        cancel: 'Cancel',
        // Content — confirmation prose.
        description: 'OpenLander 매핑만 제거합니다. 외부 DNS 레코드는 그대로 유지됩니다.',
      },
      status: {
        // Chrome — status pills.
        active: 'active',
        pending: 'pending',
        error: 'error',
      },
      toast: {
        added:
          '도메인 라우트가 등록되었습니다. Traefik 반영에는 몇 초 걸릴 수 있으며 DNS/TLS는 외부에서 관리합니다.',
        removed: '도메인 라우트가 제거되었습니다.',
        routingDisabled:
          'Infrastructure-only 모드에서는 도메인 라우팅을 OpenLander가 관리하지 않습니다.',
        addFailed: '도메인 추가에 실패했습니다.',
        deleteFailed: '도메인 제거에 실패했습니다.',
      },
      error: {
        duplicate: '동일한 도메인과 경로 조합이 이미 존재합니다.',
        invalidDomain: '도메인 형식이 올바르지 않습니다.',
        invalidPath: '경로는 "/"로 시작해야 합니다.',
        invalidPort: '대상 포트는 1-65535 범위여야 합니다.',
        missingDomain: '도메인은 필수입니다.',
        invalidServiceKind: '도메인은 Application/Compose workload에만 연결할 수 있습니다.',
        serviceSelectionRequired:
          'Project에 Application/Compose workload가 여러 개 있습니다. service_id를 사용하세요.',
        notFound: '매핑을 찾을 수 없습니다.',
        serverError: '서버 오류가 발생했습니다.',
      },
    },
  },
  rollback: {
    // Chrome — modal title + buttons + recommendation chip.
    title: 'Rollback',
    confirm: 'Confirm rollback',
    cancel: 'Cancel',
    aiSuggestion: 'AI suggestion',
    useSuggestion: 'Use this suggestion',
    // Content — prompts + loading state + empty state.
    selectVersion: '롤백할 버전을 선택하세요',
    aiAnalyzing: 'AI가 롤백 대상을 분석 중...',
    noDeployments: '사용 가능한 배포가 없습니다',
  },
  blueGreen: {
    // Chrome — modal title + form label + buttons.
    title: 'Blue-green deploy',
    healthCheckPath: 'Health check path (optional)',
    confirm: 'Start blue-green deploy',
    cancel: 'Cancel',
    // Content — description + placeholder hint.
    description: '새 컨테이너를 생성하고, 헬스체크 후 트래픽을 전환합니다. 제로 다운타임.',
    healthCheckPlaceholder: '/health 또는 /api/health',
  },
  deploy: {
    // Chrome — back link.
    backToDeployments: 'Back to deployments',
    // Content — empty state + descriptive copy + confirm prompt.
    notFound: '배포를 찾을 수 없습니다',
    buildFailureDetected:
      '빌드 실패가 감지되었습니다. 아래 빌드 로그를 확인하거나 외부 에이전트에서 MCP 로그 도구를 사용하세요.',
    noBuildLog: '빌드 로그가 없습니다',
    killConfirm: {
      title: '이 배포를 중지할까요?',
      description:
        '진행 중인 빌드가 취소되고 새 컨테이너는 생성되지 않습니다. 문제를 해결한 뒤 다시 배포할 수 있습니다.',
    },
    dialog: {
      // Chrome — modal title + form label + action buttons + status pills.
      title: 'Deploy New Project',
      projectName: 'Project name (optional)',
      parseAndMap: 'Parse & map',
      matched: 'matched',
      missing: 'missing',
      extra: 'extra',
      rePaste: 'Re-paste',
      skipEnvVars: 'Skip — deploy without env vars',
      // Content — descriptive copy, errors, formatted counters.
      description:
        '배포할 레포지토리 URL을 입력하세요. OpenLander가 클론, 빌드 및 실행을 처리합니다.',
      autoDetected: '레포지토리에서 자동 감지됨',
      failed: '프로젝트 배포 실패',
      // Chrome — dialog title.
      pasteEnvTitle: 'Paste Environment Variables',
      pasteEnvDescription:
        '.env 파일 내용을 아래에 붙여넣으세요. 프로젝트에 필요한 변수와 자동으로 매핑됩니다.',
      pasteEnvPlaceholder: 'DATABASE_URL=postgresql://...\nAPI_KEY=sk-...\n# 주석은 무시됩니다',
      noValidPairs: '유효한 KEY=VALUE 쌍을 찾을 수 없습니다. 형식을 확인하세요.',
      varsMatched: '개 변수 매칭됨',
      varsMissing: '개 변수 누락됨',
      varsExtra: '개 추가 변수',
    },
    detail: {
      // Chrome — back button + table column labels.
      goBack: 'Back',
      deployment: 'Deployment',
      status: 'Status',
      trigger: 'Trigger',
      started: 'Started',
      duration: 'Duration',
      buildLogs: 'Build logs',
      runtimeLogs: 'Runtime logs',
      // Content — hint copy.
      runtimeLogsHint: '(리디플로이 전 최근 500줄)',
    },
  },
  settings: {
    nav: {
      // Chrome — sub-nav label.
      general: 'General',
      ai: 'AI',
    },
    general: {
      // Chrome — section title + form labels + buttons.
      title: 'General',
      displayName: 'Display name',
      slug: 'Slug',
      projectDescription: 'Description',
      tags: 'Tags',
      tagsPlaceholder: 'api, production',
      save: 'Save changes',
      saving: 'Saving...',
      // Content — descriptive prose, hints, errors, success toasts.
      description: 'Project의 표시 정보를 수정합니다. 슬러그는 고정됩니다.',
      displayNameRequired: '표시 이름을 입력하세요.',
      slugHelp: '안정적인 URL, 컨테이너, Traefik 라벨, MCP project_name에 사용됩니다.',
      saved: '프로젝트 정보가 저장되었습니다.',
      saveFailed: '프로젝트 정보를 저장하지 못했습니다.',
    },
    github: {
      // Chrome — instruction label + status + CTA button + form label + link.
      enterCode: 'Enter this code on GitHub:',
      waiting: 'Waiting for authorization...',
      connectWithGithub: 'Connect with GitHub',
      enterToken: 'Enter a Personal Access Token:',
      generateToken: 'Generate a token →',
      // Content — description.
      description: '비공개 레포지토리를 배포하려면 GitHub 계정을 연결하세요.',
    },
  },
  services: {
    status: {
      // Chrome — status pills.
      running: 'running',
      stopped: 'stopped',
      error: 'error',
    },
    managedDetail: {
      // Content — error titles + subtitle.
      notFound: '리소스를 찾을 수 없습니다',
      loadFailed: '리소스를 불러오지 못했습니다',
      notFoundSubtitle: 'id "{id}"에 해당하는 리소스가 없습니다',
      // Chrome — back-navigation links.
      backToProjects: '← Back to Projects',
      backToProject: '← Back to project',
      tabs: {
        aria: '서비스 섹션',
        overview: 'Overview',
        logs: 'Logs',
        connections: 'Connections',
      },
      logs: {
        title: 'Container logs',
        description: '리소스 컨테이너의 런타임 로그입니다.',
        refresh: 'Refresh',
        loading: 'Loading…',
        empty: '반환된 로그가 없습니다.',
        error: '로그를 불러오지 못했습니다',
      },
      connections: {
        title: 'Connected projects',
        description: '이 리소스를 참조하는 Project입니다.',
        refresh: 'Refresh',
        loading: 'Loading…',
        empty: '이 리소스에 연결된 Project가 없습니다.',
        openProject: 'Open project',
      },
      settings: {
        lifecycle: 'Lifecycle',
        lifecycleDescription: '저장된 데이터는 유지한 채 컨테이너를 시작하거나 중지합니다.',
        start: 'Start',
        starting: 'Starting…',
        stop: 'Stop',
        stopping: 'Stopping…',
        updated: '리소스 상태가 업데이트되었습니다.',
        actionError: '리소스 작업에 실패했습니다',
        deleteBody: '이 리소스 컨테이너와 영구 볼륨을 삭제합니다.',
        delete: 'Delete resource',
        deleting: 'Deleting…',
        confirmTitle: 'Delete Database/Cache/Storage resource',
        confirmDescription:
          '리소스 컨테이너, 저장된 인증 정보, 영구 볼륨을 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
        confirmLabel: '삭제하려면 이 리소스 이름을 입력하세요:',
        confirmDelete: 'Delete permanently',
        deleteError: '리소스를 삭제하지 못했습니다',
        deleteBlocked:
          '{count}개 Project가 이 리소스를 참조하고 있어 삭제할 수 없습니다. 먼저 연결을 해제하세요.',
        connectionCheckFailed: '연결 상태를 확인하지 못해 삭제가 차단되었습니다.',
      },
      // Chrome — field labels match the services.detail.overview.*
      // convention (English in both files for metric / field labels).
      field: {
        type: 'Type',
        status: 'Status',
        image: 'Image',
        port: 'Port',
        container: 'Container',
        containerId: 'Container ID',
        created: 'Created',
        updated: 'Updated',
      },
    },
    detail: {
      // Content — empty state.
      notFound: 'Application을 찾을 수 없습니다',
      // Content — error-card subtitles explaining why the Application wasn't found.
      notFoundReason: {
        noProjectParam:
          'Application을 찾으려면 Project 페이지에서 열어주세요. /services/{id} 직접 링크에는 ?project= 쿼리 파라미터가 필요합니다.',
        serviceNotInProject: 'Project "{projectId}"에 Application "{id}"가 없습니다.',
      },
      // Chrome — back-navigation link.
      backToHome: '← Back to Home',
      section: {
        // Chrome — SubCard section headings.
        source: 'Source',
        build: 'Build',
        runtime: 'Runtime',
        domains: 'Domains',
      },
      runtime: {
        // Content — button tooltip/aria-label prose.
        copyUrl: 'URL 복사',
        openInNewTab: '새 탭에서 열기',
        // Chrome — short field labels match overview.* convention
        // (English in both files for metric / field labels).
        publicUrlLabel: 'Access URL',
        cpuLabel: 'CPU',
        memLabel: 'Memory',
        // Content — descriptive sub captions.
        cpuSub: '현재 사용량',
        memSub: '현재 사용량',
      },
      source: {
        // Content — empty state on the Source SubCard.
        empty: '구성된 소스가 없습니다.',
      },
      build: {
        // Content — Build SubCard prose, split into two parts so the
        // monospace `openlander_deploy.create_deploy_plan` identifier
        // can render as a JSX <span> between them.
        prosePart1: '빌드 방식은 배포할 때마다 자동 감지됩니다. 에이전트로 재정의하려면 —',
        prosePart2: '를 사용해 Dockerfile 경로, 타겟 스테이지, 빌드 컨텍스트를 지정하세요.',
      },
      envVars: {
        // Chrome — short form-input placeholders, terse.
        keyPlaceholder: 'KEY',
        valuePlaceholder: 'value',
      },
      charts: {
        // Chrome — metric chart titles + abbreviations.
        cpu: 'CPU',
        memory: 'Memory',
        requestsPerSec: 'Requests / s',
        errorRate: 'Error rate',
        // Content — chart sub-captions describing the range.
        avgOverRange: '{range} 평균',
        p95Line: 'p95: {value} · {range}',
        errorRateSub: 'HTTP 5xx · 지난 1시간',
      },
      // Content — a11y label for the time-range select.
      timeRangeAria: '시간 범위',
      tabs: {
        // Chrome — nav tabs (English in both files per Chrome rule).
        overview: 'Overview',
        logs: 'Logs',
        deployments: 'Deployments',
        monitoring: 'Monitoring',
        ai: 'AI',
        environment: 'Environment',
        domains: 'Domains',
        // Legacy keys retained for Database/Cache/Storage tabs that have not
        // moved to the new v0.1 tab strip yet.
        connection: 'Connection',
        databases: 'Databases',
        settings: 'Settings',
      },
      toasts: {
        // Content — toast prose.
        started: 'Application이 시작되었습니다',
        stopped: 'Application이 중지되었습니다',
        deleted: 'Application이 삭제되었습니다',
        startFailed: 'Application 시작에 실패했습니다',
        stopFailed: 'Application 중지에 실패했습니다',
        deleteFailed: 'Application 삭제에 실패했습니다',
        loadDatabasesFailed: '데이터베이스를 불러오지 못했습니다',
        dbCreated: '데이터베이스가 생성되었습니다',
        dbCreateFailed: '데이터베이스 생성에 실패했습니다',
        userCreated: '사용자가 생성되었습니다',
        userCreateFailed: '사용자 생성에 실패했습니다',
        connStringCopied: '연결 문자열을 클립보드에 복사했습니다',
        copiedToClipboard: '클립보드에 복사했습니다',
      },
      header: {
        // Chrome — back link + action buttons.
        backToServices: 'Back to Resources',
        start: 'Start',
        stop: 'Stop',
        delete: 'Delete',
      },
      // Chrome — refresh button.
      refresh: 'Refresh',
      // Content — loading / empty / format strings.
      loadingDatabases: '데이터베이스 로딩 중...',
      serviceIsStopped: 'Application이 중지되었습니다',
      serviceStoppedHint: '로그를 보려면 Application을 시작하세요.',
      showingLast: '최근',
      noProjectsUsing: '이 리소스를 사용하는 Project가 없습니다',
      // Chrome — dropdown labels.
      selectDatabase: 'Select a database',
      selectVersion: 'Select a version',
      // Content — loading / empty.
      loadingLogs: '로그 로딩 중...',
      noLogsAvailable: '표시할 로그가 없습니다',
      linesCount: '{count}줄',
      overview: {
        // Chrome — KPI tile labels.
        status: 'Status',
        container: 'Container',
        cpu: 'CPU',
        memory: 'Memory',
        network: 'Network',
        volume: 'Volume',
        connections: 'Connections',
        connectedProjects: 'Connected projects',
        // Content — loading + format strings.
        loading: '로딩 중...',
        na: '없음',
        portLabel: '포트 {port}',
        maxSuffix: '/ 최대 {count}',
      },
    },
    empty: {
      // Content — empty state.
      title: '리소스가 없습니다',
      description: 'Database, Cache 또는 Storage 리소스 생성을 에이전트에게 요청하세요.',
    },
    create: {
      toasts: {
        // Content — toast prose.
        success: '리소스가 생성되었습니다',
        errorFallback: '리소스 생성에 실패했습니다',
      },
    },
  },
  timeline: {
    empty: '아직 활동이 없습니다',
    deployToSee: '에이전트 타임라인을 보려면 이 프로젝트를 배포하세요.',
    awaitingInstruction: '다음 지시 대기 중...',
    aiWorking: 'AI가 작업 중입니다...',
    typeAnswer: '직접 답변 입력...',
    toolExecuting: '실행',
    analyzing: '분석 중...',
    buildFailed: '빌드 실패',
    detailedCauseExplanation: '구체적 원인 설명 ▾',
    recovery: {
      complete: 'AI 복구 완료',
      inProgress: 'AI 복구 진행 중...',
      options: 'AI 복구 옵션',
    },
    errorAnalysis: {
      // Chrome — section title + section labels + action buttons.
      title: 'Build Error Analysis',
      viewDetails: 'View raw details ▾',
      rootCause: 'Root Cause',
      suggestedFixes: 'Suggested Fixes',
      confidence: 'Confidence',
      viewLogs: 'View Logs',
      hideLogs: 'Hide Logs',
      applyFix: 'Apply Fix',
      applying: 'Applying...',
      // Content — empty state + error toast.
      noFixes: '구체적인 해결책이 반환되지 않았습니다.',
      fixFailed: 'AI로 수정 실패',
    },
    fixProposal: {
      // Chrome — section title + diff labels + action buttons.
      title: 'Fix Proposal',
      changes: 'Changes',
      diff: 'Proposed Changes',
      approve: 'Approve & Apply',
      reject: 'Reject',
      showAlternatives: 'Show Alternatives',
      before: 'Before',
      after: 'After',
      skip: 'Skip',
      // Content — status toast.
      answered: '수정 제안에 답변함',
    },
    composeError: {
      // Chrome — section title + form label + badge + selection label.
      title: 'Compose Error Detected',
      selectPattern: 'Select a pattern to apply',
      envVarsOptional: 'Environment Variables (Optional)',
      recommended: 'Recommended',
      // Content — status toast.
      answered: 'Compose 수정에 답변함',
    },
  },
  share: {
    // Chrome — modal title + form label + buttons.
    title: 'Share project',
    accessCode: 'Access code',
    generate: 'Generate',
    shareButton: 'Share via access code',
    stopSharing: 'Stop sharing',
    copyInvitation: 'Copy invitation',
    copied: 'Copied!',
    // Content — hints and notices.
    accessCodeHint: '최소 4자. 이 코드가 있으면 누구나 프로젝트에 접근할 수 있습니다.',
    alreadyShared: '이 프로젝트는 현재 공유 중입니다.',
    notRunning: '공유하려면 프로젝트가 실행 중이어야 합니다.',
  },
  prPreviews: {
    noPreviews: 'PR 프리뷰 없음',
    description: 'PR이 열리면 프리뷰가 자동으로 생성됩니다.',
  },
  logs: {
    streamDisconnected: '빌드 스트림 연결이 끊어졌습니다. 서버가 재시작되었을 수 있습니다.',
    staleBuildWarning:
      '2분 이상 빌드 활동이 없습니다. 빌드가 멈췄거나 서버가 재시작되었을 수 있습니다.',
    noLogs: '사용 가능한 로그가 없습니다',
    noMatching: '일치하는 줄이 없습니다',
    loadingTitle: '실시간 로그에 연결 중',
    loadingBody: '스트림 응답을 기다리는 중입니다. 새 출력이 도착하면 여기에 표시됩니다.',
    emptyTitle: '아직 로그가 없습니다',
    emptyBody: '이 프로젝트에서 아직 런타임 출력을 기록하지 않았습니다.',
    errorTitle: '로그 스트림 오류',
    errorBody:
      '실시간 스트림에 일시적인 오류가 발생했습니다. 다시 연결하여 로그 업데이트를 재개하세요.',
    disconnectedTitle: '실시간 팔로우 연결 끊김',
    disconnectedBody: '기존 로그는 유지되지만 다시 연결할 때까지 새 줄은 들어오지 않습니다.',
    disconnectedInlineBody:
      '실시간 업데이트가 중단되었습니다. 다시 연결하여 최신 출력을 계속 따라가세요.',
    noMatchingTitle: '일치하는 줄이 없습니다',
    noMatchingBody: '검색어나 레벨 필터를 조정하면 로그 줄을 다시 볼 수 있습니다.',
    collectedAtTooltip: 'Docker 로그 메타데이터에서 수집한 로컬 시각',
    // Chrome — action buttons + status badges.
    retryStream: 'Reconnect stream',
    clearFilters: 'Clear filters',
    terminalReadyBadge: 'Ready',
    // Content — terminal state titles + bodies.
    terminalReadyTitle: '터미널 준비 완료',
    terminalReadyBody: '셸이 열려 있어도 로그는 계속 실시간으로 표시됩니다.',
    terminalStandbyBadge: 'Standby',
    terminalStandbyTitle: '터미널 대기 중',
    terminalStandbyBody: '로그는 계속 스트리밍됩니다. 셸을 다시 연결하려면 Console 탭을 여세요.',
    terminalUnavailableBadge: 'Unavailable',
    terminalBuildingTitle: '빌드 중에는 터미널을 사용할 수 없습니다',
    terminalBuildingBody: '다음 실행 가능한 컨테이너가 준비되는 동안에는 실시간 로그를 확인하세요.',
    terminalProjectErrorTitle: '프로젝트 오류 중에는 터미널을 사용할 수 없습니다',
    terminalProjectErrorBody:
      '오류 원인은 로그에서 확인하세요. 컨테이너가 다시 실행되면 셸도 돌아옵니다.',
    terminalInactiveTitle: '컨테이너가 실행 중이 아닙니다',
    terminalInactiveBody: '대화형 셸을 열려면 프로젝트를 시작하세요.',
    terminalConnected: '셸 연결됨',
    terminalConnecting: '셸 여는 중...',
    terminalConnectingBody: '실행 중인 컨테이너 안에서 터미널 세션을 준비하고 있습니다.',
    terminalError: '셸 오류',
    terminalErrorBody: '셸 세션 시작에 실패했습니다. 다시 연결하여 재시도하세요.',
    terminalDisconnected: '셸 연결 끊김',
    terminalDisconnectedBody: '셸 세션이 종료되었습니다. 다시 연결하여 새 셸을 여세요.',
    terminalReconnect: 'Reconnect shell',
  },
  command: {
    // Chrome — command palette entries (action labels).
    noResults: 'No results',
    deployNewRepo: 'Deploy new repo',
    triggerFreshDeploy: 'Trigger fresh deploy',
    stopContainer: 'Stop running container',
    // Content — placeholder hint.
    searchPlaceholder: '명령어 입력 또는 검색...',
  },
  oauth: {
    // Content — error toast.
    startFailed: '인증 시작 실패',
    // Chrome — label preceding provider name.
    signInWith: 'Sign in with',
    // Content — notice.
    personalDevOnly: '⚠ 개인 개발 목적으로만 구독을 사용하세요.',
  },
  providerHelp: {
    anthropic: {
      // Content — conversational heading + instruction.
      usingClaudeCode: 'Claude Code를 사용 중이신가요?',
      inTerminal: '명령어를 실행하여 토큰을 얻은 다음 아래에 붙여넣으세요.',
      // Chrome — link label.
      learnMore: 'Learn more about Anthropic API',
    },
    gemini: {
      // Content — conversational heading + description.
      needKey: 'Gemini API 키가 필요하신가요?',
      freeTier: 'Google은 Gemini 모델에 대해 넉넉한 무료 티어를 제공합니다.',
      // Chrome — link label.
      getFreeKey: 'Get a free API key from Google AI Studio',
    },
  },
  project: {
    tabs: {
      // Chrome — primary nav tabs.
      overview: 'Overview',
      deployments: 'Deployments',
      recovery: 'Recovery',
      runtime: 'Runtime',
      settings: 'Settings',
    },
    confirm: {
      // Chrome — modal buttons.
      // Chrome — modal buttons + titles.
      confirm: 'Confirm',
      cancel: 'Cancel',
      stopTitle: 'Stop Project',
      deleteTitle: 'Delete Project',
      // Content — confirmation prose.
      stopDescription: '이 프로젝트를 중지하시겠습니까?',
      deleteDescription: '이 프로젝트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
    },
    header: {
      status: {
        // Chrome — status pills.
        live: 'Live',
        stopped: 'Stopped',
        deploying: 'Deploying',
        pulling: 'Pulling image',
        failed: 'Failed',
        idle: 'Idle',
      },
      action: {
        // Chrome — action buttons.
        deploy: 'Deploy',
        deploying: 'Deploying...',
        pulling: 'Pulling image...',
        start: 'Start',
        redeploy: 'Redeploy',
        pullRestart: 'Pull & restart',
        stop: 'Stop',
        rollback: 'Rollback',
        blueGreen: 'Blue-green deploy',
        more: 'More actions',
        // Content — tooltip prose (hover, descriptive).
        aiPipelineTooltip: 'OpenLander가 배포 파이프라인을 처리합니다',
        pipelineTooltip: 'OpenLander가 배포 파이프라인을 처리합니다',
      },
      share: {
        // Chrome — buttons + status.
        share: 'Share',
        shared: 'Shared',
        exposed: 'Exposed',
      },
    },
    // Chrome — action labels.
    disconnectService: 'Disconnect service',
    copyUrl: 'Copy URL',
  },
  approval: {
    banner: {
      // Chrome — field labels + buttons.
      project: 'Project',
      tool: 'Tool',
      attempt: 'Attempt',
      approve: 'Approve',
      reject: 'Reject',
      // Content — banner title + result + error text.
      title: '복구 승인 필요',
      approved: '복구가 승인되었습니다',
      rejected: '복구가 거부되었습니다',
      error: '승인 처리에 실패했습니다',
      timedOut: '승인 시간 초과',
    },
    pendingStrip: {
      // Chrome — source labels + buttons.
      mcpSource: 'MCP',
      recoverySource: 'Recovery',
      details: 'Details:',
      actor: 'Requested by:',
      review: 'Review',
      hide: 'Hide',
      approve: 'Approve',
      reject: 'Reject',
      // Content — strip title + body + result + error + format.
      title: '에이전트 작업이 승인을 기다리고 있습니다',
      summaryOne: '승인이 필요한 에이전트 작업 1개',
      summaryMany: '승인이 필요한 에이전트 작업 {count}개',
      body: 'OpenLander가 실행하기 전에 위험 MCP 작업을 검토하세요.',
      loadWarning: '승인 대기 목록을 새로고침하지 못했습니다. 마지막으로 확인된 요청을 표시합니다.',
      approved: '승인을 보냈습니다',
      rejected: '거부를 보냈습니다',
      error: '승인 처리에 실패했습니다',
      more: '승인 대기 요청 {count}개 더 있음',
    },
  },
  'recovery-blocked': '복구 차단됨',
  'recovery-stopped': '복구 중지됨',
  recovering: '복구 중',
  'ai-running': '자동화 실행 중',
  'ai-completed': '자동화 완료',

  recovery: {
    // Chrome — section titles.
    incidentHistory: 'Incident history',
    postmortems: 'Postmortems',
    pendingApprovals: 'Pending approvals',
    activeRecovery: 'Active recovery',
    // Content — empty states + format strings.
    noIncidents: '기록된 장애가 없습니다.',
    noPostmortems:
      '성공적인 복구 후 보고서가 자동 생성됩니다. 메모리에 보관되며 서버 재시작 시 초기화됩니다.',
    noApprovals: '대기 중인 승인 요청이 없습니다.',
    agentStep: '단계 {current}/{total}: {description}',
    agentStarted: '{time}에 시작됨',
    agentAnalyzing: '분석 중...',
  },
  recoveryTab: {
    // Chrome — buttons + labels.
    retry: 'Retry',
    approve: 'Approve',
    reject: 'Reject',
    postmortemReport: 'Postmortem report',
    attempt: 'Attempt',
  },
  approvalsTab: {
    // Chrome — labels + buttons.
    requested: 'Requested',
    approve: 'Approve',
    reject: 'Reject',
    // Content — empty state.
    noPendingApprovals: '대기 중인 승인이 없습니다',
    emptyMessage: '승인 요청이 검토가 필요할 때 여기에 표시됩니다.',
  },
  postmortemsTab: {
    // Chrome — entry labels.
    postmortem: 'Postmortem',
    generated: 'Generated',
    // Content — empty state.
    noPostmortems: '아직 장애 분석이 없습니다',
    emptyMessage:
      '성공적인 복구 후 보고서가 자동 생성됩니다. 메모리에 보관되며 서버 재시작 시 초기화됩니다.',
  },
  patternsTab: {
    // Chrome — table column labels.
    patternType: 'Pattern type',
    errorSignature: 'Error signature',
    fixAction: 'Fix action',
    successFailure: 'Success / failure',
    lastSeen: 'Last seen',
    unknown: 'Unknown',
    // Content — empty state.
    noPatterns: '아직 학습된 패턴이 없습니다',
    emptyMessage: '플랫폼이 오류를 만나고 해결할 때마다 패턴이 누적됩니다.',
  },
  usageTab: {
    // Chrome — KPI + table column labels.
    totalCost: 'Total cost',
    totalTokens: 'Total tokens',
    in: 'In',
    out: 'Out',
    totalCalls: 'Total calls',
    recentActivity: 'Recent activity',
    time: 'Time',
    action: 'Action',
    model: 'Model',
    tokens: 'Tokens',
    cost: 'Cost',
    // Content — empty states.
    noUsage: '내장 사용 기록이 없습니다',
    emptyMessage: '이 기능이 활성화되면 사용 데이터가 표시됩니다.',
    noRecentActivity: '최근 활동이 없습니다',
  },
  mcpServer: {
    // Chrome — brand title. English per chrome-stays-English convention.
    title: 'Your Agent',
    // Content — description.
    subtitle: 'Claude 또는 다른 MCP 클라이언트에서 리소스를 관리하세요.',
    row: {
      // Chrome — bare labels + actions.
      status: '상태',
      instance: '인스턴스 이름',
      endpoint: '엔드포인트',
      tryThis: '에이전트 요청 예시',
      token: '액세스 토큰',
      copy: '복사',
      copied: '복사됨',
      copyEndpoint: '엔드포인트 복사',
      // Content — formatted display.
      lastCall: '마지막 호출 · {when}',
    },
    status: {
      // Chrome — status pills double as log values.
      connected: '연결됨',
      listening: '대기 중',
      checking: '확인 중…',
      unknown: '알 수 없음',
      unreachable: '연결 불가',
    },
    tokens: {
      // Chrome — defaults + action buttons + reveal/hide affordance.
      defaultName: 'OpenLander 기본값',
      loading: '불러오는 중…',
      generateAction: '토큰 발급',
      issuing: '발급 중…',
      regenerateAction: '재발급',
      regenerating: '재발급 중…',
      reveal: '표시',
      hide: '숨기기',
      // Content — confirmation prompts, success/error notices, hints.
      issueFailed: '토큰 발급에 실패했습니다',
      regenerateConfirm: {
        title: 'MCP 토큰을 재발급할까요?',
        description:
          '기존 토큰은 무효화됩니다. 그 토큰을 사용하는 MCP 클라이언트는 다음 요청부터 401 오류로 거부되며, 새 토큰을 설정에 적용해야 다시 연결됩니다.',
        confirmLabel: '토큰 재발급',
      },
      regenerateSuccess: '토큰이 재발급되었습니다. 클라이언트 설정을 새 토큰으로 업데이트하세요.',
      regenerateFailed: '토큰 재발급에 실패했습니다',
      legacyTokenRotated:
        '이전에 사용하던 API 토큰(ol_…)이 이번 변경과 함께 무효화되었습니다. 해당 토큰을 사용 중인 MCP 클라이언트가 있다면 갱신해주세요.',
      revealedHint: '비밀번호처럼 취급하세요. 한 번만 표시되니 닫기 전에 복사해두세요.',
      passwordHint: '비밀번호와 같습니다. 유출 시 모든 프로젝트가 노출되니 주의하세요.',
      issuedAt: '{when} 발급',
      loadFailed: '토큰 목록을 불러오지 못했습니다',
    },
    instance: {
      // Chrome — buttons.
      save: '저장',
      saving: '저장 중…',
      // Content.
      saved: '인스턴스 이름을 저장했습니다.',
      saveFailed: '인스턴스 이름을 저장하지 못했습니다',
      loadFailed: '인스턴스 정보를 불러오지 못했습니다.',
      defaultWarning:
        '같은 AI 클라이언트에 여러 OpenLander 서버를 연결한다면 이 이름을 더 구체적으로 바꾸세요.',
      tryPrompt: '{name}에 이 프로젝트 배포해줘',
      tryHelp:
        '서버 이름을 같이 말하면 여러 OpenLander 서버가 연결되어 있어도 AI가 올바른 서버를 선택하기 쉽습니다.',
      troubleshootingTitle: 'AI가 Docker나 SSH로 진행하려고 하나요?',
      troubleshootingHint: '그럴 때만 아래 문장을 한 번 붙여넣으세요.',
      copyCorrection: '보정 프롬프트 복사',
    },
    setup: {
      // Chrome — section title + action. English per chrome convention.
      title: 'Setup',
      copyConfig: '설정 복사',
      copyNeedsGenerate: '토큰 발급 후 복사',
      copyNeedsRegenerate: '재발급 후 복사',
      copyNeedsReveal: '토큰 표시 후 복사',
      // Content — descriptive copy.
      subtitle: '클라이언트를 선택하고 설정 스니펫을 붙여넣으세요.',
      restartHint: '저장 후 클라이언트를 재시작하세요. 첫 호출 시 위 상태가 연결됨으로 바뀝니다.',
      placeholderHint: '토큰을 발급하기 전까지는 예시에 <your-token> 자리표시자가 사용됩니다.',
      revealToCopyHint: '실제 토큰이 포함된 설정을 복사하려면 토큰을 발급하세요.',
    },
    recent: {
      // Chrome — section title + link affordance. English per chrome convention.
      title: 'Recent agent calls',
      fullTimeline: 'Full timeline',
      // Content — descriptive copy and empty-state message.
      subtitle: 'MCP 호출 이벤트만 표시합니다. 전체 기록은 Activity에서 확인하세요.',
      empty: '아직 에이전트 호출이 없습니다. MCP 배포·접속이 여기에 표시됩니다.',
    },
  },
  webServer: {
    // Chrome — section title.
    title: 'Web Server',
    // Content — descriptive copy.
    subtitle: '라우트와 포트 현황을 실시간으로 보여주는 읽기 전용 화면입니다.',
    dockerUnavailable: 'Docker가 응답하지 않습니다. 라우트와 포트 정보가 최신이 아닐 수 있습니다.',
    footer: '읽기 전용 · 라우트 편집은 v0.2에서 제공됩니다.',
    strip: {
      // Chrome — short labels + status pills.
      proxy: 'Proxy',
      routes: 'Routes',
      entrypoints: 'Entrypoints',
      allHealthy: 'all healthy',
      unknown: 'status unavailable',
      // Content — formatted display.
      issuesCount: '{count}건 이슈',
      lastReload: '{when} 재로드',
    },
    proxy: {
      // Chrome — status pills double as ProxyStatusCode log values.
      checking: 'Checking…',
      unknown: 'Unknown',
      // src/web/api/web-server-routes.ts의 `ProxyStatusCode` union과
      // 동기화. backend가 statusCode를 노출하지 않는 구버전(롤링 업그레이드
      // 중)에서는 free-form `proxy.status`를 그대로 폴백 렌더링합니다.
      statusCode: {
        docker_unavailable: 'Docker unreachable',
        no_proxy_managed: 'No proxy · OpenLander will start Traefik',
        no_proxy_external: 'No proxy detected',
        traefik_managed: 'Traefik{versionLabel}',
        traefik_external: 'Traefik{versionLabel} (external)',
        traefik_provider_disabled: 'Traefik · Docker provider disabled',
        unsupported_proxy: '{type} (not integrated)',
      },
    },
    issues: {
      // Content — formatted alert title + sentence-shape diagnostic codes.
      title: '라우트 이슈 {count}건이 감지되었습니다',
      codes: {
        service_not_running: '서비스가 실행 중이 아닙니다',
        container_not_running: '컨테이너가 실행 중이 아닙니다',
        missing_container_port: '서비스에 라우트 대상 포트가 없습니다',
        domain_pending: '커스텀 도메인이 아직 준비되지 않았습니다',
        domain_error: '커스텀 도메인 상태에 문제가 있습니다',
      },
    },
    configuration: {
      // Content — setup warning for containerized installs without an advertised host.
      title: 'Web server 설정 확인 필요',
      codes: {
        advertised_host_missing:
          'Advertised host가 설정되지 않았습니다. 생성되는 서비스 라우트가 다른 기기에서도 열리도록 OPENLANDER_PUBLIC_HOST를 LAN IP나 도메인으로 설정하세요.',
      },
    },
    routes: {
      // Chrome — section title + table headers.
      title: '감지된 라우트',
      col: {
        host: 'Route host',
        service: 'Service',
        port: 'Port',
        tls: 'TLS',
        status: 'Status',
      },
      // Content — descriptive copy + loading / empty messages.
      subtitle:
        'OpenLander가 감지한 읽기 전용 라우팅 상태입니다. 커스텀 도메인 추가와 삭제는 Application 상세의 Domains 탭에서 관리하세요.',
      loading: '라우트를 불러오는 중…',
      loadFailed: '라우트를 불러오지 못했습니다.',
      empty:
        '아직 감지된 공개 라우트가 없습니다. Application을 외부에 노출하거나 Application 상세의 Domains 탭에서 커스텀 도메인을 추가하세요.',
    },
    ports: {
      // Chrome — section title + table headers + status pills.
      title: 'Port allocation',
      unmanaged: 'Unmanaged',
      col: {
        service: 'Service',
        hostPort: 'Port',
        environment: 'Environment',
      },
      env: {
        production: 'production',
        development: 'development',
        outside: 'outside range',
      },
      // Content — summary + loading / empty messages.
      summary: '호스트 포트 {count}개가 사용 중',
      loading: '포트 할당을 불러오는 중…',
      loadFailed: '포트 할당을 불러오지 못했습니다.',
      empty: '아직 포트 할당이 없습니다.',
    },
    external: {
      // Chrome — section title.
      title: 'External containers',
      // Content — summary + loading / empty messages.
      summary: '호스트에서 {count}개 실행 중',
      empty: '감지되지 않음',
      loading: '외부 컨테이너를 불러오는 중…',
      loadFailed: '외부 컨테이너를 불러오지 못했습니다.',
    },
    tls: {
      // Chrome — status pills.
      ok: 'valid',
      expiring: 'expires soon',
      invalid: 'invalid',
      absent: 'no TLS',
      unknown: 'unknown',
    },
    status: {
      // Chrome — status pills.
      healthy: 'healthy',
      warning: 'warning',
      error: 'error',
      inactive: 'inactive',
    },
  },
  gitProviders: {
    // Chrome — page title.
    title: 'Git Providers',
    // Content — descriptive subtitle.
    subtitle: 'v0.1에서는 GitHub만 지원합니다.',
    github: {
      // Chrome — card title (brand name stays English everywhere).
      cardTitle: 'GitHub',
      // Chrome — action buttons + menu labels.
      manageOnGithub: 'Manage on GitHub',
      moreActionsLabel: 'More actions',
      reauthorize: 'Re-authorize',
      refreshRepoList: 'Refresh repo list',
      disconnect: 'Disconnect',
      // Content — confirmation prose.
      disconnectConfirm: {
        title: 'GitHub 연결을 해제할까요?',
        description:
          'OpenLander가 GitHub 저장소에 접근할 수 없게 됩니다. 이미 배포된 Application은 계속 동작하지만, 비공개 저장소에서 새 배포는 다시 연결할 때까지 실패합니다.',
        confirmLabel: 'Disconnect GitHub',
      },
      authMethod: {
        // Chrome — method labels.
        oauth: 'OAuth',
        pat: 'Personal access token',
        unknown: 'Unknown',
      },
      pip: {
        // Chrome — status pills.
        connected: 'Connected',
        invalid: 'Token rejected',
        unknown: 'Status unavailable',
        disconnected: 'Not connected',
      },
      stats: {
        // Chrome — KPI labels.
        reposLinked: 'Repos linked',
        lastSync: 'Last sync',
        connectedOn: 'Connected on',
        scopes: 'OAuth scopes',
      },
      // Content — descriptive notices.
      scopesEmpty: '보고된 권한 없음',
      scopesUnavailableForPat: '권한 정보는 GitHub OAuth에서만 제공됩니다',
      // Chrome — status indicator.
      pendingFirstSync: 'pending first sync',
      empty: {
        // Chrome — empty state CTA button + heading.
        title: 'Connect GitHub',
        // Content — empty state body.
        body: 'OpenLander가 저장소를 읽을 수 있도록 인증하세요. 배포·웹훅·Application 추가에서 저장소를 찾을 수 있게 됩니다.',
        // Chrome — CTA button.
        cta: 'Connect GitHub',
      },
      // Content — error messages with context.
      validationError: 'GitHub가 이 토큰을 거부했습니다: {message}',
      validationUnreachable: '토큰 검증을 위해 GitHub에 연결할 수 없습니다: {message}',
      loading: 'GitHub 상태를 불러오는 중…',
      loadFailed: 'GitHub 상태를 불러오지 못했습니다.',
      // Chrome — retry button.
      retry: 'Retry',
    },
    others: {
      // Chrome — section title + provider names + version badge.
      title: 'Other providers',
      laterBadge: 'Later',
      gitlab: 'GitLab',
      bitbucket: 'Bitbucket',
      // Chrome — badge label.
      comingLater: 'Planned after 0.2',
    },
  },
  // Canonical OpenLander 용어. 프로젝트 정책상 모든 로케일에서 영어 표기를
  // 유지합니다 (CONTRIBUTING / agent memory 참고). 주변 서술 카피는 한국어로
  // 자유롭게 번역되지만, 엔티티 종류를 가리키는 chrome — 헤더 키커,
  // breadcrumb, 페이지 뱃지 — 은 하드코딩하지 말고 이 키를 사용하세요.
  vocab: {
    project: 'Project',
    projectGroup: 'Project',
    application: 'Application',
    compose: 'Compose',
    database: 'Database',
    cache: 'Cache',
    storage: 'Storage',
    resource: 'Resource',
    resources: 'Resources',
    deployableService: 'Application',
    managedService: 'Database/Cache/Storage resource',
    infrastructureService: 'Database/Cache/Storage resource',
  },
  serviceDetail: {
    runtime: {
      cpuSub: '현재 사용량',
      memorySub: '현재 사용량',
    },
    deploy: {
      failed: '배포에 실패했습니다.',
      fallbackError: '배포 실패',
      dismiss: '닫기',
      // 재배포 라우트가 409 / DEPLOY_LOCKED 를 반환했을 때 노출합니다 —
      // 같은 프로젝트의 다른 배포가 진행 중인 상황 (다른 탭, MCP 에이전트,
      // 웹훅 푸시 등).
      locked: '이미 배포가 진행 중입니다. 완료 후 다시 시도하세요.',
    },
  },
} as const;
