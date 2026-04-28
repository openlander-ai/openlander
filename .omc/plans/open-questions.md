# Open Questions

## ai-settings-architecture-fix - 2026-04-09

- [ ] `auto-recovery.ts` 도구명 → `ConfigurableRecoveryStep` 매핑에서, `create_deploy_plan`/`execute_deploy_plan`을 `apply_fixes`로 매핑하는 것이 적절한지 — 이 도구들은 수정 적용뿐 아니라 일반 배포에도 사용될 수 있음. 복구 컨텍스트에서만 매핑을 적용해야 하는지 확인 필요.

- [ ] "전체 자동" 마스터 토글을 글로벌 설정에 둘지, 프로젝트별 설정에 둘지 — 현재 API는 프로젝트별 override만 지원. 글로벌 "전체 자동"은 `ops.recovery.automation`의 4개 단계를 모두 `auto`로 설정하는 것인지, 별도 플래그인지 결정 필요.

- [ ] `ai.autoRecovery.enabled = false`이고 `ops.recovery.enabled = true`인 경우의 예상 동작 — AI 에이전트 없이 ops-recovery(recipe 기반)만 동작하는 것이 의도인지, 아니면 양쪽 모두 꺼져야 하는지 사용자 관점에서 확인 필요.

- [ ] 핫 리로드/재시작 구분 표시를 프론트엔드 하드코딩으로 할지 백엔드 `requiresRestart` 필드로 할지 — 하드코딩이 빠르지만 기능 추가 시 양쪽 수정 필요. 백엔드 필드가 정확하지만 추가 작업량 발생.

- [ ] `codingPlan`의 "Coming Soon" 처리에서, 토글 자체를 비활성화(disabled)할지 아니면 토글은 가능하되 배지만 표시할지 — 토글을 비활성화하면 config에 저장된 값과 불일치 발생 가능성 있음.

## ralplan-v4-sprint - 2026-04-27

