import type { Issue, Period, ProjectMapping, Settings, TimeEntry } from "./types";
import { formatDecimalHours, hundredths, isValidISODate, toMinutes } from "./time";

export interface OverlapCluster {
  date: string;
  entryIds: string[];
  /** Real clock minutes covered by the union of the entries' calendar times. */
  unionMinutes: number;
  /** Minutes currently being claimed by the entries. */
  claimedMinutes: number;
  /** True when claimed time exceeds clock time and the user has not confirmed it. */
  unresolved: boolean;
}

/** Group included entries whose calendar times overlap on the same date. */
export function findOverlaps(entries: TimeEntry[]): OverlapCluster[] {
  const byDate = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    if (!e.included || e.intervals.length === 0) continue;
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const clusters: OverlapCluster[] = [];
  for (const [date, list] of byDate) {
    const segs = list
      .flatMap((e) => e.intervals.map((iv) => ({ id: e.id, s: toMinutes(iv.start), t: toMinutes(iv.end) })))
      .filter((x) => x.t > x.s)
      .sort((a, b) => a.s - b.s || a.t - b.t);
    let cur: { ids: Set<string>; s: number; t: number; union: number } | null = null;
    const flush = () => {
      if (cur && cur.ids.size > 1) {
        const ids = [...cur.ids];
        const members = list.filter((e) => cur!.ids.has(e.id));
        const claimed = members.reduce((a, e) => a + e.minutes, 0);
        const unresolved = claimed > cur.union + 0.5 && !members.every((e) => e.overlapAck);
        clusters.push({ date, entryIds: ids, unionMinutes: cur.union, claimedMinutes: claimed, unresolved });
      }
    };
    for (const seg of segs) {
      if (cur && seg.s < cur.t) {
        cur.ids.add(seg.id);
        if (seg.t > cur.t) {
          cur.union += seg.t - cur.t;
          cur.t = seg.t;
        }
      } else {
        flush();
        cur = { ids: new Set([seg.id]), s: seg.s, t: seg.t, union: seg.t - seg.s };
      }
    }
    flush();
  }
  return clusters;
}

