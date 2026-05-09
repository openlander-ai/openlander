/**
 * Day 14 follow-up to Day 13 M3/M4: hostname canonicalization for the SSRF
 * guard. The original `checkUrlSafety()` lowercased the hostname but did
 * not strip a trailing dot (so `localhost.` slipped through), and the IPv6
 * branch only blocked fc00::/7 + fe80::/10 prefixes (so IPv4-mapped IPv6
 * literals like `[::ffff:127.0.0.1]` looked public to the prefix scan).
 *
 * Codex 5.4 cross-check enumerated the following bypasses; pin them all so
 * a future refactor of the host parser cannot silently re-introduce them.
 */
import { describe, expect, it } from 'vitest';

import {
  checkUrlSafety,
  GIT_ALLOWED_SCHEMES,
  MCP_ALLOWED_SCHEMES,
} from '../../src/lib/url-safety.js';

function checkMcp(url: string): { ok: boolean; reason?: string } {
  return checkUrlSafety(url, { allowedSchemes: MCP_ALLOWED_SCHEMES });
}

function checkGit(url: string): { ok: boolean; reason?: string } {
  return checkUrlSafety(url, { allowedSchemes: GIT_ALLOWED_SCHEMES, allowUserInfo: true });
}

describe('Day 14: SSRF hostname canonicalization (trailing dot)', () => {
  it('refuses `localhost.` (trailing dot bypass of literal-host set)', () => {
    const r = checkMcp('http://localhost./v1');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('localhost');
  });

  it('refuses `metadata.google.internal.` with trailing dot', () => {
    const r = checkMcp('http://metadata.google.internal./latest/meta-data');
    expect(r.ok).toBe(false);
  });

  it('refuses `*.local.` mDNS suffix with trailing dot', () => {
    expect(checkMcp('http://nas.local./v1').ok).toBe(false);
    expect(checkMcp('http://printer.localhost./v1').ok).toBe(false);
  });

  it('refuses 127.0.0.1 with a trailing dot', () => {
    expect(checkMcp('http://127.0.0.1./v1').ok).toBe(false);
  });

  it('still accepts a public host with a trailing dot (FQDN form)', () => {
    // `example.com.` is the fully-qualified form — explicitly NOT internal.
    // We accept it but the rest of the safety contract still applies.
    expect(checkMcp('https://example.com./v1').ok).toBe(true);
  });
});

describe('Day 14: SSRF IPv6 hardening (IPv4-mapped IPv6, ::1)', () => {
  it('refuses `[::1]` literal IPv6 loopback', () => {
    expect(checkMcp('http://[::1]/v1').ok).toBe(false);
  });

  it('refuses `[0:0:0:0:0:0:0:1]` long-form IPv6 loopback', () => {
    expect(checkMcp('http://[0:0:0:0:0:0:0:1]/v1').ok).toBe(false);
  });

  it('refuses `[::ffff:127.0.0.1]` IPv4-mapped loopback (dotted form)', () => {
    const r = checkMcp('http://[::ffff:127.0.0.1]/v1');
    expect(r.ok).toBe(false);
    expect(r.reason ?? '').toMatch(/127\.0\.0\.1|loopback|internal|mapped/i);
  });

  it('refuses `[::ffff:10.0.0.1]` IPv4-mapped RFC1918 (dotted form)', () => {
    const r = checkMcp('http://[::ffff:10.0.0.1]/v1');
    expect(r.ok).toBe(false);
    expect(r.reason ?? '').toMatch(/10\.0\.0\.1|private|mapped/i);
  });

  it('refuses `[::ffff:192.168.1.5]` IPv4-mapped LAN', () => {
    expect(checkMcp('http://[::ffff:192.168.1.5]/v1').ok).toBe(false);
  });

  it('refuses `[::ffff:169.254.169.254]` IPv4-mapped IMDS', () => {
    expect(checkMcp('http://[::ffff:169.254.169.254]/latest/meta-data').ok).toBe(false);
  });

  it('refuses the hex form of IPv4-mapped IPv6 (e.g. ::ffff:7f00:1 == 127.0.0.1)', () => {
    // `::ffff:7f00:1` is the canonical hex spelling of `::ffff:127.0.0.1`
    // that some URL parsers prefer. Both forms must be blocked.
    const r = checkMcp('http://[::ffff:7f00:1]/v1');
    expect(r.ok).toBe(false);
  });

  it('refuses an unrecognised `::ffff:` literal as a defensive default', () => {
    // If we cannot extract an IPv4 we still refuse the whole `::ffff:`
    // prefix — the only legitimate use of IPv4-mapped IPv6 in an outbound
    // HTTP URL is none.
    expect(checkMcp('http://[::ffff:0:0]/v1').ok).toBe(false);
  });

  it('still accepts a normal public IPv6 literal (e.g. Google DNS)', () => {
    expect(checkMcp('http://[2001:4860:4860::8888]/v1').ok).toBe(true);
  });
});

describe('Day 14: SSRF regression — existing pass cases still pass', () => {
  it('accepts well-formed http(s) URLs to public hosts', () => {
    expect(checkMcp('https://mcp.example.com/v1').ok).toBe(true);
    expect(checkMcp('http://api.openai.com/v1').ok).toBe(true);
    expect(checkMcp('https://hub.docker.com').ok).toBe(true);
  });

  it('accepts SSH git URLs with embedded SSH user (allowUserInfo opt-in)', () => {
    expect(checkGit('ssh://git@github.com/foo/bar.git').ok).toBe(true);
  });

  it('still refuses RFC1918 IPv4 (sanity, no regression on prior fix)', () => {
    expect(checkMcp('http://10.0.0.5/v1').ok).toBe(false);
    expect(checkMcp('http://172.16.0.1/v1').ok).toBe(false);
    expect(checkMcp('http://192.168.1.1/v1').ok).toBe(false);
    expect(checkMcp('http://127.0.0.1/v1').ok).toBe(false);
    expect(checkMcp('http://169.254.169.254/latest').ok).toBe(false);
  });
});
