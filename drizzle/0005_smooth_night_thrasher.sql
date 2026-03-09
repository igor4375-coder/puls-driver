CREATE TABLE `load_expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`load_id` varchar(64) NOT NULL,
	`driver_code` varchar(16) NOT NULL,
	`label` varchar(128) NOT NULL,
	`amount_cents` int NOT NULL,
	`expense_date` varchar(10) NOT NULL,
	`receipt_url` text,
	`receipt_key` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `load_expenses_id` PRIMARY KEY(`id`)
);
