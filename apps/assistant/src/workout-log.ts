import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { checkDate, type Database, type DateRange, sameName } from "./recipe-book.ts";
import { exercises, workoutEntries } from "./schema.ts";

/** Something the owner does in a workout, such as "Push-up" or "Squat". */
export type Exercise = typeof exercises.$inferSelect;

/** An exercise to add. Its id is chosen by the caller, so a retried add is the same exercise. */
export type NewExercise = Pick<Exercise, "id" | "name">;

/** An exercise done on a day, as `sets` sets of `reps` each. */
export type WorkoutEntry = typeof workoutEntries.$inferSelect;

/** An entry to log. Its id is chosen by the caller, so a retried log is the same entry. */
export type NewWorkoutEntry = Pick<WorkoutEntry, "id" | "exerciseId" | "date" | "sets" | "reps">;

/** Fields to change; an absent one is kept. */
export type WorkoutEntryChanges = {
  readonly exerciseId?: string;
  readonly date?: string;
  readonly sets?: number;
  readonly reps?: number;
};

/** Which entries to list: every one, or those of one exercise, in a date range, or both. */
export type WorkoutFilter = Partial<DateRange> & { readonly exerciseId?: string };

type Awaitable<T> = T | Promise<T>;

/** The `UserStore` object's workout methods, which the workout tools call; over RPC each returns a promise. */
export interface OwnerWorkouts {
  listExercises(): Awaitable<Exercise[]>;
  addExercise(exercise: NewExercise): Awaitable<Exercise>;
  renameExercise(id: string, name: string): Awaitable<Exercise | null>;
  removeExercise(id: string): Awaitable<boolean>;
  listWorkoutEntries(filter?: WorkoutFilter): Awaitable<WorkoutEntry[]>;
  addWorkoutEntry(entry: NewWorkoutEntry): Awaitable<WorkoutEntry>;
  updateWorkoutEntry(id: string, changes: WorkoutEntryChanges): Awaitable<WorkoutEntry | null>;
  removeWorkoutEntry(id: string): Awaitable<boolean>;
}

export const MAX_SETS = 100;
export const MAX_REPS = 10_000;

function checkCount(name: "sets" | "reps", value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be a whole number from 1 to ${max}`);
  }
}

/**
 * The owner's exercises and workout log, in the `UserStore` object's SQLite. Deleting an exercise deletes its entries.
 */
export class WorkoutLog implements OwnerWorkouts {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** By name, ignoring case. */
  listExercises(): Exercise[] {
    return this.#db
      .select()
      .from(exercises)
      .orderBy(sql`${exercises.name} collate nocase`, asc(exercises.id))
      .all();
  }

  /**
   * Adds the exercise, or returns the one already stored under its id or, ignoring case, its name: there is one
   * exercise per name.
   */
  addExercise(exercise: NewExercise): Exercise {
    const existing = this.#exercise(exercise.id) ?? this.#exerciseNamed(exercise.name);

    if (existing !== undefined) return existing;

    return this.#db
      .insert(exercises)
      .values({ ...exercise, createdAt: Date.now() })
      .returning()
      .get();
  }

  /** Renames the exercise; null when no exercise has this id. Refuses a name another exercise has. */
  renameExercise(id: string, name: string): Exercise | null {
    if (this.#exercise(id) === undefined) return null;

    const clash = this.#exerciseNamed(name, id);

    if (clash !== undefined) {
      throw new Error(`An exercise named ${clash.name} already exists (id: ${clash.id})`);
    }

    return this.#db.update(exercises).set({ name }).where(eq(exercises.id, id)).returning().get()!;
  }

  /** Deletes the exercise and its entries; false when no exercise has this id. */
  removeExercise(id: string): boolean {
    return this.#db.transaction((tx) => {
      tx.delete(workoutEntries).where(eq(workoutEntries.exerciseId, id)).run();

      return (
        tx.delete(exercises).where(eq(exercises.id, id)).returning({ id: exercises.id }).all()
          .length > 0
      );
    });
  }

  /** The entries the filter picks, newest day first, and in the order they were logged within a day. */
  listWorkoutEntries(filter: WorkoutFilter = {}): WorkoutEntry[] {
    if (filter.from !== undefined) checkDate(filter.from);

    if (filter.to !== undefined) checkDate(filter.to);

    return this.#db
      .select()
      .from(workoutEntries)
      .where(
        and(
          filter.exerciseId === undefined
            ? undefined
            : eq(workoutEntries.exerciseId, filter.exerciseId),
          filter.from === undefined ? undefined : gte(workoutEntries.date, filter.from),
          filter.to === undefined ? undefined : lte(workoutEntries.date, filter.to),
        ),
      )
      .orderBy(desc(workoutEntries.date), asc(workoutEntries.createdAt), asc(workoutEntries.id))
      .all();
  }

  /** Logs the entry, or returns the one already stored under its id. */
  addWorkoutEntry(entry: NewWorkoutEntry): WorkoutEntry {
    const existing = this.#entry(entry.id);

    if (existing !== undefined) return existing;

    checkDate(entry.date);
    checkCount("sets", entry.sets, MAX_SETS);
    checkCount("reps", entry.reps, MAX_REPS);
    this.#checkExercise(entry.exerciseId);

    return this.#db
      .insert(workoutEntries)
      .values({ ...entry, createdAt: Date.now() })
      .returning()
      .get();
  }

  /** Applies the changes; null when no entry has this id. */
  updateWorkoutEntry(id: string, changes: WorkoutEntryChanges): WorkoutEntry | null {
    const current = this.#entry(id);

    if (current === undefined) return null;

    if (changes.date !== undefined) checkDate(changes.date);

    if (changes.sets !== undefined) checkCount("sets", changes.sets, MAX_SETS);

    if (changes.reps !== undefined) checkCount("reps", changes.reps, MAX_REPS);

    if (changes.exerciseId !== undefined) this.#checkExercise(changes.exerciseId);

    const fields = {
      exerciseId: changes.exerciseId,
      date: changes.date,
      sets: changes.sets,
      reps: changes.reps,
    };

    if (Object.values(fields).every((value) => value === undefined)) return current;

    return this.#db
      .update(workoutEntries)
      .set(fields)
      .where(eq(workoutEntries.id, id))
      .returning()
      .get()!;
  }

  /** Deletes the entry; false when no entry has this id. */
  removeWorkoutEntry(id: string): boolean {
    const deleted = this.#db
      .delete(workoutEntries)
      .where(eq(workoutEntries.id, id))
      .returning({ id: workoutEntries.id })
      .all();

    return deleted.length > 0;
  }

  #exercise(id: string): Exercise | undefined {
    return this.#db.select().from(exercises).where(eq(exercises.id, id)).get();
  }

  /** An exercise with this name, ignoring case and surrounding spaces, other than the one with id `except`. */
  #exerciseNamed(name: string, except?: string): Exercise | undefined {
    const named = sameName(exercises.name, name);

    return this.#db
      .select()
      .from(exercises)
      .where(except === undefined ? named : and(named, ne(exercises.id, except)))
      .get();
  }

  #entry(id: string): WorkoutEntry | undefined {
    return this.#db.select().from(workoutEntries).where(eq(workoutEntries.id, id)).get();
  }

  #checkExercise(id: string): void {
    if (this.#exercise(id) === undefined) throw new Error(`No exercise has id ${id}`);
  }
}
