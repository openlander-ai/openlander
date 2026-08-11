import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Connected Publish UI', () => {
  const projectView = readRepoFile('web/src/pages/ProjectView.tsx');
  const serviceDetail = readRepoFile('web/src/pages/ServiceDetailV2.tsx');
  const publicControl = readRepoFile('web/src/components/project/PublicAccessControl.tsx');
  const webServer = readRepoFile('web/src/pages/settings/WebServer.tsx');
  const protectedShareCard = readRepoFile(
    'web/src/components/settings/ProtectedShareSettingsCard.tsx',
  );
  const connectionCard = readRepoFile('web/src/components/settings/ConnectedPublishCard.tsx');
  const cloudflareApi = readRepoFile('web/src/lib/api/cloudflare.ts');
  const callback = readRepoFile('web/public/cloudflare-oauth-callback.html');
  const callbackScript = readRepoFile('web/public/cloudflare-oauth-callback.js');
  const publisherCallback = readRepoFile(
    'publisher/cloudflare-oauth/cloudflare-oauth-callback.html',
  );
  const publisherCallbackScript = readRepoFile(
    'publisher/cloudflare-oauth/cloudflare-oauth-callback.js',
  );
  const publisherHeaders = readRepoFile('publisher/cloudflare-oauth/_headers');
  const publisherConfig = readRepoFile('src/config/cloudflare-publisher.ts');
  const server = readRepoFile('src/web/server.ts');
  const connectedPublish = readRepoFile('src/pipeline/connected-publish.ts');
  const runtimeCompose = readRepoFile('docker-compose.runtime.yml');
  const en = readRepoFile('web/src/i18n/en.ts');
  const ko = readRepoFile('web/src/i18n/ko.ts');

  it('places protected sharing on each Application and supports URL, code rotation, and stop', () => {
    expect(projectView).not.toContain('<PublicAccessControl');
    expect(serviceDetail).toContain('<PublicAccessControl');
    expect(serviceDetail).toContain('serviceId={resolvedService.id}');
    expect(publicControl).toContain('exposeService(projectId, serviceId');
    expect(publicControl).toContain('unexposeService(projectId, serviceId, provider)');
    expect(publicControl).toContain('nextAccess.access_code ?? null');
    expect(publicControl).toContain('rotateAccessCode');
    expect(publicControl).toContain('target="_blank"');
  });

  it('refreshes Application metadata when sharing or stopping settles', () => {
    expect(publicControl).toContain('onAccessSettled?: () => void');
    expect(publicControl).toContain('previousStatus !== nextStatus');
    expect(publicControl).toContain('onAccessSettled?.()');
    expect(serviceDetail).toContain('onAccessSettled={loadServiceDetail}');
  });

  it('places protected share setup before the optional Cloudflare card', () => {
    expect(webServer).toContain('<ProtectedShareSettingsCard');
    expect(webServer).toContain("route.source === 'protected_share'");
    expect(webServer).toContain('onSharesChanged={routes.reload}');
    expect(webServer).toContain('<ConnectedPublishCard />');
    expect(webServer.indexOf('<ProtectedShareSettingsCard />')).toBeLessThan(
      webServer.indexOf('<ConnectedPublishCard />'),
    );
    expect(protectedShareCard).toContain('getProtectedShareSettings()');
    expect(protectedShareCard).toContain('saveProtectedShareSettings');
    expect(protectedShareCard).toContain('settings.detectedPublicIp');
    expect(protectedShareCard).toContain('<Collapsible');
    expect(protectedShareCard).toContain('certificateSettingsOpen');
    expect(protectedShareCard).toContain('id="public-access"');
    expect(protectedShareCard).toContain('exposeService(route.projectId, route.serviceId');
    expect(protectedShareCard).toContain(
      "unexposeService(route.projectId, route.serviceId, 'protected_share')",
    );
    expect(protectedShareCard).toContain('rotateAccessCode: true');
    expect(protectedShareCard).toContain('setRevealedCode');
    expect(protectedShareCard).toContain('copyToClipboard');
    expect(connectionCard).toContain('startCloudflareOAuth()');
    expect(connectionCard).toContain('getCloudflareConnection()');
    expect(connectionCard).toContain('connectCloudflare');
    expect(connectionCard).toContain('listCloudflareZones');
    expect(connectionCard).toContain('disconnectCloudflare');
    expect(connectionCard).toContain("error.code === 'CLOUDFLARE_NOT_CONNECTED'");
    expect(connectionCard).toContain("error.code === 'CLOUDFLARE_UNREACHABLE'");
    expect(connectionCard).toContain('cloudflareUnreachable');
    expect(connectionCard).toContain('disconnectNeedsReconnect');
    expect(connectionCard).toContain('<DropdownMenu');
    expect(connectionCard).toContain('<ConfirmDialog');
    expect(connectionCard).toContain('id="connected-publish"');
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

  it('offers Cloudflare only as an explicit method when the connection exists', () => {
    expect(connectionCard).toContain('publishReturnTarget(location.search)');
    expect(connectionCard).toContain('state: { resumePublicAccess: true }');
    expect(publicControl).not.toContain('resumePublicAccess');
    expect(publicControl).toContain('getCloudflareConnection()');
    expect(publicControl).toContain("publish('cloudflare')");
    expect(publicControl).toContain('methodDialogOpen');
    expect(publicControl).toContain('cloudflareBusyElsewhere');
    expect(publicControl).toContain('cloudflareVerifying');
    expect(publicControl).toContain('PUBLIC_ACCESS_ROUTE_UNREACHABLE');
    expect(publicControl).toContain('PUBLIC_ACCESS_APPLICATION_UNHEALTHY');
    expect(publicControl).toContain('CLOUDFLARE_UNREACHABLE');
    expect(publicControl).toContain('cloudflareUnavailable');
    expect(publicControl).toContain('entrypointNote');
  });

  it('explains an ineligible Application and confirms session-invalidating actions', () => {
    expect(publicControl).toContain('publishDisabledReason');
    expect(publicControl).toContain('setStopConfirmOpen(true)');
    expect(publicControl).toContain('setRotateConfirmOpen(true)');
    expect(publicControl).toContain('variant="destructive"');
    expect(publicControl).toContain("t('projectDetail.publicAccess.rotateDescription')");
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
    expect(connectionCard).toContain('const authorized = await callbackPromise');
  });

  it('bridges OAuth code and state to the authenticated opener for local completion', () => {
    expect(callback).toContain('<script src="/cloudflare-oauth-callback.js"></script>');
    expect(callback).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(callbackScript).toContain("type: 'openlander:cloudflare-oauth'");
    expect(callbackScript).not.toContain("fetch('/api/setup/cloudflare/oauth/complete'");
    expect(callbackScript).toContain("status: 'authorized'");
    expect(callbackScript).toContain('code,');
    expect(callbackScript).toContain('state,');
    expect(callbackScript).toContain("'openlander:cloudflare-oauth:ack'");
    expect(callbackScript).toContain('window.opener.postMessage');
    expect(callbackScript).toContain(
      "window.history.replaceState(null, '', window.location.pathname)",
    );
    expect(callback).toContain('Return to OpenLander');
    expect(callbackScript).toContain("postMessage(payload, '*')");
    expect(callbackScript).not.toMatch(/localStorage|sessionStorage/);
    expect(callback).toContain('name="referrer" content="no-referrer"');
    expect(callback).toContain('Content-Security-Policy');
    expect(connectionCard).toContain("type: 'openlander:cloudflare-oauth:ack'");
    expect(connectionCard).toContain('completeCloudflareOAuth(authorized.code, authorized.state)');
    expect(connectionCard).toContain('event.origin !== callbackOrigin');
    expect(connectionCard).toContain('event.source !== popup');
  });

  it('keeps the official publisher callback aligned with the packaged bridge', () => {
    expect(publisherCallback).toBe(callback);
    expect(publisherCallbackScript).toBe(callbackScript);
    expect(publisherHeaders).toContain('Cache-Control: no-store');
    expect(publisherHeaders).toContain('/cloudflare-oauth-callback\n  Cache-Control: no-store');
    expect(publisherHeaders).toContain('Referrer-Policy: no-referrer');
    expect(publisherHeaders).not.toContain('Cross-Origin-Opener-Policy');
    expect(publisherConfig).toContain(
      "'https://openlander.dongbin.cloud/cloudflare-oauth-callback'",
    );
  });

  it('serves the OAuth callback before the SPA fallback without caching it', () => {
    const callbackScriptRoute = server.indexOf("app.get('/cloudflare-oauth-callback.js'");
    const callbackRoute = server.indexOf("app.get('/cloudflare-oauth-callback.html'");
    const spaFallback = server.indexOf("app.get('*'");

    expect(callbackScriptRoute).toBeGreaterThan(-1);
    expect(callbackScriptRoute).toBeLessThan(callbackRoute);
    expect(callbackRoute).toBeGreaterThan(-1);
    expect(callbackRoute).toBeLessThan(spaFallback);
    expect(server.slice(callbackScriptRoute, callbackRoute)).toContain(
      "'Cache-Control': 'no-store'",
    );
    expect(server.slice(callbackScriptRoute, callbackRoute)).toContain(
      "'Content-Type': 'text/javascript; charset=UTF-8'",
    );
    expect(server.slice(callbackScriptRoute, callbackRoute)).toContain(
      "'Referrer-Policy': 'no-referrer'",
    );
    expect(server.slice(callbackScriptRoute, callbackRoute)).toContain(
      "'X-Content-Type-Options': 'nosniff'",
    );
    expect(server.slice(callbackRoute, spaFallback)).toContain("'Cache-Control': 'no-store'");
    expect(server.slice(callbackRoute, spaFallback)).toContain("frame-ancestors 'none'");
  });

  it('shares only the tunnel token volume with the containerized connector', () => {
    expect(runtimeCompose).toContain('openlander-cloudflare:/run/openlander/cloudflare');
    expect(runtimeCompose).toContain('name: ${OPENLANDER_DATA_VOLUME:-openlander-data}-cloudflare');
    expect(connectedPublish).toContain("Type: 'volume' as const");
    expect(connectedPublish).toContain('Source: `${dataVolume}-cloudflare`');
    expect(connectedPublish).toContain('Target: CLOUDFLARED_TOKEN_DIR');
    expect(connectedPublish).not.toContain('Binds: [`${tokenPath}:${CLOUDFLARED_TOKEN_PATH}:ro`],');
  });

  it('keeps Cloudflare setup endpoints separate from service publishing', () => {
    expect(cloudflareApi).toContain("'/api/setup/cloudflare/oauth/start'");
    expect(cloudflareApi).toContain("'/api/setup/cloudflare/oauth/complete'");
    expect(cloudflareApi).toContain("'/api/setup/cloudflare/connect'");
    expect(cloudflareApi).toContain("'/api/setup/cloudflare/disconnect'");
    expect(publicControl).toContain("error.code === 'PROTECTED_SHARE_SETUP_REQUIRED'");
    expect(publicControl).toContain("error.code === 'PROTECTED_SHARE_HTTPS_PORT_UNAVAILABLE'");
    expect(publicControl).toContain('showProtectedShareSetup()');
    expect(publicControl).toContain('getProtectedShareSettings()');
    expect(publicControl).toContain('saveProtectedShareSettings({');
    expect(publicControl).toContain('setupDialogOpen');
    expect(publicControl).not.toContain("navigate('/settings/web-server#public-access')");
    expect(publicControl).toContain("navigate('/settings/web-server#connected-publish')");
  });

  it('collects direct-share setup only at first use and reuses the global settings', () => {
    expect(publicControl).toContain("t('projectDetail.publicAccess.setupTitle')");
    expect(publicControl).toContain('next.publicHost || next.detectedPublicIp');
    expect(publicControl).toContain("await publish('protected_share')");
    expect(publicControl).toContain('id="public-share-setup-email"');
    expect(protectedShareCard).toContain("t('webServer.protectedShare.certificateSettings')");
  });

  it('ships the public access copy in English and Korean together', () => {
    for (const locale of [en, ko]) {
      expect(locale).toMatch(/publicAccess:\s*\{/);
      expect(locale).toMatch(/publish:/);
      expect(locale).toMatch(/copy:/);
      expect(locale).toMatch(/stop:/);
      expect(locale).toMatch(/rotateCode:/);
      expect(locale).toMatch(/methodProtected:/);
      expect(locale).toMatch(/methodCloudflare:/);
      expect(locale).toMatch(/httpsPortUnavailable:/);
      expect(locale).toMatch(/protectedShare:\s*\{/);
      expect(locale).toMatch(/securityNote:/);
      expect(locale).toMatch(/connectedToast:/);
      expect(locale).toMatch(/cloudflareUnreachable:/);
      expect(locale).toMatch(/cloudflareVerifying:/);
      expect(locale).toMatch(/cloudflareUnavailable:/);
      expect(locale).toMatch(/routeUnreachable:/);
      expect(locale).toMatch(/applicationUnhealthy:/);
      expect(locale).toMatch(/entrypointNote:/);
    }
  });
});
