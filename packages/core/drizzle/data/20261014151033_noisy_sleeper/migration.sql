ALTER TABLE `runtime_logs` ADD `scope` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_scope_timestamp` ON `runtime_logs` (`scope`,`timestamp`);