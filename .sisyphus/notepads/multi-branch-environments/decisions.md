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