- [ ] Cherry-pick conflict resolution policy for `web/src/App.tsx` if both megacommit (962bf1d) and develop have non-trivial route table changes — favour develop's `/operations`, `/settings`, `/deployments` routes; favour megacommit's AppShell wrapper. Need user gut-check if mechanical resolution introduces a third conflict surface.
- [ ] `meta.synthetic: true` flag on `/api/services/:id/metrics` — should the UI show a persistent "Sample data" eyebrow, or only show it on first load and dismiss-able? Decision affects UX trust signal post-launch.
- [ ] `/api/settings/notifications/webhook` — single-row sqlite key in 1.0. Multi-webhook is post-1.0. Confirm with user before launch that single-webhook is acceptable for the launch advert ("notification channels" wiki copy).
- [ ] Legacy pages (`OpsCenterV2`, `SettingsPage`, `DeploymentsList`, `ServicesPage`, `NewProjectFlow`, `DeploymentDetail`) — ship as-is under v4 chrome at launch and reconcile in 1.0.x, or block launch until they match v4 palette? Plan defaults to ship-as-is. User confirm.
- [ ] PR target — does `feat/v4-design` PR target `develop` or `main` for the 1.0 launch? Plan assumes `develop` per repo convention; confirm before opening PR.
- [ ] If Phase C overruns, drop Project view's Deployments/Environment/Settings tabs and ship Project view as Overview-only. Confirm this fallback is acceptable, or pick a different cut-line.
- [ ] Synthetic-metrics fallback behaviour: should synthetic data be deterministic per-service (so reloads don't flicker) or live-randomized? Plan says deterministic; verify with user.

## ralplan-data-model-full-migration - 2026-04-28 (iter 2 — Option E)

iter-1 gating questions Q2 / Q5 / Q9 are RESOLVED:

- ~~[ ] `secret_files` ownership~~ — RESOLVED: stays at `projects.id` (group). Verified `src/pipeline/compose.ts:668` `getSecretFilesForDeploy(parentProjectId)` shares result across compose siblings via `sharedSecretFiles` (compose.ts:790).
- ~~[ ] `projectDependencies` triple-rename~~ — RESOLVED: `source_project_id` → `source_service_id`; `target_project_id` → `target_service_id`; today's `target_service_id` → `target_managed_service_id`. Verified `src/db/schema.drizzle.ts:601-623`.
- ~~[ ] Mac-mini production data fixture~~ — RESOLVED: hand-built representative fixture at `test/fixtures/openlander-1.0-pre-fullsplit.db`. Captured-data path rejected (PII scrub complexity + per-user variance + OSS privacy concerns).

Remaining items (post-1.0 considerations, NON-GATING for 1.0):

- [ ] `__orphan_managed` group naming + visibility (1.1) — synthesized group hosts unattached managed services. Default 1.0: hide via special-case in `useProjectsContext` filter. Revisit in 1.1 with "Managed" badge alternative.
- [ ] Compose v2 semantics shape (1.1+) — 1.0 unwind preserves "parent + N children". A v2 might collapse compose into a single `services` row. NOT foreclosed by 1.0 schema (`parent_service_id` self-FK accommodates both shapes).
- [ ] Deprecation deadline (2.0) — legacy `*_project` MCP actions removed in 2.0. 1.x is the deprecation window. Confirm semver policy at 1.5 milestone.
- [ ] Audit log retention (1.1+) — `migration_0009_audit` is append-only. Future migrations using this pattern should consolidate into a single `__migrations_audit` partitioned by `migration_tag`.
- [ ] `bun run scripts/migrate-dry-run.ts` home — RESOLVED: `scripts/` (existing) per consistency with `scripts/db-inspect.ts`. Non-gating.
- [ ] Parent-branch merge style (1.0 process) — squash-merge vs merge-commit per RC. Default: merge-commit per RC for bisect-friendliness. Confirm before merging rc.1 / rc.2.

## ralplan-data-model-alignment - 2026-04-28 (revised iter 3) — SUPERSEDED by full-migration plan above

Iter-1/iter-2 questions about `/resources`, `CreateResourceDialog.tsx` rename, and MCP composite tweaks are STRUCK — the plan was reframed in iter 3 to drop the "Resource" noun entirely and to drop all server-side endpoint work. Active questions for iter-3 plan:

- [ ] Managed-detail render path choice: gate inside `ServiceDetailV2` (planner default — ~1-2 hr) vs net-new `web/src/pages/ManagedServiceDetail.tsx` (~3-4 hr realistic given ServiceDetailV2's hook entanglement with `useProjectsContext`/`useProjectTopology`/`useServiceHealth`/`useServiceMetrics`/`useDeployments`) vs scope-cut "redirect-to-list with toast" fallback. Decision point during Phase 1 step 3 — needs user yes/no before that step starts.
- [ ] `/services` route handling: keep `<Navigate to="/managed-services" replace />` redirect (planner default — preserves bookmarks; 4 doc files and dogfood bookmarks land on `/services` today) vs hard-remove (cleaner, breaks bookmarks/docs). Affects external link stability.
- [ ] Lint guardrail (`vocabulary-audit.test.ts`) activation timing: activate immediately with the verified 21-action baseline (planner default — catches new debt during 1.0→1.1 window) vs activate post-1.0-RC. The frozen baseline IS today's verified count.
- [ ] README "What's coming" pointer to data-model-evolution roadmap: add (planner default — OSS adopters land on README first) vs skip (release notes are enough).
- [ ] [DEFERRED to 1.1 design pass] MCP composite shape for new `*_service` actions: extend `openlander_service` (currently managed-only, 21 actions in `SERVICE_ACTIONS` at `src/mcp/composite-tools.ts:97-119`) to also cover deployables, vs introduce a new `openlander_deployable` composite, vs rename today's `openlander_service` to `openlander_managed_service`. All three options remain open since iter-3 plan deliberately does not introduce a noun in 1.0.
- [ ] [DEFERRED to 1.1 design pass] API endpoint shape for the design-vocab deployables-list: extend already-existing `GET /api/projects/:id/topology` (returns `{services: [...]}` per `src/web/api/project-routes.ts:598`) as the canonical endpoint, vs introduce non-colliding new path (e.g., `/api/projects/:id/deployables`). Either decision goes through endpoint-collision audit grep first (Scenario 4 detect step in iter-3 plan).

## ralplan-monitoring-logs - 2026-04-28

- [ ] Page name `/logs` vs `/deploys` — content is deploy-scoped (no Traefik, no runtime tail, no audit). Architect should weigh in. Planner default: keep `/logs` for sidebar real estate; revisit naming in 1.1 if user feedback flags the mismatch.
- [ ] Empty-state policy on `GET /api/monitoring/services` for services with zero samples: include row with empty arrays (UI shows "—") or exclude entirely? Planner default: include — predictable UI, clearer "service exists but isn't sampling yet" signal.
- [ ] Phase 1 OpsCenterV2 retire — delete `src/web/api/ops-routes.ts` entirely, or keep file (remove route registration only) in case MCP tools still call it? Planner default: keep file, drop route registration, audit MCP consumers in 1.1.
- [ ] Codename rename gate vs feature completeness — confirm shipping as 1.0 (not 0.9.0) is correct given memory rule "rename to real brand at 1.0.0". Phase 1+2+3 closes the visible "coming soon" surface, but only the user can call the brand-rename trigger.
- [ ] D-3 timeline acceptance — 18 hr planner-estimate, 26 hr at 1.45× fudge, 24 hr available. Confirm user accepts zero-buffer plan or wants Phase 3 cut-line moved (drop log-line summary column → ship as plain DeploymentsList styling).
- [ ] `summary` line truncation policy on `/api/logs/recent` — 120 chars from last non-empty `log_text` line. Confirm 120 is right, and confirm "last non-empty" is the right strategy vs "first line" (some deploys' last lines are noisy success markers).

