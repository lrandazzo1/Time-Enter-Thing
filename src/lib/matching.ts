import type { CalendarEvent, ImportNote, ProjectMapping, Settings, TimeEntry } from "./types";
import { fromMinutes, intervalMinutes, toMinutes } from "./time";
import { uid } from "./uid";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Remove a leading numeric sequence prefix that some BigTime screens display ("2 Planning" -> "Planning"). */
export function stripTaskPrefix(task: string): string {
  return task.replace(/^\s*\d+[\s.)-]+(?=\S)/, "").trim();
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (p.length < 2) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(p)}($|[^a-z0-9])`, "i").test(normalize(haystack));
}

function namesOf(p: ProjectMapping): string[] {
  return [p.client, p.code, ...p.aliases].filter((n) => n && n.trim().length >= 2);
}

export function findProjectByName(name: string, projects: ProjectMapping[]): ProjectMapping | null {
  const n = normalize(name);
  if (!n) return null;
  return projects.find((p) => namesOf(p).some((x) => normalize(x) === n)) ?? null;
}

/** Match a task string against a project's task list (exact, then prefix-insensitive). */
export function findTask(name: string, project: ProjectMapping): string | null {
  const n = normalize(name);
  if (!n) return null;
  const exact = project.tasks.find((t) => normalize(t) === n);
  if (exact) return exact;
  const loose = project.tasks.find((t) => normalize(stripTaskPrefix(t)) === normalize(stripTaskPrefix(name)));
  return loose ?? null;
}

/** Tasks whose name appears as a phrase in the text; longest first. */
function tasksMentioned(text: string, project: ProjectMapping): string[] {
  return project.tasks
    .filter((t) => containsPhrase(text, t) || containsPhrase(text, stripTaskPrefix(t)))
    .sort((a, b) => b.length - a.length);
}

function cleanTitle(title: string): string {
  return title.replace(/^\s*(cancel+ed|updated|fw|fwd|re)\s*:\s*/i, "").trim();
}

export interface MatchResult {
  projectId: string | null;
  task: string;
  description: string;
  notes: ImportNote[];
  candidates?: string[];
}

/**
 * Deterministic matcher. Never guesses: when the project or task is not clear it leaves the
 * field empty and records why, so the review screen can ask the user.
 *
 * 1. Naming convention "CLIENT | TASK | WORK DESCRIPTION" (preferred, exact).
 * 2. Otherwise search the title (then description) for a configured client name / alias / project code.
 */
export function matchEvent(title: string, description: string, projects: ProjectMapping[]): MatchResult {
  const notes: ImportNote[] = [];
  const t = cleanTitle(title);
  const parts = t.split("|").map((s) => s.trim());

  if (parts.length >= 2 && parts[0]) {
    const project = findProjectByName(parts[0], projects);
    const desc = parts.slice(2).join(" | ").trim();
    if (project) {
      const task = parts[1] ? findTask(parts[1], project) : null;
      if (task) return { projectId: project.id, task, description: desc || t, notes };
      const fallback = resolveDefaultTask(project);
      if (fallback) {
        // Either no task segment, or a meeting title that merely contains "|" (e.g. "Client | Working Session").
        notes.push({
          code: "default-task",
          level: "info",
          message: parts[1] ? `"${parts[1]}" isn't a ${project.client} task; used ${project.tasks.length === 1 ? "its only" : "the default"} task "${fallback}".` : `No task in the title; used the default task "${fallback}".`,
        });
        return { projectId: project.id, task: fallback, description: desc || t, notes };
      }
      notes.push({
        code: "convention-task-unmatched",
        level: "warning",
        message: parts[1]
          ? `Task "${parts[1]}" is not one of ${project.client}'s tasks (${project.tasks.join(", ") || "none configured"}).`
          : `Title has no task; ${project.client} has several tasks — choose one.`,
      });
      return { projectId: project.id, task: "", description: desc || t, notes };
    }
    // fall through to keyword search when the first segment is not a known client
  }

  const searchIn = [t, description];
  for (const [i, text] of searchIn.entries()) {
    if (!text) continue;
    const hits = projects.filter((p) => namesOf(p).some((n) => containsPhrase(text, n)));
    // Prefer the most specific (longest) name when one hit's name contains another's.
    const unique = dedupeBySpecificity(hits, text);
    if (unique.length === 1) {
      const project = unique[0];
      const mentioned = tasksMentioned(t + " " + description, project);
      let task = "";
      if (project.tasks.length === 1) task = project.tasks[0];
      else if (mentioned.length === 1 || (mentioned.length > 1 && !mentioned.slice(1).some((m) => !mentioned[0].includes(m)))) task = mentioned[0];
      else if (mentioned.length === 0 && project.defaultTask && project.tasks.includes(project.defaultTask)) {
        task = project.defaultTask;
        notes.push({ code: "default-task", level: "info", message: `Used ${project.client}'s default task "${task}".` });
      }
      if (!task) {
        notes.push({
          code: "task-unclear",
          level: "warning",
          message: mentioned.length > 1 ? `Title mentions several ${project.client} tasks (${mentioned.join(", ")}) — choose one.` : `Choose which ${project.client} task this was.`,
        });
      }
      if (i === 1) notes.push({ code: "info", level: "info", message: `Matched ${project.client} from the event description, not the title.` });
      return { projectId: project.id, task, description: t, notes };
    }
    if (unique.length > 1) {
      notes.push({ code: "ambiguous-project", level: "warning", message: `Could belong to ${unique.map((p) => p.client).join(" or ")} — choose the project.` });
      return { projectId: null, task: "", description: t, notes, candidates: unique.map((p) => p.id) };
    }
  }
  notes.push({ code: "no-project", level: "warning", message: "No configured client or project found in this event." });
  return { projectId: null, task: "", description: t, notes };
}

