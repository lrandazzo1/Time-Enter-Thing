import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventToEntry, matchEvent, ruleKey, unknownClientHint } from "@/lib/matching";
import { bestFuzzy, domainMatchesClient } from "@/lib/fuzzy";
import { mergeProjects } from "@/lib/projectsCsv";
import { parseBackup, makeBackup } from "@/lib/storage";
import { findOverlaps, splitOverlapEvenly, validate } from "@/lib/review";
import { buildCsv } from "@/lib/exporters";
import { bigTimeExporter } from "@/lib/exporters/bigtime";
import { upsertRules } from "@/components/MatchStep";
import type { CalendarEvent, ProjectMapping, TimeEntry } from "@/lib/types";
import { period, projects, settings } from "./helpers";

const ev = (title: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  title, description: "", location: "", date: "2026-11-02", start: "09:00", end: "10:00", minutes: 60,
  allDay: false, canceled: false, status: "busy", recurring: false, source: "pdf", ...extra,
});

describe("matching priority", () => {
  it("1. exact project code wins", () => {
    expect(matchEvent("Prep for P000200-001 workshop", "", projects)).toMatchObject({ projectId: "globex", task: "Consultant" });
  });
  it("remembered rules come first and survive date changes in titles", () => {
    const rules = [{ id: "r", key: ruleKey("Budget model revenue planning"), example: "Budget model revenue planning", projectId: "acme", task: "Planning", createdAt: "" }];
    const e = eventToEntry(ev("Budget model revenue planning"), projects, settings, rules);
    expect(e).toMatchObject({ projectId: "acme", task: "Planning" });
    expect(e.notes[0].code).toBe("remembered");
    expect(ruleKey("Status 11/3")).toBe(ruleKey("Status 11/10"));
  });
  it("own-company internal project doesn't steal client meetings", () => {
    const ps: ProjectMapping[] = [...projects, { id: "own", client: "Okay Firm", aliases: ["INTERNAL"], code: "P000998-001", tasks: ["Internal - Meeting"], defaultTask: "", billable: false }];
    expect(matchEvent("Okay Firm | Acme: Rules Working Session", "", ps).projectId).toBe("acme");
    expect(matchEvent("INTERNAL: Acme sync", "", ps).candidates?.sort()).toEqual(["acme", "internal", "own"]);
  });
  it("your own organisation's name alone never assigns time (projects imported without aliases)", () => {
    const ps: ProjectMapping[] = [
      { id: "own", client: "Northwind", aliases: [], code: "P000998-001", tasks: ["Internal - Meeting"], defaultTask: "Internal - Meeting", billable: false },
      { id: "fac", client: "The Forge Associates Group", aliases: [], code: "P000997-001", tasks: ["Planning"], defaultTask: "Planning", billable: true },
      { id: "kite", client: "Kite Mills", aliases: [], code: "P000996-001", tasks: ["Planning", "Gears"], defaultTask: "", billable: true },
    ];
    const a = eventToEntry(ev("KM & Northwind / Gears Requirement Session"), ps, settings);
    expect(a.projectId).toBeNull();
    expect(a.candidates).toEqual(["own"]);
    const b = eventToEntry(ev("TFAG | Northwind Model Build Working Session"), ps, settings);
    expect(b.projectId).toBeNull();
    expect(b.suggestion?.projectId).toBe("fac");
    const c = eventToEntry(ev("INTERNAL: Kite Mills sync"), ps, settings);
    expect(c.projectId).toBeNull();
    expect(c.candidates).toEqual(["kite", "own"]);
    expect(eventToEntry(ev("Northwind | Kite Mills: Rules Working Session"), ps, settings)).toMatchObject({ projectId: "kite" });
    expect(eventToEntry(ev("Northwind | Internal - Meeting | Team sync"), ps, settings)).toMatchObject({ projectId: "own", task: "Internal - Meeting", description: "Team sync" });
  });
  it("4. organizer domain gives a proposed match that needs confirmation", () => {
    const e = eventToEntry(ev("Budget model capital planning", { domains: ["globex.com"] }), projects, settings);
    expect(e.projectId).toBe("globex");
    expect(e.notes.some((n) => n.code === "domain-match" && n.level === "warning")).toBe(true);
    expect(domainMatchesClient("northwindhomes.org", "Northwind Homes Services")).toBe(true);
    expect(domainMatchesClient("gmail.com", "Northwind Homes Services")).toBe(false);
  });
  it("5. fuzzy matches are suggestions only", () => {
    const e = eventToEntry(ev("Globx quarterly review"), projects, settings);
    expect(e.projectId).toBeNull();
    expect(e.suggestion?.projectId).toBe("globex");
    expect(bestFuzzy("NBG status", [{ n: "Northwind Builders Group" }, { n: "Acme" }], (x) => [x.n])?.item.n).toBe("Northwind Builders Group");
  });
  it("unknown clients get a readable label", () => {
    expect(unknownClientHint("Example Company | Planning | Kickoff")).toBe("Example Company");
    expect(unknownClientHint("Kickoff call", ["example.com"])).toBe("example.com");
    const e = eventToEntry(ev("Example Company | Planning | Kickoff"), projects, settings);
    expect(e).toMatchObject({ projectId: null, description: "Kickoff" });
  });
});

