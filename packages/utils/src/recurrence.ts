import { Cron } from "croner";
import cronstrue from "cronstrue";

/*
 * When a recurring schedule runs next, for both kinds of recurrence: every N units from the first run, or a cron
 * expression on the calendar. The worker, the chat's `schedule` tool and the Mini App's preview all use it, so the
 * times the app shows are the times the assistant delivers. It uses only `Intl` and croner, so it runs in the browser.
 */

type ScheduleCadence = {
  readonly unit: "minute" | "hour" | "day" | "week" | "month";
  readonly interval: number;
};

/** Every N units, counted from the first run. */
export type IntervalRecurrence = {
  readonly cadence: ScheduleCadence;
  /** IANA timezone used to interpret calendar recurrence, including daylight-saving transitions. */
  readonly timezone: string;
};

/** On the calendar: a five-field cron expression (minute hour day month weekday, with croner's `L`, `W` and `#`). */
export type CronRecurrence = {
  readonly cron: string;
  /** IANA timezone the expression's times are read in. */
  readonly timezone: string;
};

export type ScheduleRecurrence = IntervalRecurrence | CronRecurrence;

type LocalDateTime = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const localFormatters = new Map<string, Intl.DateTimeFormat>();

const localFormatter = (timezone: string): Intl.DateTimeFormat => {
  let formatter = localFormatters.get(timezone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
      timeZone: timezone,
      calendar: "iso8601",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    localFormatters.set(timezone, formatter);
  }

  return formatter;
};

const localDateTime = (timestamp: number, timezone: string): LocalDateTime => {
  const fields = Object.fromEntries(
    localFormatter(timezone)
      .formatToParts(timestamp)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );

  return {
    year: fields.year!,
    month: fields.month!,
    day: fields.day!,
    hour: fields.hour!,
    minute: fields.minute!,
    second: fields.second!,
    millisecond: ((timestamp % 1_000) + 1_000) % 1_000,
  };
};

const localEpoch = (value: LocalDateTime): number =>
  Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
    value.millisecond,
  );

const sameLocalDateTime = (left: LocalDateTime, right: LocalDateTime): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second &&
  left.millisecond === right.millisecond;

/** Resolve a local wall-clock time using Temporal-compatible DST disambiguation. */
const localDateTimeToEpoch = (value: LocalDateTime, timezone: string): number => {
  const target = localEpoch(value);
  const offsets = new Set<number>();

  for (const distance of [-2 * DAY_MS, -DAY_MS, 0, DAY_MS, 2 * DAY_MS]) {
    const sample = target + distance;
    offsets.add(localEpoch(localDateTime(sample, timezone)) - sample);
  }

  const candidates = [...offsets].map((offset) => target - offset);

  const exact = candidates
    .filter((candidate) => sameLocalDateTime(localDateTime(candidate, timezone), value))
    .sort((left, right) => left - right);

  if (exact.length > 0) return exact[0]!;

  // A skipped spring-forward time moves ahead by the size of the timezone gap.
  const shifted = candidates
    .flatMap((candidate) => {
      const wallClockDelta = localEpoch(localDateTime(candidate, timezone)) - target;

      return wallClockDelta > 0 ? [{ candidate, wallClockDelta }] : [];
    })
    .sort(
      (left, right) =>
        left.wallClockDelta - right.wallClockDelta || left.candidate - right.candidate,
    );

  if (shifted.length === 0) {
    throw new Error(`Cannot resolve local recurrence deadline in ${timezone}`);
  }

  return shifted[0]!.candidate;
};

const addDays = (value: LocalDateTime, days: number): LocalDateTime => {
  const date = new Date(
    Date.UTC(
      value.year,
      value.month - 1,
      value.day + days,
      value.hour,
      value.minute,
      value.second,
      value.millisecond,
    ),
  );

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
};

const addMonths = (value: LocalDateTime, months: number): LocalDateTime => {
  const monthIndex = value.year * 12 + value.month - 1 + months;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return { ...value, year, month, day: Math.min(value.day, lastDay) };
};

