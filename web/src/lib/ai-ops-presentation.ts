import type { AiOpsBriefing, AiOpsBriefingPresentationCode } from './api/ai-ops';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const TITLE_CODES = new Set<AiOpsBriefingPresentationCode>([
  'traffic_health_mismatch',
  'route_failure',
  'container_exited',
  'restart_loop',
  'dependency_failure',
  'runtime_incident',
  'deploy_failed',
  'no_issue_detected',
  'unknown',
]);

const SUMMARY_CODES = new Set<AiOpsBriefingPresentationCode>([
  ...TITLE_CODES,
  'traffic_health_mismatch_http',
  'route_failure_http',
  'container_exited_with_code',
  'restart_loop_with_count',
]);

function presentationCode(
  value: string | undefined,
  supported: ReadonlySet<AiOpsBriefingPresentationCode>,
): AiOpsBriefingPresentationCode {
  return value && supported.has(value as AiOpsBriefingPresentationCode)
    ? (value as AiOpsBriefingPresentationCode)
    : 'unknown';
}

export function localizedBriefingTitle(briefing: AiOpsBriefing, t: Translate): string {
  const code = presentationCode(
    briefing.presentation?.title_code ?? briefing.classification,
    TITLE_CODES,
  );
  return t(`aiOps.briefing.title.${code}`, briefing.presentation?.params);
}

export function localizedBriefingSummary(briefing: AiOpsBriefing, t: Translate): string {
  const code = presentationCode(
    briefing.presentation?.summary_code ?? briefing.classification,
    SUMMARY_CODES,
  );
  return t(`aiOps.briefing.summary.${code}`, briefing.presentation?.params);
}

export function localizedBriefingClassification(briefing: AiOpsBriefing, t: Translate): string {
  const code = presentationCode(
    briefing.presentation?.title_code ?? briefing.classification,
    TITLE_CODES,
  );
  return t(`aiOps.briefing.classification.${code}`);
}
