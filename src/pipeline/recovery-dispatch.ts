import { createModuleLogger } from '../lib/logger.js';
import { pickLocale, type Locale } from '../lib/locale.js';

const log = createModuleLogger('recovery-dispatch');

export type { Locale };

export type Fixability = 'agent' | 'user' | 'report';

export type RecoveryCategory =
  | 'clone_auth'
  | 'clone_repo_not_found'
  | 'clone_branch_not_found'
  | 'clone_generic'
  | 'docker_daemon'
  | 'dockerfile_missing'
  | 'env_missing'
  | 'build_error'
  | 'compile_error'
  | 'test_failure'
  | 'runtime_crash'
  | 'runtime_generic'
  | 'network_dns'
  | 'resource_oom'
  | 'port_conflict'
  | 'dependency_unavailable'
  | 'unknown';

export interface UserActionStep {
  label: string;
  actionUrl?: string;
}

export interface RecoveryPlan {
  category: RecoveryCategory;
  fixability: Fixability;
  title: string;
  description: string;
  userSteps: UserActionStep[];
  agentGuidance: string;
  allowedTools: string[];
}

interface LocalizedText {
  ko: string;
  en: string;
}

interface LocalizedUserActionStep {
  label: LocalizedText;
  actionUrl?: string;
}

interface RecoveryTemplate {
  fixability: Fixability;
  title: LocalizedText;
  description: LocalizedText;
  userSteps: LocalizedUserActionStep[];
  agentGuidance: string;
  allowedTools: string[];
}

const CLONE_AUTH_PATTERNS = [/Authentication failed/i, /GIT_AUTH_FAILED/i, /permission denied/i];
const CLONE_REPO_NOT_FOUND_PATTERNS = [
  /Repository not found/i,
  /GIT_REPO_NOT_FOUND/i,
  /404.*not found/i,
];
const CLONE_BRANCH_NOT_FOUND_PATTERNS = [/GIT_BRANCH_NOT_FOUND/i];

const DOCKER_DAEMON_PATTERNS = [/docker daemon/i, /cannot connect to docker/i];

const DOCKERFILE_MISSING_PATTERNS = [/DOCKERFILE_NOT_FOUND/i, /No Dockerfile found/i];

const COMPILE_ERROR_PATTERNS = [/error TS\d+/i, /SyntaxError/i];
const TEST_FAILURE_PATTERNS = [/tests? failed/i, /\bFAIL\b/i];
const ENV_MISSING_PATTERNS = [/required environment variable/i, /Missing required config/i];

const RUNTIME_CRASH_PATTERNS = [/crashed/i, /exited with code/i, /restart loop/i];

const NETWORK_DNS_PATTERNS = [
  /Name or service not known/i,
  /getaddrinfo/i,
  /ENOTFOUND/i,
  /DNS resolution failed/i,
  /Could not resolve host/i,
];

const RESOURCE_OOM_PATTERNS = [
  /Out of memory/i,
  /OOMKilled/i,
  /memory allocation failed/i,
  /Cannot allocate memory/i,
  /JavaScript heap out of memory/i,
];

const PORT_CONFLICT_PATTERNS = [
  /Address already in use/i,
  /EADDRINUSE/i,
  /bind: address already in use/i,
];

const DEPENDENCY_UNAVAILABLE_PATTERNS = [
  /Connection refused/i,
  /ECONNREFUSED/i,
  /connect ECONNREFUSED/i,
  /Connection reset by peer/i,
  /ECONNRESET/i,
];

