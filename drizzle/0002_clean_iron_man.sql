CREATE TABLE `driver_company_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`driver_profile_id` int NOT NULL,
	`company_id` int NOT NULL,
	`status` enum('pending','active','declined','removed') NOT NULL DEFAULT 'pending',
	`invited_at` timestamp NOT NULL DEFAULT (now()),
	`responded_at` timestamp,
	CONSTRAINT `driver_company_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `phone_auth_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone_number` varchar(20) NOT NULL,
	`device_fingerprint` varchar(128),
	`driver_profile_id` int,
	`user_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_seen_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `phone_auth_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `phone_auth_sessions_phone_number_unique` UNIQUE(`phone_number`)
);
--> statement-breakpoint
ALTER TABLE `companies` ADD `company_code` varchar(8);--> statement-breakpoint
ALTER TABLE `companies` ADD `dotNumber` varchar(32);--> statement-breakpoint
ALTER TABLE `driver_profiles` ADD `driver_code` varchar(8);--> statement-breakpoint
ALTER TABLE `driver_profiles` ADD `pushToken` text;--> statement-breakpoint
ALTER TABLE `driver_profiles` ADD `phone_verified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD CONSTRAINT `companies_company_code_unique` UNIQUE(`company_code`);--> statement-breakpoint
ALTER TABLE `driver_profiles` ADD CONSTRAINT `driver_profiles_driver_code_unique` UNIQUE(`driver_code`);--> statement-breakpoint
ALTER TABLE `driver_profiles` DROP COLUMN `companyId`;--> statement-breakpoint
ALTER TABLE `driver_profiles` DROP COLUMN `joinedAt`;