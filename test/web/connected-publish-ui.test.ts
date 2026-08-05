import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Connected Publish UI', () => {
  const projectView = readRepoFile('web/src/pages/ProjectView.tsx');
  const publicControl = readRepoFile('web/src/components/project/PublicAccessControl.tsx');
  const webServer = readRepoFile('web/src/pages/settings/WebServer.tsx');
  const connectionCard = readRepoFile('web/src/components/settings/ConnectedPublishCard.tsx');
  const cloudflareApi = readRepoFile('web/src/lib/api/cloudflare.ts');
  const callback = readRepoFile('web/public/cloudflare-oauth-callback.html');
  const server = readRepoFile('src/web/server.ts');
  const connectedPublish = readRepoFile('src/pipeline/connected-publish.ts');
  const runtimeCompose = readRepoFile('docker-compose.runtime.yml');
  const en = readRepoFile('web/src/i18n/en.ts');
  const ko = readRepoFile('web/src/i18n/ko.ts');

  it('keeps the Project action to publish, open/copy, and stop only', () => {
    expect(projectView).toContain('<PublicAccessControl');
    expect(publicControl).toContain('exposeProject(projectId)');
    expect(publicControl).toContain('unexposeProject(projectId)');
    expect(publicControl).toContain('copyToClipboard(access.public_url!)');
    expect(publicControl).toContain('target="_blank"');
    expect(publicControl).not.toMatch(/service selector|access code|expires|temporary link/i);
  });

  it('refreshes Project service links when publishing or stopping settles', () => {
    expect(publicControl).toContain('onAccessSettled?: () => void');
    expect(publicControl).toContain("previousStatus !== nextAccess.status");
    expect(publicControl).toContain('onAccessSettled?.()');
    expect(projectView).toContain('onAccessSettled={handlePublicAccessSettled}');
    expect(projectView).toContain('void refetchGroupServices()');
    expect(projectView).toContain('void refetchProjects()');
  });

  it('places one OAuth and Zone connection card on the existing Web Server page', () => {
    expect(webServer).toContain('<ConnectedPublishCard />');
    expect(connectionCard).toContain('startCloudflareOAuth()');
    expect(connectionCard).toContain('completeCloudflareOAuth');
    expect(connectionCard).toContain('connectCloudflare');
    expect(connectionCard).toContain('listCloudflareZones');
    expect(connectionCard).toContain('disconnectCloudflare');
    expect(connectionCard).toContain('<DropdownMenu');
    expect(connectionCard).toContain('<ConfirmDialog');
    expect(connectionCard).toContain('id="public-access"');
  });

  it('offers an in-place repair without forcing OAuth when the connector stops', () => {
    expect(connectionCard).toContain('const repairConnection = async () =>');
    expect(connectionCard).toContain(
      'connectCloudflare(connection.account.id, connection.zone.id)',
    );
    expect(connectionCard).toContain("t('webServer.publicAccess.repair')");
    expect(connectionCard).toContain('!connectionHealthy');
    expect(connectionCard).toContain("connection?.error?.code === 'CLOUDFLARE_NOT_CONNECTED'");
    expect(connectionCard).toContain('connectionNeedsOAuth ? beginOAuth() : repairConnection()');
  });

  it('returns to the Project and resumes the publish intent after connecting', () => {
    expect(publicControl).toContain("intent: 'publish'");
    expect(publicControl).toContain('returnTo: `/projects/${encodeURIComponent(projectId)}`');
    expect(connectionCard).toContain('publishReturnTarget(location.search)');
    expect(connectionCard).toContain('state: { resumePublicAccess: true }');
    expect(publicControl).toContain('state?.resumePublicAccess !== true');
    expect(publicControl).toContain('void publish()');
  });

  it('explains an ineligible Project and confirms destructive stop actions', () => {
    expect(projectView).toContain('publicAccessDisabledReason');
    expect(publicControl).toContain('publishDisabledReason');
    expect(publicControl).toContain('setStopConfirmOpen(true)');
    expect(publicControl).toContain('variant="destructive"');
    expect(publicControl).toContain('max-w-[45vw]');
  });

  it('opens the OAuth popup synchronously before awaiting the start request', () => {
    const popupIndex = connectionCard.indexOf("window.open(\n      'about:blank'");
    const startRequestIndex = connectionCard.indexOf('await startCloudflareOAuth()');

    expect(popupIndex).toBeGreaterThan(-1);
    expect(startRequestIndex).toBeGreaterThan(popupIndex);
    const listenerIndex = connectionCard.indexOf('const callbackPromise = waitForOAuthPopup(');
    const navigationIndex = connectionCard.indexOf('popup.location.replace(start.auth_url)');

    expect(listenerIndex).toBeGreaterThan(startRequestIndex);
    expect(navigationIndex).toBeGreaterThan(listenerIndex);
    expect(connectionCard).toContain('const callback = await callbackPromise');
  });

  it('uses the fixed callback only as a code/state message bridge', () => {
    expect(callback).toContain("type: 'openlander:cloudflare-oauth'");
    expect(callback).toContain("code: params.get('code')");
    expect(callback).toContain("state: params.get('state')");
    expect(callback).toContain('window.opener.postMessage');
    expect(callback).not.toMatch(/fetch\(|localStorage|sessionStorage/);
  });

  it('serves the OAuth callback before the SPA fallback without caching it', () => {
    const callbackRoute = server.indexOf("app.get('/cloudflare-oauth-callback.html'");
    const spaFallback = server.indexOf("app.get('*'");

    expect(callbackRoute).toBeGreaterThan(-1);
    expect(callbackRoute).toBeLessThan(spaFallback);
    expect(server.slice(callbackRoute, spaFallback)).toContain("'Cache-Control': 'no-store'");
  });

  it('shares only the tunnel token volume with the containerized connector', () => {
    expect(runtimeCompose).toContain('openlander-cloudflare:/run/openlander/cloudflare');
    expect(runtimeCompose).toContain(
      'name: ${OPENLANDER_DATA_VOLUME:-openlander-data}-cloudflare',
    );
    expect(connectedPublish).toContain("Type: 'volume' as const");
    expect(connectedPublish).toContain('Source: `${dataVolume}-cloudflare`');
    expect(connectedPublish).toContain('Target: CLOUDFLARED_TOKEN_DIR');
    expect(connectedPublish).not.toContain(
      'Binds: [`${tokenPath}:${CLOUDFLARED_TOKEN_PATH}:ro`],',
    );
  });

  it('uses only the connected-publish setup and Project status endpoints', () => {
    expect(cloudflareApi).toContain("'/api/setup/cloudflare/oauth/start'");
    expect(cloudflareApi).toContain("'/api/setup/cloudflare/oauth/complete'");
    expect(cloudflareApi).toContain("'/api/setup/cloudflare/connect'");
    expect(cloudflareApi).toContain("'/api/setup/cloudflare/disconnect'");
    expect(publicControl).toContain(
      'navigate(`/settings/web-server?${params.toString()}#public-access`)',
    );
  });

  it('ships the public access copy in English and Korean together', () => {
    for (const locale of [en, ko]) {
      expect(locale).toMatch(/publicAccess:\s*\{/);
      expect(locale).toMatch(/publish:/);
      expect(locale).toMatch(/copy:/);
      expect(locale).toMatch(/stop:/);
      expect(locale).toMatch(/connectedToast:/);
    }
  });
});
