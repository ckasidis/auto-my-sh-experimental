import { type Transaction, useLiveQuery } from "@tanstack/react-db";
import type { Exercise, WorkoutSession } from "assistant/workout-log";
import { type FormEvent, useRef, useState } from "react";
import { AddExercise, type AddedExercise, refusedExercises } from "@/components/add-exercise";
import { ExerciseSetRows } from "@/components/set-rows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exerciseCollection, planCollection, sessionCollection } from "@/lib/collections";
import { formatDay, today } from "@/lib/dates";
import { follow } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { addedExerciseRows, formatSets, rowsToSets, setsToRows } from "@/lib/workouts";

/** The sessions shown at first, and added by each "Show more". */
const SESSIONS_PER_PAGE = 10;

/** The logged sessions, newest first, each with its sets by exercise; one opens to edit it. */
export function HistoryPanel() {
  const sessions = useLiveQuery((q) =>
    q
      .from({ session: sessionCollection })
      .orderBy(({ session }) => session.date, "desc")
      .orderBy(({ session }) => session.createdAt, "desc"),
  );

  const exercises = useLiveQuery((q) =>
    q.from({ exercise: exerciseCollection }).orderBy(({ exercise }) => exercise.name, "asc"),
  );

  const plans = useLiveQuery((q) => q.from({ plan: planCollection }));
  const [editing, setEditing] = useState<WorkoutSession | null>(null);
  const [shown, setShown] = useState(SESSIONS_PER_PAGE);

  if (sessions.isLoadingError || exercises.isLoadingError || plans.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load the history.</p>
    );
  }

  const names = new Map(exercises.data.map(({ id, name }) => [id, name]));
  const planNames = new Map(plans.data.map(({ id, name }) => [id, name]));
  const now = today();

  return (
    <div className="flex flex-col gap-3">
      {sessions.data.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing logged yet. Finish a workout from the Start tab.
        </p>
      )}
      {sessions.data.slice(0, shown).map((session) => (
        <button
          key={session.id}
          type="button"
          className="grid gap-1.5 rounded-xl bg-card px-3 py-2.5 text-left"
          onClick={() => setEditing(session)}
        >
          <span className={cn("text-sm font-medium", session.date === now && "text-primary")}>
            {formatDay(session.date)}
            {session.date === now && " · Today"}
            {session.planId !== null && planNames.has(session.planId) && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {planNames.get(session.planId)}
              </span>
            )}
          </span>
          {setsToRows(session.sets).map(({ exerciseId }) => (
            <span key={exerciseId} className="grid text-xs">
              <span>{names.get(exerciseId) ?? "Deleted exercise"}</span>
              <span className="text-muted-foreground">
                {formatSets(session.sets.filter((set) => set.exerciseId === exerciseId))}
              </span>
            </span>
          ))}
        </button>
      ))}
      {sessions.data.length > shown && (
        <Button variant="ghost" onClick={() => setShown(shown + SESSIONS_PER_PAGE)}>
          Show more
        </Button>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          {/* Keyed so the form starts from the session it opens on. */}
          {editing !== null && (
            <EditSession
              key={editing.id}
              session={editing}
              sessions={sessions.data}
              exercises={exercises.data}
              names={names}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Changes a session's date and sets, adds an exercise left out of it, or deletes it. Emptying every set is deleting
 * it.
 */
function EditSession({
  session,
  sessions,
  exercises,
  names,
  onClose,
}: {
  readonly session: WorkoutSession;
  readonly sessions: readonly WorkoutSession[];
  readonly exercises: readonly Exercise[];
  readonly names: ReadonlyMap<string, string>;
  readonly onClose: () => void;
}) {
  const [date, setDate] = useState(session.date);
  const [rows, setRows] = useState(() => setsToRows(session.sets));
  const sets = rowsToSets(rows);
  const valid = date !== "" && sets !== null && sets.length > 0;

  // Exercises added here by name, which the save waits for: the server refuses a session of an exercise it does not
  // have.
  const added = useRef<AddedExercise[]>([]);

  const addExercise = (exerciseId: string, insert?: Transaction) => {
    if (insert !== undefined) added.current.push({ id: exerciseId, insert });

    setRows([...rows, addedExerciseRows(exerciseId, sessions)]);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();

    if (!valid) return;

    onClose();

    // An exercise the server refused is left out.
    const refused = await refusedExercises(added.current);
    const kept = sets.filter(({ exerciseId }) => !refused.has(exerciseId));

    if (kept.length === 0) return;

    follow(
      sessionCollection.update(session.id, (draft) => {
        draft.date = date;
        draft.sets = kept;
      }),
    );
  };

  const remove = () => {
    follow(sessionCollection.delete(session.id));
    onClose();
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Workout</DialogTitle>
        <DialogDescription>
          Remove a set with its ×. Sets left empty are not saved.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="session-date">Date</Label>
        <Input
          id="session-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </div>
      {rows.map((exercise, index) => (
        <ExerciseSetRows
          key={exercise.exerciseId}
          name={names.get(exercise.exerciseId) ?? "Deleted exercise"}
          rows={exercise}
          onChange={(next) => setRows(rows.with(index, next))}
        />
      ))}
      <AddExercise
        exercises={exercises}
        taken={new Set(rows.map(({ exerciseId }) => exerciseId))}
        onAdd={addExercise}
      />
      {sets === null && (
        <p className="text-xs text-destructive">
          A set needs its reps, and a weight that is a number.
        </p>
      )}
      <DialogFooter className="flex-row justify-between sm:justify-between">
        <Button type="button" variant="destructive" onClick={remove}>
          Delete
        </Button>
        <Button type="submit" disabled={!valid}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
