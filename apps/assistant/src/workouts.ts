import { Type } from "@earendil-works/pi-ai";
import { defineExtension, section, type ToolRegistration } from "@earendil-works/pi-durable";
import { exerciseHistory, exerciseStats, formatSet } from "utils/workouts";
import { userStore } from "./user-store.ts";
import {
  type Exercise,
  MAX_PLAN_SETS,
  MAX_REPS,
  MAX_SESSION_SETS,
  MAX_WEIGHT,
  type OwnerWorkouts,
  type PlanExercise,
  type SessionSet,
  type WorkoutPlan,
  type WorkoutSession,
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

const PlanExercises = Type.Array(
  Type.Object({
    exerciseId: ExerciseId,
    sets: Type.Integer({ minimum: 1, maximum: MAX_PLAN_SETS, description: "Working sets" }),
  }),
  { maxItems: 50, description: "In the order the workout goes through them; each exercise once" },
);

const Sets = Type.Array(
  Type.Object({
    exerciseId: ExerciseId,
    reps: Type.Integer({ minimum: 1, maximum: MAX_REPS }),
    weight: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: MAX_WEIGHT,
        description: "In kg. Omit for a set without added weight",
      }),
    ),
    warmup: Type.Optional(
      Type.Boolean({ description: "A warm-up set, kept in the history but not in the stats" }),
    ),
  }),
  { minItems: 1, maxItems: MAX_SESSION_SETS, description: "One entry per set, in the order done" },
);

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

type Names = ReadonlyMap<string, string>;

const namesOf = (exercises: readonly Exercise[]): Names =>
  new Map(exercises.map(({ id, name }) => [id, name]));

const formatExercise = (exercise: Exercise) => `- ${exercise.name} (id: ${exercise.id})`;

function formatPlan(plan: WorkoutPlan, names: Names): string {
  const lines = plan.exercises.map(
    ({ exerciseId, sets }) =>
      `  - ${names.get(exerciseId) ?? exerciseId}: ${sets} sets (exercise id: ${exerciseId})`,
  );

  return [`- ${plan.name} (id: ${plan.id})`, ...lines].join("\n");
}

/** A session with its sets under each exercise in the order first done, warm-ups marked. */
function formatSession(session: WorkoutSession, names: Names): string {
  const order = [...new Set(session.sets.map(({ exerciseId }) => exerciseId))];

  const lines = order.map((exerciseId) => {
    const sets = session.sets
      .filter((set) => set.exerciseId === exerciseId)
      .map((set) => (set.warmup ? `warm-up ${formatSet(set)}` : formatSet(set)));

    return `  - ${names.get(exerciseId) ?? exerciseId}: ${sets.join(", ")}`;
  });

  return [`- ${session.date} (id: ${session.id})`, ...lines].join("\n");
}

type IdArguments = { readonly id: string };

type NameArguments = { readonly name: string };

type RenameArguments = IdArguments & NameArguments;

type RangeArguments = { readonly from: string; readonly to: string };

type PlanArguments = NameArguments & { readonly exercises: readonly PlanExercise[] };

type UpdatePlanArguments = IdArguments & Partial<PlanArguments>;

type SetArguments = {
  readonly exerciseId: string;
  readonly reps: number;
  readonly weight?: number;
  readonly warmup?: boolean;
};

type LogArguments = {
  readonly date: string;
  readonly planId?: string;
  readonly sets: readonly SetArguments[];
};

type UpdateSessionArguments = IdArguments & {
  readonly date?: string;
  readonly sets?: readonly SetArguments[];
};

const toSets = (sets: readonly SetArguments[]): SessionSet[] =>
  sets.map((set) => ({
    exerciseId: set.exerciseId,
    reps: set.reps,
    weight: set.weight ?? null,
    warmup: set.warmup ?? false,
  }));

/**
 * The chat's tools over the owner's exercises, workout plans and logged sessions. `store` resolves the store on each
 * call, so a tool reaches the `UserStore` Durable Object only when it runs. Each is safe to replay: an add's id is
 * derived from its tool task.
 */
