import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppContext } from '../../app.js';
import {
  PROTECTED_SHARE_COOKIE,
  PROTECTED_SHARE_SESSION_TTL_SECONDS,
  PROTECTED_SHARE_VERIFY_MAX_ATTEMPTS,
  PROTECTED_SHARE_VERIFY_WINDOW_SECONDS,
  type ProtectedShareTarget,
} from '../../pipeline/protected-public-share.js';
import { checkRateLimit, clientIp } from '../middleware/rate-limit.js';
import { parseCookie } from '../middleware/cookies.js';

function requestHostname(c: Context): string {
  const forwarded = c.req.header('x-forwarded-host')?.split(',')[0]?.trim();
  return (forwarded || c.req.header('host') || '').replace(/:\d+$/, '').toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeNextPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  const candidate = value.slice(0, 2048);
  let hasControlCharacter = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const codeUnit = candidate.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) {
      hasControlCharacter = true;
      break;
    }
  }
  if (candidate.includes('\\') || hasControlCharacter) return '/';
  try {
    const base = new URL('https://protected-share.invalid');
    const target = new URL(candidate, base);
    if (target.origin !== base.origin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

function koreanRequested(acceptLanguage: string | undefined): boolean {
  return Boolean(
    acceptLanguage
      ?.toLowerCase()
      .split(',')
      .some((value) => value.trim().startsWith('ko')),
  );
}

function sameHostFormOrigin(c: Context, hostname: string): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;

  // Some embedded browsers serialize a top-level form navigation from an
  // HTTP 401 document with an opaque `Origin: null`. Fetch Metadata remains
  // browser-controlled, so accept only an explicitly same-site user
  // navigation and keep rejecting cross-site form posts.
  if (origin === 'null') {
    const site = c.req.header('sec-fetch-site');
    return (
      (site === 'same-origin' || site === 'none') &&
      c.req.header('sec-fetch-mode') === 'navigate' &&
      c.req.header('sec-fetch-dest') === 'document'
    );
  }

  try {
    return new URL(origin).hostname.toLowerCase() === hostname;
  } catch {
    return false;
  }
}

function accessPage(params: {
  target: ProtectedShareTarget;
  nextPath: string;
  korean: boolean;
  error?: 'invalid' | 'limited';
}): string {
  const copy = params.korean
    ? {
        brand: 'OpenLander',
        title: params.target.project.name,
        description: '공유 코드를 입력하면 앱을 열 수 있습니다.',
        label: '공유 코드',
        placeholder: 'XXXX-XXXX',
        submit: '앱 열기',
        trust: 'OpenLander 보호 공유',
        invalid: '공유 코드가 올바르지 않습니다.',
        limited: '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
      }
    : {
        brand: 'OpenLander',
        title: params.target.project.name,
        description: 'Enter the share code to open this app.',
        label: 'Share code',
        placeholder: 'XXXX-XXXX',
        submit: 'Open app',
        trust: 'Protected by OpenLander',
        invalid: 'That share code is not valid.',
        limited: 'Too many attempts. Try again in a few minutes.',
      };
  const error = params.error ? copy[params.error] : '';
  return `<!doctype html>
<html lang="${params.korean ? 'ko' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#fbfcfd">
  <title>${escapeHtml(copy.title)} · OpenLander</title>
  <style>
    :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#fbfcfd;color:#17191c;--primary:oklch(0.62 0.16 152);--primary-hover:oklch(0.56 0.17 152);--error:oklch(0.58 0.19 25)}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 24px;background:#fbfcfd;-webkit-font-smoothing:antialiased}
    main{width:min(100%,360px)}
    header{text-align:center;margin-bottom:28px}
    .brand{margin:0 0 28px;color:#17191c;font-size:30px;font-weight:750;letter-spacing:-.035em}
    h1{margin:0 0 8px;color:#17191c;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.025em;overflow-wrap:anywhere}
    .description{margin:0;color:#686d74;font-size:14px;line-height:1.55}
    label{display:block;margin-bottom:8px;color:#30343a;font-size:13px;font-weight:600}
    input{width:100%;height:42px;border:1px solid #d8dce1;border-radius:8px;background:#fff;color:#17191c;padding:0 12px;font:600 15px ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
    input::placeholder{color:#a1a6ad;font-weight:500}
    input:focus{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in oklch,var(--primary) 14%,transparent)}
    .error{margin:8px 0 0;color:var(--error);font-size:12px;line-height:1.45}
    button{width:100%;height:40px;border:0;border-radius:8px;background:var(--primary);color:#fff;font:650 14px Inter,ui-sans-serif,system-ui,sans-serif;margin-top:16px;cursor:pointer;transition:background .15s ease,transform .15s ease}
    button:hover{background:var(--primary-hover)}
    button:active{transform:translateY(1px)}
    button:focus-visible{outline:3px solid color-mix(in oklch,var(--primary) 24%,transparent);outline-offset:2px}
    footer{margin-top:24px;color:#969ba2;font-size:12px;line-height:1.5;text-align:center}
    @media(max-width:480px){body{padding:24px 20px}header{margin-bottom:24px}.brand{margin-bottom:24px;font-size:28px}}
    @media(prefers-reduced-motion:reduce){input,button{transition:none}}
  </style>
</head>
<body><main>
  <header>
    <p class="brand">${escapeHtml(copy.brand)}</p>
    <h1>${escapeHtml(copy.title)}</h1>
    <p class="description">${escapeHtml(copy.description)}</p>
  </header>
  <form method="post" action="/__openlander/share/verify">
    <input type="hidden" name="next" value="${escapeHtml(params.nextPath)}">
    <label for="access-code">${escapeHtml(copy.label)}</label>
    <input id="access-code" name="access_code" type="text" inputmode="text" autocomplete="one-time-code" maxlength="128" placeholder="${copy.placeholder}" required autofocus${error ? ' aria-invalid="true" aria-describedby="access-code-error"' : ''}>
    ${error ? `<div id="access-code-error" class="error" role="alert">${escapeHtml(error)}</div>` : ''}
    <button type="submit">${escapeHtml(copy.submit)}</button>
  </form>
  <footer>${escapeHtml(copy.trust)}</footer>
</main></body></html>`;
}

function noStoreHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-store', Vary: 'Cookie' };
}

