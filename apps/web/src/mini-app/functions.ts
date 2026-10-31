import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { launchData } from "@/lib/telegram";
import type { Schedule } from "assistant/schedule";
import type { Todo } from "assistant/user-store";
import { copyRecurrence } from "utils/recurrence";
import { authorizeOwner, owner } from "./owner.server.ts";

/** Sends Telegram's `initData` with every call; the server refuses any not signed for the owner. */
const ownerOnly = createMiddleware({ type: "function" })
  .client(({ next }) => next({ headers: { Authorization: `tma ${launchData()}` } }))
  .server(async ({ next }) => {
    await authorizeOwner(getRequestHeader("authorization"));

    return next();
  });

// Limits match the chat's tools, so the app accepts what the chat accepts.
const Title = Type.String({ minLength: 1, maxLength: 500 });
const Notes = Type.Union([Type.String({ maxLength: 10_000 }), Type.Null()]);
const DueAt = Type.Union([Type.Integer(), Type.Null()]);
const Id = Type.String({ minLength: 1, maxLength: 200 });

/** Ids the app chooses, kept apart from the `todo:<task id>` ones the chat's tools derive. */
const NewTodoInput = Type.Object({
  id: Type.String({ pattern: "^todo:app:[\\w-]{1,100}$" }),
  title: Title,
  notes: Notes,
  dueAt: DueAt,
});

const TodoUpdateInput = Type.Object({
  id: Id,
  changes: Type.Object({
    title: Type.Optional(Title),
    notes: Type.Optional(Notes),
    dueAt: Type.Optional(DueAt),
    done: Type.Optional(Type.Boolean()),
  }),
});

const IdInput = Type.Object({ id: Id });

const Timezone = Type.String({ minLength: 1, maxLength: 100 });

const ScheduleInput = Type.Object({
  id: Type.String({ pattern: "^schedule:owner:[\\w-]{1,100}$" }),
  instruction: Type.String({ minLength: 1, maxLength: 100_000 }),
  // Absent for a cron recurrence, whose first run is its first match.
  at: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  recurrence: Type.Optional(
    Type.Union([
      Type.Object({
        cadence: Type.Object({
          unit: Type.Union([
            Type.Literal("minute"),
            Type.Literal("hour"),
            Type.Literal("day"),
            Type.Literal("week"),
            Type.Literal("month"),
          ]),
          interval: Type.Integer({ minimum: 1, maximum: 10_000 }),
        }),
        timezone: Timezone,
      }),
      Type.Object({ cron: Type.String({ minLength: 9, maxLength: 200 }), timezone: Timezone }),
    ]),
  ),
});

/** A plain copy: RPC results carry `Symbol.dispose` disposers, which are not sent to the browser. */
const plainTodo = (todo: Todo): Todo => ({
  id: todo.id,
  title: todo.title,
  notes: todo.notes,
  dueAt: todo.dueAt,
  createdAt: todo.createdAt,
  completedAt: todo.completedAt,
});

const plainSchedule = (schedule: Schedule): Schedule => {
  const copy = { id: schedule.id, instruction: schedule.instruction, runAt: schedule.runAt };

  if (schedule.recurrence === undefined) return copy;

  return { ...copy, recurrence: copyRecurrence(schedule.recurrence) };
};

/** Every todo, open ones first, soonest due first. */
export const listTodos = createServerFn({ method: "GET" })
  .middleware([ownerOnly])
  .handler(async () => (await owner().listTodos("all")).map(plainTodo));

export const addTodo = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof NewTodoInput>) => Value.Parse(NewTodoInput, input))
  .handler(async ({ data }) => plainTodo(await owner().addTodo(data)));

export const updateTodo = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof TodoUpdateInput>) => Value.Parse(TodoUpdateInput, input))
  .handler(async ({ data }) => {
    const updated = await owner().updateTodo(data.id, data.changes);

    if (updated === null) throw new Error(`No todo has id ${data.id}`);

    return plainTodo(updated);
  });

export const deleteTodo = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IdInput>) => Value.Parse(IdInput, input))
  .handler(async ({ data }) => owner().removeTodo(data.id));

/** The chat's scheduled instructions still to be delivered, soonest first. */
export const listSchedules = createServerFn({ method: "GET" })
  .middleware([ownerOnly])
  .handler(async () => (await owner().listSchedules()).map(plainSchedule));

export const addSchedule = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof ScheduleInput>) => Value.Parse(ScheduleInput, input))
  .handler(async ({ data }) => plainSchedule(await owner().addSchedule(data)));

export const cancelSchedule = createServerFn({ method: "POST" })
  .middleware([ownerOnly])
  .validator((input: Static<typeof IdInput>) => Value.Parse(IdInput, input))
  .handler(async ({ data }) => owner().cancelSchedule(data.id));
