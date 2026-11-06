/** The parts of a logged set the stats read. A warm-up is kept in the history but left out of the stats. */
export type LoggedSet = {
  readonly exerciseId: string;
  readonly warmup: boolean;
  readonly reps: number;
  /** In kg; null for one done without added weight. */
  readonly weight: number | null;
};

/** The parts of a logged session the stats read. */
export type LoggedSession = {
  readonly id: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly createdAt: number;
  readonly sets: readonly LoggedSet[];
};

/** One session's working sets of an exercise, totalled. */
export type ExerciseSession = {
  readonly sessionId: string;
  readonly date: string;
  readonly sets: number;
  /** Over every working set. */
  readonly reps: number;
  /** The sum of weight × reps over the working sets, in kg. */
  readonly volume: number;
  /** The heaviest working set's weight; null when none had added weight. */
  readonly topWeight: number | null;
  /** The most reps in one working set. */
  readonly bestReps: number;
};

/** An exercise's totals over its working sets. */
export type ExerciseStats = {
  /** The sessions with a working set of it. */
  readonly sessions: number;
  readonly sets: number;
  readonly reps: number;
  readonly volume: number;
  readonly topWeight: number | null;
  readonly bestReps: number;
  /** The last session's date; null when it was never done. */
  readonly lastDate: string | null;
};

const oldestFirst = (a: LoggedSession, b: LoggedSession) =>
  a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** Two decimal places, so float noise (0.30000000000000004) never shows. */
const round = (value: number) => Math.round(value * 100) / 100;

const heavier = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

/** The sessions with a working set of the exercise, oldest first, each totalled over its working sets. */
export function exerciseHistory(
  sessions: readonly LoggedSession[],
  exerciseId: string,
): ExerciseSession[] {
  return [...sessions].sort(oldestFirst).flatMap((session) => {
    const working = session.sets.filter((set) => set.exerciseId === exerciseId && !set.warmup);

    if (working.length === 0) return [];

    let reps = 0;
    let volume = 0;
    let topWeight: number | null = null;
    let bestReps = 0;

    for (const set of working) {
      reps += set.reps;
      volume += (set.weight ?? 0) * set.reps;
      topWeight = heavier(topWeight, set.weight);
      bestReps = Math.max(bestReps, set.reps);
    }

    return [
      {
        sessionId: session.id,
        date: session.date,
        sets: working.length,
        reps,
        volume: round(volume),
        topWeight,
        bestReps,
      },
    ];
  });
}

/** The totals of an exercise's history, as `exerciseHistory` gives it. */
export function exerciseStats(history: readonly ExerciseSession[]): ExerciseStats {
  let sets = 0;
  let reps = 0;
  let volume = 0;
  let topWeight: number | null = null;
  let bestReps = 0;

  for (const session of history) {
    sets += session.sets;
    reps += session.reps;
    volume += session.volume;
    topWeight = heavier(topWeight, session.topWeight);
    bestReps = Math.max(bestReps, session.bestReps);
  }

  return {
    sessions: history.length,
    sets,
    reps,
    volume: round(volume),
    topWeight,
    bestReps,
    lastDate: history.at(-1)?.date ?? null,
  };
}

/**
 * What the exercise's sets of one kind (warm-up or working) were the last time each was done: the nth is the nth such
 * set of the newest session that had one, so a set skipped last session comes from the session before. Undefined for
 * one never done.
 */
export function previousSets(
  sessions: readonly LoggedSession[],
  exerciseId: string,
  warmup: boolean,
  count: number,
): (LoggedSet | undefined)[] {
  const newestFirst = [...sessions].sort(oldestFirst).reverse();

  const kinds = newestFirst.map((session) =>
    session.sets.filter((set) => set.exerciseId === exerciseId && set.warmup === warmup),
  );

  return Array.from(
    { length: count },
    (_, index) => kinds.find((sets) => sets.length > index)?.[index],
  );
}

/** How many warm-up sets of the exercise its newest session had: as many as a new session starts with. */
export function previousWarmups(sessions: readonly LoggedSession[], exerciseId: string): number {
  const newest = [...sessions]
    .sort(oldestFirst)
    .findLast((session) => session.sets.some((set) => set.exerciseId === exerciseId));

  return newest?.sets.filter((set) => set.exerciseId === exerciseId && set.warmup).length ?? 0;
}

/** "60 kg × 8", or "8 reps" without added weight. */
export const formatSet = ({ reps, weight }: Pick<LoggedSet, "reps" | "weight">): string =>
  weight === null ? `${reps} reps` : `${weight} kg × ${reps}`;
