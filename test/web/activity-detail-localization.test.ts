import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../../web/src/lib/agentActivity.js';
import {
  localizedActivityDetail,
  localizedActivityRelativeTime,
  localizedActivityTitle,
} from '../../web/src/lib/activity-presentation.js';
import { translations as ko } from '../../web/src/i18n/ko.js';

type TranslationTree = Record<string, string | TranslationTree>;

function t(key: string, params?: Record<string, string | number>): string {
  const value = key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, ko as TranslationTree);
  if (typeof value !== 'string') return key;
  return Object.entries(params ?? {}).reduce(
    (message, [name, replacement]) => message.replaceAll(`{${name}}`, String(replacement)),
    value,
  );
}

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 'activity-1',
    actor: 'system',
    kind: 'service_crashed',
    at: 'Just now',
    relTs: 0,
    project: 'project-1',
    service: 'service-1',
    title: 'Service crashed',
    ...overrides,
  };
}

describe('Activity detail localization', () => {
  it('uses structured system detail instead of legacy English prose', () => {
    const value = event({
      detail: 'exit 137 · restart_loop · restart ×4',
      detailCode: 'service_crashed',
      detailParams: { exitCode: 137, restartCount: 4 },
    });

    expect(localizedActivityDetail(value, t)).toBe('종료 코드 137 · 재시작 4회');
  });

  it('preserves user-authored deploy detail when no system detail code is present', () => {
    const value = event({ kind: 'deploy_completed', detail: '고객 작성 커밋 메시지' });

    expect(localizedActivityDetail(value, t)).toBe('고객 작성 커밋 메시지');
  });

  it('localizes system titles and relative time while preserving a commit SHA', () => {
    const value = event({
      kind: 'deploy_completed',
      title: 'Deploy succeeded · 7af3c12',
      at: '5m ago',
      relTs: 300,
    });

    expect(localizedActivityTitle(value, t)).toBe('배포 성공 · 7af3c12');
    expect(localizedActivityRelativeTime(value, t)).toBe('5분 전');
  });

  it('keeps protected-share actions distinct from generic configuration changes', () => {
    const value = event({
      kind: 'config_changed',
      title: 'Protected share code changed',
      titleCode: 'public_access_code_rotated',
      detail: 'web · web.example.com',
    });

    expect(localizedActivityTitle(value, t)).toBe('보호 공유 코드 변경');
    expect(localizedActivityDetail(value, t)).toBe('web · web.example.com');
  });
});
