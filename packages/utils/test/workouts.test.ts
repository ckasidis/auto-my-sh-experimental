import { describe, expect, it } from "vite-plus/test";
import { exerciseHistory, exerciseStats, formatSets } from "../src/workouts.ts";

const entries = [
  { exerciseId: "squat", date: "2026-11-05", sets: 2, reps: 12 },
  { exerciseId: "push", date: "2026-11-05", sets: 5, reps: 20 },
  { exerciseId: "squat", date: "2026-11-01", sets: 3, reps: 10 },
  { exerciseId: "squat", date: "2026-11-05", sets: 1, reps: 8 },
];

describe("exercise history", () => {
  it("totals each day the exercise was done, oldest first", () => {
    expect(exerciseHistory(entries, "squat")).toEqual([
      { date: "2026-11-01", sets: 3, reps: 30, bestSet: 10 },
      { date: "2026-11-05", sets: 3, reps: 32, bestSet: 12 },
    ]);
  });

  it("totals the whole history", () => {
    expect(exerciseStats(exerciseHistory(entries, "squat"))).toEqual({
      days: 2,
      sets: 6,
      reps: 62,
      bestSet: 12,
      lastDate: "2026-11-05",
    });
    expect(exerciseStats([])).toEqual({ days: 0, sets: 0, reps: 0, bestSet: 0, lastDate: null });
  });

  it("formats sets of reps", () => {
    expect(formatSets({ sets: 3, reps: 10 })).toBe("3 × 10");
  });
});
