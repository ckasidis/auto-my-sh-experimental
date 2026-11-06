CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workout_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`date` text NOT NULL,
	`sets` integer NOT NULL,
	`reps` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_entries_exercise_date` ON `workout_entries` (`exercise_id`,`date`);