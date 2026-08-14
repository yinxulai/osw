CREATE TABLE `logical_models` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `model_bindings` (
	`id` text PRIMARY KEY,
	`logicalModelId` text NOT NULL,
	`providerId` text NOT NULL,
	`protocol` text NOT NULL,
	`upstreamUrl` text DEFAULT '' NOT NULL,
	`upstreamModelId` text NOT NULL,
	`priority` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`customAuthHeader` text,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `fk_model_bindings_logicalModelId_logical_models_id_fk` FOREIGN KEY (`logicalModelId`) REFERENCES `logical_models`(`id`),
	CONSTRAINT `fk_model_bindings_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_health` (
	`providerId` text PRIMARY KEY,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	`cooldownUntilTime` integer,
	`lastSuccessTime` integer,
	`lastFailureTime` integer,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_provider_health_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`apiKeyReference` text NOT NULL,
	`timeoutMilliseconds` integer DEFAULT 30000 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`upstreamUrls` text DEFAULT '{}' NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `request_attempts` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`providerId` text NOT NULL,
	`bindingId` text NOT NULL,
	`upstreamModelId` text NOT NULL,
	`attemptIndex` integer NOT NULL,
	`status` text NOT NULL,
	`errorCode` text,
	`errorMessage` text,
	`durationMilliseconds` integer NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `fk_request_attempts_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`),
	CONSTRAINT `fk_request_attempts_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`),
	CONSTRAINT `fk_request_attempts_bindingId_model_bindings_id_fk` FOREIGN KEY (`bindingId`) REFERENCES `model_bindings`(`id`)
);
--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` text PRIMARY KEY,
	`logicalModelId` text NOT NULL,
	`protocol` text NOT NULL,
	`status` text NOT NULL,
	`totalDurationMilliseconds` integer NOT NULL,
	`totalTokens` integer,
	`createdTime` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY,
	`listenHost` text DEFAULT '127.0.0.1' NOT NULL,
	`listenPort` integer DEFAULT 9300 NOT NULL,
	`accessTokenReference` text,
	`logRetentionCount` integer DEFAULT 1000 NOT NULL,
	`cooldownBaseSeconds` integer DEFAULT 30 NOT NULL,
	`cooldownMaxSeconds` integer DEFAULT 300 NOT NULL,
	`consecutiveFailureThreshold` integer DEFAULT 3 NOT NULL,
	`idleTimeoutMilliseconds` integer DEFAULT 30000 NOT NULL,
	`updatedTime` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_logical_models_name` ON `logical_models` (`name`);--> statement-breakpoint
CREATE INDEX `idx_logical_models_deleted_time` ON `logical_models` (`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_bindings_logical_model_priority` ON `model_bindings` (`logicalModelId`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_bindings_provider` ON `model_bindings` (`providerId`);--> statement-breakpoint
CREATE INDEX `idx_bindings_protocol` ON `model_bindings` (`protocol`);--> statement-breakpoint
CREATE INDEX `idx_bindings_deleted_time` ON `model_bindings` (`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_providers_deleted_time` ON `providers` (`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_attempts_request_id` ON `request_attempts` (`requestId`);--> statement-breakpoint
CREATE INDEX `idx_attempts_provider` ON `request_attempts` (`providerId`);--> statement-breakpoint
CREATE INDEX `idx_attempts_created_time` ON `request_attempts` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_created_time` ON `request_logs` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_status` ON `request_logs` (`status`);