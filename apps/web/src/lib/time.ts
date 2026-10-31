/*
 * Times are shown and entered in the phone's timezone; the server keeps UTC instants, and a recurring schedule keeps
 * the timezone it was set in.
 */

const when = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

const STEPS = [
  { unit: "minute", ms: 60_000, below: 60 },
  { unit: "hour", ms: 3_600_000, below: 24 },
  { unit: "day", ms: 86_400_000, below: 7 },
] as const;

export const formatWhen = (timestamp: number): string => when.format(timestamp);

/** "in 5 min", "2 days ago"; empty beyond a week, where the date says enough. */
export function formatRelative(timestamp: number, now: number): string {
  const delta = timestamp - now;

  for (const { unit, ms, below } of STEPS) {
    const amount = Math.round(delta / ms);

    if (Math.abs(amount) < below) return relative.format(amount, unit);
  }

  return "";
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The value a `datetime-local` input shows for an instant, in the phone's timezone. */
export function toLocalInput(timestamp: number): string {
  const date = new Date(timestamp);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The instant a `datetime-local` value names in the phone's timezone; null when it is empty or invalid. */
export function fromLocalInput(value: string): number | null {
  const timestamp = value === "" ? Number.NaN : new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : null;
}

export const phoneTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
