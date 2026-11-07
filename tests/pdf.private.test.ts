/**
 * Optional check against a real Outlook Detailed agenda PDF that is NOT stored in the repository.
 * Run with: OUTLOOK_PDF=/path/to/calendar.pdf npx vitest run tests/pdf.private.test.ts
 * Assertions are structural so no calendar data needs to live in this file.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgenda } from "@/lib/pdf/agenda";
import { pdfPages } from "./pdfHelper";

const file = process.env.OUTLOOK_PDF ?? "";
describe.skipIf(!file || !existsSync(file))("real Outlook Detailed agenda PDF (local only)", () => {
  it("parses every meeting cleanly", async () => {
    const r = parseAgenda(await pdfPages(file));
    const timed = r.events.filter((e) => !e.allDay);
    console.log(JSON.stringify({ pages: r.pages, period: r.period, headings: r.dayHeadings, timed: timed.length, allDay: r.events.length - timed.length, canceled: r.events.filter((e) => e.canceled).length, duplicatesRemoved: r.duplicatesRemoved.length, warnings: r.warnings }));
    expect(timed.length).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]);
    expect(timed.every((e) => (e.minutes ?? 0) > 0 && e.start && e.end)).toBe(true);
    expect(r.events.every((e) => e.title.length > 2 && !/^(Location|Organizer|Required Attendees|Join|Passcode|Meeting ID|Microsoft Teams meeting)\b/i.test(e.title))).toBe(true);
    expect(r.events.filter((e) => e.canceled).every((e) => /^cancel+ed:/i.test(e.title))).toBe(true);
    const allDayKeys = r.events.filter((e) => e.allDay).map((e) => `${e.title}|${e.date}|${e.endDate}`);
    expect(new Set(allDayKeys).size).toBe(allDayKeys.length);
    expect(r.events.every((e) => !/teams\.microsoft|passcode:\s*\w{4}/i.test(e.sourceText ?? ""))).toBe(true);
  });
});
