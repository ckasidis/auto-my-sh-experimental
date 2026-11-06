CREATE TABLE `plan_exercises` (
	`plan_id` text NOT NULL,
	`position` integer NOT NULL,
	`exercise_id` text NOT NULL,
	`sets` integer NOT NULL,
	PRIMARY KEY(`plan_id`, `position`),
	FOREIGN KEY (`plan_id`) REFERENCES `workout_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_sets` (
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`exercise_id` text NOT NULL,
	`warmup` integer DEFAULT false NOT NULL,
	`reps` integer NOT NULL,
	`weight` real,
	PRIMARY KEY(`session_id`, `position`),
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_sets_exercise` ON `session_sets` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `workout_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`plan_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `workout_plans`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workout_sessions_date` ON `workout_sessions` (`date`);--> statement-breakpoint
-- The log's entries, each "sets × reps" of an exercise on a day, become a session per day with a set per row: sets
-- rows of reps each, without weight, in the order they were logged.
INSERT INTO `workout_sessions` (`id`, `date`, `plan_id`, `created_at`) SELECT 'session:' || `date`, `date`, NULL, min(`created_at`) FROM `workout_entries` GROUP BY `date`;
--> statement-breakpoint
INSERT INTO `session_sets` (`session_id`, `position`, `exercise_id`, `warmup`, `reps`, `weight`) WITH RECURSIVE `n`(`i`) AS (SELECT 1 UNION ALL SELECT `i` + 1 FROM `n` WHERE `i` < 100) SELECT 'session:' || `e`.`date`, row_number() OVER (PARTITION BY `e`.`date` ORDER BY `e`.`created_at`, `e`.`id`, `n`.`i`) - 1, `e`.`exercise_id`, 0, `e`.`reps`, NULL FROM `workout_entries` AS `e` JOIN `n` ON `n`.`i` <= `e`.`sets`;
