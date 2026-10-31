import { DurableObject, exports } from "cloudflare:workers";
import { asc, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../drizzle/migrations.js";
import { todos } from "./schema.ts";
import { OWNER } from "./telegram.ts";

/** One of the owner's todos. */
export type Todo = typeof todos.$inferSelect;

export type TodoFilter = "open" | "done" | "all";

/** A todo to add. Its id is chosen by the caller, so a retried add is the same todo. */
export type NewTodo = Pick<Todo, "id" | "title" | "notes" | "dueAt">;

/** Fields to change; an absent one is kept, and a null clears notes or the due date. */
export type TodoChanges = {
  readonly title?: string;
  readonly notes?: string | null;
  readonly dueAt?: number | null;
  readonly done?: boolean;
};

type Awaitable<T> = T | Promise<T>;

/** The `UserStore` object's methods, which the todo tools call; over RPC each returns a promise. */
export interface OwnerTodos {
  list(filter?: TodoFilter): Awaitable<Todo[]>;
  add(todo: NewTodo): Awaitable<Todo>;
  update(id: string, changes: TodoChanges): Awaitable<Todo | null>;
  remove(id: string): Awaitable<boolean>;
}

/** The owner's `UserStore` object. Resolve it at each use: a stub is cheap, and a call reaches the object only then. */
export const userStore = () => exports.UserStore.getByName(OWNER);

const FILTERS: Record<TodoFilter, SQL | undefined> = {
  open: isNull(todos.completedAt),
  done: isNotNull(todos.completedAt),
  all: undefined,
};

/**
 * The owner's data in their own Durable Object SQLite, apart from the conversation: Pi owns the `Assistant` object's
 * storage, and every interface (the chat's tools, the Mini App) reaches the same data through these RPC methods. Today
 * that is the todos. There is one, named `OWNER`. Every write is idempotent: an add names its id, and an update sets
 * values, so a caller may retry any of them.
 */
export class UserStore extends DurableObject<Env> implements OwnerTodos {
  readonly #db = drizzle(this.ctx.storage);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Applies the migrations drizzle-kit generated into `drizzle/` before the object serves any call.
    void ctx.blockConcurrencyWhile(() => migrate(this.#db, migrations));
  }

  /** Open todos first, soonest due first, undated last; then oldest first. */
  list(filter: TodoFilter = "open"): Todo[] {
    return this.#db
      .select()
      .from(todos)
      .where(FILTERS[filter])
      .orderBy(
        isNotNull(todos.completedAt),
        isNull(todos.dueAt),
        asc(todos.dueAt),
        asc(todos.createdAt),
        asc(todos.id),
      )
      .all();
  }

  /** Adds the todo, or returns the one already stored under its id. */
  add(todo: NewTodo): Todo {
    this.#db
      .insert(todos)
      .values({ ...todo, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();

    return this.#db.select().from(todos).where(eq(todos.id, todo.id)).get()!;
  }

  /** Applies the changes; null when no todo has this id. Completing a done todo keeps its completion time. */
  update(id: string, changes: TodoChanges): Todo | null {
    const completedAt =
      changes.done === undefined
        ? todos.completedAt
        : changes.done
          ? sql`coalesce(${todos.completedAt}, ${Date.now()})`
          : null;

    // `set` skips the fields left undefined; `completedAt` is always set, so the update is never empty.
    const updated = this.#db
      .update(todos)
      .set({ title: changes.title, notes: changes.notes, dueAt: changes.dueAt, completedAt })
      .where(eq(todos.id, id))
      .returning()
      .get();

    return updated ?? null;
  }

  /** Deletes the todo; false when no todo has this id. */
  remove(id: string): boolean {
    const deleted = this.#db
      .delete(todos)
      .where(eq(todos.id, id))
      .returning({ id: todos.id })
      .all();

    return deleted.length > 0;
  }
}
