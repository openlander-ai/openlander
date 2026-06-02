2026-03-12
- Added `environments` with unique `(project_id, type)` and runtime fields mirrored from legacy `projects` runtime columns for backward-compatible migration.
- Kept legacy runtime columns on `projects` intact; migration only copies into production environment rows and does not remove or mutate legacy columns.
- Added nullable `env_vars.environment_id` while preserving existing `UNIQUE(project_id, key)` behavior to keep project-scoped env vars compatible for later inheritance work.
- Locked environment tier vocabulary to `production`/`staging`/`development` (no `preview`) and set environment defaults to `branch='main'` and `status='idle'` for schema/DB/test alignment.
- Task 10: Environment Variables UI
  - Decided to use a simple `<select>` dropdown for environment selection to match the existing UI style in `WebhookPanel`.
  - Decided to show project defaults when no environment is selected (empty string value).
  - Decided to visually distinguish inherited variables by making their inputs slightly muted (`bg-bg-subtle text-muted-ol`) and showing a source badge.
  - Decided that editing an inherited variable automatically converts it to an environment override.

2026-06-02
- Treat PR #341/#342 as the new v0.2 baseline for env vars: storage, deploy-time resolution, REST producers/readers/deleters, and MCP producers/readers/deleters are complete for explicit project, project-environment, service-shared, and service-environment scopes.
- Keep v0.2 focused on environment policy and web/deploy surfaces. Do not reopen env-var persistence unless project-level environment values must exist before service runtime environments are created.
- Preserve legacy no-scope service env calls for compatibility. Explicit `scope` plus `environment_key` is the new agent-friendly path.
- Web env editing should follow the existing inheritance UX decision, but it now needs four scopes rather than the older project/environment-only model.
