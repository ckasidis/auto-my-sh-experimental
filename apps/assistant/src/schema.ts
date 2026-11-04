import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The `UserStore` Durable Object's SQLite schema. drizzle-kit loads this file to generate `drizzle/`, so it imports
 * nothing from the Workers runtime.
 */
export const todos = sqliteTable("todos", {
  id: text().primaryKey(),
  title: text().notNull(),
  notes: text(),
  /** Unix timestamp in milliseconds; only recorded, nothing fires on it. */
  dueAt: integer("due_at"),
  createdAt: integer("created_at").notNull(),
  /** Unix timestamp in milliseconds; null while the todo is open. */
  completedAt: integer("completed_at"),
});

/** Groups of ingredients, such as "Produce" or "Dairy", for finding them on a list. */
export const ingredientCategories = sqliteTable("ingredient_categories", {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: integer("created_at").notNull(),
});

export const ingredients = sqliteTable("ingredients", {
  id: text().primaryKey(),
  name: text().notNull(),
  /** The unit every recipe measures it in ("g", "ml", "pcs"); null for one counted without a unit. */
  unit: text(),
  /** Null when it is in no category; deleting its category clears it. */
  categoryId: text("category_id").references(() => ingredientCategories.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull(),
});

export const recipes = sqliteTable("recipes", {
  id: text().primaryKey(),
  name: text().notNull(),
  notes: text(),
  /** How many servings its ingredient quantities make. */
  servings: integer().notNull(),
  /** The method, one entry per step, in order. */
  steps: text({ mode: "json" }).$type<string[]>().notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A recipe's ingredients, in the order the recipe lists them. */
export const recipeIngredients = sqliteTable(
  "recipe_ingredients",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    /** In the ingredient's unit, for the recipe's servings; null when the recipe gives no amount. */
    quantity: real(),
    /** How it is used: "finely chopped". */
    note: text(),
  },
  (table) => [primaryKey({ columns: [table.recipeId, table.position] })],
);

/** The meal prep calendar: a recipe planned for one meal of one day. */
export const meals = sqliteTable(
  "meals",
  {
    id: text().primaryKey(),
    /** A calendar date, YYYY-MM-DD: the day it is eaten, not an instant. */
    date: text().notNull(),
    slot: text().$type<"breakfast" | "lunch" | "dinner" | "snack">().notNull(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    /** How many servings to make; the recipe's quantities scale from its own servings to these. */
    servings: integer().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("meals_date").on(table.date)],
);
