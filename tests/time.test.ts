import { describe, expect, it } from "vitest";
import { formatDecimalHours, parseHoursInput, zonedToInstant, instantToZoned } from "@/lib/time";

describe("decimal hours", () => {
  it.each([
    [15, "0.25"], [30, "0.50"], [45, "0.75"], [60, "1.00"], [90, "1.50"], [135, "2.25"],
    [180, "3.00"], [210, "3.50"], [225, "3.75"], [480, "8.00"], [110, "1.83"], [100, "1.67"], [5, "0.08"],
  ])("%i minutes -> %s", (m, s) => expect(formatDecimalHours(m)).toBe(s));

  it("never produces H:MM", () => {
    for (let m = 1; m <= 1440; m++) expect(formatDecimalHours(m)).toMatch(/^\d+\.\d{2}$/);
  });

  it("parses user input", () => {
    expect(parseHoursInput("3.5")).toBe(210);
    expect(parseHoursInput("3:30")).toBe(210);
    expect(parseHoursInput(".75")).toBe(45);
    expect(parseHoursInput("1,5")).toBe(90);
    expect(parseHoursInput("abc")).toBeNull();
    expect(parseHoursInput("")).toBeNull();
  });
});

describe("time zones", () => {
  it("round-trips across DST", () => {
    const i = zonedToInstant({ year: 2026, month: 11, day: 2, hour: 9, minute: 0, second: 0 }, "America/Chicago");
    expect(i.toISOString()).toBe("2026-11-02T15:00:00.000Z"); // CST, UTC-6 after Nov 1
    const j = zonedToInstant({ year: 2026, month: 10, day: 30, hour: 9, minute: 0, second: 0 }, "America/Chicago");
    expect(j.toISOString()).toBe("2026-10-30T14:00:00.000Z"); // CDT, UTC-5
    expect(instantToZoned(i, "America/New_York")).toEqual({ date: "2026-11-02", time: "10:00" });
  });
});
