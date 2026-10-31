import { DatabaseSync, type SQLInputValue } from "node:sqlite";
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
import { createTodoTools } from "../src/todos.ts";
import { type NewTodo, type TodoChanges, type TodoFilter, UserStore } from "../src/user-store.ts";

/**
 * A `UserStore` object on `node:sqlite`, standing in for Durable Object SQLite: the cursor methods Drizzle's
 * `durable-sqlite` driver reads (`toArray`, `next`, `raw`), `transactionSync`, and `blockConcurrencyWhile`.
 */
const memoryTodos = (): UserStore => {
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
const withDisposer = <T extends object>(value: T): T =>
  Object.assign(value, { [Symbol.dispose]: () => {} });

/**
 * The store as the tools see it over RPC in production: every array and todo it returns carries a disposer, so a tool
 * that passed them on as details would fault.
 */
const overRpc = (store: UserStore) => ({
  list: (filter?: TodoFilter) => withDisposer(store.list(filter).map(withDisposer)),
  add: (todo: NewTodo) => withDisposer(store.add(todo)),
  update: (id: string, changes: TodoChanges) => {
    const updated = store.update(id, changes);

    return updated === null ? null : withDisposer(updated);
  },
  remove: (id: string) => store.remove(id),
});

const todo = (id: string, title: string) => ({ id, title, notes: null, dueAt: null });

describe("UserStore", () => {
  it("adds a todo once per id", () => {
    const list = memoryTodos();

    const first = list.add(todo("a", "Buy milk"));

    expect(list.add(todo("a", "Something else"))).toEqual(first);
    expect(list.list()).toEqual([first]);
    expect(first).toMatchObject({ title: "Buy milk", notes: null, dueAt: null, completedAt: null });
  });

  it("lists open todos soonest due first and undated last", () => {
    const list = memoryTodos();

    list.add(todo("undated", "Undated"));
    list.add({ ...todo("later", "Later"), dueAt: 2_000 });
    list.add({ ...todo("sooner", "Sooner"), dueAt: 1_000 });
    list.add(todo("done", "Done"));
    list.update("done", { done: true });

    expect(list.list().map(({ id }) => id)).toEqual(["sooner", "later", "undated"]);
    expect(list.list("done").map(({ id }) => id)).toEqual(["done"]);
    expect(list.list("all").map(({ id }) => id)).toEqual(["sooner", "later", "undated", "done"]);
  });

  it("keeps fields an update leaves out and clears those set to null", () => {
    const list = memoryTodos();

    list.add({ id: "a", title: "Call mum", notes: "Sunday", dueAt: 1_000 });

    expect(list.update("a", { title: "Call mom" })).toMatchObject({
      title: "Call mom",
      notes: "Sunday",
      dueAt: 1_000,
    });
    expect(list.update("a", { notes: null, dueAt: null })).toMatchObject({
      title: "Call mom",
      notes: null,
      dueAt: null,
    });
    expect(list.update("missing", { done: true })).toBeNull();
  });

  it("keeps the first completion time when a todo is completed again, and reopens it", () => {
    const list = memoryTodos();

    list.add(todo("a", "Stretch"));
    const completedAt = list.update("a", { done: true })!.completedAt;

    expect(completedAt).toEqual(expect.any(Number));
    expect(list.update("a", { done: true })!.completedAt).toBe(completedAt);
    expect(list.update("a", { done: false })!.completedAt).toBeNull();
  });

  it("deletes a todo, and reports a missing one", () => {
    const list = memoryTodos();

    list.add(todo("a", "Stretch"));

    expect(list.remove("a")).toBe(true);
    expect(list.remove("a")).toBe(false);
    expect(list.list("all")).toEqual([]);
  });
});

describe("todo tools", () => {
  it("adds, completes and lists the owner's todos over RPC", async () => {
    const context = BACKGROUND_CONTEXT;
    const list = memoryTodos();
    const tools = createTodoTools(() => overRpc(list));
    const faux = fauxProvider();

    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("add_todo", { title: "Buy milk", due: "2026-11-02T09:00:00+08:00" })],
        { stopReason: "toolUse" },
      ),
      () => {
        const [added] = list.list();

        return fauxAssistantMessage(
          [
            fauxToolCall("update_todo", { id: added!.id, done: true }),
            fauxToolCall("list_todos", { status: "all" }),
          ],
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage([fauxText("Done.")]),
    ]);

    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    registry.install(defineExtension({ name: "todos", tools }));
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);

    try {
      const root = await harness.root(context);
      await root.configure({ model: { provider: "faux", modelId: "faux-1" }, tools }, context);
      const submission = await root.submit({ type: "input", content: "Add milk" }, context);
      await submission.wait(context);

      const results = (await root.context(context)).messages.filter(
        (message) => message.role === "toolResult",
      );

      expect(results.map(({ toolName, isError }) => ({ toolName, isError }))).toEqual([
        { toolName: "add_todo", isError: false },
        { toolName: "update_todo", isError: false },
        { toolName: "list_todos", isError: false },
      ]);
      expect(list.list("all")).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^todo:/),
          title: "Buy milk",
          dueAt: Date.parse("2026-11-02T01:00:00Z"),
          completedAt: expect.any(Number),
        }),
      ]);
    } finally {
      await harness.close(context);
    }
  });

  it("refuses a due date without a timezone offset", async () => {
    const tools = createTodoTools(() => memoryTodos());
    const add = tools.find(({ name }) => name === "add_todo")!;

    // SAFETY: the tool reads only `taskId` from its api.
    const api = { taskId: "t1" } as never;

    await expect(
      add.execute({ title: "x", due: "2026-11-02T09:00:00" }, api, BACKGROUND_CONTEXT),
    ).rejects.toThrow("timezone offset");
  });
});
