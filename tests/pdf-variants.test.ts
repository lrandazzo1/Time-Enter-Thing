/**
 * Compatibility of the Outlook agenda parser with other Outlook versions / PDF printers, using synthetic
 * (fictional) fixtures from scripts/make-pdf-variants.mjs, plus the failure classifications:
 * no selectable text, undecodable text, readable-but-unrecognised, partly interpretable.
 */
import { describe, expect, it } from "vitest";
import { AgendaError, NO_TEXT_MESSAGE, PARTIAL_MESSAGE, UNRECOGNIZED_MESSAGE, UNDECODABLE_MESSAGE, buildLines, diagnosticsText, estimateWidth, findDates, maskLine, parseAgenda, textStats, type PdfPageText } from "@/lib/pdf/agenda";
import { ocrToPdfPages } from "@/lib/pdf/extract";
import { eventToEntry } from "@/lib/matching";
import { findOverlaps } from "@/lib/review";
import type { CalendarEvent } from "@/lib/types";
import { pdfPages } from "./pdfHelper";
import { settings } from "./helpers";

const FIX = "tests/fixtures/pdf/";
const rows = (evs: CalendarEvent[]) => evs.map((e) => [e.date, e.start, e.end, e.minutes, e.title, e.allDay ? "all-day" : e.canceled ? "canceled" : ""]);
const parseFile = async (f: string) => {
  const pages = await pdfPages(FIX + f);
  return parseAgenda(pages, { stats: textStats(pages) });
};
const failure = async (f: string) => {
  try {
    await parseFile(f);
  } catch (e) {
    return e as AgendaError;
  }
  throw new Error("expected a failure");
};

describe("date and time notations", () => {
  it.each([
    ["Mon 2026-11-02", "2026-11-02"],
    ["Mon 11/2/2026", "2026-11-02"],
    ["Monday, November 2, 2026", "2026-11-02"],
    ["Mon, Nov 2, 2026", "2026-11-02"],
    ["Monday 2 November 2026", "2026-11-02"],
    ["Tue 03/11/2026", "2026-11-03"], // day-first: the weekday settles it
    ["2-Nov-26", "2026-11-02"],
    ["11.02.2026", "2026-02-11"], // dots = day.month.year
  ])("%s → %s", (text, iso) => expect(findDates(text)[0]?.iso).toBe(iso));
});

