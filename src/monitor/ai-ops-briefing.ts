import type { AiOpsBriefingSeverity } from '../db/types.js';
import type { RepresentativeTrafficObservation } from '../tools/defs/representative-traffic.js';
import { redactAiOpsEvidencePack } from './ai-ops-evidence-redaction.js';
import { buildAiOpsDedupeKey } from './ai-ops-policy.js';

export type AiOpsBriefingClassification =
  | 'traffic_health_mismatch'
  | 'route_failure'
  | 'container_exited'
  | 'restart_loop'
  | 'dependency_failure'
  | 'runtime_incident'
  | 'deploy_failed'
  | 'no_issue_detected';

export interface AiOpsSuggestedCall {
  tool: 'openlander_monitor' | 'openlander_deploy' | 'openlander_service';
  action:
    | 'diagnose_service'
    | 'get_logs'
    | 'get_build_log'
    | 'get_deploy_status'
    | 'apply_route_config'
    | 'update_app';
  params: Record<string, string | number | boolean>;
}

export interface AiOpsRouteHealthEvidence {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  url?: string;
  statusCode?: number;
  message?: string;
}

export interface AiOpsDeployLogEvidence {
  id?: string;
  status?: 'success' | 'failed' | 'cancelled' | 'unhealthy';
  commitSha?: string | null;
  buildLogTail?: string | null;
  runtimeLogTail?: string | null;
  createdAt?: string | null;
}

export interface AiOpsContainerEvidence {
  name?: string | null;
  running?: boolean;
  status?: string | null;
  health?: string | null;
  exitCode?: number | null;
  restartCount?: number | null;
  startedAt?: string | null;
}

export interface AiOpsRuntimeIncidentEvidence {
  id?: string;
  category?: string;
  diagnosis?: string | null;
  errorSnippet?: string | null;
  restartCount?: number | null;
  createdAt?: string | null;
}

export interface AiOpsEvidencePack {
  projectId: string;
  serviceId?: string | null;
  serviceName?: string | null;
  observedAt: string;
  routeHealth?: AiOpsRouteHealthEvidence | null;
  representativeTraffic?: RepresentativeTrafficObservation | null;
  deployLog?: AiOpsDeployLogEvidence | null;
  recentLogTail?: string | null;
  container?: AiOpsContainerEvidence | null;
  runtimeIncident?: AiOpsRuntimeIncidentEvidence | null;
}

export interface BuildAiOpsBriefingInput {
  projectId: string;
  serviceId?: string | null;
  serviceName?: string | null;
  observedAt?: Date;
  routeHealth?: AiOpsRouteHealthEvidence | null;
  representativeTraffic?: RepresentativeTrafficObservation | null;
  deployLog?: AiOpsDeployLogEvidence | null;
  recentLogTail?: string | null;
  container?: AiOpsContainerEvidence | null;
  runtimeIncident?: AiOpsRuntimeIncidentEvidence | null;
}

export interface DeterministicAiOpsBriefing {
  projectId: string;
  serviceId: string | null;
  fingerprint: string;
  dedupeKey: string;
  classification: AiOpsBriefingClassification;
  severity: AiOpsBriefingSeverity;
  title: string;
  deterministicSummary: string;
  evidence: AiOpsEvidencePack;
  suggestedCall: AiOpsSuggestedCall | null;
}

const MAX_TAIL_LINES = 40;
const AUTO_MUTATION_ACTIONS = new Set(['update_app', 'apply_route_config']);

function trimLogTail(value: string | null | undefined): string | null {
  if (!value) return null;
  const lines = value.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.slice(-MAX_TAIL_LINES).join('\n');
}

function sanitizeFingerprintPart(value: string | null | undefined): string {
  return (value ?? 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._:/-]/g, '')
    .slice(0, 120);
}

function diagnoseCall(serviceId: string | null): AiOpsSuggestedCall | null {
  if (!serviceId) return null;
  return {
    tool: 'openlander_monitor',
    action: 'diagnose_service',
    params: { service_id: serviceId },
  };
}

function buildLogCall(deployId: string | undefined): AiOpsSuggestedCall | null {
  if (!deployId) return null;
  return {
    tool: 'openlander_deploy',
    action: 'get_build_log',
    params: { deploy_id: deployId },
  };
}

