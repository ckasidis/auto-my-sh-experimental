import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPTY_ROW, type ExerciseRows, rowSet, type SetRow } from "@/lib/workouts";
import type { LoggedSet } from "utils/workouts";

/** What each row showed last time, to show in its empty fields; undefined for a set never done. */
export type PreviousSets = {
  readonly warmups: readonly (LoggedSet | undefined)[];
  readonly sets: readonly (LoggedSet | undefined)[];
};

/**
 * One exercise's sets in a workout: its warm-ups, marked W, then its working sets, numbered. A row left empty is a set
 * skipped, and any row can be removed. With `previous`, empty fields show what that set was last time.
 */
export function ExerciseSetRows({
  name,
  rows,
  previous,
  onChange,
}: {
  readonly name: string;
  readonly rows: ExerciseRows;
  readonly previous?: PreviousSets;
  readonly onChange: (rows: ExerciseRows) => void;
}) {
  const setWarmup = (index: number, row: SetRow) =>
    onChange({ ...rows, warmups: rows.warmups.with(index, row) });

  const setWorking = (index: number, row: SetRow) =>
    onChange({ ...rows, sets: rows.sets.with(index, row) });

  return (
    <section className="grid gap-2 rounded-xl bg-card p-3">
      <h3 className="font-medium">{name}</h3>
      <div className="grid gap-1.5">
        {rows.warmups.map((row, index) => (
          <Row
            // Rows are only added at the end or removed, so their place names them.
            key={`warmup:${index}`}
            label="W"
            description={`${name} warm-up ${index + 1}`}
            row={row}
            previous={previous?.warmups[index]}
            onChange={(next) => setWarmup(index, next)}
            onRemove={() => onChange({ ...rows, warmups: rows.warmups.toSpliced(index, 1) })}
          />
        ))}
        {rows.sets.map((row, index) => (
          <Row
            key={`set:${index}`}
            label={String(index + 1)}
            description={`${name} set ${index + 1}`}
            row={row}
            previous={previous?.sets[index]}
            onChange={(next) => setWorking(index, next)}
            onRemove={() => onChange({ ...rows, sets: rows.sets.toSpliced(index, 1) })}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...rows, warmups: [...rows.warmups, EMPTY_ROW] })}
        >
          <PlusIcon />
          Warm-up
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...rows, sets: [...rows.sets, EMPTY_ROW] })}
        >
          <PlusIcon />
          Set
        </Button>
      </div>
    </section>
  );
}

function Row({
  label,
  description,
  row,
  previous,
  onChange,
  onRemove,
}: {
  readonly label: string;
  readonly description: string;
  readonly row: SetRow;
  readonly previous: LoggedSet | undefined;
  readonly onChange: (row: SetRow) => void;
  readonly onRemove: () => void;
}) {
  const invalid = rowSet(row) === null;

  return (
    <div className="flex items-center gap-2">
      <span className="w-5 text-center text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        value={row.weight}
        onChange={(event) => onChange({ ...row, weight: event.target.value })}
        inputMode="decimal"
        placeholder={previous?.weight == null ? "–" : String(previous.weight)}
        aria-label={`${description} weight in kg`}
        aria-invalid={invalid}
        className="w-20 text-right tabular-nums"
      />
      <span className="text-xs text-muted-foreground">kg ×</span>
      <Input
        value={row.reps}
        onChange={(event) => onChange({ ...row, reps: event.target.value })}
        inputMode="numeric"
        placeholder={previous === undefined ? "reps" : String(previous.reps)}
        aria-label={`${description} reps`}
        aria-invalid={invalid}
        className="w-16 text-right tabular-nums"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        className="text-muted-foreground"
        aria-label={`Remove ${description}`}
      >
        <XIcon />
      </Button>
    </div>
  );
}
