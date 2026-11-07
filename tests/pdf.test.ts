import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AgendaError, NO_TEXT_MESSAGE, parseAgenda, parseClock, parseDateText, redact, type PdfPageText } from "@/lib/pdf/agenda";
import { eventToEntry } from "@/lib/matching";
import { findOverlaps, keepOneInOverlap, validate } from "@/lib/review";
import { buildCsv } from "@/lib/exporters";
import { bigTimeExporter } from "@/lib/exporters/bigtime";
import { formatDecimalHours } from "@/lib/time";
import type { ProjectMapping, TimeEntry } from "@/lib/types";
import { pdfPages } from "./pdfHelper";
import { settings } from "./helpers";

const FIX = "tests/fixtures/pdf/";

describe("time and date parsing", () => {
  it.each([
    ["9:30 AM", 570], ["12:00 PM", 720], ["12:30 AM", 30], ["1:30 PM", 810], ["11:50 AM", 710], ["13:45", 825], ["9.30 a.m.", 570], ["0:00", 0],
  ])("%s → %i", (s, m) => expect(parseClock(s)).toBe(m));
  it("rejects nonsense", () => {
    expect(parseClock("13:00 PM")).toBeNull();
    expect(parseClock("9:75 AM")).toBeNull();
  });
  it("dates", () => {
    expect(parseDateText("2026-11-03")).toBe("2026-11-03");
    expect(parseDateText("11/3/2026")).toBe("2026-11-03");
    expect(parseDateText("3/11/2026", "DMY")).toBe("2026-11-03");
    expect(parseDateText("2026-02-30")).toBeNull();
  });
  it("redacts links, passcodes, phone numbers and e-mail addresses", () => {
    const r = redact("Join: https://teams.microsoft.com/meet/1?p=x\nPasscode: Xy7abc\nMeeting ID: 225 827 538\n+1 555-010-0199,,123# US\nPat <pat@acme.example>");
    expect(r).not.toMatch(/teams\.microsoft|Xy7abc|225 827|555-010|pat@/);
    expect(r).toContain("…@acme.example");
  });
});

