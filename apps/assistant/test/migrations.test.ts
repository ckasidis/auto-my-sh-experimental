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

describe("the migration that orders Other like the others", () => {
  it("puts Other after every other category", () => {
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
      INSERT INTO ingredient_categories (id, name, created_at) VALUES ('produce', 'Produce', 1), ('bakery', 'Bakery', 2);
    `);

    migrate(db, "0004_category_order");
    migrate(db, "0005_other_sortable");

    expect(
      db.prepare("SELECT id, position FROM ingredient_categories ORDER BY position").all(),
    ).toEqual([
      { id: "bakery", position: 1 },
      { id: "produce", position: 3 },
      { id: "category:other", position: 4 },
    ]);
  });
});

describe("the workout sessions' migration", () => {
  it("makes a session per day of the log, with a set per row of each entry in the order logged", () => {
    const db = new DatabaseSync(":memory:");

    for (const name of [
      "0000_todos",
      "0001_recipes",
      "0002_ingredient_categories",
      "0003_other_category",
      "0004_category_order",
      "0005_other_sortable",
      "0006_workouts",
    ]) {
      migrate(db, name);
    }

    db.exec(`
      INSERT INTO exercises (id, name, created_at) VALUES ('squat', 'Squat', 1), ('push', 'Push-up', 1);
      INSERT INTO workout_entries (id, exercise_id, date, sets, reps, created_at) VALUES
        ('b', 'push', '2026-11-02', 1, 15, 20),
        ('a', 'squat', '2026-11-02', 2, 8, 10),
        ('c', 'squat', '2026-11-04', 3, 5, 30);
    `);

    migrate(db, "0007_workout_sessions");
    migrate(db, "0008_drop_workout_entries");

    expect(
      db.prepare("SELECT id, date, plan_id, created_at FROM workout_sessions ORDER BY date").all(),
    ).toEqual([
      { id: "session:2026-11-02", date: "2026-11-02", plan_id: null, created_at: 10 },
      { id: "session:2026-11-04", date: "2026-11-04", plan_id: null, created_at: 30 },
    ]);
    expect(
      db
        .prepare(
          "SELECT session_id, position, exercise_id, warmup, reps, weight FROM session_sets ORDER BY session_id, position",
        )
        .all(),
    ).toEqual([
      {
        session_id: "session:2026-11-02",
        position: 0,
        exercise_id: "squat",
        warmup: 0,
        reps: 8,
        weight: null,
      },
      {
        session_id: "session:2026-11-02",
        position: 1,
        exercise_id: "squat",
        warmup: 0,
        reps: 8,
        weight: null,
      },
      {
        session_id: "session:2026-11-02",
        position: 2,
        exercise_id: "push",
        warmup: 0,
        reps: 15,
        weight: null,
      },
      {
        session_id: "session:2026-11-04",
        position: 0,
        exercise_id: "squat",
        warmup: 0,
        reps: 5,
        weight: null,
      },
      {
        session_id: "session:2026-11-04",
        position: 1,
        exercise_id: "squat",
        warmup: 0,
        reps: 5,
        weight: null,
      },
      {
        session_id: "session:2026-11-04",
        position: 2,
        exercise_id: "squat",
        warmup: 0,
        reps: 5,
        weight: null,
      },
    ]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'workout_entries'").all(),
    ).toEqual([]);
  });
});
