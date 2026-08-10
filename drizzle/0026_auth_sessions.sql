CREATE TABLE "auth_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
INSERT INTO "auth_sessions" ("token", "created_at", "expires_at")
SELECT "session_token", "session_created_at", "session_expires_at"
FROM "auth"
WHERE "session_token" IS NOT NULL
	AND "session_created_at" IS NOT NULL
	AND "session_expires_at" IS NOT NULL
ON CONFLICT ("token") DO NOTHING;
--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_expires_at" ON "auth_sessions" USING btree ("expires_at");
