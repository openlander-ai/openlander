# Domains & Public Access

OpenLander keeps applications private by default. Version 0.3 adds **Connected
Publish** for a stable HTTPS URL through the user's own Cloudflare account and
DNS Zone.

## Access Modes

| Mode                  | Use case                  | Domain required |
| --------------------- | ------------------------- | --------------- |
| **Internal**          | Private/LAN/VPN access    | No              |
| **Connected Publish** | Stable external HTTPS URL | Yes             |
| **Manual domain**     | Custom Host/path routing  | Yes             |

Connected Publish is not a temporary-link service. It does not add an access
code, expiry, or Cloudflare Access policy. Anyone who knows the published URL
can open it until the Project is unpublished.

## Internal Access

Every deployed HTTP application gets an internal route through OpenLander's
managed Traefik instance. `OPENLANDER_PUBLIC_HOST` controls the host advertised
in generated internal URLs; it may be a LAN IP, VPN/MagicDNS name, or another
operator-selected host.

The application container does not need an inbound VPS firewall port. Traefik
and the application communicate on OpenLander-managed Docker networks.

## Connected Publish

### Requirements

1. A Cloudflare account with an active DNS Zone
2. OpenLander's managed Docker runtime and Traefik
3. Cloudflare OAuth configured for the OpenLander build
4. A running HTTP Application, or a Compose workload with a saved
   `traffic_service`

Connect once from **Web Server → Public access → Connect Cloudflare**. The
browser completes Cloudflare OAuth, then OpenLander asks for an account and DNS
Zone only when it cannot select the sole available option automatically.
If the connection flow started from a Project's **Publish** action, OpenLander
returns to that Project and resumes publication after the connection succeeds.

OpenLander creates one remotely managed Named Tunnel for the OpenLander
instance and runs one pinned `cloudflared` connector container. Applications
do not receive Cloudflare credentials.

### Publish from the dashboard

Open a Project and click **Publish** in the Project header. While provisioning,
the control shows progress. When ready, the same control provides:

- The stable HTTPS URL, which opens in a new tab
- Copy URL
- Stop publishing

Stopping publication removes the active route but retains the hostname and DNS
reservation. Publishing the same Project again therefore reuses the same URL.
Publication is always an explicit action; deploying or redeploying does not
publish an application automatically.

### Reconnect or disconnect Cloudflare

The connected card's action menu can refresh Cloudflare authorization without
changing the selected Zone. **Disconnect Cloudflare** requires confirmation in
the web UI. It stops every Connected Publish URL and removes only resources
owned by this OpenLander connection: its DNS records, Named Tunnel,
`cloudflared` connector, and stored OAuth token. The Cloudflare OAuth
application itself remains configured for a later reconnect.

### Representative application

Connected Publish exposes one representative HTTP Application per Project:

- A Project with one top-level Application is selected automatically.
- A Compose workload uses its persisted `traffic_service`.
- A Project with multiple top-level Applications requires an explicit
  `service_id` through MCP for the first publication. The selected service is
  then persisted for later publication.
- Workers, databases, caches, storage services, stopped applications, and
  applications without a detected HTTP port are not eligible.

The mechanism is framework-agnostic. Nginx static sites, React/Vite SPAs,
Next.js full-stack applications, and Nuxt, Remix, or SvelteKit applications are
supported when they run as an HTTP application. A separate frontend/backend
pair should expose the frontend or BFF and proxy backend requests under the
same public hostname.

### Publish through MCP

Prefer the Application id returned by `list_projects`:

```json
{
  "action": "expose_public",
  "params": { "service_id": "project__svc" }
}
```

Poll the returned `status_call`, or call `get_public_access`, until the status
is `public` or `error`. To stop publishing while keeping the URL reservation:

```json
{
  "action": "unexpose_public",
  "params": { "service_id": "project__svc" }
}
```

## Manual Domains

Manual domain routes remain available on an Application's **Domains** tab.
They register a Host/path route in managed Traefik for DNS that the operator
has already configured. The manual domain API does not create DNS records or a
Cloudflare Tunnel route.

```text
POST /api/projects/:projectId/services/:serviceId/domains
```

One Application may have multiple manual domain routes, such as
`app.example.com` and `www.example.com`. These routes are independent of the
single Connected Publish URL reserved for the Project.

## Initial 0.3 Scope

Connected Publish intentionally excludes multiple public routes per Project,
temporary random URLs, access codes, expiry, Cloudflare Access policy setup,
external Traefik installations, and multi-server connector placement.
