import {
  firstCronRunAt,
  type IntervalRecurrence,
  type ScheduleRecurrence,
  validateRecurrence,
} from "utils/recurrence";
import { fromLocalInput } from "./time";

export type Unit = IntervalRecurrence["cadence"]["unit"];

export type RepeatKind = "never" | "interval" | "weekly" | "monthly" | "cron";

export type MonthlyKind = "day" | "last" | "nth";

/** The new-schedule form's repeat fields, as the inputs hold them. */
export type RepeatForm = {
  readonly kind: RepeatKind;
  /** `datetime-local` value: the run, or the first of an interval. */
  readonly at: string;
  readonly interval: string;
  readonly unit: Unit;
  /** Days of the week, 0 (Sunday) to 6. */
  readonly days: readonly number[];
  /** `time` value (HH:MM) for weekly and monthly runs. */
  readonly time: string;
  readonly monthly: MonthlyKind;
  readonly monthDay: string;
  /** 1 to 4: first to fourth weekday of the month. */
  readonly nth: string;
  readonly weekday: string;
  readonly cron: string;
};

/** What the form schedules: the first run, and the recurrence after it. */
export type RepeatPlan =
  | { readonly ok: true; readonly runAt: number; readonly recurrence?: ScheduleRecurrence }
  | { readonly ok: false; readonly error: string };

const failed = (error: string): RepeatPlan => ({ ok: false, error });

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

const sameDays = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((day, index) => day === right[index]);

/** The weekday field of a cron expression: `*`, `1-5`, or a list. */
function cronDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((left, right) => left - right);

  if (sameDays(sorted, ALL_DAYS)) return "*";

  if (sameDays(sorted, WEEKDAYS)) return "1-5";

  return sorted.join(",");
}

/** "minute hour" for a `time` value; null when it is not one. */
function cronTime(time: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);

  if (match === null) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  return hour < 24 && minute < 60 ? `${minute} ${hour}` : null;
}

/** The cron expression the weekly, monthly or custom fields describe, or why there is none. */
function cronExpression(form: RepeatForm): { cron: string } | { error: string } {
  if (form.kind === "cron") {
    const cron = form.cron.trim().replace(/\s+/g, " ");

    return cron === "" ? { error: "Enter a cron expression" } : { cron };
  }

  const time = cronTime(form.time);

  if (time === null) return { error: "Choose a time" };

  if (form.kind === "weekly") {
    return form.days.length === 0
      ? { error: "Choose at least one day" }
      : { cron: `${time} * * ${cronDays(form.days)}` };
  }

  if (form.monthly === "last") return { cron: `${time} L * *` };

  if (form.monthly === "nth")
    return { cron: `${time} * * ${Number(form.weekday)}#${Number(form.nth)}` };

  const day = Number(form.monthDay);

  return Number.isSafeInteger(day) && day >= 1 && day <= 31
    ? { cron: `${time} ${day} * *` }
    : { error: "Choose a day of the month from 1 to 31" };
}

/**
 * The schedule the form describes, read in `timezone`, or what is wrong with it. Cron times come from the expression,
 * so their first run is the first match after `now`; the server computes it again on its own.
 */
export function planRepeat(form: RepeatForm, timezone: string, now: number): RepeatPlan {
  if (form.kind === "never" || form.kind === "interval") {
    const runAt = fromLocalInput(form.at);

    if (runAt === null) return failed("Choose a date and time");

    if (runAt <= now) return failed("Choose a time in the future");

    if (form.kind === "never") return { ok: true, runAt };

    const recurrence: ScheduleRecurrence = {
      cadence: { unit: form.unit, interval: Number(form.interval) },
      timezone,
    };

    try {
      validateRecurrence(recurrence);
    } catch {
      return failed("Repeat every 1 to 10000");
    }

    return { ok: true, runAt, recurrence };
  }

  const expression = cronExpression(form);

  if ("error" in expression) return failed(expression.error);

  const recurrence: ScheduleRecurrence = { cron: expression.cron, timezone };

  try {
    validateRecurrence(recurrence);
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }

  const runAt = firstCronRunAt(recurrence, now + 1);

  return runAt === null ? failed("This never runs") : { ok: true, runAt, recurrence };
}
