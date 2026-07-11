CREATE TABLE `bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_month` text NOT NULL,
	`units` integer,
	`amount_pkr` real,
	`payment_pkr` real,
	`status_code` text,
	`reading_date` text,
	`issue_date` text,
	`due_date` text,
	`payable_after_due_pkr` real,
	`fpa_pkr` real,
	`effective_rate_pkr` real,
	`source` text DEFAULT 'history' NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bills_bill_month_unique` ON `bills` (`bill_month`);