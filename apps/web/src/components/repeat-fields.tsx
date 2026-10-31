import { Choice } from "@/components/choice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MonthlyKind, RepeatForm, RepeatKind, Unit } from "@/lib/repeat";
import { toLocalInput } from "@/lib/time";
import { cn } from "@/lib/utils";

const KINDS = {
  never: "Never",
  interval: "Every…",
  weekly: "Days of the week",
  monthly: "Monthly",
  cron: "Custom (cron)",
} satisfies Record<RepeatKind, string>;

const UNITS = {
  minute: "Minutes",
  hour: "Hours",
  day: "Days",
  week: "Weeks",
  month: "Months",
} satisfies Record<Unit, string>;

const MONTHLY = {
  day: "On day",
  last: "On the last day",
  nth: "On the",
} satisfies Record<MonthlyKind, string>;

const NTH = { "1": "First", "2": "Second", "3": "Third", "4": "Fourth" };

const WEEKDAY_NAMES = {
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
  "0": "Sunday",
};

/** Monday first, as the chips are laid out. */
const DAY_CHIPS = [
  [1, "M", "Monday"],
  [2, "T", "Tuesday"],
  [3, "W", "Wednesday"],
  [4, "T", "Thursday"],
  [5, "F", "Friday"],
  [6, "S", "Saturday"],
  [0, "S", "Sunday"],
] as const;

/** The repeat part of the new-schedule form: when it runs, and how it recurs. */
export function RepeatFields({
  form,
  onChange,
}: {
  readonly form: RepeatForm;
  readonly onChange: (changes: Partial<RepeatForm>) => void;
}) {
  const toggleDay = (day: number) =>
    onChange({
      days: form.days.includes(day)
        ? form.days.filter((other) => other !== day)
        : [...form.days, day],
    });

  return (
    <>
      <div className="grid gap-1.5">
        <Label>Repeat</Label>
        <Choice
          label="Repeat"
          items={KINDS}
          value={form.kind}
          onChange={(kind) => onChange({ kind })}
        />
      </div>

      {(form.kind === "never" || form.kind === "interval") && (
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-at">{form.kind === "never" ? "At" : "First at"}</Label>
          <Input
            id="schedule-at"
            type="datetime-local"
            value={form.at}
            min={toLocalInput(Date.now())}
            onChange={(event) => onChange({ at: event.target.value })}
          />
        </div>
      )}

      {form.kind === "interval" && (
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-interval">Every</Label>
          <div className="flex gap-2">
            <Input
              id="schedule-interval"
              type="number"
              inputMode="numeric"
              min={1}
              max={10_000}
              value={form.interval}
              onChange={(event) => onChange({ interval: event.target.value })}
              className="w-20"
            />
            <Choice
              label="Unit"
              items={UNITS}
              value={form.unit}
              onChange={(unit) => onChange({ unit })}
            />
          </div>
        </div>
      )}

      {form.kind === "weekly" && (
        <div className="grid gap-1.5">
          <Label>On</Label>
          <div className="flex justify-between gap-1">
            {DAY_CHIPS.map(([day, letter, name]) => (
              <button
                key={day}
                type="button"
                aria-label={name}
                aria-pressed={form.days.includes(day)}
                onClick={() => toggleDay(day)}
                className={cn(
                  "size-9 rounded-full text-sm font-medium transition-colors",
                  form.days.includes(day)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
      )}

      {form.kind === "monthly" && (
        <div className="grid gap-1.5">
          <Label>Day</Label>
          <Choice
            label="Day of the month"
            items={MONTHLY}
            value={form.monthly}
            onChange={(monthly) => onChange({ monthly })}
          />
          {form.monthly === "day" && (
            <Input
              aria-label="Day of the month"
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={form.monthDay}
              onChange={(event) => onChange({ monthDay: event.target.value })}
            />
          )}
          {form.monthly === "nth" && (
            <div className="flex gap-2">
              <Choice
                label="Which"
                items={NTH}
                value={form.nth}
                onChange={(nth) => onChange({ nth })}
              />
              <Choice
                label="Weekday"
                items={WEEKDAY_NAMES}
                value={form.weekday}
                onChange={(weekday) => onChange({ weekday })}
              />
            </div>
          )}
        </div>
      )}

      {(form.kind === "weekly" || form.kind === "monthly") && (
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-time">Time</Label>
          <Input
            id="schedule-time"
            type="time"
            value={form.time}
            onChange={(event) => onChange({ time: event.target.value })}
          />
        </div>
      )}

      {form.kind === "cron" && (
        <div className="grid gap-1.5">
          <Label htmlFor="schedule-cron">Cron expression</Label>
          <Input
            id="schedule-cron"
            value={form.cron}
            onChange={(event) => onChange({ cron: event.target.value })}
            placeholder="0 9 * * 1-5"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            minute hour day month weekday. <code>L</code> is the last day, <code>2#1</code> the
            first Tuesday.
          </p>
        </div>
      )}
    </>
  );
}
