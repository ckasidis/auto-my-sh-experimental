import { useLiveQuery } from "@tanstack/react-db";
import type { Exercise, WorkoutEntry } from "assistant/workout-log";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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
import { exerciseCollection, workoutEntryCollection } from "@/lib/collections";
import { formatDay, formatShortDate } from "@/lib/dates";
import { follow } from "@/lib/feedback";
import { nameTaken } from "@/lib/names";
import { cn } from "@/lib/utils";
import { exerciseHistory, exerciseStats, formatSets, type WorkoutDay } from "utils/workouts";

/** The most recent days the chart shows, so its bars stay wide enough to read. */
const CHART_DAYS = 20;

const METRICS = ["reps", "sets", "bestSet"] as const;

type Metric = (typeof METRICS)[number];

const chartConfig = {
  reps: { label: "Total reps", color: "var(--primary)" },
  sets: { label: "Sets", color: "var(--primary)" },
  bestSet: { label: "Best set", color: "var(--primary)" },
} satisfies Record<Metric, ChartConfig[string]>;

/** The exercises by name, each with when it was last done; one opens its history. */
export function ExercisesPanel() {
  const exercises = useLiveQuery((q) =>
    q.from({ exercise: exerciseCollection }).orderBy(({ exercise }) => exercise.name, "asc"),
  );

  const entries = useLiveQuery((q) => q.from({ entry: workoutEntryCollection }));
  const [open, setOpen] = useState<Exercise | null>(null);

  if (exercises.isLoadingError || entries.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load exercises.</p>
    );
  }

  // The open one as it is now, after a rename; gone once it is deleted.
  const current = exercises.data.find(({ id }) => id === open?.id) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <AddExercise existing={exercises.data} />
      {exercises.data.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No exercises yet.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl bg-card">
          {exercises.data.map((exercise) => {
            const stats = exerciseStats(exerciseHistory(entries.data, exercise.id));

            return (
              <li key={exercise.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left"
                  onClick={() => setOpen(exercise)}
                >
                  <span className="min-w-0 flex-1 truncate text-[0.95rem]">{exercise.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {stats.lastDate === null
                      ? "Not logged yet"
                      : `${formatShortDate(stats.lastDate)} · ${stats.days} day${stats.days === 1 ? "" : "s"}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={current !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          {/* Keyed so the form starts from the exercise it opens on. */}
          {current !== null && (
            <ExerciseDetails
              key={current.id}
              exercise={current}
              exercises={exercises.data}
              entries={entries.data}
              onClose={() => setOpen(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddExercise({ existing }: { readonly existing: readonly Exercise[] }) {
  const [name, setName] = useState("");
  const taken = nameTaken(name, existing);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim() === "" || taken) return;

    follow(
      exerciseCollection.insert({
        id: `exercise:app:${crypto.randomUUID()}`,
        name: name.trim(),
        createdAt: Date.now(),
      }),
    );
    setName("");
  };

  return (
    <form onSubmit={submit} className="grid gap-1">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Add an exercise"
          maxLength={200}
          aria-invalid={taken}
          enterKeyHint="done"
        />
        <Button
          type="submit"
          size="icon"
          disabled={name.trim() === "" || taken}
          aria-label="Add exercise"
        >
          <PlusIcon />
        </Button>
      </div>
      {taken && <p className="px-1 text-xs text-destructive">Already on the list.</p>}
    </form>
  );
}

/** An exercise's totals, a chart of its recent days, every day it was done, and a way to rename or delete it. */
function ExerciseDetails({
  exercise,
  exercises,
  entries,
  onClose,
}: {
  readonly exercise: Exercise;
  readonly exercises: readonly Exercise[];
  readonly entries: readonly WorkoutEntry[];
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(exercise.name);
  const [deleting, setDeleting] = useState(false);
  const history = exerciseHistory(entries, exercise.id);
  const stats = exerciseStats(history);
  const taken = nameTaken(name, exercises, exercise.id);
  const renamed = name.trim() !== exercise.name;

  const rename = (event: FormEvent) => {
    event.preventDefault();

    if (name.trim() === "" || taken || !renamed) return;

    follow(
      exerciseCollection.update(exercise.id, (draft) => {
        draft.name = name.trim();
      }),
    );
  };

  const remove = () => {
    follow(exerciseCollection.delete(exercise.id));
    onClose();
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{exercise.name}</DialogTitle>
        <DialogDescription>
          {stats.lastDate === null ? "Not logged yet." : `Last done ${formatDay(stats.lastDate)}.`}
        </DialogDescription>
      </DialogHeader>
      {history.length > 0 && (
        <>
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Days" value={stats.days} />
            <Stat label="Sets" value={stats.sets} />
            <Stat label="Reps" value={stats.reps} />
            <Stat label="Best set" value={stats.bestSet} />
          </dl>
          <HistoryChart history={history} />
          <section className="grid gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              History
            </h3>
            <ul className="divide-y rounded-lg border">
              {history.toReversed().map((day) => (
                <li key={day.date} className="flex items-baseline gap-2 px-3 py-2">
                  <span className="w-24 shrink-0 text-sm">{formatDay(day.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {entries
                      .filter(
                        (entry) => entry.exerciseId === exercise.id && entry.date === day.date,
                      )
                      .map(formatSets)
                      .join(", ")}
                  </span>
                  <span className="text-sm tabular-nums">{day.reps} reps</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <form onSubmit={rename} className="grid gap-1.5">
        <Label htmlFor="exercise-name">Name</Label>
        <div className="flex gap-2">
          <Input
            id="exercise-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            aria-invalid={taken || name.trim() === ""}
            enterKeyHint="done"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={name.trim() === "" || taken || !renamed}
          >
            Rename
          </Button>
        </div>
        {taken && <p className="text-xs text-destructive">Another exercise has this name.</p>}
      </form>
      <DialogFooter className="flex-row justify-start sm:justify-start">
        {/* Asks once more: the whole history goes with it. */}
        <Button
          type="button"
          variant="destructive"
          onClick={deleting || history.length === 0 ? remove : () => setDeleting(true)}
        >
          {deleting ? `Delete it and ${stats.days} days of history` : "Delete"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted px-1 py-2">
      <dd className="text-base font-semibold tabular-nums">{value.toLocaleString()}</dd>
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
    </div>
  );
}

/** A bar per day the exercise was done, over its last `CHART_DAYS` days, of the chosen total. */
function HistoryChart({ history }: { readonly history: readonly WorkoutDay[] }) {
  const [metric, setMetric] = useState<Metric>("reps");

  // Labelled for the axis and the tooltip, which shows a bar's axis label.
  const recent = history
    .slice(-CHART_DAYS)
    .map((day) => ({ ...day, day: formatShortDate(day.date) }));

  return (
    <section className="grid gap-2">
      <div className="flex gap-1" role="group" aria-label="Chart">
        {METRICS.map((key) => (
          <Button
            key={key}
            type="button"
            size="xs"
            variant={metric === key ? "secondary" : "ghost"}
            className={cn(metric !== key && "text-muted-foreground")}
            onClick={() => setMetric(key)}
            aria-pressed={metric === key}
          >
            {chartConfig[key].label}
          </Button>
        ))}
      </div>
      <ChartContainer config={chartConfig} className="aspect-auto h-44 w-full">
        <BarChart data={recent} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis width={32} tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={4} />
        </BarChart>
      </ChartContainer>
      {history.length > CHART_DAYS && (
        <p className="text-xs text-muted-foreground">The last {CHART_DAYS} days it was done.</p>
      )}
    </section>
  );
}
