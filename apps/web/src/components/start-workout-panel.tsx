import type { WorkoutPlan } from "assistant/workout-log";
import { PlayIcon } from "lucide-react";
import { type Transaction, useLiveQuery } from "@tanstack/react-db";
import { useEffect, useRef, useState } from "react";
import { AddExercise, type AddedExercise, refusedExercises } from "@/components/add-exercise";
import { ExerciseSetRows } from "@/components/set-rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exerciseCollection, planCollection, sessionCollection } from "@/lib/collections";
import { today } from "@/lib/dates";
import { follow } from "@/lib/feedback";
import {
  addedExerciseRows,
  type Draft,
  loadDraft,
  rowsToSets,
  saveDraft,
  startDraft,
} from "@/lib/workouts";
import { previousSets } from "utils/workouts";

/**
 * Records a workout from a plan. Each set's empty fields show what that set was the last time it was done, so a set
 * skipped last session shows the session before's. An exercise not in the plan can be added along the way. The
 * workout is kept on the phone as it is typed, so closing the app does not lose it, and is logged when finished.
 */
export function StartWorkoutPanel() {
  const plans = useLiveQuery((q) =>
    q.from({ plan: planCollection }).orderBy(({ plan }) => plan.name, "asc"),
  );

  const exercises = useLiveQuery((q) =>
    q.from({ exercise: exerciseCollection }).orderBy(({ exercise }) => exercise.name, "asc"),
  );

  const sessions = useLiveQuery((q) => q.from({ session: sessionCollection }));
  const [draft, setDraft] = useState(loadDraft);
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);

  // Exercises added by name during this workout, which finishing waits for: the server refuses a session of an
  // exercise it does not have. One added before the app was closed has long been saved.
  const added = useRef<AddedExercise[]>([]);

  useEffect(() => saveDraft(draft), [draft]);

  if (plans.isLoadingError || exercises.isLoadingError || sessions.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load the plans.</p>
    );
  }

  const names = new Map(exercises.data.map(({ id, name }) => [id, name]));

  if (draft === null) {
    const start = (plan: WorkoutPlan) =>
      setDraft(startDraft(plan, today(), sessions.data, new Set(names.keys())));

    return <PlanPicker plans={plans.data} names={names} onStart={start} />;
  }

  const sets = rowsToSets(draft.exercises);
  const plan = plans.data.find(({ id }) => id === draft.planId);

  const finish = async () => {
    if (sets === null || sets.length === 0 || saving) return;

    setSaving(true);

    // An exercise the server refused is left out.
    const refused = await refusedExercises(added.current);
    const kept = sets.filter(({ exerciseId }) => !refused.has(exerciseId));

    if (kept.length === 0) {
      setSaving(false);

      return;
    }

    const logged = sessionCollection.insert({
      id: `session:app:${crypto.randomUUID()}`,
      date: draft.date,
      planId: draft.planId,
      createdAt: Date.now(),
      sets: kept,
    });

    follow(logged);

    // The workout stays until the server has it: one it refuses can be finished again.
    void logged
      .when("settled")
      .then(
        () => {
          added.current = [];
          setDraft(null);
        },
        () => {},
      )
      .finally(() => setSaving(false));
  };

  const discard = () => {
    setDraft(null);
    setDiscarding(false);
  };

  const update = (next: Partial<Draft>) => setDraft({ ...draft, ...next });

  const addExercise = (exerciseId: string, insert?: Transaction) => {
    if (insert !== undefined) added.current.push({ id: exerciseId, insert });

    update({ exercises: [...draft.exercises, addedExerciseRows(exerciseId, sessions.data)] });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <h2 className="min-w-0 flex-1 truncate font-medium">{plan?.name ?? "Workout"}</h2>
        <Input
          type="date"
          value={draft.date}
          onChange={(event) => update({ date: event.target.value })}
          aria-label="Date"
          className="w-36"
        />
      </div>
      {draft.exercises.map((rows, index) => (
        <ExerciseSetRows
          key={rows.exerciseId}
          name={names.get(rows.exerciseId) ?? "Deleted exercise"}
          rows={rows}
          previous={{
            warmups: previousSets(sessions.data, rows.exerciseId, true, rows.warmups.length),
            sets: previousSets(sessions.data, rows.exerciseId, false, rows.sets.length),
          }}
          onChange={(next) => update({ exercises: draft.exercises.with(index, next) })}
        />
      ))}
      <AddExercise
        exercises={exercises.data}
        taken={new Set(draft.exercises.map(({ exerciseId }) => exerciseId))}
        onAdd={addExercise}
      />
      {sets === null && (
        <p className="px-1 text-xs text-destructive">
          A set needs its reps, and a weight that is a number.
        </p>
      )}
      <Button onClick={finish} disabled={sets === null || sets.length === 0 || saving}>
        {saving ? "Saving…" : "Finish workout"}
      </Button>
      {/* Asks once more: what was typed is lost. */}
      <Button
        variant="ghost"
        className="text-destructive"
        onClick={discarding ? discard : () => setDiscarding(true)}
      >
        {discarding ? "Discard what's typed?" : "Discard"}
      </Button>
    </div>
  );
}

function PlanPicker({
  plans,
  names,
  onStart,
}: {
  readonly plans: readonly WorkoutPlan[];
  readonly names: ReadonlyMap<string, string>;
  readonly onStart: (plan: WorkoutPlan) => void;
}) {
  if (plans.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Make a plan in the Plans tab to start a workout from it.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Choose a plan
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl bg-card">
        {plans.map((plan) => (
          <li key={plan.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:opacity-50"
              onClick={() => onStart(plan)}
              disabled={plan.exercises.length === 0}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[0.95rem]">{plan.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {plan.exercises.length === 0
                    ? "No exercises"
                    : plan.exercises
                        .map(({ exerciseId }) => names.get(exerciseId) ?? "Deleted exercise")
                        .join(", ")}
                </p>
              </div>
              <PlayIcon className="size-4 text-primary" aria-label={`Start ${plan.name}`} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
