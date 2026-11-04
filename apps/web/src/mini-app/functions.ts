import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { launchData } from "@/lib/telegram";
import type { Ingredient, IngredientCategory, Meal, Recipe } from "assistant/recipe-book";
import type { Schedule } from "assistant/schedule";
import type { Todo } from "assistant/user-store";
import { copyRecurrence } from "utils/recurrence";
import { authorizeOwner, owner } from "./owner.server.ts";

/** Sends Telegram's `initData` with every call; the server refuses any not signed for the owner. */
const ownerOnly = createMiddleware({ type: "function" })
  .client(({ next }) => next({ headers: { Authorization: `tma ${launchData()}` } }))
  .server(async ({ next }) => {
    await authorizeOwner(getRequestHeader("authorization"));

    return next();
  });

// Limits match the chat's tools, so the app accepts what the chat accepts.
const Title = Type.String({ minLength: 1, maxLength: 500 });
const Notes = Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()]);
const DueAt = Type.Union([Type.Integer(), Type.Null()]);
const Id = Type.String({ minLength: 1, maxLength: 200 });

/** Ids the app chooses, kept apart from the `todo:<task id>` ones the chat's tools derive. */
const NewTodoInput = Type.Object({
  id: Type.String({ pattern: "^todo:app:[\\w-]{1,100}$" }),
  title: Title,
  notes: Notes,
  dueAt: DueAt,
});

const TodoUpdateInput = Type.Object({
  id: Id,
  changes: Type.Object({
    title: Type.Optional(Title),
    notes: Type.Optional(Notes),
    dueAt: Type.Optional(DueAt),
    done: Type.Optional(Type.Boolean()),
  }),
});

const IdInput = Type.Object({ id: Id });

const Timezone = Type.String({ minLength: 1, maxLength: 100 });

const ScheduleInput = Type.Object({
  id: Type.String({ pattern: "^schedule:owner:[\\w-]{1,100}$" }),
  instruction: Type.String({ minLength: 1, maxLength: 100_000 }),
  // Absent for a cron recurrence, whose first run is its first match.
  at: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  recurrence: Type.Optional(
    Type.Union([
      Type.Object({
        cadence: Type.Object({
          unit: Type.Union([
            Type.Literal("minute"),
            Type.Literal("hour"),
            Type.Literal("day"),
            Type.Literal("week"),
            Type.Literal("month"),
          ]),
          interval: Type.Integer({ minimum: 1, maximum: 10_000 }),
        }),
        timezone: Timezone,
      }),
      Type.Object({ cron: Type.String({ minLength: 9, maxLength: 200 }), timezone: Timezone }),
    ]),
  ),
});

// Limits match the chat's recipe tools.
const Name = Type.String({ minLength: 1, maxLength: 200 });
const Unit = Type.Union([Type.String({ minLength: 1, maxLength: 20 }), Type.Null()]);
const Servings = Type.Integer({ minimum: 1, maximum: 100 });
const CalendarDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

const Slot = Type.Union([
  Type.Literal("breakfast"),
  Type.Literal("lunch"),
  Type.Literal("dinner"),
  Type.Literal("snack"),
]);

const Lines = Type.Array(
  Type.Object({
    ingredientId: Id,
    quantity: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]),
    note: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  }),
  { maxItems: 100 },
);

const Steps = Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 100 });

/** Ids the app chooses are `<kind>:app:<uuid>`, kept apart from the `<kind>:<task id>` ones the chat's tools derive. */
const appId = (kind: string) => Type.String({ pattern: `^${kind}:app:[\\w-]{1,100}$` });

const CategoryId = Type.Union([Id, Type.Null()]);

const NewCategoryInput = Type.Object({ id: appId("category"), name: Name });

const CategoryRenameInput = Type.Object({ id: Id, name: Name });

const CategoryOrderInput = Type.Object({ ids: Type.Array(Id, { minItems: 1, maxItems: 100 }) });

const NewIngredientInput = Type.Object({
  id: appId("ingredient"),
  name: Name,
  unit: Unit,
  categoryId: CategoryId,
});

const IngredientUpdateInput = Type.Object({
  id: Id,
  changes: Type.Object({
    name: Type.Optional(Name),
    unit: Type.Optional(Unit),
    categoryId: Type.Optional(CategoryId),
  }),
});

const NewRecipeInput = Type.Object({
  id: appId("recipe"),
  name: Name,
  notes: Notes,
  servings: Servings,
  steps: Steps,
  ingredients: Lines,
});

const RecipeUpdateInput = Type.Object({
  id: Id,
  changes: Type.Object({
    name: Type.Optional(Name),
    notes: Type.Optional(Notes),
    servings: Type.Optional(Servings),
    steps: Type.Optional(Steps),
    ingredients: Type.Optional(Lines),
  }),
});

const NewMealInput = Type.Object({
  id: appId("meal"),
  date: CalendarDate,
  slot: Slot,
  recipeId: Id,
  servings: Servings,
});

const MealUpdateInput = Type.Object({
  id: Id,
  changes: Type.Object({
    date: Type.Optional(CalendarDate),
    slot: Type.Optional(Slot),
    recipeId: Type.Optional(Id),
    servings: Type.Optional(Servings),
  }),
});

/**
 * A plain copy of a recipe-book value. RPC results carry `Symbol.dispose` disposers on every array and object, which
 * are not sent to the browser; these values are JSON already, and the round trip drops them.
 */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A plain copy: RPC results carry `Symbol.dispose` disposers, which are not sent to the browser. */
const plainTodo = (todo: Todo): Todo => ({
  id: todo.id,
  title: todo.title,
  notes: todo.notes,
  dueAt: todo.dueAt,
  createdAt: todo.createdAt,
  completedAt: todo.completedAt,
});

