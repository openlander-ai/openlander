2026-03-12
- Keep raw `SCHEMA` additive, but avoid creating indexes on columns that may not exist in legacy tables before `migrate()` runs (e.g. `projects.parent_project_id`, `env_vars.environment_id`).
- Legacy backfill can be made idempotent with a single `INSERT ... SELECT ... WHERE NOT EXISTS` to create one production environment per project.
- Environment CRUD follows the same Drizzle insert/get/update/delete style as existing project/service methods.
- Environment model for Task 1 must use fixed tiers (`production`, `staging`, `development`) and include `idle` in status enum across raw schema, Drizzle schema, row unions, and migration SQL to avoid drift.
- Env var inheritance can stay backward compatible by treating project-scoped rows (`environment_id IS NULL`) as legacy base, then layering production environment vars, then target environment vars.
- To support same env key across scopes, migrate legacy `env_vars` unique `(project_id, key)` into two scoped unique indexes: project-level (`WHERE environment_id IS NULL`) and environment-level (`WHERE environment_id IS NOT NULL`).
- Task 4: `.env.example` generation can stay deterministic by combining `scanForEnvUsage()` keys with `inferServiceEnvVars(scanResult.serviceHints)` and rendering masked placeholders instead of raw stored values.
- For API output, `GET /projects/:id/env-example` can clone + scan on demand and return plain text without writing files into the user repo.
- Task 4 retry: environment-specific `.env.example` requires selecting the requested environment row first, then using that row's `branch` for clone and `ctx.env.getAllWithInheritance(projectId, environmentId)` for value context.

2026-03-12 (Task 2)
- Backend exports `EnvironmentType = 'production' | 'staging' | 'development'` from `src/db/index.ts:25`.
- `EnvironmentRow` uses `EnvironmentType` consistently (L52).
- Frontend mirrors backend types: `EnvironmentType` (L1), `Environment` interface (L3-14), `ProjectWithEnvironments` extends `Project` with `environments: Environment[]` (L31-33).
- Manual mirroring pattern: camelCase in frontend (e.g., `projectId`, `assignedPort`), snake_case in backend row types.
- `bun run build` passes with no errors; `lsp_diagnostics` clean on both files.

2026-03-12 (Task 6)
- Added `DeployPipeline.deployEnvironment(projectId, environmentId, config?)` so deploy execution can target explicit environment rows while reusing the deterministic pipeline steps.
- Backward compatibility is preserved by routing `deploy(config)` through the production environment selected from `environments`, keeping legacy callers on the production path.
- Environment-aware deploy now clones `environment.branch`, resolves runtime env vars via `getMergedForDeploy(projectId, environmentId)`, and writes runtime state (`status`, `assigned_port`, `container_id`, `image_tag`) into `environments`.
- Container naming remains `ol-{name}` for production and becomes `ol-{name}-{environmentType}` for staging/development to avoid name collisions.

2026-03-12 (Task 6 retry - Task 7 routing integration)
- Deploy pipeline routing for environment deploys must use Task 7 helpers (`buildTraefikLabels(..., environment.type)` and `getEnvironmentProjectHostname`) so host rules are `staging-{name}` / `dev-{name}` instead of suffix forms.
- Container naming and image naming can stay suffix-based from Task 6 while Traefik host routing uses Task 7 prefix semantics; these concerns are intentionally decoupled.

2026-03-12 (Task 5)
- Environment API routes should map `EnvironmentRow` timestamps through `normalizeTimestamp` so `/api/projects/:id` and `/api/projects/:id/environments*` return consistent UTC strings.
- Environment creation should only accept fixed tiers and default branch by tier (`production: main`, `staging: develop`, `development: dev`) when `branch` is omitted.
- Scoped env route should reuse `EnvManager.getAllWithInheritance()` and `EnvManager.getInheritanceInfo()` to avoid duplicating merge/source precedence logic in API layer.

2026-03-12 (Task 7)
- Keep production hostname behavior fully backward compatible by preserving `getProjectHostname(projectName, lanIp?)` and adding environment-aware hostname handling in a separate helper.
- Add optional `environment` only as the 4th argument to `buildTraefikLabels(projectName, containerPort, hostname?, environment?)` so existing 3-argument callers continue working unchanged.
- Focused tests can assert env prefix behavior directly with fixed `lanIp` for hostname helpers, and label rule prefix presence for staging/development without touching network detection logic.

2026-03-12 (Task 8)
- Webhook push handling can remain branch-filter-first, then resolve environment by `environments.branch === pushedBranch` with branch-specific tie-breaks (`main` prefers production, `develop` prefers staging, otherwise prefer development).
- Environment-aware push deploy should call `deployEnvironment(projectId, environmentId, { trigger: 'webhook' })`, while preserving legacy fallback to `redeploy(projectId)` when no environment branch matches.
- PR preview flow and source signature verification can stay untouched while adding push-to-environment routing.
- Task 10: Environment Variables UI
  - Added environment selector to `EnvVarsTable` to switch between project defaults and specific environments.
  - Used `getEnvironments`, `getEnvironmentEnvVars`, and `updateEnvironmentEnvVars` API helpers.
  - Displayed inheritance source (`global`, `project`, `environment`) with distinct visual styles.
  - Updated save logic to handle environment-specific overrides correctly.
  - Verified with `bun run build` and LSP diagnostics.

2026-06-02
- Scope-aware writes must ship with scope-aware list/get/export/delete. Exposing project-environment or service-environment writes without matching reads creates invisible deploy-affecting rows.
- The deploy resolver now intentionally changes legacy behavior: service deploys inherit project-shared env vars, and service-scoped keys override project keys. RC dry-runs should include a non-colliding inherited key and a colliding service override key.
- Avoid duck-typed env-manager fallbacks in deploy resolution. The real `getAllWithInheritance()` includes production-base behavior that ad-hoc fallbacks tend to miss.
- `runtimeEnvVars` remains a consumer hook until a producer path populates generated runtime values. Keep it documented as follow-up, not as finished product surface.
