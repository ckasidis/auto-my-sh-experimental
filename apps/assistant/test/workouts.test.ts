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
import type { UserStore } from "../src/user-store.ts";
import type {
  Exercise,
  OwnerWorkouts,
  SessionSet,
  WorkoutPlan,
  WorkoutSession,
} from "../src/workout-log.ts";
import { createWorkoutTools } from "../src/workouts.ts";
import { memoryStore, withDisposer } from "./memory-store.ts";

/* Copies of stored values marked as Workers RPC marks a result: every array and object carries a disposer. */
const rpcExercise = (exercise: Exercise) => withDisposer({ ...exercise });

const rpcPlan = (plan: WorkoutPlan) =>
  withDisposer({
    ...plan,
    exercises: withDisposer(plan.exercises.map((line) => withDisposer({ ...line }))),
  });

const rpcSession = (session: WorkoutSession) =>
  withDisposer({
    ...session,
    sets: withDisposer(session.sets.map((set) => withDisposer({ ...set }))),
  });

const orNull = <T, R>(value: T | null, mark: (value: T) => R) =>
  value === null ? null : mark(value);

/** The store as the tools see it over RPC in production, where every result carries disposers. */
const overRpc = (store: UserStore): OwnerWorkouts => ({
  listExercises: () => withDisposer(store.listExercises().map(rpcExercise)),
  addExercise: (exercise) => rpcExercise(store.addExercise(exercise)),
  renameExercise: (id, name) => orNull(store.renameExercise(id, name), rpcExercise),
  removeExercise: (id) => store.removeExercise(id),
  listPlans: () => withDisposer(store.listPlans().map(rpcPlan)),
  addPlan: (plan) => rpcPlan(store.addPlan(plan)),
  updatePlan: (id, changes) => orNull(store.updatePlan(id, changes), rpcPlan),
  removePlan: (id) => store.removePlan(id),
  listSessions: (filter) => withDisposer(store.listSessions(filter).map(rpcSession)),
  addSession: (session) => rpcSession(store.addSession(session)),
  updateSession: (id, changes) => orNull(store.updateSession(id, changes), rpcSession),
  removeSession: (id) => store.removeSession(id),
});

const set = (
  exerciseId: string,
  reps: number,
  weight: number | null,
  warmup = false,
): SessionSet => ({
  exerciseId,
  reps,
  weight,
  warmup,
});

/** A store with squats and push-ups, and a plan of both. */
function stocked() {
  const store = memoryStore();

  store.addExercise({ id: "squat", name: "Squat" });
  store.addExercise({ id: "push", name: "Push-up" });
  store.addPlan({
    id: "legs",
    name: "Legs",
    exercises: [
      { exerciseId: "squat", sets: 3 },
      { exerciseId: "push", sets: 2 },
    ],
  });

  return store;
}

describe("workout log", () => {
  it("keeps one exercise per name", () => {
    const store = memoryStore();

    store.addExercise({ id: "squat", name: "Squat" });
    expect(store.addExercise({ id: "again", name: " squat " }).id).toBe("squat");
    store.addExercise({ id: "push", name: "push-up" });
    expect(store.listExercises().map(({ name }) => name)).toEqual(["push-up", "Squat"]);
    expect(() => store.renameExercise("push", "SQUAT")).toThrow("already exists");
    expect(store.renameExercise("push", "Push-up")).toMatchObject({ name: "Push-up" });
    expect(store.renameExercise("missing", "x")).toBeNull();
  });

  it("keeps plans with their exercises in order, and checks them", () => {
    const store = stocked();

    expect(store.listPlans()).toEqual([
      expect.objectContaining({
        id: "legs",
        name: "Legs",
        exercises: [
          { exerciseId: "squat", sets: 3 },
          { exerciseId: "push", sets: 2 },
        ],
      }),
    ]);
    expect(store.addPlan({ id: "legs", name: "Other", exercises: [] }).name).toBe("Legs");
    expect(
      store.updatePlan("legs", { exercises: [{ exerciseId: "push", sets: 4 }] })?.exercises,
    ).toEqual([{ exerciseId: "push", sets: 4 }]);
    expect(store.updatePlan("legs", { name: "Leg day" })).toMatchObject({
      name: "Leg day",
      exercises: [{ exerciseId: "push", sets: 4 }],
    });
    expect(() =>
      store.updatePlan("legs", {
        exercises: [
          { exerciseId: "push", sets: 1 },
          { exerciseId: "push", sets: 1 },
        ],
      }),
    ).toThrow("each exercise once");
    expect(() =>
      store.updatePlan("legs", { exercises: [{ exerciseId: "push", sets: 0 }] }),
    ).toThrow("sets");
    expect(() =>
      store.updatePlan("legs", { exercises: [{ exerciseId: "nope", sets: 1 }] }),
    ).toThrow("No exercise has id nope");
    expect(store.updatePlan("missing", { name: "x" })).toBeNull();
  });

  it("logs sessions with their sets in order, newest first, and checks them", () => {
    const store = stocked();

    store.addSession({
      id: "monday",
      date: "2026-11-02",
      planId: "legs",
      sets: [set("squat", 10, 20, true), set("squat", 8, 60), set("push", 15, null)],
    });
    store.addSession({
      id: "friday",
      date: "2026-11-06",
      planId: null,
      sets: [set("push", 20, null)],
    });

    expect(store.listSessions().map(({ id }) => id)).toEqual(["friday", "monday"]);
    expect(store.listSessions({ exerciseId: "squat" })).toEqual([
      expect.objectContaining({
        id: "monday",
        planId: "legs",
        sets: [set("squat", 10, 20, true), set("squat", 8, 60), set("push", 15, null)],
      }),
    ]);
    expect(
      store.listSessions({ from: "2026-11-03", to: "2026-11-08" }).map(({ id }) => id),
    ).toEqual(["friday"]);

    expect(() => store.addSession({ id: "x", date: "2026-11-06", planId: null, sets: [] })).toThrow(
      "at least one set",
    );
    expect(() =>
      store.addSession({ id: "x", date: "2026-11-06", planId: null, sets: [set("push", 0, null)] }),
    ).toThrow("reps");
    expect(() =>
      store.addSession({ id: "x", date: "2026-11-06", planId: null, sets: [set("push", 1, -5)] }),
    ).toThrow("weight");
    expect(
      store.addSession({
        id: "x",
        date: "2026-11-07",
        planId: "gone",
        sets: [set("push", 1, null)],
      }).planId,
    ).toBeNull();

    expect(store.updateSession("friday", { sets: [set("push", 25, 10)] })?.sets).toEqual([
      set("push", 25, 10),
    ]);
    expect(store.updateSession("friday", { date: "2026-11-05" })).toMatchObject({
      date: "2026-11-05",
      sets: [set("push", 25, 10)],
    });
    expect(store.updateSession("missing", { date: "2026-11-05" })).toBeNull();
    expect(store.removeSession("friday")).toBe(true);
    expect(store.removeSession("friday")).toBe(false);
  });

  it("keeps the sessions of a deleted plan", () => {
    const store = stocked();

    store.addSession({
      id: "monday",
      date: "2026-11-02",
      planId: "legs",
      sets: [set("push", 1, null)],
    });
    expect(store.removePlan("legs")).toBe(true);
    expect(store.listPlans()).toEqual([]);
    expect(store.listSessions()).toEqual([expect.objectContaining({ id: "monday", planId: null })]);
  });

  it("takes a deleted exercise out of plans and sessions, and deletes a session left empty", () => {
    const store = stocked();

    store.addSession({
      id: "both",
      date: "2026-11-02",
      planId: "legs",
      sets: [set("squat", 8, 60), set("push", 15, null)],
    });
    store.addSession({
      id: "squats",
      date: "2026-11-03",
      planId: null,
      sets: [set("squat", 5, 80)],
    });

    expect(store.removeExercise("squat")).toBe(true);
    expect(store.listPlans()[0]!.exercises).toEqual([{ exerciseId: "push", sets: 2 }]);
    expect(store.listSessions()).toEqual([
      expect.objectContaining({ id: "both", sets: [set("push", 15, null)] }),
    ]);
    expect(store.removeExercise("squat")).toBe(false);
  });
});

