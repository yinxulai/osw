CREATE TABLE `logical_models` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
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
	`deletedTime` integer,
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
	`deletedTime` integer,
	CONSTRAINT `fk_provider_endpoints_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
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
	`deletedTime` integer,
	CONSTRAINT `fk_provider_model_endpoints_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`),
	CONSTRAINT `fk_provider_model_endpoints_providerEndpointId_provider_endpoints_id_fk` FOREIGN KEY (`providerEndpointId`) REFERENCES `provider_endpoints`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_model_request_rewrite_rules` (
	`providerModelId` text NOT NULL,
	`requestRewriteRuleId` text NOT NULL,
	`priority` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `provider_model_request_rewrite_rules_pk` PRIMARY KEY(`providerModelId`, `requestRewriteRuleId`),
	CONSTRAINT `fk_provider_model_request_rewrite_rules_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`),
	CONSTRAINT `fk_provider_model_request_rewrite_rules_requestRewriteRuleId_request_rewrite_rules_id_fk` FOREIGN KEY (`requestRewriteRuleId`) REFERENCES `request_rewrite_rules`(`id`)
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
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `request_rewrite_rules` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`scope` text DEFAULT 'model' NOT NULL,
	`schemaVersion` integer DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`match` text NOT NULL,
	`actions` text NOT NULL,
	`testCases` text DEFAULT '[]' NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
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
	`deletedTime` integer,
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
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`definition` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE INDEX `idx_logical_models_enabled` ON `logical_models` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_logical_models_deleted_time` ON `logical_models` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_protocol_converters_unique_active` ON `protocol_converters` (`providerModelEndpointId`,`clientProtocol`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_protocol_converters_protocol` ON `protocol_converters` (`clientProtocol`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_protocol_converters_deleted_time` ON `protocol_converters` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_endpoints_provider_protocol_active` ON `provider_endpoints` (`providerId`,`protocol`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_endpoints_protocol` ON `provider_endpoints` (`protocol`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_provider_endpoints_deleted_time` ON `provider_endpoints` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_model_endpoints_unique_active` ON `provider_model_endpoints` (`providerModelId`,`providerEndpointId`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_model_endpoints_provider_endpoint` ON `provider_model_endpoints` (`providerEndpointId`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_provider_model_endpoints_deleted_time` ON `provider_model_endpoints` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_model_request_rewrite_rule_priority_active` ON `provider_model_request_rewrite_rules` (`providerModelId`,`priority`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_model_request_rewrite_rules_deleted_time` ON `provider_model_request_rewrite_rules` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_models_provider_model_active` ON `provider_models` (`providerId`,`modelName`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_models_enabled` ON `provider_models` (`providerId`,`enabled`,`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_provider_settings_key` ON `provider_settings` (`key`);--> statement-breakpoint
CREATE INDEX `idx_providers_enabled` ON `providers` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_providers_deleted_time` ON `providers` (`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_enabled` ON `request_rewrite_rules` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_scope` ON `request_rewrite_rules` (`scope`);--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_deleted_time` ON `request_rewrite_rules` (`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_scheduling_policies_route` ON `scheduling_policies` (`logicalModelId`,`enabled`,`priority`,`weight`);--> statement-breakpoint
CREATE INDEX `idx_scheduling_policies_deleted_time` ON `scheduling_policies` (`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_settings_updated_time` ON `settings` (`updatedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflows_type_version` ON `workflows` (`type`,`version`);--> statement-breakpoint
CREATE INDEX `idx_workflows_type` ON `workflows` (`type`,`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_workflows_deleted_time` ON `workflows` (`deletedTime`);