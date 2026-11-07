CREATE TABLE `grocery_purchases` (
	`week` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`week`, `ingredient_id`),
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE cascade
);
