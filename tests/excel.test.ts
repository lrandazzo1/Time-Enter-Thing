import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProjectorReport, readWorkbook, splitProjectCell, selectReportSheet } from "@/lib/projector/excel";
import { mergeProjects } from "@/lib/projectsCsv";
import { parseBackup } from "@/lib/storage";
import { toMapping } from "@/lib/projector/toMapping";
import { eventToEntry } from "@/lib/matching";
import { buildCsv } from "@/lib/exporters";
import { bigTimeExporter } from "@/lib/exporters/bigtime";
import type { CalendarEvent, ProjectMapping, TimeEntry } from "@/lib/types";
import { settings } from "./helpers";

const load = (f: string) => {
  const b = readFileSync(`tests/fixtures/excel/${f}`);
  return readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe("project cell", () => {
  it.each([
    ["Globex - Adaptive Planning - MSP (P005678-001)", "Globex - Adaptive Planning - MSP", "P005678-001"],
    ["The Metro Public Library (MPL) - Adaptive Planning - Implementation (P007979-001)", "The Metro Public Library (MPL) - Adaptive Planning - Implementation", "P007979-001"],
    ["Smith-Jones Holdings - Adaptive Planning - Implementation (P002468-002)", "Smith-Jones Holdings - Adaptive Planning - Implementation", "P002468-002"],
    ["Odd Co - Retainer ( P000001-010 )", "Odd Co - Retainer", "P000001-010"],
    ["No Code Project - Support", "No Code Project - Support", ""],
    ["Acme (Holdings) - Planning", "Acme (Holdings) - Planning", ""],
  ])("%s", (cell, name, code) => expect(splitProjectCell(cell)).toEqual({ fullName: name, code }));
});

describe("Projector report (synthetic replica of the real layout)", async () => {
  const sheets = await load("projector-report.xlsx");
  const r = parseProjectorReport(sheets);

  it("selects the Report sheet and maps the columns", () => {
    expect(selectReportSheet(sheets)?.sheet).toBe("Report");
    expect(r).toMatchObject({ sheetName: "Report", headerRow: 1, rowCount: 12 });
    expect(r.columns).toMatchObject({ project: "Project", task: "Task Name", location: "Work Location", role: "Role" });
  });
  it("extracts codes, names, clients and de-duplicates rows with all distinct tasks", () => {
    expect(r.projects.map((p) => [p.client, p.code, p.fullName, p.tasks.map((t) => t.name)])).toEqual([
      ["Acme Components", "P001234-001", "Acme Components - Adaptive Planning - Implementation", ["Planning", "Gears", "Bearings", "Precision Parts"]],
      ["Globex", "P005678-001", "Globex - Adaptive Planning - MSP", ["Planning Consultant"]],
      ["The Metro Public Library (MPL)", "P007979-001", "The Metro Public Library (MPL) - Adaptive Planning - Implementation", ["Planning"]],
      ["Smith-Jones Holdings", "P002468-002", "Smith-Jones Holdings - Adaptive Planning - Implementation", ["Consultant"]],
      ["Our Firm", "P000999-001", "Our Firm - Internal", ["Internal - Meeting", "Internal - Training"]],
      ["Initech Annual Budget", "P003141-001", "Initech Annual Budget", ["Support"]],
    ]);
    expect(r.projects[0].rowCount).toBe(5);
    expect(r.projects.find((p) => p.code === "P000999-001")!.internal).toBe(true);
  });
  it("asks for confirmation when the client can't be separated from the project name", () => {
    const initech = r.projects.find((p) => p.code === "P003141-001")!;
    expect(initech.clientUncertain).toMatch(/Initech Annual Budget/);
    expect(r.projects.filter((p) => p.clientUncertain).map((p) => p.code)).toEqual(["P003141-001"]);
  });
  it("collects locations (most frequent first) and per-project locations", () => {
    expect(r.locations).toEqual([{ name: "Main Office", count: 10 }, { name: "Client Site", count: 1 }, { name: "Remote", count: 1 }]);
    expect(r.projects[0].locations).toEqual(["Main Office", "Client Site"]);
    expect(r.projects.find((p) => p.code === "P002468-002")!.location).toBe("Remote");
  });
  it("keeps Role only as metadata (never as a task)", () => {
    expect(r.projects[0].roles).toEqual(["Consultant", "Senior Consultant"]);
    expect(r.projects.flatMap((p) => p.tasks.map((t) => t.name))).not.toContain("Consultant ");
    expect(r.projects.flatMap((p) => p.tasks.map((t) => t.name)).some((t) => t === "Senior Consultant" || t === "Staff")).toBe(false);
  });
  it("reads the Options sheet for the date range and filters", () => {
    expect(r.dateRange).toBe("01-Oct-2026 – 31-Oct-2026");
    expect(r.options.find((o) => o.label === "Resource Search String")?.value).toBe("me");
  });
});

describe("other report layouts", () => {
  it("handles title rows, grouped project cells, total rows and reordered columns", async () => {
    const r = parseProjectorReport(await load("projector-report-grouped.xlsx"));
    expect(r).toMatchObject({ sheetName: "Report", headerRow: 4, rowCount: 4 });
    expect(r.projects.map((p) => [p.code, p.tasks.map((t) => t.name)])).toEqual([
      ["P004242-001", ["Planning", "Integration"]],
      ["P001234-001", ["Planning", "Training"]],
    ]);
    expect(r.skippedRows.map((s) => s.reason)).toEqual(["Total row", "Total row"]);
    expect(r.dateRange).toBe("Date Range: 11/01/2026 - 11/30/2026");
  });
  it("reads .xlsm workbooks as data only", async () => {
    const r = parseProjectorReport(await load("projector-report.xlsm"));
    expect(r.projects[0]).toMatchObject({ code: "P005678-001", client: "Globex" });
  });
  it("rejects workbooks that aren't Projector reports", async () => {
    expect(() => parseProjectorReport([{ sheet: "Budget", data: [["Account", "Jan"]] }])).toThrow(/Projector report/);
    await expect(load("not-a-report.xlsx").then(parseProjectorReport)).rejects.toThrow(/Project/);
    await expect(readWorkbook(new TextEncoder().encode("not a zip").buffer)).rejects.toThrow(/Couldn't read/);
  });
  it("offers an employee filter only when the report has an employee column", () => {
    const sheets = [{ sheet: "Report", data: [["Staff", "Project", "Task Name"], ["Pat", "Acme - Support (P000100-001)", "Support"], ["Sam", "Globex - MSP (P000200-001)", "Consultant"]] }];
    const all = parseProjectorReport(sheets);
    expect(all.employees).toEqual(["Pat", "Sam"]);
    expect(all.warnings.some((w) => w.includes("2 people"))).toBe(true);
    expect(parseProjectorReport(sheets, { employee: "Pat" }).projects.map((p) => p.code)).toEqual(["P000100-001"]);
    expect(parseProjectorReport([{ sheet: "Report", data: [["Project", "Task Name"], ["Acme - Support (P000100-001)", "Support"]] }]).employees).toEqual([]);
  });
});

describe("import → save → match → export", async () => {
  const r = parseProjectorReport(await load("projector-report.xlsx"));
  const saved: ProjectMapping[] = r.projects.map((p) => toMapping({ ...p, approved: true }, "excel"));

  it("saves location and roles as metadata and later reports add without wiping", async () => {
    expect(saved[0]).toMatchObject({ code: "P001234-001", location: "Main Office", roles: ["Consultant", "Senior Consultant"], source: "excel" });
    const existing: ProjectMapping[] = [{ id: "keep", client: "Manually Added", aliases: ["MA"], code: "P009999-001", tasks: ["Planning"], defaultTask: "Planning", billable: true }, { ...saved[0], client: "Acme (my edit)", aliases: ["ACME"] }];
    const later = parseProjectorReport(await load("projector-report-grouped.xlsx")).projects.map((p) => toMapping({ ...p, approved: true }, "excel"));
    const m = mergeProjects(existing, later);
    expect(m.projects.map((p) => p.code)).toEqual(["P009999-001", "P001234-001", "P004242-001"]);
    const acme = m.projects[1];
    expect(acme.client).toBe("Acme (my edit)");
    expect(acme.aliases).toEqual(["ACME"]);
    expect(acme.tasks).toEqual(["Planning", "Gears", "Bearings", "Precision Parts", "Training"]);
  });
  it("old backups without the new fields still restore", () => {
    const b = parseBackup(JSON.stringify({ app: "timesheet-converter", version: 1, projects: [{ id: "a", client: "A", code: "P000001-001", tasks: ["Planning"] }], settings: {} }));
    expect(b.projects[0]).toMatchObject({ code: "P000001-001", location: undefined });
  });
  it("matches calendar events, uses the project's location and exports the exact six columns", () => {
    const ev = (title: string, s: string, e: string, m: number): CalendarEvent => ({ title, description: "", location: "", date: "2026-11-03", start: s, end: e, minutes: m, allDay: false, canceled: false, status: "busy", recurring: false, source: "pdf" });
    const s2 = { ...settings, defaultLocation: "Main Office" };
    const entries: TimeEntry[] = [
      eventToEntry(ev("Acme Components | Gears | Forecast model", "09:00", "09:30", 30), saved, s2),
      eventToEntry(ev("Smith-Jones Holdings review", "10:00", "11:30", 90), saved, s2),
      eventToEntry(ev("Globex - planning workshop", "13:00", "16:30", 210), saved, s2),
      eventToEntry(ev("Unknown Co | Planning | Kickoff", "17:00", "17:30", 30), saved, s2),
    ].map((e) => ({ ...e, confirmed: true }));
    expect(entries[0]).toMatchObject({ task: "Gears", location: "Main Office" });
    expect(entries[1]).toMatchObject({ task: "Consultant", location: "Remote" });
    expect(entries[3]).toMatchObject({ projectId: null });
    const csv = buildCsv(bigTimeExporter, entries.filter((e) => e.projectId), { projects: saved, settings: s2, period: { start: "2026-11-02", end: "2026-11-08" } });
    expect(csv).toBe(
      "Description,Location,Project,Task,Work Date,Work Hours\r\n" +
        "Forecast model,Main Office,P001234-001,Gears,11/03/2026,0.50\r\n" +
        "Smith-Jones Holdings review,Remote,P002468-002,Consultant,11/03/2026,1.50\r\n" +
        "Globex - planning workshop,Main Office,P005678-001,Planning Consultant,11/03/2026,3.50\r\n",
    );
  });
});
