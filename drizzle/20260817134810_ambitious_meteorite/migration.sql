CREATE TABLE `upstream_models` (
	`id` text PRIMARY KEY,
	`logicalModelId` text NOT NULL,
	`providerId` text NOT NULL,
	`upstreamModelId` text NOT NULL,
	`endpoints` text DEFAULT '[]' NOT NULL,
	`priority` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `fk_upstream_models_logicalModelId_logical_models_id_fk` FOREIGN KEY (`logicalModelId`) REFERENCES `logical_models`(`id`),
	CONSTRAINT `fk_upstream_models_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `autoLaunch` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_request_attempts` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`providerId` text NOT NULL,
	`upstreamModelId` text NOT NULL,
	`attemptIndex` integer NOT NULL,
	`status` text NOT NULL,
	`errorCode` text,
	`errorMessage` text,
	`durationMilliseconds` integer NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `fk_request_attempts_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`),
	CONSTRAINT `fk_request_attempts_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_request_attempts`(`id`, `requestId`, `providerId`, `upstreamModelId`, `attemptIndex`, `status`, `errorCode`, `errorMessage`, `durationMilliseconds`, `createdTime`) SELECT `id`, `requestId`, `providerId`, `upstreamModelId`, `attemptIndex`, `status`, `errorCode`, `errorMessage`, `durationMilliseconds`, `createdTime` FROM `request_attempts`;--> statement-breakpoint
DROP TABLE `request_attempts`;--> statement-breakpoint
ALTER TABLE `__new_request_attempts` RENAME TO `request_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_bindings_logical_model_priority`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_bindings_provider`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_bindings_protocol`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_bindings_deleted_time`;--> statement-breakpoint
CREATE INDEX `idx_attempts_request_id` ON `request_attempts` (`requestId`);--> statement-breakpoint
CREATE INDEX `idx_attempts_provider` ON `request_attempts` (`providerId`);--> statement-breakpoint
CREATE INDEX `idx_attempts_created_time` ON `request_attempts` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_upstream_models_logical_priority` ON `upstream_models` (`logicalModelId`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_upstream_models_provider` ON `upstream_models` (`providerId`);--> statement-breakpoint
CREATE INDEX `idx_upstream_models_deleted_time` ON `upstream_models` (`deletedTime`);--> statement-breakpoint
DROP TABLE `model_bindings`;