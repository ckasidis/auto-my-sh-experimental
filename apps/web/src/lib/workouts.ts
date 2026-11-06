// Limits match the store's.
export const MAX_SETS = 100;
export const MAX_REPS = 10_000;

/** A whole number from 1 to `max` typed in a field, or null for anything else. */
const count = (text: string, max: number) => {
  const value = Number(text);

  return text.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= max ? value : null;
};

export const parseSets = (text: string) => count(text, MAX_SETS);

export const parseReps = (text: string) => count(text, MAX_REPS);
