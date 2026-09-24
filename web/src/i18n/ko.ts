export const translations = {
  serviceCleanup: {
    open: '정지·삭제 요청',
    title: '여러 서비스 정리',
    description:
      '대상을 선택하고 요청을 복사해 에이전트 대화에 붙여 넣으세요. 여기서는 서비스를 변경하지 않습니다.',
    action: '작업 선택',
    stop: '정지',
    delete: '삭제',
    targets: '대상 서비스',
    selectAll: '전체 선택',
    selected: '{count}개 선택',
    grant: '이 프로젝트의 정지·삭제 권한도 계속 허용',
    grantHint:
      '이 프로젝트의 앱 정지·삭제에 계속 적용됩니다. DB·버킷·볼륨 삭제 권한과 개별 서비스의 제한은 바꾸지 않습니다. 대화에서 다시 승인 필요로 바꿀 수 있습니다.',
    stopHint: '정지는 컨테이너와 데이터를 남깁니다. 나중에 다시 시작할 수 있습니다.',
    deleteHint: '선택한 앱과 컨테이너를 삭제합니다. 데이터 볼륨과 DB·캐시·스토리지는 남깁니다.',
    preview: '요청 내용 보기',
    connect: '에이전트 연결 안내',
    copy: '요청 복사',
    copied: '복사됨 · 대화에 붙여 넣으세요',
    prompt: {
      target:
        'OpenLander 프로젝트 "{projectName}" (project_id: {projectId})에 다음 작업을 요청합니다.',
      permission:
        '이 프로젝트의 앱 정지·삭제 권한을 계속 허용해 주세요. MCP set_project_permissions로 app_lifecycle=allow를 저장한 뒤 아래 작업을 진행해 주세요. 개별 서비스 제한은 유지하세요.',
      stop: '아래 서비스만 정지해 주세요.',
      delete: '아래 앱 서비스만 삭제하고 데이터 볼륨은 보존해 주세요.',
      execution:
        'MCP cleanup_apps로 한 번에 요청하세요. 50개를 넘으면 나눠 요청하고, 반환된 작업 ID로 완료 결과를 확인하세요. 이미 승인 대기 중인 같은 요청이 있다면 새로 만들지 말고 해당 작업 ID를 재개하세요.',
      boundary:
        '목록 밖 서비스와 다른 프로젝트는 변경하지 마세요. Compose 대상에 포함된 하위 서비스는 함께 처리하고, 성공·실패 결과를 서비스별로 알려 주세요.',
    },
  },
  aiOps: {
    title: 'AI Ops 브리핑',
    beta: '베타',
    projectDescription:
      '이 프로젝트의 장애 원인과 확인할 내용을 요약합니다. OpenLander가 서비스를 다시 시작하거나 재배포하고, 이전 버전으로 되돌리거나 환경 변수를 바꾸지는 않습니다.',
    noAutomation: '자동 변경 없음',
    mode: {
      off: '꺼짐',
      briefing: '브리핑',
      inherit: '프로젝트 설정 따름',
    },
    resolvedMode: '현재 적용 모드',
    budget: '사용 한도',
    settingsBriefingsHint:
      '장애 브리핑은 프로젝트의 AI Ops 탭에서 확인할 수 있습니다. 여기서는 기능 사용 여부와 사용 한도만 설정합니다.',
    loading: '불러오는 중...',
    empty: '아직 브리핑이 없습니다.',
    emptyTitle: '아직 장애 브리핑이 없습니다',
    emptyDescription:
      'AI Ops 브리핑을 켜면 서비스 중단, 배포 실패, 접속 경로 오류의 근거가 여기에 표시됩니다.',
    detailTitle: 'AI Ops 브리핑',
    detailDescription:
      '심각도와 다음 MCP 호출은 OpenLander 규칙으로 결정합니다. AI가 만든 문장은 설명에만 사용합니다.',
    tokens: '사용 토큰',
    cost: '예상 비용',
    llmCalls: 'AI 모델 호출',
    suggestedCall: '다음 MCP 호출',
    evidence: '근거 자료',
    agentHandoff: {
      title: '에이전트 전달 정보',
      description:
        '확인된 근거만 담은 에이전트용 요청문을 복사합니다. 인증 토큰이나 자격 증명은 포함하지 않습니다.',
      copy: '전달 정보 복사',
      copied: '복사됨',
    },
    actions: {
      viewEvidence: '근거 자료 보기',
      viewProjectBriefings: '프로젝트 AI Ops 보기',
      openInAgent: '에이전트에서 열기',
      verifyAfterFix: '수정 후 검증',
      verifyCopied: '검증 호출 복사됨',
      acknowledge: '확인',
      resolve: '종료',
    },
    status: {
      unresolved: '미해결',
      open: '열림',
      acknowledged: '확인됨',
      resolved: '해결됨',
      all: '전체',
    },
    severity: {
      info: '정보',
      warning: '주의',
      high: '높음',
      critical: '심각',
    },
    briefing: {
      classification: {
        traffic_health_mismatch: '외부 접속 실패',
        route_failure: '접속 경로 오류',
        container_exited: '컨테이너 중지',
        restart_loop: '반복 재시작',
        dependency_failure: '외부 의존성 오류',
        runtime_incident: '실행 중 장애',
        deploy_failed: '배포 실패',
        no_issue_detected: '이상 없음',
        unknown: '운영 상태 확인',
      },
      title: {
        traffic_health_mismatch: '외부 접속 확인에 실패했습니다',
        route_failure: '접속 경로 상태가 좋지 않습니다',
        container_exited: '서비스 컨테이너가 중지되었습니다',
        restart_loop: '서비스가 반복해서 다시 시작되고 있습니다',
        dependency_failure: '외부 의존성 연결 오류가 감지되었습니다',
        runtime_incident: '서비스 실행 중 장애가 감지되었습니다',
        deploy_failed: '최근 배포가 실패했거나 정상 상태가 되지 못했습니다',
        no_issue_detected: '감지된 운영 문제가 없습니다',
        unknown: '운영 상태를 확인해야 합니다',
      },
      summary: {
        traffic_health_mismatch: '외부에서 보낸 대표 요청이 정상적으로 완료되지 않았습니다.',
        traffic_health_mismatch_http: '외부에서 보낸 대표 요청의 응답은 HTTP {statusCode}입니다.',
        route_failure: '외부 접속 경로가 정상 상태로 확인되지 않습니다.',
        route_failure_http: '외부 접속 경로의 응답은 HTTP {statusCode}입니다.',
        container_exited: '서비스 컨테이너가 현재 실행 중이 아닙니다.',
        container_exited_with_code: '서비스 컨테이너가 중지되었습니다. 종료 코드: {exitCode}',
        restart_loop: '서비스가 반복해서 다시 시작된 정황이 있습니다.',
        restart_loop_with_count: '서비스 재시작 횟수는 {restartCount}회입니다.',
        dependency_failure: '외부 서비스 또는 데이터 저장소 연결에 문제가 있는 것으로 보입니다.',
        runtime_incident: '서비스 실행 근거에서 확인이 필요한 장애가 발견되었습니다.',
        deploy_failed: '최근 배포가 실패했거나 정상 상태가 되지 못했습니다.',
        no_issue_detected: '수집한 근거에서 정해진 장애 조건에 해당하는 문제를 찾지 못했습니다.',
        unknown: '운영 상태 근거가 기록되었습니다. 내용을 확인하세요.',
      },
    },
    inbox: {
      title: 'AI Ops 브리핑 목록',
      subtitle: '모든 프로젝트에서 아직 해결되지 않은 장애 브리핑을 모아 봅니다.',
      configure: '프로젝트 보기',
      clearTitle: '모니터링 중인 프로젝트에 열린 브리핑이 없습니다',
      clearDescription:
        'AI Ops를 켠 프로젝트에서 서비스 중단, 배포 실패, 접속 경로 오류가 발견되면 여기에 모입니다.',
      healthIssueNoBriefingTitle: 'AI Ops 브리핑이 없는 상태 이상',
      healthIssueNoBriefingDescription:
        '프로젝트 상태 이상이 {count}개 있지만 브리핑은 만들어지지 않았습니다. 브리핑은 AI Ops를 켠 프로젝트에서 조치가 필요한 실행 오류가 발견될 때만 생성됩니다.',
      attentionTitle: '미해결 브리핑 {count}개',
      attentionDescription:
        '에이전트에서 내용을 확인하고 수정·검증한 뒤, 직접 브리핑을 종료하세요.',
      emptyEyebrow: '대기 중인 작업 없음',
      emptyTitle: '열린 AI Ops 브리핑이 없습니다',
      emptyDescription:
        'AI Ops를 켠 프로젝트에서 서비스 중단, 배포 실패, 접속 경로 오류가 발견되면 알려드립니다.',
      emptyDescriptionWithHealthIssues:
        'AI Ops 브리핑과 별개로 프로젝트 상태 이상이 {count}개 있습니다. 리소스를 직접 확인하거나 AI Ops 설정을 확인하세요.',
    },
    projectInbox: {
      title: 'AI Ops 브리핑',
      description: '리소스를 하나씩 열지 않고 이 프로젝트의 운영 문제를 한 곳에서 봅니다.',
      configure: 'AI Ops 설정',
      enabledTitle: '이 프로젝트에서 브리핑을 사용 중입니다',
      enabledDescription:
        'OpenLander가 서비스 중단, 배포 실패, 접속 경로 오류를 바탕으로 읽기 전용 장애 브리핑을 만듭니다.',
      disabledTitle: '이 프로젝트에서 브리핑을 사용하지 않습니다',
      disabledDescription:
        '이 프로젝트의 장애 브리핑을 만들려면 프로젝트 설정에서 AI Ops 브리핑을 켜세요.',
      serviceFilter: '서비스',
      allServices: '모든 서비스',
      serviceUnavailable: '선택한 서비스를 더 이상 찾을 수 없습니다.',
      servicePolicyFollows: '프로젝트 설정 따름: {mode}',
      servicePolicyOverride: '서비스별 설정: {mode}',
      emptyEyebrowEnabled: '대기 중인 작업 없음',
      emptyEyebrowDisabled: '프로젝트에서 기능을 켜야 합니다',
      emptyTitle: '조건에 맞는 브리핑이 없습니다',
      emptyDescription:
        '이 프로젝트에 장애가 생기면 확인된 근거와 에이전트 전달 정보가 여기에 표시됩니다.',
      emptyDescriptionWithDegradedResources:
        '현재 비정상 리소스가 {count}개 있지만 이 조건에 맞는 AI Ops 브리핑은 없습니다. 브리핑은 AI Ops가 다루는 실행 오류에만 생성됩니다.',
      emptyDescriptionDisabled:
        '현재 이 프로젝트의 AI Ops가 꺼져 있어 서비스 중단이나 접속 경로 오류가 생겨도 브리핑을 만들지 않습니다.',
    },
    error: {
      load: 'AI Ops 브리핑을 불러오지 못했습니다.',
      save: 'AI Ops 정책 저장에 실패했습니다.',
      status: '브리핑 상태를 변경하지 못했습니다.',
    },
  },
  aiProviders: {
    title: 'AI 모델 연결',
    subtitle:
      'AI Ops 브리핑을 요약할 때 사용할 AI 모델을 연결합니다. 모델을 연결해도 AI Ops가 자동으로 켜지지는 않습니다.',
    connected: '연결됨',
    loading: 'AI 모델 연결 설정을 불러오는 중...',
    policyTitle: '모델 연결과 프로젝트별 사용 설정은 서로 다릅니다',
    policyBody:
      'AI 모델을 연결해도 프로젝트에서 AI Ops 브리핑을 켜기 전에는 요약을 만들지 않습니다. 심각도와 다음 MCP 호출은 OpenLander 규칙으로 결정합니다.',
    currentProvider: '선택한 모델 제공자: {provider}',
    form: {
      provider: '모델 제공자',
      model: '모델',
      apiKey: 'API 키',
      apiKeyPlaceholder: 'API 키를 붙여넣으세요',
      apiKeyPlaceholderConfigured: '저장된 키를 그대로 쓰려면 비워두세요',
      apiKeyHint: '암호화하여 저장하며 API 응답이나 화면에 다시 표시하지 않습니다.',
      baseUrl: '기본 URL',
      baseUrlHint: 'OpenRouter처럼 OpenAI API와 호환되는 서비스에 사용합니다.',
    },
    actions: {
      save: '모델 연결 저장',
      test: '연결 테스트',
      disconnect: '연결 해제',
    },
    status: {
      saved:
        'AI 모델 연결을 저장했습니다. 프로젝트에서 브리핑을 켜기 전까지 AI Ops는 꺼진 상태입니다.',
      deleted: 'AI 모델 연결을 해제했습니다.',
      testPassed: '연결 테스트를 통과했습니다.',
    },
    error: {
      load: 'AI 모델 연결 설정을 불러오지 못했습니다.',
      save: 'AI 모델 연결을 저장하지 못했습니다.',
      test: '연결 테스트에 실패했습니다.',
      delete: 'AI 모델 연결을 해제하지 못했습니다.',
    },
    scope: {
      title: 'AI Ops에서 사용하는 방법',
      subtitle: 'AI 모델 연결과 브리핑을 사용할 프로젝트는 따로 설정합니다.',
      provider: {
        title: 'AI 모델 연결',
        body: 'OpenAI API 호환 서비스, Anthropic 또는 Gemini의 API 키를 연결합니다.',
      },
      project: {
        title: '프로젝트 AI Ops',
        body: '사용할 프로젝트에서 직접 켭니다. AI 모델을 연결해도 기본값은 꺼짐입니다.',
      },
      service: {
        title: '서비스별 설정',
        body: '애플리케이션마다 프로젝트 설정 따름, 꺼짐, 브리핑 중 하나를 선택할 수 있습니다.',
      },
    },
  },
  resources: {
    // Chrome — section title + form labels + dropdown options + buttons + status.
    title: '리소스 제한',
    profile: '메모리 설정',
    profiles: {
      micro: '최소 (256 MB)',
      small: '작게 (512 MB)',
      medium: '보통 (1 GB)',
      large: '크게 (2 GB)',
      custom: '직접 입력',
    },
    customMemory: '메모리 직접 입력 (MB)',
    save: '저장',
    saving: '저장 중...',
    saved: '저장됨',
    loading: '불러오는 중...',
    // Content — descriptive copy + hints + notices + errors.
    description:
      '메모리와 CPU 사용량을 제한하여 연쇄 장애를 예방합니다. 변경 사항은 다음 배포 때 적용됩니다.',
    customMemoryHint: '최소 64 MB',
    appliesOnRedeploy: '변경사항은 다음 배포 시 적용됩니다',
    apply: '메모리 제한 적용',
    appliedMemory: '현재 적용된 메모리 상한: {mb} MB',
    appliesImmediately:
      '기존 컨테이너에 재시작 없이 적용됩니다. CPU 설정은 유지되며, DB 엔진의 메모리 설정은 별도로 조정해야 합니다.',
    stopBeforeDecrease:
      '메모리 상한을 낮추려면 먼저 서비스를 중지하세요. 변경 중 메모리 부족으로 DB가 종료되는 것을 방지합니다.',
    managedSaveFailed:
      '메모리 변경을 완료하지 못했습니다. 새로고침하여 적용된 상한을 확인한 뒤 다시 시도하세요. 상한을 낮추려면 먼저 서비스를 중지해야 합니다.',
    noLimit: '메모리 제한이 설정되지 않았습니다',
    noLimitWarning: '메모리 제한을 설정하면 연쇄 장애를 예방할 수 있습니다.',
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
    viewAll: '전체 보기',
    confirm: '확인',
    cancel: '취소',
    errors: {
      load: '데이터를 불러오지 못했습니다.',
      save: '변경 사항을 저장하지 못했습니다.',
      action: '작업을 완료하지 못했습니다.',
    },
    githubAuthorization: {
      startFailed: 'GitHub 인증을 시작하지 못했습니다.',
      expired: 'GitHub 인증 시간이 만료되었습니다. 다시 시작하세요.',
      denied: 'GitHub 인증이 거부되었습니다.',
      error: 'GitHub 인증에 실패했습니다.',
    },
    count: {
      // Content — count phrases with units. Korean does not mark plural
      // on counted nouns, so _one and _other resolve to the same string.
      // Keys mirror en.ts so call sites can switch by count uniformly.
      deployableServices_one: '애플리케이션 {count}개',
      deployableServices_other: '애플리케이션 {count}개',
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
  accessibility: {
    close: '닫기',
    language: '언어',
  },
  appError: {
    title: '화면을 표시하지 못했습니다',
    message: '페이지를 새로고침해 주세요.',
  },
  serviceDialogs: {
    createResource: '리소스 만들기',
    templates: '템플릿',
    customDivider: '또는 직접 설정',
    resourceName: '리소스 이름',
    version: '버전',
    selectVersion: '버전 선택',
    dockerImage: 'Docker 이미지',
    port: '포트',
    environmentVariables: '환경 변수',
    addVariable: '변수 추가',
    cancel: '취소',
    creating: '만드는 중...',
    create: '리소스 만들기',
    databases: '데이터베이스',
    createDatabase: '데이터베이스 만들기',
    noDatabases: '데이터베이스가 없습니다.',
    copyUrl: 'URL 복사',
    users: '사용자',
    createUser: '사용자 만들기',
    noUsers: '사용자가 없습니다.',
    databaseName: '데이터베이스 이름',
    username: '사용자 이름',
    passwordOptional: '비밀번호 (선택 사항)',
    passwordAutoGenerate: '비워두면 자동으로 만듭니다',
    grantAccessOptional: '접근 권한을 부여할 데이터베이스 (선택 사항)',
    noDatabaseAccess: '접근 권한 없이 사용자만 만들기',
    createShort: '만들기',
    unknownSize: '크기 정보 없음',
  },
  serviceSettings: {
    information: '서비스 정보',
    image: '이미지',
    port: '포트',
    containerName: '컨테이너 이름',
    createdAt: '생성 시각',
    notAvailable: '정보 없음',
    dangerZone: '위험 작업',
    deleteTitle: '서비스 삭제',
    deleteDescription: '이 서비스와 모든 데이터를 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
    deleteAction: '서비스 삭제',
  },
  serviceConnection: {
    empty: '이 서비스에는 표시할 연결 정보가 없습니다.',
    credentials: '인증 정보',
    externalAccess: '외부 접속',
    environmentVariables: '환경 변수',
    field: {
      connectionString: '연결 문자열',
      host: '호스트',
      port: '포트',
      user: '사용자',
      password: '비밀번호',
      database: '데이터베이스',
    },
  },
  toolResults: {
    unknown: '확인할 수 없음',
    composeProject: 'Compose 프로젝트',
    port: '포트',
    service: '서비스',
    container: '컨테이너',
    status: '상태',
    ports: '포트',
    from: '변경 전',
    to: '변경 후',
    changes: '변경 사항',
    diff: '변경 비교',
    before: '변경 전',
    after: '변경 후',
    viewDockerfile: 'Dockerfile 보기 ▾',
    name: '이름',
    url: 'URL',
    link: '열기',
    moreProjects: '프로젝트 {count}개 더 보기',
    viewLogs: '로그 보기 ▾',
    memory: '메모리',
    disk: '디스크',
    envUpdated: '환경 변수를 수정했습니다.',
    updatedKeys: '수정한 키:',
    viewResult: '결과 보기 ▾',
    statusValue: {
      running: '실행 중',
      up: '정상',
      success: '성공',
      failed: '실패',
      error: '오류',
      healthy: '정상',
      unhealthy: '비정상',
      ready: '준비 완료',
      completed: '완료',
      stopped: '중지됨',
      starting: '시작 중',
      stopping: '중지 중',
      building: '빌드 중',
      deploying: '배포 중',
      pending: '대기 중',
      cancelled: '취소됨',
      unknown: '상태 확인 불가',
    },
  },
  diagnosis: {
    title: '진단',
    noIssues: '발견된 문제가 없습니다',
    buildSucceeded: '빌드를 성공적으로 완료했습니다.',
    errorDetected: '오류 감지',
    buildLog: '빌드 로그',
    recoveryAttempts: '복구 시도',
    noRecoveryData: '복구 시도 기록이 없습니다.',
  },
  setupHelp: {
    copyTitle: '클립보드에 복사',
    copied: '복사됨',
    copy: '복사',
    agentQuestion: 'AI 코딩 도구를 사용하시나요?',
    agentInstruction: '다음 내용을 붙여넣으세요:',
    dockerGroupFix: '해결 방법: 사용자를 docker 그룹에 추가',
    dockerGroupRelogin: '그룹 변경 사항을 적용하려면 로그아웃한 뒤 다시 로그인하세요.',
    agentPrompt: {
      fixDockerPermission: '현재 사용자를 docker 그룹에 추가하고 Docker 데몬을 다시 시작해줘',
      startDocker: '이 머신에서 Docker 데몬을 시작해줘',
      installDocker: '이 머신에 Docker를 설치하고 데몬을 시작해줘',
    },
  },
  topology: {
    title: '구성도',
    emptyAria: '빈 구성도',
    empty: '아직 리소스가 없습니다. 리소스를 만들면 이곳에 구성도가 표시됩니다.',
    oneResource: '· 리소스 1개',
    resources: '· 리소스 {count}개',
    groupedResources: '· 리소스 {count}개 · 그룹 보기',
    noDependencies: '연결 관계가 없습니다. compose.yml에 depends_on을 추가하세요.',
    lanes: {
      entry: '진입점',
      app: '애플리케이션',
      data: '데이터',
    },
    kind: {
      application: '애플리케이션',
      compose: 'Compose',
      database: '데이터베이스',
      cache: '캐시',
      storage: '스토리지',
    },
    health: {
      healthy: '정상',
      crashed: '중단됨',
      deploying: '배포 중',
      allHealthy: '모두 정상',
    },
    recentAgent: '최근 에이전트 활동: {title}',
    agentTitle: '에이전트: {title}',
    field: {
      status: '상태',
      image: '이미지',
      cpuMemory: 'CPU · 메모리',
    },
    openResource: '클릭하여 리소스 열기 →',
    sample: '예시',
    sampleTitle: '서버에서 구성도를 불러오지 못해 예시 데이터를 표시합니다',
  },
  failureSummary: {
    phase: '단계',
    step: '세부 단계',
    likelyFix: '예상 해결 방법:',
    copySummary: '요약 복사',
    copyAiPrompt: 'Claude 요청문으로 복사',
    viewCompose: 'Compose 보기',
    redeploy: '다시 배포',
  },
  domainUrls: {
    openTitle: '{label} URL 열기',
    title: '배포 접속 주소',
    description: '사용할 수 있는 네트워크별 접속 주소입니다.',
    label: {
      public: '공개',
      local: '로컬',
    },
  },
  terminal: {
    noLogs: '표시할 로그가 없습니다',
  },
  deployShell: {
    phaseProgression: '배포 진행 단계',
    phase: {
      clone: '저장소 복제',
      pull: '이미지 받기',
      build: '빌드',
      create: '컨테이너 만들기',
      start: '시작',
      health: '상태 확인',
      cloning: '저장소 복제 중',
      pulling: '기본 이미지 받는 중',
      building: '이미지 빌드 중',
      creating: '컨테이너 만드는 중',
      starting: '컨테이너 시작 중',
      waitingHealth: '상태 확인 중',
    },
    cancelled: {
      title: '빌드를 취소했습니다',
      description:
        '빌드가 끝나기 전에 로그 스트림을 중지했습니다. 이전 배포는 계속 트래픽을 처리합니다.',
      redeploy: '다시 배포',
      copyPartialLog: '현재 로그 복사',
    },
    error: {
      aria: '배포 오류: {title}',
      blameConfig: '사용자 설정',
      blameExternal: '외부 환경',
      blamePlatform: '플랫폼',
      failedDuring: '실패 단계',
      step: '세부 단계',
      on: '대상',
      target: '대상:',
    },
    success: {
      title: '배포 성공',
      publicUrl: '애플리케이션 접속 주소:',
      copyUrl: 'URL 복사',
      openNewTab: '새 탭에서 열기',
      internal: '내부 주소:',
      internalHint: '(컨테이너 사이 호출용)',
    },
    header: {
      connecting: '연결 중…',
      live: '실시간 · {duration}',
      reconnecting: '다시 연결 중 · {duration}',
      backfilling: '누락 로그 받는 중…',
      failed: '실패 · {duration}',
      done: '완료 · {duration}',
      streamError: '로그 연결 오류 · {duration}',
      cancelled: '취소됨 · {duration}',
      fsmTitle: '로그 연결 및 화면 상태',
    },
    viewer: {
      stopTitle: '이 배포를 중지할까요?',
      stopDescription:
        '빌드를 취소하고 새 컨테이너를 시작하지 않습니다. 문제를 해결한 뒤 다시 배포할 수 있습니다.',
      stopAction: '배포 중지',
      cancelFailed: '배포를 취소하지 못했습니다',
      back: '뒤로',
      runtimeLogs: '컨테이너 실행 로그',
      deployLog: '배포 로그',
      copyTitle: '로그를 클립보드에 복사',
      copied: '복사됨',
      copy: '복사',
      downloadTitle: '전체 로그 다운로드',
      download: '다운로드',
      cancelling: '취소 중…',
      killBuild: '빌드 중지',
      reconnecting: '연결이 끊겨 다시 연결하고 있습니다…',
      backfilled:
        '다시 연결했습니다. 누락된 로그를 불러오는 중이며 일부 이전 로그는 표시되지 않을 수 있습니다.',
      runtimeAria: '컨테이너 실행 로그',
      buildAria: '빌드 로그',
      truncated: '전체 {total}줄 중 최근 {shown}줄을 표시합니다.',
      completeRecord: '전체 기록은 로그를 다운로드하여 확인하세요.',
      jumpLatest: '최신 로그로 이동',
    },
    deployRow: {
      view: '보기',
      moreActions: '추가 작업',
      triggerGit: 'Git 푸시',
      triggerManual: '직접 실행',
      status: {
        running: '실행 중',
        building: '빌드 중',
        success: '완료',
        failed: '실패',
        cancelled: '취소됨',
        unknown: '확인 필요',
      },
    },
    autoScroll: '자동 스크롤 다시 시작',
  },
  activityFilters: {
    typeAria: '활동 유형',
    project: '프로젝트',
    allProjects: '모든 프로젝트',
    empty: '아직 활동이 없습니다.',
    actor: {
      human: '사용자',
      git: 'Git',
      system: '시스템',
    },
    bucket: {
      justNow: '방금',
      earlierToday: '오늘',
      yesterday: '어제',
    },
  },
  nav: {
    overview: '개요',
    projects: '프로젝트',
    deployments: '배포',
  },
  login: {
    password: '비밀번호',
    signingIn: '로그인 중...',
    signIn: '로그인',
    signInPrompt: '계속하려면 로그인하세요',
    errorGeneric: '로그인에 실패했습니다. 다시 시도해 주세요.',
    checkingStatus: '서버 상태 확인 중...',
    loadingLabel: '불러오는 중',
  },
  deployErrors: {
    CONFIG_MISSING: {
      title: '`DATABASE_URL`이 설정되지 않아 빌드가 중단되었습니다',
      target: '서비스 "api"',
      hint: 'Prisma generate는 빌드할 때 `DATABASE_URL`을 읽습니다. compose의 `build.args`로 전달하거나 `prisma generate`를 실행 시작 단계로 옮기세요.',
    },
    GIT_ACCESS_DENIED: {
      title: '인증에 실패해 저장소에 접근할 수 없습니다',
      target: 'github.com/jiho/hotdeal-tracker',
      hint: '이 저장소의 배포 키가 4일 전에 바뀌었습니다. `설정 → Git 제공자`에서 GitHub를 다시 연결하거나 새 SSH 키를 입력하세요.',
    },
    BUILD_CONTEXT_MISMATCH: {
      title: 'Dockerfile에 필요한 경로가 빌드 컨텍스트에 없습니다',
      target: '서비스 "web"',
      hint: '`compose.yml`에서 `build.context: .`과 `dockerfile: Dockerfile.web`을 명시하세요. 현재 컨텍스트가 `./apps/web`이라 `COPY` 대상에서 `apps/` 경로가 빠집니다.',
    },
    IMAGE_WRONG_STAGE: {
      title: '다단계 Dockerfile에서 잘못된 단계를 빌드했습니다',
      target: '서비스 "api"',
      hint: 'Dockerfile의 단계는 `base`, `builder`, `api`입니다. 현재 `target: builder`로 설정되어 운영 실행 명령이 빠졌습니다. `target: api`로 바꾸세요.',
    },
    DEPENDENCY_UNHEALTHY: {
      title: '`postgres`가 정상 상태가 되지 않아 `api`를 시작하지 못했습니다',
      target: '서비스 "api"',
      hint: '`postgres`는 실행 중이지만 `pg_isready`가 30초 안에 응답하지 않습니다. `healthcheck.start_period`를 60초로 늘리거나 postgres 초기화 로그를 확인하세요.',
    },
    DB_EXTENSION_MISSING: {
      title: '`vector` 확장 기능이 없어 `postgres` 마이그레이션에 실패했습니다',
      target: '서비스 "postgres"',
      hint: '마이그레이션은 `CREATE EXTENSION vector`를 실행하지만 `postgres:16-alpine` 이미지에는 해당 기능이 없습니다. `pgvector/pgvector:pg16` 이미지로 바꾼 뒤 다시 배포하세요.',
    },
    PORT_CONFLICT: {
      title: '호스트의 3000번 포트를 이미 사용 중입니다',
      target: '서비스 "web"',
      hint: '다른 컨테이너(`legacy-web`)가 3000번 포트를 공개하고 있습니다. 기존 스택을 중지하거나 `web`을 내부 포트로만 노출하세요. 리버스 프록시는 호스트 포트가 필요하지 않습니다.',
    },
    CLI_OVERRIDE_SYNTAX: {
      title: '사용자 지정 배포 명령을 해석하지 못했습니다',
      target: '서비스 "web"',
      hint: '사용자 지정 명령이 `docker`로 시작하지만 OpenLander가 `docker`를 자동으로 붙입니다. 앞의 `docker`를 빼거나 입력값을 지워 기본 명령을 사용하세요.',
    },
    RUNTIME_CRASH: {
      title: '지난 24시간 동안 `worker`가 12번 중단되었습니다',
      target: '서비스 "worker"',
      hint: '최근 종료 코드는 1이며 `unhandled SIGTERM during ingestion batch`가 기록되었습니다. 실행 로그에서 오류 스택을 확인하세요.',
    },
    INFRA_UNAVAILABLE: {
      title: 'OpenLander 에이전트에 연결할 수 없습니다',
      target: '호스트',
      hint: '콘솔에서 이 호스트의 OpenLander 에이전트에 연결하지 못했습니다. `웹 서버 → 상태`를 확인하거나 SSH로 에이전트 서비스를 다시 시작하세요.',
    },
    OOM_KILLED: {
      title: '`worker`가 256 MB 메모리 제한을 넘어 중지되었습니다',
      target: '서비스 "worker"',
      hint: '작업 중 메모리 사용량이 312 MB까지 올랐습니다. `deploy.resources.limits.memory`를 512M으로 늘리거나 한 번에 처리하는 데이터 양을 줄이세요.',
    },
    DOCKER_DAEMON_UNREACHABLE: {
      title: '배포 중 Docker가 응답을 멈췄습니다',
      target: '호스트',
      hint: 'Docker 소켓에서 `connection refused`가 반환되었습니다. 기존 컨테이너에는 영향이 없습니다. 호스트의 Docker를 다시 시작한 뒤 재배포하세요.',
    },
    DISK_EXHAUSTED: {
      title: '호스트 디스크 공간이 부족해 빌드에 실패했습니다',
      target: '호스트',
      hint: '이미지 캐시가 4.2 GB를 쓰려 했지만 남은 공간은 1.1 GB였습니다. 사용하지 않는 Docker 데이터를 정리하거나 `웹 서버 → 유지 관리`에서 정기 정리를 설정하세요.',
    },
    NETWORK_DEPENDENCY_UNREACHABLE: {
      title: '기본 이미지를 받는 중 Docker 레지스트리 응답이 지연되었습니다',
      target: '이미지 "node:20-alpine"',
      hint: '이 호스트에서 docker.io에 연결하지 못했습니다. 외부 통신 방화벽을 확인하거나 `/etc/docker/daemon.json`에 레지스트리 미러를 설정하세요.',
    },
    HEALTHCHECK_TIMEOUT: {
      title: '`web` 상태 확인이 60초 동안 계속 실패했습니다',
      target: '서비스 "web"',
      hint: '시작 중 `/healthz`가 503을 반환합니다. `start_period`를 90초로 늘리거나 HTTP 서버가 준비되면 200을 반환하도록 수정하세요.',
    },
    BUILD_TIMEOUT: {
      title: '빌드가 제한 시간 20분을 넘었습니다',
      target: '서비스 "api"',
      hint: '9단계의 `pnpm build`가 19분 40초 동안 실행되었습니다. BuildKit으로 `node_modules/.cache`를 캐시하거나 타입 검사를 CI로 옮기세요.',
    },
  },
  sidebar: {
    collapse: '사이드바 접기',
    expand: '사이드바 펼치기',
    primaryNavAria: '주요 탐색',
    versionAria: '버전',
    sections: {
      workspace: '작업 공간',
      settings: '설정',
    },
    items: {
      home: '홈',
      agent: '내 에이전트',
      projects: '프로젝트',
      activity: '활동',
      monitoring: '모니터링',
      webServer: '웹 서버',
      security: '보안',
      gitProviders: 'Git 연결',
      repositoryKeys: '저장소 키',
      aiProviders: 'AI 모델 연결',
    },
  },
  platformUpdate: {
    button: {
      available: '새 버전 v{version}',
      availableTitle: '새 버전',
      progress: 'OpenLander 업데이트 중',
      rolledBack: '이전 버전으로 복구됨',
      failed: '업데이트 확인 필요',
      upToDate: 'v{version} 최신 상태',
      checkUnavailable: '업데이트 확인 필요',
    },
    dialog: {
      title: 'OpenLander 업데이트',
      description: '이 서버를 업데이트하기 전에 릴리스 내용과 안전 점검 결과를 확인하세요.',
      currentVersion: '현재 버전',
      targetVersion: '대상 버전',
      changes: '변경 사항',
      preflight: '사전 점검',
      progress: '업데이트 진행 상태',
      reconnectNotice:
        'OpenLander가 한 번 재시작됩니다. 이후 업데이트를 예약하지 않으며 이 화면은 자동으로 다시 연결됩니다.',
      reconnecting: 'OpenLander가 재시작 중입니다. 2초마다 다시 연결하고 있습니다…',
      updateNow: '지금 업데이트',
      starting: '시작 중…',
      retry: '업데이트 다시 시도',
      manualUpdate: '수동 업데이트 안내 보기',
      rolledBackHelp:
        '이전 버전이 다시 실행 중입니다. 확인을 위해 DB 백업은 보존했습니다. 오류를 확인한 뒤 다시 시도하세요.',
      failedHelp: '업데이트와 자동 복구를 모두 완료하지 못했습니다. 수동 복구 안내를 따라 주세요.',
      upToDate: '최신 상태',
      statusUnavailable: '상태 확인 불가',
      checkedAt: '릴리스 정보 확인: {time}',
      releaseCheckStale:
        '최신 릴리스 정보를 불러오지 못했습니다. 캐시된 정보가 표시될 수 있습니다.',
      checkNow: '지금 확인',
      checking: '확인 중…',
      noUpdateAvailable: '현재 업데이트 채널에 더 새로운 릴리스가 없습니다.',
      noFreshReleaseData:
        '릴리스 확인에 성공하기 전에는 더 새로운 버전이 있는지 확정할 수 없습니다.',
    },
    phase: {
      preparing: '업데이트 준비 중',
      backing_up: '설정과 데이터베이스 백업 중',
      pulling: '검증된 이미지 다운로드 중',
      restarting: 'OpenLander 재시작 중',
      verifying: '상태와 라우팅 검증 중',
      completed: '업데이트 완료',
      rolling_back: '이전 버전 복구 중',
      rolled_back: '이전 버전으로 복구됨',
      failed: '업데이트 실패',
    },
    checks: {
      official_compose: {
        pass: '공식 Docker Compose 설치를 확인했습니다.',
        fail: '현재 설치 방식에서는 원클릭 업데이트를 사용할 수 없습니다.',
      },
      release_manifest: {
        pass: '공식 릴리스 정보와 롤백 정책 검증을 통과했습니다.',
        fail: '이 릴리스에는 안전한 원클릭 업데이트 정보가 없습니다.',
      },
      active_operations: {
        pass: '진행 중인 배포와 프로젝트 잠금이 없습니다.',
        fail: '진행 중인 배포와 프로젝트 작업이 끝날 때까지 기다려 주세요.',
      },
      database: {
        pass: 'OpenLander 데이터베이스 컨테이너가 실행 중입니다.',
        fail: 'OpenLander 데이터베이스 컨테이너가 실행 중이 아닙니다.',
      },
      disk_space: {
        pass: '백업과 이미지 저장 공간이 2 GiB 이상 남아 있습니다.',
        fail: '사용 가능한 공간이 2 GiB 이상 필요합니다.',
        detail: '사용 가능 {available} GiB / 필요 {required} GiB',
      },
      compose_environment: {
        pass: '현재 Compose 환경을 안전하게 보존할 수 있습니다.',
        fail: '원클릭 업데이트에서 현재 Compose 환경을 보존할 수 없습니다.',
      },
    },
    toast: {
      completed: 'OpenLander 업데이트를 완료했습니다.',
      rolledBack: '업데이트에 실패해 이전 버전으로 자동 복구했습니다.',
      failed: '업데이트와 자동 복구에 실패했습니다.',
      startFailed: '업데이트를 시작하지 못했습니다. 사전 점검 결과를 확인한 뒤 다시 시도하세요.',
      checkFailed: '릴리스를 확인하지 못했습니다. 잠시 후 다시 시도하세요.',
    },
  },
  topBar: {
    agentChipPrefix: '에이전트',
    agentIdleStatus: '대기',
    sidebarToggleLabel: '사이드바 열기/닫기',
    breadcrumbAria: '경로 탐색',
    navigationTitle: '탐색',
    agentChipTitle: '에이전트 활동 — 에이전트가 한 작업을 확인하세요',
  },
  routes: {
    home: '홈',
    activity: '활동',
    mcp: 'MCP 서버',
    projects: '프로젝트',
    services: '리소스',
    monitoring: '모니터링',
    overview: '개요',
    settings: '설정',
  },
  agentGuide: {
    closeButton: '닫기',
    agentName: '내 에이전트',
    closeDialogLabel: '대화상자 닫기',
    mcpSetupCheck:
      '작업을 시작하기 전에 openlander_project({ action: "help" })를 호출해 OpenLander MCP 도구가 연결되어 있는지 확인하세요. openlander_* 도구가 없으면 작업을 멈추고 MCP 연결을 요청하세요. MCP 토큰으로 OpenLander /api 엔드포인트를 직접 호출하지 마세요.',
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
      title: '먼저 에이전트를 연결하세요',
      body: 'Claude나 다른 MCP 지원 에이전트를 OpenLander /mcp 엔드포인트에 연결하세요. 이 토큰은 MCP 도구용이며 /api 직접 호출용이 아닙니다.',
      setupAgent: '에이전트 설정',
    },
    copy: {
      label: '복사',
      success: '복사됨',
      disabledMessage: '먼저 에이전트를 연결하세요',
      enabledTitle: '프롬프트 복사',
    },
    content: {
      addService: {
        heading: '무엇을 배포할지 에이전트에게 알려주세요',
        lead: '프로젝트는 작업 공간이며, 그 안에서 애플리케이션과 Docker Compose 스택을 실행합니다. 아래 요청문을 복사하면 에이전트가 MCP를 통해 배포합니다.',
        prompt: {
          deploy:
            'github.com/myorg/myapp을 프로젝트 {projectName}에 새 애플리케이션으로 배포해 주세요.',
          database:
            'PostgreSQL 데이터베이스 리소스를 추가한 뒤 DATABASE_URL로 프로젝트 {projectName}에 연결해 주세요.',
          cache: '기존 redis-prod 캐시 리소스를 {projectName}의 애플리케이션에 연결해 주세요.',
        },
        hint: {
          database:
            '데이터베이스·캐시·스토리지 리소스는 에이전트가 먼저 만든 뒤 환경 변수로 애플리케이션에 연결합니다.',
        },
      },
      addManagedDb: {
        heading: '어떤 리소스를 만들지 에이전트에게 알려주세요',
        lead: '데이터베이스·캐시·스토리지 리소스를 먼저 만든 뒤 환경 변수로 애플리케이션이나 Docker Compose 스택에 연결합니다.',
        prompt: {
          postgres: '`app-db`라는 PostgreSQL 데이터베이스 리소스를 만들어 주세요.',
          redis:
            '`sessions`라는 Redis 캐시 리소스를 만든 뒤 애플리케이션에 `REDIS_URL`로 연결해 주세요.',
          list: '현재 등록된 데이터베이스·캐시·스토리지 리소스와 아직 연결하지 않은 리소스를 알려주세요.',
        },
        hint: {
          postgres: '그다음 연결 문자열을 애플리케이션의 `DATABASE_URL`에 넣고 다시 배포하세요.',
        },
      },
      addDomain: {
        heading: '연결할 도메인을 에이전트에게 알려주세요',
        lead: '도메인을 연결하면 이미 이 서버를 가리키는 호스트에 OpenLander 경로가 등록됩니다. v0.1에서는 DNS와 TLS를 OpenLander 밖에서 관리하며, 등록 후 경로 상태는 에이전트가 확인할 수 있습니다.',
        prompt: {
          attach:
            '프로젝트 {projectName}의 {serviceName}에 app.example.com을 연결하고 도메인 경로가 정상인지 확인해 주세요.',
          list: '{serviceName}의 도메인 경로를 나열하고 정상인 호스트를 알려주세요.',
        },
      },
      scaleService: {
        heading: '확장 방법을 에이전트에게 알려주세요',
        lead: '복제본 수와 리소스 제한 변경은 에이전트를 통해 실행합니다. 대화 기록에서 변경 내용을 검토하고 되돌릴 수 있습니다.',
        prompt: {
          replicas: '프로젝트 {projectName}에서 {serviceName} 복제본 수를 3개로 늘려 주세요.',
          memory:
            '프로젝트 {projectName}에서 {serviceName} 메모리 제한을 1Gi로 늘리고 안정화되면 알려주세요.',
        },
      },
      deleteService: {
        heading: '이 애플리케이션을 삭제하도록 요청하세요',
        lead: '대화에서 이 프로젝트의 정지·삭제를 허용할 수 있습니다. 권한이 저장되면 서비스를 하나씩 웹에서 승인하지 않아도 됩니다.',
        prompt: {
          delete:
            '프로젝트 {projectName}의 정지·삭제 권한을 허용하고 {serviceName} 서비스를 삭제해 주세요. 데이터 볼륨은 남겨 주세요.',
          checkReferences:
            '삭제하기 전에 프로젝트 {projectName}에서 {serviceName} 서비스를 사용하는 다른 서비스가 있는지 확인해 주세요.',
        },
        hint: {
          checkReferences:
            'MCP 삭제는 데이터 볼륨을 남깁니다. 다른 서비스의 의존성과 서비스별 차단 설정도 확인합니다.',
        },
      },
      removeDomain: {
        heading: '연결을 해제할 도메인을 에이전트에게 알려주세요',
        lead: 'v0.1에서는 웹의 도메인 탭에서 연결을 해제합니다. 에이전트는 현재 경로 상태를 점검하고 삭제할 호스트와 경로를 확인할 수 있습니다.',
        prompt: {
          check:
            '{serviceName} 도메인 경로를 나열하고, 웹 화면에서 삭제하기 전에 현재 {domain} 상태가 정상인지 확인해 주세요.',
          diagnose:
            '경로를 바꾸기 전에 {serviceName}에서 {domain} 관련 문제가 생긴 원인을 진단해 주세요.',
        },
        hint: {
          diagnose:
            'OpenLander v0.1은 DNS 레코드나 TLS 인증서를 만들지 않습니다. OpenLander 밖에서 확인하세요.',
        },
      },
      setEnvVar: {
        heading: '설정할 환경 변수를 에이전트에게 알려주세요',
        lead: '환경 변수 변경 사항은 MCP를 통해 저장합니다. 재배포와 함께 적용하도록 요청하거나, 필요한 경우에만 실행 중인 환경에 즉시 적용하도록 요청하세요.',
        prompt: {
          project: '{projectName}의 {key} 값을 <value>로 설정하고 다시 배포해 주세요.',
          service:
            '프로젝트 {projectName} 전체가 아니라 {serviceName} 항목에만 {key} 값을 설정한 뒤 {serviceName} 애플리케이션을 다시 배포해 주세요.',
        },
        hint: {
          project: '복사하기 전에 `<value>`를 실제 값으로 바꾸세요.',
        },
      },
      deleteEnvVar: {
        heading: '삭제할 환경 변수를 에이전트에게 알려주세요',
        lead: '환경 변수 삭제 사항은 MCP를 통해 저장합니다. 영향을 확인하고 필요한 애플리케이션이나 Docker Compose 작업을 다시 배포하도록 요청하세요.',
        prompt: {
          project: '{projectName}에서 {key}를 삭제하고 다시 배포해 주세요.',
          allServices:
            '{projectName}의 모든 서비스에서 {key}를 삭제하고 더 이상 참조하는 곳이 없는지 확인해 주세요.',
        },
      },
      wireManagedDb: {
        heading: '연결할 프로젝트를 에이전트에게 알려주세요',
        lead: '{managed} 리소스는 만들어졌지만 아직 연결되지 않았습니다. 대상 프로젝트와 환경 변수 키를 알려주면 에이전트가 연결 문자열을 설정하고 재배포 작업을 등록합니다.',
        prompt: {
          project: '{managed} 리소스를 프로젝트 {projectName}에 DATABASE_URL로 연결해 주세요.',
          service:
            '{managed} 리소스를 프로젝트 {projectName}의 {serviceName}에 서비스 전용 REDIS_URL로 연결해 주세요.',
        },
        hint: {
          service: '한 서비스에서만 이 변수를 사용해야 할 때 서비스 전용 방식을 선택하세요.',
        },
      },
    },
  },
  account: {
    popover: {
      openLabel: '설정 메뉴 열기',
      menuLabel: '설정 메뉴',
      triggerLabel: '설정',
      changePassword: '비밀번호 변경',
      switchLanguage: '언어 변경',
      signOut: '로그아웃',
    },
    changePassword: {
      title: '비밀번호 변경',
      close: '닫기',
      currentLabel: '현재 비밀번호',
      newLabel: '새 비밀번호',
      confirmLabel: '새 비밀번호 확인',
      cancel: '취소',
      submit: '비밀번호 변경',
      saving: '저장 중…',
      minHint: '최소 {count}자 이상.',
      tooShort: '새 비밀번호는 최소 {count}자 이상이어야 합니다.',
      mismatch: '새 비밀번호와 확인 값이 일치하지 않습니다.',
      failed: '비밀번호 변경에 실패했습니다.',
    },
  },
  activity: {
    eventTitle: {
      deployStarted: '배포 시작',
      deployCompleted: '배포 성공',
      deployFailed: '배포 실패',
      deployCancelled: '배포 취소',
      configChanged: '설정 변경',
      publicAccessEnabled: '보호 공유 활성화',
      publicAccessDisabled: '보호 공유 중지',
      publicAccessCodeRotated: '보호 공유 코드 변경',
      publicAccessVerificationFailed: '보호 공유 인증 실패',
      dataAccessRead: '데이터 소스 조회 · {operation}',
      serviceCrashed: '서비스 중단',
      serviceRecovered: '서비스 복구',
      mcpConnected: '{identity} 연결됨',
      mcpDisconnected: '{identity} 연결 끊김',
    },
    detail: {
      config_changed: '설정이 변경되었습니다.',
      data_access_read: '제한된 범위에서 데이터 소스를 조회했습니다.',
      service_crashed: '종료 코드 {exitCode} · 재시작 {restartCount}회',
      service_recovered: '서비스가 정상 상태로 돌아왔습니다.',
      mcp_connected: '세션 {session} · {transport}',
      mcp_disconnected: '세션 {session} · {transport} · 연결 시간 {duration}초',
    },
    filter: {
      type: {
        label: '유형',
        all: '전체',
        deploy: '배포',
        config: '설정',
        system: '시스템',
        crash: '장애',
        mcp: 'MCP',
        data: '데이터 접근',
      },
    },
    page: {
      title: '활동',
      subtitle: '배포, MCP, 시스템 이벤트, 설정 변경 기록을 유형별로 확인합니다.',
      emptyState: '아직 활동이 없습니다. 배포, 에이전트 작업, 장애가 발생하면 여기에 기록됩니다.',
      emptyStateData:
        '아직 데이터 조회 기록이 없습니다. 읽기 권한을 허용하면 에이전트의 제한된 데이터베이스·캐시 조회 기록이 여기에 표시됩니다.',
    },
    dataAccess: {
      // Content — compact audit row labels.
      operation: '작업: {operation}',
      source: '대상: {kind}',
      results: '결과 {count}개',
      duration: '{duration}ms',
      truncated: '일부만 표시',
      hash: '해시 {hash}',
      preview: '민감 정보가 가려진 쿼리 미리보기',
    },
  },
  overview: {
    // Chrome — page title + KPI tile labels.
    title: '개요',
    kpi: {
      activeDeploys: '진행 중인 배포',
      recoveries: '복구',
      approvals: '승인',
      incidents: '알림',
      services: '비정상 리소스',
      aiSpend: 'AI 사용 비용',
    },
    activity: {
      // Chrome — section title.
      title: '실시간 활동',
      // Content — empty state + formatted display.
      empty: '아직 활동이 없습니다.',
      timeAgo: '{time} 전',
    },
    attention: {
      // Chrome — section title.
      title: '확인 필요',
      // Content — empty state + formatted display.
      empty: '모든 시스템이 정상입니다.',
      projectError: '{name} 배포 실패',
      pendingApprovals: '승인 대기 {count}건',
      unhealthyServices: '비정상 리소스 {count}개',
    },
    health: {
      // Chrome — section title.
      title: '프로젝트 상태',
    },
    // Content — empty state.
    empty: '아직 활동이 없습니다. 첫 번째 프로젝트를 배포하여 실시간 업데이트를 확인하세요.',
  },
  pulse: {
    // Chrome — status pills.
    deploying: '배포 중',
    recovery: '복구',
    approval: '승인',
    incidents: '알림',
    aiSpend: 'AI 사용 비용',
  },
  monitoring: {
    // Chrome — page heading + filter option + status pills + metric
    // labels. Health states are machine-readable wire values
    // (see useMonitoring's MonitoringServiceView['health']), so they
    // stay English under the Hybrid rule.
    pageTitle: '모니터링',
    allProjects: '모든 프로젝트',
    unattached: '연결 안 됨',
    metrics: {
      cpu: 'CPU',
      mem: 'MEM',
    },
    health: {
      healthy: '정상',
      healthyStale: '정상 · 오래된 정보',
      unhealthy: '비정상',
      unhealthyStale: '비정상 · 오래된 정보',
      unknown: '알 수 없음',
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
      someCrashed: '프로젝트 {total}개 중 {crashed}개 중단 · {healthy}개 정상 (총 {services})',
      lastDeploy: '최근 배포',
    },
    projects: {
      // Chrome — section title + status pill + aria label.
      sectionTitle: '프로젝트',
      crashedPill: '중단됨',
      openProject: '{name} 프로젝트 열기',
      // Content — empty state + inline action link.
      emptyText: '아직 프로젝트가 없습니다.',
      createOne: '새로 만들기',
    },
    recentActivity: {
      // Chrome — section title.
      sectionTitle: '최근 활동',
      // Content — section subtitle.
      sectionSubtitle: '배포, 설정 변경, 에이전트 호출의 감사 로그입니다.',
    },
  },
  setup: {
    welcome: {
      title: 'OpenLander입니다',
      subtitle: '배포할 저장소를 연결하세요. 이후 과정은 OpenLander가 처리합니다.',
      dockerRequired: '계속하려면 Docker가 실행 중이어야 합니다.',
    },
    github: {
      // Chrome.
      title: '시작할 준비가 되었습니다',
      switchAccount: '계정 변경',
      // Content — descriptive copy stays Korean.
      subtitle: '저장소 배포를 시작하려면 GitHub 계정을 연결하세요.',
      description: '비공개 저장소를 배포할 때 필요합니다. 공개 저장소는 연결하지 않아도 됩니다.',
      connectedAs: '{username} 계정으로 연결됨',
      access: 'GitHub 접근',
      optional: '선택 사항',
      open: 'GitHub 열기',
      copyCode: '코드 복사',
      copied: '복사됨',
      cancel: '취소',
      connect: '연결',
      or: '또는',
      connectFailed: 'GitHub에 연결하지 못했습니다.',
      disconnectFailed: 'GitHub 연결을 해제하지 못했습니다.',
    },
    password: {
      // Chrome.
      title: '비밀번호 설정',
      placeholder: '비밀번호',
      confirmPlaceholder: '비밀번호 확인',
      submit: '비밀번호 설정 후 계속',
      saving: '설정 중...',
      // Content — descriptions + hints + errors stay Korean.
      subtitle: '대시보드를 비밀번호로 보호하세요.',
      lengthHint: '최소 8자 이상이어야 합니다.',
      mismatch: '비밀번호가 일치하지 않습니다',
      empty: '비밀번호를 입력해 주세요',
      tooShort: '비밀번호는 최소 8자 이상이어야 합니다',
      errorGeneric: '비밀번호 저장에 실패했습니다. 다시 시도해 주세요.',
    },
    mcp: {
      // Chrome.
      title: 'AI 코딩 도구 연결',
      manualSetup: '직접 설정 방법',
      skipForNow: '나중에 하기',
      startDeploying: '배포 시작',
      generateToken: 'MCP 토큰 발급',
      generating: '발급 중…',
      tokenName: '초기 설정',
      instanceName: '인스턴스 이름',
      instanceHelp: '이 이름이 MCP 클라이언트 설정의 서버 키로 사용됩니다.',
      instanceDefaultWarning: '여러 OpenLander 서버를 연결한다면 구분 가능한 이름으로 바꾸세요.',
      saveInstance: '이름 저장',
      savingInstance: '저장 중…',
      instanceSaveFailed: 'MCP 인스턴스 이름을 저장하지 못했습니다.',
      tryAfterConnect: '연결 후 이렇게 말해보세요:',
      tryPrompt: '{name}에 이 앱을 배포해 줘',
      // Content.
      subtitle: 'Codex, Claude Code, Cursor 등 MCP를 지원하는 클라이언트에서 배포하세요.',
      copyPrompt: '아래를 AI 코딩 도구에 붙여넣으세요:',
      noTokenYet: '아직 발급된 MCP 토큰이 없습니다. 생성하면 연동 설정을 확인할 수 있습니다.',
      tokenAlreadyIssued:
        'MCP 토큰(olp_…{suffix})이 이미 발급되어 있습니다. 설정 코드에 사용할 새 토큰을 받으려면 사이드바의 내 에이전트에서 재발급하세요. 기존 토큰은 무효화됩니다.',
      tokenError:
        'MCP 토큰을 자동으로 발급하지 못했습니다. 설정을 완료한 뒤 내 에이전트에서 직접 발급할 수 있습니다.',
      legacyTokenRotated:
        '기존에 사용하던 레거시 API 토큰(ol_…)이 설정 과정에서 무효화되었습니다. 해당 토큰을 사용 중인 MCP 클라이언트는 위의 신규 토큰으로 갱신해 주세요.',
    },
    common: {
      // Chrome — bare verbs.
      back: '뒤로',
      continue: '계속',
      getStarted: '시작하기',
      refreshStatus: '상태 새로고침',
    },
    infra: {
      // Chrome — status pills.
      dockerEngine: 'Docker 엔진',
      traefikProxy: 'Traefik 프록시',
      running: '실행 중',
      stopped: '중지됨',
      dockerNotInstalled: 'Docker가 설치되어 있지 않음',
      dockerNotRunning: 'Docker가 실행되고 있지 않음',
      dockerPermissionFixed: '권한 변경 완료 · OpenLander 재시작 필요',
      dockerPermissionDenied: 'Docker 사용 권한 필요',
      dockerUnavailable: 'Docker 상태를 확인할 수 없음',
      // Content — surfaced as a toast when SetupScreen clamps step back
      // to Infrastructure because Docker stopped responding.
      dockerReturned: 'Docker가 실행되고 있지 않아 서버 환경 확인 단계로 돌아갔습니다.',
    },
  },
  notifications: {
    // Chrome — section title.
    title: '알림',
    // Content — empty state.
    empty: '알림이 없습니다',
    type: {
      // Content — sentence-shape notification kind labels read more clearly
      // in Korean (these are descriptive diagnostic categories, not pill
      // statuses).
      'container-crash': '컨테이너 비정상 종료',
      'restart-loop': '반복 재시작',
      'resource-saturation': '리소스 사용량 과다',
      disk: '디스크 공간 부족',
      'inactive-project': '장기 미사용 프로젝트',
      'dangling-images': '사용하지 않는 이미지',
      'port-conflict': '포트 충돌',
      'orphan-container': '프로젝트에 연결되지 않은 컨테이너',
    },
    action: {
      // Chrome — action buttons.
      view_logs: '로그 보기',
      view_stats: '자세히 보기',
      cleanup_disk: '정리',
      cleanup_images: '정리',
      view_details: '자세히 보기',
    },
    settings: {
      subtitle: '일반 웹훅입니다. 받을 이벤트를 고르면 OpenLander가 지정한 URL로 JSON을 보냅니다.',
      description:
        '1.0에서는 전송 방식에 구애받지 않는 웹훅 하나를 제공합니다. n8n, IFTTT, 자체 봇, Discord·Slack 수신 웹훅에 연결할 수 있습니다.',
      webhookUrl: '웹훅 URL',
      events: '이벤트',
      event: {
        deployStarted: '배포 시작',
        deployCompleted: '배포 완료',
        deployFailed: '배포 실패',
        serviceCrashed: '서비스 중단',
        serviceRecovered: '서비스 복구',
      },
      saving: '저장 중…',
      save: '웹훅 저장',
      urlRequired: '저장하려면 URL을 입력하세요.',
      saved: '웹훅을 저장했습니다',
      saveFailed: '웹훅을 저장하지 못했습니다',
      futureTitle: '추후 지원할 알림 서비스',
      futureSubtitle:
        'Discord, Slack, 이메일 설정은 v1.1에서 제공합니다. 같은 웹훅 연결 방식을 사용합니다.',
      addPreset: '알림 서비스 추가 (v1.1)',
    },
  },
  newProject: {
    // Chrome — modal title + tab labels + form labels + button.
    title: '새 프로젝트',
    myRepos: '내 저장소',
    search: '검색',
    dockerImage: 'Docker 이미지',
    portLabel: '포트 (선택 사항)',
    portPlaceholder: '80',
    commandLabel: '명령어 (선택 사항)',
    deployImage: '이미지 배포',
    // Content — descriptive prompts, error copy, placeholder hints.
    selectRepo: '배포할 저장소를 선택하세요',
    noReposFound: '검색 결과가 없습니다:',
    githubNotConnected: 'GitHub가 연결되지 않았습니다. 설정에서 계정을 추가하세요.',
    fetchFailed: '저장소를 불러오지 못했습니다',
    searchPlaceholder: '저장소 검색…',
    imagePlaceholder: '예: nginx:latest 또는 ghcr.io/user/app:v1',
    commandPlaceholder: '예: --model-id BAAI/bge-m3',
  },
  projects: {
    // Chrome — page title + primary action + CTA button + controls.
    title: '프로젝트 현황',
    pageTitle: '프로젝트',
    newProject: '새 프로젝트',
    tags: '태그',
    newestFirst: '최신순',
    moreOptions: '추가 옵션',
    createFirst: '첫 프로젝트 만들기',
    deployFirstApp: '첫 애플리케이션 배포하기',
    // Content — page subtitle + placeholders + empty state + descriptive
    // copy + relative-time formatted strings + errors.
    pageSubtitle: '프로젝트를 생성하고 관리합니다.',
    filterPlaceholder: '프로젝트 검색…',
    emptyTitle: '아직 프로젝트가 없습니다',
    emptyDescription:
      '프로젝트는 관련 애플리케이션, Compose, 데이터베이스·캐시·스토리지 리소스를 묶어줍니다.',
    searchEmpty: '"{query}"와 일치하는 프로젝트가 없습니다',
    deployedAgo: '배포 · {time}',
    createdAgo: '생성 · {time}',
    monitored: '프로젝트 {count}개 모니터링 중',
    noProjects: '프로젝트가 없습니다',
    status: {
      running: '실행 중',
      building: '배포 중',
      error: '오류',
      stopped: '중지됨',
      idle: '대기',
      unknown: '상태 확인 불가',
    },
    connectGithub: 'GitHub 저장소를 연결하면 에이전트가 이후 과정을 처리합니다.',
    error: {
      invalidName:
        '프로젝트 이름은 소문자 또는 숫자로 시작해야 하며, 소문자, 숫자, 하이픈만 포함할 수 있습니다',
    },
    filter: {
      // Chrome — toggle labels.
      showArchived: '보관 항목 표시',
      hideArchived: '보관 항목 숨기기',
    },
    create: {
      // Chrome — modal heading + buttons + form labels.
      title: '프로젝트 만들기',
      cancel: '취소',
      submit: '프로젝트 만들기',
      submitting: '만드는 중...',
      nameLabel: '프로젝트 표시 이름',
      namePlaceholder: '특가 알림 서비스',
      // Content — descriptive prose + close-aria + errors.
      description:
        '프로젝트는 관련 애플리케이션, Compose, 데이터베이스·캐시·스토리지 리소스를 한곳에서 관리하는 작업 공간입니다.',
      closeAria: '프로젝트 만들기 대화상자 닫기',
      errors: {
        nameRequired: '프로젝트 이름을 입력하세요.',
        fallback: '프로젝트 생성에 실패했습니다.',
      },
    },
    card: {
      // Chrome — card field labels + badges.
      archivedBadge: '보관됨',
      partiallyArchivedBadge: '일부 보관됨',
      failedInitialDeployBadge: '설정 실패',
      failedInitialDeployHint:
        '첫 배포가 완료되지 않았습니다. 열어서 확인하거나 승인 기반 정리를 요청하세요.',
      lastDeploy: '최근 배포',
      branch: '브랜치',
      endpoint: '접속 주소',
      public: '공개',
    },
    archive: {
      // Chrome — button.
      button: '보관',
      remainingButton: '나머지 보관',
      // Content — toast + confirmation prose.
      success: '프로젝트가 보관되었습니다',
      description:
        '이 프로젝트를 보관하시겠습니까? 컨테이너는 중지되지만 모든 구성과 기록은 보존됩니다.',
      remainingDescription:
        '이 프로젝트의 남은 활성 애플리케이션을 보관하시겠습니까? 이미 보관된 애플리케이션은 그대로 유지됩니다.',
    },
    unarchive: {
      // Chrome — button.
      button: '복원',
      // Content — toast.
      success: '프로젝트가 복원되었습니다',
    },
    purge: {
      // Chrome — destructive button + modal title + confirm button.
      button: '영구 삭제',
      title: '프로젝트 영구 삭제',
      confirm: '영구 삭제',
      // Content — confirmation prose + input placeholder (hint).
      description: '이 작업은 되돌릴 수 없습니다. 확인을 위해 프로젝트 이름을 입력하세요.',
      inputPlaceholder: '프로젝트 이름 입력',
    },
  },
  projectDetail: {
    // Content — descriptive copy.
    notFound: '프로젝트를 찾을 수 없습니다',
    notFoundSubtitle: 'id "{id}"에 해당하는 프로젝트가 없습니다',
    backToHome: '← 홈으로 돌아가기',
    noDeployments: '아직 배포가 없습니다',
    deploymentsLoadFailed: '배포 내역을 불러오지 못했습니다',
    deploymentsRetry: '다시 시도',
    deploymentsNoMatch: '이 조건에 맞는 배포가 없습니다',
    timestamps: '수정 {updated} · 생성 {created}',
    confirmDelete: '이 프로젝트를 삭제하시겠습니까?',
    tabs: {
      // Chrome — nav tabs.
      services: '리소스',
      context: '현황',
      aiOps: 'AI Ops',
      settings: '설정',
    },
    diagnosis: {
      // Content — error/notice copy.
      noFixes: '구체적인 해결책이 반환되지 않았습니다.',
      fixFailed: 'AI로 수정 실패',
    },
    // Content — success toasts.
    redeploySuccess: '프로젝트 재배포 중…',
    stopSuccess: '프로젝트 중지됨',
    startSuccess: '프로젝트 시작됨',
    archiveSuccess: '프로젝트가 보관되었습니다',
    deleteSuccess: '프로젝트 삭제됨',
    // Chrome — back button.
    goBack: '뒤로',
    danger: {
      // Chrome — nav label + section headings.
      nav: '위험 작업',
      title: '위험 작업',
      archiveTitle: '프로젝트 보관',
      partialArchiveTitle: '남은 애플리케이션 보관',
      restoreTitle: '프로젝트 복원',
      deleteTitle: '프로젝트 영구 삭제',
      // Content — descriptive copy + error.
      description: '프로젝트를 보관하거나 영구 삭제합니다.',
      archiveBody: '컨테이너를 중지하고 기본 목록에서 숨기되 설정은 보존합니다.',
      partialArchiveBody:
        '일부 애플리케이션이 이미 보관되어 있습니다. 프로젝트 보관을 완료하려면 남은 활성 애플리케이션도 보관하세요.',
      restoreBody: '보관된 프로젝트를 기본 프로젝트 목록으로 되돌립니다.',
      deleteBody: '프로젝트, 애플리케이션, 컨테이너, 설정, 기록을 삭제합니다.',
      purgeDescription:
        '프로젝트와 관련 실행 리소스를 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
      unarchiveDescription: '보관된 프로젝트를 활성 프로젝트 목록으로 복원합니다.',
      archivedServicesTitle: '보관된 애플리케이션',
      archivedServicesBody:
        '보관된 애플리케이션은 기본 목록에서 숨겨집니다. 여기에서 복원하거나 이름을 입력해 영구 삭제할 수 있습니다.',
      archivedServicesLoading: '보관된 애플리케이션을 불러오는 중…',
      archivedServicesEmpty: '이 프로젝트에 보관된 애플리케이션이 없습니다.',
      archivedServicesLoadError: '보관된 애플리케이션을 불러오지 못했습니다',
      archivedServiceId: '서비스 ID: {id}',
      archivedServiceArchivedAt: '보관 시각 {value}',
      restoreService: '복원',
      deleteService: '삭제',
      deleteArchivedServiceHint:
        '다음 이름을 입력하면 이 애플리케이션을 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다. 입력할 이름: {slug}',
      deleteArchivedServiceInputLabel: '삭제 확인용 이름: {slug}',
      error: '프로젝트 작업에 실패했습니다',
    },
    addResourceWithAgent: '에이전트에게 데이터베이스·캐시 추가 요청',
    publicAccess: {
      title: '보호된 외부 공유',
      publish: '외부 공유',
      publishing: '공유 준비 중…',
      cloudflareVerifying: 'DNS·Tunnel 경로와 실제 외부 접속을 확인하고 있습니다…',
      stopping: '공개 중지 중…',
      retry: '공개 다시 시도',
      stop: '공개 중지',
      open: '공개 URL 열기',
      copy: '공개 URL 복사',
      copied: '공개 URL을 복사했습니다',
      copyFailed: '공개 URL을 복사하지 못했습니다.',
      connectFirst: '이 애플리케이션을 공개하려면 먼저 보호 공유를 설정하세요.',
      setupFirst: '웹 서버 설정에서 공개 주소와 인증서 이메일을 먼저 입력하세요.',
      setupTitle: '안전한 외부 공유 설정',
      setupDescription:
        '이 OpenLander 서버에서 한 번만 설정합니다. 이후 직접 공유하는 모든 애플리케이션에 공통으로 사용합니다.',
      setupPublicHost: '공개 IPv4 또는 기본 도메인',
      setupDetectedHost: '이 GCP 서버에서 {ip} 주소를 감지했습니다. 고정 외부 IP인지 확인하세요.',
      setupPublicHostHelp: '이 서버를 가리키는 고정 공인 IPv4 또는 기본 도메인을 입력하세요.',
      setupAcmeEmail: 'ACME 연락처 이메일',
      setupAcmeEmailHelp:
        '수신 가능한 공용 메일을 사용하세요. 인증서 등록을 위해 Let’s Encrypt에 전달되며 방문자에게는 공개되지 않습니다.',
      setupLoadFailed: '외부 공유 설정을 불러오지 못했습니다.',
      setupSaveFailed: '외부 공유 설정을 저장하지 못했습니다.',
      setupSaving: '저장 중…',
      setupConfirm: '저장하고 공유',
      runningApplicationRequired: 'HTTP 애플리케이션을 실행하면 공개할 수 있습니다.',
      notEligible: '실행 중이며 포트가 감지된 HTTP 애플리케이션이 필요합니다.',
      httpsPortUnavailable:
        '이 서버에서 443 포트를 이미 사용 중입니다. 포트를 비우거나 Cloudflare 터널을 사용하세요.',
      publishFailed: '애플리케이션을 외부 공유하지 못했습니다.',
      cloudflareUnavailable:
        '이 서버에서 Cloudflare에 연결하지 못했습니다. 서버 네트워크 또는 Cloudflare 연결을 복구한 뒤 다시 시도하세요.',
      routeUnreachable:
        'Cloudflare에 경로는 등록됐지만 아직 외부에서 접속할 수 없습니다. 다시 시도하거나 Cloudflare 연결을 복구하세요.',
      applicationUnhealthy:
        '공개 경로는 애플리케이션에 도달했지만 서버 오류가 반환됐습니다. 앱 상태와 로그를 확인하세요.',
      publishErrorGeneric:
        '외부 공유를 완료하지 못했습니다. 애플리케이션 상태를 확인하고 다시 시도하세요.',
      unpublishFailed: '공개를 중지하지 못했습니다.',
      stopTitle: '외부 공개를 중지할까요?',
      stopDescription:
        '{hostname} 주소로 더 이상 접속할 수 없습니다. 나중에 같은 URL로 다시 공개할 수 있습니다.',
      stopConfirm: '공개 중지',
      publishReady: '보호된 외부 공유를 시작했습니다.',
      codeSet: '코드 설정됨',
      codeMasked: '••••-••••',
      revealCode: '접근 코드 보기',
      hideCode: '접근 코드 숨기기',
      codeRevealFailed: '접근 코드를 불러오지 못했습니다.',
      codeRevealUnavailable:
        '이전에 만든 코드는 복구할 수 없습니다. 한 번 새로 만들면 이후에는 언제든 다시 볼 수 있습니다.',
      copyCode: '접근 코드 복사',
      codeCopied: '접근 코드를 복사했습니다',
      rotateCode: '새 접근 코드 만들기',
      rotateTitle: '새 접근 코드를 만들까요?',
      rotateDescription: '현재 접근 코드와 이미 인증된 모든 방문자 세션이 즉시 무효화됩니다.',
      rotateConfirm: '새 코드 만들기',
      codeRotated: '새 접근 코드를 만들었습니다. 기존 방문자는 모두 로그아웃되었습니다.',
      methodTitle: '외부 공유 방식 선택',
      methodDescription: '이 애플리케이션에 사용할 접속 방식을 선택하세요.',
      entrypointNote:
        '선택한 HTTP 애플리케이션만 공개 진입점이 됩니다. 데이터베이스·Worker·다른 애플리케이션은 비공개로 유지됩니다.',
      methodProtected: '직접 보호 공유',
      methodProtectedShort: '접근 코드',
      methodProtectedDescription:
        '서버의 80·443 포트로 연결하고 무료 HTTPS 주소와 OpenLander 접근 코드를 사용합니다.',
      methodCloudflare: 'Cloudflare 터널',
      methodCloudflareShort: 'Cloudflare 방식',
      methodCloudflareDescription:
        '인바운드 포트를 열지 않고 연결된 Cloudflare 도메인으로 공개합니다. 접근 코드는 적용되지 않습니다.',
      recommended: '권장',
      cloudflareStarted: 'Cloudflare Tunnel 게시를 시작했습니다.',
      connectCloudflareFirst: '웹 서버 설정에서 Cloudflare를 먼저 연결하세요.',
      cloudflareNotEligible:
        '이 프로젝트의 다른 애플리케이션이 Cloudflare Tunnel을 사용 중이거나 연결을 확인해야 합니다.',
      cloudflareBusyElsewhere:
        '이 프로젝트의 다른 애플리케이션이 사용 중입니다. 기존 Cloudflare 공유를 먼저 중지하세요.',
      cloudflareNeedsAttention: 'Cloudflare 연결을 복구한 뒤 선택할 수 있습니다.',
      openCloudflareSettings: 'Cloudflare 설정 열기',
    },
    env: {
      // Chrome — form labels + buttons + status.
      add: '추가',
      paste: '.env 붙여넣기',
      cancel: '취소',
      import: '분석 후 가져오기',
      key: '키',
      value: '값',
      showValue: '값 표시',
      hideValue: '값 숨기기',
      delete: '변수 삭제',
      save: '저장',
      saving: '저장 중…',
      // Content — section copy, errors, hints, success toasts.
      title: '애플리케이션 환경 변수',
      description:
        '이 변수는 이 애플리케이션 또는 Compose 작업에만 적용됩니다. 저장한 뒤 실행 중인 컨테이너에 반영하려면 다시 배포하세요.',
      loading: '환경 변수를 불러오는 중…',
      empty: '이 애플리케이션에 설정된 환경 변수가 없습니다.',
      pasteTitle: '.env 내용 붙여넣기',
      saved: '환경 변수를 저장했습니다.',
      savedNeedsRedeploy:
        '환경 변수를 저장했습니다. 변경 사항을 반영하려면 이 애플리케이션을 재배포하세요.',
      unsavedChanges: '저장되지 않은 변경사항입니다. 저장하거나 새로고침해서 버릴 수 있습니다.',
      loadError: '환경 변수를 불러오지 못했습니다',
      saveError: '환경 변수 저장에 실패했습니다',
      duplicateKey: '중복된 환경 변수 키: {key}',
      invalidKey:
        '잘못된 환경 변수 키: {key}. 키는 영문자나 밑줄(_)로 시작해야 하며 영문자·숫자·밑줄만 사용할 수 있습니다.',
    },
    addService: {
      // Chrome — modal title + source option labels + form labels + buttons.
      title: '애플리케이션 추가',
      descriptionPrefix: '프로젝트',
      git: 'GitHub에서 가져오기',
      image: '이미지에서 만들기',
      template: '템플릿에서 만들기',
      templateDescription: '검증된 구성',
      soon: '곧 출시',
      serviceName: '애플리케이션 이름',
      repo: 'GitHub 저장소',
      branch: '브랜치',
      dockerfilePath: 'Dockerfile 경로',
      dockerTarget: 'Docker 대상',
      buildContext: '빌드 컨텍스트',
      imageReference: '이미지 주소',
      containerPort: '컨테이너 포트',
      cancel: '취소',
      create: '애플리케이션 만들기',
      creating: '만드는 중…',
      // Content — descriptive copy + hints + error messages + success toast.
      descriptionSuffix:
        '· Git 저장소 또는 컨테이너 이미지를 고르고 애플리케이션 이름을 지정하세요.',
      gitDescription: '저장소에서 빌드',
      imageDescription: 'OCI 이미지 가져오기',
      templateSoon: '템플릿은 곧 제공됩니다.',
      templateBody:
        '검증된 스택(Postgres, Redis, n8n, Plausible, Umami)은 v0.2에서 제공될 예정입니다. 지금은 GitHub 또는 이미지 소스를 사용하세요.',
      serviceNameHint: '{path} 경로에 사용됩니다.',
      imageReferenceHint:
        'Docker Hub, GHCR 또는 OCI 레지스트리. 태그를 고정하세요 — :latest는 배포마다 달라질 수 있습니다.',
      success: '{name} 애플리케이션을 배포 중입니다.',
      errorName:
        '애플리케이션 이름을 입력하거나 OpenLander가 이름을 알아낼 수 있는 소스를 입력하세요.',
      errorRepo: 'GitHub 저장소 URL을 입력하세요.',
      errorImage: '이미지 주소를 입력하세요.',
      errorPort: '포트는 양의 정수여야 합니다.',
      errorCreate: '애플리케이션을 만들지 못했습니다',
    },
    serviceDelete: {
      // Chrome — card title + modal title + form label + buttons.
      title: '이 애플리케이션 삭제',
      confirmTitle: '애플리케이션 삭제',
      confirmLabel: '삭제 확인을 위해 다음 이름을 입력하세요:',
      deleting: '삭제 중…',
      confirmButton: '애플리케이션 삭제',
      // Content — descriptive body + confirmation prose + error + checkbox label.
      body: '컨테이너와 애플리케이션 설정을 제거합니다. 프로젝트 볼륨은 따로 선택하지 않으면 보존됩니다.',
      confirmDescription:
        '실행 중인 컨테이너를 중지하고 제거하며, 애플리케이션의 환경 변수, 도메인, 리소스 설정을 삭제합니다. 프로젝트 볼륨은 기본적으로 보존됩니다.',
      deleteVolumes: '이 프로젝트의 마지막 애플리케이션이라면 프로젝트의 Docker 볼륨도 삭제합니다.',
      error: '애플리케이션을 삭제하지 못했습니다',
    },
    serviceLifecycle: {
      // Chrome — section heading.
      title: '애플리케이션 수명 주기',
      archivedBadge: '보관됨',
    },
    serviceArchive: {
      // Chrome — card title + modal title + buttons.
      title: '이 애플리케이션 보관',
      confirmTitle: '애플리케이션 보관',
      archiving: '보관 중…',
      confirmButton: '애플리케이션 보관',
      // Content — descriptive body + confirmation prose + error.
      body: '실행을 중지하고 설정과 기록은 보존한 채 이 애플리케이션을 보관 상태로 표시합니다.',
      confirmDescription:
        '실행을 중지하고 애플리케이션을 보관 상태로 표시합니다. 설정, 환경 변수, 도메인, 기록은 보존됩니다.',
      error: '애플리케이션을 보관하지 못했습니다',
    },
    serviceRestore: {
      // Chrome — card title + modal title + buttons.
      title: '이 애플리케이션 복원',
      confirmTitle: '애플리케이션 복원',
      restoring: '복원 중…',
      confirmButton: '애플리케이션 복원',
      // Content — descriptive body + confirmation prose + error.
      body: '보관된 애플리케이션을 다시 활성 상태로 되돌립니다. 복원 후 재배포하면 실행됩니다.',
      confirmDescription:
        '보관 표시를 해제합니다. 컨테이너를 자동으로 시작하지는 않으므로 복원 후 애플리케이션을 재배포하세요.',
      error: '애플리케이션을 복원하지 못했습니다',
    },
    servicesGuide: {
      empty:
        '아직 이 프로젝트에 리소스가 없습니다. 애플리케이션을 추가하거나 에이전트에게 데이터베이스·캐시·스토리지 리소스를 추가해 달라고 요청하세요.',
      help: '프로젝트는 애플리케이션, Compose, 데이터베이스, 캐시, 스토리지 리소스를 묶는 작업 공간입니다. MCP 후속 작업에서는 service_id를 사용하세요.',
      banner: '리소스를 열어 상태를 확인하세요. 여러 앱을 정리하려면 정지·삭제 요청을 선택하세요.',
      archivedVisible:
        '보관된 애플리케이션도 표시하고 있습니다. 애플리케이션을 열어 복원하거나 위험 작업에서 삭제할 수 있습니다.',
      showArchived: '보관된 애플리케이션 표시',
      hideArchived: '보관된 애플리케이션 숨기기',
      loadingArchived: '보관된 애플리케이션 불러오는 중…',
      archivedLoadError: '보관된 애플리케이션을 불러오지 못했습니다: {message}',
      serviceId: 'MCP 서비스 ID: {id}',
      serviceIdTooltip:
        '선택한 애플리케이션, Compose 또는 데이터베이스·캐시·스토리지 리소스의 호환 ID입니다. MCP 후속 작업에는 이 service_id를 전달하세요.',
      quickActions: {
        more: '{name} 퀵 메뉴',
        overview: '상세 보기',
        logs: '로그 보기',
        deployments: '배포 내역 보기',
        monitoring: '모니터링 열기',
        environment: '환경 변수 관리',
        domains: '도메인 관리',
        connections: '연결 프로젝트 보기',
        openUrl: '애플리케이션 URL 열기',
        publicAccess: '외부 공유',
        checkingShare: '공유 상태 확인 중…',
        retryShareStatus: '공유 상태 다시 확인',
        shareProtected: '접근 코드로 공유',
        shareCloudflare: 'Cloudflare로 공유',
        cloudflareBusy: '다른 앱에서 Cloudflare 사용 중',
        shareProvisioning: '실제 외부 접속 확인 중…',
        shareStopping: '외부 공유 중지 중…',
        openPublicUrl: '공개 URL 열기',
        stopShare: '외부 공유 중지',
        shareReady: '공개 URL 접속 준비가 끝났습니다.',
        shareStopped: '외부 공유를 중지했습니다.',
        setupRequired: '먼저 최초 1회 보호 공유 설정을 완료하세요.',
        shareResultTitle: '외부 공유 준비 완료',
        shareResultDescription:
          '{name}에 전달할 URL과 접근 코드를 복사하세요. 애플리케이션 목록에서 코드를 다시 볼 수 있습니다.',
        publicUrl: '공개 URL',
        accessCode: '접근 코드',
      },
    },
    composeService: {
      role: {
        application: '애플리케이션',
        job: '작업',
        resource: '리소스',
      },
      trafficTarget: '대표 트래픽 대상',
      lastDeploy: '최근 배포: {status} · {time}',
      aggregate: {
        running: 'Compose 정상',
        degraded: 'Compose 일부 이상',
        error: 'Compose 오류',
      },
      aggregateHint: '아래의 비정상 서비스 또는 실패한 작업을 확인하세요.',
    },
    dataAccessIndicator: {
      enabled: '에이전트 읽기: 켜짐',
      disabled: '에이전트 읽기: 꺼짐',
      external: '에이전트 읽기: 설정 필요',
      unsupported: '에이전트 읽기: 지원 안 함',
      settingsHint: '{name}의 읽기 권한은 프로젝트 설정 → 데이터 조회 권한에서 변경합니다.',
    },
    domains: {
      // Chrome — action button + retry + badge.
      add: '직접 연결 도메인 추가',
      legacyBadge: '이전 CF 방식',
      retry: '다시 시도',
      // Content — empty state + descriptive hints + tooltip + load error + aria.
      empty: '아직 연결된 도메인이 없습니다.',
      emptyExternal:
        '외부 인프라 모드입니다. 접속 경로는 외부 프록시(nginx, Caddy, Apache 등)에서 관리하세요.',
      tlsHint: 'v0.1에서는 TLS를 외부 프록시가 책임집니다. ACME 자동 발급은 v0.2 예정입니다.',
      dnsHint:
        'A/AAAA/CNAME 레코드를 OpenLander가 실행되는 서버를 가리키도록 직접 설정하세요. OpenLander는 DNS를 자동 관리하지 않습니다.',
      legacyTooltip:
        '이 직접 연결 경로에는 이전 Cloudflare 메타데이터가 남아 있습니다. 제거해도 외부 DNS 레코드는 삭제되지 않습니다.',
      removeAria: '직접 연결 도메인 {domain} 제거',
      loadError: '도메인 목록을 불러오지 못했습니다. 목록이 최신이 아닐 수 있습니다.',
      dialog: {
        // Chrome — dialog title + form labels + buttons.
        title: '직접 연결 도메인 추가',
        domain: '도메인',
        path: '경로',
        advanced: '고급 설정',
        stripPrefix: '경로 앞부분 제거',
        upstreamPathPrefix: '대상 경로',
        targetPort: '대상 포트',
        submit: '직접 연결 도메인 추가',
        cancel: '취소',
        submitting: '추가 중…',
        // Content — placeholders that include hint text + hint copy.
        domainPlaceholder: 'api.example.com',
        upstreamPathPlaceholder: '/backend (선택)',
        targetPortPlaceholder: '{port} (컨테이너 포트)',
        targetPortPlaceholderNone: '서비스 컨테이너 포트',
        stripPrefixHint:
          '컨테이너로 전달하기 전에 경로 접두사를 제거합니다. 루트(/)가 아닌 경로에서 주로 필요합니다.',
      },
      delete: {
        // Chrome — modal chrome.
        title: '직접 연결 도메인 제거',
        confirm: '제거',
        cancel: '취소',
        // Content — confirmation prose.
        description:
          '직접 연결한 OpenLander 경로만 제거합니다. 외부 DNS 레코드는 그대로 유지됩니다.',
      },
      status: {
        // Chrome — status pills.
        active: '활성',
        pending: '대기',
        error: '오류',
      },
      toast: {
        added:
          '도메인 라우트가 등록되었습니다. Traefik 반영에는 몇 초 걸릴 수 있으며 DNS/TLS는 외부에서 관리합니다.',
        removed: '도메인 라우트가 제거되었습니다.',
        routingDisabled:
          '외부 인프라 모드에서는 OpenLander가 도메인 접속 경로를 관리하지 않습니다.',
        addFailed: '도메인 추가에 실패했습니다.',
        deleteFailed: '도메인 제거에 실패했습니다.',
        managedByPublicAccess:
          '외부 공유가 관리하는 경로입니다. 도메인을 지우지 말고 외부 공유를 해제하세요.',
      },
      error: {
        duplicate: '동일한 도메인과 경로 조합이 이미 존재합니다.',
        invalidDomain: '도메인 형식이 올바르지 않습니다.',
        invalidPath: '경로는 "/"로 시작해야 합니다.',
        invalidPort: '대상 포트는 1-65535 범위여야 합니다.',
        missingDomain: '도메인은 필수입니다.',
        invalidServiceKind: '도메인은 애플리케이션 또는 Compose 작업에만 연결할 수 있습니다.',
        serviceSelectionRequired:
          '프로젝트에 애플리케이션 또는 Compose 작업이 여러 개 있습니다. service_id를 사용하세요.',
        notFound: '매핑을 찾을 수 없습니다.',
        serverError: '서버 오류가 발생했습니다.',
      },
    },
  },
  rollback: {
    // Chrome — modal title + buttons + recommendation chip.
    title: '이전 버전으로 되돌리기',
    confirm: '되돌리기 확인',
    cancel: '취소',
    aiSuggestion: 'AI 제안',
    useSuggestion: '이 제안 사용',
    // Content — prompts + loading state + empty state.
    selectVersion: '롤백할 버전을 선택하세요',
    aiAnalyzing: 'AI가 롤백 대상을 분석 중...',
    noDeployments: '사용 가능한 배포가 없습니다',
  },
  blueGreen: {
    // Chrome — modal title + form label + buttons.
    title: '블루·그린 배포',
    healthCheckPath: '상태 확인 경로 (선택 사항)',
    confirm: '블루·그린 배포 시작',
    cancel: '취소',
    // Content — description + placeholder hint.
    description: '새 컨테이너의 상태를 확인한 뒤 트래픽을 전환해 서비스 중단을 방지합니다.',
    healthCheckPlaceholder: '/health 또는 /api/health',
  },
  deploy: {
    // Chrome — back link.
    backToDeployments: '배포 목록으로 돌아가기',
    triggerAction: {
      restart: '다시 시작',
      envUpdate: '환경 변수 변경',
      deploy: '배포',
      deployPlan: '배포 계획',
      chat: '에이전트 배포',
      webhook: '웹훅',
      api: 'API 호출',
    },
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
      title: '새 프로젝트 배포',
      projectName: '프로젝트 이름 (선택 사항)',
      parseAndMap: '분석 후 연결',
      matched: '일치',
      missing: '누락',
      extra: '추가',
      rePaste: '다시 붙여넣기',
      skipEnvVars: '건너뛰기 — 환경 변수 없이 배포',
      // Content — descriptive copy, errors, formatted counters.
      description: '배포할 저장소 URL을 입력하세요. OpenLander가 복제, 빌드, 실행을 처리합니다.',
      autoDetected: '저장소에서 자동으로 감지됨',
      failed: '프로젝트 배포 실패',
      // Chrome — dialog title.
      pasteEnvTitle: '환경 변수 붙여넣기',
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
      goBack: '뒤로',
      deployment: '배포',
      status: '상태',
      trigger: '실행 방식',
      statusValue: {
        success: '성공',
        failed: '실패',
        building: '빌드 중',
        cancelled: '취소됨',
      },
      triggerValue: {
        chat: '에이전트 실행',
        webhook: '웹훅 실행',
        api: 'API 호출',
      },
      started: '시작 시각',
      duration: '소요 시간',
      buildLogs: '빌드 로그',
      runtimeLogs: '실행 로그',
      // Content — hint copy.
      runtimeLogsHint: '(재배포 전 최근 500줄)',
    },
  },
  settings: {
    nav: {
      // Chrome — sub-nav label.
      general: '일반',
      permissions: '권한',
      ai: 'AI',
      data: '데이터',
    },
    general: {
      // Chrome — section title + form labels + buttons.
      title: '일반',
      displayName: '프로젝트 이름',
      slug: '프로젝트 식별자',
      projectDescription: '설명',
      tags: '태그',
      tagsPlaceholder: 'api, 운영',
      save: '변경 사항 저장',
      saving: '저장 중...',
      // Content — descriptive prose, hints, errors, success toasts.
      description: '프로젝트 이름과 설명을 수정합니다. 식별자는 바꿀 수 없습니다.',
      displayNameRequired: '표시 이름을 입력하세요.',
      slugHelp: '안정적인 URL, 컨테이너, Traefik 라벨, MCP project_name에 사용됩니다.',
      saved: '프로젝트 정보가 저장되었습니다.',
      saveFailed: '프로젝트 정보를 저장하지 못했습니다.',
    },
    github: {
      // Chrome — instruction label + status + CTA button + form label + link.
      enterCode: 'GitHub에 이 코드를 입력하세요:',
      waiting: '인증 대기 중...',
      connectWithGithub: 'GitHub 연결',
      enterToken: '개인용 액세스 토큰을 입력하세요:',
      generateToken: '토큰 발급 →',
      // Content — description.
      description: '비공개 저장소를 배포하려면 GitHub 계정을 연결하세요.',
      connectionTitle: 'GitHub 연결',
      reauthorizeTitle: 'GitHub 다시 인증',
      reauthorizeDescription: '새 인증이 성공하기 전까지 현재 GitHub 연결은 그대로 유지됩니다.',
      cancel: '취소',
      connectedAs: '{username} 계정으로 연결됨',
      disconnect: '연결 해제',
      openGithub: 'GitHub 열기',
      copied: '복사됨',
      copyCode: '코드 복사',
      or: '또는',
      connectToken: '토큰으로 연결',
      checkStatus: '상태 확인',
      connectFailed: 'GitHub에 연결하지 못했습니다.',
      disconnectFailed: 'GitHub 연결을 해제하지 못했습니다.',
    },
    data: {
      // Chrome — section title, status labels, and buttons.
      title: '데이터 조회 권한',
      enable: '읽기 권한 허용',
      disable: '읽기 권한 해제',
      saving: '저장 중…',
      status: {
        enabled: '사용',
        disabled: '사용 안 함',
        external: '설정 필요',
      },
      kind: {
        postgres: 'Postgres',
        redis: 'Redis',
        external: '외부',
      },
      // Content — descriptive copy and errors.
      description:
        '프로젝트에 속한 Postgres와 Redis 전체에 MCP 읽기 권한을 부여합니다. OpenLander는 에이전트에게 원본 인증 정보를 노출하지 않습니다.',
      boundaryTitle: '에이전트 조회는 정해진 범위에서 모두 기록됩니다',
      boundaryDescription:
        'Postgres는 public 스키마 전체를 조회할 수 있는 전용 읽기 계정을 사용합니다. Redis는 정해진 읽기 작업만 허용합니다. 조회 결과는 개수가 제한되며 저장하지 않습니다.',
      loading: '데이터 소스를 불러오는 중…',
      loadFailed: '데이터 소스를 불러오지 못했습니다.',
      saveFailed: '데이터 접근 설정을 변경하지 못했습니다.',
      emptyTitle: '관리형 데이터 소스가 없습니다',
      emptyDescription:
        '이 프로젝트에 관리형 Postgres 또는 Redis 리소스를 만들거나 연결하면 에이전트의 읽기 권한을 설정할 수 있습니다.',
      enabledDescription:
        '에이전트가 제한된 MCP 읽기 작업으로 이 데이터 소스 전체를 조회할 수 있습니다.',
      disabledDescription:
        '기본값으로 읽기 권한이 없습니다. 사용자가 허용하기 전에는 에이전트가 이 데이터 소스를 조회할 수 없습니다.',
      enableWarning:
        '켜면 조회 결과가 에이전트에게 전달됩니다. 결과 개수는 제한되고 저장되지 않지만, 허용된 읽기 작업으로 이 데이터 소스의 모든 테이블과 키를 볼 수 있습니다.',
      enableDecisionHint:
        '이 프로젝트의 에이전트가 데이터 소스 전체를 조회해도 되는 경우에만 켜세요.',
      auditHint:
        '에이전트 읽기는 활동 기록에 조회 해시, 작업, 결과 개수, 소요 시간과 함께 남습니다.',
      viewAudit: '감사 기록 보기',
      factScopeLabel: '읽기 범위',
      factScopeValue: '전체 데이터 소스',
      readableScope: {
        postgres: 'public 스키마의 모든 테이블',
        redis: '읽기 전용 작업으로 전체 키 조회',
        default: '전체 데이터 소스',
      },
      factCredentialLabel: '인증 정보',
      factCredentialValue: '에이전트에게 공개하지 않음',
      factAuditLabel: '감사 기록',
      factAuditValue: '모든 읽기 기록',
      enableConfirmTitle: '에이전트에게 읽기 권한을 허용할까요?',
      enableConfirmDescription:
        '{name} 전체를 제한된 MCP 읽기 작업으로 조회할 수 있게 됩니다. 에이전트에게 인증 정보는 노출하지 않고 쓰기 작업은 계속 차단합니다. 조회 결과는 개수가 제한되고 저장되지 않으며 모든 조회는 활동 기록에 남습니다.',
      enableConfirm: '읽기 권한 허용',
      externalDescription:
        '외부 데이터 소스는 별도의 읽기 전용 연결을 설정한 뒤 에이전트 조회를 지원합니다.',
      relationship: {
        managed: '관리형 데이터 소스',
        external: '외부 환경 변수',
      },
      health: {
        healthy: '정상',
        crashed: '중단됨',
        deploying: '배포 중',
      },
    },
  },
  services: {
    status: {
      // Chrome — status pills.
      running: '실행 중',
      stopped: '중지됨',
      error: '오류',
    },
    managedDetail: {
      // Content — error titles + subtitle.
      notFound: '리소스를 찾을 수 없습니다',
      loadFailed: '리소스를 불러오지 못했습니다',
      notFoundSubtitle: 'id "{id}"에 해당하는 리소스가 없습니다',
      // Chrome — back-navigation links.
      backToProjects: '← 프로젝트 목록으로 돌아가기',
      backToProject: '← 프로젝트로 돌아가기',
      tabs: {
        aria: '서비스 섹션',
        overview: '개요',
        logs: '로그',
        connections: '연결',
      },
      logs: {
        title: '컨테이너 로그',
        description: '리소스 컨테이너의 런타임 로그입니다.',
        refresh: '새로고침',
        loading: '불러오는 중…',
        empty: '반환된 로그가 없습니다.',
        error: '로그를 불러오지 못했습니다',
      },
      connections: {
        title: '연결된 프로젝트',
        description: '이 리소스를 참조하는 프로젝트입니다.',
        refresh: '새로고침',
        loading: '불러오는 중…',
        empty: '이 리소스에 연결된 프로젝트가 없습니다.',
        deferredTitle: '애플리케이션 연결 대기 중',
        deferredDescription:
          '이 리소스는 프로젝트에 속해 있습니다. 첫 애플리케이션 또는 Compose 워크로드가 추가되면 런타임 연결이 완료됩니다.',
        openProject: '프로젝트 열기',
        openOwningProject: '소유 프로젝트 열기',
        error: '연결된 프로젝트를 불러오지 못했습니다.',
      },
      credentials: {
        title: '인증 정보',
        description: '명시적으로 표시하기 전까지 인증 정보를 숨깁니다.',
        reveal: '인증 정보 표시',
        hide: '인증 정보 숨기기',
        empty: '이 리소스에 저장된 인증 정보가 없습니다.',
        error: '인증 정보를 표시하지 못했습니다',
      },
      settings: {
        lifecycle: '수명 주기',
        lifecycleDescription: '저장된 데이터는 유지한 채 컨테이너를 시작하거나 중지합니다.',
        start: '시작',
        starting: '시작 중…',
        stop: '중지',
        stopping: '중지 중…',
        updated: '리소스 상태가 업데이트되었습니다.',
        actionError: '리소스 작업에 실패했습니다',
        deleteBody: '이 리소스 컨테이너와 영구 볼륨을 삭제합니다.',
        delete: '리소스 삭제',
        deleting: '삭제 중…',
        confirmTitle: '데이터베이스·캐시·스토리지 리소스 삭제',
        confirmDescription:
          '리소스 컨테이너, 저장된 인증 정보, 영구 볼륨을 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
        confirmLabel: '삭제하려면 이 리소스 이름을 입력하세요:',
        confirmDelete: '영구 삭제',
        deleteError: '리소스를 삭제하지 못했습니다',
        deleteBlocked:
          '프로젝트 {count}개가 이 리소스를 참조하고 있어 삭제할 수 없습니다. 먼저 연결을 해제하세요.',
        connectionCheckFailed: '연결 상태를 확인하지 못해 삭제가 차단되었습니다.',
      },
      // Chrome — field labels match the services.detail.overview.*
      // convention (English in both files for metric / field labels).
      field: {
        type: '유형',
        status: '상태',
        image: '이미지',
        port: '포트',
        container: '컨테이너',
        containerId: '컨테이너 ID',
        created: '생성 시각',
        updated: '수정 시각',
      },
      kind: {
        postgres: 'PostgreSQL',
        mysql: 'MySQL',
        redis: 'Redis',
        mongo: 'MongoDB',
        neo4j: 'Neo4j',
        minio: 'MinIO',
      },
    },
    detail: {
      // Content — empty state.
      notFound: '애플리케이션을 찾을 수 없습니다',
      // Content — error-card subtitles explaining why the Application wasn't found.
      notFoundReason: {
        noProjectParam:
          '애플리케이션은 프로젝트 페이지에서 열어주세요. /services/{id} 직접 링크에는 ?project= 쿼리 매개변수가 필요합니다.',
        serviceNotInProject: '프로젝트 "{projectId}"에 애플리케이션 "{id}"가 없습니다.',
      },
      // Chrome — back-navigation link.
      backToHome: '← 홈으로 돌아가기',
      section: {
        // Chrome — SubCard section headings.
        source: '소스',
        build: '빌드',
        runtime: '실행 상태',
        domains: '도메인',
      },
      runtime: {
        // Content — button tooltip/aria-label prose.
        copyUrl: 'URL 복사',
        openInNewTab: '새 탭에서 열기',
        // Chrome — short field labels match overview.* convention
        // (English in both files for metric / field labels).
        publicUrlLabel: '접속 URL',
        cpuLabel: 'CPU',
        memLabel: '메모리',
        // Content — descriptive sub captions.
        cpuSub: '현재 사용량',
        memSub: '현재 사용량',
      },
      source: {
        // Content — empty state on the Source SubCard.
        empty: '구성된 소스가 없습니다.',
        containerImage: '컨테이너 이미지',
        field: {
          provider: '저장소 서비스',
          repository: '저장소',
          source: '소스',
          branch: '브랜치',
          deployedBranch: '배포된 브랜치',
          buildPath: '빌드 경로',
          image: '이미지',
        },
      },
      build: {
        // Content — Build SubCard prose, split into two parts so the
        // monospace `openlander_deploy.create_deploy_plan` identifier
        // can render as a JSX <span> between them.
        prosePart1: '빌드 방식은 배포할 때마다 자동으로 감지합니다. 에이전트에서 설정을 바꾸려면',
        prosePart2: '로 Dockerfile 경로, 대상 단계, 빌드 컨텍스트를 지정하세요.',
        methodValue: {
          image: '이미지',
          automatic: '자동 감지',
        },
        field: {
          method: '방식',
          dockerfile: 'Dockerfile',
          targetStage: '대상 단계',
          buildContext: '빌드 컨텍스트',
        },
      },
      envVars: {
        // Chrome — short form-input placeholders, terse.
        keyPlaceholder: 'KEY',
        valuePlaceholder: '값',
      },
      charts: {
        // Chrome — metric chart titles + abbreviations.
        cpu: 'CPU',
        memory: '메모리',
        requestsPerSec: '초당 요청 수',
        errorRate: '오류율',
        // Content — chart sub-captions describing the range.
        avgOverRange: '{range} 평균',
        p95Line: 'p95: {value} · {range}',
        errorRateSub: 'HTTP 5xx · 지난 1시간',
      },
      // Content — a11y label for the time-range select.
      timeRangeAria: '시간 범위',
      tabs: {
        // UI — navigation tabs.
        overview: '개요',
        logs: '로그',
        deployments: '배포',
        monitoring: '모니터링',
        ai: 'AI',
        environment: '환경 변수',
        domains: '도메인',
        // Legacy keys retained for Database/Cache/Storage tabs that have not
        // moved to the new v0.1 tab strip yet.
        connection: '연결 정보',
        databases: '데이터베이스',
        settings: '설정',
      },
      toasts: {
        // Content — toast prose.
        started: '애플리케이션을 시작했습니다',
        stopped: '애플리케이션을 중지했습니다',
        deleted: '애플리케이션을 삭제했습니다',
        startFailed: '애플리케이션을 시작하지 못했습니다',
        stopFailed: '애플리케이션을 중지하지 못했습니다',
        deleteFailed: '애플리케이션을 삭제하지 못했습니다',
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
        backToServices: '리소스 목록으로 돌아가기',
        start: '시작',
        stop: '중지',
        delete: '삭제',
      },
      // Chrome — refresh button.
      refresh: '새로고침',
      // Content — loading / empty / format strings.
      loadingDatabases: '데이터베이스 로딩 중...',
      serviceIsStopped: '애플리케이션이 중지되었습니다',
      serviceStoppedHint: '로그를 보려면 애플리케이션을 시작하세요.',
      showingLast: '최근',
      noProjectsUsing: '이 리소스를 사용하는 프로젝트가 없습니다',
      // Chrome — dropdown labels.
      selectDatabase: '데이터베이스 선택',
      selectVersion: '버전 선택',
      // Content — loading / empty.
      loadingLogs: '로그 로딩 중...',
      noLogsAvailable: '표시할 로그가 없습니다',
      linesCount: '{count}줄',
      overview: {
        // Chrome — KPI tile labels.
        status: '상태',
        container: '컨테이너',
        cpu: 'CPU',
        memory: '메모리',
        network: '네트워크',
        volume: '볼륨',
        connections: '연결',
        connectedProjects: '연결된 프로젝트',
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
    codeBlock: '[코드 블록]',
    unnamedTool: '도구',
    expandEvent: '이벤트 펼치기',
    collapseEvent: '이벤트 접기',
    deployToSee: '에이전트 타임라인을 보려면 이 프로젝트를 배포하세요.',
    awaitingInstruction: '다음 지시 대기 중...',
    aiWorking: 'AI가 작업 중입니다...',
    typeAnswer: '직접 답변 입력...',
    questionAnswered: '질문에 답변했습니다',
    submit: '답변 제출',
    skip: '건너뛰기',
    arguments: '호출 인자 ▾',
    buildLog: '빌드 로그 ▾',
    tokenCount: '토큰 {count}개',
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
      title: '빌드 오류 분석',
      viewDetails: '원본 정보 보기 ▾',
      rootCause: '근본 원인',
      suggestedFixes: '해결 방법 제안',
      confidence: '신뢰도',
      viewLogs: '로그 보기',
      hideLogs: '로그 숨기기',
      applyFix: '수정 적용',
      applying: '적용 중...',
      // Content — empty state + error toast.
      noFixes: '구체적인 해결책이 반환되지 않았습니다.',
      fixFailed: 'AI로 수정 실패',
    },
    fixProposal: {
      // Chrome — section title + diff labels + action buttons.
      title: '수정 제안',
      changes: '변경 사항',
      diff: '제안된 변경 사항',
      approve: '승인 후 적용',
      reject: '거절',
      showAlternatives: '다른 방법 보기',
      before: '변경 전',
      after: '변경 후',
      skip: '건너뛰기',
      // Content — status toast.
      answered: '수정 제안에 답변함',
    },
    composeError: {
      // Chrome — section title + form label + badge + selection label.
      title: 'Compose 오류 감지',
      selectPattern: '적용할 해결 방법 선택',
      envVarsOptional: '환경 변수 (선택 사항)',
      recommended: '권장',
      // Content — status toast.
      answered: 'Compose 수정에 답변함',
    },
  },
  share: {
    // Chrome — modal title + form label + buttons.
    title: '프로젝트 공유',
    accessCode: '접속 코드',
    generate: '발급',
    shareButton: '접속 코드로 공유',
    stopSharing: '공유 중지',
    copyInvitation: '초대 문구 복사',
    copied: '복사됨!',
    // Content — hints and notices.
    accessCodeHint: '최소 4자. 이 코드가 있으면 누구나 프로젝트에 접근할 수 있습니다.',
    alreadyShared: '이 프로젝트는 현재 공유 중입니다.',
    notRunning: '공유하려면 프로젝트가 실행 중이어야 합니다.',
  },
  prPreviews: {
    noPreviews: 'PR 미리보기 없음',
    description: 'PR을 열면 미리보기가 자동으로 생성됩니다.',
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
    retryStream: '로그 스트림 다시 연결',
    clearFilters: '필터 초기화',
    console: {
      searchPlaceholder: '로그 검색…',
      clear: '지우기',
      live: '실시간',
      jumpToLatest: '최신 로그로 이동',
      loadOlder: '이전 로그 불러오기',
      loadingOlder: '이전 로그 불러오는 중…',
      disconnected: '연결 끊김',
      connecting: '연결 중',
      lines: '줄',
      followMode: {
        follow: '자동 스크롤',
        paused: '스크롤 멈춤',
      },
      searchMode: {
        text: '텍스트 검색',
        regex: '정규식 검색',
      },
      logLevel: {
        all: '모든 레벨',
        error: '오류',
        warn: '경고',
        info: '정보',
        debug: '디버그',
        plain: '일반',
      },
    },
    terminalReadyBadge: '준비됨',
    // Content — terminal state titles + bodies.
    terminalReadyTitle: '터미널 준비 완료',
    terminalReadyBody: '셸이 열려 있어도 로그는 계속 실시간으로 표시됩니다.',
    terminalStandbyBadge: '대기',
    terminalStandbyTitle: '터미널 대기 중',
    terminalStandbyBody: '로그는 계속 스트리밍됩니다. 셸을 다시 연결하려면 콘솔 탭을 여세요.',
    terminalUnavailableBadge: '사용할 수 없음',
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
    terminalErrorBody: '셸 세션 시작에 실패했습니다. 다시 연결한 뒤 시도하세요.',
    terminalDisconnected: '셸 연결 끊김',
    terminalDisconnectedBody: '셸 세션이 종료되었습니다. 다시 연결하여 새 셸을 여세요.',
    terminalReconnect: '셸 다시 연결',
    terminalToggle: {
      hide: '터미널 숨기기',
      show: '터미널 보기',
      hideTitle: '셸을 숨기고 로그만 표시',
      showTitle: '실시간 로그 옆에 셸 표시',
      showAvailabilityTitle: '터미널 상태와 사용 가능 여부 보기',
    },
    terminalStream: {
      connected: '컨테이너에 연결됨',
      closed: '연결 종료됨',
      connectionError: '연결 오류',
    },
    terminalServerError: {
      generic: '터미널 요청을 완료하지 못했습니다',
      codes: {
        UNAUTHORIZED: '터미널을 열려면 다시 로그인하세요',
        FORBIDDEN: '허용되지 않은 터미널 연결입니다',
        CONTAINER_NOT_RUNNING: '컨테이너가 실행 중이 아닙니다',
        SHELL_UNAVAILABLE: '이 컨테이너에는 대화형 셸이 없습니다',
        TERMINAL_IDLE_TIMEOUT: '30분 동안 입력이 없어 터미널 연결을 종료했습니다',
        TERMINAL_OPEN_FAILED: '터미널 세션을 열지 못했습니다',
        RATE_LIMIT_EXCEEDED: '터미널 입력이 너무 빠르게 전송되었습니다',
      },
    },
  },
  command: {
    // Chrome — command palette entries (action labels).
    noResults: '결과 없음',
    deployNewRepo: '새 저장소 배포',
    triggerFreshDeploy: '새로 배포',
    stopContainer: '실행 중인 컨테이너 중지',
    dashboard: '프로젝트 현황으로 이동',
    webServer: '웹 서버',
    gitProviders: 'Git 연결',
    goToProject: '{name} 프로젝트로 이동 ({status})',
    projectActivity: '활동: {name}',
    projectActivityDescription: '프로젝트의 배포, 설정 변경, 에이전트 호출 기록',
    newProject: '새 프로젝트',
    group: {
      recent: '최근 사용',
      navigation: '탐색',
      projects: '프로젝트',
      system: '시스템',
    },
    keyboard: {
      navigate: '이동',
      select: '선택',
      close: '닫기',
    },
    // Content — placeholder hint.
    searchPlaceholder: '명령어 입력 또는 검색...',
  },
  oauth: {
    // Content — error toast.
    startFailed: '인증 시작 실패',
    // Chrome — label preceding provider name.
    signInWith: '다음 계정으로 로그인',
    // Content — notice.
    personalDevOnly: '⚠ 개인 개발 목적으로만 구독을 사용하세요.',
  },
  providerHelp: {
    anthropic: {
      // Content — conversational heading + instruction.
      usingClaudeCode: 'Claude Code를 사용 중이신가요?',
      inTerminal: '명령어를 실행하여 토큰을 얻은 다음 아래에 붙여넣으세요.',
      // Chrome — link label.
      learnMore: 'Anthropic API 자세히 알아보기',
    },
    gemini: {
      // Content — conversational heading + description.
      needKey: 'Gemini API 키가 필요하신가요?',
      freeTier: 'Google은 Gemini 모델에 대해 넉넉한 무료 티어를 제공합니다.',
      // Chrome — link label.
      getFreeKey: 'Google AI Studio에서 무료 API 키 받기',
    },
  },
  project: {
    tabs: {
      // Chrome — primary nav tabs.
      overview: '개요',
      deployments: '배포',
      recovery: '복구',
      runtime: '실행 상태',
      settings: '설정',
    },
    confirm: {
      // Chrome — modal buttons.
      // Chrome — modal buttons + titles.
      confirm: '확인',
      cancel: '취소',
      stopTitle: '프로젝트 중지',
      deleteTitle: '프로젝트 삭제',
      // Content — confirmation prose.
      stopDescription: '이 프로젝트를 중지하시겠습니까?',
      deleteDescription: '이 프로젝트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
    },
    header: {
      status: {
        // Chrome — status pills.
        live: '실행 중',
        stopped: '중지됨',
        deploying: '배포 중',
        pulling: '이미지 가져오는 중',
        failed: '실패',
        idle: '대기',
      },
      action: {
        // Chrome — action buttons.
        deploy: '배포',
        deploying: '배포 중...',
        pulling: '이미지 가져오는 중...',
        start: '시작',
        redeploy: '재배포',
        pullRestart: '이미지를 받아 다시 시작',
        stop: '중지',
        rollback: '이전 버전으로 되돌리기',
        blueGreen: '블루·그린 배포',
        more: '추가 작업',
        // Content — tooltip prose (hover, descriptive).
        aiPipelineTooltip: 'OpenLander가 배포 파이프라인을 처리합니다',
        pipelineTooltip: 'OpenLander가 배포 파이프라인을 처리합니다',
      },
      share: {
        // Chrome — buttons + status.
        share: '공유',
        shared: '공유됨',
        exposed: '외부 공개',
      },
    },
    // Chrome — action labels.
    disconnectService: '서비스 연결 해제',
    copyUrl: 'URL 복사',
  },
  approval: {
    banner: {
      // Chrome — field labels + buttons.
      project: '프로젝트',
      tool: '도구',
      attempt: '시도',
      approve: '승인',
      reject: '거절',
      // Content — banner title + result + error text.
      title: '복구 승인 필요',
      approved: '복구가 승인되었습니다',
      rejected: '복구가 거부되었습니다',
      error: '승인 처리에 실패했습니다',
      timedOut: '승인 시간 초과',
    },
    pendingStrip: {
      cleanupStop: '여러 앱 정지',
      cleanupDelete: '여러 앱 삭제',
      // Chrome — source labels + buttons.
      mcpSource: 'MCP',
      recoverySource: '복구',
      details: '상세 정보:',
      actor: '요청자:',
      review: '검토',
      hide: '숨기기',
      approve: '승인',
      reject: '거절',
      // Content — strip title + body + result + error + format.
      title: '에이전트 작업이 승인을 기다리고 있습니다',
      summaryOne: '승인이 필요한 에이전트 작업 1개',
      summaryMany: '승인이 필요한 에이전트 작업 {count}개',
      body: 'OpenLander가 실행하기 전에 위험 MCP 작업을 검토하세요.',
      loadWarning: '승인 대기 목록을 새로고침하지 못했습니다. 마지막으로 확인된 요청을 표시합니다.',
      approved: '승인했습니다',
      rejected: '거절했습니다',
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
    incidentHistory: '장애 이력',
    postmortems: '장애 회고',
    pendingApprovals: '승인 대기',
    activeRecovery: '진행 중인 복구',
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
    retry: '다시 시도',
    approve: '승인',
    reject: '거절',
    postmortemReport: '장애 회고 보고서',
    attempt: '시도',
  },
  approvalsTab: {
    // Chrome — labels + buttons.
    requested: '요청 시각',
    approve: '승인',
    reject: '거절',
    // Content — empty state.
    noPendingApprovals: '대기 중인 승인이 없습니다',
    emptyMessage: '승인 요청이 검토가 필요할 때 여기에 표시됩니다.',
  },
  postmortemsTab: {
    // Chrome — entry labels.
    postmortem: '장애 회고',
    generated: '생성 시각',
    // Content — empty state.
    noPostmortems: '아직 장애 분석이 없습니다',
    emptyMessage:
      '성공적인 복구 후 보고서가 자동 생성됩니다. 메모리에 보관되며 서버 재시작 시 초기화됩니다.',
  },
  patternsTab: {
    // Chrome — table column labels.
    patternType: '패턴 종류',
    errorSignature: '오류 식별 정보',
    fixAction: '수정 작업',
    successFailure: '성공 / 실패',
    lastSeen: '최근 발견',
    unknown: '알 수 없음',
    // Content — empty state.
    noPatterns: '아직 학습된 패턴이 없습니다',
    emptyMessage: '플랫폼이 오류를 만나고 해결할 때마다 패턴이 누적됩니다.',
  },
  usageTab: {
    // Chrome — KPI + table column labels.
    totalCost: '총비용',
    totalTokens: '총 토큰',
    in: '입력',
    out: '출력',
    totalCalls: '총 호출',
    recentActivity: '최근 활동',
    time: '시각',
    action: '작업',
    model: '모델',
    tokens: '토큰',
    cost: '비용',
    // Content — empty states.
    noUsage: '내장 사용 기록이 없습니다',
    emptyMessage: '이 기능이 활성화되면 사용 데이터가 표시됩니다.',
    noRecentActivity: '최근 활동이 없습니다',
  },
  mcpServer: {
    // UI — page title.
    title: '내 에이전트',
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
      revealing: '불러오는 중…',
      hide: '숨기기',
      revealFailed: '토큰을 불러오지 못했습니다',
      revealUnavailable:
        '이전에 발급한 토큰은 복구할 수 없습니다. 한 번 재발급하면 이후에는 언제든 다시 볼 수 있습니다.',
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
        '이전에 사용하던 API 토큰(ol_…)이 이번 변경과 함께 무효화되었습니다. 해당 토큰을 사용 중인 MCP 클라이언트가 있다면 갱신해 주세요.',
      revealedHint: '비밀번호처럼 취급하세요. 복사가 끝나면 다시 숨겨두세요.',
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
      tryPrompt: '{name}에 이 프로젝트를 배포해 줘',
      tryHelp:
        '서버 이름을 같이 말하면 여러 OpenLander 서버가 연결되어 있어도 AI가 올바른 서버를 선택하기 쉽습니다.',
      troubleshootingTitle: 'AI가 Docker나 SSH로 진행하려고 하나요?',
      troubleshootingHint: '그럴 때만 아래 문장을 한 번 붙여넣으세요.',
      copyCorrection: '수정 요청문 복사',
    },
    setup: {
      // UI — section title + action.
      title: '설정',
      copyConfig: '설정 복사',
      copyNeedsGenerate: '토큰 발급 후 복사',
      copyNeedsRegenerate: '재발급 후 복사',
      copyNeedsReveal: '토큰 표시 후 복사',
      // Content — descriptive copy.
      subtitle: '클라이언트를 선택하고 설정 스니펫을 붙여넣으세요.',
      restartHint: '저장 후 클라이언트를 재시작하세요. 첫 호출 시 위 상태가 연결됨으로 바뀝니다.',
      placeholderHint: '토큰을 발급하기 전까지는 예시에 <your-token> 자리표시자가 사용됩니다.',
      revealToCopyHint: '실제 토큰이 포함된 설정을 복사하려면 토큰을 표시하세요.',
    },
    recent: {
      // UI — section title + link affordance.
      title: '최근 에이전트 호출',
      fullTimeline: '전체 활동 보기',
      // Content — descriptive copy and empty-state message.
      subtitle: 'MCP 호출 이벤트만 표시합니다. 전체 기록은 활동 화면에서 확인하세요.',
      empty: '아직 에이전트 호출이 없습니다. MCP 배포·접속이 여기에 표시됩니다.',
    },
  },
  webServer: {
    // Chrome — section title.
    title: '웹 서버',
    // Content — descriptive copy.
    subtitle: '이 서버의 외부 공유, 라우트와 포트를 관리합니다.',
    dockerUnavailable: 'Docker가 응답하지 않습니다. 라우트와 포트 정보가 최신이 아닐 수 있습니다.',
    footer: '호스트 라우팅 현황입니다.',
    protectedShare: {
      title: '직접 보호 공유',
      subtitle:
        '기본 방식입니다. 이 서버의 공인 IP로 연결해 HTTPS URL과 접근 코드 하나로 공유합니다.',
      recommended: '기본 · 권장',
      publicHost: '공개 IPv4 또는 기본 도메인',
      publicHostPlaceholder: '34.64.12.34 또는 share.example.com',
      publicHostHelp:
        'IPv4를 입력하면 무료 sslip.io 주소를 만듭니다. 링크가 유지되도록 고정 외부 IP를 사용하세요.',
      acmeEmail: 'ACME 연락처 이메일',
      acmeEmailHelp:
        '이 OpenLander 서버에 한 번 저장하고 Let’s Encrypt 등록에 사용합니다. 인증서나 방문자 화면에는 표시되지 않습니다.',
      certificateSettings: '고급 인증서 설정',
      certificateSettingsMissing: '연락처 이메일이 설정되지 않음',
      certificateSettingsRequired: '설정을 적용하려면 ACME 연락처 이메일을 입력하세요.',
      useDetectedIp: '감지된 GCP 주소 {ip} 사용',
      securityNote:
        '방화벽에서는 80·443 포트만 열면 됩니다. 애플리케이션 포트는 비공개로 유지되고 공유한 앱마다 접근코드 화면이 생깁니다.',
      securityPolicy:
        '보안 정책: {minutes}분당 {attempts}회 시도 · 세션 {days}일 후 만료 · 코드 변경 시 기존 방문자 로그아웃',
      managedRequired: '보호된 외부 공유는 현재 OpenLander 관리형 Traefik에서만 지원합니다.',
      save: '설정 저장',
      saving: '저장 중…',
      saved: '설정을 저장했습니다. 애플리케이션을 공유할 때 HTTPS를 시작합니다.',
      loadFailed: '보호 공유 설정을 불러오지 못했습니다.',
      saveFailed: '보호 공유 설정을 저장하지 못했습니다.',
      activeShares: '공개 중인 앱',
      activeSharesDescription: '이 서버에서 직접 공유 중인 애플리케이션을 한곳에서 관리합니다.',
      noActiveShares: '현재 직접 공유 중인 애플리케이션이 없습니다.',
      copyUrl: 'URL 복사',
      urlCopied: '공개 URL을 복사했습니다.',
      copyFailed: '클립보드에 복사하지 못했습니다.',
      rotateCode: '새 접근 코드 생성',
      rotateTitle: '새 접근 코드를 생성할까요?',
      rotateDescription: '현재 코드와 로그인된 모든 방문자 세션이 즉시 만료됩니다.',
      rotateConfirm: '새 코드 생성',
      codeRotated: '새 접근 코드를 생성했습니다.',
      rotateFailed: '새 접근 코드를 생성하지 못했습니다.',
      newCodeTitle: '새 접근 코드',
      newCodeDescription:
        '{application}에 전달할 코드를 복사하세요. 이 창을 닫으면 OpenLander에서 다시 확인할 수 없습니다.',
      codeCopied: '접근 코드를 복사했습니다.',
      stopShare: '외부 공유 중지',
      stopTitle: '외부 공유를 중지할까요?',
      stopDescription:
        '{hostname} 주소에 더 이상 접근할 수 없습니다. 나중에 같은 URL로 다시 공유할 수 있습니다.',
      stopConfirm: '외부 공유 중지',
      shareStopped: '외부 공유를 중지했습니다.',
      stopFailed: '외부 공유를 중지하지 못했습니다.',
    },
    publicAccess: {
      title: 'Cloudflare 터널',
      subtitle:
        '선택 사항입니다. 80·443 포트를 열기 어렵거나 보유 도메인으로 공유할 때 사용합니다.',
      optional: '선택 사항',
      connected: '연결됨',
      disconnected:
        '인바운드 포트를 열지 않고 연결된 Cloudflare 도메인으로 애플리케이션을 공개할 수 있습니다.',
      securityNote:
        'Cloudflare 방식에는 OpenLander 접근 코드 화면이 적용되지 않습니다. 인증이 필요하면 Cloudflare Access를 별도로 구성하세요.',
      unavailable:
        '이 빌드에는 Cloudflare OAuth 설정이 없습니다. 배포용 OAuth 클라이언트를 먼저 설정하세요.',
      connect: 'Cloudflare 연결',
      connecting: '연결 중…',
      finish: '연결 완료',
      account: '계정',
      zone: '도메인',
      connector: '연결 상태',
      running: '정상',
      needsAttention: '확인 필요',
      repair: '연결 복구',
      repairedToast: 'Cloudflare 연결을 복구했습니다.',
      repairFailed: 'Cloudflare 연결을 복구하지 못했습니다.',
      selectAccount: '계정 선택',
      selectZone: '도메인 선택',
      connectedToast: 'Cloudflare를 연결했습니다.',
      connectFailed: 'Cloudflare 연결을 완료하지 못했습니다.',
      oauthFailed: 'Cloudflare 로그인을 완료하지 못했습니다.',
      cloudflareUnreachable:
        'OpenLander 서버에서 Cloudflare에 연결할 수 없습니다. 서버 네트워크를 확인한 뒤 다시 시도하세요.',
      zonesFailed: 'Cloudflare DNS Zone을 불러오지 못했습니다.',
      moreActions: 'Cloudflare 연결 작업',
      reconnect: '다시 연결',
      disconnect: '연결 해제',
      disconnectTitle: 'Cloudflare 연결을 해제할까요?',
      disconnectDescription:
        '모든 프로젝트 공개 URL이 중지됩니다. OpenLander가 만든 DNS 레코드, Tunnel, 커넥터와 저장된 토큰을 정리하며 사용자가 만든 Cloudflare OAuth 앱은 유지합니다.',
      disconnectConfirm: 'Cloudflare 연결 해제',
      disconnectedToast: 'Cloudflare 연결을 해제했습니다.',
      disconnectNeedsReconnect:
        'Cloudflare 인증이 만료되었습니다. 다시 연결한 뒤 연결 해제를 진행하세요.',
      disconnectFailed: 'Cloudflare 연결을 안전하게 해제하지 못했습니다.',
    },
    strip: {
      // Chrome — short labels + status pills.
      proxy: '프록시',
      routes: '접속 경로',
      entrypoints: '진입점',
      allHealthy: '모두 정상',
      unknown: '상태 확인 불가',
      // Content — formatted display.
      issuesCount: '문제 {count}건',
      lastReload: '{when} 재로드',
    },
    proxy: {
      // Chrome — status pills double as ProxyStatusCode log values.
      checking: '확인 중…',
      unknown: '알 수 없음',
      // src/web/api/web-server-routes.ts의 `ProxyStatusCode` union과
      // 동기화. 구버전 백엔드에서는 언어와 무관한 기존 필드로 같은 코드를
      // 계산해 표시합니다.
      statusCode: {
        docker_unavailable: 'Docker에 연결할 수 없음',
        no_proxy_managed: '프록시 없음 · OpenLander가 Traefik을 시작합니다',
        no_proxy_external: '프록시가 감지되지 않음',
        traefik_managed: 'Traefik{versionLabel}',
        traefik_external: 'Traefik{versionLabel} (외부 관리)',
        traefik_provider_disabled: 'Traefik · Docker 연동 꺼짐',
        unsupported_proxy: '{type} (연동 안 됨)',
      },
    },
    issues: {
      // Content — formatted alert title + sentence-shape diagnostic codes.
      title: '접속 경로 문제 {count}건이 발견되었습니다',
      unknown: '접속 경로 문제를 확인하세요',
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
      title: '웹 서버 설정 확인 필요',
      unknown: '웹 서버 설정을 확인하세요',
      codes: {
        advertised_host_missing:
          '직접 접속과 LAN 접속 주소가 설정되지 않았습니다. 해당 경로가 필요하면 OPENLANDER_PUBLIC_HOST를 LAN IP나 도메인으로 설정하세요. Cloudflare 프로젝트 공개에는 영향이 없습니다.',
      },
    },
    routes: {
      // Chrome — section title + table headers.
      title: '감지된 라우트',
      col: {
        host: '접속 주소',
        service: '서비스',
        port: '포트',
        tls: 'TLS',
        status: '상태',
      },
      // Content — descriptive copy + loading / empty messages.
      subtitle:
        'OpenLander가 감지한 읽기 전용 접속 경로 상태입니다. 사용자 도메인은 애플리케이션 상세 화면의 도메인 탭에서 추가하거나 삭제하세요.',
      loading: '라우트를 불러오는 중…',
      loadFailed: '라우트를 불러오지 못했습니다.',
      empty:
        '아직 감지된 공개 접속 경로가 없습니다. 애플리케이션을 외부에 공개하거나 애플리케이션 상세 화면의 도메인 탭에서 사용자 도메인을 추가하세요.',
    },
    ports: {
      // Chrome — section title + table headers + status pills.
      title: '포트 할당',
      unmanaged: '관리 안 됨',
      col: {
        service: '서비스',
        hostPort: '포트',
        environment: '환경 변수',
      },
      env: {
        production: '운영',
        development: '개발',
        outside: '할당 범위 밖',
      },
      // Content — summary + loading / empty messages.
      summary: '호스트 포트 {count}개가 사용 중',
      loading: '포트 할당을 불러오는 중…',
      loadFailed: '포트 할당을 불러오지 못했습니다.',
      empty: '아직 포트 할당이 없습니다.',
    },
    external: {
      // Chrome — section title.
      title: '외부 컨테이너',
      // Content — summary + loading / empty messages.
      summary: '호스트에서 {count}개 실행 중',
      empty: '감지되지 않음',
      loading: '외부 컨테이너를 불러오는 중…',
      loadFailed: '외부 컨테이너를 불러오지 못했습니다.',
    },
    tls: {
      // Chrome — status pills.
      ok: '정상',
      expiring: '곧 만료',
      invalid: '유효하지 않음',
      absent: 'TLS 없음',
      unknown: '확인 필요',
    },
    status: {
      // Chrome — status pills.
      healthy: '정상',
      warning: '경고',
      error: '오류',
      inactive: '비활성',
    },
  },
  gitProviders: {
    // Chrome — page title.
    title: 'Git 연결',
    // Content — descriptive subtitle.
    subtitle: 'v0.1에서는 GitHub만 지원합니다.',
    github: {
      // Chrome — card title (brand name stays English everywhere).
      cardTitle: 'GitHub',
      // Chrome — action buttons + menu labels.
      manageOnGithub: 'GitHub에서 관리',
      moreActionsLabel: '추가 작업',
      reauthorize: '다시 인증',
      refreshRepoList: '연결 확인',
      disconnect: '연결 해제',
      // Content — confirmation prose.
      disconnectConfirm: {
        title: 'GitHub 연결을 해제할까요?',
        description:
          'OpenLander가 GitHub 저장소에 접근할 수 없게 됩니다. 이미 배포된 애플리케이션은 계속 동작하지만 비공개 저장소의 새 배포는 다시 연결할 때까지 실패합니다.',
        confirmLabel: 'GitHub 연결 해제',
      },
      authMethod: {
        // Chrome — method labels.
        oauth: 'OAuth',
        pat: '개인용 액세스 토큰',
        unknown: '알 수 없음',
      },
      pip: {
        // Chrome — status pills.
        connected: '연결됨',
        invalid: '토큰 거부됨',
        unknown: '상태 확인 불가',
        disconnected: '연결 안 됨',
      },
      stats: {
        // Chrome — KPI labels.
        reposLinked: 'OpenLander에서 사용 중',
        lastSync: '최근 동기화',
        connectedOn: '연결 시각',
        scopes: 'OAuth 권한',
      },
      // Content — descriptive notices.
      scopesEmpty: '보고된 권한 없음',
      scopesUnavailableForPat: '권한 정보는 GitHub OAuth에서만 제공됩니다',
      // Chrome — status indicator.
      pendingFirstSync: '첫 동기화 대기',
      empty: {
        // Chrome — empty state CTA button + heading.
        title: 'GitHub 연결',
        // Content — empty state body.
        body: 'OpenLander가 저장소를 읽을 수 있도록 인증하세요. 배포, 웹훅, 애플리케이션 추가 화면에서 저장소를 찾을 수 있게 됩니다.',
        // Chrome — CTA button.
        cta: 'GitHub 연결',
      },
      // Content — error messages with context.
      validationError: 'GitHub가 이 인증 정보를 거부했습니다.',
      validationUnreachable: '인증 정보를 확인하기 위해 GitHub에 연결할 수 없습니다.',
      guidance: {
        tokenInvalid: 'GitHub 설정에서 인증 정보를 확인하거나 교체하세요.',
        ssoRequired: '조직 SSO에서 이 인증 정보를 승인하세요.',
        rateLimited: 'GitHub 요청 한도 안내를 확인하고 잠시 후 다시 시도하세요.',
        repositoryAccess: 'GitHub 설정에서 저장소와 조직 접근 권한을 확인하세요.',
        unreachable: 'GitHub 서비스 상태를 확인하세요.',
      },
      loading: 'GitHub 상태를 불러오는 중…',
      loadFailed: 'GitHub 상태를 불러오지 못했습니다.',
      disconnectFailed: 'GitHub 연결을 해제하지 못했습니다.',
      // Chrome — retry button.
      retry: '다시 시도',
    },
    others: {
      // Chrome — section title + provider names + version badge.
      title: '다른 Git 서비스',
      laterBadge: '추후 제공',
      gitlab: 'GitLab',
      bitbucket: 'Bitbucket',
      // Chrome — badge label.
      comingLater: '0.2 이후 제공 예정',
    },
  },
  repositoryKeys: {
    title: '저장소 키',
    subtitle: 'OAuth로 접근할 수 없는 저장소를 위한 읽기 전용 GitHub Deploy Key입니다.',
    loading: '저장소 키를 불러오는 중',
    fields: {
      repository: 'GitHub 저장소 URL',
      name: '표시 이름 (선택)',
      namePlaceholder: '팀 API 배포 키',
    },
    columns: {
      repository: '저장소',
      status: '상태',
      fingerprint: '지문',
      activity: '활동',
      services: '연결 서비스',
      actions: '작업',
    },
    status: { pending: '등록 대기', verified: '검증됨', failed: '검증 실패' },
    activity: { verified: '검증', used: '최근 사용' },
    actions: {
      add: '저장소 키 추가',
      cancel: '취소',
      generate: '키 생성',
      copy: '공개 키 복사',
      copied: '복사됨',
      openGitHub: 'GitHub Deploy Keys 설정 열기',
      finishLater: '나중에 완료',
      verify: '연결 검증',
      done: '완료',
      retry: '다시 시도',
      delete: '삭제',
      createHere: '저장소 키 만들기',
      change: '변경',
      unlink: '연결 해제',
      save: '인증 저장',
    },
    empty: {
      title: '등록된 저장소 키가 없습니다',
      body: '계정 전체 권한 없이 비공개 저장소를 배포할 읽기 전용 키를 생성하세요.',
    },
    wizard: {
      title: '저장소 키 추가',
      step: '{total}단계 중 {current}단계',
      publicKey: '공개 키',
      readOnlyWarning:
        'GitHub에서 “Allow write access”를 선택하지 마세요. OpenLander는 복제와 배포를 위한 읽기 권한만 필요합니다.',
      verifiedTitle: '저장소 접근이 검증되었습니다',
      verifiedBody: 'OpenLander가 {repository} 저장소를 안전하게 복제할 수 있습니다.',
    },
    delete: {
      title: '저장소 키를 삭제할까요?',
      body: '“{name}” 키가 OpenLander에서 영구 삭제됩니다. GitHub의 공개 키는 별도로 삭제해야 합니다.',
      inUse: '삭제하려면 먼저 다음 서비스에서 키 연결을 해제하세요.',
    },
    picker: {
      title: '저장소 인증',
      automatic: '자동 (OAuth/PAT 또는 공개 저장소)',
      matched: '일치하는 검증된 저장소 키를 자동 선택했습니다.',
      multiple: '이 서비스에서 사용할 검증된 키를 선택하세요.',
      selectionRequired: '이 저장소와 일치하는 검증된 키가 여러 개입니다. 사용할 키를 선택하세요.',
      pending: '일치하는 키가 있지만 아직 검증되지 않았습니다.',
      none: '일치하는 저장소 키가 없어 OAuth/PAT 또는 익명 접근을 사용합니다.',
    },
    source: {
      title: '저장소 인증',
      currentDeployKey: '배포 키 · {name}',
      automatic: '자동 · OAuth/PAT 또는 공개 저장소',
      dialogTitle: '저장소 인증 변경',
      dialogDescription:
        '이 저장소와 정확히 일치하는 검증된 키를 선택하거나 현재 키 연결을 해제하세요.',
    },
    messages: {
      verified: '저장소 키 검증이 완료되었습니다.',
      deleted: '저장소 키를 삭제했습니다.',
      saved: '저장소 인증을 변경했습니다.',
    },
    errors: {
      load: '저장소 키를 불러오지 못했습니다.',
      create: '저장소 키를 생성하지 못했습니다.',
      copy: '공개 키를 복사하지 못했습니다. 직접 선택해 복사하세요.',
      verify: '저장소 접근을 검증하지 못했습니다.',
      notAuthorized:
        'GitHub에서 아직 이 키를 허용하지 않았습니다. 저장소 Deploy Keys 설정을 확인하고 다시 시도하세요.',
      delete: '저장소 키를 삭제하지 못했습니다.',
      save: '저장소 인증을 변경하지 못했습니다.',
    },
  },
  securityPermissions: {
    appLifecycle: {
      title: '앱 정지·삭제',
      description: '앱과 Compose를 정지하거나 삭제합니다. 데이터 볼륨은 보존합니다.',
    },

    title: '보안',
    description:
      '앱 정지·삭제, 데이터 삭제, 데이터베이스 접근 권한을 정합니다. 앱 정지·삭제는 기본적으로 승인이 필요합니다.',
    projectTitle: '프로젝트 권한',
    projectDescription:
      '이 프로젝트의 권한을 정합니다. 에이전트에게 이 프로젝트의 정지·삭제를 허용해 달라고 요청할 수도 있습니다.',
    serviceTitle: '서비스 권한',
    serviceDescription: '프로젝트 설정을 상속하거나 이 서비스만 제한합니다.',
    destructive: {
      title: '파괴적 작업',
      description: '서비스 보관과 DB 리소스·버킷·볼륨 삭제에 적용됩니다.',
    },
    database: {
      title: '데이터베이스 접근',
      description: '접속 정보 공개, 데이터베이스 도구 및 에이전트 데이터 조회입니다.',
    },
    options: {
      allow: '허용',
      approval_required: '승인 필요',
      block: '차단',
    },
    inherit: '상위 설정 사용',
    effective: '현재 적용값: {value}',
    loading: '권한을 불러오는 중…',
    save: '권한 저장',
    saving: '저장 중…',
    saved: '권한을 저장했습니다.',
    loadFailed: '권한을 불러오지 못했습니다.',
    saveFailed: '권한을 저장하지 못했습니다.',
  },
  // 사용자에게 보이는 OpenLander 기본 용어. 내부 API/DB 식별자는 영어를
  // 유지하지만 화면에서는 선택한 언어로 표시합니다.
  vocab: {
    project: '프로젝트',
    projectGroup: '프로젝트',
    application: '애플리케이션',
    compose: 'Docker Compose',
    database: '데이터베이스',
    cache: '캐시',
    storage: '스토리지',
    resource: '리소스',
    resources: '리소스',
    deployableService: '애플리케이션',
    managedService: '데이터베이스·캐시·스토리지 리소스',
    infrastructureService: '데이터베이스·캐시·스토리지 리소스',
  },
  serviceDetail: {
    composeChild: {
      observationOnly: 'Compose 자식 · 관찰 전용',
    },
    runtime: {
      cpuSub: '현재 사용량',
      memorySub: '현재 사용량',
    },
    stale: '이전 정보',
    staleTitle: '실시간 상태를 불러오지 못해 마지막 구성도 정보를 표시합니다. {error}',
    loadError: '애플리케이션 상세 정보를 불러오지 못했습니다.',
    metadataFallback:
      '애플리케이션 정보를 불러오지 못해 마지막으로 확인한 구성도 정보를 표시합니다.',
    deployAction: '배포',
    automatic: '자동',
    noDeployments: '이 프로젝트에는 아직 배포 내역이 없습니다.',
    projectContextLogsUnavailable: '프로젝트 정보를 확인한 뒤 로그를 볼 수 있습니다.',
    monitoring: {
      container: '컨테이너',
      primary: '현재',
      replaced: '교체됨',
    },
    deploy: {
      failed: '배포에 실패했습니다.',
      fallbackError: '배포 실패',
      dismiss: '닫기',
      pending: '요청 중…',
      building: '빌드 중…',
      approval: '승인 필요',
      approvalReady: 'Stateful 변경이 승인을 기다리고 있습니다.',
      approvalEffect:
        '승인 대기 목록에서 변경 내용을 확인하세요. 교체 전에 named volume을 백업하고 기존 컨테이너를 보존하며, 제거된 리소스도 데이터와 함께 보관됩니다.',
      // 재배포 라우트가 409 / DEPLOY_LOCKED 를 반환했을 때 노출합니다 —
      // 같은 프로젝트의 다른 배포가 진행 중인 상황 (다른 탭, MCP 에이전트,
      // 웹훅 푸시 등).
      locked: '이미 배포가 진행 중입니다. 완료 후 다시 시도하세요.',
    },
  },
} as const;
