import type { MatchRule, Period, ProjectMapping, Settings, TimeEntry } from "./types";
import { addDays, browserTimeZone, mondayOf, todayIn } from "./time";

/**
 * Browser-local persistence. Everything a user configures or imports stays in *their* browser
 * (localStorage for this site only). Nothing is sent anywhere. Every access is wrapped because
 * storage can be blocked (private windows, strict privacy settings) or cleared by the browser.
 */
const KEYS = {
  projects: "tsc.v1.projects",
  settings: "tsc.v1.settings",
  draft: "tsc.v1.draft",
  rules: "tsc.v2.rules",
  projectDraft: "tsc.v2.projectDraft",
} as const;

export function defaultSettings(): Settings {
  return {
    timeZone: browserTimeZone(),
    defaultLocation: "",
    locationRequired: true,
    exclusionKeywords: ["lunch", "PTO", "personal", "out of office", "OOO", "holiday", "doctor", "dentist", "appointment", "birthday", "happy hour"],
    csvDateOrder: "MDY",
    keepTaskNumbers: false,
    onboarding: "active",
    onboardingStep: 1,
  };
}

export function defaultPeriod(timeZone: string): Period {
  const start = mondayOf(todayIn(timeZone));
  return { start, end: addDays(start, 6) };
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Sanitise a project read from storage or a backup file (unknown shape → safe ProjectMapping). */
export function sanitizeProject(p: unknown, makeId: () => string): ProjectMapping | null {
  const o = p as Record<string, unknown>;
  if (!o || typeof o !== "object") return null;
  const tasks = Array.isArray(o.tasks) ? (o.tasks as unknown[]).map(str).map((t) => t.trim()).filter(Boolean) : [];
  const code = str(o.code).trim();
  const client = str(o.client).trim();
  if (!code && !client) return null;
  const defaultTask = str(o.defaultTask);
  return {
    id: str(o.id) || makeId(),
    client: client || code,
    aliases: Array.isArray(o.aliases) ? (o.aliases as unknown[]).map(str).map((a) => a.trim()).filter(Boolean) : [],
    code,
    tasks: [...new Set(tasks)],
    defaultTask: tasks.includes(defaultTask) ? defaultTask : "",
    billable: o.billable !== false,
    fullName: str(o.fullName) || undefined,
    source: (["screenshot", "paste", "file", "manual"] as const).find((s) => s === o.source),
  };
}

let fallbackId = 0;
const localId = () => `p-${Date.now().toString(36)}-${(fallbackId++).toString(36)}`;

export function loadProjects(): ProjectMapping[] {
  const v = read<unknown[]>(KEYS.projects);
  return Array.isArray(v) ? v.map((p) => sanitizeProject(p, localId)).filter((p): p is ProjectMapping => Boolean(p)) : [];
}
export const saveProjects = (p: ProjectMapping[]) => write(KEYS.projects, p);

export function loadSettings(): Settings {
  const v = read<Partial<Settings>>(KEYS.settings);
  const s = { ...defaultSettings(), ...(v ?? {}) };
  // Users of v1 who already have projects shouldn't see the first-run wizard.
  if (v && v.onboarding === undefined) s.onboarding = loadProjects().length ? "done" : "active";
  return s;
}
export const saveSettings = (s: Settings) => write(KEYS.settings, s);

export function loadRules(): MatchRule[] {
  const v = read<MatchRule[]>(KEYS.rules);
  return Array.isArray(v) ? v.filter((r) => r && typeof r.key === "string" && typeof r.projectId === "string") : [];
}
export const saveRules = (r: MatchRule[]) => write(KEYS.rules, r);

export interface Draft {
  entries: TimeEntry[];
  period: Period;
  savedAt: string;
}
export const loadDraft = () => read<Draft>(KEYS.draft);
export const saveDraft = (d: Draft) => write(KEYS.draft, d);
export const clearDraft = () => remove(KEYS.draft);

/** Unsaved project-import review (so an interrupted setup can resume). */
export const loadProjectDraft = <T,>() => read<T>(KEYS.projectDraft);
export const saveProjectDraft = (d: unknown) => (d ? write(KEYS.projectDraft, d) : remove(KEYS.projectDraft));

export function clearEverything() {
  for (const k of Object.values(KEYS)) remove(k);
  remove("tsc.v1.accessCode");
}

/* ------------------------------ backups ------------------------------ */

export interface Backup {
  app: "timesheet-converter";
  version: 1 | 2;
  exportedAt: string;
  projects: ProjectMapping[];
  settings: Settings;
  rules?: MatchRule[];
}

export function makeBackup(projects: ProjectMapping[], settings: Settings, rules: MatchRule[]): Backup {
  return { app: "timesheet-converter", version: 2, exportedAt: new Date().toISOString(), projects, settings, rules };
}

/** Accepts v1 backups (projects + settings) and v2 backups (+ remembered matches). */
export function parseBackup(text: string, makeId: () => string = localId): Backup {
  let v: Partial<Backup>;
  try {
    v = JSON.parse(text) as Partial<Backup>;
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  if (v?.app !== "timesheet-converter" || !Array.isArray(v.projects)) throw new Error("This is not a Timesheet Converter backup file.");
  const projects = v.projects.map((p) => sanitizeProject(p, makeId)).filter((p): p is ProjectMapping => Boolean(p));
  const base = defaultSettings();
  const s = (v.settings ?? {}) as Partial<Settings>;
  const settings: Settings = {
    ...base,
    timeZone: typeof s.timeZone === "string" ? s.timeZone : base.timeZone,
    defaultLocation: typeof s.defaultLocation === "string" ? s.defaultLocation : "",
    locationRequired: s.locationRequired !== false,
    exclusionKeywords: Array.isArray(s.exclusionKeywords) ? s.exclusionKeywords.filter((k) => typeof k === "string") : base.exclusionKeywords,
    csvDateOrder: s.csvDateOrder === "DMY" || s.csvDateOrder === "YMD" ? s.csvDateOrder : "MDY",
    keepTaskNumbers: s.keepTaskNumbers === true,
    onboarding: projects.length ? "done" : "active",
    onboardingStep: projects.length ? 5 : 1,
  };
  const ids = new Set(projects.map((p) => p.id));
  const rules = (Array.isArray(v.rules) ? v.rules : []).filter((r) => r && typeof r.key === "string" && ids.has(r.projectId));
  return { app: "timesheet-converter", version: v.version === 2 ? 2 : 1, exportedAt: str(v.exportedAt), projects, settings, rules };
}
