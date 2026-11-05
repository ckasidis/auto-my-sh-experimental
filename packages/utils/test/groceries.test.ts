import { describe, expect, it } from "vite-plus/test";
import { formatGroceryAmount, groceryList, groupGroceries } from "../src/groceries.ts";

const ingredients = [
  { id: "flour", name: "Flour", unit: "g", categoryId: "baking" },
  { id: "milk", name: "milk", unit: "ml", categoryId: "dairy" },
  { id: "salt", name: "Salt", unit: null, categoryId: null },
  { id: "butter", name: "Butter", unit: "g", categoryId: "dairy" },
];

// In the owner's order, not by name: Dairy, Baking, Vegetables, Other.
const categories = [
  { id: "dairy", name: "Dairy", position: 1 },
  { id: "category:other", name: "Other", position: 4 },
  { id: "baking", name: "Baking", position: 2 },
  { id: "veg", name: "Vegetables", position: 3 },
];

const recipes = [
  {
    id: "pancakes",
    name: "Pancakes",
    servings: 4,
    ingredients: [
      { ingredientId: "flour", quantity: 200 },
      { ingredientId: "milk", quantity: 300 },
      { ingredientId: "salt", quantity: null },
    ],
  },
  {
    id: "bread",
    name: "Bread",
    servings: 1,
    ingredients: [{ ingredientId: "flour", quantity: 0.1 }],
  },
];

describe("grocery list", () => {
  it("scales each meal's lines to its servings and sums them per ingredient", () => {
    const list = groceryList(
      [
        { recipeId: "pancakes", servings: 2 },
        { recipeId: "bread", servings: 3 },
        { recipeId: "deleted", servings: 1 },
      ],
      recipes,
      ingredients,
      categories,
    );

    expect(list).toEqual([
      {
        ingredientId: "milk",
        name: "milk",
        unit: "ml",
        categoryId: "dairy",
        category: "Dairy",
        quantity: 150,
        unmeasured: false,
        recipes: ["Pancakes"],
      },
      {
        ingredientId: "flour",
        name: "Flour",
        unit: "g",
        categoryId: "baking",
        category: "Baking",
        quantity: 100.3,
        unmeasured: false,
        recipes: ["Pancakes", "Bread"],
      },
      {
        ingredientId: "salt",
        name: "Salt",
        unit: null,
        categoryId: "category:other",
        category: "Other",
        quantity: null,
        unmeasured: true,
        recipes: ["Pancakes"],
      },
    ]);
  });

  it("sorts by the owner's category order, then by name, with unknown categories in the default one", () => {
    const pantry = [
      ...ingredients,
      { id: "yeast", name: "Yeast", unit: "g", categoryId: "gone" },
      { id: "apple", name: "Apple", unit: null, categoryId: "category:other" },
      { id: "zucchini", name: "Zucchini", unit: null, categoryId: "veg" },
    ];

    const everything = {
      id: "everything",
      name: "Everything",
      servings: 1,
      ingredients: pantry.map(({ id }) => ({ ingredientId: id, quantity: 1 })),
    };

    const list = groceryList(
      [{ recipeId: "everything", servings: 1 }],
      [everything],
      pantry,
      categories,
    );

    expect(list.map(({ name, category }) => [category, name])).toEqual([
      ["Dairy", "Butter"],
      ["Dairy", "milk"],
      ["Baking", "Flour"],
      ["Vegetables", "Zucchini"],
      ["Other", "Apple"],
      ["Other", "Salt"],
      ["Other", "Yeast"],
    ]);
    expect(
      groupGroceries(list).map(({ category, items }) => [category, items.map(({ name }) => name)]),
    ).toEqual([
      ["Dairy", ["Butter", "milk"]],
      ["Baking", ["Flour"]],
      ["Vegetables", ["Zucchini"]],
      ["Other", ["Apple", "Salt", "Yeast"]],
    ]);

    const otherFirst = categories.map((category) =>
      category.id === "category:other" ? { ...category, position: 0 } : category,
    );

    expect(
      groupGroceries(
        groceryList([{ recipeId: "everything", servings: 1 }], [everything], pantry, otherFirst),
      ).map(({ category }) => category),
    ).toEqual(["Other", "Dairy", "Baking", "Vegetables"]);
  });

  it("formats an amount with its unit, and says when some is unmeasured", () => {
    expect(formatGroceryAmount({ unit: "g", quantity: 250, unmeasured: false })).toBe("250 g");
    expect(formatGroceryAmount({ unit: null, quantity: 3, unmeasured: false })).toBe("3");
    expect(formatGroceryAmount({ unit: "g", quantity: 250, unmeasured: true })).toBe(
      "250 g + as needed",
    );
    expect(formatGroceryAmount({ unit: null, quantity: null, unmeasured: true })).toBe("as needed");
  });
});
