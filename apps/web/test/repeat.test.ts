import { describe, expect, it } from "vite-plus/test";
import { planRepeat, type RepeatForm } from "../src/lib/repeat.ts";

const NOW = Date.parse("2026-11-03T00:00:00Z");
const TIMEZONE = "Asia/Singapore";

const form = (changes: Partial<RepeatForm>): RepeatForm => ({
  kind: "never",
  at: "",
  interval: "1",
  unit: "day",
  days: [1, 2, 3, 4, 5],
  time: "09:00",
  monthly: "day",
  monthDay: "15",
  nth: "1",
  weekday: "1",
  cron: "0 9 * * 1-5",
  ...changes,
});

const cronOf = (changes: Partial<RepeatForm>) => {
  const plan = planRepeat(form(changes), TIMEZONE, NOW);

  return plan.ok && plan.recurrence !== undefined && "cron" in plan.recurrence
    ? plan.recurrence.cron
    : plan;
};

describe("the new-schedule form", () => {
  it("builds cron expressions from the days of the week", () => {
    expect(cronOf({ kind: "weekly" })).toBe("0 9 * * 1-5");
    expect(cronOf({ kind: "weekly", days: [4, 1], time: "18:30" })).toBe("30 18 * * 1,4");
    expect(cronOf({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6] })).toBe("0 9 * * *");
    expect(cronOf({ kind: "weekly", days: [] })).toEqual({
      ok: false,
      error: "Choose at least one day",
    });
  });

  it("builds monthly cron expressions", () => {
    expect(cronOf({ kind: "monthly" })).toBe("0 9 15 * *");
    expect(cronOf({ kind: "monthly", monthly: "last", time: "07:05" })).toBe("5 7 L * *");
    expect(cronOf({ kind: "monthly", monthly: "nth", nth: "2", weekday: "2" })).toBe("0 9 * * 2#2");
    expect(cronOf({ kind: "monthly", monthDay: "32" })).toEqual({
      ok: false,
      error: "Choose a day of the month from 1 to 31",
    });
  });

  it("checks a custom expression and starts at its first match", () => {
    expect(planRepeat(form({ kind: "cron", cron: " 0  9 * * 1-5 " }), TIMEZONE, NOW)).toEqual({
      ok: true,
      // Tuesday 3 Nov 09:00 in Singapore.
      runAt: Date.parse("2026-11-03T01:00:00Z"),
      recurrence: { cron: "0 9 * * 1-5", timezone: TIMEZONE },
    });

    const invalid = planRepeat(form({ kind: "cron", cron: "every day" }), TIMEZONE, NOW);

    expect(invalid.ok).toBe(false);
  });

  it("needs a future time for a single run or an interval", () => {
    expect(planRepeat(form({ kind: "never", at: "" }), TIMEZONE, NOW)).toEqual({
      ok: false,
      error: "Choose a date and time",
    });
    expect(planRepeat(form({ kind: "interval", at: "2020-01-01T09:00" }), TIMEZONE, NOW)).toEqual({
      ok: false,
      error: "Choose a time in the future",
    });
  });
});
