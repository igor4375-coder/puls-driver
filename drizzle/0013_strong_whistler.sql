CREATE TABLE `driver_locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`driver_code` varchar(16) NOT NULL,
	`latitude` decimal(10,7) NOT NULL,
	`longitude` decimal(10,7) NOT NULL,
	`accuracy` decimal(8,2),
	`speed` decimal(8,2),
	`heading` decimal(6,2),
	`device_timestamp` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `driver_locations_id` PRIMARY KEY(`id`)
);
