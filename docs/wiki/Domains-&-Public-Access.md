# Domains & Public Access

## Access Modes

| Mode            | Use Case      | How                  | Domain Required |
| --------------- | ------------- | -------------------- | --------------- |
| **Internal**    | Same network  | Local IP + Traefik   | No              |
| **Quick Share** | Demo / review | Temporary share URL  | No              |
| **Production**  | Always-on     | Manual DNS + Traefik | Yes             |

Default is **Internal** (safe).

---

## Internal Access

Every deployed project gets an internal URL via Traefik:

```
http://project-name.your-server-ip
```

Or by port:

```
http://your-server-ip:assigned-port
```

Port range: `10001-10999` (production).

---

## Quick Share

Generate a temporary public URL without changing DNS or app source code.

### Via Web Dashboard

Project Detail → **Share** button

### Via MCP

```
expose_public(project_name: "my-app")
```

Returns a temporary public URL.

### Stop Sharing

```
unexpose_public(project_name: "my-app")
```

> **Note**: temporary share URLs may change on restart.

---

## Custom Domains

For permanent public URLs with your own domain.

### Prerequisites

1. A domain you control
2. OpenLander running in managed Traefik mode
3. DNS pointed at the server that runs OpenLander

### Configure

Create an `A`, `AAAA`, or `CNAME` record for your domain that points to the
server running OpenLander. OpenLander does not manage DNS records automatically
in v0.1.

### Register Domain Route

#### Via Web Dashboard

Service Detail → **Domains** tab → Add Domain

This registers a Host/path route inside OpenLander's managed Traefik config.
It does not create DNS records, Cloudflare Tunnel routes, ngrok endpoints, or
TLS certificates.

#### Via API

```
POST /api/projects/:projectId/services/:serviceId/domains
```

The REST endpoint remains `/domains`; "domain route" is the product vocabulary
for the Host/path route that endpoint registers, not a separate
`/domain-routes` API path.

### List Domain Routes

Use Service Detail → **Domains** tab for day-to-day management. The API returns
the same service-scoped Host/path route registrations used by the dashboard.

---

## Multi-Domain

A service can have multiple domain routes registered:

```
app.example.com
www.example.com
```
