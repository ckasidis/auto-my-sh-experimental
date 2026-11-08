import type { Transaction } from "@tanstack/react-db";
import type { Exercise } from "assistant/workout-log";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Choice } from "@/components/choice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exerciseCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";
import { nameTaken } from "@/lib/names";

/** An exercise typed in by name, with the insert that adds it. */
export type AddedExercise = { readonly id: string; readonly insert: Transaction };

/** The added exercises the server refused, once every insert has settled; a save leaves them out. */
export async function refusedExercises(added: readonly AddedExercise[]): Promise<Set<string>> {
  const refused = new Set<string>();

  await Promise.all(
    added.map(({ id, insert }) => insert.when("settled").catch(() => refused.add(id))),
  );

  return refused;
}

/** The picker's option for an exercise typed in instead. */
const NEW_EXERCISE = "new";

/**
 * Picks an exercise to add to a plan or a workout, from those not on it yet, or a new one typed by name, which is
 * added to the exercises at once. `onAdd` gets the new one's insert too: the server refuses a plan or session of an
 * exercise it does not have yet, so a save waits for it.
 */
export function AddExercise({
  exercises,
  taken,
  onAdd,
}: {
  /** Every exercise, by name. */
  readonly exercises: readonly Exercise[];
  /** The exercises already on the plan or workout. */
  readonly taken: ReadonlySet<string>;
  readonly onAdd: (exerciseId: string, insert?: Transaction) => void;
}) {
  const [choice, setChoice] = useState(NEW_EXERCISE);
  const [newName, setNewName] = useState("");
  const left = exercises.filter(({ id }) => !taken.has(id));

  const items = {
    ...Object.fromEntries(left.map(({ id, name }) => [id, name])),
    [NEW_EXERCISE]: "New exercise…",
  };

  // A choice added meanwhile falls back to the first left.
  const chosen = choice in items ? choice : (left[0]?.id ?? NEW_EXERCISE);
  const adding = chosen === NEW_EXERCISE;
  const named = adding && nameTaken(newName, exercises);
  const canAdd = !adding || (newName.trim() !== "" && !named);

  const add = () => {
    if (!canAdd) return;

    if (!adding) {
      onAdd(chosen);

      return;
    }

    const id = `exercise:app:${crypto.randomUUID()}`;
    const insert = exerciseCollection.insert({ id, name: newName.trim(), createdAt: Date.now() });

    follow(insert);
    setNewName("");
    onAdd(id, insert);
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex gap-2">
        <Choice items={items} value={chosen} onChange={setChoice} label="Exercise to add" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={add}
          disabled={!canAdd}
          aria-label="Add exercise"
        >
          <PlusIcon />
        </Button>
      </div>
      {adding && (
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds the exercise instead of submitting the form around it.
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Exercise name, like Squat"
          maxLength={200}
          aria-label="New exercise"
          aria-invalid={named}
        />
      )}
      {named && <p className="text-xs text-destructive">Already on the list.</p>}
    </div>
  );
}
