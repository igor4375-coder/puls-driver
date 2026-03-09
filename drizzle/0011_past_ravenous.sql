CREATE TABLE `load_signatures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`load_id` varchar(64) NOT NULL,
	`driver_code` varchar(16) NOT NULL,
	`signature_type` enum('pickup','delivery') NOT NULL,
	`customer_sig` text,
	`driver_sig` text,
	`customer_not_available` boolean NOT NULL DEFAULT false,
	`captured_at` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `load_signatures_id` PRIMARY KEY(`id`)
);