/** First interval deadline after `now`, advanced from the previous scheduled deadline. */
function nextIntervalRunAt(
  previousRunAt: number,
  recurrence: IntervalRecurrence,
  now: number,
): number {
  const { interval, unit } = recurrence.cadence;

  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new Error("recurrence cadence interval must be a positive integer");
  }

  if (unit === "minute" || unit === "hour") {
    const duration = interval * (unit === "minute" ? MINUTE_MS : HOUR_MS);
    const occurrences = Math.max(1, Math.floor((now - previousRunAt) / duration) + 1);
    const next = previousRunAt + occurrences * duration;

    if (!Number.isSafeInteger(next))
      throw new Error("recurrence deadline is outside the safe range");

    return next;
  }

  let local = localDateTime(previousRunAt, recurrence.timezone);

  for (let attempts = 0; attempts < 1_000_000; attempts++) {
    local =
      unit === "month"
        ? addMonths(local, interval)
        : addDays(local, interval * (unit === "week" ? 7 : 1));
    const next = localDateTimeToEpoch(local, recurrence.timezone);

    if (next > now) return next;
    // Continue from the resolved instant so catch-up follows the same sequence as materialized runs.
    local = localDateTime(next, recurrence.timezone);
  }

  throw new Error("recurrence deadline search exceeded its safety limit");
}

export const isCron = (recurrence: ScheduleRecurrence): recurrence is CronRecurrence =>
  "cron" in recurrence;

/** Five fields only: minute-level precision, like the interval recurrence's smallest unit. */
const cronJob = ({ cron, timezone }: CronRecurrence) =>
  new Cron(cron, { timezone, mode: "5-part", paused: true });

const nextCronRunAt = (recurrence: CronRecurrence, after: number): number | null =>
  cronJob(recurrence).nextRun(new Date(after))?.getTime() ?? null;

/**
 * The next deadline of a recurrence after its previous one, skipping any that passed by `now`, so a late delivery does
 * not fire the missed ones in a burst.
 */
export function nextRunAt(
  recurrence: ScheduleRecurrence,
  previousRunAt: number,
  now: number,
): number {
  if (!isCron(recurrence)) return nextIntervalRunAt(previousRunAt, recurrence, now);

  const next = nextCronRunAt(recurrence, Math.max(previousRunAt, now));

  if (next === null) throw new Error(`${JSON.stringify(recurrence.cron)} never runs again`);

  return next;
}

/** The first run of a cron recurrence at or after `from`; null when it never matches. */
export const firstCronRunAt = (recurrence: CronRecurrence, from: number): number | null =>
  nextCronRunAt(recurrence, from - 1);

/** Throws, with a message fit for the owner, unless the recurrence can be scheduled. */
export function validateRecurrence(recurrence: ScheduleRecurrence): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: recurrence.timezone }).format(0);
  } catch (error) {
    throw new Error("recurrence.timezone must be a valid IANA timezone", { cause: error });
  }

  if (!isCron(recurrence)) {
    const { interval } = recurrence.cadence;

    if (!Number.isSafeInteger(interval) || interval < 1 || interval > 10_000) {
      throw new Error("recurrence cadence interval must be an integer from 1 to 10000");
    }

    return;
  }

  let next: number | null;

  try {
    next = nextCronRunAt(recurrence, Date.now());
  } catch (error) {
    throw new Error(
      `${JSON.stringify(recurrence.cron)} is not a five-field cron expression (minute hour day month weekday)`,
      { cause: error },
    );
  }

  if (next === null) throw new Error(`${JSON.stringify(recurrence.cron)} never runs`);
}

/** `count` runs of a recurrence, starting with `first`. */
export function upcomingRuns(
  recurrence: ScheduleRecurrence,
  first: number,
  count: number,
): number[] {
  const runs = [first];

  while (runs.length < count) {
    const previous = runs.at(-1)!;

    runs.push(nextRunAt(recurrence, previous, previous));
  }

  return runs;
}

/** "Every 2 weeks", "At 09:00, Monday through Friday"; the expression itself when cronstrue cannot read it. */
export function describeRecurrence(recurrence: ScheduleRecurrence): string {
  if (isCron(recurrence)) {
    try {
      return cronstrue.toString(recurrence.cron, { use24HourTimeFormat: true });
    } catch {
      return recurrence.cron;
    }
  }

  const { interval, unit } = recurrence.cadence;

  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

/** A plain copy, without anything else a stored or RPC value carries. */
export function copyRecurrence(recurrence: ScheduleRecurrence): ScheduleRecurrence {
  if (isCron(recurrence)) return { cron: recurrence.cron, timezone: recurrence.timezone };

  const { unit, interval } = recurrence.cadence;

  return { cadence: { unit, interval }, timezone: recurrence.timezone };
}
