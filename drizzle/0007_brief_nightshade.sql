CREATE TABLE `gate_pass_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`load_id` varchar(64) NOT NULL,
	`company_code` varchar(16) NOT NULL,
	`file_url` text NOT NULL,
	`file_key` varchar(512) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`mime_type` varchar(64) NOT NULL,
	`file_size_bytes` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gate_pass_files_id` PRIMARY KEY(`id`)
);
