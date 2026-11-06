import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCalendarCsv, parseTime, parseDate } from "@/lib/parsers/csv";
import { period } from "./helpers";

describe("Outlook CSV parser", () => {
  const { events, format } = parseCalendarCsv(readFileSync("tests/fixtures/outlook-export.csv", "utf8"), period, { csvDateOrder: "MDY" });
  it("reads the classic Outlook export", () => {
    expect(format).toBe("Outlook CSV export");
    expect(events[0]).toMatchObject({ title: "Acme Corp | Support | Ticket triage, follow-up", date: "2026-11-02", start: "13:00", end: "14:15", minutes: 75, status: "busy" });
    expect(events[1]).toMatchObject({ status: "tentative", minutes: 30 });
    expect(events[2]).toMatchObject({ allDay: true, status: "free" });
  });
  it("parses times and dates", () => {
    expect(parseTime("12:00:00 AM")).toBe("00:00");
    expect(parseTime("12:30 PM")).toBe("12:30");
    expect(parseTime("17:45")).toBe("17:45");
    expect(parseDate("2/11/2026", "DMY")).toBe("2026-11-02");
    expect(parseDate("2026-11-02", "MDY")).toBe("2026-11-02");
    expect(parseDate("13/13/2026", "MDY")).toBeNull();
  });
  it("supports generic Start/End columns", () => {
    const r = parseCalendarCsv("Title,Start,End\nGlobex call,2026-11-03 09:00,2026-11-03 10:30\n", period, { csvDateOrder: "MDY" });
    expect(r.events[0]).toMatchObject({ date: "2026-11-03", start: "09:00", end: "10:30", minutes: 90 });
  });
});
