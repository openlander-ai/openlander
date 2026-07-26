import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from '../../web/src/lib/api/client.js';
import { localizeApiError } from '../../web/src/lib/localized-api-error.js';

const messages: Record<string, string> = {
  'engagements.errors.load': '고객 과제를 불러오지 못했습니다.',
  'engagements.errors.codes.ENGAGEMENT_NOT_FOUND': '고객 과제를 찾을 수 없습니다.',
};

const t = (key: string): string => messages[key] ?? key;

describe('localized API errors', () => {
  it('shows a localized domain message with the stable diagnostic code', () => {
    const error = new ApiError('Engagement "01" was not found.', 404, {
      code: 'ENGAGEMENT_NOT_FOUND',
    });

    expect(localizeApiError(error, t, 'engagements.errors.load', 'engagements.errors.codes')).toBe(
      '고객 과제를 찾을 수 없습니다. (ENGAGEMENT_NOT_FOUND)',
    );
  });

  it('falls back without leaking unknown English server prose', () => {
    const error = new ApiError('Unexpected internal wording.', 409, { code: 'UNKNOWN_CODE' });

    expect(localizeApiError(error, t, 'engagements.errors.load', 'engagements.errors.codes')).toBe(
      '고객 과제를 불러오지 못했습니다. (UNKNOWN_CODE)',
    );
  });

  it('keeps HTTP status for API responses without a code', () => {
    const error = new ApiError('Gateway failed.', 502);

    expect(localizeApiError(error, t, 'engagements.errors.load', 'engagements.errors.codes')).toBe(
      '고객 과제를 불러오지 못했습니다. (HTTP 502)',
    );
  });

  it('does not mistake a legacy English error sentence for a diagnostic code', () => {
    const error = new ApiError('Invalid password', 401, { error: 'Invalid password' });

    expect(error.code).toBeUndefined();
    expect(localizeApiError(error, t, 'engagements.errors.load', 'engagements.errors.codes')).toBe(
      '고객 과제를 불러오지 못했습니다. (HTTP 401)',
    );
  });

  it('keeps a legacy uppercase error identifier as a diagnostic code', () => {
    const error = new ApiError('Deployment is no longer active', 409, {
      error: 'DEPLOYMENT_NOT_ACTIVE',
    });

    expect(error.code).toBe('DEPLOYMENT_NOT_ACTIVE');
  });

  it('rejects prose supplied in the nominal code field', () => {
    const error = new ApiError('Invalid password', 401, { code: 'Invalid password' });

    expect(error.code).toBeUndefined();
  });

  it('uses the selected-locale fallback for non-API errors', () => {
    expect(
      localizeApiError(
        new Error('Internal English detail.'),
        t,
        'engagements.errors.load',
        'engagements.errors.codes',
      ),
    ).toBe('고객 과제를 불러오지 못했습니다.');
  });

  it('keeps user-facing request failures out of raw message paths', () => {
    const sources = [
      'web/src/pages/LoginPage.tsx',
      'web/src/pages/ProjectsGrid.tsx',
      'web/src/pages/settings/AiProviders.tsx',
      'web/src/pages/MCPServer.tsx',
      'web/src/pages/settings/SSHKeys.tsx',
      'web/src/pages/settings/Notifications.tsx',
      'web/src/pages/settings/WebServer.tsx',
      'web/src/pages/ProjectView.tsx',
      'web/src/pages/ServiceDetailV2.tsx',
      'web/src/pages/settings/GitProviders.tsx',
      'web/src/components/settings/GithubSettingsTab.tsx',
      'web/src/components/setup/McpGuideStep.tsx',
      'web/src/components/setup/SetupScreen.tsx',
      'web/src/components/git-credentials/GitCredentialWizard.tsx',
      'web/src/components/project/AddServiceDialog.tsx',
      'web/src/components/account/ChangePasswordModal.tsx',
      'web/src/components/service/ServiceDatabasesTab.tsx',
      'web/src/components/service/ServiceLogViewer.tsx',
      'web/src/components/service/CreateServiceDialog.tsx',
      'web/src/components/delivery/DeliveriesTab.tsx',
      'web/src/components/Shell/LogViewer.tsx',
      'web/src/components/Shell/PendingApprovalsStrip.tsx',
      'web/src/components/ai-ops/AiOpsBriefingFeed.tsx',
      'web/src/components/ai-ops/AiOpsBriefingPanel.tsx',
      'web/src/components/project/ProjectAiOpsTab.tsx',
    ].map((file) => readFileSync(path.join(process.cwd(), file), 'utf8'));

    for (const source of sources) {
      expect(source).not.toMatch(/instanceof Error\s*\?\s*\w+\.message/);
    }

    expect(
      readFileSync(path.join(process.cwd(), 'web/src/pages/settings/AiProviders.tsx'), 'utf8'),
    ).not.toContain('response.health.error');
  });

  it('keeps API wrappers on the structured ApiError boundary', () => {
    for (const file of [
      'web/src/lib/api/projects.ts',
      'web/src/lib/api/system.ts',
      'web/src/lib/api/deliveries.ts',
      'web/src/lib/api/notifications.ts',
      'web/src/lib/api/services.ts',
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source, file).not.toContain('throw new Error');
    }
  });
});
