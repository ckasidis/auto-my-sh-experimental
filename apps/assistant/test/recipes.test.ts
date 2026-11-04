import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import type { GroceryItem } from "utils/groceries";
import {
  type Ingredient,
  type IngredientCategory,
  isCalendarDate,
  type Meal,
  type OwnerRecipes,
  type Recipe,
} from "../src/recipe-book.ts";
import { createRecipeTools } from "../src/recipes.ts";
import type { UserStore } from "../src/user-store.ts";
import { memoryStore, withDisposer } from "./memory-store.ts";

/* Copies of stored values marked as Workers RPC marks a result: every array and object carries a disposer. */
const rpcCategory = (category: IngredientCategory) => withDisposer({ ...category });

const rpcIngredient = (ingredient: Ingredient) => withDisposer({ ...ingredient });

const rpcRecipe = (recipe: Recipe) =>
  withDisposer({
    ...recipe,
    steps: withDisposer([...recipe.steps]),
    ingredients: withDisposer(recipe.ingredients.map((line) => withDisposer({ ...line }))),
  });

const rpcMeal = (meal: Meal) => withDisposer({ ...meal });

const rpcGroceryItem = (item: GroceryItem) =>
  withDisposer({ ...item, recipes: withDisposer([...item.recipes]) });

const orNull = <T, R>(value: T | null, mark: (value: T) => R) =>
  value === null ? null : mark(value);

/** The store as the tools see it over RPC in production, where every result carries disposers. */
const overRpc = (store: UserStore): OwnerRecipes => ({
  listCategories: () => withDisposer(store.listCategories().map(rpcCategory)),
  addCategory: (category) => rpcCategory(store.addCategory(category)),
  renameCategory: (id, name) => orNull(store.renameCategory(id, name), rpcCategory),
  removeCategory: (id) => store.removeCategory(id),
  listIngredients: () => withDisposer(store.listIngredients().map(rpcIngredient)),
  addIngredient: (ingredient) => rpcIngredient(store.addIngredient(ingredient)),
  updateIngredient: (id, changes) => orNull(store.updateIngredient(id, changes), rpcIngredient),
  removeIngredient: (id) => store.removeIngredient(id),
  listRecipes: () => withDisposer(store.listRecipes().map(rpcRecipe)),
  addRecipe: (recipe) => rpcRecipe(store.addRecipe(recipe)),
  updateRecipe: (id, changes) => orNull(store.updateRecipe(id, changes), rpcRecipe),
  removeRecipe: (id) => store.removeRecipe(id),
  listMeals: (range) => withDisposer(store.listMeals(range).map(rpcMeal)),
  addMeal: (meal) => rpcMeal(store.addMeal(meal)),
  updateMeal: (id, changes) => orNull(store.updateMeal(id, changes), rpcMeal),
  removeMeal: (id) => store.removeMeal(id),
  groceryList: (range) => withDisposer(store.groceryList(range).map(rpcGroceryItem)),
});

/**
 * A store with spaghetti (g), eggs (no unit, in Dairy) and salt, and a carbonara for 2 that uses all three.
 */
function stocked() {
  const store = memoryStore();

  store.addCategory({ id: "dairy", name: "Dairy" });
  store.addIngredient({ id: "spaghetti", name: "Spaghetti", unit: "g", categoryId: null });
  store.addIngredient({ id: "egg", name: "Egg", unit: null, categoryId: "dairy" });
  store.addIngredient({ id: "salt", name: "Salt", unit: null, categoryId: null });
  store.addRecipe({
    id: "carbonara",
    name: "Carbonara",
    notes: null,
    servings: 2,
    steps: ["Boil the pasta", "Stir in the eggs off the heat"],
    ingredients: [
      { ingredientId: "spaghetti", quantity: 200, note: null },
      { ingredientId: "egg", quantity: 3, note: "yolks only" },
      { ingredientId: "salt", quantity: null, note: null },
    ],
  });

  return store;
}

const meal = (id: string, date: string, servings: number) =>
  ({ id, date, slot: "dinner", recipeId: "carbonara", servings }) as const;

