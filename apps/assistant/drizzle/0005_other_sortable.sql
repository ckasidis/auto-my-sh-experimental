-- Other, the default category, now takes its place in the order like any other; it starts after every one, where lists
-- showed it.
UPDATE `ingredient_categories` SET `position` = (SELECT coalesce(max(`position`), 0) + 1 FROM `ingredient_categories` WHERE `id` != 'category:other') WHERE `id` = 'category:other';
