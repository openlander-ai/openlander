import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppContext } from '../../app.js';
import {
  PROTECTED_SHARE_COOKIE,
  PROTECTED_SHARE_SESSION_TTL_SECONDS,
  type ProtectedShareTarget,
} from '../../pipeline/protected-public-share.js';
import { checkRateLimit, clientIp } from '../middleware/rate-limit.js';
import { parseCookie } from '../middleware/cookies.js';

const VERIFY_WINDOW_MS = 10 * 60 * 1000;
const VERIFY_MAX_ATTEMPTS = 8;

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

function accessPage(params: {
  target: ProtectedShareTarget;
  nextPath: string;
  korean: boolean;
  error?: 'invalid' | 'limited';
}): string {
  const copy = params.korean
    ? {
        eyebrow: 'OpenLander 보호 공유',
        title: `${params.target.project.name}에 접근`,
        description: '계속하려면 공유받은 접근 코드를 입력하세요.',
        label: '접근 코드',
        placeholder: 'XXXX-XXXX',
        submit: '계속',
        invalid: '접근 코드가 올바르지 않습니다.',
        limited: '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
      }
    : {
        eyebrow: 'OpenLander protected share',
        title: `Access ${params.target.project.name}`,
        description: 'Enter the access code you received to continue.',
        label: 'Access code',
        placeholder: 'XXXX-XXXX',
        submit: 'Continue',
        invalid: 'That access code is not valid.',
        limited: 'Too many attempts. Try again in a few minutes.',
      };
  const error = params.error ? copy[params.error] : '';
  return `<!doctype html>
<html lang="${params.korean ? 'ko' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(copy.title)}</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0b0d10;color:#f5f7fa}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#18202b 0,#0b0d10 48%)}
    main{width:min(100%,400px);border:1px solid #2b3440;border-radius:16px;background:#11151a;padding:28px;box-shadow:0 24px 80px #0008}
    .mark{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#e7ff4f;color:#111;font-weight:900;margin-bottom:22px}
    .eyebrow{margin:0 0 7px;color:#aeb8c5;font-size:12px;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
    h1{font-size:24px;line-height:1.25;margin:0 0 8px}p{color:#aeb8c5;font-size:14px;line-height:1.55;margin:0 0 24px}
    label{display:block;font-size:13px;font-weight:650;margin-bottom:8px}input{width:100%;height:46px;border:1px solid #384554;border-radius:9px;background:#0b0e12;color:#fff;padding:0 13px;font:600 16px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;outline:none}
    input:focus{border-color:#d7f540;box-shadow:0 0 0 3px #d7f54022}.error{color:#ff8f8f;font-size:12px;margin:9px 0 0}
    button{width:100%;height:44px;border:0;border-radius:9px;background:#d7f540;color:#111;font-weight:750;margin-top:18px;cursor:pointer}button:hover{background:#e4ff68}
  </style>
</head>
<body><main>
  <div class="mark" aria-hidden="true">O</div>
  <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
  <h1>${escapeHtml(copy.title)}</h1>
  <p>${escapeHtml(copy.description)}</p>
  <form method="post" action="/__openlander/share/verify">
    <input type="hidden" name="next" value="${escapeHtml(params.nextPath)}">
    <label for="access-code">${escapeHtml(copy.label)}</label>
    <input id="access-code" name="access_code" type="text" inputmode="text" autocomplete="one-time-code" maxlength="128" placeholder="${copy.placeholder}" required autofocus>
    ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
    <button type="submit">${escapeHtml(copy.submit)}</button>
  </form>
</main></body></html>`;
}

function noStoreHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-store', Vary: 'Cookie' };
}

export function createProtectedShareGatewayRoutes(ctx: AppContext): Hono {
  const gateway = new Hono();

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

  gateway.post('/__openlander/share/verify', async (c) => {
    const hostname = requestHostname(c);
    const target = await ctx.publicShare.resolveActiveShareByHostname(hostname);
    if (!target) return c.text('Not found', 404, noStoreHeaders());

    const origin = c.req.header('origin');
    if (origin) {
      try {
        if (new URL(origin).hostname.toLowerCase() !== hostname) {
          return c.text('Forbidden', 403, noStoreHeaders());
        }
      } catch {
        return c.text('Forbidden', 403, noStoreHeaders());
      }
    }

    const form = await c.req.parseBody().catch((): Record<string, string | File> => ({}));
    const accessCode = typeof form['access_code'] === 'string' ? form['access_code'] : '';
    const nextPath = safeNextPath(typeof form['next'] === 'string' ? form['next'] : undefined);
    const limit = checkRateLimit(`protected-share:${target.service.id}:${clientIp(c)}`, {
      windowMs: VERIFY_WINDOW_MS,
      max: VERIFY_MAX_ATTEMPTS,
    });
    if (limit.limited) {
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
