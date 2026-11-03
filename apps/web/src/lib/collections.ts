import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/react-query";
import type {
  Ingredient,
  IngredientChanges,
  Meal,
  MealChanges,
  Recipe,
  RecipeChanges,
} from "assistant/recipe-book";
import type { Schedule } from "assistant/schedule";
import type { Todo, TodoChanges } from "assistant/user-store";
import { isCron } from "utils/recurrence";
import {
  addIngredient,
  addMeal,
  addRecipe,
  addSchedule,
  addTodo,
  cancelSchedule,
  deleteIngredient,
  deleteMeal,
  deleteRecipe,
  deleteTodo,
  listIngredients,
  listMeals,
  listRecipes,
  listSchedules,
  listTodos,
  updateIngredient,
  updateMeal,
  updateRecipe,
  updateTodo,
} from "@/mini-app/functions";

export const queryClient = new QueryClient();

/** The changes the store takes for a todo edited in the collection: completion is a flag, not a time. */
function todoChanges(changes: Partial<Todo>): TodoChanges {
  const result: { -readonly [K in keyof TodoChanges]: TodoChanges[K] } = {};

  if (changes.title !== undefined) result.title = changes.title;

  if (changes.notes !== undefined) result.notes = changes.notes;

  if (changes.dueAt !== undefined) result.dueAt = changes.dueAt;

  if (changes.completedAt !== undefined) result.done = changes.completedAt !== null;

  return result;
}

/**
 * The owner's todos, the same list the chat's tools change. Each write is applied at once and confirmed by a refetch;
 * a write the server refuses rolls back.
 */
export const todoCollection = createCollection(
  queryCollectionOptions({
    id: "todos",
    queryKey: ["todos"],
    queryFn: () => listTodos(),
    queryClient,
    getKey: (todo) => todo.id,
    onInsert: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ modified }) =>
          addTodo({
            data: {
              id: modified.id,
              title: modified.title,
              notes: modified.notes,
              dueAt: modified.dueAt,
            },
          }),
        ),
      );
      await collection.utils.refetch();
    },
    onUpdate: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original, changes }) =>
          updateTodo({ data: { id: original.id, changes: todoChanges(changes) } }),
        ),
      );
      await collection.utils.refetch();
    },
    onDelete: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original }) => deleteTodo({ data: { id: original.id } })),
      );
      await collection.utils.refetch();
    },
  }),
);

/**
 * The `addSchedule` request for a schedule inserted into the collection. A cron schedule sends no time: the server
 * finds its first match itself.
 */
function scheduleRequest(schedule: Schedule) {
  const request = { id: schedule.id, instruction: schedule.instruction };

  if (schedule.recurrence === undefined) {
    return { ...request, at: new Date(schedule.runAt).toISOString() };
  }

  if (isCron(schedule.recurrence)) return { ...request, recurrence: schedule.recurrence };

  return {
    ...request,
    at: new Date(schedule.runAt).toISOString(),
    recurrence: schedule.recurrence,
  };
}

/**
 * The chat's scheduled instructions still to be delivered. They also change on their own, as deliveries happen and
 * recurring ones renew, so the list is refreshed every half minute.
 */
export const scheduleCollection = createCollection(
  queryCollectionOptions({
    id: "schedules",
    queryKey: ["schedules"],
    queryFn: () => listSchedules(),
    queryClient,
    getKey: (schedule) => schedule.id,
    refetchInterval: 30_000,
    onInsert: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ modified }) =>
          addSchedule({ data: scheduleRequest(modified) }),
        ),
      );
      await collection.utils.refetch();
    },
    onDelete: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original }) => cancelSchedule({ data: { id: original.id } })),
      );
      await collection.utils.refetch();
    },
  }),
);

/** The changes the store takes for an ingredient edited in the collection. */
function ingredientChanges(changes: Partial<Ingredient>): IngredientChanges {
  const result: { -readonly [K in keyof IngredientChanges]: IngredientChanges[K] } = {};

  if (changes.name !== undefined) result.name = changes.name;

  if (changes.unit !== undefined) result.unit = changes.unit;

  return result;
}

