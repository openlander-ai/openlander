import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('AI Providers settings page', () => {
  const pageSource = readRepoFile('web/src/pages/settings/AiProviders.tsx');
  const apiSource = readRepoFile('web/src/lib/api/ai-providers.ts');
  const sidebarSource = readRepoFile('web/src/components/Shell/Sidebar.tsx');
  const appSource = readRepoFile('web/src/App.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');
  const backendRouteSource = readRepoFile('src/web/api/ai-provider-routes.ts');
  const apiIndexSource = readRepoFile('src/web/api/routes.ts');

  it('mounts AI Providers under the Settings sidebar section', () => {
    expect(sidebarSource).toContain("id: 'ai-providers'");
    expect(sidebarSource).toContain("labelKey: 'sidebar.items.aiProviders'");
    expect(sidebarSource).toContain("to: '/settings/ai-providers'");
    expect(appSource).toContain('path="/settings/ai-providers"');
    expect(appSource).toContain('<AiProvidersSettings />');
  });

  it('uses the typed API wrapper for provider save/test/delete', () => {
    expect(apiSource).toContain("'/api/settings/ai-providers'");
    expect(apiSource).toContain("'/api/settings/ai-providers/ai-ops-briefing'");
    expect(apiSource).toContain("'/api/settings/ai-providers/ai-ops-briefing/test'");
    expect(pageSource).toContain('saveAiOpsProvider');
    expect(pageSource).toContain('testAiOpsProvider');
    expect(pageSource).toContain('deleteAiOpsProvider');
  });

  it('keeps provider setup separate from Project AI Ops opt-in', () => {
    expect(pageSource).toContain("t('aiProviders.policyTitle')");
    expect(pageSource).toContain('t(`aiProviders.scope.${key}.body`)');
    expect(enSource).toContain("title: 'Project AI Ops'");
    expect(koSource).toContain("title: '프로젝트 AI Ops'");
    expect(backendRouteSource).toContain('ai_ops_enabled_by_provider: false');
    expect(backendRouteSource).not.toContain('setAiOpsProjectPolicy');
  });

  it('supports OpenAI-compatible, Anthropic, and Gemini without exposing API keys', () => {
    expect(pageSource).toContain('<SelectItem value="openai">OpenAI-compatible</SelectItem>');
    expect(pageSource).toContain('<SelectItem value="anthropic">Anthropic API</SelectItem>');
    expect(pageSource).toContain('<SelectItem value="gemini">Gemini API</SelectItem>');
    expect(pageSource).toContain("gemini: 'gemini-2.5-flash'");
    expect(pageSource).toContain('type="password"');
    expect(apiSource).toContain('api_key_configured: boolean');
    expect(backendRouteSource).toContain('encryptedApiKey');
    expect(backendRouteSource).not.toContain('api_key: entry');
  });

  it('registers the backend route and i18n keys in both locales', () => {
    expect(apiIndexSource).toContain('createAiProviderRoutes');
    for (const source of [enSource, koSource]) {
      expect(source).toContain('aiProviders:');
      expect(source).toContain('title:');
      expect(source).toContain('policyTitle:');
      expect(source).toContain('baseUrl:');
      expect(source).toContain('testPassed:');
    }
  });
});
