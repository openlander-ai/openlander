/**
 * SSRF guard helpers (Day 13 M3 + M4).
 *
 * Blocks any URL whose host resolves to a loopback / link-local / private
 * RFC1918 address, the well-known cloud metadata endpoint
 * (`169.254.169.254`), or `*.local` mDNS names. Used by both the git
 * clone path and the MCP test/connect path so that an authenticated user
 * cannot trick the daemon into making outbound requests against another
 * tenant's services on the same host or VPC.
 *
 * Notes:
 *  - The check is intentionally string-based on the literal hostname.
 *    DNS rebinding is mitigated at the system level (dockerised network
 *    egress + libcurl resolver caching), not here. The job of this module
 *    is to refuse the obviously-internal hostname before we even look it
 *    up.
 *  - Custom corporate git hosts are still allowed because we cannot tell
 *    them apart from a legitimate upstream. Operators who require that
 *    extra hardening can run the daemon inside a network namespace with
 *    no route to RFC1918 space.
 */

const BLOCKED_LITERAL_HOSTS = new Set<string>([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::',
  '::1',
  '0:0:0:0:0:0:0:0',
  '0:0:0:0:0:0:0:1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./, // link-local (covers EC2/IMDS aliases too)
  /^0\./,
];

export interface UrlSafetyOptions {
  /** Schemes the caller is willing to accept (lowercased, trailing colon). */
  allowedSchemes: string[];
  /**
   * Permit `user@` (no password) in the URL. SSH URLs canonically embed
   * the SSH user (`ssh://git@github.com/foo/bar`), which is not a
   * caller-controlled credential — set this to true on the git path.
   */
  allowUserInfo?: boolean;
}

export interface UrlSafetyResult {
  ok: boolean;
  /** Human-readable reason; populated when `ok === false`. */
  reason?: string;
}

/**
 * Pure check: returns `{ ok, reason }` so callers can map to their own typed
 * errors. `assertSafeUrl` below is the throwing wrapper.
 */
export function checkUrlSafety(url: string, options: UrlSafetyOptions): UrlSafetyResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `not a valid URL: ${url}` };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (!options.allowedSchemes.includes(scheme)) {
    return { ok: false, reason: `scheme ${scheme} is not allowed` };
  }

  // userinfo embedded in URL is suspicious for our use cases (credentials in
  // git URLs are injected later, not provided by callers). Reject so we don't
  // accidentally exfiltrate a token in a redirect. SSH URLs are the one
  // exception: `ssh://git@github.com/...` embeds the SSH login user, not a
  // caller-controlled secret — callers that opt-in to `allowUserInfo` may
  // pass `user@` but never `user:password@`.
  if (parsed.password) {
    return { ok: false, reason: 'embedded credentials are not allowed' };
  }
  if (parsed.username && !options.allowUserInfo) {
    return { ok: false, reason: 'embedded credentials are not allowed' };
  }

  const rawHost = parsed.hostname.toLowerCase();
  if (rawHost.length === 0) {
    return { ok: false, reason: 'empty host' };
  }

  // Strip IPv6 brackets that URL.hostname leaves out — defensive only.
  // Also strip any trailing dots: DNS treats `localhost.` and `localhost`
  // identically, but a string-equality check against `BLOCKED_LITERAL_HOSTS`
  // would otherwise miss the trailing-dot canonicalization. Same logic
  // applies to `*.local.` mDNS suffixes.
  const host = rawHost.replace(/^\[/, '').replace(/\]$/, '').replace(/\.+$/, '');

  if (BLOCKED_LITERAL_HOSTS.has(host)) {
    return { ok: false, reason: `host ${host} is internal` };
  }

  if (host.endsWith('.local') || host.endsWith('.localhost')) {
    return { ok: false, reason: `host ${host} resolves on the local network` };
  }

  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(host)) {
      return { ok: false, reason: `host ${host} is in a private IP range` };
    }
  }

  // Crude IPv6 check: anything containing colons that isn't a literal we
  // already passed. Block fc00::/7 (unique local), fe80::/10 (link local),
  // ::1 (loopback) and ::ffff:0:0/96 IPv4-mapped IPv6 literals — the
  // last form is the canonical SSRF bypass for private-range checks
  // because `[::ffff:127.0.0.1]` looks public to a naive prefix scan but
  // the kernel routes it to the loopback IPv4 stack.
  if (host.includes(':')) {
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
      return { ok: false, reason: `host ${host} is loopback` };
    }
    if (
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb')
    ) {
      return { ok: false, reason: `host ${host} is in a private IPv6 range` };
    }
    // IPv4-mapped IPv6 literal: `::ffff:a.b.c.d` (dotted) or
    // `::ffff:wwww:xxxx` (hex). Extract the embedded IPv4 if possible
    // and run the IPv4 private-range checks against it; otherwise refuse
    // the whole `::ffff:` prefix to be safe.
    const mapped = extractIpv4Mapped(host);
    if (mapped !== null) {
      if (BLOCKED_LITERAL_HOSTS.has(mapped)) {
        return { ok: false, reason: `host ${host} maps to internal ${mapped}` };
      }
      for (const pattern of PRIVATE_IPV4_PATTERNS) {
        if (pattern.test(mapped)) {
          return { ok: false, reason: `host ${host} maps to private ${mapped}` };
        }
      }
      // Multicast 224.0.0.0/4 — not in the IPv4 list above (the IPv4
      // path doesn't currently see those), but a mapped multicast
      // address is still suspect.
      if (/^(22[4-9]|23\d)\./.test(mapped)) {
        return { ok: false, reason: `host ${host} maps to multicast ${mapped}` };
      }
    } else if (host.startsWith('::ffff:')) {
      return { ok: false, reason: `host ${host} uses IPv4-mapped IPv6 (refused)` };
    }
  }

  return { ok: true };
}

/**
 * If `host` is an IPv4-mapped IPv6 literal of the form `::ffff:a.b.c.d`
 * (dotted form) or `::ffff:wwww:xxxx` (hex form), return the equivalent
 * dotted IPv4 string. Otherwise return null. The hex form is the one
 * `new URL().hostname` typically yields after canonicalization, so we
 * have to handle both.
 */
function extractIpv4Mapped(host: string): string | null {
  // Dotted form: `::ffff:127.0.0.1`
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host);
  if (dotted) {
    return dotted[1] ?? null;
  }
  // Hex form: `::ffff:7f00:1` → 127.0.0.1
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (hex) {
    const high = parseInt(hex[1] ?? '0', 16);
    const low = parseInt(hex[2] ?? '0', 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      const a = (high >> 8) & 0xff;
      const b = high & 0xff;
      const c = (low >> 8) & 0xff;
      const d = low & 0xff;
      return `${String(a)}.${String(b)}.${String(c)}.${String(d)}`;
    }
  }
  return null;
}

/**
 * Throw `Error(reason)` if the URL is unsafe. Callers wrap in their own
 * typed error class.
 */
export function assertUrlSafetyOrThrow(url: string, options: UrlSafetyOptions): void {
  const result = checkUrlSafety(url, options);
  if (!result.ok) {
    throw new Error(result.reason ?? 'unsafe URL');
  }
}

/** Convenience: scheme list used by the git clone path. */
export const GIT_ALLOWED_SCHEMES: string[] = ['http:', 'https:', 'ssh:', 'git+ssh:'];

/** Convenience: scheme list used by the MCP HTTP/SSE transport. */
export const MCP_ALLOWED_SCHEMES: string[] = ['http:', 'https:'];
