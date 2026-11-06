import type { Issue, Period, ProjectMapping, Settings, TimeEntry } from "../types";

export interface ExportContext {
  projects: ProjectMapping[];
  settings: Settings;
  period: Period;
}

/**
 * A timesheet platform exporter. Add a new platform by implementing this interface and
 * registering it in ./index.ts — the review/validation workflow is shared.
 */
export interface TimesheetExporter {
  id: string;
  name: string;
  description: string;
  columns: string[];
  /** Platform-specific checks in addition to the shared review validation. */
  validate(entries: TimeEntry[], ctx: ExportContext): Issue[];
  /** Data rows (without header), in `columns` order. Only included entries are passed. */
  rows(entries: TimeEntry[], ctx: ExportContext): string[][];
  fileName(period: Period): string;
}
