import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
