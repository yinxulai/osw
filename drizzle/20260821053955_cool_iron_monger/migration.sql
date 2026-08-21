CREATE TABLE `logical_models` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `protocol_converters` (
	`id` text PRIMARY KEY,
	`providerModelEndpointId` text NOT NULL,
	`clientProtocol` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_protocol_converters_providerModelEndpointId_provider_model_endpoints_id_fk` FOREIGN KEY (`providerModelEndpointId`) REFERENCES `provider_model_endpoints`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_endpoints` (
	`id` text PRIMARY KEY,
	`providerId` text NOT NULL,
	`protocol` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_provider_endpoints_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
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
CREATE TABLE `provider_model_endpoints` (
	`id` text PRIMARY KEY,
	`providerModelId` text NOT NULL,
	`providerEndpointId` text NOT NULL,
	`url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_provider_model_endpoints_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`),
	CONSTRAINT `fk_provider_model_endpoints_providerEndpointId_provider_endpoints_id_fk` FOREIGN KEY (`providerEndpointId`) REFERENCES `provider_endpoints`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_model_health` (
	`providerModelId` text PRIMARY KEY,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	`cooldownUntilTime` integer,
	`lastSuccessTime` integer,
	`lastFailureTime` integer,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_provider_model_health_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY,
	`providerId` text NOT NULL,
	`modelName` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `fk_provider_models_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_settings` (
	`providerId` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`valueType` text DEFAULT 'string' NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `provider_settings_pk` PRIMARY KEY(`providerId`, `key`),
	CONSTRAINT `fk_provider_settings_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `request_attempts` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`providerId` text NOT NULL,
	`providerModelId` text NOT NULL,
	`providerName` text NOT NULL,
	`providerModelName` text NOT NULL,
	`providerProtocol` text,
	`providerRequestId` text,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`httpStatus` integer,
	`retryable` integer DEFAULT false NOT NULL,
	`attemptIndex` integer NOT NULL,
	`durationMilliseconds` integer NOT NULL,
	`errorCode` text,
	`errorMessage` text,
	`details` text,
	`createdTime` integer NOT NULL,
	CONSTRAINT `fk_request_attempts_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `request_contents` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`attemptId` text,
	`captureStatus` text NOT NULL,
	`requestMethod` text NOT NULL,
	`requestPath` text NOT NULL,
	`requestHeaders` text,
	`requestBody` text,
	`responseStatus` integer,
	`responseHeaders` text,
	`responseBody` text,
	`conversions` text,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_request_contents_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` text PRIMARY KEY,
	`status` text NOT NULL,
	`protocol` text NOT NULL,
	`logicalModelId` text NOT NULL,
	`metadata` text,
	`createdTime` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_metrics` (
	`requestId` text NOT NULL,
	`key` text NOT NULL,
	`value` real NOT NULL,
	`unit` text DEFAULT 'count' NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `request_metrics_pk` PRIMARY KEY(`requestId`, `key`),
	CONSTRAINT `fk_request_metrics_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `request_usages` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`attemptId` text,
	`type` text NOT NULL,
	`unit` text DEFAULT 'count' NOT NULL,
	`value` real NOT NULL,
	`rawValue` text,
	`createdTime` integer NOT NULL,
	CONSTRAINT `fk_request_usages_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduling_policies` (
	`logicalModelId` text NOT NULL,
	`providerModelId` text NOT NULL,
	`strategy` text DEFAULT 'priority' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`weight` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `scheduling_policies_pk` PRIMARY KEY(`logicalModelId`, `providerModelId`),
	CONSTRAINT `fk_scheduling_policies_logicalModelId_logical_models_id_fk` FOREIGN KEY (`logicalModelId`) REFERENCES `logical_models`(`id`),
	CONSTRAINT `fk_scheduling_policies_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`valueType` text DEFAULT 'string' NOT NULL,
	`updatedTime` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_logical_models_enabled` ON `logical_models` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_logical_models_deleted_time` ON `logical_models` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_protocol_converters_unique` ON `protocol_converters` (`providerModelEndpointId`,`clientProtocol`);--> statement-breakpoint
CREATE INDEX `idx_protocol_converters_protocol` ON `protocol_converters` (`clientProtocol`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_endpoints_provider_protocol` ON `provider_endpoints` (`providerId`,`protocol`);--> statement-breakpoint
CREATE INDEX `idx_provider_endpoints_protocol` ON `provider_endpoints` (`protocol`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_model_endpoints_unique` ON `provider_model_endpoints` (`providerModelId`,`providerEndpointId`);--> statement-breakpoint
CREATE INDEX `idx_provider_model_endpoints_provider_endpoint` ON `provider_model_endpoints` (`providerEndpointId`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_models_provider_model_active` ON `provider_models` (`providerId`,`modelName`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_models_enabled` ON `provider_models` (`providerId`,`enabled`,`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_provider_settings_key` ON `provider_settings` (`key`);--> statement-breakpoint
CREATE INDEX `idx_providers_enabled` ON `providers` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_providers_deleted_time` ON `providers` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_request_attempts_request_order` ON `request_attempts` (`requestId`,`attemptIndex`);--> statement-breakpoint
CREATE INDEX `idx_request_attempts_provider_time` ON `request_attempts` (`providerId`,`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_attempts_model_time` ON `request_attempts` (`providerModelId`,`createdTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_request_contents_request_level` ON `request_contents` (`requestId`) WHERE attemptId IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_request_contents_attempt` ON `request_contents` (`attemptId`) WHERE attemptId IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_request_logs_created_time` ON `request_logs` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_status` ON `request_logs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_logical_model` ON `request_logs` (`logicalModelId`);--> statement-breakpoint
CREATE INDEX `idx_request_metrics_key` ON `request_metrics` (`key`);--> statement-breakpoint
CREATE INDEX `idx_request_usages_type_time` ON `request_usages` (`type`,`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_usages_request` ON `request_usages` (`requestId`);--> statement-breakpoint
CREATE INDEX `idx_request_usages_attempt` ON `request_usages` (`attemptId`);--> statement-breakpoint
CREATE INDEX `idx_scheduling_policies_route` ON `scheduling_policies` (`logicalModelId`,`enabled`,`priority`,`weight`);--> statement-breakpoint
CREATE INDEX `idx_settings_updated_time` ON `settings` (`updatedTime`);
