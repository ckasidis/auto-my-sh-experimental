import { describe, expect, it } from "vite-plus/test";
import {
  describeRecurrence,
  firstCronRunAt,
  nextRunAt,
  upcomingRuns,
  validateRecurrence,
} from "../src/recurrence.ts";

const weekdays = { cron: "0 9 * * 1-5", timezone: "Asia/Singapore" };
const at = (iso: string) => Date.parse(iso);

describe("cron recurrence", () => {
  it("runs at the expression's local times, skipping the weekend", () => {
    // Friday 6 Nov 2026 09:00 in Singapore is 01:00 UTC; the next weekday run is Monday.
    expect(
      new Date(
        nextRunAt(weekdays, at("2026-11-06T01:00:00Z"), at("2026-11-06T01:00:05Z")),
      ).toISOString(),
    ).toBe("2026-11-09T01:00:00.000Z");
  });

  it("skips runs missed while a delivery was late", () => {
    expect(
      new Date(
        nextRunAt(weekdays, at("2026-11-02T01:00:00Z"), at("2026-11-04T05:00:00Z")),
      ).toISOString(),
    ).toBe("2026-11-05T01:00:00.000Z");
  });

  it("starts at the first match, including one exactly at the start", () => {
    const lastDay = { cron: "0 18 L * *", timezone: "Europe/Vienna" };

    expect(new Date(firstCronRunAt(lastDay, at("2026-11-03T00:00:00Z"))!).toISOString()).toBe(
      "2026-11-30T17:00:00.000Z",
    );
    expect(firstCronRunAt(weekdays, at("2026-11-02T01:00:00Z"))).toBe(at("2026-11-02T01:00:00Z"));
  });

  it("follows daylight saving in the recurrence's timezone", () => {
    const daily = { cron: "0 9 * * *", timezone: "Europe/Vienna" };

    expect(
      upcomingRuns(daily, at("2026-03-28T08:00:00Z"), 2).map((run) => new Date(run).toISOString()),
    ).toEqual(["2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z"]);
  });

  it("refuses expressions it cannot schedule", () => {
    expect(() => validateRecurrence({ cron: "bogus", timezone: "UTC" })).toThrow("five-field");
    expect(() => validateRecurrence({ cron: "* * * * * *", timezone: "UTC" })).toThrow(
      "five-field",
    );
    expect(() => validateRecurrence({ cron: "0 0 30 2 *", timezone: "UTC" })).toThrow("never runs");
    expect(() => validateRecurrence({ cron: "0 9 * * *", timezone: "Mars/Base" })).toThrow(
      "timezone",
    );
    expect(() => validateRecurrence(weekdays)).not.toThrow();
  });

  it("describes both kinds of recurrence", () => {
    expect(describeRecurrence(weekdays)).toBe("At 09:00, Monday through Friday");
    expect(describeRecurrence({ cron: "0 9 * * 2#2", timezone: "UTC" })).toBe(
      "At 09:00, on the second Tuesday of the month",
    );
    expect(describeRecurrence({ cadence: { unit: "week", interval: 2 }, timezone: "UTC" })).toBe(
      "Every 2 weeks",
    );
    expect(describeRecurrence({ cadence: { unit: "day", interval: 1 }, timezone: "UTC" })).toBe(
      "Every day",
    );
  });
});

describe("interval recurrence", () => {
  it("previews runs counted from the first", () => {
    const everyTwoHours = { cadence: { unit: "hour" as const, interval: 2 }, timezone: "UTC" };

    expect(upcomingRuns(everyTwoHours, at("2026-11-01T08:00:00Z"), 3)).toEqual([
      at("2026-11-01T08:00:00Z"),
      at("2026-11-01T10:00:00Z"),
      at("2026-11-01T12:00:00Z"),
    ]);
  });
});
