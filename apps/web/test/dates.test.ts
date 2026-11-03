import { describe, expect, it } from "vite-plus/test";
import { addDays, startOfWeek, today, weekOf } from "../src/lib/dates.ts";

describe("calendar dates", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("starts the week on Monday", () => {
    // 4 Nov 2026 is a Wednesday, 8 Nov a Sunday.
    expect(startOfWeek("2026-11-04")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
    expect(weekOf("2026-11-02")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("reads today in the local timezone", () => {
    expect(today(new Date(2026, 10, 4, 23, 30))).toBe("2026-11-04");
  });
});