describe("recipe book", () => {
  it("keeps one category per name, and leaves its ingredients in none when it is deleted", () => {
    const store = stocked();

    expect(store.addCategory({ id: "other", name: " dairy " }).id).toBe("dairy");
    store.addCategory({ id: "produce", name: "Produce" });
    expect(store.listCategories().map(({ name }) => name)).toEqual(["Dairy", "Produce"]);
    expect(() => store.renameCategory("produce", "DAIRY")).toThrow("already exists");
    expect(store.renameCategory("produce", "Veg")).toMatchObject({ name: "Veg" });
    expect(store.renameCategory("missing", "x")).toBeNull();

    expect(store.updateIngredient("salt", { categoryId: "produce" })).toMatchObject({
      categoryId: "produce",
    });
    expect(() => store.updateIngredient("salt", { categoryId: "nope" })).toThrow(
      "No category has id nope",
    );
    expect(() =>
      store.addIngredient({ id: "milk", name: "Milk", unit: "ml", categoryId: "nope" }),
    ).toThrow("No category has id nope");

    expect(store.removeCategory("dairy")).toBe(true);
    expect(store.removeCategory("dairy")).toBe(false);
    expect(store.listIngredients().find(({ id }) => id === "egg")).toMatchObject({
      categoryId: null,
    });
    expect(store.updateIngredient("salt", { categoryId: null })).toMatchObject({
      categoryId: null,
    });
  });

  it("keeps one ingredient per name, ignoring case", () => {
    const store = stocked();

    const again = { id: "other", name: " spaghetti ", unit: "kg", categoryId: null };

    expect(store.addIngredient(again).id).toBe("spaghetti");
    expect(store.listIngredients().map(({ name }) => name)).toEqual(["Egg", "Salt", "Spaghetti"]);
    expect(() => store.updateIngredient("egg", { name: "SALT" })).toThrow("already exists");
    expect(store.updateIngredient("egg", { name: "Eggs" })).toMatchObject({
      name: "Eggs",
      unit: null,
    });
  });

  it("stores a recipe's lines and steps in order, and replaces them on update", () => {
    const store = stocked();

    expect(store.listRecipes()).toEqual([
      expect.objectContaining({
        id: "carbonara",
        steps: ["Boil the pasta", "Stir in the eggs off the heat"],
        ingredients: [
          { ingredientId: "spaghetti", quantity: 200, note: null },
          { ingredientId: "egg", quantity: 3, note: "yolks only" },
          { ingredientId: "salt", quantity: null, note: null },
        ],
      }),
    ]);

    const updated = store.updateRecipe("carbonara", {
      ingredients: [{ ingredientId: "egg", quantity: 4, note: null }],
    });

    expect(updated).toMatchObject({
      name: "Carbonara",
      steps: ["Boil the pasta", "Stir in the eggs off the heat"],
      ingredients: [{ ingredientId: "egg", quantity: 4, note: null }],
    });
    expect(store.updateRecipe("missing", { name: "x" })).toBeNull();
  });

  it("adds a recipe once per id, and refuses unknown ingredients and bad servings", () => {
    const store = stocked();

    const again = {
      id: "carbonara",
      name: "Other",
      notes: null,
      servings: 1,
      steps: [],
      ingredients: [],
    };

    expect(store.addRecipe(again).name).toBe("Carbonara");
    expect(() =>
      store.addRecipe({
        ...again,
        id: "new",
        ingredients: [{ ingredientId: "nope", quantity: 1, note: null }],
      }),
    ).toThrow("No ingredient has id nope");
    expect(() => store.addRecipe({ ...again, id: "new", servings: 0 })).toThrow("servings");
    expect(store.listRecipes()).toHaveLength(1);
  });

  it("refuses to delete an ingredient a recipe uses", () => {
    const store = stocked();

    expect(() => store.removeIngredient("egg")).toThrow("Used by Carbonara");

    store.updateRecipe("carbonara", { ingredients: [] });

    expect(store.removeIngredient("egg")).toBe(true);
    expect(store.removeIngredient("egg")).toBe(false);
  });

  it("lists meals in a range by date and slot, and deletes them with their recipe", () => {
    const store = stocked();

    store.addMeal(meal("late", "2026-11-05", 2));
    store.addMeal({ ...meal("lunch", "2026-11-04", 2), slot: "lunch" });
    store.addMeal(meal("dinner", "2026-11-04", 2));
    store.addMeal({ ...meal("breakfast", "2026-11-04", 2), slot: "breakfast" });

    expect(store.listMeals({ from: "2026-11-04", to: "2026-11-04" }).map(({ id }) => id)).toEqual([
      "breakfast",
      "lunch",
      "dinner",
    ]);
    expect(store.updateMeal("late", { date: "2026-11-03" })).toMatchObject({ date: "2026-11-03" });
    expect(store.listMeals().map(({ id }) => id)).toEqual(["late", "breakfast", "lunch", "dinner"]);
    expect(() => store.addMeal(meal("bad", "2026-02-30", 2))).toThrow("calendar date");
    expect(() => store.addMeal({ ...meal("x", "2026-11-04", 2), recipeId: "nope" })).toThrow(
      "No recipe",
    );

    expect(store.removeRecipe("carbonara")).toBe(true);
    expect(store.listMeals()).toEqual([]);
  });

  it("totals the grocery list over the range, scaled to each meal's servings", () => {
    const store = stocked();

    store.addMeal(meal("a", "2026-11-04", 2));
    store.addMeal(meal("b", "2026-11-05", 3));
    store.addMeal(meal("outside", "2026-11-12", 2));

    expect(store.groceryList({ from: "2026-11-02", to: "2026-11-08" })).toEqual([
      {
        ingredientId: "egg",
        name: "Egg",
        unit: null,
        quantity: 7.5,
        unmeasured: false,
        recipes: ["Carbonara"],
      },
      {
        ingredientId: "salt",
        name: "Salt",
        unit: null,
        quantity: null,
        unmeasured: true,
        recipes: ["Carbonara"],
      },
      {
        ingredientId: "spaghetti",
        name: "Spaghetti",
        unit: "g",
        quantity: 500,
        unmeasured: false,
        recipes: ["Carbonara"],
      },
    ]);
  });

  it("accepts only real calendar dates", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-11-4")).toBe(false);
    expect(isCalendarDate("2026-11-04T00:00")).toBe(false);
  });
});

