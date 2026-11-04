import { Type } from "@earendil-works/pi-ai";
import { defineExtension, section, type ToolRegistration } from "@earendil-works/pi-durable";
import {
  formatGroceryAmount,
  type GroceryItem,
  groupGroceries,
  OTHER_CATEGORY,
} from "utils/groceries";
import {
  type Ingredient,
  type IngredientCategory,
  MEAL_SLOTS,
  type Meal,
  type MealSlot,
  type OwnerRecipes,
  type Recipe,
  type RecipeLine,
} from "./recipe-book.ts";
import { userStore } from "./user-store.ts";

const MAX_NAME_CHARACTERS = 200;
const MAX_UNIT_CHARACTERS = 20;
const MAX_NOTES_CHARACTERS = 10_000;
const MAX_STEP_CHARACTERS = 2_000;

const DATE_DESCRIPTION = "A calendar date in the owner's timezone, YYYY-MM-DD";

const Id = Type.String({ minLength: 1 });
const Name = Type.String({ minLength: 1, maxLength: MAX_NAME_CHARACTERS });
const Unit = Type.String({ minLength: 1, maxLength: MAX_UNIT_CHARACTERS });
const Notes = Type.String({ maxLength: MAX_NOTES_CHARACTERS });
const Servings = Type.Integer({ minimum: 1, maximum: 100 });
const CalendarDate = Type.String({ description: DATE_DESCRIPTION });
const Slot = Type.Union(MEAL_SLOTS.map((slot) => Type.Literal(slot)));

const Steps = Type.Array(Type.String({ minLength: 1, maxLength: MAX_STEP_CHARACTERS }), {
  maxItems: 100,
  description: "The method, one entry per step, in order",
});

const Lines = Type.Array(
  Type.Object({
    ingredientId: Type.String({
      minLength: 1,
      description: "An id from list_ingredients or add_ingredient",
    }),
    quantity: Type.Optional(
      Type.Number({
        exclusiveMinimum: 0,
        description:
          "In the ingredient's unit, for the recipe's servings. Omit when the recipe gives no amount",
      }),
    ),
    note: Type.Optional(
      Type.String({ maxLength: MAX_NAME_CHARACTERS, description: 'How it is used: "diced"' }),
    ),
  }),
  { maxItems: 100 },
);

/**
 * A plain copy of a stored value. Results of Workers RPC carry a `Symbol.dispose` disposer, on every array and object,
 * and Pi refuses tool details that are not strict JSON; these values are JSON already, and the round trip drops the
 * disposers.
 */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const textResult = <T>(text: string, details: T | null) => ({
  output: [{ type: "text" as const, text }],
  details: details === null ? null : plain(details),
});

const CategoryId = Type.String({
  minLength: 1,
  description: `An id from list_categories or add_category; ${OTHER_CATEGORY.id} is ${OTHER_CATEGORY.name}, the default`,
});

type Categories = ReadonlyMap<string, IngredientCategory>;

const byId = (categories: readonly IngredientCategory[]): Categories =>
  new Map(categories.map((category) => [category.id, category]));

function formatIngredient(ingredient: Ingredient, categories: Categories): string {
  const unit = ingredient.unit === null ? "no unit" : `unit: ${ingredient.unit}`;

  const category = categories.get(ingredient.categoryId)?.name ?? OTHER_CATEGORY.name;

  return `- ${ingredient.name} (${unit}, category: ${category}, id: ${ingredient.id})`;
}

const formatCategory = (category: IngredientCategory) => `- ${category.name} (id: ${category.id})`;

const formatRecipeSummary = (recipe: Recipe) =>
  `- ${recipe.name} (serves ${recipe.servings}, ${recipe.ingredients.length} ingredients, id: ${recipe.id})`;

function formatLine(line: RecipeLine, ingredientsById: ReadonlyMap<string, Ingredient>): string {
  const ingredient = ingredientsById.get(line.ingredientId);
  const name = ingredient?.name ?? line.ingredientId;
  const unit = ingredient?.unit ?? null;

  const amount =
    line.quantity === null ? "" : unit === null ? `${line.quantity} ` : `${line.quantity} ${unit} `;

  const note = line.note === null ? "" : `, ${line.note}`;

  return `- ${amount}${name}${note} (ingredient id: ${line.ingredientId})`;
}

