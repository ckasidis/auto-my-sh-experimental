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

/** Groups of ingredients, such as "Produce" or "Dairy", for finding them on a list; "Other" is the default. */
export const ingredientCategories = sqliteTable("ingredient_categories", {
  id: text().primaryKey(),
  name: text().notNull(),
  /** Where lists show it, lowest first; the default category is always last, whatever its position. */
  position: integer().notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const ingredients = sqliteTable("ingredients", {
  id: text().primaryKey(),
  name: text().notNull(),
  /** The unit every recipe measures it in ("g", "ml", "pcs"); null for one counted without a unit. */
  unit: text(),
  /**
   * Its category; "Other" (`category:other`, added by a migration) unless it was given another. Nullable only because
   * SQLite cannot add a NOT NULL column with a reference; the store never writes null.
   */
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

/** The grocery list's ticks: an ingredient already bought for one week's planned meals. */
export const groceryPurchases = sqliteTable(
  "grocery_purchases",
  {
    /** The week's Monday, YYYY-MM-DD: the grocery list it was ticked on. */
    week: text().notNull(),
    ingredientId: text("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.week, table.ingredientId] })],
);

/** The exercises the owner does, such as "Push-up" or "Squat". */
export const exercises = sqliteTable("exercises", {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A named list of exercises to do in a workout, each with how many working sets. */
export const workoutPlans = sqliteTable("workout_plans", {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A plan's exercises, in the order the workout goes through them. */
export const planExercises = sqliteTable(
  "plan_exercises",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => workoutPlans.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    /** Working sets; warm-ups are added in the workout. */
    sets: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.planId, table.position] })],
);

/** One workout done on a day, from a plan or not. */
export const workoutSessions = sqliteTable(
  "workout_sessions",
  {
    id: text().primaryKey(),
    /** A calendar date, YYYY-MM-DD: the day it was done, not an instant. */
    date: text().notNull(),
    /** The plan it was started from; null for none, or once that plan is deleted. */
    planId: text("plan_id").references(() => workoutPlans.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("workout_sessions_date").on(table.date)],
);

/** A session's sets, in the order they were done. */
export const sessionSets = sqliteTable(
  "session_sets",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    /** A warm-up set is kept in the history but left out of the stats. */
    warmup: integer({ mode: "boolean" }).notNull().default(false),
    reps: integer().notNull(),
    /** In kg; null for one done without added weight. */
    weight: real(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.position] }),
    index("session_sets_exercise").on(table.exerciseId),
  ],
);