describe("Outlook Detailed agenda PDF (synthetic, multi-page)", async () => {
  const pages = await pdfPages(FIX + "agenda-week.pdf");
  const r = parseAgenda(pages);
  const timed = r.events.filter((e) => !e.allDay);
  const byTitle = (t: string) => r.events.filter((e) => e.title === t);

  it("spans several pages and reads the printed range", () => {
    expect(pages.length).toBeGreaterThan(3);
    expect(r.period).toEqual({ start: "2026-11-01", end: "2026-11-07" });
    expect(r.dayHeadings).toBe(5);
  });
  it("extracts every timed meeting with full titles, dates and exact times — and nothing else", () => {
    expect(timed.map((e) => [e.date, e.start, e.end, e.minutes, e.title])).toEqual([
      ["2026-11-02", "09:00", "12:30", 210, "Acme Components | Gears | Forecast model"],
      ["2026-11-02", "10:00", "11:00", 60, "Canceled: Acme Components | Planning | Review"],
      ["2026-11-02", "12:00", "13:00", 60, "Globex Corporation weekly sync"],
      ["2026-11-03", "09:30", "10:00", 30, "Northwind | Kite Mills: Rules Working Session"],
      ["2026-11-03", "10:00", "11:50", 110, "Smith-Jones Holdings quarterly forecast deep dive and budget reconciliation working session with the finance leadership team"],
      ["2026-11-03", "13:00", "14:00", 60, "Budget model revenue planning"],
      ["2026-11-04", "10:30", "11:00", 30, "TFAG Internal Status"],
      ["2026-11-04", "11:30", "13:15", 105, "Lunch & learn: forecasting tips"],
      ["2026-11-04", "23:00", "24:00", 60, "Late support call"],
      ["2026-11-05", "00:00", "00:30", 30, "Late support call"],
      ["2026-11-05", "13:00", "14:00", 60, "KM & Northwind / Gears Requirement Session"],
      ["2026-11-05", "15:00", "16:00", 60, "Globex - Preparing for Meeting"],
    ]);
    const all = r.events.map((e) => e.title).join("\n");
    expect(all).not.toMatch(/Microsoft Teams meeting|Join:|Passcode|Dial in|confidential|Required Attendees|Find a local number|___/i);
  });
  it("computes durations from minutes (110 → 1.83, 105 → 1.75)", () => {
    expect(formatDecimalHours(timed[4].minutes!)).toBe("1.83");
    expect(formatDecimalHours(byTitle("Lunch & learn: forecasting tips")[0].minutes!)).toBe("1.75");
  });
  it("marks canceled meetings", () => {
    expect(r.events.filter((e) => e.canceled).map((e) => e.title)).toEqual(["Canceled: Acme Components | Planning | Review"]);
  });
  it("collapses multi-day all-day events repeated under every day, keeps single all-day events", () => {
    expect(byTitle("PTO - Pat Example")).toHaveLength(1);
    expect(byTitle("PTO - Pat Example")[0]).toMatchObject({ allDay: true, date: "2026-11-02", endDate: "2026-11-06", minutes: null });
    expect(byTitle("Company Holiday")[0]).toMatchObject({ allDay: true, date: "2026-11-05" });
  });
  it("removes an identical meeting printed twice and reports it", () => {
    expect(byTitle("Budget model revenue planning")).toHaveLength(1);
    expect(r.duplicatesRemoved).toEqual([{ title: "Budget model revenue planning", date: "2026-11-03", start: "13:00" }]);
  });
  it("splits a meeting that crosses midnight by work date", () => {
    expect(byTitle("Late support call").map((e) => [e.date, e.minutes, e.crossesMidnight])).toEqual([["2026-11-04", 60, true], ["2026-11-05", 30, true]]);
  });
  it("keeps organizer, location and client e-mail domains; drops the user's own domain", () => {
    expect(byTitle("Globex Corporation weekly sync")[0]).toMatchObject({ organizer: "Globex Corporation", location: "Microsoft Teams Meeting", domains: ["globex.example"] });
    expect(r.events.every((e) => !e.domains?.includes("ourfirm.example"))).toBe(true);
  });
  it("keeps a redacted source snippet for troubleshooting", () => {
    const src = byTitle("Globex Corporation weekly sync")[0].sourceText!;
    expect(src).toContain("Mon 2026-11-02 12:00 PM - 1:00 PM");
    expect(src).not.toMatch(/teams\.microsoft|Passcode|person1@/);
  });
  it("does not depend on the order text items come out of the PDF", () => {
    const shuffled = pages.map((p) => ({ ...p, items: [...p.items].sort((a, b) => ((a.x * 7919 + a.y * 104729) % 97) - ((b.x * 7919 + b.y * 104729) % 97)) }));
    expect(parseAgenda(shuffled).events.map((e) => [e.date, e.start, e.title])).toEqual(r.events.map((e) => [e.date, e.start, e.title]));
  });
});

describe("page boundaries and edge layouts (constructed pages)", () => {
  const item = (str: string, y: number, size = 10, font = "body") => ({ str, x: 40, y, width: str.length * size * 0.5, size, font });
  it("joins a title at the bottom of one page with its time line at the top of the next", () => {
    const pages: PdfPageText[] = [
      { page: 1, width: 612, height: 792, items: [item("Tuesday, November 03, 2026", 700, 14, "bold"), item("A very long meeting title that wraps onto a", 40, 12, "bold"), item("second line at the page bottom", 26, 12, "bold")] },
      { page: 2, width: 612, height: 792, items: [item("Tue 2026-11-03 11:00 AM - 1:00 PM", 770), item("Organizer: Someone", 750)] },
    ];
    const r = parseAgenda(pages);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ title: "A very long meeting title that wraps onto a second line at the page bottom", start: "11:00", end: "13:00", minutes: 120 });
  });
  it("handles an end time without AM/PM change, an end time past midnight without a second date, and 24-hour text", () => {
    const pages: PdfPageText[] = [{ page: 1, width: 612, height: 792, items: [
      item("Night shift", 700, 12, "bold"), item("Fri 2026-11-06 10:00 PM - 1:00 AM", 686),
      item("Early sync", 640, 12, "bold"), item("Fri 2026-11-06 07:30 - 08:15", 626),
    ] }];
    const r = parseAgenda(pages);
    expect(r.events.map((e) => [e.title, e.date, e.start, e.end, e.minutes])).toEqual([
      ["Early sync", "2026-11-06", "07:30", "08:15", 45],
      ["Night shift", "2026-11-06", "22:00", "24:00", 120],
      ["Night shift", "2026-11-07", "00:00", "01:00", 60],
    ]);
  });
});

