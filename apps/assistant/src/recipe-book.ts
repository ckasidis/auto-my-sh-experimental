import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { type GroceryItem, groceryList, OTHER_CATEGORY } from "utils/groceries";
import { ingredientCategories, ingredients, meals, recipeIngredients, recipes } from "./schema.ts";

/** A group of ingredients, such as "Produce" or "Dairy"; `OTHER_CATEGORY` is the default one. */
export type IngredientCategory = typeof ingredientCategories.$inferSelect;

/** A category to add. Its id is chosen by the caller, so a retried add is the same category. */
export type NewIngredientCategory = Pick<IngredientCategory, "id" | "name">;

type IngredientRow = typeof ingredients.$inferSelect;

/** Something a recipe is made from, in the one unit every recipe measures it in, and in one category. */
export type Ingredient = Omit<IngredientRow, "categoryId"> & { readonly categoryId: string };

/** An ingredient to add, in the default category when `categoryId` is null. Its id is chosen by the caller, so a retried add is the same ingredient. */
export type NewIngredient = Pick<IngredientRow, "id" | "name" | "unit" | "categoryId">;

/** Fields to change; an absent one is kept, a null unit clears it, and a null category is the default one. */
export type IngredientChanges = {
  readonly name?: string;
  readonly unit?: string | null;
  readonly categoryId?: string | null;
};

/** One of a recipe's ingredients: an amount in the ingredient's unit, for the recipe's servings. */
export type RecipeLine = {
  readonly ingredientId: string;
  readonly quantity: number | null;
  readonly note: string | null;
};

/** A recipe with its ingredients and steps, both in order. */
export type Recipe = typeof recipes.$inferSelect & {
  readonly ingredients: RecipeLine[];
};

/** A recipe to add. Its id is chosen by the caller, so a retried add is the same recipe. */
export type NewRecipe = Pick<
  Recipe,
  "id" | "name" | "notes" | "servings" | "steps" | "ingredients"
>;

/** Fields to change; an absent one is kept. `steps` and `ingredients` replace the whole list. */
export type RecipeChanges = {
  readonly name?: string;
  readonly notes?: string | null;
  readonly servings?: number;
  readonly steps?: string[];
  readonly ingredients?: RecipeLine[];
};

export type MealSlot = (typeof meals.$inferSelect)["slot"];

/** The slots of a day, in the order the calendar shows them. */
export const MEAL_SLOTS = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
] as const satisfies readonly MealSlot[];

/** A recipe planned for one meal of one day on the meal prep calendar. */
export type Meal = typeof meals.$inferSelect;

/** A meal to plan. Its id is chosen by the caller, so a retried plan is the same meal. */
export type NewMeal = Pick<Meal, "id" | "date" | "slot" | "recipeId" | "servings">;

/** Fields to change; an absent one is kept. */
export type MealChanges = {
  readonly date?: string;
  readonly slot?: MealSlot;
  readonly recipeId?: string;
  readonly servings?: number;
};

/** An inclusive range of calendar dates, YYYY-MM-DD. */
export type DateRange = {
  readonly from: string;
  readonly to: string;
};

type Awaitable<T> = T | Promise<T>;

