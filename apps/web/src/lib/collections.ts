import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";
import { QueryClient } from "@tanstack/react-query";
import type { Schedule } from "assistant/schedule";
import type { Todo, TodoChanges } from "assistant/user-store";
import { isCron } from "utils/recurrence";
import {
  addSchedule,
  addTodo,
  cancelSchedule,
  deleteTodo,
  listSchedules,
  listTodos,
  updateTodo,
} from "@/mini-app/functions";

export const queryClient = new QueryClient();

/** The changes the store takes for a todo edited in the collection: completion is a flag, not a time. */
function todoChanges(changes: Partial<Todo>): TodoChanges {
  const result: { -readonly [K in keyof TodoChanges]: TodoChanges[K] } = {};

  if (changes.title !== undefined) result.title = changes.title;

  if (changes.notes !== undefined) result.notes = changes.notes;

  if (changes.dueAt !== undefined) result.dueAt = changes.dueAt;

  if (changes.completedAt !== undefined) result.done = changes.completedAt !== null;

  return result;
}

/**
 * The owner's todos, the same list the chat's tools change. Each write is applied at once and confirmed by a refetch;
 * a write the server refuses rolls back.
 */
export const todoCollection = createCollection(
  queryCollectionOptions({
    id: "todos",
    queryKey: ["todos"],
    queryFn: () => listTodos(),
    queryClient,
    getKey: (todo) => todo.id,
    onInsert: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ modified }) =>
          addTodo({
            data: {
              id: modified.id,
              title: modified.title,
              notes: modified.notes,
              dueAt: modified.dueAt,
            },
          }),
        ),
      );
      await collection.utils.refetch();
    },
    onUpdate: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original, changes }) =>
          updateTodo({ data: { id: original.id, changes: todoChanges(changes) } }),
        ),
      );
      await collection.utils.refetch();
    },
    onDelete: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original }) => deleteTodo({ data: { id: original.id } })),
      );
      await collection.utils.refetch();
    },
  }),
);

/**
 * The `addSchedule` request for a schedule inserted into the collection. A cron schedule sends no time: the server
 * finds its first match itself.
 */
function scheduleRequest(schedule: Schedule) {
  const request = { id: schedule.id, instruction: schedule.instruction };

  if (schedule.recurrence === undefined) {
    return { ...request, at: new Date(schedule.runAt).toISOString() };
  }

  if (isCron(schedule.recurrence)) return { ...request, recurrence: schedule.recurrence };

  return {
    ...request,
    at: new Date(schedule.runAt).toISOString(),
    recurrence: schedule.recurrence,
  };
}

/**
 * The chat's scheduled instructions still to be delivered. They also change on their own, as deliveries happen and
 * recurring ones renew, so the list is refreshed every half minute.
 */
export const scheduleCollection = createCollection(
  queryCollectionOptions({
    id: "schedules",
    queryKey: ["schedules"],
    queryFn: () => listSchedules(),
    queryClient,
    getKey: (schedule) => schedule.id,
    refetchInterval: 30_000,
    onInsert: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ modified }) =>
          addSchedule({ data: scheduleRequest(modified) }),
        ),
      );
      await collection.utils.refetch();
    },
    onDelete: async ({ transaction, collection }) => {
      await Promise.all(
        transaction.mutations.map(({ original }) => cancelSchedule({ data: { id: original.id } })),
      );
      await collection.utils.refetch();
    },
  }),
);
