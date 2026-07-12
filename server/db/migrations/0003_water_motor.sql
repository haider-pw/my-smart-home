ALTER TABLE `devices` ADD `rated_watts` integer;--> statement-breakpoint
UPDATE `devices` SET `role` = 'switch', `is_active` = 1 WHERE `category` = 'tdq' AND `role` = 'other';