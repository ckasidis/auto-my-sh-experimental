import { useLiveQuery } from "@tanstack/react-db";
import type { Exercise, WorkoutEntry } from "assistant/workout-log";
import { type FormEvent, useState } from "react";
import { Choice } from "@/components/choice";
import { ExercisesPanel } from "@/components/exercises-panel";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exerciseCollection, workoutEntryCollection } from "@/lib/collections";
import { formatDay, today } from "@/lib/dates";
import { follow } from "@/lib/feedback";
import { nameTaken } from "@/lib/names";
import { cn } from "@/lib/utils";
import { MAX_REPS, MAX_SETS, parseReps, parseSets } from "@/lib/workouts";
import { formatSets } from "utils/workouts";

/** The days of the log shown at first, and added by each "Show more". */
const DAYS_PER_PAGE = 7;

/** The exercise picker's option for one typed in instead. */
const NEW_EXERCISE = "new";

/** The workout log, and the exercises with each one's history. */
export function WorkoutsPanel() {
  return (
    <Tabs defaultValue="log">
      <TabsList variant="line" className="w-full">
        <TabsTrigger value="log">Log</TabsTrigger>
        <TabsTrigger value="exercises">Exercises</TabsTrigger>
      </TabsList>
      <TabsContent value="log" className="pt-3">
        <LogPanel />
      </TabsContent>
      <TabsContent value="exercises" className="pt-3">
        <ExercisesPanel />
      </TabsContent>
    </Tabs>
  );
}