const plainSchedule = (schedule: Schedule): Schedule => {
  const copy = { id: schedule.id, instruction: schedule.instruction, runAt: schedule.runAt };

  if (schedule.recurrence === undefined) return copy;

  return { ...copy, recurrence: copyRecurrence(schedule.recurrence) };
};

/** Every todo, open ones first, soonest due first. */
export const listTodos = createServerFn({ method: "GET" })
  .middleware([ownerOnly])
  .handler(async () => (await owner().listTodos("all")).map(plainTodo));

export const addTodo = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof NewTodoInput>) => Value.Parse(NewTodoInput, input))
  .handler(async ({ data }) => plainTodo(await owner().addTodo(data)));

export const updateTodo = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof TodoUpdateInput>) => Value.Parse(TodoUpdateInput, input))
  .handler(async ({ data }) => {
    const updated = await owner().updateTodo(data.id, data.changes);

    if (updated === null) throw new Error(`No todo has id ${data.id}`);

    return plainTodo(updated);
  });

export const deleteTodo = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IdInput>) => Value.Parse(IdInput, input))
  .handler(async ({ data }) => owner().removeTodo(data.id));

/** The chat's scheduled instructions still to be delivered, soonest first. */
export const listSchedules = createServerFn({ method: "GET" })
  .middleware([ownerOnly])
  .handler(async () => (await owner().listSchedules()).map(plainSchedule));

export const addSchedule = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof ScheduleInput>) => Value.Parse(ScheduleInput, input))
  .handler(async ({ data }) => plainSchedule(await owner().addSchedule(data)));

export const cancelSchedule = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IdInput>) => Value.Parse(IdInput, input))
  .handler(async ({ data }) => owner().cancelSchedule(data.id));

/** Every ingredient category, by name. */
export const listCategories = createServerFn({ method: "GET" })
  .middleware([ownerOnly])
  .handler(async (): Promise<IngredientCategory[]> => plain(await owner().listCategories()));

export const addCategory = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof NewCategoryInput>) => Value.Parse(NewCategoryInput, input))
  .handler(async ({ data }): Promise<IngredientCategory> => plain(await owner().addCategory(data)));

export const renameCategory = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof CategoryRenameInput>) => Value.Parse(CategoryRenameInput, input))
  .handler(async ({ data }): Promise<IngredientCategory> => {
    const renamed = await owner().renameCategory(data.id, data.name);

    if (renamed === null) throw new Error(`No category has id ${data.id}`);

    return plain(renamed);
  });

/** Puts the categories in this order, first to last; Other stays last. */
export const reorderCategories = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof CategoryOrderInput>) => Value.Parse(CategoryOrderInput, input))
  .handler(async ({ data }): Promise<IngredientCategory[]> =>
    plain(await owner().reorderCategories(data.ids)),
  );

/** Deletes the category; its ingredients move to Other, the default. */
export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IdInput>) => Value.Parse(IdInput, input))
  .handler(async ({ data }) => owner().removeCategory(data.id));

/** Every ingredient, by name. */
export const listIngredients = createServerFn({ method: "GET" })
  .middleware([ownerOnly])
  .handler(async (): Promise<Ingredient[]> => plain(await owner().listIngredients()));

export const addIngredient = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof NewIngredientInput>) => Value.Parse(NewIngredientInput, input))
  .handler(async ({ data }): Promise<Ingredient> => plain(await owner().addIngredient(data)));

export const updateIngredient = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IngredientUpdateInput>) =>
    Value.Parse(IngredientUpdateInput, input),
  )
  .handler(async ({ data }): Promise<Ingredient> => {
    const updated = await owner().updateIngredient(data.id, data.changes);

    if (updated === null) throw new Error(`No ingredient has id ${data.id}`);

    return plain(updated);
  });

export const deleteIngredient = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IdInput>) => Value.Parse(IdInput, input))
  .handler(async ({ data }) => owner().removeIngredient(data.id));

/** Every recipe, by name, with its ingredients and steps. */
export const listRecipes = createServerFn({ method: "GET" })
  .middleware([ownerOnly])
  .handler(async (): Promise<Recipe[]> => plain(await owner().listRecipes()));

export const addRecipe = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof NewRecipeInput>) => Value.Parse(NewRecipeInput, input))
  .handler(async ({ data }): Promise<Recipe> => plain(await owner().addRecipe(data)));

export const updateRecipe = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof RecipeUpdateInput>) => Value.Parse(RecipeUpdateInput, input))
  .handler(async ({ data }): Promise<Recipe> => {
    const updated = await owner().updateRecipe(data.id, data.changes);

    if (updated === null) throw new Error(`No recipe has id ${data.id}`);

    return plain(updated);
  });

/** Deletes the recipe and every meal planned with it. */
export const deleteRecipe = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IdInput>) => Value.Parse(IdInput, input))
  .handler(async ({ data }) => owner().removeRecipe(data.id));

/** Every planned meal, by date and slot. */
export const listMeals = createServerFn({ method: "GET" })
  .middleware([ownerOnly])
  .handler(async (): Promise<Meal[]> => plain(await owner().listMeals()));

export const addMeal = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof NewMealInput>) => Value.Parse(NewMealInput, input))
  .handler(async ({ data }): Promise<Meal> => plain(await owner().addMeal(data)));

export const updateMeal = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof MealUpdateInput>) => Value.Parse(MealUpdateInput, input))
  .handler(async ({ data }): Promise<Meal> => {
    const updated = await owner().updateMeal(data.id, data.changes);

    if (updated === null) throw new Error(`No meal has id ${data.id}`);

    return plain(updated);
  });

export const deleteMeal = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IdInput>) => Value.Parse(IdInput, input))
  .handler(async ({ data }) => owner().removeMeal(data.id));
