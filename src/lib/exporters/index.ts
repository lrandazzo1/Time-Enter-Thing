import { bigTimeExporter } from "./bigtime";
import { toCsv } from "./csv";
import type { ExportContext, PreviewTable, TimesheetExporter } from "./types";
import type { TimeEntry } from "../types";

export const EXPORTERS: TimesheetExporter[] = [bigTimeExporter];

export function getExporter(id: string): TimesheetExporter {
  return EXPORTERS.find((x) => x.id === id) ?? bigTimeExporter;
}

export function buildCsv(exporter: TimesheetExporter, entries: TimeEntry[], ctx: ExportContext): string {
  return toCsv([exporter.columns, ...exporter.rows(entries, ctx)]);
}

/** On-screen preview table; falls back to the CSV columns when an exporter has no richer preview. */
export function buildPreview(exporter: TimesheetExporter, entries: TimeEntry[], ctx: ExportContext): PreviewTable {
  if (exporter.preview) return exporter.preview(entries, ctx);
  return { columns: exporter.columns, rows: exporter.rows(entries, ctx), unknownRows: [], unknownProjects: [] };
}

export type { TimesheetExporter, ExportContext, PreviewTable };
