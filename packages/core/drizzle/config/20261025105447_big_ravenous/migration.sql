CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`username` text NOT NULL,
	`passwordHash` text NOT NULL,
	`lastLoginTime` integer,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_created_time` ON `users` (`createdTime`);