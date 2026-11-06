/** The parts of a workout log entry the stats read: an exercise done on a day, as sets of `reps` each. */
export type WorkoutSets = {
  readonly exerciseId: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly sets: number;
  readonly reps: number;
};

/** One day an exercise was done, totalled over that day's entries for it. */
export type WorkoutDay = {
  readonly date: string;
  readonly sets: number;
  /** Over every set. */
  readonly reps: number;
  /** The most reps in one set. */
  readonly bestSet: number;
};

/** An exercise's totals over its whole history. */
export type ExerciseStats = {
  /** The days it was done. */
  readonly days: number;
  readonly sets: number;
  readonly reps: number;
  /** The most reps in one set; 0 when it was never done. */
  readonly bestSet: number;
  /** The last day it was done; null when it was never done. */
  readonly lastDate: string | null;
};

/** The days the exercise was done, oldest first. */
export function exerciseHistory(entries: readonly WorkoutSets[], exerciseId: string): WorkoutDay[] {
  const days = new Map<string, { sets: number; reps: number; bestSet: number }>();

  for (const entry of entries) {
    if (entry.exerciseId !== exerciseId) continue;

    const day = days.get(entry.date) ?? { sets: 0, reps: 0, bestSet: 0 };

    day.sets += entry.sets;
    day.reps += entry.sets * entry.reps;
    day.bestSet = Math.max(day.bestSet, entry.reps);
    days.set(entry.date, day);
  }

  return [...days]
    .map(([date, day]) => ({ date, ...day }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The totals of an exercise's history, as `exerciseHistory` gives it. */
export function exerciseStats(history: readonly WorkoutDay[]): ExerciseStats {
  let sets = 0;
  let reps = 0;
  let bestSet = 0;

  for (const day of history) {
    sets += day.sets;
    reps += day.reps;
    bestSet = Math.max(bestSet, day.bestSet);
  }

  return { days: history.length, sets, reps, bestSet, lastDate: history.at(-1)?.date ?? null };
}

/** "3 × 10": sets of reps. */
export const formatSets = ({ sets, reps }: Pick<WorkoutSets, "sets" | "reps">): string =>
  `${sets} × ${reps}`;
