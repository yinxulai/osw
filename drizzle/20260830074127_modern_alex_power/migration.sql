ALTER TABLE `provider_model_request_rewrite_rules` ADD `deletedTime` integer;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_provider_model_request_rewrite_rule_priority`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_model_request_rewrite_rule_priority_active` ON `provider_model_request_rewrite_rules` (`providerModelId`,`priority`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_model_request_rewrite_rules_deleted_time` ON `provider_model_request_rewrite_rules` (`deletedTime`);