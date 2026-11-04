-- "Other", the default category: every ingredient not given another is in it. An existing category named Other is
-- merged into it, so the name stays unique.
INSERT INTO `ingredient_categories` (`id`, `name`, `created_at`) VALUES ('category:other', 'Other', 0) ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE `ingredients` SET `category_id` = 'category:other' WHERE `category_id` IS NULL OR `category_id` IN (SELECT `id` FROM `ingredient_categories` WHERE lower(trim(`name`)) = 'other' AND `id` != 'category:other');
--> statement-breakpoint
DELETE FROM `ingredient_categories` WHERE lower(trim(`name`)) = 'other' AND `id` != 'category:other';