/** The `UserStore` object's recipe methods, which the recipe tools call; over RPC each returns a promise. */
export interface OwnerRecipes {
  listCategories(): Awaitable<IngredientCategory[]>;
  addCategory(category: NewIngredientCategory): Awaitable<IngredientCategory>;
  renameCategory(id: string, name: string): Awaitable<IngredientCategory | null>;
  removeCategory(id: string): Awaitable<boolean>;
  reorderCategories(ids: readonly string[]): Awaitable<IngredientCategory[]>;
  listIngredients(): Awaitable<Ingredient[]>;
  addIngredient(ingredient: NewIngredient): Awaitable<Ingredient>;
  updateIngredient(id: string, changes: IngredientChanges): Awaitable<Ingredient | null>;
  removeIngredient(id: string): Awaitable<boolean>;
  listRecipes(): Awaitable<Recipe[]>;
  addRecipe(recipe: NewRecipe): Awaitable<Recipe>;
  updateRecipe(id: string, changes: RecipeChanges): Awaitable<Recipe | null>;
  removeRecipe(id: string): Awaitable<boolean>;
  listMeals(range?: DateRange): Awaitable<Meal[]>;
  addMeal(meal: NewMeal): Awaitable<Meal>;
  updateMeal(id: string, changes: MealChanges): Awaitable<Meal | null>;
  removeMeal(id: string): Awaitable<boolean>;
  groceryList(range: DateRange): Awaitable<GroceryItem[]>;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether the text is a real YYYY-MM-DD date: 2026-02-30 is not. */
export function isCalendarDate(text: string): boolean {
  if (!CALENDAR_DATE.test(text)) return false;

  const date = new Date(`${text}T00:00:00Z`);

  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(text);
}

function checkDate(date: string): void {
  if (!isCalendarDate(date)) throw new Error(`${date} is not a calendar date (YYYY-MM-DD)`);
}

function checkServings(servings: number): void {
  if (!Number.isInteger(servings) || servings < 1) {
    throw new Error("servings must be a whole number of at least 1");
  }
}

function checkLines(lines: readonly RecipeLine[]): void {
  for (const line of lines) {
    if (line.quantity !== null && !(line.quantity > 0)) {
      throw new Error("an ingredient's quantity must be more than 0, or null for no amount");
    }
  }
}

const SLOT_ORDER = sql`case ${meals.slot} when 'breakfast' then 0 when 'lunch' then 1 when 'dinner' then 2 else 3 end`;

type Database = DrizzleSqliteDODatabase<Record<string, never>>;

/** The column allows null, which the store never writes after the default category's migration; read one as it. */
const categorized = (row: IngredientRow): Ingredient => ({
  ...row,
  categoryId: row.categoryId ?? OTHER_CATEGORY.id,
});

/** Whether the column holds this name, ignoring case and surrounding spaces. */
function sameName(
  column: typeof ingredients.name | typeof ingredientCategories.name,
  name: string,
) {
  return sql`lower(trim(${column})) = lower(trim(${name}))`;
}

/**
 * The owner's ingredients and their categories, recipes, and meal prep calendar, in the `UserStore` object's SQLite. A
 * recipe line names an ingredient, so an ingredient a recipe uses is not deleted; deleting a recipe deletes the meals
 * planned with it. Every ingredient is in a category, `OTHER_CATEGORY` unless given another; that one is always there,
 * and deleting another moves its ingredients to it.
 */
export class RecipeBook implements OwnerRecipes {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** In the owner's order, with the default category last. */
  listCategories(): IngredientCategory[] {
    return this.#db
      .select()
      .from(ingredientCategories)
      .orderBy(
        sql`${ingredientCategories.id} = ${OTHER_CATEGORY.id}`,
        asc(ingredientCategories.position),
        sql`${ingredientCategories.name} collate nocase`,
        asc(ingredientCategories.id),
      )
      .all();
  }

  /**
   * Adds the category after the others, or returns the one already stored under its id or, ignoring case, its name:
   * there is one category per name.
   */
  addCategory(category: NewIngredientCategory): IngredientCategory {
    const existing = this.#category(category.id) ?? this.#categoryNamed(category.name);

    if (existing !== undefined) return existing;

    const last = this.#db
      .select({ position: sql<number>`coalesce(max(${ingredientCategories.position}), 0)` })
      .from(ingredientCategories)
      .get();

    return this.#db
      .insert(ingredientCategories)
      .values({ ...category, position: (last?.position ?? 0) + 1, createdAt: Date.now() })
      .returning()
      .get();
  }

  /**
   * Puts the categories in this order, and returns them in it. Categories the order leaves out (one added meanwhile)
   * follow the named ones in the order they had, and unknown ids are skipped; the default category stays last.
   */
  reorderCategories(ids: readonly string[]): IngredientCategory[] {
    const current = this.listCategories().flatMap(({ id }) =>
      id === OTHER_CATEGORY.id ? [] : [id],
    );

    const named = [...new Set(ids)].filter((id) => current.includes(id));
    const order = [...named, ...current.filter((id) => !named.includes(id))];

    this.#db.transaction((tx) => {
      for (const [position, id] of order.entries()) {
        tx.update(ingredientCategories)
          .set({ position: position + 1 })
          .where(eq(ingredientCategories.id, id))
          .run();
      }
    });

