import { and, asc, desc, eq, gte, inArray, lte, ne, notExists, type SQL, sql } from "drizzle-orm";
import { checkDate, type Database, type DateRange, sameName } from "./recipe-book.ts";
import { exercises, planExercises, sessionSets, workoutPlans, workoutSessions } from "./schema.ts";

/** Something the owner does in a workout, such as "Push-up" or "Squat". */
export type Exercise = typeof exercises.$inferSelect;

/** An exercise to add. Its id is chosen by the caller, so a retried add is the same exercise. */
export type NewExercise = Pick<Exercise, "id" | "name">;

/** One of a plan's exercises, with how many working sets it has. */
export type PlanExercise = {
  readonly exerciseId: string;
  readonly sets: number;
};

/** A named list of exercises to do in a workout, in order. */
export type WorkoutPlan = typeof workoutPlans.$inferSelect & {
  readonly exercises: PlanExercise[];
};

/** A plan to add. Its id is chosen by the caller, so a retried add is the same plan. */
export type NewWorkoutPlan = Pick<WorkoutPlan, "id" | "name" | "exercises">;

/** Fields to change; an absent one is kept, and `exercises` replaces the whole list. */
export type WorkoutPlanChanges = {
  readonly name?: string;
  readonly exercises?: PlanExercise[];
};

/** One set done in a session. A warm-up is kept in the history but left out of the stats. */
export type SessionSet = {
  readonly exerciseId: string;
  readonly warmup: boolean;
  readonly reps: number;
  /** In kg; null for one done without added weight. */
  readonly weight: number | null;
};

/** One workout done on a day, with its sets in the order they were done. */
export type WorkoutSession = typeof workoutSessions.$inferSelect & {
  readonly sets: SessionSet[];
};

/** A session to log. Its id is chosen by the caller, so a retried log is the same session. */
export type NewWorkoutSession = Pick<WorkoutSession, "id" | "date" | "planId" | "sets">;

/** Fields to change; an absent one is kept, and `sets` replaces the whole list. */
export type WorkoutSessionChanges = {
  readonly date?: string;
  readonly sets?: SessionSet[];
};

/** Which sessions to list: every one, or those in a date range, or with an exercise, or both. */
export type SessionFilter = Partial<DateRange> & { readonly exerciseId?: string };

type Awaitable<T> = T | Promise<T>;

/** The `UserStore` object's workout methods, which the workout tools call; over RPC each returns a promise. */
export interface OwnerWorkouts {
  listExercises(): Awaitable<Exercise[]>;
  addExercise(exercise: NewExercise): Awaitable<Exercise>;
  renameExercise(id: string, name: string): Awaitable<Exercise | null>;
  removeExercise(id: string): Awaitable<boolean>;
  listPlans(): Awaitable<WorkoutPlan[]>;
  addPlan(plan: NewWorkoutPlan): Awaitable<WorkoutPlan>;
  updatePlan(id: string, changes: WorkoutPlanChanges): Awaitable<WorkoutPlan | null>;
  removePlan(id: string): Awaitable<boolean>;
  listSessions(filter?: SessionFilter): Awaitable<WorkoutSession[]>;
  addSession(session: NewWorkoutSession): Awaitable<WorkoutSession>;
  updateSession(id: string, changes: WorkoutSessionChanges): Awaitable<WorkoutSession | null>;
  removeSession(id: string): Awaitable<boolean>;
}

export const MAX_PLAN_SETS = 20;
export const MAX_REPS = 10_000;
export const MAX_WEIGHT = 10_000;
export const MAX_SESSION_SETS = 500;

function checkPlanExercises(list: readonly PlanExercise[]): void {
  if (new Set(list.map(({ exerciseId }) => exerciseId)).size < list.length) {
    throw new Error("a plan lists each exercise once");
  }

  for (const { sets } of list) {
    if (!Number.isInteger(sets) || sets < 1 || sets > MAX_PLAN_SETS) {
      throw new Error(`a plan's sets must be a whole number from 1 to ${MAX_PLAN_SETS}`);
    }
  }
}

function checkSets(sets: readonly SessionSet[]): void {
  if (sets.length === 0) throw new Error("a session has at least one set");

  if (sets.length > MAX_SESSION_SETS) {
    throw new Error(`a session has at most ${MAX_SESSION_SETS} sets`);
  }

  for (const set of sets) {
    if (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > MAX_REPS) {
      throw new Error(`reps must be a whole number from 1 to ${MAX_REPS}`);
    }

    if (set.weight !== null && !(set.weight >= 0 && set.weight <= MAX_WEIGHT)) {
      throw new Error(`weight must be from 0 to ${MAX_WEIGHT} kg, or null for none`);
    }
  }
}

