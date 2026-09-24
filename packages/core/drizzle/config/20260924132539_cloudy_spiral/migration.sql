CREATE TABLE `client_config_versions` (
	`id` text PRIMARY KEY,
	`clientKey` text NOT NULL,
	`filePath` text NOT NULL,
	`contentHash` text NOT NULL,
	`content` text NOT NULL,
	`sizeBytes` integer DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'apply' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`createdTime` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_client_config_versions_hash` ON `client_config_versions` (`clientKey`,`filePath`,`contentHash`);--> statement-breakpoint
CREATE INDEX `idx_client_config_versions_file` ON `client_config_versions` (`clientKey`,`filePath`,`createdTime`);