ALTER TABLE "pat_tokens" ADD COLUMN "token_encrypted" text;--> statement-breakpoint
ALTER TABLE "pat_tokens" ADD COLUMN "token_encrypted_iv" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "access_code_encrypted" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "access_code_encrypted_iv" text;