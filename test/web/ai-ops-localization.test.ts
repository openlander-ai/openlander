import { describe, expect, it } from 'vitest';
import { translations as en } from '../../web/src/i18n/en.js';
import { translations as ko } from '../../web/src/i18n/ko.js';
import {
  localizedBriefingClassification,
  localizedBriefingSummary,
  localizedBriefingTitle,
} from '../../web/src/lib/ai-ops-presentation.js';
import type { AiOpsBriefing } from '../../web/src/lib/api/ai-ops.js';

type TranslationTree = Record<string, string | TranslationTree>;

function translator(dictionary: TranslationTree) {
  return (key: string, params?: Record<string, string | number>) => {
    const value = key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[segment];
    }, dictionary);
    if (typeof value !== 'string') return key;
    return Object.entries(params ?? {}).reduce(
      (message, [name, replacement]) => message.replaceAll(`{${name}}`, String(replacement)),
      value,
    );
  };
}

function briefing(overrides: Partial<AiOpsBriefing> = {}): AiOpsBriefing {
  return {
    briefing_id: 'briefing-1',
    project_id: 'project-1',
    service_id: 'service-1',
    status: 'open',
    severity: 'high',
    classification: 'container_exited',
    title: 'Service container exited',
    summary: 'The api container exited with code 137.',
    summary_source: 'deterministic',
    summary_status: 'fallback',
    summary_truncated: false,
    deterministic_summary: 'The api container exited with code 137.',
    fingerprint: 'container-exited:137',
    dedupe_key: null,
    suggested_call: null,
    created_at: '2026-07-26T00:00:00.000Z',
    updated_at: '2026-07-26T00:00:00.000Z',
    presentation: {
      title_code: 'container_exited',
      summary_code: 'container_exited_with_code',
      params: { exitCode: 137 },
    },
    ...overrides,
  };
}

describe('AI Ops briefing localized presentation', () => {
  it('renders Korean from codes without exposing the legacy English title or summary', () => {
    const value = briefing();
    const t = translator(ko as TranslationTree);

    expect(localizedBriefingTitle(value, t)).toBe('서비스 컨테이너가 중지되었습니다');
    expect(localizedBriefingSummary(value, t)).toBe(
      '서비스 컨테이너가 중지되었습니다. 종료 코드: 137',
    );
    expect(localizedBriefingClassification(value, t)).toBe('컨테이너 중지');
  });

  it('falls back to localized generic copy for an unknown server classification', () => {
    const value = briefing({ classification: 'future_code', presentation: undefined });

    expect(localizedBriefingTitle(value, translator(en as TranslationTree))).toBe(
      'Operational evidence needs review',
    );
    expect(localizedBriefingTitle(value, translator(ko as TranslationTree))).toBe(
      '운영 상태를 확인해야 합니다',
    );
  });
});
