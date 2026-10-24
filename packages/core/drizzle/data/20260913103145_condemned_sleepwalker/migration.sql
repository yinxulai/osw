CREATE TABLE `attempt_contents` (
	`id` text PRIMARY KEY,
	`attemptId` text NOT NULL,
	`captureStatus` text NOT NULL,
	`requestHeaders` text,
	`requestBody` text,
	`responseStatus` integer,
	`responseHeaders` text,
	`responseBody` text,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_attempt_contents_attemptId_request_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `request_attempts`(`id`),
	CONSTRAINT "chk_attempt_contents_capture_status" CHECK("captureStatus" in ('captured', 'partial'))
);
--> statement-breakpoint
CREATE TABLE `attempt_usages` (
	`attemptId` text NOT NULL,
	`type` text NOT NULL,
	`value` real,
	`rawValue` text,
	`createdTime` integer NOT NULL,
	CONSTRAINT `attempt_usages_pk` PRIMARY KEY(`attemptId`, `type`),
	CONSTRAINT `fk_attempt_usages_attemptId_request_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `request_attempts`(`id`),
	CONSTRAINT "chk_attempt_usages_type" CHECK("type" in ('inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens', 'raw')),
	CONSTRAINT "chk_attempt_usages_value_shape" CHECK(("type" = 'raw' and "value" is null and "rawValue" is not null) or ("type" <> 'raw' and "value" is not null and "rawValue" is null))
);
--> statement-breakpoint
CREATE TABLE `provider_health` (
	`providerId` text PRIMARY KEY,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	`cooldownUntilTime` integer,
	`lastSuccessTime` integer,
	`lastFailureTime` integer,
	`updatedTime` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_model_health` (
	`providerModelId` text PRIMARY KEY,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	`cooldownUntilTime` integer,
	`lastSuccessTime` integer,
	`lastFailureTime` integer,
	`updatedTime` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_attempts` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`providerId` text NOT NULL,
	`providerModelId` text NOT NULL,
	`providerName` text NOT NULL,
	`providerModelName` text NOT NULL,
	`upstreamProtocol` text,
	`upstreamRequestId` text,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`httpStatus` integer,
	`retryable` integer DEFAULT false NOT NULL,
	`upstreamTransport` text,
	`attemptIndex` integer NOT NULL,
	`durationMilliseconds` integer NOT NULL,
	`ttftMilliseconds` integer,
	`errorCode` text,
	`errorMessage` text,
	`requestRewriteRuleIds` text DEFAULT '[]' NOT NULL,
	`responseRewriteRuleIds` text DEFAULT '[]' NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `fk_request_attempts_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`),
	CONSTRAINT "chk_request_attempts_status" CHECK("status" in ('success', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `request_attributes` (
	`requestId` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `request_attributes_pk` PRIMARY KEY(`requestId`, `key`),
	CONSTRAINT `fk_request_attributes_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `request_contents` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`captureStatus` text NOT NULL,
	`requestMethod` text NOT NULL,
	`requestPath` text NOT NULL,
	`requestHeaders` text,
	`requestBody` text,
	`responseStatus` integer,
	`responseHeaders` text,
	`responseBody` text,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_request_contents_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`),
	CONSTRAINT "chk_request_contents_capture_status" CHECK("captureStatus" in ('captured', 'partial'))
);
--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` text PRIMARY KEY,
	`status` text NOT NULL,
	`clientProtocol` text,
	`transport` text DEFAULT 'http' NOT NULL,
	`logicalModelId` text,
	`totalDurationMilliseconds` integer DEFAULT 0 NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT "chk_request_logs_status" CHECK("status" in ('pending', 'success', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `request_usages` (
	`requestId` text NOT NULL,
	`type` text NOT NULL,
	`value` real,
	`rawValue` text,
	`createdTime` integer NOT NULL,
	CONSTRAINT `request_usages_pk` PRIMARY KEY(`requestId`, `type`),
	CONSTRAINT `fk_request_usages_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`),
	CONSTRAINT "chk_request_usages_type" CHECK("type" in ('inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens', 'raw')),
	CONSTRAINT "chk_request_usages_value_shape" CHECK(("type" = 'raw' and "value" is null and "rawValue" is not null) or ("type" <> 'raw' and "value" is not null and "rawValue" is null))
);
--> statement-breakpoint
CREATE TABLE `runtime_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attempt_contents_attempt` ON `attempt_contents` (`attemptId`);--> statement-breakpoint
CREATE INDEX `idx_attempt_contents_created_time` ON `attempt_contents` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_attempt_usages_created_time` ON `attempt_usages` (`createdTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_request_attempts_request_order` ON `request_attempts` (`requestId`,`attemptIndex`);--> statement-breakpoint
CREATE INDEX `idx_request_attempts_created_time` ON `request_attempts` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_attempts_provider_time` ON `request_attempts` (`providerId`,`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_attempts_model_time` ON `request_attempts` (`providerModelId`,`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_attributes_key_value` ON `request_attributes` (`key`,`value`);--> statement-breakpoint
CREATE INDEX `idx_request_attributes_created_time` ON `request_attributes` (`createdTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_request_contents_request` ON `request_contents` (`requestId`);--> statement-breakpoint
CREATE INDEX `idx_request_contents_created_time` ON `request_contents` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_created_time` ON `request_logs` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_status_created_time` ON `request_logs` (`status`,`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_logical_model` ON `request_logs` (`logicalModelId`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_client_protocol` ON `request_logs` (`clientProtocol`);--> statement-breakpoint
CREATE INDEX `idx_request_usages_created_time` ON `request_usages` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_timestamp` ON `runtime_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_level_timestamp` ON `runtime_logs` (`level`,`timestamp`);