UPDATE "services"
SET "source" = 'image'
WHERE
  "image_url" IS NOT NULL
  AND "repo_url" IS NULL
  AND "source" <> 'image'
  AND "kind" NOT IN ('git', 'compose', 'compose-child');
