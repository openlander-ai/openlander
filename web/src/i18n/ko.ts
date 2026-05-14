export const translations = {
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
        // Chrome — filter chip labels.
        label: 'Type',
        all: 'All',
        deploy: 'Deploys',
        config: 'Config',
        crash: 'Crashes',
        mcp: 'MCP',
      },
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
      services: 'Unhealthy Services',
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
      pendingApprovals: '{count}개의 승인 대기',
      unhealthyServices: '{count}개의 비정상 서비스',
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
    // Chrome — page title + primary action + CTA button.
    title: 'Projects overview',
    newProject: 'New project',
    deployFirstApp: 'Deploy your first app',
    // Content — empty state + descriptive copy + error.
    monitored: '프로젝트 {count}개 모니터링 중',
    noProjects: '프로젝트가 없습니다',
    connectGithub: 'GitHub 레포지토리를 연결하면 에이전트가 나머지를 처리합니다.',
    error: {
      invalidName:
        '프로젝트 이름은 소문자 또는 숫자로 시작해야 하며, 소문자, 숫자, 하이픈만 포함할 수 있습니다',
    },
    filter: {
      // Chrome — toggle label.
      showArchived: 'Show archived',
    },
    card: {
      // Chrome — card field labels + badges.
      archivedBadge: 'archived',
      lastDeploy: 'Last deploy',
      branch: 'Branch',
      endpoint: 'Endpoint',
      public: 'public',
    },
    archive: {
      // Chrome — button.
      button: 'Archive',
      // Content — toast + confirmation prose.
      success: '프로젝트가 보관되었습니다',
      description:
        '이 프로젝트를 보관하시겠습니까? 컨테이너는 중지되지만 모든 구성과 기록은 보존됩니다.',
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
    noDeployments: '아직 배포가 없습니다',
    confirmDelete: '이 프로젝트를 삭제하시겠습니까?',
    tabs: {
      // Chrome — nav tabs.
      services: 'Services',
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
      restoreTitle: 'Restore project',
      deleteTitle: 'Permanently delete project',
      // Content — descriptive copy + error.
      description: '프로젝트 그룹을 보관하거나 영구 삭제합니다.',
      archiveBody: '컨테이너를 중지하고 기본 목록에서 숨기되 설정은 보존합니다.',
      restoreBody: '보관된 프로젝트를 기본 프로젝트 목록으로 되돌립니다.',
      deleteBody: '프로젝트 그룹, 서비스, 컨테이너, 설정, 기록을 삭제합니다.',
      purgeDescription:
        '프로젝트 그룹과 관련 런타임 리소스를 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
      unarchiveDescription: '보관된 프로젝트를 활성 프로젝트 목록으로 복원합니다.',
      error: '프로젝트 작업에 실패했습니다',
    },
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
      title: '서비스 환경 변수',
      description:
        '이 변수들은 이 배포 서비스에만 적용됩니다. 먼저 저장한 뒤, 실행 중인 컨테이너에 반영하려면 이 서비스를 재배포하세요.',
      loading: '환경 변수를 불러오는 중…',
      empty: '이 서비스에 설정된 환경 변수가 없습니다.',
      pasteTitle: '.env 내용 붙여넣기',
      saved: '환경 변수를 저장했습니다.',
      savedNeedsRedeploy:
        '환경 변수를 저장했습니다. 변경사항을 반영하려면 이 서비스를 재배포하세요.',
      unsavedChanges: '저장되지 않은 변경사항입니다. 저장하거나 새로고침해서 버릴 수 있습니다.',
      loadError: '환경 변수를 불러오지 못했습니다',
      saveError: '환경 변수 저장에 실패했습니다',
      duplicateKey: '중복된 환경 변수 키: {key}',
      invalidKey:
        '잘못된 환경 변수 키: {key}. 키는 영문자나 밑줄(_)로 시작해야 하며 영문자·숫자·밑줄만 사용할 수 있습니다.',
    },
    addService: {
      // Chrome — modal title + source option labels + form labels + buttons.
      title: 'Add a service',
      descriptionPrefix: 'Project',
      git: 'From GitHub',
      image: 'From image',
      template: 'From template',
      templateDescription: 'Curated stacks',
      soon: '곧 출시',
      serviceName: 'Service name',
      repo: 'GitHub repository',
      branch: 'Branch',
      dockerfilePath: 'Dockerfile path',
      dockerTarget: 'Docker target',
      buildContext: 'Build context',
      imageReference: 'Image reference',
      containerPort: 'Container port',
      cancel: 'Cancel',
      create: 'Create service',
      creating: 'Creating…',
      // Content — descriptive copy + hints + error messages + success toast.
      descriptionSuffix: '· 소스를 고르고 배포 서비스 이름을 지정하세요.',
      gitDescription: '레포지토리에서 빌드',
      imageDescription: 'OCI 이미지 pull',
      templateSoon: '템플릿은 곧 제공됩니다.',
      templateBody:
        '큐레이션된 스택(Postgres, Redis, n8n, Plausible, Umami)은 v0.2에서 제공될 예정입니다. 지금은 GitHub 또는 이미지 소스를 사용하세요.',
      serviceNameHint: '{path} 경로에 사용됩니다.',
      imageReferenceHint:
        'Docker Hub, GHCR 또는 OCI 레지스트리. 태그를 고정하세요 — :latest는 배포마다 달라질 수 있습니다.',
      success: '{name} 서비스를 배포 중입니다.',
      errorName: '서비스 이름을 입력하거나 OpenLander가 이름을 추론할 수 있는 소스를 입력하세요.',
      errorRepo: 'GitHub 레포지토리 URL을 입력하세요.',
      errorImage: '이미지 레퍼런스를 입력하세요.',
      errorPort: '포트는 양의 정수여야 합니다.',
      errorCreate: '서비스 생성에 실패했습니다',
    },
    serviceDelete: {
      // Chrome — card title + modal title + form label + buttons.
      title: 'Delete this service',
      confirmTitle: 'Delete deployable service',
      confirmLabel: 'Type',
      deleting: 'Deleting…',
      confirmButton: 'Delete service',
      // Content — descriptive body + confirmation prose + error + checkbox label.
      body: '컨테이너와 서비스 소유 설정을 제거합니다. 관리 볼륨은 명시적으로 선택하지 않으면 보존됩니다.',
      confirmDescription:
        '실행 중인 컨테이너를 중지/제거하고 서비스 소유 환경 변수, 도메인, 리소스 설정을 삭제합니다. 프로젝트 볼륨은 기본 보존됩니다.',
      deleteVolumes: '이 그룹의 마지막 배포 서비스일 때 관리 프로젝트 볼륨도 삭제합니다.',
      error: '서비스 삭제에 실패했습니다',
    },
    servicesGuide: {
      empty:
        '아직 이 프로젝트에 배포 가능한 서비스가 없습니다. Git 저장소, Docker 이미지 또는 compose 서비스를 추가하세요.',
      help: '프로젝트는 그룹이고, 서비스는 그 안에서 실제로 배포되는 앱/워커입니다. MCP 후속 작업은 service_id를 사용하는 것이 가장 안전합니다.',
      banner:
        '아래 항목은 배포 가능한 서비스입니다. 환경 변수, 재배포, 도메인, 진단 작업에는 표시된 MCP service_id를 사용하세요.',
      serviceId: 'MCP service_id: {id}',
      serviceIdTooltip:
        'redeploy_app, set_env_vars, diagnose_service 같은 MCP 액션에 이 값을 전달하세요.',
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
        added: '도메인이 연결되었습니다. DNS 레코드를 OpenLander 서버로 설정하세요.',
        removed: '도메인 연결이 해제되었습니다.',
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
        invalidServiceKind: '도메인은 deployable 서비스에만 연결할 수 있습니다.',
        serviceSelectionRequired:
          '프로젝트에 deployable 서비스가 여러 개 있습니다. 서비스 단위 API를 사용하세요.',
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
      description: '프로젝트 그룹의 표시 정보를 수정합니다. 슬러그는 고정됩니다.',
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
    // Chrome — page title + primary action.
    title: 'Managed Services',
    createService: 'Create service',
    // Content — descriptive copy + empty states + format strings.
    subtitle:
      'Managed Service는 데이터베이스, 캐시, 공유 인프라입니다. 앱은 환경 변수로 여기에 연결합니다.',
    mcpHint:
      '프로비저닝과 자격 증명은 openlander_managed_service를 사용하고, 앱 연결은 배포 가능한 서비스의 환경 변수로 설정하세요.',
    noServices: '실행 중인 서비스 없음',
    getStarted: '템플릿에서 서비스를 생성하거나 Docker 이미지를 직접 실행하세요.',
    templates: '빠른 시작 템플릿',
    customImage: '커스텀 Docker 이미지',
    imagePlaceholder: 'ghcr.io/berriai/litellm:latest',
    orCustom: '또는 Docker 이미지를 직접 실행:',
    createdAgo: '{time} 전',
    updatedAgo: '{time} 전에 업데이트',
    metrics: {
      // Chrome — KPI labels.
      health: 'Health',
      uptime: 'Uptime',
      restarts: 'Restarts',
    },
    health: {
      // Chrome — status pills.
      healthy: 'healthy',
      unhealthy: 'unhealthy',
      starting: 'starting',
    },
    status: {
      // Chrome — status pills.
      running: 'running',
      stopped: 'stopped',
      error: 'error',
    },
    detail: {
      // Content — empty state.
      notFound: '서비스를 찾을 수 없습니다',
      tabs: {
        // Chrome — nav tabs.
        overview: 'Overview',
        connection: 'Connection',
        databases: 'Databases',
        logs: 'Logs',
        settings: 'Settings',
      },
      toasts: {
        // Content — toast prose.
        started: '서비스가 시작되었습니다',
        stopped: '서비스가 중지되었습니다',
        deleted: '서비스가 삭제되었습니다',
        startFailed: '서비스 시작에 실패했습니다',
        stopFailed: '서비스 중지에 실패했습니다',
        deleteFailed: '서비스 삭제에 실패했습니다',
      },
      header: {
        // Chrome — back link + action buttons.
        backToServices: 'Back to services',
        start: 'Start',
        stop: 'Stop',
        delete: 'Delete',
      },
      // Chrome — refresh button.
      refresh: 'Refresh',
      // Content — loading / empty / format strings.
      loadingDatabases: '데이터베이스 로딩 중...',
      serviceIsStopped: '서비스가 중지되었습니다',
      serviceStoppedHint: '로그를 보려면 서비스를 시작하세요.',
      showingLast: '최근',
      noProjectsUsing: '이 서비스를 사용하는 프로젝트가 없습니다',
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
      title: '서비스가 없습니다',
      description: '데이터베이스, 캐시 또는 기타 인프라 서비스를 생성하세요',
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
      approve: 'Approve',
      reject: 'Reject',
      // Content — strip title + body + result + error + format.
      title: '에이전트 작업이 승인을 기다리고 있습니다',
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
    // Chrome — brand title.
    title: 'Your Agent',
    // Content — description.
    subtitle: 'Claude 또는 다른 MCP 클라이언트에서 서비스를 관리하세요.',
    row: {
      // Chrome — bare labels + actions.
      status: 'Status',
      instance: 'Instance name',
      endpoint: 'Endpoint',
      tryThis: '이렇게 말해보세요',
      token: 'Access token',
      copy: 'Copy',
      copied: 'Copied',
      copyEndpoint: 'Copy endpoint',
      // Content — formatted display.
      lastCall: '마지막 호출 · {when}',
    },
    status: {
      // Chrome — status pills double as log values.
      connected: 'Connected',
      listening: 'Listening',
      checking: 'Checking…',
      unknown: 'Unknown',
      unreachable: 'Unreachable',
    },
    tokens: {
      // Chrome — defaults + action buttons + reveal/hide affordance.
      defaultName: 'OpenLander default',
      loading: 'Loading…',
      generateAction: 'Generate token',
      issuing: 'Generating…',
      regenerateAction: 'Regenerate',
      regenerating: 'Regenerating…',
      reveal: 'Reveal',
      hide: 'Hide',
      // Content — confirmation prompts, success/error notices, hints.
      issueFailed: '토큰 발급에 실패했습니다',
      regenerateConfirm: {
        title: 'MCP 토큰을 재발급할까요?',
        description:
          '기존 토큰은 무효화됩니다. 그 토큰을 사용하는 MCP 클라이언트는 다음 요청부터 401 오류로 거부되며, 새 토큰을 설정에 적용해야 다시 연결됩니다.',
        confirmLabel: 'Regenerate token',
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
      save: 'Save',
      saving: 'Saving…',
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
      // Chrome — section title + action.
      title: 'Setup',
      copyConfig: 'Copy config',
      // Content — descriptive copy.
      subtitle: '클라이언트를 선택하고 설정 스니펫을 붙여넣으세요.',
      restartHint: '저장 후 클라이언트를 재시작하세요. 첫 호출 시 위 상태가 연결됨으로 바뀝니다.',
    },
    recent: {
      // Chrome — section title + link affordance.
      title: 'Recent agent calls',
      fullTimeline: 'Full timeline',
      // Content — descriptive copy and empty-state message.
      subtitle: 'MCP 호출 이벤트만 표시합니다. 전체 기록은 Activity에서 확인하세요.',
      empty: '아직 에이전트 호출이 없습니다. MCP 배포·접속이 여기에 표시됩니다.',
    },
    relative: {
      // Content — relative time display reads naturally in user's locale.
      justNow: '방금',
      minutes: '{count}분 전',
      hours: '{count}시간 전',
      days: '{count}일 전',
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
        missing_assigned_port: '서비스에 포트가 할당되지 않았습니다',
        missing_container_port: '컨테이너가 할당된 포트를 노출하지 않습니다',
        domain_pending: '커스텀 도메인이 아직 준비되지 않았습니다',
        domain_error: '커스텀 도메인 상태에 문제가 있습니다',
      },
    },
    routes: {
      // Chrome — section title + table headers.
      title: 'Routes',
      col: {
        host: 'Public host',
        service: 'Service',
        port: 'Port',
        tls: 'TLS',
        status: 'Status',
      },
      // Content — descriptive copy + loading / empty messages.
      subtitle: '서비스에 매핑된 공개 호스트입니다.',
      loading: '라우트를 불러오는 중…',
      loadFailed: '라우트를 불러오지 못했습니다.',
      empty: '아직 공개 라우트가 없습니다. 서비스가 외부에 노출되면 여기에 표시됩니다.',
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
    relative: {
      // Content — relative time reads naturally in user's locale.
      justNow: '방금',
      minutes: '{count}분 전',
      hours: '{count}시간 전',
      days: '{count}일 전',
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
          'OpenLander가 GitHub 저장소에 접근할 수 없게 됩니다. 이미 배포된 서비스는 계속 동작하지만, 비공개 저장소에서 새 배포는 다시 연결할 때까지 실패합니다.',
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
        body: 'OpenLander가 저장소를 읽을 수 있도록 인증하세요. 배포·웹훅·서비스 추가에서 저장소를 찾을 수 있게 됩니다.',
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
      v02Badge: 'v0.2',
      gitlab: 'GitLab',
      bitbucket: 'Bitbucket',
      // Chrome — badge label.
      comingInV02: 'Coming in v0.2',
    },
  },
  // Canonical OpenLander 용어. 프로젝트 정책상 모든 로케일에서 영어 표기를
  // 유지합니다 (CONTRIBUTING / agent memory 참고). 주변 서술 카피는 한국어로
  // 자유롭게 번역되지만, 엔티티 종류를 가리키는 chrome — 헤더 키커,
  // breadcrumb, 페이지 뱃지 — 은 하드코딩하지 말고 이 키를 사용하세요.
  vocab: {
    projectGroup: 'Project group',
    deployableService: 'Deployable service',
    managedService: 'Managed service',
  },
  serviceDetail: {
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
