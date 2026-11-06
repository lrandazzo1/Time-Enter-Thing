import { describe, expect, it } from "vitest";
import { buildCsv } from "@/lib/exporters";
import { bigTimeExporter } from "@/lib/exporters/bigtime";
import { encodeCsv, guardFormula } from "@/lib/exporters/csv";
import type { TimeEntry } from "@/lib/types";
import { period, projects, settings } from "./helpers";

const e = (over: Partial<TimeEntry>): TimeEntry => ({
  id: Math.random().toString(), source: "manual", title: "", date: "2026-11-02", intervals: [], minutes: 60, projectId: "acme",
  task: "Planning", description: "Model build", location: "Main Office", included: true, status: "busy", notes: [], ...over,
});

describe("BigTime CSV", () => {
  const entries = [
    e({ date: "2026-11-03", minutes: 110, description: 'Review "phase 2", next steps' }),
    e({ minutes: 210, intervals: [{ start: "09:00", end: "12:30" }] }),
    e({ minutes: 30, projectId: "internal", task: "Internal - Meeting", description: "=HYPERLINK(\"x\")" }),
    e({ minutes: 45, included: false }),
  ];
  const csv = buildCsv(bigTimeExporter, entries, { projects, settings, period });
  const lines = csv.trimEnd().split("\r\n");

  it("has the exact header BigTime maps", () => {
    expect(lines[0]).toBe("Description,Location,Project,Task,Work Date,Work Hours");
  });
  it("writes MM/DD/YYYY dates, decimal hours, codes and plain task names", () => {
    expect(lines[1]).toBe("Model build,Main Office,P000100-001,Planning,11/02/2026,3.50");
    expect(lines[3]).toBe('"Review ""phase 2"", next steps",Main Office,P000100-001,Planning,11/03/2026,1.83');
    expect(lines).toHaveLength(4); // excluded row omitted
    for (const l of lines.slice(1)) expect(l).toMatch(/,\d{2}\/\d{2}\/\d{4},\d+\.\d{2}$/);
    expect(csv).not.toMatch(/\d:\d{2}\r?$/m);
  });
  it("neutralises spreadsheet formulas", () => {
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",Main Office,P000999-001,Internal - Meeting,11/02/2026,0.50`);
    expect(guardFormula("@SUM(1)")).toBe("'@SUM(1)");
    expect(guardFormula("Planning")).toBe("Planning");
  });
  it("names the file by period", () => {
    expect(bigTimeExporter.fileName(period)).toBe("BigTime_Timesheet_2026-11-02_to_2026-11-08.csv");
  });
  it("encodes ANSI (Windows-1252)", () => {
    const r = encodeCsv("Caf\u00e9 \u2013 \u201cx\u201d \u2603", "windows-1252");
    expect(Array.from(r.bytes)).toEqual([67, 97, 102, 0xe9, 32, 0x96, 32, 0x93, 120, 0x94, 32, 0x3f]);
    expect(r.unmappable).toEqual(["\u2603"]);
    expect(Array.from(encodeCsv("a", "utf-8-bom").bytes)).toEqual([0xef, 0xbb, 0xbf, 97]);
  });
});
