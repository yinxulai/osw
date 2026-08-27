CREATE TABLE `request_attributes` (
	`requestId` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`valueType` text DEFAULT 'string' NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `request_attributes_pk` PRIMARY KEY(`requestId`, `key`),
	CONSTRAINT `fk_request_attributes_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_request_attributes_key_value` ON `request_attributes` (`key`,`value`);
--> statement-breakpoint
CREATE INDEX `idx_request_attributes_created_time` ON `request_attributes` (`createdTime`);
