/** The parts of an ingredient a grocery list reads. */
export type GroceryIngredient = {
  readonly id: string;
  readonly name: string;
  readonly unit: string | null;
};

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

/**
 * What to buy for the planned meals: each recipe line scaled from the recipe's servings to the meal's, summed per
 * ingredient, sorted by name. A meal or line whose recipe or ingredient is unknown is skipped.
 */
export function groceryList(
  meals: readonly GroceryMeal[],
  recipes: readonly GroceryRecipe[],
  ingredients: readonly GroceryIngredient[],
): GroceryItem[] {
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

  return [...tallies.values()]
    .map(({ ingredient, quantity, unmeasured, recipes: names }) => ({
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity: quantity === null ? null : round(quantity),
      unmeasured,
      recipes: [...names],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
