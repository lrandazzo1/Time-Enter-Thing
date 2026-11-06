import type { Period, ProjectMapping, Settings, TimeEntry } from "./types";
import { addDays, browserTimeZone, mondayOf, todayIn } from "./time";

/**
 * Browser-local persistence. Everything a user configures or imports stays in *their* browser
 * (localStorage on this site's origin); nothing is sent to a server except screenshots the user
 * explicitly submits for AI recognition. Every access is wrapped because storage can be blocked
 * (private windows, strict privacy settings).
 */
const KEYS = {
  projects: "tsc.v1.projects",
  settings: "tsc.v1.settings",
  draft: "tsc.v1.draft",
  accessCode: "tsc.v1.accessCode",
} as const;

export function defaultSettings(): Settings {
  return {
    timeZone: browserTimeZone(),
    defaultLocation: "",
    locationRequired: true,
    exclusionKeywords: ["lunch", "PTO", "personal", "out of office", "OOO", "holiday", "doctor", "dentist", "appointment", "birthday", "happy hour"],
    csvDateOrder: "MDY",
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

export function loadProjects(): ProjectMapping[] {
  const v = read<ProjectMapping[]>(KEYS.projects);
  return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string").map((p) => ({ ...p, aliases: p.aliases ?? [], tasks: p.tasks ?? [], defaultTask: p.defaultTask ?? "", billable: p.billable !== false })) : [];
}
export const saveProjects = (p: ProjectMapping[]) => write(KEYS.projects, p);

export function loadSettings(): Settings {
  const v = read<Partial<Settings>>(KEYS.settings);
  return { ...defaultSettings(), ...(v ?? {}) };
}
export const saveSettings = (s: Settings) => write(KEYS.settings, s);

export interface Draft {
  entries: TimeEntry[];
  period: Period;
  savedAt: string;
}
export const loadDraft = () => read<Draft>(KEYS.draft);
export const saveDraft = (d: Draft) => write(KEYS.draft, d);
export function clearDraft() {
  try {
    window.localStorage.removeItem(KEYS.draft);
  } catch {
    /* ignore */
  }
}

export const loadAccessCode = () => read<string>(KEYS.accessCode) ?? "";
export const saveAccessCode = (c: string) => write(KEYS.accessCode, c);

export interface Backup {
  app: "timesheet-converter";
  version: 1;
  exportedAt: string;
  projects: ProjectMapping[];
  settings: Settings;
}

export function makeBackup(projects: ProjectMapping[], settings: Settings): Backup {
  return { app: "timesheet-converter", version: 1, exportedAt: new Date().toISOString(), projects, settings };
}

export function parseBackup(text: string): Backup {
  const v = JSON.parse(text) as Backup;
  if (v?.app !== "timesheet-converter" || !Array.isArray(v.projects)) throw new Error("This is not a Timesheet Converter backup file.");
  return { ...v, settings: { ...defaultSettings(), ...v.settings } };
}
