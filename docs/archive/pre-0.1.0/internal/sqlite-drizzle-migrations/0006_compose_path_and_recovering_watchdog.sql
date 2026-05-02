-- 1.0 GA — Day 14 fix bundle
-- 1) Add recovering_started_at to projects so the recovery watchdog can
--    detect projects that have been stuck in 'recovering' past the
--    timeout (see RECOVERING_TIMEOUT_MS in recovery-coordinator.ts).
-- 2) Null out dockerfile_path values that point to OS temp directories
--    (`mkdtempSync(tmpdir())` paths from the compose pipeline). These
--    paths get garbage-collected by macOS/Linux temp cleanup and break
--    subsequent deploy/recovery once the temp dir is gone. The next
--    compose deploy re-detects the compose file in the freshly cloned
--    repo, so dropping the stored absolute path is safe.
-- 3) Backfill recovering_started_at for projects already stuck in
--    'recovering' state when the upgrade lands. Without this, the new
--    watchdog short-circuits at `if (!recovering_started_at) continue;`
--    and never escapes existing stuck rows (regression discovered
--    against a 24h-stuck hotdeal-tracker on the upgrade host).
-- 4) Backfill build_method='compose' for git-source projects whose
--    dockerfile_path looks like a compose file. This is required for
--    isCompose detection in build-deploy-config.ts; without it,
--    isValidDockerfilePath() rejects '*.yml/*.yaml' relative paths and
--    second-deploy / tool paths silently lose dockerfile_path → undefined.
--    Scoped to git-source projects with NULL build_method that already
--    point at a compose-shaped dockerfile_path, so we never widen the
--    set beyond what is unambiguously compose.
ALTER TABLE `projects` ADD `recovering_started_at` text;--> statement-breakpoint
UPDATE `projects` SET `dockerfile_path` = NULL WHERE
    `dockerfile_path` LIKE '/var/folders/%/openlander-%' OR
    `dockerfile_path` LIKE '/tmp/openlander-%' OR
    `dockerfile_path` LIKE '/private/var/folders/%/openlander-%' OR
    `dockerfile_path` LIKE '/private/tmp/openlander-%' OR
    `dockerfile_path` LIKE '%/T/openlander-%';--> statement-breakpoint
UPDATE `projects` SET `recovering_started_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE `status` = 'recovering' AND `recovering_started_at` IS NULL;--> statement-breakpoint
UPDATE `projects` SET `build_method` = 'compose'
    WHERE `source` = 'git'
      AND `build_method` IS NULL
      AND `dockerfile_path` IS NOT NULL
      AND (
          `dockerfile_path` LIKE '%docker-compose.yml'
          OR `dockerfile_path` LIKE '%docker-compose.yaml'
          OR `dockerfile_path` LIKE '%compose.yml'
          OR `dockerfile_path` LIKE '%compose.yaml'
      );
