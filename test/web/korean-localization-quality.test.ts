import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAgentGuideContent,
  type AgentGuideKind,
} from '../../web/src/components/agent-guide/prompt-sets.js';
import { translations as en } from '../../web/src/i18n/en.js';
import { translations as ko } from '../../web/src/i18n/ko.js';
import {
  getDeploymentStatusMeta,
  getDeploymentTriggerLabel,
  getDeploymentTriggerMetaLabel,
} from '../../web/src/lib/deployments.js';

type TranslationTree = Record<string, string | TranslationTree>;

function flatten(tree: TranslationTree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((result, [key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result[fullKey] = value;
    } else {
      Object.assign(result, flatten(value, fullKey));
    }
    return result;
  }, {});
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? '').sort();
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function translatorFor(tree: TranslationTree) {
  return (key: string, params?: Record<string, string | number>): string => {
    let current: string | TranslationTree = tree;
    for (const segment of key.split('.')) {
      if (typeof current === 'string') return key;
      const next: string | TranslationTree | undefined = current[segment];
      if (next === undefined) return key;
      current = next;
    }
    if (typeof current !== 'string') return key;
    return Object.entries(params ?? {}).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
      current,
    );
  };
}

describe('Korean localization quality gate', () => {
  const enFlat = flatten(en);
  const koFlat = flatten(ko);

  it('keeps locale keys and interpolation placeholders in parity', () => {
    expect(Object.keys(koFlat).sort()).toEqual(Object.keys(enFlat).sort());

    for (const key of Object.keys(enFlat)) {
      expect(placeholders(koFlat[key] ?? ''), key).toEqual(placeholders(enFlat[key] ?? ''));
    }
  });

  it('uses the approved Korean FDE product vocabulary', () => {
    expect(ko.delivery.title).toBe('납품 관리');
    expect(ko.delivery.tabs.artifacts).toBe('자료·증빙');
    expect(ko.delivery.tabs.gates).toBe('검토·품질');
    expect(ko.delivery.tabs.receipt).toBe('완료 증빙');
    expect(ko.delivery.gates.title).toBe('납품 통과 기준');
    expect(ko.engagements.title).toBe('고객 과제 현황');
    expect(ko.engagements.sections.blockers.title).toBe('진행을 막는 항목');
    expect(ko.engagements.metrics.blockers).toBe('진행을 막는 항목');
    expect(ko.engagements.blockerCount).toBe('진행을 막는 항목 {count}개');
    expect(ko.engagements.activityEvent.webhookSkipped).toBe('웹훅 배포 건너뜀');
    expect(ko.vocab.project).toBe('프로젝트');
    expect(ko.vocab.application).toBe('애플리케이션');
    expect(ko.delivery.type.software_release).toBe('소프트웨어 릴리스');
    expect(ko.delivery.gates.defaultLabel.review).toBe('검토');
    expect(ko.delivery.gates.defaultLabel.data).toBe('데이터');
    expect(ko.delivery.reviewCheckpoint.acceptExactVersion).toBe('이 버전 승인');
    expect(ko.delivery.reviewCheckpoint.requestChanges).toBe('수정 요청');
    expect(ko.delivery.reviewCheckpoint.exactVersionHint).toBe(
      '새 버전이 올라오면 이 승인은 새 버전에 적용되지 않습니다. 새 버전은 다시 검토하세요.',
    );
    expect(ko.delivery.humanAction.review_version.eyebrow).toBe('확인 필요');
    expect(ko.delivery.humanAction.review_version.action).toBe('검토 열기');
    expect(ko.delivery.humanAction.review_version.title).toBe(
      '고객 검토본 {count}개가 검토를 기다리고 있습니다',
    );
    expect(ko.delivery.workflow.detailsTitle).toBe('상세 진행 기록');
    expect(ko.services.managedDetail.field.type).toBe('유형');
    expect(ko.notifications.type['container-crash']).toBe('컨테이너 비정상 종료');
    expect(ko.notifications.type['resource-saturation']).toBe('리소스 사용량 과다');
    expect(ko.settings.data.factCredentialValue).toBe('에이전트에게 공개하지 않음');
    expect(ko.approval.pendingStrip.approved).toBe('승인했습니다');
    expect(ko.serviceDialogs.grantAccessOptional).toBe(
      '접근 권한을 부여할 데이터베이스 (선택 사항)',
    );
  });

  it('rejects inconsistent loanwords and internal English from Korean copy', () => {
    const rejectedFragments = [
      'Your Agent',
      'Infrastructure 단계',
      '레포지토리',
      '리디플로이',
      '아카이브',
      '프리뷰',
      'non-root',
      '제로 다운타임',
      '보정 프롬프트',
      '라우트 이슈',
      '읽기 접근',
      '해주세요',
      '해두세요',
    ];

    for (const [key, value] of Object.entries(koFlat)) {
      for (const fragment of rejectedFragments) {
        expect(value, key).not.toContain(fragment);
      }
    }
  });

  it('does not leak retired English product terms into Korean copy', () => {
    const retiredTerms =
      /\b(Project|Projects|Application|Applications|Delivery|Deliveries|Receipt|Receipts|Engagement|Engagements|Blocker|Blockers|Gate|Gates|Evidence|Runtime|Settings|Activity|Danger|Save|Cancel|Delete|Create|Status|Overview)\b/;

    for (const [key, value] of Object.entries(koFlat)) {
      expect(value, key).not.toMatch(retiredTerms);
      expect(value, key).not.toContain('[TODO-KO]');
    }
  });

  it('avoids fixed Korean particles immediately after variable identifiers', () => {
    for (const [key, value] of Object.entries(koFlat)) {
      expect(value, key).not.toMatch(
        /\{(?:projectName|serviceName|domain|managed|name|slug)\}(?:은|는|이|가|을|를)/,
      );
    }
  });

  it('keeps English-only Korean values limited to technical and vendor names', () => {
    const allowedEnglishOnlyKeys = new Set([
      'activity.dataAccess.duration',
      'activity.filter.type.mcp',
      'activityFilters.actor.git',
      'approval.pendingStrip.mcpSource',
      'delivery.artifacts.kindValue.markdown',
      'delivery.gates.type.qa',
      'delivery.gates.defaultLabel.qa',
      'delivery.execution.phaseValue.qa',
      'delivery.review.externalProvider.drive',
      'delivery.review.externalProvider.github',
      'delivery.review.externalProvider.slack',
      'delivery.review.externalProvider.teams',
      'delivery.review.sourceType.slack',
      'delivery.review.sourceType.teams',
      'deployErrors.GIT_ACCESS_DENIED.target',
      'gitProviders.github.authMethod.oauth',
      'gitProviders.github.cardTitle',
      'gitProviders.others.bitbucket',
      'gitProviders.others.gitlab',
      'monitoring.metrics.cpu',
      'monitoring.metrics.mem',
      'projectDetail.domains.dialog.domainPlaceholder',
      'projectDetail.tabs.aiOps',
      'services.detail.charts.cpu',
      'services.detail.charts.p95Line',
      'services.detail.build.field.dockerfile',
      'services.detail.envVars.keyPlaceholder',
      'services.detail.overview.cpu',
      'services.detail.runtime.cpuLabel',
      'services.detail.tabs.ai',
      'services.managedDetail.kind.minio',
      'services.managedDetail.kind.mongo',
      'services.managedDetail.kind.mysql',
      'services.managedDetail.kind.postgres',
      'services.managedDetail.kind.redis',
      'settings.nav.ai',
      'settings.data.kind.postgres',
      'settings.data.kind.redis',
      'toolResults.url',
      'topology.kind.compose',
      'vocab.compose',
      'webServer.proxy.statusCode.traefik_managed',
      'webServer.routes.col.tls',
    ]);

    const unexpected = Object.entries(koFlat)
      .filter(([, value]) => /[A-Za-z]/.test(value) && !/[가-힣]/.test(value))
      .filter(([key]) => !allowedEnglishOnlyKeys.has(key));

    expect(unexpected).toEqual([]);
  });

  it('keeps common UI chrome behind translation keys', () => {
    const sources = [
      'web/src/components/Shell/Sidebar.tsx',
      'web/src/App.tsx',
      'web/src/pages/ProjectsGrid.tsx',
      'web/src/components/Shell/LogViewer.tsx',
      'web/src/components/Shell/FailureSummary.tsx',
      'web/src/components/logs/LogViewer.tsx',
      'web/src/components/logs/StaticLogViewer.tsx',
      'web/src/components/ui/confirm-dialog.tsx',
      'web/src/components/ui/dialog.tsx',
      'web/src/types/console.ts',
      'web/src/components/command/CommandPalette.tsx',
      'web/src/components/service/CreateServiceDialog.tsx',
      'web/src/components/service/ServiceConnectionTab.tsx',
      'web/src/components/service/ServiceDatabasesTab.tsx',
      'web/src/components/service/ServiceSettingsTab.tsx',
      'web/src/components/project/ConsoleTab.tsx',
      'web/src/components/deploy-terminal/TerminalPanel.tsx',
      'web/src/components/Shell/InfraMap.tsx',
      'web/src/components/setup/InfraStep.tsx',
      'web/src/components/setup/shared.tsx',
      'web/src/pages/ProjectView.tsx',
      'web/src/pages/ServiceDetailV2.tsx',
      'web/src/pages/settings/WebServer.tsx',
    ].map(readRepoFile);

    const source = sources.join('\n');
    for (const retiredLiteral of [
      '>Create Database<',
      '>Create User<',
      '>Service Information<',
      '>Connection String<',
      '>Diagnosis<',
      "label: 'Web Server'",
      "label: 'Git Providers'",
      'aria-label="Close"',
      "label: 'Running'",
      "label: 'Stopped'",
      '>Something went wrong.<',
      "aria-label={isCollapsed ? '이벤트 펼치기' : '이벤트 접기'}",
      "confirmLabel = 'Confirm'",
      "cancelLabel = 'Cancel'",
      "closeLabel = 'Close'",
      "searchPlaceholder: 'Search logs...'",
      "all: 'All Levels'",
      '>{proxy.status}<',
      '>{service.status}<',
      'detail={status.docker.message}',
      'Install Docker on this machine and start the daemon',
      'Add the current user to the docker group and restart the Docker daemon',
      'Start the Docker daemon on this machine',
      "'Hide terminal'",
      "'Show terminal'",
      'Connected to container',
      'Connection closed',
      'Connection error',
      'recentAgent.title',
      'recentAgent.at',
      'service.kind.toLowerCase()',
    ]) {
      expect(source).not.toContain(retiredLiteral);
    }

    expect(source).toContain('t(CONSOLE_LABEL_KEYS.searchPlaceholder)');
    expect(source).toContain("confirmLabel ?? t('common.confirm')");
    expect(source).toContain("cancelLabel ?? t('common.cancel')");
    expect(source).toContain("closeLabel ?? t('accessibility.close')");
    expect(ko.setup.infra.dockerPermissionDenied).toBe('Docker 사용 권한 필요');
    expect(ko.setupHelp.agentPrompt.startDocker).toMatch(/[가-힣]/);
  });

  it('localizes agent-guide copy while preserving MCP and configuration tokens', () => {
    const translateKo = translatorFor(ko as TranslationTree);
    const kinds: AgentGuideKind[] = [
      'add-service',
      'add-managed-db',
      'add-domain',
      'scale-service',
      'delete-service',
      'remove-domain',
      'set-env-var',
      'delete-env-var',
      'wire-managed-db',
      'plan-delivery',
      'manage-delivery',
    ];

    for (const kind of kinds) {
      const content = getAgentGuideContent(
        kind,
        {
          projectName: 'sample-project',
          serviceName: 'sample-service',
          envVarKey: 'DATABASE_URL',
          managedServiceName: 'sample-db',
          deliveryId: 'del_sample',
        },
        translateKo,
      );
      expect(content.heading, kind).toMatch(/[가-힣]/);
      expect(content.lead, kind).toMatch(/[가-힣]/);
      for (const prompt of content.prompts) {
        expect(prompt.text, kind).toMatch(/[가-힣]/);
        if (prompt.hint) expect(prompt.hint, kind).toMatch(/[가-힣]/);
      }
    }

    const envGuide = getAgentGuideContent(
      'set-env-var',
      { projectName: 'sample-project', serviceName: 'sample-service', envVarKey: 'DATABASE_URL' },
      translateKo,
    );
    expect(envGuide.prompts[0]?.text).toContain('DATABASE_URL');
    const deliveryGuide = getAgentGuideContent(
      'manage-delivery',
      { projectName: 'sample-project', deliveryId: 'del_sample' },
      translateKo,
    );
    expect(deliveryGuide.prompts[0]?.text).toContain('결과 중심');
    expect(deliveryGuide.prompts[0]?.text).toContain('최소 구성');
    const deliveryPlanGuide = getAgentGuideContent(
      'plan-delivery',
      { projectName: 'sample-project' },
      translateKo,
    );
    expect(deliveryPlanGuide.prompts[0]?.text).toContain('내부 절차 표현은 넣지 마세요');
    expect(deliveryPlanGuide.prompts[0]?.text).toContain('QA와 이력은 내부 증빙');
    expect(ko.agentGuide.mcpSetupCheck).toContain('openlander_project({ action: "help" })');
    expect(ko.agentGuide.mcpSetupCheck).toContain('/api');
  });

  it('localizes deployment status and trigger labels at the detail-page boundary', () => {
    const translateKo = translatorFor(ko as TranslationTree);

    expect(getDeploymentStatusMeta('success', translateKo).label).toBe('성공');
    expect(getDeploymentStatusMeta('building', translateKo).label).toBe('빌드 중');
    expect(getDeploymentTriggerMetaLabel('chat', translateKo)).toBe('에이전트 실행');
    expect(getDeploymentTriggerMetaLabel('webhook', translateKo)).toBe('웹훅 실행');
    expect(getDeploymentTriggerLabel('chat', null, translateKo)).toBe('에이전트 배포');
    expect(getDeploymentTriggerLabel('api', 'env_update', translateKo)).toBe('환경 변수 변경');

    const detail = readRepoFile('web/src/pages/DeploymentDetail.tsx');
    expect(detail).toContain('getDeploymentStatusMeta(deployment.status, t)');
    expect(detail).toContain('getDeploymentTriggerMetaLabel(deployment.trigger, t)');
    const list = readRepoFile('web/src/components/project/DeploymentsList.tsx');
    expect(list).toContain('getDeploymentStatusMeta(deploy.status, t)');
    expect(list).toContain('getDeploymentTriggerLabel(deploy.trigger, deploy.triggerDetail, t)');
  });

  it('keeps service source and build chrome behind translation keys', () => {
    const detail = readRepoFile('web/src/pages/ServiceDetailV2.tsx');

    for (const literal of [
      "sourceRows.push(['Source'",
      "sourceRows.push(['Provider'",
      "sourceRows.push(['Repository'",
      "['Method', buildMethod]",
      "['Target stage'",
      "['Build context'",
    ]) {
      expect(detail).not.toContain(literal);
    }
    expect(detail).toContain("t('services.detail.build.methodValue.image')");
    expect(detail).toContain("t('services.detail.build.methodValue.automatic')");
    expect(detail).toContain('formatServiceKind(resolvedService.kind, t)');
    expect(detail).not.toContain('{service.kind ?? service.type}');
    expect(
      detail.match(/formatManagedServiceKind\(service\.kind \?\? service\.type, t\)/g),
    ).toHaveLength(2);
    expect(ko.services.managedDetail.kind).toEqual({
      postgres: 'PostgreSQL',
      mysql: 'MySQL',
      redis: 'Redis',
      mongo: 'MongoDB',
      minio: 'MinIO',
    });
  });
});
