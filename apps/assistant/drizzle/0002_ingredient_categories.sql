CREATE TABLE `ingredient_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ingredients` ADD `category_id` text REFERENCES ingredient_categories(id) ON DELETE set null;