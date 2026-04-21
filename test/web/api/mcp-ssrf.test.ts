/**
 * Day 13 M4: the `/setup/mcp/servers` POST and `/setup/mcp/servers/:id/test`
 * endpoints accept an arbitrary URL and hand it to an HTTP client. Without
 * a SSRF guard, a logged-in tenant can use that to enumerate internal
 * services, hit cloud-metadata, or pivot through the daemon's network
 * namespace. The guard delegates to `checkUrlSafety`; these tests pin the
 * shape we depend on (HTTP/HTTPS only, no loopback / RFC1918, no embedded
 * credentials).
 */
import { describe, expect, it } from 'vitest';

import { checkUrlSafety, MCP_ALLOWED_SCHEMES } from '../../../src/lib/url-safety.js';

function check(url: string): { ok: boolean; reason?: string } {
  return checkUrlSafety(url, { allowedSchemes: MCP_ALLOWED_SCHEMES });
}

describe('Day 13 M4: MCP server URL safety', () => {
  it('accepts well-formed http(s) URLs to public hosts', () => {
    expect(check('https://mcp.example.com/v1').ok).toBe(true);
    expect(check('http://mcp.example.com/v1').ok).toBe(true);
    expect(check('https://api.anthropic.com/v1/mcp').ok).toBe(true);
  });

  it('refuses ssh / file / javascript / ftp schemes', () => {
    expect(check('ssh://git@github.com/foo/bar').ok).toBe(false);
    expect(check('file:///etc/passwd').ok).toBe(false);
    expect(check('javascript:alert(1)').ok).toBe(false);
    expect(check('ftp://mcp.example.com').ok).toBe(false);
  });

  it('refuses loopback and link-local', () => {
    expect(check('http://localhost/v1').ok).toBe(false);
    expect(check('http://127.0.0.1/v1').ok).toBe(false);
    expect(check('http://0.0.0.0/v1').ok).toBe(false);
    expect(check('http://169.254.169.254/latest/meta-data').ok).toBe(false);
  });

  it('refuses RFC1918 private ranges', () => {
    expect(check('http://10.0.0.5/v1').ok).toBe(false);
    expect(check('http://192.168.0.10/v1').ok).toBe(false);
    expect(check('http://172.16.0.1/v1').ok).toBe(false);
    expect(check('http://172.31.0.1/v1').ok).toBe(false);
    // 172.32.x is *not* in the private range and must be allowed.
    expect(check('http://172.32.0.1/v1').ok).toBe(true);
  });

  it('refuses *.local mDNS hostnames', () => {
    expect(check('http://nas.local/v1').ok).toBe(false);
    expect(check('http://printer.localhost/v1').ok).toBe(false);
  });

  it('refuses URLs with embedded credentials', () => {
    expect(check('https://user:secret@mcp.example.com/v1').ok).toBe(false);
    expect(check('https://user@mcp.example.com/v1').ok).toBe(false);
  });

  it('returns a human-readable reason on rejection so the API can surface it', () => {
    const r = check('http://127.0.0.1/v1');
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
    expect(r.reason!.length).toBeGreaterThan(0);
  });

  it('refuses cloud metadata aliases beyond the IP literal', () => {
    expect(check('http://metadata.google.internal/v1').ok).toBe(false);
    expect(check('http://metadata.goog/v1').ok).toBe(false);
  });
});