/** A form that logs an exercise, and the log under it by day, newest first. */
function LogPanel() {
  const exercises = useLiveQuery((q) =>
    q.from({ exercise: exerciseCollection }).orderBy(({ exercise }) => exercise.name, "asc"),
  );

  const entries = useLiveQuery((q) =>
    q
      .from({ entry: workoutEntryCollection })
      .orderBy(({ entry }) => entry.date, "desc")
      .orderBy(({ entry }) => entry.createdAt, "asc"),
  );

  const [editing, setEditing] = useState<WorkoutEntry | null>(null);
  const [shown, setShown] = useState(DAYS_PER_PAGE);

  if (exercises.isLoadingError || entries.isLoadingError) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load the log.</p>;
  }

  const names = new Map(exercises.data.map(({ id, name }) => [id, name]));
  const days = [...new Set(entries.data.map(({ date }) => date))];
  const now = today();

  return (
    <div className="flex flex-col gap-4">
      <LogForm exercises={exercises.data} entries={entries.data} />
      {days.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing logged yet.</p>
      )}
      {days.slice(0, shown).map((date) => (
        <section key={date} className="flex flex-col gap-2">
          <h3
            className={cn(
              "px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase",
              date === now && "text-primary",
            )}
          >
            {formatDay(date)}
            {date === now && " · Today"}
          </h3>
          <ul className="divide-y overflow-hidden rounded-xl bg-card">
            {entries.data
              .filter((entry) => entry.date === date)
              .map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left"
                    onClick={() => setEditing(entry)}
                  >
                    <span className="min-w-0 flex-1 truncate text-[0.95rem]">
                      {names.get(entry.exerciseId) ?? "Deleted exercise"}
                    </span>
                    <span className="text-sm tabular-nums">{formatSets(entry)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {days.length > shown && (
        <Button variant="ghost" onClick={() => setShown(shown + DAYS_PER_PAGE)}>
          Show more
        </Button>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {/* Keyed so the form starts from the entry it opens on. */}
          {editing !== null && (
            <EditEntryForm
              key={editing.id}
              entry={editing}
              exercises={exercises.data}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Logs sets of an exercise on a day, today unless changed. Choosing an exercise fills in the sets and reps it was last
 * logged with, and the form keeps them after logging, so a repeat is one tap. "New exercise" adds one by name.
 */
function LogForm({
  exercises,
  entries,
}: {
  readonly exercises: readonly Exercise[];
  readonly entries: readonly WorkoutEntry[];
}) {
  /** The exercise's newest entry: the last logged on its newest day, as `entries` is ordered. */
  const lastOf = (exerciseId: string) => {
    const logged = entries.filter((entry) => entry.exerciseId === exerciseId);

    return logged.findLast((entry) => entry.date === logged[0]?.date);
  };

  const initial = entries[0]?.exerciseId ?? exercises[0]?.id ?? NEW_EXERCISE;
  const [exerciseId, setExerciseId] = useState(initial);
  const [newName, setNewName] = useState("");
  const [date, setDate] = useState(today);
  const [sets, setSets] = useState(() => String(lastOf(initial)?.sets ?? 3));
  const [reps, setReps] = useState(() => String(lastOf(initial)?.reps ?? 10));

  // One deleted meanwhile, such as from the chat, falls back to the first.
  const chosen = exercises.some(({ id }) => id === exerciseId)
    ? exerciseId
    : (exercises[0]?.id ?? NEW_EXERCISE);

  const items = {
    ...Object.fromEntries(exercises.map(({ id, name }) => [id, name])),
    [NEW_EXERCISE]: "New exercise…",
  };

  const choose = (id: string) => {
    const last = lastOf(id);

    setExerciseId(id);

    if (last !== undefined) {
      setSets(String(last.sets));
      setReps(String(last.reps));
    }
  };

  const adding = chosen === NEW_EXERCISE;
  const taken = adding && nameTaken(newName, exercises);
  const setCount = parseSets(sets);
  const repCount = parseReps(reps);

  const valid =
    setCount !== null &&
    repCount !== null &&
    date !== "" &&
    (!adding || (newName.trim() !== "" && !taken));

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!valid) return;

    let id = chosen;

    if (adding) {
      id = `exercise:app:${crypto.randomUUID()}`;

      const added = exerciseCollection.insert({ id, name: newName.trim(), createdAt: Date.now() });

      follow(added);
      setExerciseId(id);
      setNewName("");

      // The server refuses an entry for an exercise it does not have yet.
      try {
        await added.when("settled");
      } catch {
        return;
      }
    }

    follow(
      workoutEntryCollection.insert({
        id: `workout:app:${crypto.randomUUID()}`,
        exerciseId: id,
        date,
        sets: setCount,
        reps: repCount,
        createdAt: Date.now(),
      }),
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl bg-card p-3">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Choice items={items} value={chosen} onChange={choose} label="Exercise" />
        <Input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          aria-label="Date"
          className="w-36"
          required
        />
      </div>
      {adding && (
        <div className="grid gap-1">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Exercise name, like Push-up"
            maxLength={200}
            aria-label="New exercise"
            aria-invalid={taken}
          />
          {taken && <p className="px-1 text-xs text-destructive">Already on the list.</p>}
        </div>
      )}
      <div className="flex items-end gap-2">
        <CountField id="log-sets" label="Sets" value={sets} onChange={setSets} max={MAX_SETS} />
        <span className="pb-1.5 text-muted-foreground">×</span>
        <CountField id="log-reps" label="Reps" value={reps} onChange={setReps} max={MAX_REPS} />
        <Button type="submit" disabled={!valid} className="flex-1">
          Log
        </Button>
      </div>
    </form>
  );
}

function CountField({
  id,
  label,
  value,
  onChange,
  max,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly max: number;
}) {
  return (
    <div className="grid w-20 gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </div>
  );
}

/** Changes a logged entry's exercise, date, sets or reps, or deletes it. */
function EditEntryForm({
  entry,
  exercises,
  onClose,
}: {
  readonly entry: WorkoutEntry;
  readonly exercises: readonly Exercise[];
  readonly onClose: () => void;
}) {
  const [exerciseId, setExerciseId] = useState(entry.exerciseId);
  const [date, setDate] = useState(entry.date);
  const [sets, setSets] = useState(String(entry.sets));
  const [reps, setReps] = useState(String(entry.reps));
  const items = Object.fromEntries(exercises.map(({ id, name }) => [id, name]));
  const setCount = parseSets(sets);
  const repCount = parseReps(reps);
  const valid = setCount !== null && repCount !== null && date !== "" && exerciseId in items;

  const save = (event: FormEvent) => {
    event.preventDefault();

    if (!valid) return;

    follow(
      workoutEntryCollection.update(entry.id, (draft) => {
        draft.exerciseId = exerciseId;
        draft.date = date;
        draft.sets = setCount;
        draft.reps = repCount;
      }),
    );
    onClose();
  };

  const remove = () => {
    follow(workoutEntryCollection.delete(entry.id));
    onClose();
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Logged sets</DialogTitle>
        <DialogDescription>{formatDay(entry.date)}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label>Exercise</Label>
        <Choice items={items} value={exerciseId} onChange={setExerciseId} label="Exercise" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="entry-date">Date</Label>
        <Input
          id="entry-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </div>
      <div className="flex items-end gap-2">
        <CountField id="entry-sets" label="Sets" value={sets} onChange={setSets} max={MAX_SETS} />
        <span className="pb-1.5 text-muted-foreground">×</span>
        <CountField id="entry-reps" label="Reps" value={reps} onChange={setReps} max={MAX_REPS} />
      </div>
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