/** The whole recipe as Markdown the model can quote back, with every id the other tools take. */
function formatRecipe(recipe: Recipe, ingredients: readonly Ingredient[]): string {
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const notes = recipe.notes === null ? [] : ["", recipe.notes];

  const lines =
    recipe.ingredients.length === 0
      ? ["(none)"]
      : recipe.ingredients.map((line) => formatLine(line, ingredientsById));

  const steps =
    recipe.steps.length === 0
      ? ["(none)"]
      : recipe.steps.map((step, index) => `${index + 1}. ${step}`);

  return [
    `${recipe.name} (serves ${recipe.servings}, id: ${recipe.id})`,
    ...notes,
    "",
    "Ingredients:",
    ...lines,
    "",
    "Steps:",
    ...steps,
  ].join("\n");
}

function formatMeal(meal: Meal, recipesById: ReadonlyMap<string, Recipe>): string {
  const name = recipesById.get(meal.recipeId)?.name ?? meal.recipeId;

  return `- ${meal.date} ${meal.slot}: ${name}, ${meal.servings} servings (id: ${meal.id}, recipe id: ${meal.recipeId})`;
}

const formatGroceryItem = (item: GroceryItem) =>
  `- ${item.name}: ${formatGroceryAmount(item)} (for ${item.recipes.join(", ")})`;

/** Under a heading per category, "Other" last; a plain list when it is all one category. */
function formatGroceries(items: readonly GroceryItem[]): string {
  const groups = groupGroceries(items);

  if (groups.length === 1) return items.map(formatGroceryItem).join("\n");

  return groups
    .map(({ category, items: group }) =>
      [`${category}:`, ...group.map(formatGroceryItem)].join("\n"),
    )
    .join("\n\n");
}

type IngredientArguments = {
  readonly name: string;
  readonly unit?: string;
  readonly categoryId?: string;
};

type UpdateIngredientArguments = {
  readonly id: string;
  readonly name?: string;
  readonly unit?: string | null;
  readonly categoryId?: string | null;
};

type NameArguments = {
  readonly name: string;
};

type RenameArguments = {
  readonly id: string;
  readonly name: string;
};

type ReorderArguments = {
  readonly ids: readonly string[];
};

type LineArguments = {
  readonly ingredientId: string;
  readonly quantity?: number;
  readonly note?: string;
};

type AddRecipeArguments = {
  readonly name: string;
  readonly servings: number;
  readonly notes?: string;
  readonly ingredients?: readonly LineArguments[];
  readonly steps?: readonly string[];
};

type UpdateRecipeArguments = {
  readonly id: string;
  readonly name?: string;
  readonly servings?: number;
  readonly notes?: string | null;
  readonly ingredients?: readonly LineArguments[];
  readonly steps?: readonly string[];
};

type RangeArguments = {
  readonly from: string;
  readonly to: string;
};

type PlanMealArguments = {
  readonly date: string;
  readonly slot: MealSlot;
  readonly recipeId: string;
  readonly servings?: number;
};

type UpdateMealArguments = {
  readonly id: string;
  readonly date?: string;
  readonly slot?: MealSlot;
  readonly recipeId?: string;
  readonly servings?: number;
};

type IdArguments = {
  readonly id: string;
};

const toLines = (lines: readonly LineArguments[]): RecipeLine[] =>
  lines.map((line) => ({
    ingredientId: line.ingredientId,
    quantity: line.quantity ?? null,
    note: line.note ?? null,
  }));

/**
 * The chat's tools over the owner's ingredients and their categories, recipes, meal prep calendar and grocery list. `store` resolves the
 * store on each call, so a tool reaches the `UserStore` Durable Object only when it runs. Each is safe to replay: an
 * add's id is derived from its tool task.
 */
