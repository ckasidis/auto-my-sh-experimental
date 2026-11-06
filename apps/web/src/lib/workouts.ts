import type { SessionSet, WorkoutPlan, WorkoutSession } from "assistant/workout-log";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { formatSet, previousWarmups } from "utils/workouts";

// Limits match the store's.
export const MAX_PLAN_SETS = 20;
const MAX_REPS = 10_000;
const MAX_WEIGHT = 10_000;

/** A whole number from 1 to `max` typed in a field, or null for anything else. */
export const parseCount = (text: string, max: number) => {
  const value = Number(text);

  return text.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= max ? value : null;
};

const SetRow = Type.Object({ weight: Type.String(), reps: Type.String() });

const ExerciseRows = Type.Object({
  exerciseId: Type.String(),
  warmups: Type.Array(SetRow),
  sets: Type.Array(SetRow),
});

/** A set's fields as typed: empty for one not done. */
export type SetRow = Static<typeof SetRow>;

/** An exercise's warm-up and working sets as typed. */
export type ExerciseRows = Static<typeof ExerciseRows>;

export const EMPTY_ROW: SetRow = { weight: "", reps: "" };

/** A row with nothing typed: a set skipped. */
export const isSkipped = (row: SetRow) => row.weight.trim() === "" && row.reps.trim() === "";

/** The set a row records; undefined for a skipped one, null for one typed wrong. */
export function rowSet(row: SetRow): Omit<SessionSet, "exerciseId" | "warmup"> | null | undefined {
  if (isSkipped(row)) return undefined;

  const reps = parseCount(row.reps, MAX_REPS);
  const weight = row.weight.trim() === "" ? null : Number(row.weight);

  if (reps === null || (weight !== null && !(weight >= 0 && weight <= MAX_WEIGHT))) return null;

  return { reps, weight };
}

/**
 * The sets the rows record, each exercise's warm-ups and then its working sets, leaving out skipped rows; null when a
 * row is typed wrong.
 */
export function rowsToSets(exercises: readonly ExerciseRows[]): SessionSet[] | null {
  const sets: SessionSet[] = [];

  for (const { exerciseId, warmups, sets: working } of exercises) {
    for (const [warmup, rows] of [
      [true, warmups],
      [false, working],
    ] as const) {
      for (const row of rows) {
        const set = rowSet(row);

        if (set === null) return null;

        if (set !== undefined) sets.push({ exerciseId, warmup, ...set });
      }
    }
  }

  return sets;
}

/** A logged session's sets as rows to edit, under each exercise in the order first done. */
export function setsToRows(sets: readonly SessionSet[]): ExerciseRows[] {
  const order = [...new Set(sets.map(({ exerciseId }) => exerciseId))];

  const toRow = (set: SessionSet): SetRow => ({
    weight: set.weight === null ? "" : String(set.weight),
    reps: String(set.reps),
  });

  return order.map((exerciseId) => {
    const own = sets.filter((set) => set.exerciseId === exerciseId);

    return {
      exerciseId,
      warmups: own.flatMap((set) => (set.warmup ? [toRow(set)] : [])),
      sets: own.flatMap((set) => (set.warmup ? [] : [toRow(set)])),
    };
  });
}

/** "W 20 kg × 10, 60 kg × 8": an exercise's sets in a session, warm-ups marked. */
export const formatSets = (sets: readonly SessionSet[]) =>
  sets.map((set) => (set.warmup ? `W ${formatSet(set)}` : formatSet(set))).join(", ");

const Draft = Type.Object({
  planId: Type.Union([Type.String(), Type.Null()]),
  date: Type.String(),
  exercises: Type.Array(ExerciseRows),
});

/** A workout under way: what is typed so far, kept on the phone until it is finished or discarded. */
export type Draft = Static<typeof Draft>;

/**
 * A workout of the plan's exercises: each with the plan's working sets, and as many warm-ups as its last session had.
 * Exercises deleted since the plan was made are left out.
 */
export function startDraft(
  plan: WorkoutPlan,
  date: string,
  sessions: readonly WorkoutSession[],
  exerciseIds: ReadonlySet<string>,
): Draft {
  return {
    planId: plan.id,
    date,
    exercises: plan.exercises
      .filter(({ exerciseId }) => exerciseIds.has(exerciseId))
      .map(({ exerciseId, sets }) => ({
        exerciseId,
        warmups: Array.from({ length: previousWarmups(sessions, exerciseId) }, () => EMPTY_ROW),
        sets: Array.from({ length: sets }, () => EMPTY_ROW),
      })),
  };
}

const DRAFT_KEY = "workout-draft";

/** The workout under way on this phone, if any. Storage can be missing or blocked, which is no workout. */
export function loadDraft(): Draft | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");

    return Value.Check(Draft, parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps the workout under way, or forgets it for null; it is lost only if storage is blocked. */
export function saveDraft(draft: Draft | null): void {
  try {
    if (draft === null) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Without storage, the workout lasts as long as the app stays open.
  }
}