export function createWorkoutTools(store: () => OwnerWorkouts): ToolRegistration[] {
  const names = async () => namesOf(await store().listExercises());

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
      description:
        "Delete an exercise by id, with its whole history, and take it out of the plans. Confirm with the owner first.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removeExercise(args.id);

        return textResult(removed ? `Deleted ${args.id}.` : `No exercise has id ${args.id}.`, null);
      },
    },
    {
      name: "list_plans",
      description: "List the owner's workout plans with their exercises and sets, with ids.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => {
        const [list, exerciseNames] = await Promise.all([store().listPlans(), names()]);

        return textResult(
          list.length === 0
            ? "No plans."
            : list.map((plan) => formatPlan(plan, exerciseNames)).join("\n"),
          list,
        );
      },
    },
    {
      name: "add_plan",
      description:
        "Add a workout plan: a name and the exercises it goes through, with working sets.",
      parameters: Type.Object({ name: Name, exercises: PlanExercises }),
      replay: "safe",
      execute: async (args: PlanArguments, api) => {
        const added = await store().addPlan({
          id: `plan:${api.taskId}`,
          name: args.name.trim(),
          exercises: [...args.exercises],
        });

        return textResult(`Added:\n${formatPlan(added, await names())}`, added);
      },
    },
    {
      name: "update_plan",
      description:
        "Rename a workout plan, or replace its exercises: exercises lists them all, in order.",
      parameters: Type.Object({
        id: Id,
        name: Type.Optional(Name),
        exercises: Type.Optional(PlanExercises),
      }),
      replay: "safe",
      execute: async (args: UpdatePlanArguments) => {
        const updated = await store().updatePlan(args.id, {
          name: args.name?.trim(),
          exercises: args.exercises === undefined ? undefined : [...args.exercises],
        });

        if (updated === null) throw new Error(`No plan has id ${args.id}`);

        return textResult(`Updated:\n${formatPlan(updated, await names())}`, updated);
      },
    },
    {
      name: "delete_plan",
      description: "Delete a workout plan by id. The sessions done from it are kept.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removePlan(args.id);

        return textResult(removed ? `Deleted ${args.id}.` : `No plan has id ${args.id}.`, null);
      },
    },
    {
      name: "log_workout",
      description:
        "Log a workout session done on a day: every set, in order, with its reps and weight. 3 × 10 is three sets of 10.",
      parameters: Type.Object({
        date: CalendarDate,
        planId: Type.Optional(Type.String({ description: "The plan it was done from, if any" })),
        sets: Sets,
      }),
      replay: "safe",
      execute: async (args: LogArguments, api) => {
        const logged = await store().addSession({
          id: `session:${api.taskId}`,
          date: args.date,
          planId: args.planId ?? null,
          sets: toSets(args.sets),
        });

        return textResult(`Logged:\n${formatSession(logged, await names())}`, logged);
      },
    },
    {
      name: "list_workouts",
      description:
        "List the sessions logged from one date to another, inclusive, newest first, with their sets and ids.",
      parameters: Type.Object({ from: CalendarDate, to: CalendarDate }),
      replay: "safe",
      execute: async (args: RangeArguments) => {
        const [list, exerciseNames] = await Promise.all([store().listSessions(args), names()]);

        if (list.length === 0) {
          return textResult(`Nothing logged from ${args.from} to ${args.to}.`, list);
        }

        return textResult(
          list.map((session) => formatSession(session, exerciseNames)).join("\n"),
          list,
        );
      },
    },
    {
      name: "update_workout",
      description:
        "Move a logged session to another date, or replace its sets: sets lists them all, in order.",
      parameters: Type.Object({
        id: Id,
        date: Type.Optional(CalendarDate),
        sets: Type.Optional(Sets),
      }),
      replay: "safe",
      execute: async (args: UpdateSessionArguments) => {
        const updated = await store().updateSession(args.id, {
          date: args.date,
          sets: args.sets === undefined ? undefined : toSets(args.sets),
        });

        if (updated === null) throw new Error(`No session has id ${args.id}`);

        return textResult(`Updated:\n${formatSession(updated, await names())}`, updated);
      },
    },
    {
      name: "delete_workout",
      description: "Delete a logged session by id, with its sets.",
      parameters: Type.Object({ id: Id }),
      replay: "safe",
      execute: async (args: IdArguments) => {
        const removed = await store().removeSession(args.id);

        return textResult(removed ? `Deleted ${args.id}.` : `No session has id ${args.id}.`, null);
      },
    },
    {
      name: "exercise_history",
      description:
        "An exercise's history: each session's working sets, reps, volume and top weight, and the totals. Warm-ups are left out.",
      parameters: Type.Object({ exerciseId: ExerciseId }),
      replay: "safe",
      execute: async (args: { readonly exerciseId: string }) => {
        const [sessions, exercises] = await Promise.all([
          store().listSessions({ exerciseId: args.exerciseId }),
          store().listExercises(),
        ]);

        const exercise = exercises.find(({ id }) => id === args.exerciseId);

        if (exercise === undefined) throw new Error(`No exercise has id ${args.exerciseId}`);

        const history = exerciseHistory(sessions, exercise.id);
        const stats = exerciseStats(history);

        if (history.length === 0) {
          return textResult(`${exercise.name} has no working sets logged.`, { history, stats });
        }

        const top = (weight: number | null) =>
          weight === null ? "no added weight" : `${weight} kg`;

        const days = history.map(
          (session) =>
            `- ${session.date}: ${session.sets} sets, ${session.reps} reps, volume ${session.volume} kg, top ${top(session.topWeight)}`,
        );

        return textResult(
          [
            `${exercise.name}: ${stats.sessions} sessions, ${stats.sets} sets, ${stats.reps} reps, volume ${stats.volume} kg, top ${top(stats.topWeight)}, most reps in a set ${stats.bestReps}, last ${stats.lastDate}`,
            ...days,
          ].join("\n"),
          { history, stats },
        );
      },
    },
  ];
}

const WORKOUTS = `The owner keeps a workout log, which you manage with the workout tools: exercises, plans (a named list of exercises with working sets each), and sessions (the sets done on a day).

- Before add_plan or log_workout, call list_exercises and add_exercise when one is missing; reuse an existing one for the same movement ("push ups" is "Push-up").
- log_workout takes every set as its own entry: "3 × 10 at 60 kg" is three sets of 10 reps at 60. Weights are in kg; convert pounds (1 lb is 0.4536 kg). Omit weight for a set without added weight. Mark warm-up sets: they are kept in the history but left out of the stats.
- Dates are YYYY-MM-DD in the owner's timezone; "today" and similar are worked out from the current time.`;

/** The owner's workout log, kept in the `UserStore` object the Mini App also reads. */
export const workoutsExtension = defineExtension({
  name: "workouts",
  tools: createWorkoutTools(userStore),
  sections: [section("workouts", () => WORKOUTS, { tag: false })],
});