describe("project configuration", () => {
  it("imports incrementally without losing existing settings", () => {
    const incoming: ProjectMapping[] = [
      { id: "n1", client: "Acme (renamed by OCR)", aliases: [], code: "P000100-001", tasks: ["Planning", "Training"], defaultTask: "", billable: true },
      { id: "n2", client: "Newco", aliases: [], code: "P000300-001", tasks: ["Support"], defaultTask: "Support", billable: true },
    ];
    const m = mergeProjects(projects, incoming);
    expect(m).toMatchObject({ added: 1, updated: 1, newTasks: 2 });
    const acme = m.projects.find((p) => p.code === "P000100-001")!;
    expect(acme.client).toBe("Acme Corp");
    expect(acme.aliases).toEqual(["Acme"]); // the OCR'd name doesn't overwrite or add to the saved client
    expect(acme.tasks).toEqual(["Planning", "Support", "Training"]);
  });
  it("restores v1 backups and round-trips v2 backups (with remembered matches)", () => {
    const v1 = JSON.stringify({ app: "timesheet-converter", version: 1, exportedAt: "x", projects: [{ id: "a", client: "A", aliases: [], code: "P000001-001", tasks: ["Planning"], defaultTask: "Planning", billable: true }], settings: { timeZone: "America/Chicago", defaultLocation: "HQ", locationRequired: true, exclusionKeywords: ["lunch"], csvDateOrder: "MDY" } });
    const b1 = parseBackup(v1);
    expect(b1.projects[0]).toMatchObject({ client: "A", tasks: ["Planning"] });
    expect(b1.settings).toMatchObject({ defaultLocation: "HQ", keepTaskNumbers: false, onboarding: "done" });
    const rules = [{ id: "r", key: "x", example: "x", projectId: "a", task: "Planning", createdAt: "" }];
    const b2 = parseBackup(JSON.stringify(makeBackup(b1.projects, b1.settings, rules)));
    expect(b2.rules).toEqual(rules);
    expect(() => parseBackup('{"app":"other"}')).toThrow();
    expect(() => parseBackup("<script>alert(1)</script>")).toThrow();
  });
  it("sanitises hostile backup content", () => {
    const evil = JSON.stringify({ app: "timesheet-converter", version: 2, projects: [{ client: "<img src=x onerror=alert(1)>", code: "=cmd|' /C calc'!A0", tasks: [1, null, "Planning"], __proto__: { polluted: true } }], settings: {} });
    const b = parseBackup(evil);
    expect(b.projects[0].tasks).toEqual(["Planning"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Text is stored as plain strings (React escapes it); formula text is neutralised on export.
    const csv = buildCsv(bigTimeExporter, [{ id: "1", source: "manual", title: "", date: "2026-11-02", intervals: [], minutes: 60, projectId: b.projects[0].id, task: "Planning", description: "=HYPERLINK(1)", location: "@x", included: true, status: "busy", notes: [] }], { projects: b.projects, settings, period });
    expect(csv.split("\r\n")[1]).toBe(`'=HYPERLINK(1),'@x,'=cmd|' /C calc'!A0,Planning,11/02/2026,1.00`);
  });
  it("remembers confirmed matches by title", () => {
    const e: TimeEntry = { id: "1", source: "pdf", title: "Budget model revenue planning", date: "2026-11-02", intervals: [], minutes: 60, projectId: "acme", task: "Planning", description: "", location: "", included: true, status: "busy", notes: [] };
    const r = upsertRules([], [e, { ...e, id: "2" }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "budget model revenue planning", projectId: "acme" });
  });
});

/**
 * Synthetic replica of the real Nov 2–6 week that was successfully imported into BigTime
 * (same times, overlaps, tentative/canceled events and decisions; fictional names/codes).
 */
describe("regression: Nov 2–6 week (synthetic replica)", () => {
  const P = (id: string, client: string, code: string, tasks: string[], billable = true, aliases: string[] = []): ProjectMapping => ({ id, client, code, tasks, aliases, defaultTask: tasks.length === 1 ? tasks[0] : "", billable });
  const ps = [
    P("k", "Kestrel", "P100001-003", ["Planning"]),
    P("mw", "Kite Mills", "P100002-001", ["Planning", "Gears", "Bearings", "Precision Parts"], true, ["KM"]),
    P("wh", "Westfield Homes", "P100003-001", ["Planning"]),
    P("fg", "Northwind Builders", "P100004-001", ["Planning"], true, ["NWB"]),
    P("qb", "Lumen Labs", "P100005-001", ["Planning Consultant"]),
    P("in", "Our Firm Internal", "P100006-001", ["Internal - Meeting", "Internal - Training"], false, ["INTERNAL"]),
  ];
  const T = (date: string, s: string, e: string, title: string, status: CalendarEvent["status"] = "busy", canceled = false): CalendarEvent => ({ title, description: "", location: "", date, start: s, end: e, minutes: null, allDay: false, canceled, status: canceled ? "free" : status, recurring: false, source: "pdf" });
  const events = [
    T("2026-11-02", "10:00", "11:00", "Canceled: Lumen Labs | Our Firm Support Working Session", "busy", true),
    T("2026-11-02", "12:30", "13:00", "INTERNAL - Pat + Sam"),
    T("2026-11-02", "13:00", "13:30", "KM Internal Sync"),
    T("2026-11-02", "13:30", "14:30", "KM & Our Firm / Gears Requirement Session", "tentative"),
    T("2026-11-03", "09:30", "10:00", "Our Firm | Kestrel: Rules Working Session", "tentative"),
    T("2026-11-03", "09:30", "10:00", "Coffee catch-up"),
    T("2026-11-03", "10:00", "11:50", "Budget model revenue planning", "tentative"),
    T("2026-11-03", "10:00", "10:30", "INTERNAL: Kestrel Sync", "tentative"),
    T("2026-11-03", "13:00", "14:00", "NWB | Our Firm Model Build Working Session"),
    T("2026-11-04", "10:30", "11:00", "NWB Internal Status", "tentative"),
    T("2026-11-04", "11:00", "12:00", "Strategy Committee | Bi-Weekly Meeting", "tentative"),
    T("2026-11-04", "12:30", "13:00", "INTERNAL - Pat + Sam"),
    T("2026-11-04", "13:00", "14:50", "Budget model capital planning & integration", "tentative"),
    T("2026-11-05", "12:00", "13:00", "NWB | Our Firm Model Build Working Session"),
    T("2026-11-05", "12:30", "13:30", "Lumen Labs | Our Firm Support Working Session"),
    T("2026-11-05", "13:00", "14:00", "Kite Mills & Our Firm / Finalize Precision Requirements", "tentative"),
    T("2026-11-05", "14:00", "14:30", "Our Firm | Kestrel: Rules Working Session", "tentative"),
  ];
  const s = { ...settings, defaultLocation: "Main Office" };
  const per = { start: "2026-11-02", end: "2026-11-06" };

  it("produces the same rows, hours and totals as the imported file", () => {
    let entries = events.map((e) => eventToEntry(e, ps, s));
    const set = (title: string, date: string, patch: Partial<TimeEntry>) => {
      entries = entries.map((e) => (e.title === title && e.date === date ? { ...e, ...patch } : e));
    };
    // automatic results
    const auto = (t: string, d: string) => entries.find((e) => e.title === t && e.date === d)!;
    expect(auto("KM & Our Firm / Gears Requirement Session", "2026-11-02")).toMatchObject({ projectId: "mw", task: "Gears" });
    expect(auto("Our Firm | Kestrel: Rules Working Session", "2026-11-03")).toMatchObject({ projectId: "k", task: "Planning" });
    expect(auto("NWB | Our Firm Model Build Working Session", "2026-11-03")).toMatchObject({ projectId: "fg", task: "Planning" });
    expect(auto("Lumen Labs | Our Firm Support Working Session", "2026-11-05")).toMatchObject({ projectId: "qb", task: "Planning Consultant" });
    expect(auto("KM Internal Sync", "2026-11-02").candidates?.sort()).toEqual(["in", "mw"]);
    expect(auto("Canceled: Lumen Labs | Our Firm Support Working Session", "2026-11-02").included).toBe(false);
    // the user's decisions (same as the real import)
    set("INTERNAL - Pat + Sam", "2026-11-02", { task: "Internal - Meeting" });
    set("INTERNAL - Pat + Sam", "2026-11-04", { task: "Internal - Meeting" });
    set("KM Internal Sync", "2026-11-02", { projectId: "mw", task: "Planning" });
    set("Coffee catch-up", "2026-11-03", { included: false });
    set("INTERNAL: Kestrel Sync", "2026-11-03", { included: false });
    set("Budget model revenue planning", "2026-11-03", { projectId: "wh", task: "Planning" });
    set("Budget model capital planning & integration", "2026-11-04", { projectId: "wh", task: "Planning" });
    set("NWB Internal Status", "2026-11-04", { projectId: "fg", task: "Planning" });
    set("Strategy Committee | Bi-Weekly Meeting", "2026-11-04", { projectId: "in", task: "Internal - Meeting" });
    set("Kite Mills & Our Firm / Finalize Precision Requirements", "2026-11-05", { task: "Precision Parts" });
    const cluster = findOverlaps(entries).find((c) => c.date === "2026-11-05")!;
    expect(cluster).toMatchObject({ unionMinutes: 120, claimedMinutes: 180, unresolved: true });
    const split = splitOverlapEvenly(entries, cluster);
    entries = entries.map((e) => (split[e.id] !== undefined ? { ...e, minutes: split[e.id] } : e)).map((e) => ({ ...e, confirmed: true }));
    expect(validate(entries, { projects: ps, settings: s, period: per }).filter((i) => i.level === "error")).toEqual([]);
    const csv = buildCsv(bigTimeExporter, entries, { projects: ps, settings: s, period: per });
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe("Description,Location,Project,Task,Work Date,Work Hours");
    const key = rows.slice(1).map((r) => r.split(",").slice(-4).join(",")).sort();
    expect(key).toEqual([
      "P100001-003,Planning,11/03/2026,0.50", "P100001-003,Planning,11/05/2026,0.50",
      "P100002-001,Planning,11/02/2026,0.50", "P100002-001,Precision Parts,11/05/2026,0.75", "P100002-001,Gears,11/02/2026,1.00",
      "P100003-001,Planning,11/03/2026,1.83", "P100003-001,Planning,11/04/2026,1.83",
      "P100004-001,Planning,11/03/2026,1.00", "P100004-001,Planning,11/04/2026,0.50", "P100004-001,Planning,11/05/2026,0.75",
      "P100005-001,Planning Consultant,11/05/2026,0.50",
      "P100006-001,Internal - Meeting,11/02/2026,0.50", "P100006-001,Internal - Meeting,11/04/2026,0.50", "P100006-001,Internal - Meeting,11/04/2026,1.00",
    ].sort());
    expect(rows).toHaveLength(15);
    expect(rows.every((r) => !/\d:\d\d$/.test(r))).toBe(true);
    expect(rows.slice(1).every((r) => r.includes(",Main Office,"))).toBe(true);
  });
});
