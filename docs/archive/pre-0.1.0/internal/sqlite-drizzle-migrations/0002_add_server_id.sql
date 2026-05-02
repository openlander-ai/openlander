ALTER TABLE `deploy_logs` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `deploy_plans` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `environments` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `runtime_incidents` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `service_connections` ADD `server_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `server_id` text DEFAULT 'local' NOT NULL;