import { describe, expect, it } from 'vitest';

import {
  formatProxyBrandLabel,
  formatProxyVersionLabel,
} from '@/pages/settings/WebServer';

describe('Proxy Pip label formatters', () => {
  // Behavior coverage for the two pure helpers that drive the
  // localized proxy Pip label. They were extracted from `ProxyPip`
  // so the `Traefik vv3.6` regression Codex CCG round-1 caught
  // (`extractVersion()` returns `'v3.6'` for `traefik:v3.3` so the
  // earlier ` v${version}` template double-prefixed the `v`) is
  // pinned at function level instead of source-string level.

  describe('formatProxyVersionLabel', () => {
    it('strips a leading "v" before re-prefixing so `v3.6` does not become `vv3.6`', () => {
      expect(formatProxyVersionLabel('v3.6')).toBe(' v3.6');
      expect(formatProxyVersionLabel('V2')).toBe(' v2');
    });

    it('adds a `v` prefix when the version tag is bare (e.g. `3.6`, `1.25-alpine`)', () => {
      expect(formatProxyVersionLabel('3.6')).toBe(' v3.6');
      expect(formatProxyVersionLabel('1.25-alpine')).toBe(' v1.25-alpine');
    });

    it('returns an empty string for null/undefined version so the i18n template collapses cleanly', () => {
      expect(formatProxyVersionLabel(null)).toBe('');
      // The empty-string case (already-stripped backend) is safe to
      // render but yields just a leading space and `v`; not legal
      // input from the backend, but defensively non-fatal.
      expect(formatProxyVersionLabel('')).toBe('');
    });
  });

  describe('formatProxyBrandLabel', () => {
    it('renders Title Case for products that ship that way (Traefik, Caddy)', () => {
      expect(formatProxyBrandLabel('traefik')).toBe('Traefik');
      expect(formatProxyBrandLabel('caddy')).toBe('Caddy');
    });

    it('respects vendor-specific casing for NGINX and HAProxy (Gemini CCG round-1)', () => {
      // Naive Title Case would give "Nginx" / "Haproxy" — both
      // off-brand. The map mirrors the marks the projects use on
      // their own homepages.
      expect(formatProxyBrandLabel('nginx')).toBe('NGINX');
      expect(formatProxyBrandLabel('haproxy')).toBe('HAProxy');
    });

    it('renders a placeholder for `none` so a malformed `unsupported_proxy + type=none` payload is non-fatal', () => {
      // Backend logic doesn't combine `unsupported_proxy` with
      // `type=none` today, but the formatter should still produce a
      // sensible label rather than the lowercase enum word.
      expect(formatProxyBrandLabel('none')).toBe('None');
    });
  });
});