/** The changes the store takes for a recipe edited in the collection; lines and steps go as whole lists. */
function recipeChanges(changes: Partial<Recipe>): RecipeChanges {
  const result: { -readonly [K in keyof RecipeChanges]: RecipeChanges[K] } = {};

  if (changes.name !== undefined) result.name = changes.name;

  if (changes.notes !== undefined) result.notes = changes.notes;

  if (changes.servings !== undefined) result.servings = changes.servings;

  if (changes.steps !== undefined) result.steps = changes.steps;

  if (changes.ingredients !== undefined) result.ingredients = changes.ingredients;

  return result;
}

/** The changes the store takes for a meal edited in the collection. */
function mealChanges(changes: Partial<Meal>): MealChanges {
  const result: { -readonly [K in keyof MealChanges]: MealChanges[K] } = {};

  if (changes.date !== undefined) result.date = changes.date;

  if (changes.slot !== undefined) result.slot = changes.slot;

  if (changes.recipeId !== undefined) result.recipeId = changes.recipeId;

  if (changes.servings !== undefined) result.servings = changes.servings;

  return result;
}

/** The owner's ingredients, the ones the chat's recipe tools use. A delete the server refuses (in use) rolls back. */
export const ingredientCollection = createCollection(
  queryCollectionOptions({
    id: "ingredients",
    queryKey: ["ingredients"],
    queryFn: () => listIngredients(),
    queryClient,
    getKey: (ingredient) => ingredient.id,
    onInsert: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ modified }) =>
          addIngredient({ data: { id: modified.id, name: modified.name, unit: modified.unit } }),
        ),
      );
      await collection.utils.refetch();
    },
    onUpdate: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original, changes }) =>
          updateIngredient({ data: { id: original.id, changes: ingredientChanges(changes) } }),
        ),
      );
      await collection.utils.refetch();
    },
    onDelete: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original }) =>
          deleteIngredient({ data: { id: original.id } }),
        ),
      );
      await collection.utils.refetch();
    },
  }),
);

/** The owner's recipes, with their ingredient lines and steps. */
export const recipeCollection = createCollection(
  queryCollectionOptions({
    id: "recipes",
    queryKey: ["recipes"],
    queryFn: () => listRecipes(),
    queryClient,
    getKey: (recipe) => recipe.id,
    onInsert: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ modified }) =>
          addRecipe({
            data: {
              id: modified.id,
              name: modified.name,
              notes: modified.notes,
              servings: modified.servings,
              steps: modified.steps,
              ingredients: modified.ingredients,
            },
          }),
        ),
      );
      await collection.utils.refetch();
    },
    onUpdate: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original, changes }) =>
          updateRecipe({ data: { id: original.id, changes: recipeChanges(changes) } }),
        ),
      );
      await collection.utils.refetch();
    },
    onDelete: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original }) => deleteRecipe({ data: { id: original.id } })),
      );
      // The server deletes the meals planned with a recipe along with it.
      await Promise.all([collection.utils.refetch(), mealCollection.utils.refetch()]);
    },
  }),
);

/** The meal prep calendar: every planned meal, the grocery list's source. */
export const mealCollection = createCollection(
  queryCollectionOptions({
    id: "meals",
    queryKey: ["meals"],
    queryFn: () => listMeals(),
    queryClient,
    getKey: (meal) => meal.id,
    onInsert: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ modified }) =>
          addMeal({
            data: {
              id: modified.id,
              date: modified.date,
              slot: modified.slot,
              recipeId: modified.recipeId,
              servings: modified.servings,
            },
          }),
        ),
      );
      await collection.utils.refetch();
    },
    onUpdate: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original, changes }) =>
          updateMeal({ data: { id: original.id, changes: mealChanges(changes) } }),
        ),
      );
      await collection.utils.refetch();
    },
    onDelete: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original }) => deleteMeal({ data: { id: original.id } })),
      );
      await collection.utils.refetch();
    },
  }),
);
