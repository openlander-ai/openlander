# Postgres Follow-ups

OpenLander targets a Postgres-only runtime before public launch. This note keeps
the database conversion scope narrow and records optimization work that should
happen after the runtime is stable on Postgres.

## Current Conversion Scope

- Keep runtime support Postgres-only.
- Use `OPENLANDER_DATABASE_URL` / `DATABASE_URL` as the database source of truth.
- Maintain the Postgres Drizzle baseline schema.
- Keep legacy embedded-database bridge code out of the runtime.
- Convert repositories and callers to async Postgres access.
- Ship a Docker Compose deployment path with a dedicated OpenLander Postgres volume.

## Deployment Baseline

`docker-compose.yml` is the default self-hosted deployment shape:

- `openlander-db` runs Postgres 16 with persistent `openlander-postgres` volume.
- `openlander` receives `OPENLANDER_DATABASE_URL` and uses the host Docker socket.
- `openlander-data` preserves runtime config, cloned repos, OAuth/session secrets, and local app data.

Set `OPENLANDER_POSTGRES_PASSWORD` in the shell or an `.env` file before running
Compose. The compose file intentionally fails fast when the password is missing.

```bash
OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose up -d --build
```

OpenLander-owned project containers are not treated as preserved state for this transition. If a
dogfood/runtime reset is needed, preserve `openlander-postgres` and `openlander-data`, then recreate
deployed projects from source.

## Explicitly Deferred

- Convert DB/API integration tests from SQLite in-memory fixtures to an
  `OPENLANDER_TEST_DATABASE_URL` Postgres test harness.
- Home/dashboard summary API redesign.
- Cross-screen read-model or cache layer.
- Materialized views.
- Full activity feed pagination redesign.
- Deploy log/timeline storage redesign.
- AI usage pre-aggregation.
- Production-specific pool tuning beyond safe defaults.

## Optimization Backlog

- Add a home/project-list summary query if `/api/projects` remains too heavy.
- Tune Operations Center activity and incident queries using real p95 latency.
- Move deploy logs and timeline reads to cursor pagination for large installs.
- Add slow-query logging guidance and index review criteria.
- Consider aggregate tables for AI usage and service metrics if dashboards become expensive.
- Add backup/restore runbooks using `pg_dump`, `pg_restore`, and Docker volume snapshots.

## Measurement Criteria

- First dashboard render request count.
- API p95 latency by route.
- Query count per route.
- Postgres CPU, memory, and IO under normal polling.
- Docker host IO during concurrent deploys and DB writes.

The conversion PR should only include obvious query cleanups required by the
Postgres port. Performance work that needs production-shaped data belongs in a
follow-up PR.
