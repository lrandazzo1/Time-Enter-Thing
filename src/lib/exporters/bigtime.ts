import type { Issue, TimeEntry } from "../types";
import { formatDecimalHours, toUSDate } from "../time";
import { guardFormula } from "./csv";
import type { ExportContext, PreviewTable, TimesheetExporter } from "./types";
import { UNKNOWN_PROJECT, resolveProjectName } from "../projectName";

/** Included entries in file order (date, then start time). Shared by the CSV and the preview. */
function ordered(entries: TimeEntry[]): TimeEntry[] {
  return entries
    .filter((e) => e.included)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.intervals[0]?.start ?? "99").localeCompare(b.intervals[0]?.start ?? "99"));
}

/**
 * BigTime Enterprise PSA (formerly Projector PSA) "Import time" CSV.
 * Column names match BigTime's field names so the Map Fields step lines up 1:1:
 *   Description → Description, Location → Location, Project → Project, Task → Task,
 *   Work Date → Work Date (mm/dd/yyyy), Work Hours → Work Hours (H,HHH.00).
 */
export const bigTimeExporter: TimesheetExporter = {
  id: "bigtime",
  name: "BigTime Enterprise PSA",
  description: "CSV for BigTime / Projector PSA Import Time (dates mm/dd/yyyy, decimal hours H,HHH.00).",
  columns: ["Description", "Location", "Project", "Task", "Work Date", "Work Hours"],

  validate(entries: TimeEntry[], ctx: ExportContext): Issue[] {
    const issues: Issue[] = [];
    const byId = new Map(ctx.projects.map((p) => [p.id, p]));
    for (const e of entries) {
      if (!e.included) continue;
      if (e.description.length > 1000) {
        issues.push({ level: "error", code: "bt-desc-length", entryId: e.id, message: `${e.date}: description is longer than BigTime's 1,000-character limit.` });
      }
      const p = e.projectId ? byId.get(e.projectId) : undefined;
      if (p && /^\s*\d+\s+\S/.test(e.task)) {
        issues.push({
          level: "warning",
          code: "bt-task-prefix",
          entryId: e.id,
          message: `${e.date}: task "${e.task}" starts with a number. BigTime often displays a sequence number that is not part of the task name — if the import says the task could not be matched, remove the number on the Projects & Tasks tab.`,
        });
      }
    }
    const count = entries.filter((e) => e.included).length;
    if (count > 500) issues.push({ level: "error", code: "bt-limit", message: `BigTime imports at most 500 time cards per file (${count} included). Split the period.` });
    return issues;
  },

  rows(entries: TimeEntry[], ctx: ExportContext): string[][] {
    const byId = new Map(ctx.projects.map((p) => [p.id, p]));
    return ordered(entries).map((e) => {
      const p = byId.get(e.projectId ?? "");
      return [
        guardFormula(e.description.replace(/\s*\n+\s*/g, " ").trim()),
        guardFormula(e.location.trim()),
        guardFormula(p?.code.trim() ?? ""),
        guardFormula(e.task.trim()),
        toUSDate(e.date),
        formatDecimalHours(e.minutes),
      ];
    });
  },

  /** Screen-only: the CSV's Project column shown as Project Name + Project Code. The CSV itself is unchanged. */
  preview(entries: TimeEntry[], ctx: ExportContext): PreviewTable {
    const byId = new Map(ctx.projects.map((p) => [p.id, p]));
    const list = ordered(entries);
    const csvRows = this.rows(entries, ctx);
    const unknownRows: number[] = [];
    const unknown = new Map<string, { projectId: string; code: string; client: string }>();
    const rows = csvRows.map((r, i) => {
      const p = byId.get(list[i].projectId ?? "");
      const name = resolveProjectName(p, ctx.projects);
      if (!name) {
        unknownRows.push(i);
        if (p) unknown.set(p.id, { projectId: p.id, code: p.code, client: p.client });
      }
      return [r[0], r[1], name ?? UNKNOWN_PROJECT, ...r.slice(2)];
    });
    return {
      columns: ["Description", "Location", "Project Name", "Project Code", "Task", "Work Date", "Work Hours"],
      rows,
      nameColumn: 2,
      unknownRows,
      unknownProjects: [...unknown.values()],
    };
  },

  fileName(period) {
    return `BigTime_Timesheet_${period.start}_to_${period.end}.csv`;
  },
};
