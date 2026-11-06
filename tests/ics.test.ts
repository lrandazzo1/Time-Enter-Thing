import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIcs } from "@/lib/parsers/ics";
import { period } from "./helpers";

const ics = readFileSync("tests/fixtures/outlook-week.ics", "utf8");

describe("ICS parser", () => {
  const { events, warnings } = parseIcs(ics, period, "America/Chicago");
  const titled = (t: string) => events.filter((e) => e.title === t);

  it("parses Windows TZIDs and converts to the target zone", () => {
    const e = titled("Acme Corp | Planning | Model build")[0];
    expect(e).toMatchObject({ date: "2026-11-02", start: "09:00", end: "12:30", minutes: 210, status: "busy" });
    expect(warnings).toEqual([]);
  });

  it("converts UTC times and keeps tentative status", () => {
    expect(titled("Globex workshop")[0]).toMatchObject({ date: "2026-11-03", start: "13:00", end: "14:30", status: "tentative" });
  });

  it("expands recurrences with EXDATE, moved and cancelled occurrences, limited to the period", () => {
    const s = titled("Daily internal standup");
    const byDate = Object.fromEntries(s.map((e) => [e.date, e]));
    expect(Object.keys(byDate).sort()).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"]);
    expect(byDate["2026-11-02"]).toMatchObject({ start: "08:30", end: "08:45", recurring: true });
    expect(byDate["2026-11-03"]).toMatchObject({ start: "10:00", end: "10:15" });
    expect(byDate["2026-11-05"].canceled).toBe(true);
  });

  it("flags cancelled and all-day events and filters out-of-period events", () => {
    expect(titled("Canceled: Acme Corp review")[0].canceled).toBe(true);
    expect(titled("PTO - someone")[0]).toMatchObject({ allDay: true, status: "free" });
    expect(titled("Acme Corp | Planning | Next week")).toHaveLength(0);
  });

  it("reports times in another zone when asked", () => {
    const ny = parseIcs(ics, period, "America/New_York").events.find((e) => e.title.startsWith("Acme Corp | Planning | Model"));
    expect(ny).toMatchObject({ start: "10:00", end: "13:30" });
  });

  it("rejects non-calendar files", () => {
    expect(() => parseIcs("hello", period, "America/Chicago")).toThrow();
  });
});
