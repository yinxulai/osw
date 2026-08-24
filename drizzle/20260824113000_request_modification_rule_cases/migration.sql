ALTER TABLE `modification_rules` RENAME TO `request_modification_rules`;
--> statement-breakpoint
ALTER TABLE `request_modification_rules` ADD COLUMN `testCases` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `provider_model_modification_rules` RENAME TO `provider_model_request_modification_rules`;
--> statement-breakpoint
ALTER TABLE `provider_model_request_modification_rules` RENAME COLUMN `ruleId` TO `requestModificationRuleId`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_modification_rules_enabled`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_modification_rules_scope`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_modification_rules_deleted_time`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_model_modification_rule_priority`;
--> statement-breakpoint
CREATE INDEX `idx_request_modification_rules_enabled` ON `request_modification_rules` (`enabled`);
--> statement-breakpoint
CREATE INDEX `idx_request_modification_rules_scope` ON `request_modification_rules` (`scope`);
--> statement-breakpoint
CREATE INDEX `idx_request_modification_rules_deleted_time` ON `request_modification_rules` (`deletedTime`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_model_request_modification_rule_priority` ON `provider_model_request_modification_rules` (`providerModelId`, `priority`);