export function createProtectedShareGatewayRoutes(ctx: AppContext): Hono {
  const gateway = new Hono();

  // Caddy's on-demand TLS allowlist calls this endpoint with `?domain=`
  // before provisioning a certificate. Only active protected-share hostnames
  // are accepted, preventing an external TLS terminator from becoming an
  // unbounded certificate-issuance oracle.
  gateway.get('/__openlander/share/tls-allow', async (c) => {
    const hostname = c.req.query('domain') ?? '';
    const target = await ctx.publicShare.resolveActiveShareByHostname(hostname);
    return target
      ? c.body(null, 204, noStoreHeaders())
      : c.text('Not found', 404, noStoreHeaders());
  });

  gateway.all('/__openlander/share/auth', async (c) => {
    const hostname = requestHostname(c);
    const target = await ctx.publicShare.resolveActiveShareByHostname(hostname);
    if (!target) return c.text('Not found', 404, noStoreHeaders());
    const token = parseCookie(c.req.header('cookie'), PROTECTED_SHARE_COOKIE);
    if (ctx.publicShare.validateSessionToken(target.service, hostname, token)) {
      return c.body(null, 204, noStoreHeaders());
    }
    const nextPath = safeNextPath(c.req.header('x-forwarded-uri'));
    return c.html(
      accessPage({
        target,
        nextPath,
        korean: koreanRequested(c.req.header('accept-language')),
      }),
      401,
      noStoreHeaders(),
    );
  });

  gateway.get('/__openlander/share/verify', (c) => {
    const response = c.redirect('/', 303);
    for (const [name, value] of Object.entries(noStoreHeaders())) response.headers.set(name, value);
    return response;
  });

  gateway.post('/__openlander/share/verify', async (c) => {
    const hostname = requestHostname(c);
    const target = await ctx.publicShare.resolveActiveShareByHostname(hostname);
    if (!target) return c.text('Not found', 404, noStoreHeaders());

    if (!sameHostFormOrigin(c, hostname)) {
      return c.text('Forbidden', 403, noStoreHeaders());
    }

    const form = await c.req.parseBody().catch((): Record<string, string | File> => ({}));
    const accessCode = typeof form['access_code'] === 'string' ? form['access_code'] : '';
    const nextPath = safeNextPath(typeof form['next'] === 'string' ? form['next'] : undefined);
    const limit = checkRateLimit(`protected-share:${target.service.id}:${clientIp(c)}`, {
      windowMs: PROTECTED_SHARE_VERIFY_WINDOW_SECONDS * 1000,
      max: PROTECTED_SHARE_VERIFY_MAX_ATTEMPTS,
    });
    if (limit.limited) {
      if (limit.firstLimited) {
        await ctx.eventBus.emit('public-access:verification-failed', {
          projectId: target.project.id,
          serviceId: target.service.id,
          serviceName: target.service.name,
          hostname,
          reason: 'rate_limited',
        });
      }
      return c.html(
        accessPage({
          target,
          nextPath,
          korean: koreanRequested(c.req.header('accept-language')),
          error: 'limited',
        }),
        429,
        { ...noStoreHeaders(), 'Retry-After': String(limit.retryAfterSec) },
      );
    }
    if (!ctx.publicShare.verifyAccessCode(target.service, accessCode)) {
      await ctx.eventBus.emit('public-access:verification-failed', {
        projectId: target.project.id,
        serviceId: target.service.id,
        serviceName: target.service.name,
        hostname,
        reason: 'invalid_code',
      });
      return c.html(
        accessPage({
          target,
          nextPath,
          korean: koreanRequested(c.req.header('accept-language')),
          error: 'invalid',
        }),
        401,
        noStoreHeaders(),
      );
    }

    const token = ctx.publicShare.createSessionToken(target.service, hostname);
    const response = c.redirect(nextPath, 303);
    response.headers.set(
      'Set-Cookie',
      `${PROTECTED_SHARE_COOKIE}=${token}; Max-Age=${String(PROTECTED_SHARE_SESSION_TTL_SECONDS)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
    for (const [name, value] of Object.entries(noStoreHeaders())) response.headers.set(name, value);
    return response;
  });

  return gateway;
}
