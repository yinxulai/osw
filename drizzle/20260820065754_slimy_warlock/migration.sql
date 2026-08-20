ALTER TABLE `request_logs` ADD `upstreamProtocol` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` text PRIMARY KEY,
	`listenHost` text DEFAULT '127.0.0.1' NOT NULL,
	`listenPort` integer DEFAULT 9300 NOT NULL,
	`accessTokenReference` text,
	`logRetentionCount` integer DEFAULT 5000 NOT NULL,
	`cooldownBaseSeconds` integer DEFAULT 30 NOT NULL,
	`cooldownMaxSeconds` integer DEFAULT 300 NOT NULL,
	`consecutiveFailureThreshold` integer DEFAULT 3 NOT NULL,
	`idleTimeoutMilliseconds` integer DEFAULT 30000 NOT NULL,
	`autoLaunch` integer DEFAULT false NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT "settings_singleton_id" CHECK("id" = 'singleton')
);
--> statement-breakpoint
INSERT INTO `__new_settings`(`id`, `listenHost`, `listenPort`, `accessTokenReference`, `logRetentionCount`, `cooldownBaseSeconds`, `cooldownMaxSeconds`, `consecutiveFailureThreshold`, `idleTimeoutMilliseconds`, `autoLaunch`, `updatedTime`) SELECT `id`, `listenHost`, `listenPort`, `accessTokenReference`, `logRetentionCount`, `cooldownBaseSeconds`, `cooldownMaxSeconds`, `consecutiveFailureThreshold`, `idleTimeoutMilliseconds`, `autoLaunch`, `updatedTime` FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;