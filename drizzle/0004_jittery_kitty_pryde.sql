ALTER TABLE `driver_profiles` ADD `equipment_type` enum('tow_truck','flatbed','stinger','seven_car_carrier');--> statement-breakpoint
ALTER TABLE `driver_profiles` ADD `equipment_capacity` tinyint;--> statement-breakpoint
ALTER TABLE `driver_profiles` ADD `notify_new_load` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `driver_profiles` ADD `notify_new_invite` boolean DEFAULT true NOT NULL;