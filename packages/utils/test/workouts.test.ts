import { describe, expect, it } from "vite-plus/test";
import {
  exerciseHistory,
  exerciseStats,
  formatSet,
  previousSets,
  previousWarmups,
} from "../src/workouts.ts";

const set = (exerciseId: string, reps: number, weight: number | null, warmup = false) => ({
  exerciseId,
  reps,
  weight,
  warmup,
});

// Newest last here; the functions sort them.
const sessions = [
  {
    id: "first",
    date: "2026-11-01",
    createdAt: 1,
    sets: [
      set("squat", 10, 20, true),
      set("squat", 8, 60),
      set("squat", 8, 60),
      set("squat", 6, 65),
    ],
  },
  { id: "pushups", date: "2026-11-03", createdAt: 3, sets: [set("push", 20, null)] },
  {
    id: "second",
    date: "2026-11-03",
    createdAt: 2,
    sets: [set("squat", 9, 62.5), set("squat", 7, 62.5), set("push", 15, null)],
  },
  { id: "warmups", date: "2026-10-30", createdAt: 0, sets: [set("squat", 5, 40, true)] },
];

describe("exercise history", () => {
  it("totals each session's working sets, oldest first, leaving out warm-ups", () => {
    expect(exerciseHistory(sessions, "squat")).toEqual([
      {
        sessionId: "first",
        date: "2026-11-01",
        sets: 3,
        reps: 22,
        volume: 1350,
        topWeight: 65,
        bestReps: 8,
      },
      {
        sessionId: "second",
        date: "2026-11-03",
        sets: 2,
        reps: 16,
        volume: 1000,
        topWeight: 62.5,
        bestReps: 9,
      },
    ]);
    expect(exerciseHistory(sessions, "push")).toEqual([
      {
        sessionId: "second",
        date: "2026-11-03",
        sets: 1,
        reps: 15,
        volume: 0,
        topWeight: null,
        bestReps: 15,
      },
      {
        sessionId: "pushups",
        date: "2026-11-03",
        sets: 1,
        reps: 20,
        volume: 0,
        topWeight: null,
        bestReps: 20,
      },
    ]);
  });

  it("totals the whole history", () => {
    expect(exerciseStats(exerciseHistory(sessions, "squat"))).toEqual({
      sessions: 2,
      sets: 5,
      reps: 38,
      volume: 2350,
      topWeight: 65,
      bestReps: 9,
      lastDate: "2026-11-03",
    });
    expect(exerciseStats([])).toEqual({
      sessions: 0,
      sets: 0,
      reps: 0,
      volume: 0,
      topWeight: null,
      bestReps: 0,
      lastDate: null,
    });
  });
});

describe("previous sets", () => {
  it("gives each set as the newest session that had it did it, not the best", () => {
    // The last session did two working sets, so the third is from the one before.
    expect(previousSets(sessions, "squat", false, 4)).toEqual([
      set("squat", 9, 62.5),
      set("squat", 7, 62.5),
      set("squat", 6, 65),
      undefined,
    ]);
    expect(previousSets(sessions, "squat", true, 2)).toEqual([
      set("squat", 10, 20, true),
      undefined,
    ]);
    expect(previousSets(sessions, "deadlift", false, 1)).toEqual([undefined]);
  });

  it("counts the warm-ups of the exercise's newest session", () => {
    expect(previousWarmups(sessions, "squat")).toBe(0);
    expect(previousWarmups(sessions.slice(0, 1), "squat")).toBe(1);
    expect(previousWarmups(sessions, "deadlift")).toBe(0);
  });

  it("formats a set", () => {
    expect(formatSet({ reps: 8, weight: 62.5 })).toBe("62.5 kg × 8");
    expect(formatSet({ reps: 15, weight: null })).toBe("15 reps");
  });
});
