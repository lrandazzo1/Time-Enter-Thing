/**
 * Export screen preview: Project Name + Project Code shown on screen, while the downloaded CSV keeps
 * exactly the six BigTime columns with only the project code in `Project`.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parseProjectorReport, readWorkbook } from "@/lib/projector/excel";
import { toMapping } from "@/lib/projector/toMapping";
import { eventToEntry } from "@/lib/matching";
import { buildCsv, buildPreview } from "@/lib/exporters";
import { bigTimeExporter } from "@/lib/exporters/bigtime";
import { loadProjects, makeBackup, parseBackup, saveProjects } from "@/lib/storage";
import { parseProjectsCsv, projectsToCsv } from "@/lib/projectsCsv";
import { UNKNOWN_PROJECT, resolveProjectName } from "@/lib/projectName";
import type { CalendarEvent, ProjectMapping, TimeEntry } from "@/lib/types";
import { settings } from "./helpers";

const load = (f: string) => {
  const b = readFileSync(`tests/fixtures/excel/${f}`);
  return readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const s2 = { ...settings, defaultLocation: "Main Office" };
const period = { start: "2026-11-02", end: "2026-11-08" };
const ev = (title: string, date: string, s: string, e: string, m: number): CalendarEvent => ({ title, description: "", location: "", date, start: s, end: e, minutes: m, allDay: false, canceled: false, status: "busy", recurring: false, source: "pdf" });

const EXPECTED_CSV =
  "Description,Location,Project,Task,Work Date,Work Hours\r\n" +
  "Forecast model,Main Office,P001234-001,Gears,11/03/2026,0.50\r\n" +
  "Smith-Jones Holdings review,Remote,P002468-002,Consultant,11/03/2026,1.50\r\n" +
  "Globex - planning workshop,Main Office,P005678-001,Planning Consultant,11/04/2026,3.50\r\n";

describe("export preview: project name + code (from the imported Projector Excel report)", async () => {
  const report = parseProjectorReport(await load("projector-report.xlsx"));
  const saved: ProjectMapping[] = report.projects.map((p) => toMapping({ ...p, approved: true }, "excel"));
  const entries: TimeEntry[] = [
    eventToEntry(ev("Globex - planning workshop", "2026-11-04", "13:00", "16:30", 210), saved, s2),
    eventToEntry(ev("Acme Components | Gears | Forecast model", "2026-11-03", "09:00", "09:30", 30), saved, s2),
    eventToEntry(ev("Smith-Jones Holdings review", "2026-11-03", "10:00", "11:30", 90), saved, s2),
  ].map((e) => ({ ...e, confirmed: true }));
  const ctx = { projects: saved, settings: s2, period };

  it("shows Project Name immediately left of Project Code, names taken from the report's Project column", () => {
    const pv = buildPreview(bigTimeExporter, entries, ctx);
    expect(pv.columns).toEqual(["Description", "Location", "Project Name", "Project Code", "Task", "Work Date", "Work Hours"]);
    expect(pv.nameColumn).toBe(2);
    expect(pv.rows.map((r) => [r[2], r[3]])).toEqual([
      ["Acme Components - Adaptive Planning - Implementation", "P001234-001"],
      ["Smith-Jones Holdings - Adaptive Planning - Implementation", "P002468-002"],
      ["Globex - Adaptive Planning - MSP", "P005678-001"],
    ]);
    expect(pv.unknownRows).toEqual([]);
  });

  it("preview rows are the CSV rows with only the name column inserted", () => {
    const pv = buildPreview(bigTimeExporter, entries, ctx);
    const csvRows = bigTimeExporter.rows(entries, ctx);
    expect(pv.rows.map((r) => [...r.slice(0, 2), ...r.slice(3)])).toEqual(csvRows);
  });

  it("the downloaded CSV is unchanged: six columns, project code only", () => {
    const csv = buildCsv(bigTimeExporter, entries, ctx);
    expect(csv).toBe(EXPECTED_CSV);
    expect(bigTimeExporter.columns).toEqual(["Description", "Location", "Project", "Task", "Work Date", "Work Hours"]);
    expect(csv).not.toMatch(/Project Name|Adaptive Planning/);
  });

  it("missing names show “Unknown project”, are flagged, and are never replaced by the code or client", () => {
    const noName = saved.map((p) => (p.code === "P002468-002" ? { ...p, fullName: undefined } : p));
    const pv = buildPreview(bigTimeExporter, entries, { ...ctx, projects: noName });
    expect(pv.rows[1][2]).toBe(UNKNOWN_PROJECT);
    expect(pv.rows[1][3]).toBe("P002468-002");
    expect(pv.unknownRows).toEqual([1]);
    expect(pv.unknownProjects).toEqual([{ projectId: noName.find((p) => p.code === "P002468-002")!.id, code: "P002468-002", client: "Smith-Jones Holdings" }]);
    expect(buildCsv(bigTimeExporter, entries, { ...ctx, projects: noName })).toBe(EXPECTED_CSV);
  });

  it("an unnamed duplicate mapping resolves the name from another saved mapping with the same code", () => {
    const dup: ProjectMapping = { ...saved[0], id: "dup", fullName: undefined };
    expect(resolveProjectName(dup, [...saved, dup])).toBe("Acme Components - Adaptive Planning - Implementation");
    expect(resolveProjectName(dup, [dup])).toBeNull();
    expect(resolveProjectName(undefined, saved)).toBeNull();
  });

  describe("name survives a browser refresh and a restored configuration", () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    afterEach(() => {
      delete g.window;
      store.clear();
    });

    it("localStorage save → load (refresh)", () => {
      g.window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } };
      saveProjects(saved);
      const reloaded = loadProjects();
      expect(reloaded.map((p) => p.fullName)).toEqual(saved.map((p) => p.fullName));
      expect(buildPreview(bigTimeExporter, entries, { ...ctx, projects: reloaded }).unknownRows).toEqual([]);
    });

    it("backup download → restore, and projects CSV export → import", () => {
      const restored = parseBackup(JSON.stringify(makeBackup(saved, s2, []))).projects;
      expect(restored.map((p) => p.fullName)).toEqual(saved.map((p) => p.fullName));
      const fromCsv = parseProjectsCsv(projectsToCsv(saved), { stripNumericPrefixes: false }).projects;
      expect(fromCsv.map((p) => p.fullName)).toEqual(saved.map((p) => p.fullName));
    });
  });
});