    return this.listCategories();
  }

  /**
   * Renames the category; null when no category has this id. Refuses a name another category has, and the default
   * category, whose name lists show for every ingredient not given another.
   */
  renameCategory(id: string, name: string): IngredientCategory | null {
    if (this.#category(id) === undefined) return null;

    if (id === OTHER_CATEGORY.id) throw new Error(`${OTHER_CATEGORY.name} is the default category`);

    const clash = this.#categoryNamed(name, id);

    if (clash !== undefined) {
      throw new Error(`A category named ${clash.name} already exists (id: ${clash.id})`);
    }

    return this.#db
      .update(ingredientCategories)
      .set({ name })
      .where(eq(ingredientCategories.id, id))
      .returning()
      .get()!;
  }

  /** Deletes the category, moving its ingredients to the default one; false when no category has this id. */
  removeCategory(id: string): boolean {
    if (id === OTHER_CATEGORY.id) {
      throw new Error(`${OTHER_CATEGORY.name} is the default category, so it cannot be deleted`);
    }

    return this.#db.transaction((tx) => {
      tx.update(ingredients)
        .set({ categoryId: OTHER_CATEGORY.id })
        .where(eq(ingredients.categoryId, id))
        .run();

      return (
        tx
          .delete(ingredientCategories)
          .where(eq(ingredientCategories.id, id))
          .returning({ id: ingredientCategories.id })
          .all().length > 0
      );
    });
  }

  /** By name, ignoring case. */
  listIngredients(): Ingredient[] {
    return this.#db
      .select()
      .from(ingredients)
      .orderBy(sql`${ingredients.name} collate nocase`, asc(ingredients.id))
      .all()
      .map(categorized);
  }

  /**
   * Adds the ingredient, or returns the one already stored under its id or, ignoring case, its name: there is one
   * ingredient per name.
   */
  addIngredient(ingredient: NewIngredient): Ingredient {
    const existing = this.#ingredient(ingredient.id) ?? this.#ingredientNamed(ingredient.name);

    if (existing !== undefined) return existing;

    const categoryId = ingredient.categoryId ?? OTHER_CATEGORY.id;

    this.#checkCategory(categoryId);

    return categorized(
      this.#db
        .insert(ingredients)
        .values({ ...ingredient, categoryId, createdAt: Date.now() })
        .returning()
        .get(),
    );
  }

  /** Applies the changes; null when no ingredient has this id. Refuses a name another ingredient has. */
  updateIngredient(id: string, changes: IngredientChanges): Ingredient | null {
    const current = this.#ingredient(id);

    if (current === undefined) return null;

    if (changes.name !== undefined) {
      const clash = this.#ingredientNamed(changes.name, id);

      if (clash !== undefined) {
        throw new Error(`An ingredient named ${clash.name} already exists (id: ${clash.id})`);
      }
    }

    const categoryId =
      changes.categoryId === undefined ? undefined : (changes.categoryId ?? OTHER_CATEGORY.id);

    if (categoryId !== undefined) this.#checkCategory(categoryId);

    const fields = { name: changes.name, unit: changes.unit, categoryId };

    if (Object.values(fields).every((value) => value === undefined)) return current;

    return categorized(
      this.#db.update(ingredients).set(fields).where(eq(ingredients.id, id)).returning().get()!,
    );
  }

  /** Deletes the ingredient; false when no ingredient has this id. Refuses one a recipe still uses. */
  removeIngredient(id: string): boolean {
    const users = this.#db
      .selectDistinct({ name: recipes.name })
      .from(recipeIngredients)
      .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
      .where(eq(recipeIngredients.ingredientId, id))
      .orderBy(asc(recipes.name))
      .all();

    if (users.length > 0) {
      throw new Error(
        `Used by ${users.map(({ name }) => name).join(", ")}; remove it from them first`,
      );
    }

    const deleted = this.#db
      .delete(ingredients)
      .where(eq(ingredients.id, id))
      .returning({ id: ingredients.id })
      .all();

    return deleted.length > 0;
  }

  /** By name, ignoring case. */
  listRecipes(): Recipe[] {
    const rows = this.#db
      .select()
      .from(recipes)
      .orderBy(sql`${recipes.name} collate nocase`, asc(recipes.id))
      .all();

    return this.#withLines(rows);
  }

  /** Adds the recipe, or returns the one already stored under its id. */
  addRecipe(recipe: NewRecipe): Recipe {
    const existing = this.#recipe(recipe.id);

    if (existing !== undefined) return existing;

    checkServings(recipe.servings);
    checkLines(recipe.ingredients);
    this.#checkIngredients(recipe.ingredients);

    this.#db.transaction((tx) => {
      tx.insert(recipes)
        .values({
          id: recipe.id,
          name: recipe.name,
          notes: recipe.notes,
          servings: recipe.servings,
          steps: [...recipe.steps],
          createdAt: Date.now(),
        })
        .run();
      this.#insertLines(tx, recipe.id, recipe.ingredients);
    });

    return this.#recipe(recipe.id)!;
  }

  /** Applies the changes; null when no recipe has this id. */
  updateRecipe(id: string, changes: RecipeChanges): Recipe | null {
    if (this.#recipe(id) === undefined) return null;

    if (changes.servings !== undefined) checkServings(changes.servings);

    if (changes.ingredients !== undefined) {
      checkLines(changes.ingredients);
      this.#checkIngredients(changes.ingredients);
    }

    this.#db.transaction((tx) => {
      const steps = changes.steps === undefined ? undefined : [...changes.steps];

      const fields = {
        name: changes.name,
        notes: changes.notes,
        servings: changes.servings,
        steps,
      };

      // `set` refuses an update with no fields; one that changes only the lines has none.
      if (Object.values(fields).some((value) => value !== undefined)) {
        tx.update(recipes).set(fields).where(eq(recipes.id, id)).run();
      }

      if (changes.ingredients !== undefined) {
        tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).run();
        this.#insertLines(tx, id, changes.ingredients);
      }
    });

    return this.#recipe(id)!;
  }

  /** Deletes the recipe and the meals planned with it; false when no recipe has this id. */
  removeRecipe(id: string): boolean {
    return this.#db.transaction((tx) => {
      tx.delete(meals).where(eq(meals.recipeId, id)).run();
      tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).run();

      return (
        tx.delete(recipes).where(eq(recipes.id, id)).returning({ id: recipes.id }).all().length > 0
      );
    });
  }

  /** The planned meals, every one or those in the range, by date and then slot. */
  listMeals(range?: DateRange): Meal[] {
    if (range !== undefined) {
      checkDate(range.from);
      checkDate(range.to);
    }

    return this.#db
      .select()
      .from(meals)
      .where(
        range === undefined
          ? undefined
          : and(gte(meals.date, range.from), lte(meals.date, range.to)),
      )
      .orderBy(asc(meals.date), SLOT_ORDER, asc(meals.createdAt), asc(meals.id))
      .all();
  }

  /** Plans the meal, or returns the one already stored under its id. */
  addMeal(meal: NewMeal): Meal {
    const existing = this.#meal(meal.id);

    if (existing !== undefined) return existing;

    checkDate(meal.date);
    checkServings(meal.servings);
    this.#checkRecipe(meal.recipeId);

    return this.#db
      .insert(meals)
      .values({ ...meal, createdAt: Date.now() })
      .returning()
      .get();
  }

  /** Applies the changes; null when no meal has this id. */
  updateMeal(id: string, changes: MealChanges): Meal | null {
    const current = this.#meal(id);

    if (current === undefined) return null;

    if (changes.date !== undefined) checkDate(changes.date);

    if (changes.servings !== undefined) checkServings(changes.servings);

    if (changes.recipeId !== undefined) this.#checkRecipe(changes.recipeId);

    if (Object.values(changes).every((value) => value === undefined)) return current;

    return this.#db
      .update(meals)
      .set({
        date: changes.date,
        slot: changes.slot,
        recipeId: changes.recipeId,
        servings: changes.servings,
      })
      .where(eq(meals.id, id))
      .returning()
      .get()!;
  }

  /** Removes the meal from the calendar; false when no meal has this id. */
  removeMeal(id: string): boolean {
    return (
      this.#db.delete(meals).where(eq(meals.id, id)).returning({ id: meals.id }).all().length > 0
    );
  }

  /**
   * What to buy for the meals planned in the range: each recipe scaled to its meal's servings, summed per ingredient,
   * by category.
   */
  groceryList(range: DateRange): GroceryItem[] {
    return groceryList(
      this.listMeals(range),
      this.listRecipes(),
      this.listIngredients(),
      this.listCategories(),
    );
  }

  #ingredient(id: string): Ingredient | undefined {
    const row = this.#db.select().from(ingredients).where(eq(ingredients.id, id)).get();

    return row === undefined ? undefined : categorized(row);
  }

  /** An ingredient with this name, ignoring case and surrounding spaces, other than the one with id `except`. */
  #ingredientNamed(name: string, except?: string): Ingredient | undefined {
    const named = sameName(ingredients.name, name);

    const row = this.#db
      .select()
      .from(ingredients)
      .where(except === undefined ? named : and(named, ne(ingredients.id, except)))
      .get();

    return row === undefined ? undefined : categorized(row);
  }

  #category(id: string): IngredientCategory | undefined {
    return this.#db
      .select()
      .from(ingredientCategories)
      .where(eq(ingredientCategories.id, id))
      .get();
  }

  /** A category with this name, ignoring case and surrounding spaces, other than the one with id `except`. */
  #categoryNamed(name: string, except?: string): IngredientCategory | undefined {
    const named = sameName(ingredientCategories.name, name);

    return this.#db
      .select()
      .from(ingredientCategories)
      .where(except === undefined ? named : and(named, ne(ingredientCategories.id, except)))
      .get();
  }

  #checkCategory(id: string): void {
    if (this.#category(id) === undefined) throw new Error(`No category has id ${id}`);
  }

  #recipe(id: string): Recipe | undefined {
    const row = this.#db.select().from(recipes).where(eq(recipes.id, id)).get();

    return row === undefined ? undefined : this.#withLines([row])[0];
  }

  #meal(id: string): Meal | undefined {
    return this.#db.select().from(meals).where(eq(meals.id, id)).get();
  }

  #withLines(rows: (typeof recipes.$inferSelect)[]): Recipe[] {
    if (rows.length === 0) return [];

    const lines = this.#db
      .select()
      .from(recipeIngredients)
      .where(
        inArray(
          recipeIngredients.recipeId,
          rows.map(({ id }) => id),
        ),
      )
      .orderBy(asc(recipeIngredients.recipeId), asc(recipeIngredients.position))
      .all();

    return rows.map((row) => ({
      ...row,
      ingredients: lines.flatMap((line) =>
        line.recipeId === row.id
          ? [{ ingredientId: line.ingredientId, quantity: line.quantity, note: line.note }]
          : [],
      ),
    }));
  }

  #insertLines(tx: Pick<Database, "insert">, recipeId: string, lines: readonly RecipeLine[]): void {
    if (lines.length === 0) return;

    tx.insert(recipeIngredients)
      .values(lines.map((line, position) => ({ recipeId, position, ...line })))
      .run();
  }

  /** Refuses lines naming an ingredient that does not exist, by id, rather than with SQLite's foreign key error. */
  #checkIngredients(lines: readonly RecipeLine[]): void {
    const ids = [...new Set(lines.map(({ ingredientId }) => ingredientId))];

    if (ids.length === 0) return;

    const found = new Set(
      this.#db
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(inArray(ingredients.id, ids))
        .all()
        .map(({ id }) => id),
    );

    const missing = ids.find((id) => !found.has(id));

    if (missing !== undefined) throw new Error(`No ingredient has id ${missing}`);
  }

  #checkRecipe(id: string): void {
    if (
      this.#db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, id)).get() ===
      undefined
    ) {
      throw new Error(`No recipe has id ${id}`);
    }
  }
}
