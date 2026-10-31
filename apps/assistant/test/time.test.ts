import { describe, expect, it } from "vite-plus/test";
import { parseOffsetDateTime } from "../src/lib/time.ts";

describe("parseOffsetDateTime", () => {
  it("reads a date-time with a UTC or numeric offset", () => {
    expect(parseOffsetDateTime("2026-11-02T01:00:00Z")).toBe(Date.UTC(2026, 10, 2, 1));
    expect(parseOffsetDateTime("2026-11-02T09:00:00+08:00")).toBe(Date.UTC(2026, 10, 2, 1));
  });

  it("refuses a date-time without an offset, which would be read in UTC", () => {
    expect(parseOffsetDateTime("2026-11-02T09:00:00")).toBeNull();
  });

  it("refuses text that does not parse", () => {
    expect(parseOffsetDateTime("tomorrow+08:00")).toBeNull();
  });
});
