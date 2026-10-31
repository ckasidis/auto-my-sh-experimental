/** Without an explicit offset, `Date.parse` reads a date-time in the runtime's timezone, which is UTC on Workers. */
const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:\d{2})$/i;

/** An ISO 8601 date-time with a timezone offset as Unix milliseconds; null when it has no offset or does not parse. */
export function parseOffsetDateTime(text: string): number | null {
  if (!OFFSET_SUFFIX.test(text)) return null;

  const time = Date.parse(text);

  return Number.isFinite(time) ? time : null;
}
