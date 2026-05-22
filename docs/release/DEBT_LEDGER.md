# Release Debt Ledger

Small compatibility or vocabulary decisions that were intentionally accepted for
a release should be recorded here so follow-up work is explicit.

## v0.1.3

- **Conditional blue-green deploy green-identity proof:** v0.1.3 treats
  `redeploy_app(strategy="blue-green")` as an explicit, eligibility-gated,
  best-effort zero-downtime path. It health-checks the green container directly,
  flips the OpenLander/Traefik route target, waits for the HTTP-provider polling
  window, probes the public route, then removes blue.
- **Why accepted:** without an application version marker or Traefik API
  resolved-target check, the public route probe can prove ingress reachability
  but cannot prove the response came from green. This is acceptable for an
  opt-in v0.1.3 strategy because failures keep or restore blue and the default
  redeploy strategy remains `force`.
- **Follow-up:** before making blue-green automatic/default, add green-identity
  verification via Traefik resolved server URL inspection or an application
  version marker contract.

## v0.1.2

- **Domain route MCP contract:** `openlander_deploy.map_domain` and
  `openlander_deploy.list_domains` are removed without aliases and replaced by
  `openlander_service.add_domain_route` and
  `openlander_service.list_domain_routes`.
- **Why accepted:** v0.1 has no external users yet, and the old names implied
  DNS/Cloudflare/tunnel ownership that OpenLander does not provide in v0.1.
- **Vocab review:** use "domain route" for an internal Traefik Host/path route
  whose DNS/tunnel/TLS prerequisites are operator-owned.
- **Endpoint collision check:** no `/domain-routes` REST endpoint is introduced;
  the existing service-scoped `/domains` API path remains the web/API route.
- **Duplicate guard:** `domain_mappings_domain_path_unique` enforces unique
  `(domain, path_prefix)` registrations at the database layer.
- **Follow-up:** if external users depend on the removed MCP actions before
  v0.2, add a release-note migration snippet rather than reintroducing aliases.
