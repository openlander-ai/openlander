# live-service-pulse — Development Findings

**Repo:** https://github.com/lehdqlsl/live-service-pulse  
**Running:** http://localhost:10041 | Status: http://localhost:10041/status | Metrics: http://localhost:10041/metrics  
**Stack:** Node.js + Express + TypeScript + PostgreSQL 17 + EJS + WebSocket  
**Infra:** Docker containers on `web` network — `ol-live-service-pulse` (port 10041), `ol-svc-pulse-db` (port 10040)

---

## Release History

| Version    | Date           | Key Features                                                                        |
| ---------- | -------------- | ----------------------------------------------------------------------------------- |
| v1.0.0     | 2026-04-03     | URL monitoring, dashboard, REST API, dark theme                                     |
| v1.1.0     | 2026-04-03     | Sparkline charts, incident detection, webhooks                                      |
| v1.2.0     | 2026-04-03     | Tags, pagination, 24h uptime bars                                                   |
| v1.3.0     | 2026-04-03     | Public status page, histogram, pause/resume, bulk delete                            |
| v1.4.0     | 2026-04-03     | SSL cert monitoring, body validation, API key auth                                  |
| v1.5.0     | 2026-04-03     | SLA reports, notification channels, CSV/JSON export                                 |
| v1.6.0     | 2026-04-03     | WebSocket real-time, animations, keyboard shortcuts                                 |
| v1.7.0     | 2026-04-03     | Prometheus /metrics, dependencies, retries, slow alerts                             |
| v1.8.0     | 2026-04-03     | Monitor detail page, status badges, data retention                                  |
| v1.9.0     | 2026-04-03     | Maintenance windows, monitor groups, dashboard search                               |
| **v2.0.0** | **2026-04-03** | **Graceful shutdown, enhanced health, rate limiting, request logging, error pages** |

## Stats at v2.0.0

- **11 releases** in a single day
- **849+ health checks** across 3 monitors (Google, GitHub, Cloudflare)
- **99.76% uptime** (brief gaps during container restarts only)
- **Avg response time:** 267ms
- **Zero production incidents** (all downtime was planned redeployment)
- **14 git commits**, all pushed to GitHub
- **Docker images retained:** v1.0.0 through v2.0.0 for rollback

## Full Feature Set (v2.0.0)

### Monitoring

- URL uptime monitoring with configurable intervals (10s-3600s)
- SSL certificate expiry monitoring (TLS handshake)
- Response body regex validation
- Monitor dependencies (skip child if parent is down)
- Configurable retries per monitor (0-5, 5s delay)
- Response time alerting (threshold-based)
- Automatic incident detection and resolution

### Dashboard & UI

- Real-time WebSocket updates (no page refresh)
- SVG sparkline charts per monitor
- 24-hour uptime bar (hourly color-coded segments)
- Response time histogram (5 buckets)
- Monitor detail page with time-series chart, SSL info, config editor
- Grid/List view toggle (localStorage)
- Tag filtering + search (client-side)
- Monitor groups with color-coded headers
- Keyboard shortcuts (n, r, g, /, Esc)
- Dark theme with CSS animations

### Notifications

- Webhook notifications (up/down/slow events)
- Slack integration (rich text with color sidebar)
- Discord integration (embeds with fields)
- Maintenance windows (suppress alerts during scheduled work)

### API & Integration

- Full REST API (CRUD monitors, checks, incidents, webhooks, groups, maintenance)
- Prometheus /metrics endpoint (P50/P95/P99, per-monitor status, pool stats)
- SVG status badges (embeddable in READMEs)
- CSV/JSON data export
- Optional API key authentication
- Rate limiting (100 req/min/IP on API routes)

### Operations

- Public status page (/status)
- Monthly SLA reports with P95 response times
- Data retention policy (configurable, default 90 days)
- Graceful shutdown (SIGTERM/SIGINT handling)
- Enhanced health check with DB/WS/monitor stats
- Request logging middleware
- Seed monitors via SEED_MONITORS env var

### Database

- PostgreSQL 17 with 7 tables: monitors, checks, incidents, webhooks, notification_channels, ssl_checks, api_keys, settings, maintenance_windows, monitor_groups
- All migrations additive (ALTER TABLE IF NOT EXISTS pattern)
- Connection pool monitoring

## Architecture

```
Client → Express (port 3000) → PostgreSQL 17
            ├── /             Dashboard (EJS + WebSocket live updates)
            ├── /status       Public status page (grouped by monitor group)
            ├── /reports      Monthly SLA reports (P95, uptime %)
            ├── /monitors/:id Monitor detail page (charts, config, SSL)
            ├── /history/:id  Check history with histogram
            ├── /badge/:id    SVG status badges
            ├── /metrics      Prometheus metrics
            ├── /api/*        REST API (rate limited, optional API key auth)
            └── /ws           WebSocket (real-time check broadcasts)

Checker Service (background)
  └── Per-monitor interval timers
      ├── HTTP/HTTPS check → response time + status code
      ├── SSL certificate extraction (tls module)
      ├── Body regex validation
      ├── Retry logic (configurable per monitor)
      ├── Dependency chain (skip if parent down)
      ├── Maintenance window check (suppress incidents)
      ├── Incident auto-detect (open/resolve)
      ├── WebSocket broadcast
      └── Notification dispatch (webhook/Slack/Discord)
```

## Key Learnings

### Claude Code Agent Reliability

- Consistently produces compilable TypeScript on first attempt
- Feature sets of 3-7 items per prompt work well
- Agent timeouts (5min) are the main bottleneck — always check `git status` after
- Partial work is always usable — just needs manual completion of remaining items

### Deployment Pattern

```bash
npm run build                                                    # TypeScript compile
docker build -t openlander/live-service-pulse:vX.Y.Z -t ...latest .  # Docker image
docker stop/rm ol-live-service-pulse                             # Stop old
docker run -d --name ol-live-service-pulse ...                   # Start new
# Total downtime: ~3 seconds
```

### Database Migration Strategy

- All migrations use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
- No migration files needed — schema converges on startup
- Works perfectly for rapid iteration (11 versions in one day)

## Roadmap

### v2.1.0

- [ ] Dark/Light theme toggle with CSS variables
- [ ] Mobile responsive design (320px-1920px)
- [ ] Monitor import/export (JSON backup/restore)

### v2.2.0

- [ ] Multi-user authentication (bcrypt + JWT)
- [ ] Role-based access (admin/viewer)
- [ ] Audit log for all mutations

### v3.0.0

- [ ] React SPA frontend (replace EJS)
- [ ] Real-time charts with WebSocket streaming
- [ ] Multi-tenant support
