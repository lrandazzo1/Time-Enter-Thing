/**
 * Optional check against a real Projector report that is NOT stored in the repository.
 * Run with: PROJECTOR_REPORT=/path/to/report.xlsx npx vitest run tests/excel.private.test.ts
 * Assertions are structural so no client data needs to live in this file.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProjectorReport, readWorkbook } from "@/lib/projector/excel";
import { isValidCode } from "@/lib/projector/codes";

const file = process.env.PROJECTOR_REPORT ?? "";
describe.skipIf(!file || !existsSync(file))("real Projector report (local only)", () => {
  it("parses the report", async () => {
    const b = readFileSync(file);
    const sheets = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const r = parseProjectorReport(sheets);
    console.log(JSON.stringify({ sheets: sheets.map((s) => s.sheet), sheet: r.sheetName, header: r.headerRow, columns: r.columns, rows: r.rowCount, dateRange: r.dateRange, locations: r.locations, projects: r.projects.map((p) => ({ client: p.client, code: p.code, tasks: p.tasks.map((t) => t.name), roles: p.roles, internal: p.internal, rows: p.rowCount, issues: p.issues })) }, null, 1));
    expect(r.sheetName).toBe("Report");
    expect(r.columns).toMatchObject({ project: "Project", task: "Task Name", location: "Work Location", role: "Role" });
    expect(r.projects.length).toBeGreaterThan(0);
    expect(r.projects.every((p) => isValidCode(p.code) && p.tasks.length > 0)).toBe(true);
    expect(r.projects.reduce((a, p) => a + (p.rowCount ?? 0), 0)).toBe(r.rowCount);
    const roles = new Set(r.projects.flatMap((p) => p.roles ?? []));
    expect(r.projects.some((p) => p.tasks.some((t) => roles.has(t.name) && !p.roles?.includes(t.name)))).toBe(false);
    expect(r.dateRange).toBeTruthy();
    expect(r.employees).toEqual([]);
  });
});
