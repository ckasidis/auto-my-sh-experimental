CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due_at` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
