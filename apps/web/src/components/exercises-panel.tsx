import { useLiveQuery } from "@tanstack/react-db";
import type { Exercise, WorkoutSession } from "assistant/workout-log";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BottomAction } from "@/components/bottom-bar";
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
import { exerciseCollection, sessionCollection } from "@/lib/collections";
import { formatDay, formatShortDate } from "@/lib/dates";
import { follow } from "@/lib/feedback";
import { nameTaken } from "@/lib/names";
import { cn } from "@/lib/utils";
import { formatSets } from "@/lib/workouts";
import { type ExerciseSession, exerciseHistory, exerciseStats } from "utils/workouts";

/** The most recent sessions the chart shows, so its bars stay wide enough to read. */
const CHART_SESSIONS = 20;

const METRICS = ["topWeight", "volume", "reps"] as const;

type Metric = (typeof METRICS)[number];

const chartConfig = {
  topWeight: { label: "Top weight", color: "var(--primary)" },
  volume: { label: "Volume", color: "var(--primary)" },
  reps: { label: "Reps", color: "var(--primary)" },
} satisfies Record<Metric, ChartConfig[string]>;

/** Kilograms as the stats show them: "62.5 kg". */
const kg = (weight: number | null) => (weight === null ? "–" : `${weight.toLocaleString()} kg`);

/** The exercises by name, each with when it was last done; one opens its history. */
export function ExercisesPanel() {
  const exercises = useLiveQuery((q) =>
    q.from({ exercise: exerciseCollection }).orderBy(({ exercise }) => exercise.name, "asc"),
  );

  const sessions = useLiveQuery((q) => q.from({ session: sessionCollection }));
  const [open, setOpen] = useState<Exercise | null>(null);

  if (exercises.isLoadingError || sessions.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load exercises.</p>
    );
  }

  // The open one as it is now, after a rename; gone once it is deleted.
  const current = exercises.data.find(({ id }) => id === open?.id) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <BottomAction>
        <AddExercise existing={exercises.data} />
      </BottomAction>
      {exercises.data.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No exercises yet.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl bg-card">
          {exercises.data.map((exercise) => {
            const stats = exerciseStats(exerciseHistory(sessions.data, exercise.id));

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
                      : `${formatShortDate(stats.lastDate)} · ${stats.sessions} session${stats.sessions === 1 ? "" : "s"}`}
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
              sessions={sessions.data}
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

/**
 * An exercise's totals and a chart of its recent sessions, over working sets only; every session it was in, warm-ups
 * included; and a way to rename or delete it.
 */
function ExerciseDetails({
  exercise,
  exercises,
  sessions,
  onClose,
}: {
  readonly exercise: Exercise;
  readonly exercises: readonly Exercise[];
  readonly sessions: readonly WorkoutSession[];
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(exercise.name);
  const [deleting, setDeleting] = useState(false);
  const history = exerciseHistory(sessions, exercise.id);

  const logged = sessions
    .filter((session) => session.sets.some((set) => set.exerciseId === exercise.id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

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
            <Stat label="Sessions" value={stats.sessions.toLocaleString()} />
            <Stat label="Sets" value={stats.sets.toLocaleString()} />
            <Stat label="Top weight" value={kg(stats.topWeight)} />
            <Stat label="Most reps" value={stats.bestReps.toLocaleString()} />
          </dl>
          <HistoryChart history={history} />
        </>
      )}
      {logged.length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            History
          </h3>
          <ul className="divide-y rounded-lg border">
            {logged.map((session) => (
              <li key={session.id} className="grid gap-0.5 px-3 py-2">
                <span className="text-sm">{formatDay(session.date)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatSets(session.sets.filter((set) => set.exerciseId === exercise.id))}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            W marks a warm-up set, which the stats leave out.
          </p>
        </section>
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
          onClick={deleting || logged.length === 0 ? remove : () => setDeleting(true)}
        >
          {deleting
            ? `Delete it and ${logged.length} session${logged.length === 1 ? "" : "s"} of history`
            : "Delete"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted px-1 py-2">
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
    </div>
  );
}

/**
 * A bar per session over the exercise's last `CHART_SESSIONS`, of the chosen measure of its working sets: the top
 * weight, the volume (weight × reps), or the reps. One done without added weight starts on reps.
 */
function HistoryChart({ history }: { readonly history: readonly ExerciseSession[] }) {
  const [metric, setMetric] = useState<Metric>(() =>
    history.some(({ topWeight }) => topWeight !== null) ? "topWeight" : "reps",
  );

  // Labelled for the axis and the tooltip, which shows a bar's axis label.
  const recent = history
    .slice(-CHART_SESSIONS)
    .map((session) => ({ ...session, day: formatShortDate(session.date) }));

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
          <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={metric !== "reps"} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={4} />
        </BarChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">
        {metric === "reps" ? "Reps" : "Kilograms"} over working sets
        {history.length > CHART_SESSIONS ? `, in the last ${CHART_SESSIONS} sessions.` : "."}
      </p>
    </section>
  );
}
