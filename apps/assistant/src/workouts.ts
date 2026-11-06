import { Type } from "@earendil-works/pi-ai";
import { defineExtension, section, type ToolRegistration } from "@earendil-works/pi-durable";
import { exerciseHistory, exerciseStats, formatSets } from "utils/workouts";
import { userStore } from "./user-store.ts";
import {
  type Exercise,
  MAX_REPS,
  MAX_SETS,
  type OwnerWorkouts,
  type WorkoutEntry,
} from "./workout-log.ts";

const Id = Type.String({ minLength: 1 });
const Name = Type.String({ minLength: 1, maxLength: 200 });

const ExerciseId = Type.String({
  minLength: 1,
  description: "An id from list_exercises or add_exercise",
});

const CalendarDate = Type.String({
  description: "A calendar date in the owner's timezone, YYYY-MM-DD",
});

const Sets = Type.Integer({ minimum: 1, maximum: MAX_SETS });
const Reps = Type.Integer({ minimum: 1, maximum: MAX_REPS, description: "In each set" });

/**
 * A plain copy of a stored value. Results of Workers RPC carry a `Symbol.dispose` disposer, on every array and object,
 * and Pi refuses tool details that are not strict JSON; these values are JSON already, and the round trip drops the
 * disposers.
 */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const textResult = <T>(text: string, details: T | null) => ({
  output: [{ type: "text" as const, text }],
  details: details === null ? null : plain(details),
});

const formatExercise = (exercise: Exercise) => `- ${exercise.name} (id: ${exercise.id})`;

function formatEntry(entry: WorkoutEntry, exercisesById: ReadonlyMap<string, Exercise>): string {
  const name = exercisesById.get(entry.exerciseId)?.name ?? entry.exerciseId;

  return `- ${entry.date} ${name}: ${formatSets(entry)} (id: ${entry.id}, exercise id: ${entry.exerciseId})`;
}

const byId = (exercises: readonly Exercise[]) =>
  new Map(exercises.map((exercise) => [exercise.id, exercise]));

type IdArguments = { readonly id: string };

type NameArguments = { readonly name: string };

type RenameArguments = IdArguments & NameArguments;

type RangeArguments = { readonly from: string; readonly to: string };

type LogArguments = {
  readonly exerciseId: string;
  readonly date: string;
  readonly sets: number;
  readonly reps: number;
};

type UpdateEntryArguments = IdArguments & Partial<LogArguments>;

/**
 * The chat's tools over the owner's exercises and workout log. `store` resolves the store on each call, so a tool
 * reaches the `UserStore` Durable Object only when it runs. Each is safe to replay: an add's id is derived from its
 * tool task.
 */