describe("Outlook agenda variations (synthetic PDFs)", () => {
  it("1. original layout (regression): unchanged result", async () => {
    const r = await parseFile("agenda-week.pdf");
    expect(r.events.filter((e) => !e.allDay)).toHaveLength(12);
    expect(r.rejected).toEqual([]);
    expect(r.events.every((e) => !e.parseNotes)).toBe(true);
  });

  it("2. alternative date/time formats, bold same-size titles, icons, browser header/footer", async () => {
    const r = await parseFile("variant-alt-dates.pdf");
    expect(r.pages).toBeGreaterThan(1);
    expect(r.period).toEqual({ start: "2026-11-02", end: "2026-11-06" });
    expect(rows(r.events)).toEqual([
      ["2026-11-02", null, null, null, "PTO - Pat Example", "all-day"],
      ["2026-11-02", "09:30", "10:00", 30, "Acme Components | Gears | Forecast model", ""],
      ["2026-11-02", "13:00", "14:30", 90, "Globex Corporation weekly sync", ""],
      ["2026-11-03", "09:00", "10:15", 75, "Smith-Jones Holdings review", ""],
      ["2026-11-03", "15:00", "16:00", 60, "Initech planning", ""],
      ["2026-11-04", "23:00", "24:00", 60, "Late support call", ""],
      ["2026-11-05", "00:00", "00:30", 30, "Late support call", ""],
      ["2026-11-05", "09:30", "11:00", 90, "Budget review", ""],
    ]);
    expect(r.events[0].endDate).toBe("2026-11-06");
    expect(r.rejected).toEqual([]);
    expect(r.diagnostics.titleRules).toEqual({ "bold/other font": 8 });
  });

  it("3–6. titles split into fragments, date and time on separate lines, several events per page, an event spanning pages", async () => {
    const r = await parseFile("variant-split-lines.pdf");
    expect(rows(r.events)).toEqual([
      ["2026-11-02", "09:00", "10:30", 90, "Acme Components | Planning | Kickoff", ""],
      ["2026-11-02", "10:00", "11:00", 60, "Globex Corporation weekly sync", ""],
      ["2026-11-02", "13:00", "14:00", 60, "Canceled: Smith-Jones Holdings review", "canceled"],
      ["2026-11-03", "09:00", "12:00", 180, "Northwind quarterly planning", ""],
      ["2026-11-03", "13:00", "15:00", 120, "Initech integration workshop", ""],
      ["2026-11-04", "08:30", "09:00", 30, "Umbrella Health status", ""],
    ]);
    // The time range inside a description ("9:00 - 9:15 Introductions") is not a meeting.
    expect(r.events.some((e) => /Introductions/.test(e.title))).toBe(false);
    // Several events on page 1; the workshop's title and its date/time are on different pages.
    expect(r.events.filter((e) => e.sourceLabel === "PDF page 1").length).toBeGreaterThanOrEqual(3);
    const lines = buildLines(await pdfPages(FIX + "variant-split-lines.pdf"));
    const t = lines.find((l) => l.text === "Initech integration workshop")!;
    const d = lines.find((l) => l.text === "Tue 11/3/2026" && l.page !== t.page);
    expect(d && d.page).toBe(t.page + 1);
  });

  it("7. canceled meetings are recognised; 8. overlapping meetings are detected", async () => {
    const r = await parseFile("variant-split-lines.pdf");
    const entries = r.events.map((e) => eventToEntry(e, [], settings, []));
    expect(entries.find((e) => e.description.includes("Smith-Jones"))?.included).toBe(false);
    const ov = findOverlaps(entries);
    expect(ov.length).toBe(1);
    expect(ov[0].entryIds.map((id) => entries.find((e) => e.id === id)!.title).sort()).toEqual(["Acme Components | Planning | Kickoff", "Globex Corporation weekly sync"].sort());
  });

  it("classic layout: time column with the title beside it, date from the day heading", async () => {
    const r = await parseFile("variant-classic.pdf");
    expect(rows(r.events)).toEqual([
      ["2026-11-02", "09:00", "10:00", 60, "Acme Components | Gears | Design review", ""],
      ["2026-11-02", "13:00", "14:30", 90, "Globex Corporation weekly sync", ""],
      ["2026-11-03", "10:00", "11:00", 60, "Canceled: Initech status", "canceled"],
      ["2026-11-03", "15:00", "16:00", 60, "Smith-Jones Holdings review", ""],
    ]);
    expect(r.period).toEqual({ start: "2026-11-02", end: "2026-11-03" });
  });

  it("per-glyph text without widths (some PDF printers) reads the same as normal text", async () => {
    const pages = await pdfPages(FIX + "agenda-week.pdf");
    // Position each glyph by real proportional advances, with ±10% per-glyph variation to stand in for
    // a font other than the one the estimate assumes, then drop all widths.
    const glyphs: PdfPageText[] = pages.map((p) => ({
      ...p,
      items: p.items.flatMap((it) => {
        const adv = [...it.str].map((c, k) => estimateWidth(c) * (1 + (((k * 37 + c.charCodeAt(0)) % 21) - 10) / 100));
        const total = adv.reduce((a, b) => a + b, 0) || 1;
        let x = it.x;
        return [...it.str].map((c, k) => {
          const g = { ...it, str: c, x, width: 0 };
          x += (adv[k] / total) * it.width;
          return g;
        });
      }),
    }));
    const a = parseAgenda(pages);
    const b = parseAgenda(glyphs);
    expect(rows(b.events)).toEqual(rows(a.events));
  });

  it("text items delivered in any order give the same result", async () => {
    const pages = await pdfPages(FIX + "variant-alt-dates.pdf");
    const shuffled = pages.map((p) => ({ ...p, items: [...p.items].sort((x, y) => ((x.x * 7 + y.y * 13) % 5) - 2) }));
    expect(rows(parseAgenda(shuffled).events)).toEqual(rows(parseAgenda(pages).events));
  });
});

