ALTER TABLE `request_logs` ADD `apiKeyId` text;--> statement-breakpoint
CREATE INDEX `idx_request_logs_api_key_time` ON `request_logs` (`apiKeyId`,`createdTime`);