export function createWorkoutTools(store: () => OwnerWorkouts): ToolRegistration[] {
  return [
    {
      name: "list_exercises",
      description: "List the owner's exercises by name, with ids.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => {
        const list = await store().listExercises();

        return textResult(
          list.length === 0 ? "No exercises." : list.map(formatExercise).join("\n"),
          list,
        );
      },
    },
    {
      name: "add_exercise",
      description: "Add an exercise. Adding a name that exists returns the existing exercise.",
      parameters: Type.Object({ name: Name }),
      replay: "safe",
      execute: async (args: NameArguments, api) => {
        const id = `exercise:${api.taskId}`;
        const added = await store().addExercise({ id, name: args.name.trim() });
        const verb = added.id === id ? "Added" : "Already exists";

        return textResult(`${verb}:\n${formatExercise(added)}`, added);
      },
    },
    {
      name: "rename_exercise",
      description: "Rename an exercise by id. Its history is kept.",
      parameters: Type.Object({ id: Id, name: Name }),
      replay: "safe",
      execute: async (args: RenameArguments) => {
        const renamed = await store().renameExercise(args.id, args.name.trim());

        if (renamed === null) throw new Error(`No exercise has id ${args.id}`);

        return textResult(`Renamed:\n${formatExercise(renamed)}`, renamed);
      },
    },
    {
      name: "delete_exercise",
      description: "Delete an exercise by id, and its whole history. Confirm with the owner first.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removeExercise(args.id);

        return textResult(removed ? `Deleted ${args.id}.` : `No exercise has id ${args.id}.`, null);
      },
    },
    {
      name: "log_workout",
      description:
        "Log an exercise done on a day as sets of the same number of reps (3 × 10). Log sets with different reps as separate entries.",
      parameters: Type.Object({
        exerciseId: ExerciseId,
        date: CalendarDate,
        sets: Sets,
        reps: Reps,
      }),
      replay: "safe",
      execute: async (args: LogArguments, api) => {
        const logged = await store().addWorkoutEntry({ id: `workout:${api.taskId}`, ...args });
        const exercises = await store().listExercises();

        return textResult(`Logged:\n${formatEntry(logged, byId(exercises))}`, logged);
      },
    },
    {
      name: "list_workouts",
      description:
        "List the workout log from one date to another, inclusive, newest day first, with ids.",
      parameters: Type.Object({ from: CalendarDate, to: CalendarDate }),
      replay: "safe",
      execute: async (args: RangeArguments) => {
        const [list, exercises] = await Promise.all([
          store().listWorkoutEntries(args),
          store().listExercises(),
        ]);

        if (list.length === 0) {
          return textResult(`Nothing logged from ${args.from} to ${args.to}.`, list);
        }

        const exercisesById = byId(exercises);

        return textResult(list.map((entry) => formatEntry(entry, exercisesById)).join("\n"), list);
      },
    },
    {
      name: "update_workout",
      description: "Change a logged entry's exercise, date, sets or reps.",
      parameters: Type.Object({
        id: Id,
        exerciseId: Type.Optional(ExerciseId),
        date: Type.Optional(CalendarDate),
        sets: Type.Optional(Sets),
        reps: Type.Optional(Reps),
      }),
      replay: "safe",
      execute: async (args: UpdateEntryArguments) => {
        const updated = await store().updateWorkoutEntry(args.id, {
          exerciseId: args.exerciseId,
          date: args.date,
          sets: args.sets,
          reps: args.reps,
        });

        if (updated === null) throw new Error(`No entry has id ${args.id}`);

        const exercises = await store().listExercises();

        return textResult(`Updated:\n${formatEntry(updated, byId(exercises))}`, updated);
      },
    },
    {
      name: "delete_workout",
      description: "Delete a logged entry by id.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removeWorkoutEntry(args.id);

        return textResult(removed ? `Deleted ${args.id}.` : `No entry has id ${args.id}.`, null);
      },
    },
    {
      name: "exercise_history",
      description:
        "An exercise's history: each day it was done with its sets and total reps, and its totals and best set.",
      parameters: Type.Object({ exerciseId: ExerciseId }),
      replay: "safe",
      execute: async (args: { readonly exerciseId: string }) => {
        const [entries, exercises] = await Promise.all([
          store().listWorkoutEntries({ exerciseId: args.exerciseId }),
          store().listExercises(),
        ]);

        const exercise = exercises.find(({ id }) => id === args.exerciseId);

        if (exercise === undefined) throw new Error(`No exercise has id ${args.exerciseId}`);

        const history = exerciseHistory(entries, exercise.id);
        const stats = exerciseStats(history);

        if (history.length === 0) {
          return textResult(`${exercise.name} has not been logged.`, { history, stats });
        }

        const days = history.map(
          (day) =>
            `- ${day.date}: ${day.sets} sets, ${day.reps} reps, best set ${day.bestSet} reps`,
        );

        return textResult(
          [
            `${exercise.name}: ${stats.days} days, ${stats.sets} sets, ${stats.reps} reps, best set ${stats.bestSet} reps, last ${stats.lastDate}`,
            ...days,
          ].join("\n"),
          { history, stats },
        );
      },
    },
  ];
}

const WORKOUTS = `The owner keeps a workout log of exercises done as sets and reps, which you manage with the workout tools.

- Before log_workout, call list_exercises and add_exercise when the exercise is missing; reuse an existing one for the same movement ("push ups" is "Push-up").
- An entry is one exercise on one day as sets of the same reps: "3 sets of 10" is sets 3, reps 10. Log sets with different reps ("10, 8, 6") as one entry each. Dates are YYYY-MM-DD in the owner's timezone; "today" and similar are worked out from the current time.
- Weights and durations are not tracked.`;

/** The owner's workout log, kept in the `UserStore` object the Mini App also reads. */
export const workoutsExtension = defineExtension({
  name: "workouts",
  tools: createWorkoutTools(userStore),
  sections: [section("workouts", () => WORKOUTS, { tag: false })],
});
