PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_upstream_models` (
	`id` text PRIMARY KEY,
	`providerId` text NOT NULL,
	`upstreamModelId` text NOT NULL,
	`endpoints` text DEFAULT '[]' NOT NULL,
	`priority` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `fk_upstream_models_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_upstream_models`(`id`, `providerId`, `upstreamModelId`, `endpoints`, `priority`, `enabled`, `createdTime`, `updatedTime`, `deletedTime`) SELECT `id`, `providerId`, `upstreamModelId`, `endpoints`, `priority`, `enabled`, `createdTime`, `updatedTime`, `deletedTime` FROM `upstream_models`;--> statement-breakpoint
DROP TABLE `upstream_models`;--> statement-breakpoint
ALTER TABLE `__new_upstream_models` RENAME TO `upstream_models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_upstream_models_logical_priority`;--> statement-breakpoint
CREATE INDEX `idx_upstream_models_priority` ON `upstream_models` (`priority`);--> statement-breakpoint
CREATE INDEX `idx_upstream_models_provider` ON `upstream_models` (`providerId`);--> statement-breakpoint
CREATE INDEX `idx_upstream_models_deleted_time` ON `upstream_models` (`deletedTime`);