/**
 * The owner's exercises, workout plans and logged sessions, in the `UserStore` object's SQLite. Deleting an exercise
 * takes it out of the plans and the sessions, and deletes a session left with no sets; deleting a plan keeps the
 * sessions started from it.
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

  /**
   * Deletes the exercise, its sets, and its place in the plans, and the sessions left with no sets; false when no
   * exercise has this id.
   */
  removeExercise(id: string): boolean {
    return this.#db.transaction((tx) => {
      tx.delete(sessionSets).where(eq(sessionSets.exerciseId, id)).run();
      tx.delete(planExercises).where(eq(planExercises.exerciseId, id)).run();
      tx.delete(workoutSessions)
        .where(
          notExists(
            tx.select().from(sessionSets).where(eq(sessionSets.sessionId, workoutSessions.id)),
          ),
        )
        .run();

      return (
        tx.delete(exercises).where(eq(exercises.id, id)).returning({ id: exercises.id }).all()
          .length > 0
      );
    });
  }

  /** By name, ignoring case. */
  listPlans(): WorkoutPlan[] {
    const rows = this.#db
      .select()
      .from(workoutPlans)
      .orderBy(sql`${workoutPlans.name} collate nocase`, asc(workoutPlans.id))
      .all();

    const lines = this.#db
      .select()
      .from(planExercises)
      .orderBy(asc(planExercises.planId), asc(planExercises.position))
      .all();

    return rows.map((plan) => ({
      ...plan,
      exercises: lines
        .filter((line) => line.planId === plan.id)
        .map(({ exerciseId, sets }) => ({ exerciseId, sets })),
    }));
  }

  /** Adds the plan, or returns the one already stored under its id. */
  addPlan(plan: NewWorkoutPlan): WorkoutPlan {
    const existing = this.#plan(plan.id);

    if (existing !== undefined) return existing;

    checkPlanExercises(plan.exercises);
    this.#checkExercises(plan.exercises);

    this.#db.transaction((tx) => {
      tx.insert(workoutPlans).values({ id: plan.id, name: plan.name, createdAt: Date.now() }).run();
      this.#insertPlanExercises(tx, plan.id, plan.exercises);
    });

    return this.#plan(plan.id)!;
  }

  /** Applies the changes; null when no plan has this id. */
  updatePlan(id: string, changes: WorkoutPlanChanges): WorkoutPlan | null {
    if (this.#plan(id) === undefined) return null;

    if (changes.exercises !== undefined) {
      checkPlanExercises(changes.exercises);
      this.#checkExercises(changes.exercises);
    }

    this.#db.transaction((tx) => {
      if (changes.name !== undefined) {
        tx.update(workoutPlans).set({ name: changes.name }).where(eq(workoutPlans.id, id)).run();
      }

      if (changes.exercises !== undefined) {
        tx.delete(planExercises).where(eq(planExercises.planId, id)).run();
        this.#insertPlanExercises(tx, id, changes.exercises);
      }
    });

    return this.#plan(id)!;
  }

  /** Deletes the plan; the sessions started from it are kept. False when no plan has this id. */
  removePlan(id: string): boolean {
    return this.#db.transaction((tx) => {
      tx.update(workoutSessions).set({ planId: null }).where(eq(workoutSessions.planId, id)).run();
      tx.delete(planExercises).where(eq(planExercises.planId, id)).run();

      return (
        tx
          .delete(workoutPlans)
          .where(eq(workoutPlans.id, id))
          .returning({ id: workoutPlans.id })
          .all().length > 0
      );
    });
  }

  /** The sessions the filter picks, newest first. */
  listSessions(filter: SessionFilter = {}): WorkoutSession[] {
    if (filter.from !== undefined) checkDate(filter.from);

    if (filter.to !== undefined) checkDate(filter.to);

    const withExercise =
      filter.exerciseId === undefined
        ? undefined
        : inArray(
            workoutSessions.id,
            this.#db
              .select({ id: sessionSets.sessionId })
              .from(sessionSets)
              .where(eq(sessionSets.exerciseId, filter.exerciseId)),
          );

    const picked = and(
      withExercise,
      filter.from === undefined ? undefined : gte(workoutSessions.date, filter.from),
      filter.to === undefined ? undefined : lte(workoutSessions.date, filter.to),
    );

    const rows = this.#db
      .select()
      .from(workoutSessions)
      .where(picked)
      .orderBy(
        desc(workoutSessions.date),
        desc(workoutSessions.createdAt),
        desc(workoutSessions.id),
      )
      .all();

    return this.#withSets(rows, picked);
  }

  /** Logs the session, or returns the one already stored under its id. */
  addSession(session: NewWorkoutSession): WorkoutSession {
    const existing = this.#session(session.id);

    if (existing !== undefined) return existing;

    checkDate(session.date);
    checkSets(session.sets);
    this.#checkExercises(session.sets);

    // A plan deleted meanwhile leaves the session without one.
    const planId =
      session.planId !== null && this.#plan(session.planId) !== undefined ? session.planId : null;

    this.#db.transaction((tx) => {
      tx.insert(workoutSessions)
        .values({ id: session.id, date: session.date, planId, createdAt: Date.now() })
        .run();
      this.#insertSets(tx, session.id, session.sets);
    });

    return this.#session(session.id)!;
  }

  /** Applies the changes; null when no session has this id. */
  updateSession(id: string, changes: WorkoutSessionChanges): WorkoutSession | null {
    if (this.#session(id) === undefined) return null;

    if (changes.date !== undefined) checkDate(changes.date);

    if (changes.sets !== undefined) {
      checkSets(changes.sets);
      this.#checkExercises(changes.sets);
    }

    this.#db.transaction((tx) => {
      if (changes.date !== undefined) {
        tx.update(workoutSessions)
          .set({ date: changes.date })
          .where(eq(workoutSessions.id, id))
          .run();
      }

      if (changes.sets !== undefined) {
        tx.delete(sessionSets).where(eq(sessionSets.sessionId, id)).run();
        this.#insertSets(tx, id, changes.sets);
      }
    });

    return this.#session(id)!;
  }

  /** Deletes the session and its sets; false when no session has this id. */
  removeSession(id: string): boolean {
    return this.#db.transaction((tx) => {
      tx.delete(sessionSets).where(eq(sessionSets.sessionId, id)).run();

      return (
        tx
          .delete(workoutSessions)
          .where(eq(workoutSessions.id, id))
          .returning({ id: workoutSessions.id })
          .all().length > 0
      );
    });
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

  #checkExercises(list: readonly { readonly exerciseId: string }[]): void {
    const ids = [...new Set(list.map(({ exerciseId }) => exerciseId))];

    if (ids.length === 0) return;

    const known = new Set(
      this.#db
        .select({ id: exercises.id })
        .from(exercises)
        .where(inArray(exercises.id, ids))
        .all()
        .map(({ id }) => id),
    );

    const missing = ids.filter((id) => !known.has(id));

    if (missing.length > 0) throw new Error(`No exercise has id ${missing.join(", ")}`);
  }

  #plan(id: string): WorkoutPlan | undefined {
    const row = this.#db.select().from(workoutPlans).where(eq(workoutPlans.id, id)).get();

    if (row === undefined) return undefined;

    const lines = this.#db
      .select({ exerciseId: planExercises.exerciseId, sets: planExercises.sets })
      .from(planExercises)
      .where(eq(planExercises.planId, id))
      .orderBy(asc(planExercises.position))
      .all();

    return { ...row, exercises: lines };
  }

  #insertPlanExercises(
    tx: Pick<Database, "insert">,
    planId: string,
    list: readonly PlanExercise[],
  ): void {
    if (list.length === 0) return;

    tx.insert(planExercises)
      .values(
        list.map(({ exerciseId, sets }, position) => ({ planId, position, exerciseId, sets })),
      )
      .run();
  }

  #session(id: string): WorkoutSession | undefined {
    const row = this.#db.select().from(workoutSessions).where(eq(workoutSessions.id, id)).get();

    return row === undefined ? undefined : this.#withSets([row], eq(workoutSessions.id, id))[0];
  }

  /** The sessions with their sets, read in one query by the condition that picked the sessions. */
  #withSets(
    rows: readonly (typeof workoutSessions.$inferSelect)[],
    picked: SQL | undefined,
  ): WorkoutSession[] {
    if (rows.length === 0) return [];

    const sets = this.#db
      .select({
        sessionId: sessionSets.sessionId,
        exerciseId: sessionSets.exerciseId,
        warmup: sessionSets.warmup,
        reps: sessionSets.reps,
        weight: sessionSets.weight,
      })
      .from(sessionSets)
      .innerJoin(workoutSessions, eq(workoutSessions.id, sessionSets.sessionId))
      .where(picked)
      .orderBy(asc(sessionSets.sessionId), asc(sessionSets.position))
      .all();

    return rows.map((session) => ({
      ...session,
      sets: sets.flatMap(({ sessionId, exerciseId, warmup, reps, weight }) =>
        sessionId === session.id ? [{ exerciseId, warmup, reps, weight }] : [],
      ),
    }));
  }

  #insertSets(tx: Pick<Database, "insert">, sessionId: string, sets: readonly SessionSet[]): void {
    tx.insert(sessionSets)
      .values(
        sets.map((set, position) => ({
          sessionId,
          position,
          exerciseId: set.exerciseId,
          warmup: set.warmup,
          reps: set.reps,
          weight: set.weight,
        })),
      )
      .run();
  }
}
