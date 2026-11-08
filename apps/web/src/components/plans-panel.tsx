import { type Transaction, useLiveQuery } from "@tanstack/react-db";
import type { Exercise, WorkoutPlan } from "assistant/workout-log";
import { GripVerticalIcon, PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { AddExercise, type AddedExercise, refusedExercises } from "@/components/add-exercise";
import { BottomAction } from "@/components/bottom-bar";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/reui/sortable";
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
import { exerciseCollection, planCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";
import { DEFAULT_SETS, MAX_PLAN_SETS, parseCount } from "@/lib/workouts";

type Open = { readonly kind: "add" } | { readonly kind: "edit"; readonly plan: WorkoutPlan };

/** The workout plans by name; one opens to edit it. */
export function PlansPanel() {
  const plans = useLiveQuery((q) =>
    q.from({ plan: planCollection }).orderBy(({ plan }) => plan.name, "asc"),
  );

  const exercises = useLiveQuery((q) =>
    q.from({ exercise: exerciseCollection }).orderBy(({ exercise }) => exercise.name, "asc"),
  );

  const [open, setOpen] = useState<Open | null>(null);

  if (plans.isLoadingError || exercises.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load the plans.</p>
    );
  }

  const names = new Map(exercises.data.map(({ id, name }) => [id, name]));

  return (
    <div className="flex flex-col gap-3">
      <BottomAction>
        <Button className="h-10 w-full" onClick={() => setOpen({ kind: "add" })}>
          <PlusIcon />
          New plan
        </Button>
      </BottomAction>
      {plans.data.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No plans yet.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl bg-card">
          {plans.data.map((plan) => (
            <li key={plan.id}>
              <button
                type="button"
                className="grid w-full gap-0.5 px-3 py-2.5 text-left"
                onClick={() => setOpen({ kind: "edit", plan })}
              >
                <span className="text-[0.95rem]">{plan.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {plan.exercises.length === 0
                    ? "No exercises"
                    : plan.exercises
                        .map(
                          ({ exerciseId, sets }) =>
                            `${names.get(exerciseId) ?? "Deleted exercise"} ×${sets}`,
                        )
                        .join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          {/* Keyed so the form starts from the plan it opens on. */}
          {open !== null && (
            <PlanForm
              key={open.kind === "add" ? "add" : open.plan.id}
              plan={open.kind === "edit" ? open.plan : null}
              exercises={exercises.data}
              onClose={() => setOpen(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Line = { readonly exerciseId: string; readonly sets: string };

/**
 * A plan's name and exercises, each with its working sets, dragged into the order the workout goes through them. An
 * exercise not on the list yet can be added by name.
 */
function PlanForm({
  plan,
  exercises,
  onClose,
}: {
  readonly plan: WorkoutPlan | null;
  readonly exercises: readonly Exercise[];
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? "");

  const [lines, setLines] = useState<readonly Line[]>(
    plan?.exercises.map(({ exerciseId, sets }) => ({ exerciseId, sets: String(sets) })) ?? [],
  );

  const [deleting, setDeleting] = useState(false);

  // Exercises added here, which the plan's save waits for: the server refuses a plan of exercises it does not have.
  const added = useRef<AddedExercise[]>([]);

  const names = new Map(exercises.map(({ id, name: exerciseName }) => [id, exerciseName]));

  const counts = lines.map(({ sets }) => parseCount(sets, MAX_PLAN_SETS));
  const valid = name.trim() !== "" && counts.every((count) => count !== null);

  const addLine = (id: string, insert?: Transaction) => {
    if (insert !== undefined) added.current.push({ id, insert });

    setLines([...lines, { exerciseId: id, sets: String(DEFAULT_SETS) }]);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();

    if (!valid) return;

    const planExercises = lines.map(({ exerciseId }, index) => ({
      exerciseId,
      sets: counts[index]!,
    }));

    onClose();

    // An exercise the server refused is left out.
    const refused = await refusedExercises(added.current);
    const kept = planExercises.filter(({ exerciseId }) => !refused.has(exerciseId));

    if (plan === null) {
      follow(
        planCollection.insert({
          id: `plan:app:${crypto.randomUUID()}`,
          name: name.trim(),
          createdAt: Date.now(),
          exercises: kept,
        }),
      );
    } else {
      follow(
        planCollection.update(plan.id, (draft) => {
          draft.name = name.trim();
          draft.exercises = kept;
        }),
      );
    }
  };

  const remove = () => {
    if (plan !== null) follow(planCollection.delete(plan.id));

    onClose();
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{plan === null ? "New plan" : "Edit plan"}</DialogTitle>
        <DialogDescription>Drag the exercises into the order you do them.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="plan-name">Name</Label>
        <Input
          id="plan-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Push day"
          maxLength={200}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Exercises</Label>
        {lines.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet: add one below.</p>
        ) : (
          <Sortable
            value={[...lines]}
            onValueChange={setLines}
            getItemValue={(line) => line.exerciseId}
            className="grid gap-1"
          >
            {lines.map((line, index) => (
              // The dragged copy is drawn over the dialog, so it has the dialog's background.
              <SortableItem
                key={line.exerciseId}
                value={line.exerciseId}
                className="flex items-center gap-2 rounded-lg bg-popover"
              >
                {/* `touch-none` leaves the touch to the drag instead of scrolling the dialog. */}
                <SortableItemHandle
                  className="flex h-8 w-6 shrink-0 touch-none items-center justify-center text-muted-foreground"
                  aria-label={`Drag ${names.get(line.exerciseId) ?? "exercise"} to reorder`}
                >
                  <GripVerticalIcon className="size-4" />
                </SortableItemHandle>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {names.get(line.exerciseId) ?? "Deleted exercise"}
                </span>
                <Input
                  value={line.sets}
                  onChange={(event) =>
                    setLines(lines.with(index, { ...line, sets: event.target.value }))
                  }
                  inputMode="numeric"
                  aria-label={`Sets of ${names.get(line.exerciseId) ?? "exercise"}`}
                  aria-invalid={counts[index] === null}
                  className="w-12 text-right tabular-nums"
                />
                <span className="text-xs text-muted-foreground">sets</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setLines(lines.toSpliced(index, 1))}
                  className="text-muted-foreground"
                  aria-label={`Remove ${names.get(line.exerciseId) ?? "exercise"}`}
                >
                  <XIcon />
                </Button>
              </SortableItem>
            ))}
          </Sortable>
        )}
        <div className="pt-1">
          <AddExercise
            exercises={exercises}
            taken={new Set(lines.map(({ exerciseId }) => exerciseId))}
            onAdd={addLine}
          />
        </div>
      </div>
      <DialogFooter className="flex-row justify-between sm:justify-between">
        {plan === null ? (
          <span />
        ) : (
          // Asks once more; the sessions done from it are kept.
          <Button
            type="button"
            variant="destructive"
            onClick={deleting ? remove : () => setDeleting(true)}
          >
            {deleting ? "Delete plan?" : "Delete"}
          </Button>
        )}
        <Button type="submit" disabled={!valid}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