describe("unsupported PDFs are rejected, never guessed", () => {
  it("calendar-grid print", async () => {
    const pages = await pdfPages(FIX + "calendar-grid.pdf");
    expect(() => parseAgenda(pages)).toThrow(/not Outlook's Detailed agenda/);
  });
  it("image-only PDF has no readable text", async () => {
    const pages = await pdfPages(FIX + "image-only.pdf");
    expect(() => parseAgenda(pages)).toThrow(NO_TEXT_MESSAGE);
    try {
      parseAgenda(pages);
    } catch (e) {
      expect((e as AgendaError).code).toBe("no-text");
    }
  });
  it("malformed file", async () => {
    await expect(pdfPages(new Uint8Array(readFileSync(FIX + "malformed.pdf")))).rejects.toThrow();
  });
});

describe("PDF → matching → review → BigTime CSV", async () => {
  const P = (id: string, client: string, code: string, tasks: string[], extra: Partial<ProjectMapping> = {}): ProjectMapping => ({ id, client, code, tasks, aliases: [], defaultTask: tasks.length === 1 ? tasks[0] : "", billable: true, ...extra });
  const projects = [
    P("acme", "Acme Components", "P001234-001", ["Planning", "Gears", "Bearings", "Precision Parts"]),
    P("globex", "Globex", "P005678-001", ["Planning Consultant"]),
    P("sj", "Smith-Jones Holdings", "P002468-002", ["Consultant"], { location: "Remote" }),
    P("km", "KM Kite Mills", "P004000-001", ["Planning", "Gears"]),
    P("tfag", "The Forge Associates Group", "P004100-001", ["Planning"]),
    P("nwh", "Northwind Homes Services", "P004200-001", ["Planning"]),
    P("own", "Northwind", "P000999-001", ["Internal - Meeting"], { billable: false }),
  ];
  const s = { ...settings, defaultLocation: "Main Office" };
  const r = parseAgenda(await pdfPages(FIX + "agenda-week.pdf"));
  const entries = r.events.map((e) => eventToEntry(e, projects, s));
  const get = (t: string, i = 0) => entries.filter((e) => e.title === t)[i];

  it("matches by convention, client name, organizer, e-mail domain and short names — never by your own company name", () => {
    expect(get("Acme Components | Gears | Forecast model")).toMatchObject({ projectId: "acme", task: "Gears", description: "Forecast model", scheduledMinutes: 210 });
    expect(get("Globex Corporation weekly sync")).toMatchObject({ projectId: "globex", task: "Planning Consultant" });
    expect(get("Globex - Preparing for Meeting")).toMatchObject({ projectId: "globex" });
    expect(get("Smith-Jones Holdings quarterly forecast deep dive and budget reconciliation working session with the finance leadership team")).toMatchObject({ projectId: "sj", task: "Consultant", location: "Remote" });
    expect(get("Budget model revenue planning")).toMatchObject({ projectId: "nwh" });
    expect(get("Budget model revenue planning").notes.some((n) => n.code === "domain-match")).toBe(true);
    expect(get("Late support call")).toMatchObject({ projectId: "globex" });
    // "KM & Northwind / Gears…": own-company name ignored; the client's e-mail domain proposes Kite Mills, task from the title
    const km = get("KM & Northwind / Gears Requirement Session");
    expect(km).toMatchObject({ projectId: "km", task: "Gears" });
    expect(km.notes.some((n) => n.code === "domain-match" && n.level === "warning")).toBe(true);
    // Without a domain, the short name "KM" is only a suggestion (with the Gears task and "KM" offered as an alias)
    const bare = eventToEntry({ ...r.events.find((e) => e.title.startsWith("KM &"))!, domains: [], organizer: undefined }, projects, s);
    expect(bare.projectId).toBeNull();
    expect(bare.suggestion).toMatchObject({ projectId: "km", task: "Gears", alias: "KM" });
    // "Northwind | Kite Mills…" — the company name in front is not the convention; Kite Mills is matched from the domain
    expect(get("Northwind | Kite Mills: Rules Working Session")).toMatchObject({ projectId: "km", task: "" });
    // "TFAG Internal Status": suggested client, but billable vs internal must be chosen
    const tfag = get("TFAG Internal Status");
    expect(tfag.projectId).toBeNull();
    expect(tfag.suggestion?.projectId).toBe("tfag");
    expect(tfag.candidates).toEqual(["tfag", "own"]);
  });
  it("excludes canceled, all-day and personal items by default", () => {
    expect(get("Canceled: Acme Components | Planning | Review")).toMatchObject({ included: false, excludeReason: "Canceled" });
    expect(get("PTO - Pat Example")).toMatchObject({ included: false, excludeReason: "All-day event (2026-11-02 to 2026-11-06)" });
    expect(get("Lunch & learn: forecasting tips").included).toBe(false);
  });
  it("flags the overlap and resolves it only by the user's choice", () => {
    const c = findOverlaps(entries).find((x) => x.date === "2026-11-02")!;
    expect(c).toMatchObject({ unionMinutes: 240, claimedMinutes: 270, unresolved: true });
    expect(keepOneInOverlap(entries, c, get("Globex Corporation weekly sync").id)).toEqual({ [get("Acme Components | Gears | Forecast model").id]: 180 });
  });
  it("exports the exact six-column CSV after review", () => {
    let es: TimeEntry[] = entries.map((e) => ({ ...e }));
    const c = findOverlaps(es).find((x) => x.date === "2026-11-02")!;
    const keep = keepOneInOverlap(es, c, get("Globex Corporation weekly sync").id);
    es = es.map((e) => (keep[e.id] !== undefined ? { ...e, minutes: keep[e.id] } : e));
    const set = (t: string, patch: Partial<TimeEntry>) => (es = es.map((e) => (e.title === t ? { ...e, ...patch } : e)));
    set("Northwind | Kite Mills: Rules Working Session", { task: "Planning" });
    set("TFAG Internal Status", { projectId: "own", task: "Internal - Meeting" });
    set("Budget model revenue planning", { task: "Planning" });
    es = es.map((e) => ({ ...e, confirmed: e.included }));
    expect(validate(es, { projects, settings: s, period: r.period! }).filter((i) => i.level === "error")).toEqual([]);
    const csv = buildCsv(bigTimeExporter, es, { projects, settings: s, period: r.period! });
    expect(csv).toBe(
      [
        "Description,Location,Project,Task,Work Date,Work Hours",
        "Forecast model,Main Office,P001234-001,Gears,11/02/2026,3.00",
        "Globex Corporation weekly sync,Main Office,P005678-001,Planning Consultant,11/02/2026,1.00",
        "Northwind | Kite Mills: Rules Working Session,Main Office,P004000-001,Planning,11/03/2026,0.50",
        "Smith-Jones Holdings quarterly forecast deep dive and budget reconciliation working session with the finance leadership team,Remote,P002468-002,Consultant,11/03/2026,1.83",
        "Budget model revenue planning,Main Office,P004200-001,Planning,11/03/2026,1.00",
        "TFAG Internal Status,Main Office,P000999-001,Internal - Meeting,11/04/2026,0.50",
        "Late support call,Main Office,P005678-001,Planning Consultant,11/04/2026,1.00",
        "Late support call,Main Office,P005678-001,Planning Consultant,11/05/2026,0.50",
        "KM & Northwind / Gears Requirement Session,Main Office,P004000-001,Gears,11/05/2026,1.00",
        "Globex - Preparing for Meeting,Main Office,P005678-001,Planning Consultant,11/05/2026,1.00",
      ].join("\r\n") + "\r\n",
    );
    expect(csv).not.toMatch(/teams|passcode|@|\d:\d\d\r?$/im);
  });
});
