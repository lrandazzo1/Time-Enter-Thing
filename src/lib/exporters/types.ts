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
  /**
   * Optional on-screen preview, which may show extra columns (e.g. the full project name).
   * Never used for the downloaded file — that always comes from `columns` + `rows`.
   */
  preview?(entries: TimeEntry[], ctx: ExportContext): PreviewTable;
}

export interface PreviewTable {
  columns: string[];
  rows: string[][];
  /** Index of the column holding the full project name, if any. */
  nameColumn?: number;
  /** Rows (by index) whose project name couldn't be resolved. */
  unknownRows: number[];
  /** Saved projects whose full name is missing (code + client for display). */
  unknownProjects: { projectId: string; code: string; client: string }[];
}
