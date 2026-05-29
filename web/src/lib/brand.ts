/**
 * Brand constants — single source of truth.
 *
 * Why this file exists:
 * "OpenLander" is the current brand name. The user has flagged that the
 * 1.0.0 launch may rebrand. Routing every brand mention through this
 * module means a future rename is a single-token swap, not a search
 * across 20 files.
 *
 * Use `BRAND.name` everywhere a user-visible product name belongs.
 * Use `BRAND.markUrl` for the sidebar / hero brand image; `BRAND.glyph`
 * stays as a text-only fallback for environments that cannot render the
 * PNG (loading states, plain-text contexts).
 *
 * The default export is `BRAND` for convenience; named exports are also
 * provided for tree-shaking-friendly imports.
 */

export const BRAND = {
  /** Public-facing product name shown in sidebar, top bar, modal titles */
  name: 'OpenLander',

  /** Compact form (e.g. mobile sidebar collapsed state) */
  nameShort: 'OL',

  /** Brand mark — served from `web/public/brand/openlander-mark.png`. */
  markUrl: '/brand/openlander-mark.png',

  /** Text-only fallback when an image cannot be rendered. */
  glyph: '◆',

  /** Tagline (used in onboarding, marketing pages, hero copy) */
  tagline: 'Agent-native PaaS for self-hosters',

  /** Short version stamp shown at bottom of sidebar */
  versionStamp: 'v1.0.0 · self-hosted',

  /** Default sslip.io subdomain pattern in seed/sample data — illustrative only */
  sslipPattern: '{service}.{project}.{ip}.sslip.io',

  /** Sample MCP endpoint — illustrative for pages that show "your endpoint" hints */
  sampleMcpEndpoint: '{your-host}/mcp',
} as const;

export type Brand = typeof BRAND;

export default BRAND;