describe("recipe tools", () => {
  it("adds ingredients and a recipe, plans it, and lists the groceries over RPC", async () => {
    const context = BACKGROUND_CONTEXT;
    const store = memoryStore();
    const tools = createRecipeTools(() => overRpc(store));
    const faux = fauxProvider();

    const ingredientId = (name: string) =>
      store.listIngredients().find((item) => item.name === name)!.id;

    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("add_category", { name: "Grains" }),
          fauxToolCall("add_ingredient", { name: "Egg" }),
        ],
        { stopReason: "toolUse" },
      ),
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("add_ingredient", {
              name: "Rice",
              unit: "g",
              categoryId: store.listCategories()[0]!.id,
            }),
            fauxToolCall("list_ingredients", {}),
          ],
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("add_recipe", {
              name: "Fried rice",
              servings: 1,
              ingredients: [
                { ingredientId: ingredientId("Rice"), quantity: 150 },
                { ingredientId: ingredientId("Egg"), quantity: 1, note: "beaten" },
              ],
              steps: ["Fry the egg", "Add the rice"],
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("plan_meal", {
              date: "2026-11-04",
              slot: "lunch",
              recipeId: store.listRecipes()[0]!.id,
              servings: 2,
            }),
            fauxToolCall("get_recipe", { id: store.listRecipes()[0]!.id }),
            fauxToolCall("grocery_list", { from: "2026-11-02", to: "2026-11-08" }),
          ],
          { stopReason: "toolUse" },
        ),
      fauxAssistantMessage([fauxText("Planned.")]),
    ]);

    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    registry.install(defineExtension({ name: "recipes", tools }));
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);

    try {
      const root = await harness.root(context);
      await root.configure({ model: { provider: "faux", modelId: "faux-1" }, tools }, context);
      const submission = await root.submit({ type: "input", content: "Plan fried rice" }, context);
      await submission.wait(context);

      const results = (await root.context(context)).messages.flatMap((message) =>
        message.role === "toolResult" ? [message] : [],
      );

      expect(results.map(({ toolName, isError }) => ({ toolName, isError }))).toEqual([
        { toolName: "add_category", isError: false },
        { toolName: "add_ingredient", isError: false },
        { toolName: "add_ingredient", isError: false },
        { toolName: "list_ingredients", isError: false },
        { toolName: "add_recipe", isError: false },
        { toolName: "plan_meal", isError: false },
        { toolName: "get_recipe", isError: false },
        { toolName: "grocery_list", isError: false },
      ]);

      const text = (index: number) =>
        results[index]!.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(
          "",
        );

      expect(text(3)).toMatch(
        /^- Egg \(no unit, id: [^)]+\)\n- Rice \(unit: g, category: Grains, id: /,
      );
      expect(text(6)).toContain("- 150 g Rice");
      expect(text(6)).toContain("- 1 Egg, beaten");
      expect(text(7)).toBe("- Egg: 2 (for Fried rice)\n- Rice: 300 g (for Fried rice)");
      expect(store.listMeals()).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^meal:/),
          date: "2026-11-04",
          servings: 2,
        }),
      ]);
    } finally {
      await harness.close(context);
    }
  });
});
