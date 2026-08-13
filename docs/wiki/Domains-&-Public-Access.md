# Domains & Public Access

OpenLander keeps applications private by default. Version 0.3 adds **Protected
public share**: a service-scoped HTTPS URL with an OpenLander access-code gate.
It works on a public VPS or cloud VM without requiring a purchased domain or a
Cloudflare account.

## Access Modes

| Mode                       | Use case                                 | Inbound ports | Built-in auth | Domain required |
| -------------------------- | ---------------------------------------- | ------------- | ------------- | --------------- |
| **Internal**               | Private/LAN/VPN access                   | No            | OpenLander    | No              |
| **Direct protected share** | External review behind an access code    | 80 and 443    | Access code   | No              |
| **Cloudflare Tunnel**      | Custom domain or a host behind NAT       | No            | No            | Yes             |
| **Manual domain**          | Custom Host/path routing through Traefik | 80 and 443    | No            | Yes             |

## Protected Public Share

### How it works

The VM remains the origin server. OpenLander does not relay application traffic
through `sslip.io`: that service supplies DNS only. When the configured public
host is an IPv4 address, OpenLander creates a hostname such as:

```text
web-a1b2c3.34-64-12-34.sslip.io
```

The hostname resolves to `34.64.12.34`, and the browser connects directly to
the VM. If the operator later supplies a base domain, OpenLander instead creates
`web-a1b2c3.share.example.com`.

Managed Traefik owns ports 80 and 443, obtains an individual Let's Encrypt
certificate with HTTP-01, and routes each hostname to the selected Application.
Application container ports remain private. Traefik ForwardAuth asks
OpenLander to validate the visitor before forwarding HTTP or WebSocket traffic.

### One-time server setup

Open **Settings → Web Server → Direct protected share** and enter:

1. The VM's reserved public IPv4 address, or an operator-owned base domain
2. An email address for Let's Encrypt certificate registration

On Google Compute Engine, OpenLander attempts to detect the external IPv4 from
the metadata server and offers it as a one-click value. Reserve a static IP
before sharing; an ephemeral IP change invalidates any `sslip.io` hostname that
contains the old address.

The VM firewall must allow inbound TCP 80 and 443. Do not open each
Application's assigned port.

#### Existing HTTPS proxy on port 443

If Caddy, Nginx, or another host proxy already owns port 443, keep that proxy
as the TLS terminator and run protected sharing in external TLS mode:

```dotenv
OPENLANDER_PROTECTED_SHARE_TLS_MODE=external
```

The external proxy must preserve the requested `Host`, terminate HTTPS, and
forward active share hostnames to OpenLander's Traefik HTTP entrypoint on port 80. It must also restrict on-demand certificate issuance to OpenLander's
allowlist endpoint. A minimal Caddy pattern is:

```caddyfile
{
    auto_https disable_redirects
    email operator@example.com
    on_demand_tls {
        ask http://127.0.0.1:10114/__openlander/share/tls-allow
    }
}

https:// {
    tls {
        on_demand
        issuer acme {
            disable_http_challenge
        }
    }
    reverse_proxy 127.0.0.1:80
}
```

Keep any existing, host-specific dashboard route above this catch-all route.
The allowlist returns success only for a currently active protected-share
hostname, so arbitrary client-supplied names cannot trigger certificate
issuance. Caddy uses TLS-ALPN validation on port 443 in this example because
Traefik continues to own port 80.

### Share an Application

Open an Application detail page and click **Share externally**. OpenLander
creates a stable hostname and an eight-character access code. The code is shown
when it is generated. A signed-in operator can later use **Reveal code** to see
and copy it again; deliver it to the reviewer through a separate secure channel.

Several Applications can be shared at the same time. Each receives its own
hostname, access-code hash, signing secret, and host-only browser cookie. Nginx
static sites, React/Vite SPAs, Next.js full-stack applications, and Nuxt, Remix,
or SvelteKit applications work without framework-specific configuration as long
as the workload exposes HTTP. A Compose workload uses its saved
`traffic_service`.

The same control can:

- Open or copy the public URL
- Reveal, hide, or copy the current access code
- Generate a new access code
- Stop public sharing

Generating a new code and stopping sharing both invalidate every existing
visitor session immediately. Stopping retains the hostname reservation so a
later share reuses the same URL.

### Security boundary

- Access codes keep a bcrypt verification hash plus an AES-256-GCM encrypted
  recovery copy protected by the OpenLander master key.
- Only an authenticated human web session can request the recovery copy. Status
  responses, logs, and visitor requests never include it. MCP can receive a
  code only when it generates or rotates one; it cannot reveal a stored code.
- Session tokens are signed with a per-Application secret and bound to the exact
  hostname.
- Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and host-only.
- Code verification is rate-limited by caller IP and Application.
- Codes never appear in URLs or request logs.
- Deployment and redeployment never enable public sharing automatically.

This initial flow intentionally does not add expiry controls, named users, team
ACLs, path-based frontend/backend fan-out, wildcard certificates, or an
OpenLander-hosted relay.

### Share through MCP

Prefer the Application id returned by `list_projects`:

```json
{
  "action": "expose_public",
  "params": { "service_id": "project__svc" }
}
```

The response contains `public_url` and, on first enablement, `access_code`. The
plaintext code is not returned by later status or MCP calls. The dashboard's
human-only reveal button can retrieve newly issued codes without rotating them.
Generate a replacement and invalidate current sessions with:

```json
{
  "action": "expose_public",
  "params": {
    "service_id": "project__svc",
    "rotate_access_code": true
  }
}
```

Use `get_public_access` to read status and `unexpose_public` to stop sharing.
Project selectors remain shorthand only when the Project contains one eligible
deployable workload.

## Cloudflare Connected Publish

Cloudflare remains an optional path for operators who own a DNS Zone or need a
Named Tunnel because the OpenLander host is behind NAT. Connect it from **Web
Server → Cloudflare Tunnel**. OpenLander manages one Named Tunnel and one
`cloudflared` connector without giving Cloudflare credentials to Applications.

Connected Publish and Protected public share are separate ingress choices. A
Cloudflare connection is not required for a public GCP VM with ports 80 and 443
open. When Cloudflare is connected, **Share externally** shows a two-choice
dialog; Direct protected share remains the recommended default. Only one method
can be active for the same Application, and a Project can have only one active
Cloudflare-published Application.

Cloudflare publishing does not use OpenLander's access-code gate. Add Cloudflare
Access separately when authentication is required. Agents can explicitly select
Cloudflare with `provider: "cloudflare"` on `expose_public`, `get_public_access`,
and `unexpose_public`.

## Manual Domains

Manual domain routes remain available on an Application's **Domains** tab. They
register a Host/path route in managed Traefik for DNS that the operator has
already configured. The manual domain API does not create DNS records.

```text
POST /api/projects/:projectId/services/:serviceId/domains
```

One Application may have multiple manual domain routes, such as
`app.example.com` and `www.example.com`. Manual routes do not inherit the
Protected public share access-code gate.
