CREATE TABLE `modification_rules` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`stage` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`schemaVersion` integer DEFAULT 1 NOT NULL,
	`match` text NOT NULL,
	`actions` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `provider_model_modification_rules` (
	`providerModelId` text NOT NULL,
	`ruleId` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `provider_model_modification_rules_pk` PRIMARY KEY(`providerModelId`, `ruleId`),
	CONSTRAINT `fk_provider_model_modification_rules_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`),
	CONSTRAINT `fk_provider_model_modification_rules_ruleId_modification_rules_id_fk` FOREIGN KEY (`ruleId`) REFERENCES `modification_rules`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_modification_rules_enabled` ON `modification_rules` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_modification_rules_stage` ON `modification_rules` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_modification_rules_deleted_time` ON `modification_rules` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_modification_rule_priority` ON `provider_model_modification_rules` (`providerModelId`,`priority`);
