CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`keyReference` text NOT NULL,
	`expiresTime` integer,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE INDEX `idx_api_keys_enabled` ON `api_keys` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_deleted_time` ON `api_keys` (`deletedTime`);