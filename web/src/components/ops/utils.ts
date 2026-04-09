export function relativeTime(timestamp: number, lang: 'ko' | 'en' = 'ko'): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return lang === 'ko' ? '방금 전' : 'just now';
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return lang === 'ko' ? `${m}분 전` : `${m}m ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return lang === 'ko' ? `${h}시간 전` : `${h}h ago`;
  }
  const d = Math.floor(diff / 86_400_000);
  return lang === 'ko' ? `${d}일 전` : `${d}d ago`;
}

export function describeCBState(
  state: string,
  failures: number,
  lang: 'ko' | 'en' = 'ko',
): { label: string; explanation: string } {
  const labels: Record<string, Record<'ko' | 'en', { label: string; explanation: string }>> = {
    open: {
      ko: {
        label: '🛑 자동 복구 중단',
        explanation: `연속 ${failures}회 복구 실패로 자동 복구가 일시 중단되었습니다`,
      },
      en: {
        label: '🛑 Recovery Paused',
        explanation: `Auto-recovery paused after ${failures} consecutive failures`,
      },
    },
    half_open: {
      ko: {
        label: '🔄 복구 재시도 중',
        explanation: `${failures}회 실패 후 복구를 다시 시도하고 있습니다`,
      },
      en: {
        label: '🔄 Testing Recovery',
        explanation: `Retrying recovery after ${failures} failures`,
      },
    },
    closed: {
      ko: { label: '✅ 정상', explanation: '자동 복구가 정상 작동 중입니다' },
      en: { label: '✅ Healthy', explanation: 'Auto-recovery is operating normally' },
    },
  };

  const key = state.toLowerCase();
  return labels[key]?.[lang] ?? { label: state, explanation: '' };
}

const KNOWN_TOOLS = [
  'rollback',
  'restart_container',
  'diagnose_crash',
  'stop_project',
  'apply_fixes',
];

export function getToolLabel(
  toolName: string,
  t: (key: string, params?: Record<string, string>) => string,
): { label: string; impact: string } {
  const normalized = toolName.toLowerCase();
  if (!KNOWN_TOOLS.includes(normalized)) {
    return { label: t('operations.approvals.toolRequest', { tool: toolName }), impact: '' };
  }
  const label = t(`operations.tools.${normalized}`);
  const impact = t(`operations.tools.${normalized}_impact`);
  return { label, impact };
}

export function getRiskTone(toolName: string | null): 'destructive' | 'diagnostic' | 'neutral' {
  if (!toolName) {
    return 'neutral';
  }

  const normalized = toolName.toLowerCase();
  if (
    normalized.includes('rollback') ||
    normalized.includes('stop') ||
    normalized.includes('delete') ||
    normalized.includes('purge') ||
    normalized.includes('remove')
  ) {
    return 'destructive';
  }

  if (
    normalized.includes('diagnose') ||
    normalized.includes('debug') ||
    normalized.includes('inspect') ||
    normalized.includes('status') ||
    normalized.includes('log')
  ) {
    return 'diagnostic';
  }

  return 'neutral';
}

export const TOOL_HUMAN_LABELS: Record<
  string,
  { ko: string; en: string; impact_ko: string; impact_en: string }
> = {
  rollback: {
    ko: '이전 버전으로 롤백',
    en: 'Rollback to previous version',
    impact_ko: '서비스 일시 중단 (~15초)',
    impact_en: 'Brief service interruption (~15s)',
  },
  restart_container: {
    ko: '컨테이너 재시작',
    en: 'Restart container',
    impact_ko: '서비스 일시 중단 (~10초)',
    impact_en: 'Brief service interruption (~10s)',
  },
  diagnose_crash: {
    ko: '크래시 원인 분석',
    en: 'Analyze crash cause',
    impact_ko: '변경 없음 (읽기 전용)',
    impact_en: 'No changes (read-only)',
  },
  stop_project: {
    ko: '프로젝트 중지',
    en: 'Stop project',
    impact_ko: '서비스 완전 중단',
    impact_en: 'Full service shutdown',
  },
  apply_fixes: {
    ko: '자동 진단결과 반영',
    en: 'Apply automated fixes',
    impact_ko: '리소스 롤아웃 및 수정 (가능성 있음)',
    impact_en: 'Resource rollout & modifications',
  },
};

export const extractEventType = (type: string | undefined): string => {
  if (!type) return 'unknown';
  if (type.startsWith('ai:')) {
    return 'ai_intervention';
  }
  return type.toLowerCase().replace(/[:\s]+/g, '_');
};

export const humanizeEventType = (type: string, t: (key: string) => string): string => {
  const normalizedKey = extractEventType(type);
  const translated = t(`operations.events.${normalizedKey}`);

  if (translated === `operations.events.${normalizedKey}`) {
    return type.replace(/[:_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return translated;
};

export const humanizeDescription = (
  incident: {
    triggerDetails?: string;
    diagnosis?: string | null;
    title?: string;
    severity?: string;
  },
  t: (key: string) => string,
): string => {
  if (incident.triggerDetails) return incident.triggerDetails;
  if (incident.diagnosis) return incident.diagnosis;
  if (incident.title && incident.title !== `${incident.severity} incident`) return incident.title;
  return t('operations.incidents.generic_error');
};
