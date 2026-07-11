CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`ts` integer NOT NULL,
	`payload` text,
	`delivered` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip` text NOT NULL,
	`ts` integer NOT NULL,
	`success` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_ip_ts_idx` ON `auth_attempts` (`ip`,`ts`);--> statement-breakpoint
CREATE TABLE `device_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_time` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_events_unique` ON `device_events` (`device_id`,`event_type`,`event_time`);--> statement-breakpoint
CREATE INDEX `device_events_time_idx` ON `device_events` (`event_time`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`product_name` text,
	`role` text DEFAULT 'other' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`last_online` integer,
	`last_seen_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `energy_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`day` text NOT NULL,
	`kwh` real NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `energy_daily_device_day_unique` ON `energy_daily` (`device_id`,`day`);--> statement-breakpoint
CREATE TABLE `energy_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`event_time` integer NOT NULL,
	`kwh` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `energy_events_device_time_unique` ON `energy_events` (`device_id`,`event_time`);--> statement-breakpoint
CREATE TABLE `energy_hourly` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`hour_start` integer NOT NULL,
	`kwh` real DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'register' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `energy_hourly_device_hour_unique` ON `energy_hourly` (`device_id`,`hour_start`);--> statement-breakpoint
CREATE INDEX `energy_hourly_hour_idx` ON `energy_hourly` (`hour_start`);--> statement-breakpoint
CREATE TABLE `outages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_ts` integer NOT NULL,
	`end_ts` integer,
	`duration_min` real,
	`kind` text DEFAULT 'unknown' NOT NULL,
	`register_delta_kwh` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outages_start_unique` ON `outages` (`start_ts`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`keys` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`ts` integer NOT NULL,
	`power_w` real,
	`voltage_v` real,
	`current_a` real,
	`leakage_ma` real,
	`frequency_hz` real,
	`source` text DEFAULT 'poll' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `readings_device_ts_unique` ON `readings` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `readings_ts_idx` ON `readings` (`ts`);--> statement-breakpoint
CREATE TABLE `register_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`ts` integer NOT NULL,
	`register_kwh` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `register_snapshots_device_ts_unique` ON `register_snapshots` (`device_id`,`ts`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
