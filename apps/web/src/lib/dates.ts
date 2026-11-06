/*
 * Calendar dates, YYYY-MM-DD, as the meal prep calendar keeps them: a day, not an instant. Arithmetic runs in UTC, where
 * every day is 24 hours, so a daylight saving change never skips or repeats one.
 */

const pad = (value: number) => String(value).padStart(2, "0");

const day = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const short = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const atMidnight = (date: string) => new Date(`${date}T00:00:00Z`);

/** Today in the phone's timezone. */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const next = atMidnight(date);
  next.setUTCDate(next.getUTCDate() + days);

  return next.toISOString().slice(0, 10);
}

/** The Monday of the date's week. */
export function startOfWeek(date: string): string {
  const weekday = atMidnight(date).getUTCDay();

  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** The seven dates of the week starting on `monday`. */
export const weekOf = (monday: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(monday, index));

/** "Wed, 4 Nov". */
export const formatDay = (date: string): string => day.format(atMidnight(date));

/** "4 Nov". */
export const formatShortDate = (date: string): string => short.format(atMidnight(date));

/** "2 Nov – 8 Nov". */
export const formatDateRange = (from: string, to: string): string =>
  `${short.format(atMidnight(from))} – ${short.format(atMidnight(to))}`;