describe("failures are told apart", () => {
  it("9. no selectable text (image-only PDF)", async () => {
    const e = await failure("variant-image-agenda.pdf");
    expect(e.code).toBe("no-text");
    expect(e.message).toBe(NO_TEXT_MESSAGE);
    expect(e.diagnostics?.stats).toMatchObject({ pages: 1, nonEmptyItems: 0 });
  });

  it("text that can't be decoded into characters", async () => {
    const e = await failure("variant-undecodable.pdf");
    expect(e.code).toBe("undecodable");
    expect(e.message).toBe(UNDECODABLE_MESSAGE);
    expect(e.diagnostics?.stats?.nonEmptyItems).toBeGreaterThan(0);
    expect(e.diagnostics?.stats?.readableRatio).toBeLessThan(0.4);
  });

  it("10. readable text, but no meeting dates/times recognised — with diagnostics", async () => {
    const e = await failure("variant-unrecognized.pdf");
    expect(e.code).toBe("unrecognized");
    expect(e.message).toBe(UNRECOGNIZED_MESSAGE);
    expect(e.diagnostics).toMatchObject({ status: "ok", dayHeadings: 2, candidates: 0, parsed: 0 });
    // Diagnostics never contain meeting content.
    const text = diagnosticsText(e.diagnostics!);
    expect(text).not.toMatch(/Acme|Globex|Smith|Thirty|lunch/i);
    expect(text).toMatch(/day headings: 2/);
  });

  it("the calendar grid is 'unrecognised' with a hint to tick Print detailed agenda", async () => {
    const e = await failure("calendar-grid.pdf");
    expect(e.code).toBe("unrecognized");
    expect(e.message).toMatch(/Print detailed agenda/);
  });

  it("partly interpretable: valid meetings are imported, the rest is listed and flagged", async () => {
    const r = await parseFile("variant-partial.pdf");
    expect(rows(r.events.filter((e) => !e.parseNotes))).toEqual([
      ["2026-11-02", "09:00", "10:00", 60, "Acme Components | Gears | Forecast model", ""],
      ["2026-11-02", "15:00", "16:00", 60, "Globex Corporation weekly sync", ""],
      ["2026-11-03", "10:00", "10:45", 45, "Smith-Jones Holdings review", ""],
    ]);
    expect(r.rejected).toEqual([{ page: 1, text: "Mon 11/2/2026 2:00 PM", reason: "start time without an end time" }]);
    const long = r.events.filter((e) => e.parseNotes);
    expect(long.every((e) => e.title === "Overnight data load" && /hours long/.test(e.parseNotes![0].message))).toBe(true);
    expect(r.diagnostics).toMatchObject({ rejected: 1, rejections: { "start time without an end time": 1 } });
    expect(PARTIAL_MESSAGE).toBe("Some meetings couldn't be interpreted. Review the flagged items before exporting.");
    // Flagged entries carry a review note and are never confirmed automatically.
    const entry = eventToEntry(long[0], [], settings, []);
    expect(entry.notes.some((n) => n.code === "pdf-check" && n.level === "warning")).toBe(true);
    expect(entry.confirmed).toBeFalsy();
  });
});

describe("text recognition output", () => {
  it("OCR lines become items; every meeting read this way is flagged for checking", () => {
    const H = 2000;
    const line = (text: string, y: number, h: number, conf = 92) => ({ text, confidence: conf, x0: 100, y0: y, x1: 100 + text.length * h * 0.5, y1: y + h });
    const pages = ocrToPdfPages([
      {
        width: 1500,
        height: H,
        lines: [
          line("11/2/2026 to 11/3/2026", 100, 30),
          line("Monday, November 2, 2026", 200, 44),
          line("Acme Components | Gears | Forecast model", 300, 38),
          line("Mon 11/2/2026 9:00 AM - 10:30 AM", 345, 30),
          line("Location: Microsoft Teams Meeting", 385, 30),
          line("Globex Corporation weekly sync", 480, 38, 55),
          line("Mon 11/2/2026 1:00 PM - 2:00 PM", 525, 30, 60),
        ],
      },
    ]);
    const r = parseAgenda(pages, { ocr: true });
    expect(rows(r.events)).toEqual([
      ["2026-11-02", "09:00", "10:30", 90, "Acme Components | Gears | Forecast model", ""],
      ["2026-11-02", "13:00", "14:00", 60, "Globex Corporation weekly sync", ""],
    ]);
    expect(r.events.every((e) => e.parseNotes?.[0].message.startsWith("Read with text recognition"))).toBe(true);
    expect(r.events[1].parseNotes![0].message).toMatch(/low confidence/);
    expect(r.diagnostics.method).toBe("ocr");
    expect(r.diagnostics.ocr?.lowConfidenceLines).toBe(2);
  });

  it("masked line shapes keep only the structure", () => {
    expect(maskLine("Mon 11/2/2026 9:30 AM - 10:00 AM")).toBe("Mon 99/9/9999 9:99 AM - 99:99 AM");
    expect(maskLine("Northwind | Acme Workday")).toBe("Aaaa | Aaaa Aaaa");
  });
});
