import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { UserStore } from "../src/user-store.ts";

/**
 * A `UserStore` object on `node:sqlite`, standing in for Durable Object SQLite: the cursor methods Drizzle's
 * `durable-sqlite` driver reads (`toArray`, `next`, `raw`), `transactionSync`, and `blockConcurrencyWhile`.
 */
export const memoryStore = (): UserStore => {
  const db = new DatabaseSync(":memory:");

  const exec = (query: string, ...bindings: SQLInputValue[]) => {
    const statement = db.prepare(query);
    const columns = statement.columns().map(({ name }) => name);

    // A statement that returns no columns (DDL, writes without RETURNING) is run; any other is read once.
    const rows = columns.length > 0 ? statement.all(...bindings) : [];

    if (columns.length === 0) statement.run(...bindings);

    return {
      toArray: () => rows,
      next: () => ({ value: rows[0], done: rows.length === 0 }),
      raw: () => ({ toArray: () => rows.map((row) => columns.map((column) => row[column])) }),
    };
  };

  const storage = { sql: { exec }, transactionSync: <T>(run: () => T) => run() };

  // SAFETY: `UserStore` and Drizzle use only these parts of the Durable Object state, which run synchronously here.
  const ctx = { storage, blockConcurrencyWhile: <T>(run: () => T) => run() } as never;

  // SAFETY: `UserStore` reads no bindings.
  return new UserStore(ctx, {} as never);
};

/** Marks a value the way a Workers RPC result is marked: with a `Symbol.dispose` disposer. */
export const withDisposer = <T extends object>(value: T): T =>
  Object.assign(value, { [Symbol.dispose]: () => {} });
