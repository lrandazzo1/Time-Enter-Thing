import Papa from "papaparse";
import type { ProjectMapping } from "./types";
import { stripTaskPrefix } from "./matching";
import { toCsv } from "./exporters/csv";
import { uid } from "./uid";

export const PROJECT_CSV_COLUMNS = ["Client", "Aliases", "Project Code", "Tasks", "Default Task", "Type", "Full Project Name", "Location"];

const splitList = (s: string) =>
  s
    .split(/[;|\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

const FORBIDDEN_START = /^[=+\-@]/;

export interface ProjectValidation {
  errors: string[];
  warnings: string[];
}

export function validateProject(p: ProjectMapping, all: ProjectMapping[]): ProjectValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!p.client.trim()) errors.push("Client name is required.");
  if (!p.code.trim()) errors.push("BigTime project code is required.");
  if (p.code && all.some((q) => q.id !== p.id && q.code.trim().toLowerCase() === p.code.trim().toLowerCase())) {
    warnings.push(`Project code ${p.code} is used by another client entry.`);
  }
  if (p.tasks.length === 0) warnings.push("No tasks yet — time can't be exported to this project until a task is added.");
  if (p.defaultTask && !p.tasks.includes(p.defaultTask)) errors.push(`Default task "${p.defaultTask}" is not in the task list.`);
  for (const t of [p.client, p.code, ...p.tasks, ...p.aliases]) {
    if (FORBIDDEN_START.test(t)) errors.push(`"${t}" can't start with = + - or @.`);
  }
  if (new Set(p.tasks.map((t) => t.toLowerCase())).size !== p.tasks.length) errors.push("Task names must be unique.");
  if (p.tasks.some((t) => /^\d+\s+\S/.test(t))) {
    warnings.push("A task starts with a number. BigTime shows sequence numbers in front of task names that are usually not part of the name — remove them if BigTime says the task can't be matched.");
  }
  return { errors, warnings };
}

export interface ProjectImportResult {
  projects: ProjectMapping[];
  warnings: string[];
}

/**
 * Import project mappings. Columns (header names are flexible):
 *   Client, Aliases (separated by ;), Project Code, Tasks (separated by ;), Default Task, Type (Billable/Internal)
 */
export function parseProjectsCsv(text: string, opts: { stripNumericPrefixes: boolean }): ProjectImportResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase().replace(/[^a-z]/g, "") });
  const warnings: string[] = [];
  const pick = (r: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) if (r[k] !== undefined && String(r[k]).trim()) return String(r[k]).trim();
    return "";
  };
  const fields = parsed.meta.fields ?? [];
  if (!fields.some((f) => ["projectcode", "project", "code"].includes(f))) throw new Error('The CSV needs a "Project Code" column.');
  const projects: ProjectMapping[] = [];
  parsed.data.forEach((r, i) => {
    const code = pick(r, "projectcode", "project", "code");
    const client = pick(r, "client", "clientname", "name", "customer");
    if (!code && !client) return;
    let tasks = splitList(pick(r, "tasks", "task", "validtasks"));
    let defaultTask = pick(r, "defaulttask", "default");
    if (opts.stripNumericPrefixes) {
      tasks = tasks.map(stripTaskPrefix);
      defaultTask = defaultTask ? stripTaskPrefix(defaultTask) : "";
    }
    tasks = [...new Set(tasks)];
    const type = pick(r, "type", "billable", "billing", "category").toLowerCase();
    const billable = !/(internal|non|no|false|0)/.test(type);
    if (defaultTask && !tasks.includes(defaultTask)) {
      warnings.push(`Row ${i + 2}: default task "${defaultTask}" isn't in the task list — ignored.`);
      defaultTask = "";
    }
    if (!defaultTask && tasks.length === 1) defaultTask = tasks[0];
    const fullName = pick(r, "fullprojectname", "projectname", "fullname");
    const location = pick(r, "location", "worklocation");
    projects.push({ id: uid(), client: client || code, aliases: splitList(pick(r, "aliases", "alias", "alternatenames", "othernames")), code, tasks, defaultTask, billable, fullName: fullName || undefined, source: "file", location: location || undefined });
  });
  if (projects.length === 0) throw new Error("No projects found in this CSV.");
  return { projects, warnings };
}

export function projectsToCsv(projects: ProjectMapping[]): string {
  return toCsv([
    PROJECT_CSV_COLUMNS,
    ...projects.map((p) => [p.client, p.aliases.join("; "), p.code, p.tasks.join("; "), p.defaultTask, p.billable ? "Billable" : "Internal", p.fullName ?? "", p.location ?? ""]),
  ]);
}

/**
 * Add imported projects to the saved list without losing anything already configured.
 * Same project code (or, for code-less entries, same client) → tasks and aliases are combined;
 * the saved client name, type and default task are kept.
 */
export function mergeProjects(existing: ProjectMapping[], incoming: ProjectMapping[]): { projects: ProjectMapping[]; added: number; updated: number; newTasks: number } {
  const out = existing.map((p) => ({ ...p, tasks: [...p.tasks], aliases: [...p.aliases] }));
  let added = 0;
  let updated = 0;
  let newTasks = 0;
  for (const inc of incoming) {
    const code = inc.code.trim().toLowerCase();
    const i = out.findIndex((p) => (code ? p.code.trim().toLowerCase() === code : !p.code.trim() && p.client.trim().toLowerCase() === inc.client.trim().toLowerCase()));
    if (i < 0) {
      out.push({ ...inc, tasks: [...new Set(inc.tasks)], aliases: [...new Set(inc.aliases)] });
      added++;
      newTasks += inc.tasks.length;
      continue;
    }
    const cur = out[i];
    const before = cur.tasks.length + cur.aliases.length;
    for (const t of inc.tasks) if (!cur.tasks.some((x) => x.toLowerCase() === t.toLowerCase())) {
      cur.tasks.push(t);
      newTasks++;
    }
    for (const a of inc.aliases) if (!cur.aliases.some((x) => x.toLowerCase() === a.toLowerCase()) && a.toLowerCase() !== cur.client.toLowerCase()) cur.aliases.push(a);
    if (!cur.fullName && inc.fullName) cur.fullName = inc.fullName;
    if (!cur.location && inc.location) cur.location = inc.location;
    if (inc.roles?.length) cur.roles = [...new Set([...(cur.roles ?? []), ...inc.roles])];
    if (!cur.defaultTask && cur.tasks.length === 1) cur.defaultTask = cur.tasks[0];
    if (cur.tasks.length + cur.aliases.length !== before) updated++;
  }
  return { projects: out, added, updated, newTasks };
}
