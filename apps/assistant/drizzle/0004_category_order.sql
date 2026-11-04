ALTER TABLE `ingredient_categories` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing categories keep the order they were listed in, by name.
UPDATE `ingredient_categories` SET `position` = `ranked`.`rank` FROM (SELECT `id`, row_number() OVER (ORDER BY `name` COLLATE NOCASE, `id`) AS `rank` FROM `ingredient_categories`) AS `ranked` WHERE `ingredient_categories`.`id` = `ranked`.`id`;
