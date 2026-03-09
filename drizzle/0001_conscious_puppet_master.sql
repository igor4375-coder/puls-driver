CREATE TABLE `companies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320),
	`phone` varchar(32),
	`address` text,
	`logoUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `company_invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`companyId` int NOT NULL,
	`code` varchar(16) NOT NULL,
	`driverName` varchar(255),
	`driverEmail` varchar(320),
	`acceptedByDriverId` int,
	`status` enum('pending','accepted','expired','revoked') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `company_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `company_invitations_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `driver_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`companyId` int,
	`name` varchar(255) NOT NULL,
	`email` varchar(320),
	`phone` varchar(32),
	`licenseNumber` varchar(64),
	`truckNumber` varchar(64),
	`trailerNumber` varchar(64),
	`status` enum('active','inactive','suspended') NOT NULL DEFAULT 'active',
	`joinedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `driver_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `driver_profiles_userId_unique` UNIQUE(`userId`)
);