/** Included entries that share an identical calendar fingerprint (e.g. same meeting in two screenshots). */
export function findDuplicates(entries: TimeEntry[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.included || !e.fingerprint) continue;
    const g = groups.get(e.fingerprint) ?? [];
    g.push(e.id);
    groups.set(e.fingerprint, g);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Split overlapping time evenly: each overlapping slice of clock time is shared equally by
 * the entries that were scheduled during it. Returns new minute values keyed by entry id.
 */
export function splitOverlapEvenly(entries: TimeEntry[], cluster: OverlapCluster): Record<string, number> {
  const members = entries.filter((e) => cluster.entryIds.includes(e.id));
  const points = new Set<number>();
  for (const e of members) for (const iv of e.intervals) {
    points.add(toMinutes(iv.start));
    points.add(toMinutes(iv.end));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const result: Record<string, number> = Object.fromEntries(members.map((e) => [e.id, 0]));
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const active = members.filter((e) => e.intervals.some((iv) => toMinutes(iv.start) <= a && toMinutes(iv.end) >= b));
    for (const e of active) result[e.id] += (b - a) / active.length;
  }
  return result;
}

export interface MergeOutcome {
  entries: TimeEntry[];
  merged: number;
  skipped: string[];
}

/** Combine included entries with the same date + project + task into one line. */
export function mergeEntries(entries: TimeEntry[]): MergeOutcome {
  const unresolved = new Set(findOverlaps(entries).filter((c) => c.unresolved).flatMap((c) => c.entryIds));
  const groups = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    if (!e.included || !e.projectId || !e.task) continue;
    const k = `${e.date}|${e.projectId}|${e.task}|${e.location}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const remove = new Set<string>();
  const replace = new Map<string, TimeEntry>();
  const skipped: string[] = [];
  let merged = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    if (g.some((e) => unresolved.has(e.id))) {
      skipped.push(`${g[0].date}: resolve overlapping time before merging ${g[0].task}.`);
      continue;
    }
    const descs = [...new Set(g.map((e) => e.description.trim()).filter(Boolean))];
    const first = g[0];
    replace.set(first.id, {
      ...first,
      minutes: g.reduce((a, e) => a + e.minutes, 0),
      intervals: g.flatMap((e) => e.intervals).sort((a, b) => a.start.localeCompare(b.start)),
      description: descs.join("; "),
      notes: [{ code: "info", level: "info", message: `Merged ${g.length} entries.` }],
      overlapAck: g.every((e) => e.overlapAck) || undefined,
      duplicateAck: true,
      fingerprint: undefined,
      title: g.map((e) => e.title).join(" + "),
    });
    g.slice(1).forEach((e) => remove.add(e.id));
    merged += g.length - 1;
  }
  return {
    entries: entries.filter((e) => !remove.has(e.id)).map((e) => replace.get(e.id) ?? e),
    merged,
    skipped,
  };
}

export interface ValidationContext {
  projects: ProjectMapping[];
  settings: Settings;
  period: Period;
}

/** Per-entry and timesheet-level issues. Errors block export; warnings are shown for review. */
export function validate(entries: TimeEntry[], ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  const included = entries.filter((e) => e.included);
  if (included.length === 0) issues.push({ level: "error", code: "empty", message: "No entries are included in the timesheet." });
  const byId = new Map(ctx.projects.map((p) => [p.id, p]));

  for (const e of included) {
    const label = `${e.date || "No date"} · ${e.description || e.title || "Untitled"}`;
    if (!isValidISODate(e.date)) issues.push({ level: "error", code: "date", entryId: e.id, message: `${label}: invalid or missing work date.` });
    else if (e.date < ctx.period.start || e.date > ctx.period.end) issues.push({ level: "warning", code: "outside-period", entryId: e.id, message: `${label}: date is outside the timesheet period.` });
    if (!(e.minutes > 0) || hundredths(e.minutes) <= 0) issues.push({ level: "error", code: "hours", entryId: e.id, message: `${label}: hours must be greater than 0.00.` });
    else if (e.minutes > 24 * 60) issues.push({ level: "error", code: "hours", entryId: e.id, message: `${label}: more than 24 hours in one entry.` });
    const p = e.projectId ? byId.get(e.projectId) : undefined;
    if (!p) issues.push({ level: "error", code: "project", entryId: e.id, message: `${label}: choose a project.` });
    else {
      if (!p.code.trim()) issues.push({ level: "error", code: "project", entryId: e.id, message: `${label}: project ${p.client} has no BigTime project code.` });
      if (!e.task) issues.push({ level: "error", code: "task", entryId: e.id, message: `${label}: choose a task.` });
      else if (!p.tasks.includes(e.task)) issues.push({ level: "error", code: "task", entryId: e.id, message: `${label}: "${e.task}" is not a configured task for ${p.client}.` });
    }
    if (ctx.settings.locationRequired && !e.location.trim()) issues.push({ level: "error", code: "location", entryId: e.id, message: `${label}: location is required — set your BigTime location.` });
    if (!e.description.trim()) issues.push({ level: "warning", code: "description", entryId: e.id, message: `${label}: description is empty.` });
    for (const n of e.notes) {
      if (n.level === "warning" && !["no-project", "ambiguous-project", "task-unclear", "convention-task-unmatched", "missing-times", "duplicate"].includes(n.code)) {
        issues.push({ level: "warning", code: n.code, entryId: e.id, message: `${label}: ${n.message}` });
      }
    }
  }

  for (const c of findOverlaps(entries)) {
    if (c.unresolved) {
      issues.push({
        level: "error",
        code: "overlap",
        entryId: c.entryIds[0],
        message: `${c.date}: ${c.entryIds.length} overlapping events claim ${formatDecimalHours(c.claimedMinutes)} h but only ${formatDecimalHours(c.unionMinutes)} h of clock time — adjust hours, exclude one, or confirm.`,
      });
    }
  }
  for (const g of findDuplicates(entries)) {
    const members = entries.filter((e) => g.includes(e.id));
    if (!members.every((e) => e.duplicateAck)) {
      issues.push({ level: "error", code: "duplicate", entryId: g[0], message: `${members[0].date}: "${members[0].title}" appears ${g.length} times — exclude the duplicate or confirm.` });
    }
  }
  // Exact duplicate export rows
  const seen = new Map<string, number>();
  for (const e of included) {
    const k = [e.date, e.projectId, e.task, e.description.trim().toLowerCase(), e.location, formatDecimalHours(e.minutes)].join("|");
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, n] of seen) if (n > 1) issues.push({ level: "warning", code: "dup-row", message: `${n} identical rows on ${k.split("|")[0]} — consider merging.` });

  const daily = dailyTotals(entries);
  for (const [date, min] of Object.entries(daily)) if (min > 24 * 60) issues.push({ level: "error", code: "day-total", message: `${date}: more than 24 hours in one day.` });
  return issues;
}

export function dailyTotals(entries: TimeEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) if (e.included) out[e.date] = (out[e.date] ?? 0) + e.minutes;
  return out;
}

export interface Totals {
  total: number;
  billable: number;
  internal: number;
  unassigned: number;
  byProject: { projectId: string | null; label: string; minutes: number; billable: boolean | null }[];
}

export function totals(entries: TimeEntry[], projects: ProjectMapping[]): Totals {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const t: Totals = { total: 0, billable: 0, internal: 0, unassigned: 0, byProject: [] };
  const per = new Map<string, Totals["byProject"][number]>();
  for (const e of entries) {
    if (!e.included) continue;
    t.total += e.minutes;
    const p = e.projectId ? byId.get(e.projectId) : undefined;
    if (!p) t.unassigned += e.minutes;
    else if (p.billable) t.billable += e.minutes;
    else t.internal += e.minutes;
    const key = p?.id ?? "none";
    const row = per.get(key) ?? { projectId: p?.id ?? null, label: p ? `${p.client} (${p.code})` : "Unassigned", minutes: 0, billable: p ? p.billable : null };
    row.minutes += e.minutes;
    per.set(key, row);
  }
  t.byProject = [...per.values()].sort((a, b) => b.minutes - a.minutes);
  return t;
}
