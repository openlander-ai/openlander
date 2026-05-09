# Domains & Public Access

## Access Modes

| Mode            | Use Case      | How                      | Domain Required |
| --------------- | ------------- | ------------------------ | --------------- |
| **Internal**    | Same network  | Local IP + Traefik       | No              |
| **Quick Share** | Demo / review | TryCloudflare (temp URL) | No              |
| **Production**  | Always-on     | Cloudflare Tunnel        | Yes             |

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

## Quick Share (TryCloudflare)

Generate a temporary public URL — no domain or Cloudflare account needed.

### Via Web Dashboard

Project Detail → **Share** button

### Via MCP

```
expose_public(project_name: "my-app")
```

Returns a URL like `https://random-words.trycloudflare.com`

### Stop Sharing

```
unexpose_public(project_name: "my-app")
```

> **Note**: TryCloudflare URLs are temporary and change on restart.

---

## Custom Domains (Cloudflare Tunnel)

For permanent public URLs with your own domain.

### Prerequisites

1. Domain managed by Cloudflare
2. Cloudflare API token
3. Cloudflare Tunnel ID

### Configure

In Settings → Proxy, add Cloudflare credentials. Or via config:

```json
{
  "cloudflare": {
    "apiToken": "your-token",
    "tunnelId": "your-tunnel-id",
    "accountId": "your-account-id"
  }
}
```

### Map Domain

#### Via Web Dashboard

Service Detail → **Domains** tab → Add Domain

#### Via MCP

```
map_domain(service_name: "my-app-web", project_name: "my-app", domain: "app.example.com")
```

### List Domains

```
list_domains()
```

---

## Multi-Domain

A service can have multiple domains mapped:

```
map_domain(service_name: "my-app-web", project_name: "my-app", domain: "app.example.com")
map_domain(service_name: "my-app-web", project_name: "my-app", domain: "www.example.com")
```