function resolveDefaultTask(p: ProjectMapping): string | null {
  if (p.tasks.length === 1) return p.tasks[0];
  if (p.defaultTask && p.tasks.includes(p.defaultTask)) return p.defaultTask;
  return null;
}

function dedupeBySpecificity(hits: ProjectMapping[], text: string): ProjectMapping[] {
  if (hits.length < 2) return hits;
  const longest = (p: ProjectMapping) =>
    Math.max(...namesOf(p).filter((n) => containsPhrase(text, n)).map((n) => n.length));
  return hits.filter((p) => !hits.some((q) => q !== p && longest(q) > longest(p) && namesOf(q).some((n) => containsPhrase(text, n) && namesOf(p).some((m) => containsPhrase(n, m)))));
}

export function fingerprintOf(date: string, start: string | null, end: string | null, title: string): string {
  return [date, start ?? "", end ?? "", normalize(cleanTitle(title)).replace(/[^a-z0-9]/g, "")].join("|");
}

/** Turn a parsed calendar event into a proposed time entry (matching + exclusion rules). */
export function eventToEntry(ev: CalendarEvent, projects: ProjectMapping[], settings: Settings): TimeEntry {
  const m = matchEvent(ev.title, ev.description, projects);
  const notes: ImportNote[] = [...m.notes];
  let projectId = m.projectId;
  let task = m.task;
  let candidates = m.candidates;

  if (ev.ai) {
    const aiProject = projects.find((p) => p.code.toLowerCase() === ev.ai!.projectCode.trim().toLowerCase()) ?? null;
    const aiTask = aiProject && ev.ai.task ? findTask(ev.ai.task, aiProject) : null;
    if (!projectId && aiProject && !candidates) {
      projectId = aiProject.id;
      task = task || aiTask || "";
      notes.push({ code: "ai-suggested", level: "warning", message: `AI suggested ${aiProject.client}${aiTask ? ` / ${aiTask}` : ""} — confirm.` });
      const i = notes.findIndex((n) => n.code === "no-project");
      if (i >= 0) notes.splice(i, 1);
      if (!task && aiProject.tasks.length > 1) notes.push({ code: "task-unclear", level: "warning", message: `Choose which ${aiProject.client} task this was.` });
    } else if (projectId && aiProject && aiProject.id !== projectId) {
      notes.push({ code: "ai-disagrees", level: "warning", message: `AI suggested ${aiProject.client} instead — check the project.` });
    } else if (projectId && aiProject && aiTask && !task) {
      task = aiTask;
      notes.push({ code: "ai-suggested", level: "warning", message: `AI suggested task "${aiTask}" — confirm.` });
      const i = notes.findIndex((n) => n.code === "task-unclear");
      if (i >= 0) notes.splice(i, 1);
    }
    if (ev.ai.confidence === "low") notes.push({ code: "ai-low-confidence", level: "warning", message: `Screenshot text was hard to read${ev.ai.notes ? `: ${ev.ai.notes}` : ""} — check title and times.` });
    else if (ev.ai.notes) notes.push({ code: "info", level: "info", message: `AI note: ${ev.ai.notes}` });
    if (candidates && projectId) candidates = undefined;
  }

  let included = true;
  let excludeReason: string | undefined;
  const kw = settings.exclusionKeywords.find((k) => k.trim() && containsPhrase(`${ev.title}`, k));
  if (ev.canceled) {
    included = false;
    excludeReason = "Canceled";
    notes.push({ code: "canceled", level: "info", message: "Canceled meeting — excluded." });
  } else if (ev.allDay) {
    included = false;
    excludeReason = "All-day event";
    notes.push({ code: "all-day", level: "info", message: "All-day event — excluded (add hours manually if it was work)." });
  } else if (kw) {
    included = false;
    excludeReason = `Matches exclusion keyword "${kw}"`;
    notes.push({ code: "excluded-keyword", level: "info", message: `Looks personal/non-working ("${kw}") — excluded.` });
  } else if (ev.status === "free") {
    included = false;
    excludeReason = "Shown as Free";
    notes.push({ code: "free", level: "info", message: "Shown as Free on your calendar — excluded; include it if you attended." });
  } else if (ev.status === "oof") {
    included = false;
    excludeReason = "Out of office";
    notes.push({ code: "free", level: "info", message: "Shown as Out of Office — excluded." });
  }
  if (ev.status === "tentative" && !ev.canceled) {
    notes.push({ code: "tentative", level: "warning", message: "Tentative — confirm you attended and for how long." });
  }
  if (ev.recurring) notes.push({ code: "recurring", level: "info", message: "Occurrence of a recurring series." });
  if (ev.crossesMidnight) notes.push({ code: "crosses-midnight", level: "warning", message: "Event runs past midnight; only the time on this date was counted." });

  let intervals = ev.start && ev.end ? [{ start: ev.start, end: ev.end }] : [];
  let minutes = ev.minutes ?? (ev.start && ev.end ? intervalMinutes(ev.start, ev.end) : 0);
  if (ev.start && !ev.end && ev.minutes) intervals = [{ start: ev.start, end: fromMinutes(toMinutes(ev.start) + ev.minutes) }];
  if (!ev.allDay && (!ev.start || !ev.end) && !ev.minutes) {
    notes.push({ code: "missing-times", level: "warning", message: "Start/end time not available — enter the hours worked." });
    minutes = 0;
  }

  return {
    id: uid(),
    source: ev.source,
    sourceLabel: ev.sourceLabel,
    title: ev.title,
    date: ev.date,
    intervals,
    minutes,
    projectId,
    task,
    description: m.description,
    location: settings.defaultLocation,
    included,
    excludeReason,
    status: ev.status,
    notes,
    candidates,
    fingerprint: fingerprintOf(ev.date, ev.start, ev.end, ev.title),
  };
}
