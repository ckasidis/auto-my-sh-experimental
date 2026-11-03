import { describe, expect, it } from "vite-plus/test";
import { formatGroceryAmount, groceryList } from "../src/groceries.ts";

const ingredients = [
  { id: "flour", name: "Flour", unit: "g" },
  { id: "milk", name: "milk", unit: "ml" },
  { id: "salt", name: "Salt", unit: null },
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
  it("scales each meal's lines to its servings and sums them per ingredient, by name", () => {
    const list = groceryList(
      [
        { recipeId: "pancakes", servings: 2 },
        { recipeId: "bread", servings: 3 },
        { recipeId: "deleted", servings: 1 },
      ],
      recipes,
      ingredients,
    );

    expect(list).toEqual([
      {
        ingredientId: "flour",
        name: "Flour",
        unit: "g",
        quantity: 100.3,
        unmeasured: false,
        recipes: ["Pancakes", "Bread"],
      },
      {
        ingredientId: "milk",
        name: "milk",
        unit: "ml",
        quantity: 150,
        unmeasured: false,
        recipes: ["Pancakes"],
      },
      {
        ingredientId: "salt",
        name: "Salt",
        unit: null,
        quantity: null,
        unmeasured: true,
        recipes: ["Pancakes"],
      },
    ]);
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
