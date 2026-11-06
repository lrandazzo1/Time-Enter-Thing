import { bigTimeExporter } from "./bigtime";
import { toCsv } from "./csv";
import type { ExportContext, TimesheetExporter } from "./types";
import type { TimeEntry } from "../types";

export const EXPORTERS: TimesheetExporter[] = [bigTimeExporter];

export function getExporter(id: string): TimesheetExporter {
  return EXPORTERS.find((x) => x.id === id) ?? bigTimeExporter;
}

export function buildCsv(exporter: TimesheetExporter, entries: TimeEntry[], ctx: ExportContext): string {
  return toCsv([exporter.columns, ...exporter.rows(entries, ctx)]);
}

export type { TimesheetExporter, ExportContext };
