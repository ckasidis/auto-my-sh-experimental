import { describe, expect, it } from "vite-plus/test";
import {
  addedExerciseRows,
  DEFAULT_SETS,
  EMPTY_ROW,
  loadDraft,
  rowsToSets,
  setsToRows,
  startDraft,
} from "../src/lib/workouts.ts";

const row = (weight: string, reps: string) => ({ weight, reps });

describe("set rows", () => {
  it("records warm-ups then working sets, skipping empty rows", () => {
    expect(
      rowsToSets([
        {
          exerciseId: "squat",
          warmups: [row("20", "10")],
          sets: [row("60", "8"), EMPTY_ROW, row(" ", "12")],
        },
        { exerciseId: "push", warmups: [EMPTY_ROW], sets: [row("", "15")] },
      ]),
    ).toEqual([
      { exerciseId: "squat", warmup: true, reps: 10, weight: 20 },
      { exerciseId: "squat", warmup: false, reps: 8, weight: 60 },
      { exerciseId: "squat", warmup: false, reps: 12, weight: null },
      { exerciseId: "push", warmup: false, reps: 15, weight: null },
    ]);
  });

  it("refuses a row with a weight but no reps, or a weight that is not a number", () => {
    expect(rowsToSets([{ exerciseId: "squat", warmups: [], sets: [row("60", "")] }])).toBeNull();
    expect(rowsToSets([{ exerciseId: "squat", warmups: [], sets: [row("6o", "8")] }])).toBeNull();
    expect(rowsToSets([{ exerciseId: "squat", warmups: [], sets: [row("60", "8.5")] }])).toBeNull();
  });

  it("turns a session's sets back into rows by exercise", () => {
    expect(
      setsToRows([
        { exerciseId: "squat", warmup: true, reps: 10, weight: 20 },
        { exerciseId: "push", warmup: false, reps: 15, weight: null },
        { exerciseId: "squat", warmup: false, reps: 8, weight: 62.5 },
      ]),
    ).toEqual([
      { exerciseId: "squat", warmups: [row("20", "10")], sets: [row("62.5", "8")] },
      { exerciseId: "push", warmups: [], sets: [row("", "15")] },
    ]);
  });
});

describe("a workout from a plan", () => {
  it("has the plan's sets and the last session's warm-ups, without deleted exercises", () => {
    const plan = {
      id: "legs",
      name: "Legs",
      createdAt: 0,
      exercises: [
        { exerciseId: "squat", sets: 3 },
        { exerciseId: "gone", sets: 2 },
      ],
    };

    const sessions = [
      {
        id: "last",
        date: "2026-11-05",
        planId: "legs",
        createdAt: 1,
        sets: [
          { exerciseId: "squat", warmup: true, reps: 10, weight: 20 },
          { exerciseId: "squat", warmup: true, reps: 5, weight: 40 },
          { exerciseId: "squat", warmup: false, reps: 8, weight: 60 },
        ],
      },
    ];

    expect(startDraft(plan, "2026-11-06", sessions, new Set(["squat"]))).toEqual({
      planId: "legs",
      date: "2026-11-06",
      exercises: [
        {
          exerciseId: "squat",
          warmups: [EMPTY_ROW, EMPTY_ROW],
          sets: [EMPTY_ROW, EMPTY_ROW, EMPTY_ROW],
        },
      ],
    });
  });

  it("is none when there is no storage", () => {
    expect(loadDraft()).toBeNull();
  });
});

describe("an exercise added to a workout", () => {
  it("starts with as many rows as its newest session had, or the default for one never done", () => {
    const sessions = [
      {
        id: "s1",
        date: "2026-11-02",
        planId: null,
        createdAt: 1,
        sets: [
          { exerciseId: "curl", warmup: true, reps: 12, weight: 5 },
          { exerciseId: "curl", warmup: false, reps: 10, weight: 10 },
          { exerciseId: "curl", warmup: false, reps: 8, weight: 10 },
        ],
      },
    ];

    expect(addedExerciseRows("curl", sessions)).toEqual({
      exerciseId: "curl",
      warmups: [EMPTY_ROW],
      sets: [EMPTY_ROW, EMPTY_ROW],
    });
    expect(addedExerciseRows("row", sessions)).toEqual({
      exerciseId: "row",
      warmups: [],
      sets: Array.from({ length: DEFAULT_SETS }, () => EMPTY_ROW),
    });
  });
});
