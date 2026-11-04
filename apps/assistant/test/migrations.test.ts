import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

/** Runs one of `drizzle/`'s migrations, statement by statement, as drizzle's migrator does. */
function migrate(db: DatabaseSync, name: string): void {
  const text = readFileSync(fileURLToPath(import.meta.resolve(`../drizzle/${name}.sql`)), "utf8");

  for (const statement of text.split("--> statement-breakpoint")) db.exec(statement);
}

describe("the default category's migration", () => {
  it("puts uncategorized ingredients in Other, and merges a category already named Other into it", () => {
    const db = new DatabaseSync(":memory:");

    for (const name of ["0000_todos", "0001_recipes", "0002_ingredient_categories"]) {
      migrate(db, name);
    }

    db.exec(`
      INSERT INTO ingredient_categories (id, name, created_at) VALUES ('dairy', 'Dairy', 1), ('mine', ' other ', 2);
      INSERT INTO ingredients (id, name, unit, category_id, created_at) VALUES
        ('milk', 'Milk', 'ml', 'dairy', 1),
        ('salt', 'Salt', NULL, NULL, 1),
        ('foil', 'Foil', NULL, 'mine', 1);
    `);

    migrate(db, "0003_other_category");

    expect(db.prepare("SELECT id, name FROM ingredient_categories ORDER BY id").all()).toEqual([
      { id: "category:other", name: "Other" },
      { id: "dairy", name: "Dairy" },
    ]);
    expect(db.prepare("SELECT id, category_id FROM ingredients ORDER BY id").all()).toEqual([
      { id: "foil", category_id: "category:other" },
      { id: "milk", category_id: "dairy" },
      { id: "salt", category_id: "category:other" },
    ]);
  });
});

describe("the category order's migration", () => {
  it("numbers the existing categories in the name order they were listed in", () => {
    const db = new DatabaseSync(":memory:");

    for (const name of [
      "0000_todos",
      "0001_recipes",
      "0002_ingredient_categories",
      "0003_other_category",
    ]) {
      migrate(db, name);
    }

    db.exec(`
      INSERT INTO ingredient_categories (id, name, created_at) VALUES
        ('produce', 'Produce', 1), ('bakery', 'bakery', 2), ('dairy', 'Dairy', 3);
    `);

    migrate(db, "0004_category_order");

    expect(
      db.prepare("SELECT id, position FROM ingredient_categories ORDER BY position").all(),
    ).toEqual([
      { id: "bakery", position: 1 },
      { id: "dairy", position: 2 },
      { id: "category:other", position: 3 },
      { id: "produce", position: 4 },
    ]);
  });
});
