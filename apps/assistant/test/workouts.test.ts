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
import type { Exercise, OwnerWorkouts, WorkoutEntry } from "../src/workout-log.ts";
import { createWorkoutTools } from "../src/workouts.ts";
import { memoryStore, withDisposer } from "./memory-store.ts";

/* Copies of stored values marked as Workers RPC marks a result: every array and object carries a disposer. */
const rpcExercise = (exercise: Exercise) => withDisposer({ ...exercise });

const rpcEntry = (entry: WorkoutEntry) => withDisposer({ ...entry });

const orNull = <T, R>(value: T | null, mark: (value: T) => R) =>
  value === null ? null : mark(value);

/** The store as the tools see it over RPC in production, where every result carries disposers. */
const overRpc = (store: UserStore): OwnerWorkouts => ({
  listExercises: () => withDisposer(store.listExercises().map(rpcExercise)),
  addExercise: (exercise) => rpcExercise(store.addExercise(exercise)),
  renameExercise: (id, name) => orNull(store.renameExercise(id, name), rpcExercise),
  removeExercise: (id) => store.removeExercise(id),
  listWorkoutEntries: (filter) => withDisposer(store.listWorkoutEntries(filter).map(rpcEntry)),
  addWorkoutEntry: (entry) => rpcEntry(store.addWorkoutEntry(entry)),
  updateWorkoutEntry: (id, changes) => orNull(store.updateWorkoutEntry(id, changes), rpcEntry),
  removeWorkoutEntry: (id) => store.removeWorkoutEntry(id),
});

const entry = (id: string, exerciseId: string, date: string, sets: number, reps: number) => ({
  id,
  exerciseId,
  date,
  sets,
  reps,
});

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

  it("logs entries, lists them newest day first, and checks them", () => {
    const store = memoryStore();

    store.addExercise({ id: "squat", name: "Squat" });
    store.addExercise({ id: "push", name: "Push-up" });
    store.addWorkoutEntry(entry("a", "squat", "2026-11-01", 3, 10));
    store.addWorkoutEntry(entry("b", "push", "2026-11-03", 3, 15));
    store.addWorkoutEntry(entry("c", "squat", "2026-11-03", 2, 8));
    expect(store.addWorkoutEntry(entry("a", "push", "2026-11-09", 1, 1)).exerciseId).toBe("squat");

    expect(store.listWorkoutEntries().map(({ id }) => id)).toEqual(["b", "c", "a"]);
    expect(store.listWorkoutEntries({ exerciseId: "squat" }).map(({ id }) => id)).toEqual([
      "c",
      "a",
    ]);
    expect(
      store.listWorkoutEntries({ from: "2026-11-02", to: "2026-11-08" }).map(({ id }) => id),
    ).toEqual(["b", "c"]);

    expect(() => store.addWorkoutEntry(entry("d", "nope", "2026-11-03", 1, 1))).toThrow(
      "No exercise",
    );
    expect(() => store.addWorkoutEntry(entry("d", "push", "2026-02-30", 1, 1))).toThrow(
      "calendar date",
    );
    expect(() => store.addWorkoutEntry(entry("d", "push", "2026-11-03", 0, 1))).toThrow("sets");
    expect(() => store.addWorkoutEntry(entry("d", "push", "2026-11-03", 1, 2.5))).toThrow("reps");

    expect(store.updateWorkoutEntry("c", { reps: 12 })).toMatchObject({ sets: 2, reps: 12 });
    expect(store.updateWorkoutEntry("c", {})).toMatchObject({ reps: 12 });
    expect(store.updateWorkoutEntry("missing", { reps: 1 })).toBeNull();
    expect(store.removeWorkoutEntry("b")).toBe(true);
    expect(store.removeWorkoutEntry("b")).toBe(false);
  });

  it("deletes an exercise's entries with it", () => {
    const store = memoryStore();

    store.addExercise({ id: "squat", name: "Squat" });
    store.addWorkoutEntry(entry("a", "squat", "2026-11-01", 3, 10));
    expect(store.removeExercise("squat")).toBe(true);
    expect(store.listWorkoutEntries()).toEqual([]);
    expect(store.removeExercise("squat")).toBe(false);
  });
});

describe("workout tools", () => {
  it("adds an exercise, logs it, and gives its history over RPC", async () => {
    const context = BACKGROUND_CONTEXT;
    const store = memoryStore();
    const tools = createWorkoutTools(() => overRpc(store));
    const faux = fauxProvider();

    store.addExercise({ id: "squat", name: "Squat" });
    store.addWorkoutEntry(entry("old", "squat", "2026-11-01", 3, 10));

    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("add_exercise", { name: "squat" }), fauxToolCall("list_exercises", {})],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [
          fauxToolCall("log_workout", {
            exerciseId: "squat",
            date: "2026-11-05",
            sets: 2,
            reps: 12,
          }),
          fauxToolCall("log_workout", {
            exerciseId: "squat",
            date: "2026-11-05",
            sets: 1,
            reps: 8,
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
        { toolName: "list_exercises", isError: false },
        { toolName: "log_workout", isError: false },
        { toolName: "log_workout", isError: false },
        { toolName: "exercise_history", isError: false },
        { toolName: "list_workouts", isError: false },
      ]);

      const text = (index: number) =>
        results[index]!.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(
          "",
        );

      expect(text(0)).toBe("Already exists:\n- Squat (id: squat)");
      expect(text(4)).toBe(
        [
          "Squat: 2 days, 6 sets, 62 reps, best set 12 reps, last 2026-11-05",
          "- 2026-11-01: 3 sets, 30 reps, best set 10 reps",
          "- 2026-11-05: 3 sets, 32 reps, best set 12 reps",
        ].join("\n"),
      );
      expect(text(5)).toMatch(
        /^- 2026-11-05 Squat: 2 × 12 \(id: workout:[^,]+, exercise id: squat\)\n- 2026-11-05 Squat: 1 × 8 /,
      );
    } finally {
      await harness.close(context);
    }
  });
});
