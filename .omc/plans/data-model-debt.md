# Data Model Debt Ledger

Tracks the gap between OpenLander's design vocabulary (per
`docs/design/v1.0/GUIDE-01-IA-principles.md` §4: Project = group,
Service = deployable) and the v1 backend, which fuses the two via the
`projects` table. The 1.0 release ships only the frontend routing fix;
this ledger lists every still-open spot so 1.1 (API compat layer) and
1.2 (schema split) work can be scoped without re-investigating.

## Schema (1.2)

| Surface | File:line | Note |
|---|---|---|
| `projects.parent_project_id` self-reference | `src/db/schema.drizzle.ts:31` | One row, three semantics: standalone deployable, compose parent, compose child. 1.2 splits into `projects` (group) + `services` (deployable) with FK `services.project_id`. |
| Compose-aware lifecycle filters | `src/pipeline/deploy/lifecycle.ts:64,107,145,186` | All filter on `parent_project_id`. Need rewrite when schema flattens. *(Executor: re-verify line numbers — iter-2 plan repeated them without re-grep.)* |
| Compose parent lookup | `src/pipeline/compose.ts:1274-1280` | Same. *(Re-verify line numbers.)* |
| Sibling grouping by parent | `src/llm/context-assembler.ts:174-205` | Used by chat / agent context. *(Re-verify line numbers.)* |
| `parent_project_id` exposed to UI | `src/web/api/project-routes.ts:560,1962` | Preview-deploy linkage + project response. *(Re-verify line numbers.)* |
| Child-count grouping | `src/db/repos/project.repo.ts:57,157-161` | Repo helper. *(Re-verify line numbers.)* |

## MCP composite tools (1.1+)

| Surface | File:line | Note |
|---|---|---|
| `PROJECT_ACTIONS` (21 actions) | `src/mcp/composite-tools.ts:60-82` | All `*_project` named, but most operate on what GUIDE-01 calls a Service. Renaming is a public-API break — needs alias map + deprecation policy in 1.1. Verbatim list lives in `vocabulary-audit.test.ts` baseline. |
| `SERVICE_ACTIONS` (managed only) | `src/mcp/composite-tools.ts:97-119` | Today refers to managed services (postgres/redis/etc). 1.1 must decide: extend to also serve deployables (rename today's), introduce `openlander_deployable`, or rename today's `openlander_service` → `openlander_managed_service`. |

## REST endpoints (1.1+)

| Endpoint | File:line | Note |
|---|---|---|
| `GET /api/projects/:id/services` | `src/web/api/project-routes.ts:816` | Returns connected MANAGED services via `service_connections`. Vocabulary mismatch with GUIDE-01 §4 (services-as-deployables). 1.1 work: rename or re-shape. |
| `POST /api/projects/:id/services/:serviceId` | `src/web/api/project-routes.ts:850` | Creates a service connection (NOT a deploy). Path invites confusion. 1.1 work: rename or re-path. |
| `DELETE /api/projects/:id/services/:serviceId` | `src/web/api/project-routes.ts:919` | Deletes a connection. Same. |
| `POST /api/projects/:id/redeploy` | `src/web/api/project-routes.ts:1068` | Actual deploy endpoint. 1.1 MCP layer should alias as `*_service.deploy` to align with GUIDE-01 §4.2 ("Deploy button on Service.General"). |
| `GET /api/projects/:id/topology` | `src/web/api/project-routes.ts:598` | Already returns deployables under a `services` key. **Canonical candidate** for the 1.1 design-vocab list endpoint — extend rather than introduce a parallel path. |

## Frontend route ambiguity

| Surface | File:line | Note |
|---|---|---|
| `/services/:id` mounts `ServiceDetailV2` | `web/src/App.tsx` (deployable-detail route) | The `:id` is a `projects.id` and the page expects `?project=:p`. Partially mitigated in 1.0 by the `/managed-services/:id` route addition. **1.2 graduates this URL to `/projects/:p/services/:s`** alongside the schema split — that flip will break all 1.0/1.1 bookmarks of the form `/services/:id?project=:p`; redirect plan TBD in 1.2. |

## 1.1 cleanup candidates

- `web/src/components/service/ServiceHeader.tsx` — dead code, no imports anywhere in `web/src` (only a comment-only mention in `web/src/lib/status-config.ts:5`). Delete during 1.1 component-rewire pass.
- The full `web/src/components/service/Service*Tab.tsx` set (Connection / Databases / Logs / LogViewer / Overview / Settings) — all dead today. 1.1 either revives them under `ManagedServiceDetail` or deletes them.

## Endpoint-collision audit grep (PR gate, 1.1+)

Before adding any new route under `src/web/api/**` whose URL touches the
`projects/:id/services` namespace, run:

```sh
grep -nE "api\.(get|post|put|delete|patch)\(.*projects.*services" src/web/api/**/*.ts
```

Confirm the new path doesn't collide with the existing handlers listed
above. The iter-2 plan tripped on this exact failure mode (proposed
endpoints whose URLs were already in use); the grep is the
permanent guardrail.

## See also

- `.omc/plans/ralplan-data-model-alignment.md` — full plan with
  RALPLAN-DR + ADR + pre-mortem (4 scenarios) + 1.0/1.1/1.2 sequencing.
- `docs/design/v1.0/GUIDE-01-IA-principles.md` §4 — design vocabulary.
- `docs/RELEASE-NOTES-1.0.md` — public-facing data-model-alignment paragraph.
