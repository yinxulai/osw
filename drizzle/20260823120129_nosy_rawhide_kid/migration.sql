CREATE TABLE `request_rewrite_rules` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`scope` text DEFAULT 'model' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`schemaVersion` integer DEFAULT 1 NOT NULL,
	`match` text NOT NULL,
	`actions` text NOT NULL,
	`testCases` text DEFAULT '[]' NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `provider_model_request_rewrite_rules` (
	`providerModelId` text NOT NULL,
	`requestRewriteRuleId` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `provider_model_request_rewrite_rules_pk` PRIMARY KEY(`providerModelId`, `requestRewriteRuleId`),
	CONSTRAINT `fk_provider_model_request_rewrite_rules_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`),
	CONSTRAINT `fk_provider_model_request_rewrite_rules_requestRewriteRuleId_request_rewrite_rules_id_fk` FOREIGN KEY (`requestRewriteRuleId`) REFERENCES `request_rewrite_rules`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_enabled` ON `request_rewrite_rules` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_scope` ON `request_rewrite_rules` (`scope`);--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_deleted_time` ON `request_rewrite_rules` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_request_rewrite_rule_priority` ON `provider_model_request_rewrite_rules` (`providerModelId`,`priority`);
