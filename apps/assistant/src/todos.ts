import { Type } from "@earendil-works/pi-ai";
import { defineExtension, section, type ToolRegistration } from "@earendil-works/pi-durable";
import { parseOffsetDateTime } from "./lib/time.ts";
import { type OwnerTodos, type Todo, type TodoFilter, userStore } from "./user-store.ts";

const MAX_TITLE_CHARACTERS = 500;
const MAX_NOTES_CHARACTERS = 10_000;

const DUE_DESCRIPTION =
  "The todo's deadline: an ISO 8601 date-time with a timezone offset, e.g. 2026-11-02T09:00:00+08:00. Stored and listed only; nothing happens when it arrives. Not a reminder time";

function parseDue(due: string): number {
  const dueAt = parseOffsetDateTime(due);

  if (dueAt === null) {
    throw new Error("due must be an ISO 8601 date-time with a timezone offset");
  }

  return dueAt;
}

/** One todo as a Markdown task-list line the model can quote back, with the id the other tools take. */
function formatTodo(todo: Todo): string {
  const due = todo.dueAt === null ? "" : `, due ${new Date(todo.dueAt).toISOString()}`;
  const notes = todo.notes === null ? "" : ` — ${todo.notes}`;

  return `- [${todo.completedAt === null ? " " : "x"}] ${todo.title}${notes} (id: ${todo.id}${due})`;
}

/**
 * A plain copy of a todo. Results of Workers RPC carry a `Symbol.dispose` disposer, on the array and on each todo, and
 * Pi refuses tool details that are not strict JSON.
 */
const plainTodo = (todo: Todo): Todo => ({
  id: todo.id,
  title: todo.title,
  notes: todo.notes,
  dueAt: todo.dueAt,
  createdAt: todo.createdAt,
  completedAt: todo.completedAt,
});

const textResult = (text: string, details: Todo | Todo[] | null) => ({
  output: [{ type: "text" as const, text }],
  details:
    details === null ? null : Array.isArray(details) ? details.map(plainTodo) : plainTodo(details),
});

type AddTodoArguments = {
  readonly title: string;
  readonly notes?: string;
  readonly due?: string;
};

type ListTodosArguments = {
  readonly status?: TodoFilter;
};

type UpdateTodoArguments = {
  readonly id: string;
  readonly title?: string;
  readonly notes?: string | null;
  readonly due?: string | null;
  readonly done?: boolean;
};

type DeleteTodoArguments = {
  readonly id: string;
};

/**
 * The chat's tools over the owner's todos. `todos` resolves the store on each call, so a tool reaches the `UserStore`
 * Durable Object only when it runs. Each is safe to replay: an add's id is derived from its tool task.
 */
export function createTodoTools(todos: () => OwnerTodos): ToolRegistration[] {
  return [
    {
      name: "add_todo",
      description:
        "Add a todo: something the owner has to do, optionally with a due date (its deadline). A todo never notifies anyone; for a reminder, call schedule as well.",
      parameters: Type.Object({
        title: Type.String({ minLength: 1, maxLength: MAX_TITLE_CHARACTERS }),
        notes: Type.Optional(Type.String({ maxLength: MAX_NOTES_CHARACTERS })),
        due: Type.Optional(Type.String({ description: DUE_DESCRIPTION })),
      }),
      replay: "safe",
      execute: async (args: AddTodoArguments, api) => {
        const added = await todos().add({
          id: `todo:${api.taskId}`,
          title: args.title,
          notes: args.notes ?? null,
          dueAt: args.due === undefined ? null : parseDue(args.due),
        });

        return textResult(`Added:\n${formatTodo(added)}`, added);
      },
    },
    {
      name: "list_todos",
      description:
        "List the owner's todos, with each one's due date and id. Open todos by default. Use for what the owner has to do or what is due; scheduled reminders are listed by list_schedules.",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([Type.Literal("open"), Type.Literal("done"), Type.Literal("all")]),
        ),
      }),
      replay: "safe",
      execute: async (args: ListTodosArguments) => {
        const status = args.status ?? "open";
        const list = await todos().list(status);

        if (list.length === 0) {
          return textResult(status === "all" ? "No todos." : `No ${status} todos.`, list);
        }

        return textResult(list.map(formatTodo).join("\n"), list);
      },
    },
    {
      name: "update_todo",
      description:
        "Change a todo by id: mark it done or open again, rename it, or set its notes or due date (null clears them). This never changes a schedule: moving a due date leaves any reminder where it is.",
      parameters: Type.Object({
        id: Type.String({ minLength: 1 }),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_CHARACTERS })),
        notes: Type.Optional(
          Type.Union([Type.String({ maxLength: MAX_NOTES_CHARACTERS }), Type.Null()]),
        ),
        due: Type.Optional(
          Type.Union([Type.String({ description: DUE_DESCRIPTION }), Type.Null()]),
        ),
        done: Type.Optional(Type.Boolean()),
      }),
      replay: "safe",
      execute: async (args: UpdateTodoArguments) => {
        const updated = await todos().update(args.id, {
          title: args.title,
          notes: args.notes,
          dueAt: args.due === undefined || args.due === null ? args.due : parseDue(args.due),
          done: args.done,
        });

        if (updated === null) throw new Error(`No todo has id ${args.id}`);

        return textResult(`Updated:\n${formatTodo(updated)}`, updated);
      },
    },
    {
      name: "delete_todo",
      description: "Delete a todo by id. Prefer update_todo with done: true for a finished todo.",
      parameters: Type.Object({ id: Type.String({ minLength: 1 }) }),
      replay: "safe",
      execute: async (args: DeleteTodoArguments) => {
        const removed = await todos().remove(args.id);

        // A replayed delete finds nothing, so a missing todo is not an error.
        return textResult(removed ? `Deleted ${args.id}.` : `No todo has id ${args.id}.`, null);
      },
    },
  ];
}

const TODOS_AND_SCHEDULES = `Todos and schedules are different things; keep them apart.

- A todo is something the owner has to do. Its due date is the deadline, stored on the todo and shown when todos are listed. A due date never makes anything happen: no message is sent when it arrives or passes.
- A schedule is an instruction you carry out yourself at a set time, such as messaging the owner a reminder. Only the schedule tool makes something happen later.

Choose by what the owner asks for:
- Something to do, or a deadline ("add …", "I need to … by Friday"): add_todo, with due for the deadline. Do not schedule anything.
- Something to happen or be said later ("remind me …", "at 9 tell me …"): schedule. Do not add a todo.
- Both ("add … due Friday and remind me Thursday"): add_todo and schedule. The reminder time is its own time, not the due date unless the owner says so.

Never tell the owner a due date will remind them, and never present a todo without a schedule as a reminder. Changing or completing a todo does not change any schedule. For what the owner has to do or what is due, use list_todos; for reminders and other things set to happen later, use list_schedules.`;

/** The owner's todos, kept in the `UserStore` object the Mini App also reads, and how they differ from schedules. */
export const todosExtension = defineExtension({
  name: "todos",
  tools: createTodoTools(userStore),
  sections: [section("todos-and-schedules", () => TODOS_AND_SCHEDULES, { tag: false })],
});