const RECOVERY_TEMPLATES: Record<RecoveryCategory, RecoveryTemplate> = {
  clone_auth: {
    fixability: 'user',
    title: { en: 'Git Authentication Failed', ko: 'Git 인증 실패' },
    description: {
      en: 'SSH key or credentials are not configured for this repository.',
      ko: '이 저장소에 대한 SSH 키 또는 인증 정보가 설정되지 않았습니다.',
    },
    userSteps: [
      {
        label: {
          en: 'Register an SSH key in Settings > Git Providers',
          ko: '설정 > Git Providers에서 SSH 키를 등록하세요',
        },
        actionUrl: '/settings/git-providers',
      },
      {
        label: {
          en: 'Or check if the repository URL is correct',
          ko: '또는 저장소 URL이 올바른지 확인하세요',
        },
      },
    ],
    agentGuidance: '',
    allowedTools: [],
  },
  clone_repo_not_found: {
    fixability: 'user',
    title: { en: 'Repository Not Found', ko: '저장소를 찾을 수 없음' },
    description: {
      en: 'The repository URL may be incorrect or the repository may be private.',
      ko: '저장소 URL이 잘못되었거나, 비공개 저장소일 수 있습니다.',
    },
    userSteps: [
      {
        label: {
          en: 'Verify the repository URL',
          ko: '저장소 URL을 확인하세요',
        },
      },
      {
        label: {
          en: 'If private, register credentials in Settings > Git Providers',
          ko: '비공개 저장소라면 설정 > Git Providers에서 인증 정보를 등록하세요',
        },
        actionUrl: '/settings/git-providers',
      },
    ],
    agentGuidance: '',
    allowedTools: [],
  },
  clone_branch_not_found: {
    fixability: 'user',
    title: { en: 'Branch Not Found', ko: '브랜치를 찾을 수 없음' },
    description: {
      en: 'The requested branch does not exist in this repository.',
      ko: '요청한 브랜치가 이 저장소에 존재하지 않습니다.',
    },
    userSteps: [
      {
        label: {
          en: 'Check the branch name and try again',
          ko: '브랜치 이름을 확인한 뒤 다시 시도하세요',
        },
      },
      {
        label: {
          en: 'Or deploy without specifying a branch to use the default branch',
          ko: '또는 브랜치를 지정하지 않고 배포해 기본 브랜치를 사용하세요',
        },
      },
    ],
    agentGuidance: '',
    allowedTools: [],
  },
  clone_generic: {
    fixability: 'user',
    title: { en: 'Repository Clone Failed', ko: '저장소 클론 실패' },
    description: {
      en: 'OpenLander could not clone your repository due to a git access or URL issue.',
      ko: 'Git 접근 또는 URL 문제로 OpenLander가 저장소를 클론하지 못했습니다.',
    },
    userSteps: [
      {
        label: {
          en: 'Check repository URL, branch, and access permissions',
          ko: '저장소 URL, 브랜치, 접근 권한을 확인하세요',
        },
      },
      {
        label: {
          en: 'If needed, update credentials in Settings > Git Providers',
          ko: '필요하면 설정 > Git Providers에서 인증 정보를 업데이트하세요',
        },
        actionUrl: '/settings/git-providers',
      },
    ],
    agentGuidance: '',
    allowedTools: [],
  },
  docker_daemon: {
    fixability: 'report',
    title: { en: 'Docker Daemon Unavailable', ko: 'Docker 데몬을 사용할 수 없음' },
    description: {
      en: 'OpenLander cannot reach the Docker daemon on this host right now.',
      ko: '현재 이 호스트에서 OpenLander가 Docker 데몬에 연결할 수 없습니다.',
    },
    userSteps: [
      {
        label: {
          en: 'Start Docker on the host and try again',
          ko: '호스트에서 Docker를 시작한 뒤 다시 시도하세요',
        },
      },
    ],
    agentGuidance: '',
    allowedTools: [],
  },
  dockerfile_missing: {
    fixability: 'agent',
    title: { en: 'Dockerfile Missing', ko: 'Dockerfile 누락' },
    description: {
      en: 'No Dockerfile was found in the repository root.',
      ko: '저장소 루트에서 Dockerfile을 찾을 수 없습니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: dockerfile_missing
What happened: No Dockerfile was found in the repository.
What you can do: The pipeline can auto-generate Dockerfiles for common frameworks (Next.js, FastAPI, etc.). Call create_deploy_plan to create a new plan, then execute_deploy_plan to retry - the pipeline will attempt auto-detection. If it fails, ask the user what framework they're using via ask_user_question.
Allowed tools: ask_user_question, create_deploy_plan, execute_deploy_plan, get_build_log
Do NOT: Try to create a Dockerfile manually - you don't have file editing tools.`,
    allowedTools: [
      'ask_user_question',
      'create_deploy_plan',
      'execute_deploy_plan',
      'get_build_log',
    ],
  },
  env_missing: {
    fixability: 'agent',
    title: { en: 'Missing Environment Variable', ko: '환경 변수 누락' },
    description: {
      en: 'A required environment variable or config value is missing for this build.',
      ko: '이 빌드에 필요한 환경 변수 또는 설정 값이 누락되었습니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: env_missing
What happened: A required environment variable is not set.
What you can do: Use ask_user_question to ask the user for the missing value, then call set_env_vars to set it, then create_deploy_plan and execute_deploy_plan to retry.
Allowed tools: ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan, get_build_log
Do NOT: Retry the deploy without getting the missing value first.`,
    allowedTools: [
      'ask_user_question',
      'set_env_vars',
      'create_deploy_plan',
      'execute_deploy_plan',
      'get_build_log',
    ],
  },
  build_error: {
    fixability: 'agent',
    title: { en: 'Build Failed', ko: '빌드 실패' },
    description: {
      en: 'Docker build failed and requires diagnosis before retrying.',
      ko: 'Docker 빌드가 실패하여 재시도 전에 원인 진단이 필요합니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: build_error
What happened: Docker build failed. The build log may contain the root cause.
What you can do: Call get_build_log to get log evidence of the build failure. If it's a missing env var, use ask_user_question + set_env_vars. If it's a Dockerfile issue, the pipeline will auto-fix on retry. Call create_deploy_plan and execute_deploy_plan to retry after fixing.
Allowed tools: get_build_log, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan, get_logs
Do NOT: Retry blindly without diagnosing first.`,
    allowedTools: [
      'get_build_log',
      'ask_user_question',
      'set_env_vars',
      'create_deploy_plan',
      'execute_deploy_plan',
      'get_logs',
    ],
  },
  compile_error: {
    fixability: 'user',
    title: { en: 'Source Code Compilation Error', ko: '소스 코드 컴파일 오류' },
    description: {
      en: 'The application source code has compilation errors that must be fixed in the repository.',
      ko: '애플리케이션 소스 코드에 컴파일 오류가 있어 저장소에서 수정이 필요합니다.',
    },
    userSteps: [
      {
        label: {
          en: 'Fix the compilation errors in your source code and push again',
          ko: '소스 코드의 컴파일 오류를 수정한 후 다시 푸시하세요',
        },
      },
    ],
    agentGuidance: '',
    allowedTools: [],
  },
  test_failure: {
    fixability: 'user',
    title: { en: 'Tests Failed', ko: '테스트 실패' },
    description: {
      en: 'One or more tests failed during the build pipeline.',
      ko: '빌드 파이프라인에서 하나 이상의 테스트가 실패했습니다.',
    },
    userSteps: [
      {
        label: {
          en: 'Run tests locally, fix failures, and push again',
          ko: '로컬에서 테스트를 실행해 실패를 수정한 뒤 다시 푸시하세요',
        },
      },
    ],
    agentGuidance: '',
    allowedTools: [],
  },
  runtime_crash: {
    fixability: 'agent',
    title: { en: 'Runtime Crash Detected', ko: '런타임 크래시 감지' },
    description: {
      en: 'The container crashed or entered a restart loop after deployment.',
      ko: '배포 후 컨테이너가 크래시했거나 재시작 루프에 들어갔습니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: runtime_crash
What happened: The app crashed after container start or keeps restarting.
What you can do: Inspect logs with get_logs, diagnose probable cause, then call create_deploy_plan and execute_deploy_plan to retry after adjustments. If config is missing, ask the user and set values first.
Allowed tools: get_logs, get_build_log, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
Do NOT: Keep retrying without identifying the crash trigger.`,
    allowedTools: [
      'get_logs',
      'get_build_log',
      'ask_user_question',
      'set_env_vars',
      'create_deploy_plan',
      'execute_deploy_plan',
    ],
  },
  runtime_generic: {
    fixability: 'agent',
    title: { en: 'Runtime Failure', ko: '런타임 실패' },
    description: {
      en: 'The deployment reached runtime but encountered an unrecovered failure.',
      ko: '배포가 런타임 단계까지 진행되었지만 복구되지 않은 오류가 발생했습니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: runtime_generic
What happened: A runtime-stage failure occurred but the specific crash type is unclear.
What you can do: Collect recent logs via get_logs, ask focused follow-up questions if needed, and retry with create_deploy_plan and execute_deploy_plan only after diagnosis.
Allowed tools: get_logs, ask_user_question, get_build_log, create_deploy_plan, execute_deploy_plan
Do NOT: Assume Docker infrastructure is broken unless logs clearly indicate daemon issues.`,
    allowedTools: [
      'get_logs',
      'ask_user_question',
      'get_build_log',
      'create_deploy_plan',
      'execute_deploy_plan',
    ],
  },
  network_dns: {
    fixability: 'agent',
    title: { en: 'DNS Resolution Failed', ko: 'DNS 해석 실패' },
    description: {
      en: 'The application could not resolve a hostname to an IP address.',
      ko: '애플리케이션이 호스트명을 IP 주소로 해석하지 못했습니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: network_dns
What happened: DNS resolution failed for a hostname (e.g., database, API endpoint).
What you can do: Check if the service is running and accessible. Verify environment variables for hostnames. Use get_logs to inspect the error, then ask_user_question if a service URL is needed. Retry with create_deploy_plan and execute_deploy_plan after confirming connectivity.
Allowed tools: get_logs, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
Do NOT: Assume the service is down without checking logs first.`,
    allowedTools: [
      'get_logs',
      'ask_user_question',
      'set_env_vars',
      'create_deploy_plan',
      'execute_deploy_plan',
    ],
  },
  resource_oom: {
    fixability: 'agent',
    title: { en: 'Out of Memory', ko: '메모리 부족' },
    description: {
      en: 'The container ran out of memory and was killed by the system.',
      ko: '컨테이너의 메모리가 부족하여 시스템에 의해 종료되었습니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: resource_oom
What happened: The application exceeded available memory and was OOMKilled.
What you can do: Increase the container memory limit or optimize the application. Use get_logs to confirm OOMKilled status. Ask the user for memory requirements, then adjust the deployment configuration. Retry with create_deploy_plan and execute_deploy_plan.
Allowed tools: get_logs, ask_user_question, create_deploy_plan, execute_deploy_plan
Do NOT: Retry with the same memory limit.`,
    allowedTools: ['get_logs', 'ask_user_question', 'create_deploy_plan', 'execute_deploy_plan'],
  },
  port_conflict: {
    fixability: 'agent',
    title: { en: 'Port Already in Use', ko: '포트가 이미 사용 중' },
    description: {
      en: 'The port the application tried to bind to is already in use by another process.',
      ko: '애플리케이션이 바인드하려는 포트가 이미 다른 프로세스에서 사용 중입니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: port_conflict
What happened: The application could not bind to its configured port (EADDRINUSE).
What you can do: Check if another container is using the same port. OpenLander auto-assigns ports, but if a specific port is required, verify it's available. Use get_logs to see the exact port. Retry with create_deploy_plan and execute_deploy_plan.
Allowed tools: get_logs, create_deploy_plan, execute_deploy_plan
Do NOT: Assume the port is permanently blocked.`,
    allowedTools: ['get_logs', 'create_deploy_plan', 'execute_deploy_plan'],
  },
  dependency_unavailable: {
    fixability: 'agent',
    title: { en: 'Dependency Unavailable', ko: '의존성을 사용할 수 없음' },
    description: {
      en: 'The application could not connect to a required service (database, cache, API).',
      ko: '애플리케이션이 필요한 서비스(데이터베이스, 캐시, API)에 연결할 수 없습니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: dependency_unavailable
What happened: Connection refused to a dependency (ECONNREFUSED or ECONNRESET).
What you can do: Verify the dependency service is running and accessible. Check environment variables for correct hostnames and ports. Use get_logs to identify which service failed. Ask the user if the service needs to be provisioned. Retry with create_deploy_plan and execute_deploy_plan.
Allowed tools: get_logs, ask_user_question, set_env_vars, create_deploy_plan, execute_deploy_plan
Do NOT: Retry without confirming the dependency is available.`,
    allowedTools: [
      'get_logs',
      'ask_user_question',
      'set_env_vars',
      'create_deploy_plan',
      'execute_deploy_plan',
    ],
  },
  unknown: {
    fixability: 'agent',
    title: { en: 'Unknown Deployment Failure', ko: '알 수 없는 배포 실패' },
    description: {
      en: 'OpenLander could not classify this failure with existing rules.',
      ko: '기존 규칙으로 이 실패를 분류하지 못했습니다.',
    },
    userSteps: [],
    agentGuidance: `## OpenLander Context (for this failure)
Category: unknown
What happened: The failure did not match known recovery categories.
What you can do: Gather logs and context, diagnose likely root cause, and choose the safest next action before retrying with create_deploy_plan and execute_deploy_plan.
Allowed tools: get_logs, get_build_log, ask_user_question, create_deploy_plan, execute_deploy_plan
Do NOT: Retry repeatedly without new evidence.`,
    allowedTools: [
      'get_logs',
      'get_build_log',
      'ask_user_question',
      'create_deploy_plan',
      'execute_deploy_plan',
    ],
  },
};

export function dispatchRecovery(
  step: string,
  error: string,
  buildLog?: string,
  locale: Locale = 'en',
): RecoveryPlan {
  const category = classifyCategory(step, error, buildLog);
  const template = RECOVERY_TEMPLATES[category];

  const plan: RecoveryPlan = {
    category,
    fixability: template.fixability,
    title: pickLocale(locale, template.title),
    description: pickLocale(locale, template.description),
    userSteps: template.userSteps.map((userStep) => ({
      label: pickLocale(locale, userStep.label),
      actionUrl: userStep.actionUrl,
    })),
    agentGuidance: template.agentGuidance,
    allowedTools: template.allowedTools,
  };

  log.debug({ step, category, fixability: plan.fixability }, 'Dispatched recovery plan');
  return plan;
}

function classifyCategory(step: string, error: string, buildLog?: string): RecoveryCategory {
  if (step === 'clone') {
    if (matchesAny(error, CLONE_AUTH_PATTERNS)) {
      return 'clone_auth';
    }

    const hasBranchNotFoundText = /Branch/i.test(error) && /not found/i.test(error);
    if (hasBranchNotFoundText || matchesAny(error, CLONE_BRANCH_NOT_FOUND_PATTERNS)) {
      return 'clone_branch_not_found';
    }

    if (matchesAny(error, CLONE_REPO_NOT_FOUND_PATTERNS)) {
      return 'clone_repo_not_found';
    }

    return 'clone_generic';
  }

  if (matchesAny(error, DOCKER_DAEMON_PATTERNS)) {
    return 'docker_daemon';
  }

  if (step === 'dockerfile') {
    if (matchesAny(error, DOCKERFILE_MISSING_PATTERNS)) {
      return 'dockerfile_missing';
    }

    return 'unknown';
  }

  if (step === 'build') {
    const combined = combineErrorAndLog(error, buildLog);

    if (matchesAny(combined, COMPILE_ERROR_PATTERNS)) {
      return 'compile_error';
    }

    if (matchesAny(combined, TEST_FAILURE_PATTERNS)) {
      return 'test_failure';
    }

    if (matchesAny(combined, ENV_MISSING_PATTERNS)) {
      return 'env_missing';
    }

    return 'build_error';
  }

  if (step === 'run' || step === 'runtime') {
    if (matchesAny(error, RUNTIME_CRASH_PATTERNS)) {
      return 'runtime_crash';
    }

    if (matchesAny(error, NETWORK_DNS_PATTERNS)) {
      return 'network_dns';
    }

    if (matchesAny(error, RESOURCE_OOM_PATTERNS)) {
      return 'resource_oom';
    }

    if (matchesAny(error, PORT_CONFLICT_PATTERNS)) {
      return 'port_conflict';
    }

    if (matchesAny(error, DEPENDENCY_UNAVAILABLE_PATTERNS)) {
      return 'dependency_unavailable';
    }

    return 'runtime_generic';
  }

  return 'unknown';
}

function combineErrorAndLog(error: string, buildLog?: string): string {
  if (!buildLog) {
    return error;
  }

  return `${error}\n${buildLog}`;
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