function isDependencyIncident(incident: AiOpsRuntimeIncidentEvidence | null | undefined): boolean {
  const text = `${incident?.category ?? ''} ${incident?.diagnosis ?? ''} ${
    incident?.errorSnippet ?? ''
  }`.toLowerCase();
  return /dependency|database|redis|postgres|mysql|mongo|external|connection/.test(text);
}

function isRestartLoop(input: BuildAiOpsBriefingInput): boolean {
  const containerRestarts = input.container?.restartCount ?? 0;
  const incidentRestarts = input.runtimeIncident?.restartCount ?? 0;
  const category = input.runtimeIncident?.category?.toLowerCase() ?? '';
  return (
    containerRestarts >= 3 || incidentRestarts >= 3 || /(?:restart|crash)[_-]?loop/.test(category)
  );
}

function hasContainerExitEvidence(input: BuildAiOpsBriefingInput): boolean {
  return (
    input.container?.running === false ||
    input.container?.status === 'exited' ||
    typeof input.container?.exitCode === 'number'
  );
}

function buildContainerRuntimeSummary(evidence: AiOpsEvidencePack): string {
  const details: string[] = [];
  const serviceLabel = evidence.serviceName ?? evidence.serviceId ?? null;
  if (serviceLabel) details.push(`service ${serviceLabel}`);
  if (evidence.container?.name) details.push(`container ${evidence.container.name}`);
  if (typeof evidence.container?.exitCode === 'number') {
    details.push(`exit code ${String(evidence.container.exitCode)}`);
  }
  const restartCount = evidence.container?.restartCount ?? evidence.runtimeIncident?.restartCount;
  if (typeof restartCount === 'number') details.push(`restart count ${String(restartCount)}`);
  if (evidence.routeHealth?.status && evidence.routeHealth.status !== 'unknown') {
    details.push(`route ${evidence.routeHealth.status}`);
  }

  if (details.length > 0) {
    return `Runtime evidence shows ${details.join(', ')}.`;
  }

  return 'Runtime evidence indicates a container crash or restart issue.';
}

export function normalizeAiOpsEvidencePack(input: BuildAiOpsBriefingInput): AiOpsEvidencePack {
  const evidence: AiOpsEvidencePack = {
    projectId: input.projectId,
    serviceId: input.serviceId ?? null,
    serviceName: input.serviceName ?? null,
    observedAt: (input.observedAt ?? new Date()).toISOString(),
    routeHealth: input.routeHealth ?? null,
    representativeTraffic: input.representativeTraffic ?? null,
    deployLog: input.deployLog
      ? {
          ...input.deployLog,
          buildLogTail: trimLogTail(input.deployLog.buildLogTail),
          runtimeLogTail: trimLogTail(input.deployLog.runtimeLogTail),
        }
      : null,
    recentLogTail: trimLogTail(input.recentLogTail),
    container: input.container ?? null,
    runtimeIncident: input.runtimeIncident ?? null,
  };
  return redactAiOpsEvidencePack(evidence);
}

