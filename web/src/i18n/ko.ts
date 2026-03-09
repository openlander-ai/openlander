export const translations = {
  setup: {
    welcome: {
      title: 'OpenLander입니다',
      subtitle: '레포지토리를 주세요. 나머지는 제가 처리합니다.',
      dockerRequired: '계속하려면 Docker가 실행 중이어야 합니다.',
    },
    llm: {
      title: 'AI 연결',
      subtitle: 'OpenLander의 배포 지능을 구동할 AI 제공자를 선택하세요.',
      chooseProvider: 'AI 제공자 선택...',
    },
    github: {
      title: '준비 완료',
      subtitle: '레포지토리 배포를 시작하려면 GitHub 계정을 연결하세요.',
    },
  },
  header: {
    llmNotConfigured: 'LLM 구성되지 않음',
  },
  newProject: {
    selectRepo: '배포할 레포지토리를 선택하세요',
    noReposFound: '검색 결과가 없습니다:',
    githubNotConnected: 'GitHub가 연결되지 않았습니다. 설정에서 계정을 추가하세요.',
    fetchFailed: '레포지토리를 가져오는데 실패했습니다',
  },
  projects: {
    noProjects: '프로젝트가 없습니다',
    deployFirstApp: '첫 번째 앱 배포하기',
    connectGithub: 'GitHub 레포지토리를 연결하면 에이전트가 나머지를 처리합니다.',
  },
  projectDetail: {
    notFound: '프로젝트를 찾을 수 없습니다',
    noDeployments: '아직 배포가 없습니다',
    confirmDelete: '이 프로젝트를 삭제하시겠습니까?',
    diagnosis: {
      noFixes: '구체적인 해결책이 반환되지 않았습니다.',
      fixFailed: 'AI로 수정 실패',
    },
  },
  deploy: {
    notFound: '배포를 찾을 수 없습니다',
    backToDeployments: '배포 목록으로 돌아가기',
    buildFailureDetected: '빌드 실패가 감지되었습니다. 실시간 배포 중 AI 분석이 제공됩니다.',
    noBuildLog: '빌드 로그가 없습니다',
    dialog: {
      title: '새 프로젝트 배포',
      description:
        '배포할 레포지토리 URL을 입력하세요. OpenLander가 클론, 빌드 및 실행을 처리합니다.',
      projectName: '프로젝트 이름 (선택 사항)',
      autoDetected: '레포지토리에서 자동 감지됨',
      failed: '프로젝트 배포 실패',
    },
  },
  settings: {
    description: 'AI 제공자, 연결 및 시스템 구성을 관리합니다.',
    aiModel: {
      switchProvider: '다른 제공자로 변경:',
      configureProvider: 'AI 제공자 구성:',
      connectedViaOauth: 'OAuth를 통해 연결됨',
      orUseApiKey: '또는 API 키 사용',
      updateFailed: 'LLM 구성을 업데이트하지 못했습니다. API 키/토큰을 확인하세요.',
    },
    secrets: {
      description:
        '모든 프로젝트에서 공유되는 암호화된 비밀값입니다. 프로젝트별 환경 변수가 이를 덮어씁니다.',
      noSecrets: '구성된 전역 비밀값이 없습니다.',
    },
    github: {
      description: '비공개 레포지토리를 배포하려면 GitHub 계정을 연결하세요.',
      enterCode: 'GitHub에 이 코드를 입력하세요:',
      waiting: '인증 대기 중...',
      connectWithGithub: 'GitHub로 연결',
      enterToken: '개인 액세스 토큰 입력:',
      generateToken: '토큰 생성 →',
    },
    proxy: {
      ports: '사용 중인 포트',
      cloudflare: {
        description:
          'OpenLander에서 프로덕션 도메인 라우팅을 관리하려면 Cloudflare Tunnel 자격 증명을 저장하세요.',
        saveSuccess: 'Cloudflare 자격 증명이 저장되었습니다.',
        saveFailed: 'Cloudflare 자격 증명 저장에 실패했습니다. 값을 확인하고 다시 시도하세요.',
        tokenHelpTitle: 'Cloudflare API 토큰이 필요하신가요?',
        tokenHelpText:
          '아래 링크를 클릭하면 필요한 권한이 미리 채워진 토큰 생성 페이지가 열립니다. 확인만 누르고 토큰을 복사하세요.',
        tokenPermissions:
          'Zone:Zone (읽기); Zone:DNS (편집); Account:Cloudflare Tunnel (읽기, 편집)',
        tokenPermissionsLabel: '필수 권한:',
        tokenHelpLink: 'Cloudflare에서 토큰 생성하기',
      },
      tunnelGuide: {
        title: 'Cloudflare Tunnel 설정',
        description:
          '프로덕션 도메인의 경우, CF Tunnel을 개별 컨테이너 포트 대신 Traefik으로 연결하세요. 재배포 시 터널이 끊기지 않습니다.',
        step1: 'Cloudflare Tunnel 설정 편집',
        step2: '서비스 URL을 다음으로 설정:',
        serviceUrl: 'http://localhost:80',
      },
      warning: 'Traefik 미감지 — 재배포 시 외부 접근이 끊길 수 있습니다',
      loading: '프록시 상태 로딩 중...',
    },
    system: {
      loading: '시스템 통계 로딩 중...',
    },
    serverScan: {
      externalDescription: '이 서버에서 OpenLander가 관리하지 않는 컨테이너가 감지되었습니다:',
      noExternal: '외부 컨테이너가 감지되지 않았습니다. 모든 컨테이너가 OpenLander에서 관리됩니다.',
    },
  },
  services: {
    subtitle:
      'Docker 이미지를 공유 인프라로 실행합니다. 여러 프로젝트가 이 서비스에 연결할 수 있습니다.',
    noServices: '실행 중인 서비스 없음',
    getStarted: '템플릿에서 서비스를 생성하거나 Docker 이미지를 직접 실행하세요.',
    templates: '빠른 시작 템플릿',
    customImage: '커스텀 Docker 이미지',
    imagePlaceholder: 'ghcr.io/berriai/litellm:latest',
    orCustom: '또는 Docker 이미지를 직접 실행:',
  },
  timeline: {
    empty: '아직 활동이 없습니다',
    deployToSee: '에이전트 타임라인을 보려면 이 프로젝트를 배포하세요.',
    awaitingInstruction: '다음 지시 대기 중...',
    aiWorking: 'AI가 작업 중입니다...',
    typeAnswer: '직접 답변 입력...',
  },
  domains: {
    notAvailable: '사용할 수 없음 — 프로젝트가 실행 중이 아닙니다.',
    accessibleFrom: 'sslip.io DNS를 통해 동일한 네트워크의 모든 장치에서 액세스할 수 있습니다.',
    directPortAccess:
      '직접 포트 액세스 — LAN, VPN (Tailscale) 또는 모든 네트워크 경로에서 작동합니다.',
    noCustomDomains: '커스텀 도메인이 설정되지 않았습니다',
    cloudflareNotConfigured: 'Cloudflare가 설정되지 않았습니다.',
    cloudflareGoToSettings: '설정 페이지에서 Cloudflare Tunnel 구성하기',
    customDomainsHelp:
      'Cloudflare Tunnel을 통해 커스텀 도메인을 추가하세요. 도메인의 DNS를 터널로 연결하세요.',
    exposeToInternet: 'Publish',
    notExposed: 'Publish를 클릭하여 Cloudflare Tunnel을 통해 공개 URL을 생성하세요.',
    anyoneWithUrl:
      '이 URL을 가진 누구나 프로젝트에 액세스할 수 있습니다. 임시 URL은 재시작 시 변경될 수 있습니다.',
    requiresRunning: '프로젝트가 실행 중이어야 합니다.',
  },
  share: {
    title: '프로젝트 공유',
    accessCode: '접근 코드',
    accessCodeHint: '최소 4자. 이 코드가 있으면 누구나 프로젝트에 접근할 수 있습니다.',
    generate: '생성',
    shareButton: '접근 코드로 공유',
    stopSharing: '공유 중지',
    copyInvitation: '초대 복사',
    copied: '복사됨!',
    alreadyShared: '이 프로젝트는 현재 공유 중입니다.',
    notRunning: '공유하려면 프로젝트가 실행 중이어야 합니다.',
  },
  prPreviews: {
    noPreviews: 'PR 프리뷰 없음',
    description: 'PR이 열리면 프리뷰가 자동으로 생성됩니다.',
  },
  webhooks: {
    noWebhooks: '웹훅이 설정되지 않았습니다',
    description: 'git push 시 자동 재배포를 위한 웹훅을 설정하세요.',
  },
  envVars: {
    pasteDescription: '아래에 .env 내용을 붙여넣으세요. #으로 시작하는 줄은 무시됩니다.',
    noEnvVars: '설정된 환경 변수가 없습니다',
    getStarted: '시작하려면 "추가" 또는 ".env 붙여넣기"를 클릭하세요.',
  },
  logs: {
    noLogs: '사용 가능한 로그가 없습니다',
    noMatching: '일치하는 줄이 없습니다',
  },
  command: {
    searchPlaceholder: '명령어 입력 또는 검색...',
    noResults: '결과가 없습니다',
    deployNewRepo: '새 레포지토리 배포',
    configureLlmGithub: 'LLM 및 GitHub 구성',
    triggerFreshDeploy: '새 배포 트리거',
    stopContainer: '실행 중인 컨테이너 중지',
  },
  oauth: {
    startFailed: '인증 시작 실패',
    signInWith: '다음으로 로그인:',
    personalDevOnly: '⚠ 개인 개발 목적으로만 구독을 사용하세요.',
  },
  providerHelp: {
    anthropic: {
      usingClaudeCode: 'Claude Code를 사용 중이신가요?',
      inTerminal: '명령어를 실행하여 토큰을 얻은 다음 아래에 붙여넣으세요.',
      learnMore: 'Anthropic API에 대해 더 알아보기',
    },
    gemini: {
      needKey: 'Gemini API 키가 필요하신가요?',
      freeTier: 'Google은 Gemini 모델에 대해 넉넉한 무료 티어를 제공합니다.',
      getFreeKey: 'Google AI Studio에서 무료 API 키 받기',
    },
  },
} as const;
