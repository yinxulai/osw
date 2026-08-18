ALTER TABLE `request_logs` ADD `cachedInputTokens` integer;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `cacheCreationInputTokens` integer;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `promptCacheHit` integer;