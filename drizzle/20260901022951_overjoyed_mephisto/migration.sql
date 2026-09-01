CREATE TABLE `runtime_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_timestamp` ON `runtime_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_level_timestamp` ON `runtime_logs` (`level`,`timestamp`);