describe("workout tools", () => {
  it("adds an exercise and a plan, logs a session, and gives the history over RPC", async () => {
    const context = BACKGROUND_CONTEXT;
    const store = memoryStore();
    const tools = createWorkoutTools(() => overRpc(store));
    const faux = fauxProvider();

    store.addExercise({ id: "squat", name: "Squat" });
    store.addSession({ id: "old", date: "2026-11-01", planId: null, sets: [set("squat", 10, 50)] });

    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("add_exercise", { name: "squat" }),
          fauxToolCall("add_plan", { name: "Legs", exercises: [{ exerciseId: "squat", sets: 3 }] }),
        ],
        { stopReason: "toolUse" },
      ),
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("log_workout", {
              date: "2026-11-05",
              planId: store.listPlans()[0]!.id,
              sets: [
                { exerciseId: "squat", reps: 10, weight: 20, warmup: true },
                { exerciseId: "squat", reps: 8, weight: 60 },
                { exerciseId: "squat", reps: 6, weight: 62.5 },
              ],
            }),
          ],
          { stopReason: "toolUse" },
        ),
      fauxAssistantMessage(
        [
          fauxToolCall("exercise_history", { exerciseId: "squat" }),
          fauxToolCall("list_workouts", { from: "2026-11-05", to: "2026-11-05" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Logged.")]),
    ]);

    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    registry.install(defineExtension({ name: "workouts", tools }));
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);

    try {
      const root = await harness.root(context);
      await root.configure({ model: { provider: "faux", modelId: "faux-1" }, tools }, context);
      const submission = await root.submit({ type: "input", content: "Log squats" }, context);
      await submission.wait(context);

      const results = (await root.context(context)).messages.flatMap((message) =>
        message.role === "toolResult" ? [message] : [],
      );

      expect(results.map(({ toolName, isError }) => ({ toolName, isError }))).toEqual([
        { toolName: "add_exercise", isError: false },
        { toolName: "add_plan", isError: false },
        { toolName: "log_workout", isError: false },
        { toolName: "exercise_history", isError: false },
        { toolName: "list_workouts", isError: false },
      ]);

      const text = (index: number) =>
        results[index]!.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(
          "",
        );

      expect(text(0)).toBe("Already exists:\n- Squat (id: squat)");
      expect(text(1)).toMatch(
        /^Added:\n- Legs \(id: plan:[^)]+\)\n  - Squat: 3 sets \(exercise id: squat\)$/,
      );
      expect(text(3)).toBe(
        [
          "Squat: 2 sessions, 3 sets, 24 reps, volume 1355 kg, top 62.5 kg, most reps in a set 10, last 2026-11-05",
          "- 2026-11-01: 1 sets, 10 reps, volume 500 kg, top 50 kg",
          "- 2026-11-05: 2 sets, 14 reps, volume 855 kg, top 62.5 kg",
        ].join("\n"),
      );
      expect(text(4)).toMatch(
        /^- 2026-11-05 \(id: session:[^)]+\)\n  - Squat: warm-up 20 kg × 10, 60 kg × 8, 62.5 kg × 6$/,
      );
      expect(store.listSessions()[0]!.planId).toBe(store.listPlans()[0]!.id);
    } finally {
      await harness.close(context);
    }
  });
});
