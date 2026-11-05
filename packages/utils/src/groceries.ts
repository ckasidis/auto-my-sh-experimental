/** The parts of an ingredient a grocery list reads. */
export type GroceryIngredient = {
  readonly id: string;
  readonly name: string;
  readonly unit: string | null;
  readonly categoryId: string | null;
};

/** The parts of an ingredient category a grocery list reads. */
export type GroceryCategory = {
  readonly id: string;
  readonly name: string;
  /** Where lists show it, lowest first. */
  readonly position: number;
};

/**
 * The default category: every ingredient not given another is in it, as in grocery apps (AnyList's default "Other"
 * category, Apple Reminders' "Other" section). It is ordered like any other, and starts last. A migration adds it to
 * the store.
 */
export const OTHER_CATEGORY = { id: "category:other", name: "Other", position: 0 } as const;

/** The parts of a recipe a grocery list reads: its lines are measured for `servings`. */
export type GroceryRecipe = {
  readonly id: string;
  readonly name: string;
  readonly servings: number;
  readonly ingredients: readonly {
    readonly ingredientId: string;
    readonly quantity: number | null;
  }[];
};

/** The parts of a planned meal a grocery list reads. */
export type GroceryMeal = {
  readonly recipeId: string;
  readonly servings: number;
};

/** One ingredient to buy, totalled over the planned meals that use it. */
export type GroceryItem = {
  readonly ingredientId: string;
  readonly name: string;
  readonly unit: string | null;
  /** The ingredient's category; `OTHER_CATEGORY` for one in none, or in one that is unknown. */
  readonly categoryId: string;
  readonly category: string;
  /** The sum of the measured lines in the ingredient's unit; null when no line measures it. */
  readonly quantity: number | null;
  /** Whether a line uses it without a quantity, so the total may be short of what is needed. */
  readonly unmeasured: boolean;
  /** The recipes that use it, by name, in the order they were planned. */
  readonly recipes: string[];
};

type Tally = {
  ingredient: GroceryIngredient;
  quantity: number | null;
  unmeasured: boolean;
  recipes: Set<string>;
};

/** Two decimal places: scaling by servings leaves float noise (0.30000000000000004) the list should not show. */
const round = (quantity: number) => Math.round(quantity * 100) / 100;

/** The order lists show categories in: the owner's, by position. */
export function compareCategories(a: GroceryCategory, b: GroceryCategory): number {
  return a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * What to buy for the planned meals: each recipe line scaled from the recipe's servings to the meal's, summed per
 * ingredient, sorted by category and then by name. A meal or line whose recipe or ingredient is unknown is skipped, and
 * an ingredient in no category, or in one that is unknown, is in the default one.
 */
export function groceryList(
  meals: readonly GroceryMeal[],
  recipes: readonly GroceryRecipe[],
  ingredients: readonly GroceryIngredient[],
  categories: readonly GroceryCategory[],
): GroceryItem[] {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  // Each category's place in the order. An item in an unknown category is in the default one; that one is last when
  // it is not among the categories either.
  const ranks = new Map(
    [...categories].sort(compareCategories).map((category, index) => [category.id, index]),
  );

  const rank = (item: GroceryItem) => ranks.get(item.categoryId) ?? ranks.size;

  const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const tallies = new Map<string, Tally>();

  for (const meal of meals) {
    const recipe = recipesById.get(meal.recipeId);

    if (recipe === undefined) continue;

    const scale = meal.servings / recipe.servings;

    for (const line of recipe.ingredients) {
      const ingredient = ingredientsById.get(line.ingredientId);

      if (ingredient === undefined) continue;

      let tally = tallies.get(ingredient.id);

      if (tally === undefined) {
        tally = { ingredient, quantity: null, unmeasured: false, recipes: new Set() };
        tallies.set(ingredient.id, tally);
      }

      if (line.quantity === null) tally.unmeasured = true;
      else tally.quantity = (tally.quantity ?? 0) + line.quantity * scale;

      tally.recipes.add(recipe.name);
    }
  }

  /** The ingredient's category, by id and name. */
  const categoryOf = (ingredient: GroceryIngredient) => {
    const name =
      ingredient.categoryId === null ? undefined : categoryNames.get(ingredient.categoryId);

    return ingredient.categoryId === null || name === undefined
      ? { categoryId: OTHER_CATEGORY.id, category: OTHER_CATEGORY.name }
      : { categoryId: ingredient.categoryId, category: name };
  };

  return [...tallies.values()]
    .map(({ ingredient, quantity, unmeasured, recipes: names }) => ({
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      ...categoryOf(ingredient),
      quantity: quantity === null ? null : round(quantity),
      unmeasured,
      recipes: [...names],
    }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** One category's run of a sorted grocery list. */
export type GroceryGroup = {
  readonly categoryId: string;
  readonly category: string;
  readonly items: GroceryItem[];
};

/** A sorted grocery list in runs of one category each, in order. */
export function groupGroceries(items: readonly GroceryItem[]): GroceryGroup[] {
  const groups: GroceryGroup[] = [];

  for (const item of items) {
    const last = groups.at(-1);

    if (last !== undefined && last.categoryId === item.categoryId) last.items.push(item);
    else groups.push({ categoryId: item.categoryId, category: item.category, items: [item] });
  }

  return groups;
}

/** "250 g", "3", "250 g + as needed", "as needed": an item's amount as a shopping-list line shows it. */
export function formatGroceryAmount(item: Pick<GroceryItem, "unit" | "quantity" | "unmeasured">) {
  const measured =
    item.quantity === null
      ? null
      : item.unit === null
        ? `${item.quantity}`
        : `${item.quantity} ${item.unit}`;

  if (measured === null) return "as needed";

  return item.unmeasured ? `${measured} + as needed` : measured;
}