export function buildDeterministicAiOpsBriefing(
  input: BuildAiOpsBriefingInput,
): DeterministicAiOpsBriefing {
  const evidence = normalizeAiOpsEvidencePack(input);
  const serviceId = evidence.serviceId ?? null;
  const routeHealth = evidence.routeHealth;
  const representativeTraffic = evidence.representativeTraffic;
  const deployLog = evidence.deployLog;
  const runtimeIncident = evidence.runtimeIncident;

  let classification: AiOpsBriefingClassification = 'no_issue_detected';
  let severity: AiOpsBriefingSeverity = 'info';
  let title = 'No AI Ops issue detected';
  let deterministicSummary =
    'OpenLander has evidence for this Project, but no deterministic incident rule matched.';
  let suggestedCall = diagnoseCall(serviceId);
  let fingerprint = 'no-issue';

  if (representativeTraffic?.status === 'failed' && representativeTraffic.severity === 'fail') {
    classification = 'traffic_health_mismatch';
    severity = 'high';
    title = 'Public traffic is failing';
    deterministicSummary = `Representative traffic probe to ${
      representativeTraffic.path
    } failed with ${String(representativeTraffic.status_code ?? 'no HTTP status')}.`;
    fingerprint = `traffic:${representativeTraffic.path}:${String(
      representativeTraffic.status_code ?? 'unknown',
    )}`;
    suggestedCall = diagnoseCall(serviceId);
  } else if (
    routeHealth &&
    (routeHealth.status === 'unhealthy' ||
      routeHealth.status === 'degraded' ||
      (routeHealth.statusCode !== undefined && routeHealth.statusCode >= 500))
  ) {
    classification = 'route_failure';
    severity = routeHealth.status === 'degraded' ? 'warning' : 'high';
    title = 'Route health is degraded';
    deterministicSummary = `Route health is ${routeHealth.status}${
      routeHealth.statusCode ? ` with HTTP ${String(routeHealth.statusCode)}` : ''
    }.`;
    fingerprint = `route:${routeHealth.url ?? 'public'}:${String(
      routeHealth.statusCode ?? routeHealth.status,
    )}`;
    suggestedCall = diagnoseCall(serviceId);
  } else if (isRestartLoop(input)) {
    classification = 'restart_loop';
    severity = 'high';
    title = 'Service appears to be restart-looping';
    deterministicSummary = buildContainerRuntimeSummary(evidence);
    fingerprint = 'restart-loop';
    suggestedCall = diagnoseCall(serviceId);
  } else if (hasContainerExitEvidence(input)) {
    classification = 'container_exited';
    severity = 'high';
    title = 'Service container exited';
    deterministicSummary = buildContainerRuntimeSummary(evidence);
    fingerprint = `container-exited:${sanitizeFingerprintPart(
      evidence.container?.name ??
        evidence.container?.status ??
        String(evidence.container?.exitCode),
    )}`;
    suggestedCall = diagnoseCall(serviceId);
  } else if (runtimeIncident && isDependencyIncident(runtimeIncident)) {
    classification = 'dependency_failure';
    severity = 'high';
    title = 'Runtime evidence points to a dependency failure';
    deterministicSummary =
      runtimeIncident.diagnosis ??
      runtimeIncident.errorSnippet ??
      'Runtime incident evidence references a dependency or connection failure.';
    fingerprint = `dependency:${runtimeIncident.category ?? 'runtime'}:${sanitizeFingerprintPart(
      runtimeIncident.errorSnippet ?? runtimeIncident.diagnosis,
    )}`;
    suggestedCall = diagnoseCall(serviceId);
  } else if (runtimeIncident) {
    classification = 'runtime_incident';
    severity = 'high';
    title = 'Runtime incident detected';
    deterministicSummary =
      runtimeIncident.diagnosis ??
      runtimeIncident.errorSnippet ??
      `Runtime incident category: ${runtimeIncident.category ?? 'unknown'}.`;
    fingerprint = `incident:${runtimeIncident.category ?? 'runtime'}:${sanitizeFingerprintPart(
      runtimeIncident.errorSnippet ?? runtimeIncident.diagnosis,
    )}`;
    suggestedCall = diagnoseCall(serviceId);
  } else if (deployLog?.status === 'failed' || deployLog?.status === 'unhealthy') {
    classification = 'deploy_failed';
    severity = 'high';
    title = 'Recent deploy failed or became unhealthy';
    deterministicSummary =
      deployLog.buildLogTail ??
      deployLog.runtimeLogTail ??
      `Deploy ${deployLog.id ?? 'unknown'} status is ${deployLog.status}.`;
    fingerprint = `deploy:${deployLog.status}:${sanitizeFingerprintPart(
      deployLog.buildLogTail ?? deployLog.runtimeLogTail ?? deployLog.id,
    )}`;
    suggestedCall = buildLogCall(deployLog.id) ?? diagnoseCall(serviceId);
  }

  if (suggestedCall && AUTO_MUTATION_ACTIONS.has(suggestedCall.action)) {
    suggestedCall = diagnoseCall(serviceId);
  }

  const dedupeKey = buildAiOpsDedupeKey({
    projectId: input.projectId,
    serviceId,
    fingerprint,
  });

  return {
    projectId: input.projectId,
    serviceId,
    fingerprint,
    dedupeKey,
    classification,
    severity,
    title,
    deterministicSummary,
    evidence,
    suggestedCall,
  };
}