export function createRecipeTools(store: () => OwnerRecipes): ToolRegistration[] {
  /** The categories by id, to name an ingredient's. */
  const categories = async () => byId(await store().listCategories());

  return [
    {
      name: "list_categories",
      description:
        "List the owner's ingredient categories (such as Produce or Dairy) in the order lists show them, with ids.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => {
        const list = await store().listCategories();

        return textResult(
          list.length === 0 ? "No categories." : list.map(formatCategory).join("\n"),
          list,
        );
      },
    },
    {
      name: "add_category",
      description:
        "Add an ingredient category. Adding a name that exists returns the existing category.",
      parameters: Type.Object({ name: Name }),
      replay: "safe",
      execute: async (args: NameArguments, api) => {
        const id = `category:${api.taskId}`;
        const added = await store().addCategory({ id, name: args.name.trim() });
        const verb = added.id === id ? "Added" : "Already exists";

        return textResult(`${verb}:\n${formatCategory(added)}`, added);
      },
    },
    {
      name: "rename_category",
      description: `Rename an ingredient category by id. ${OTHER_CATEGORY.name}, the default, cannot be renamed.`,
      parameters: Type.Object({ id: Id, name: Name }),
      replay: "safe",
      execute: async (args: RenameArguments) => {
        const renamed = await store().renameCategory(args.id, args.name.trim());

        if (renamed === null) throw new Error(`No category has id ${args.id}`);

        return textResult(`Renamed:\n${formatCategory(renamed)}`, renamed);
      },
    },
    {
      name: "reorder_categories",
      description: `Set the order lists show ingredient categories in, such as the order of the aisles in the owner's shop. ids lists categories first to last; any left out follow in their current order, and ${OTHER_CATEGORY.name} is always last.`,
      parameters: Type.Object({ ids: Type.Array(Id, { minItems: 1, maxItems: 100 }) }),
      replay: "safe",
      execute: async (args: ReorderArguments) => {
        const list = await store().reorderCategories([...args.ids]);

        return textResult(`Reordered:\n${list.map(formatCategory).join("\n")}`, list);
      },
    },
    {
      name: "delete_category",
      description: `Delete an ingredient category by id. Its ingredients are kept, and move to ${OTHER_CATEGORY.name}, the default, which cannot be deleted.`,
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removeCategory(args.id);

        return textResult(removed ? `Deleted ${args.id}.` : `No category has id ${args.id}.`, null);
      },
    },
    {
      name: "list_ingredients",
      description: "List the owner's ingredients, with each one's unit, category, and id.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => {
        const [list, named] = await Promise.all([store().listIngredients(), categories()]);

        return textResult(
          list.length === 0
            ? "No ingredients."
            : list.map((ingredient) => formatIngredient(ingredient, named)).join("\n"),
          list,
        );
      },
    },
    {
      name: "add_ingredient",
      description: `Add an ingredient recipes can use. Every recipe measures it in its one unit; omit unit for one counted without a unit (eggs) or never measured (salt). Omit categoryId for ${OTHER_CATEGORY.name}, the default. Adding a name that exists returns the existing ingredient.`,
      parameters: Type.Object({
        name: Name,
        unit: Type.Optional(Unit),
        categoryId: Type.Optional(CategoryId),
      }),
      replay: "safe",
      execute: async (args: IngredientArguments, api) => {
        const id = `ingredient:${api.taskId}`;

        const added = await store().addIngredient({
          id,
          name: args.name.trim(),
          unit: args.unit?.trim() ?? null,
          categoryId: args.categoryId ?? null,
        });

        const verb = added.id === id ? "Added" : "Already exists";

        return textResult(`${verb}:\n${formatIngredient(added, await categories())}`, added);
      },
    },
    {
      name: "update_ingredient",
      description: `Rename an ingredient, or change its unit (null clears it) or category (null is ${OTHER_CATEGORY.name}, the default). Changing the unit does not convert the quantities recipes already give in the old one.`,
      parameters: Type.Object({
        id: Id,
        name: Type.Optional(Name),
        unit: Type.Optional(Type.Union([Unit, Type.Null()])),
        categoryId: Type.Optional(Type.Union([CategoryId, Type.Null()])),
      }),
      replay: "safe",
      execute: async (args: UpdateIngredientArguments) => {
        const updated = await store().updateIngredient(args.id, {
          name: args.name?.trim(),
          unit: args.unit === undefined || args.unit === null ? args.unit : args.unit.trim(),
          categoryId: args.categoryId,
        });

        if (updated === null) throw new Error(`No ingredient has id ${args.id}`);

        return textResult(`Updated:\n${formatIngredient(updated, await categories())}`, updated);
      },
    },
    {
      name: "delete_ingredient",
      description: "Delete an ingredient by id. Refused while a recipe uses it.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removeIngredient(args.id);

        // A replayed delete finds nothing, so a missing ingredient is not an error.
        return textResult(
          removed ? `Deleted ${args.id}.` : `No ingredient has id ${args.id}.`,
          null,
        );
      },
    },
    {
      name: "list_recipes",
      description:
        "List the owner's recipes by name, with each one's servings and id. get_recipe shows one in full.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => {
        const list = await store().listRecipes();

        return textResult(
          list.length === 0 ? "No recipes." : list.map(formatRecipeSummary).join("\n"),
          list,
        );
      },
    },
    {
      name: "get_recipe",
      description: "Show a recipe in full: its ingredients with amounts, and its steps.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const [recipes, ingredients] = await Promise.all([
          store().listRecipes(),
          store().listIngredients(),
        ]);

        const recipe = recipes.find(({ id }) => id === args.id);

        if (recipe === undefined) throw new Error(`No recipe has id ${args.id}`);

        return textResult(formatRecipe(recipe, ingredients), recipe);
      },
    },
    {
      name: "add_recipe",
      description:
        "Add a recipe. Each ingredient line names an existing ingredient by id (add_ingredient first for any missing) with its quantity in that ingredient's unit, for the recipe's servings.",
      parameters: Type.Object({
        name: Name,
        servings: Servings,
        notes: Type.Optional(Notes),
        ingredients: Type.Optional(Lines),
        steps: Type.Optional(Steps),
      }),
      replay: "safe",
      execute: async (args: AddRecipeArguments, api) => {
        const added = await store().addRecipe({
          id: `recipe:${api.taskId}`,
          name: args.name.trim(),
          servings: args.servings,
          notes: args.notes?.trim() || null,
          ingredients: toLines(args.ingredients ?? []),
          steps: [...(args.steps ?? [])],
        });

        const ingredients = await store().listIngredients();

        return textResult(`Added:\n${formatRecipe(added, ingredients)}`, added);
      },
    },
    {
      name: "update_recipe",
      description:
        "Change a recipe by id. ingredients and steps replace the whole list, so pass every line to keep; get_recipe shows the current ones. notes: null clears them.",
      parameters: Type.Object({
        id: Id,
        name: Type.Optional(Name),
        servings: Type.Optional(Servings),
        notes: Type.Optional(Type.Union([Notes, Type.Null()])),
        ingredients: Type.Optional(Lines),
        steps: Type.Optional(Steps),
      }),
      replay: "safe",
      execute: async (args: UpdateRecipeArguments) => {
        const updated = await store().updateRecipe(args.id, {
          name: args.name?.trim(),
          servings: args.servings,
          notes:
            args.notes === undefined || args.notes === null
              ? args.notes
              : args.notes.trim() || null,
          ingredients: args.ingredients === undefined ? undefined : toLines(args.ingredients),
          steps: args.steps === undefined ? undefined : [...args.steps],
        });

        if (updated === null) throw new Error(`No recipe has id ${args.id}`);

        const ingredients = await store().listIngredients();

        return textResult(`Updated:\n${formatRecipe(updated, ingredients)}`, updated);
      },
    },
    {
      name: "delete_recipe",
      description: "Delete a recipe by id, and every meal planned with it.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removeRecipe(args.id);

        return textResult(removed ? `Deleted ${args.id}.` : `No recipe has id ${args.id}.`, null);
      },
    },
    {
      name: "list_meals",
      description:
        "List the meals planned on the meal prep calendar from one date to another, inclusive, with ids.",
      parameters: Type.Object({ from: CalendarDate, to: CalendarDate }),
      replay: "safe",
      execute: async (args: RangeArguments) => {
        const [list, recipes] = await Promise.all([store().listMeals(args), store().listRecipes()]);
        const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));

        if (list.length === 0)
          return textResult(`No meals planned from ${args.from} to ${args.to}.`, list);

        return textResult(list.map((meal) => formatMeal(meal, recipesById)).join("\n"), list);
      },
    },
    {
      name: "plan_meal",
      description:
        "Plan a recipe for a meal on the meal prep calendar. servings defaults to the recipe's; the grocery list scales the recipe's amounts to it. A day may have several meals in a slot.",
      parameters: Type.Object({
        date: CalendarDate,
        slot: Slot,
        recipeId: Id,
        servings: Type.Optional(Servings),
      }),
      replay: "safe",
      execute: async (args: PlanMealArguments, api) => {
        const recipes = await store().listRecipes();
        const recipe = recipes.find(({ id }) => id === args.recipeId);

        if (recipe === undefined) throw new Error(`No recipe has id ${args.recipeId}`);

        const planned = await store().addMeal({
          id: `meal:${api.taskId}`,
          date: args.date,
          slot: args.slot,
          recipeId: args.recipeId,
          servings: args.servings ?? recipe.servings,
        });

        return textResult(
          `Planned:\n${formatMeal(planned, new Map([[recipe.id, recipe]]))}`,
          planned,
        );
      },
    },
    {
      name: "update_meal",
      description:
        "Move a planned meal to another date or slot, change its servings, or swap its recipe.",
      parameters: Type.Object({
        id: Id,
        date: Type.Optional(CalendarDate),
        slot: Type.Optional(Slot),
        recipeId: Type.Optional(Id),
        servings: Type.Optional(Servings),
      }),
      replay: "safe",
      execute: async (args: UpdateMealArguments) => {
        const updated = await store().updateMeal(args.id, {
          date: args.date,
          slot: args.slot,
          recipeId: args.recipeId,
          servings: args.servings,
        });

        if (updated === null) throw new Error(`No meal has id ${args.id}`);

        const recipes = await store().listRecipes();

        return textResult(
          `Updated:\n${formatMeal(updated, new Map(recipes.map((recipe) => [recipe.id, recipe])))}`,
          updated,
        );
      },
    },
    {
      name: "delete_meal",
      description: "Remove a planned meal from the meal prep calendar by id. The recipe is kept.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removeMeal(args.id);

        return textResult(removed ? `Removed ${args.id}.` : `No meal has id ${args.id}.`, null);
      },
    },
    {
      name: "grocery_list",
      description:
        "The grocery list for the meals planned from one date to another, inclusive: every ingredient they need, with amounts scaled to each meal's servings and summed, grouped by category.",
      parameters: Type.Object({ from: CalendarDate, to: CalendarDate }),
      replay: "safe",
      execute: async (args: RangeArguments) => {
        const list = await store().groceryList(args);

        if (list.length === 0)
          return textResult(
            `Nothing to buy: no meals planned from ${args.from} to ${args.to}.`,
            list,
          );

        return textResult(formatGroceries(list), list);
      },
    },
  ];
}

const RECIPES = `The owner keeps ingredients, recipes, and a meal prep calendar, which you manage with the recipe tools.

- An ingredient has one unit ("g", "ml", "pcs", or none), and every recipe measures it in that unit. It is in one category (list_categories): "Other", the default, unless it is given another. Give a new ingredient the category that fits when one exists, and add a category only when the owner asks. Before add_recipe or update_recipe, call list_ingredients and add_ingredient for any that are missing, choosing a unit the recipe's amounts can be given in; convert amounts to it ("1 cup flour" is about 120 g).
- A recipe's amounts are for its servings. A planned meal is a recipe on a date (YYYY-MM-DD, in the owner's timezone) and slot (breakfast, lunch, dinner, or snack), with its own servings.
- grocery_list totals what the meals planned in a date range need. It is computed from the calendar each time: it is not a todo, and nothing is added to the todos unless the owner asks.
- For "this week" and similar ranges, work the dates out from the current time.`;

/** The owner's recipe book, kept in the `UserStore` object the Mini App also reads, and how its parts fit together. */
export const recipesExtension = defineExtension({
  name: "recipes",
  tools: createRecipeTools(userStore),
  sections: [section("recipes", () => RECIPES, { tag: false })],
});
