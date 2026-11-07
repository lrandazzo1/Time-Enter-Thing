import type { CalendarEvent, ImportNote, MatchRule, ProjectMapping, Settings, TimeEntry } from "./types";
import { bestFuzzy, domainMatchesClient } from "./fuzzy";
import { findCodes } from "./projector/codes";
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

export function cleanTitle(title: string): string {
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
 * Priority: (remembered title rules are applied by eventToEntry first)
 * 1. Exact project code in the title/description (e.g. "P001234-001").
 * 2. Naming convention "CLIENT | TASK | WORK DESCRIPTION" with a known client/alias.
 * 3. Exact client name or alias as a whole phrase in the title, then the description.
 * (4. organizer e-mail domain and 5. fuzzy suggestions are handled by eventToEntry.)
 */
export function matchEvent(title: string, description: string, projects: ProjectMapping[]): MatchResult {
  const notes: ImportNote[] = [];
  const t = cleanTitle(title);
  const parts = t.split("|").map((s) => s.trim());

  // 1. exact project code
  const coded = [...findCodes(t), ...findCodes(description)].filter((c) => c.status === "valid").map((c) => projects.find((p) => p.code.toUpperCase() === c.raw.toUpperCase())).filter((p): p is ProjectMapping => Boolean(p));
  const codedUnique = [...new Set(coded)];
  if (codedUnique.length === 1) {
    const project = codedUnique[0];
    const mentioned = tasksMentioned(t + " " + description, project);
    const task = mentioned.length === 1 ? mentioned[0] : resolveDefaultTask(project) ?? "";
    if (!task) notes.push({ code: "task-unclear", level: "warning", message: `Choose which ${project.client} task this was.` });
    const desc = parts.length >= 3 ? parts.slice(2).join(" | ").trim() : t;
    return { projectId: project.id, task, description: desc || t, notes };
  }

  if (parts.length >= 2 && parts[0]) {
    let project = findProjectByName(parts[0], projects);
    const desc = parts.slice(2).join(" | ").trim();
    // "Our Firm | Acme: Working Session" — an internal (own-company) name in front of a client name
    // is not the naming convention; let the client match below decide.
    if (project && !project.billable && projects.some((p) => p.billable && namesOf(p).some((n) => containsPhrase(parts.slice(1).join(" "), n)))) project = null;
    // Your own organisation's name in front of a "|" is only the convention when the next part is one
    // of that internal project's tasks ("OurFirm | Internal - Meeting | Team sync").
    if (project && !project.billable && !project.aliases.some((a) => normalize(a) === normalize(parts[0])) && !(parts[1] && findTask(parts[1], project))) project = null;
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
    let hits = projects.filter((p) => namesOf(p).some((n) => containsPhrase(text, n)));
    // An internal project's client name is usually your own company, which appears in many client
    // meeting titles ("Acme | Our Firm Working Session"). If it only matched by that name and a billable
    // client also matched, prefer the client. An explicit alias (e.g. "INTERNAL") still counts.
    const explicitly = (p: ProjectMapping) => [p.code, ...p.aliases].some((n) => n.trim().length >= 2 && containsPhrase(text, n));
    const weak = hits.filter((p) => !p.billable && !explicitly(p));
    if (hits.some((p) => p.billable)) hits = hits.filter((p) => p.billable || explicitly(p));
    else if (hits.length && hits.every((p) => weak.includes(p))) {
      // Only your own company's name appears — that alone never decides where time goes.
      notes.push({ code: "ambiguous-project", level: "warning", message: `Mentions ${weak.map((p) => p.client).join(" / ")} (your own organisation?) but no client — choose the project, or the internal project if this was internal time.` });
      return { projectId: null, task: "", description: t, notes, candidates: weak.map((p) => p.id) };
    }
    // Prefer the most specific (longest) name when one hit's name contains another's.
    let unique = dedupeBySpecificity(hits, text);
    // "INTERNAL: Acme sync" — an internal meeting about a client may not be billable to that client.
    const internals = projects.filter((p) => !p.billable);
    if (unique.length === 1 && unique[0].billable && /\binternal\b/i.test(t) && internals.length) {
      unique = [unique[0], ...internals.filter((p) => !unique.includes(p))];
      notes.push({ code: "ambiguous-project", level: "warning", message: `Says “internal” — bill it to ${unique[0].client}, or record it as internal time?` });
      return { projectId: null, task: "", description: t, notes, candidates: unique.map((p) => p.id) };
    }
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
  // "Unknown Client | Task | Work description": keep the description part.
  return { projectId: null, task: "", description: parts.length >= 3 && parts.slice(2).join(" | ").trim() ? parts.slice(2).join(" | ").trim() : t, notes };
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
/** Description for a title: the third segment of "CLIENT | TASK | DESCRIPTION", otherwise the cleaned title. */
export function defaultDescription(title: string): string {
  const t = cleanTitle(title);
  const parts = t.split("|").map((x) => x.trim());
  const d = parts.length >= 3 ? parts.slice(2).join(" | ").trim() : "";
  return d || t;
}

/** Normalized key for remembering a confirmed title → project/task assignment. */
export function ruleKey(title: string): string {
  return normalize(cleanTitle(title))
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, " ")
    .replace(/[^a-z0-9&|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A short, human label for a client the calendar mentions but that isn't configured. */
export function unknownClientHint(title: string, domains: string[] = []): string {
  const t = cleanTitle(title);
  const parts = t.split("|").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2 && parts[0].length <= 60) return parts[0];
  const d = domains[0];
  if (d) return d;
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}

export function eventToEntry(ev: CalendarEvent, projects: ProjectMapping[], settings: Settings, rules: MatchRule[] = []): TimeEntry {
  const rule = rules.find((r) => r.key === ruleKey(ev.title) && projects.some((p) => p.id === r.projectId));
  const m = rule
    ? { projectId: rule.projectId, task: projects.find((p) => p.id === rule.projectId)!.tasks.includes(rule.task) ? rule.task : "", description: defaultDescription(ev.title), notes: [{ code: "remembered", level: "info", message: "Matched using an assignment you confirmed before." } as ImportNote], candidates: undefined }
    : matchEvent(ev.title, ev.description, projects);
  const notes: ImportNote[] = [...m.notes];
  let projectId = m.projectId;
  let task = m.task;
  let candidates = m.candidates;
  let suggestion: TimeEntry["suggestion"];

  const internalOnly = (ids?: string[]) => Boolean(ids?.length) && ids!.every((id) => projects.find((p) => p.id === id)?.billable === false);
  const saysInternal = /\binternal\b/i.test(ev.title);
  const internals = projects.filter((p) => !p.billable).map((p) => p.id);
  const dropNotes = (...codes: string[]) => {
    for (const c of codes) for (let i = notes.findIndex((n) => n.code === c); i >= 0; i = notes.findIndex((n) => n.code === c)) notes.splice(i, 1);
  };

  // 3b. organizer name — calendar resource accounts are often named after the client ("Organizer: Acme Corp")
  if (!projectId && (!candidates || internalOnly(candidates)) && ev.organizer) {
    const org = normalize(ev.organizer);
    const byOrg = projects.filter((p) => p.billable && [p.client, ...p.aliases].some((n) => normalize(n) === org));
    if (byOrg.length === 1) {
      const p = byOrg[0];
      if (saysInternal && internals.length) {
        candidates = [p.id, ...internals];
        dropNotes("no-project", "ambiguous-project");
        notes.push({ code: "ambiguous-project", level: "warning", message: `Organized by ${p.client} but says “internal” — bill it to ${p.client}, or record it as internal time?` });
      } else {
        projectId = p.id;
        candidates = undefined;
        const mentioned = tasksMentioned(ev.title + " " + ev.description, p);
        task = mentioned.length === 1 ? mentioned[0] : resolveDefaultTask(p) ?? "";
        dropNotes("no-project", "ambiguous-project");
        notes.push({ code: "domain-match", level: "warning", message: `Matched ${p.client} from the meeting organizer (“${ev.organizer}”) — confirm.` });
        if (!task) notes.push({ code: "task-unclear", level: "warning", message: `Choose which ${p.client} task this was.` });
      }
    }
  }

  // 4. organizer / attendee e-mail domain (strong contextual signal, still shown for confirmation)
  if (!projectId && (!candidates || internalOnly(candidates)) && ev.domains?.length) {
    const byDomain = projects.filter((p) => p.billable && ev.domains!.some((d) => domainMatchesClient(d, p.client) || p.aliases.some((a) => domainMatchesClient(d, a))));
    if (byDomain.length === 1 && saysInternal && internals.length) {
      candidates = [byDomain[0].id, ...internals];
      dropNotes("no-project", "ambiguous-project");
      notes.push({ code: "ambiguous-project", level: "warning", message: `A ${byDomain[0].client} meeting that says “internal” — bill it to ${byDomain[0].client}, or record it as internal time?` });
    } else if (byDomain.length === 1) {
      const p = byDomain[0];
      projectId = p.id;
      candidates = undefined;
      dropNotes("ambiguous-project");
      const mentioned = tasksMentioned(ev.title + " " + ev.description, p);
      task = mentioned.length === 1 ? mentioned[0] : resolveDefaultTask(p) ?? "";
      const i = notes.findIndex((n) => n.code === "no-project");
      if (i >= 0) notes.splice(i, 1);
      notes.push({ code: "domain-match", level: "warning", message: `Matched ${p.client} from the meeting's e-mail domain (${ev.domains!.find((d) => domainMatchesClient(d, p.client) || p.aliases.some((a) => domainMatchesClient(d, a)))}) — confirm.` });
      if (!task) notes.push({ code: "task-unclear", level: "warning", message: `Choose which ${p.client} task this was.` });
    } else if (byDomain.length > 1) {
      candidates = byDomain.map((p) => p.id);
    }
  }
  // 5. fuzzy suggestion — never applied automatically (also when only your own internal project was mentioned)
  const onlyInternal = candidates?.every((id) => projects.find((p) => p.id === id)?.billable === false);
  if (!projectId && (!candidates || onlyInternal)) {
    const pool = onlyInternal ? projects.filter((p) => p.billable) : projects;
    // Your own organisation's name is noise for guessing the client.
    let text = cleanTitle(ev.title);
    for (const p of projects.filter((x) => !x.billable)) text = text.replace(new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(p.client)}(?=$|[^A-Za-z0-9])`, "gi"), "$1 ");
    const hit = bestFuzzy(text, pool, (p) => [p.client, ...p.aliases]);
    if (hit) {
      const mentioned = tasksMentioned(ev.title + " " + ev.description, hit.item);
      suggestion = { projectId: hit.item.id, reason: hit.reason, task: mentioned.length === 1 ? mentioned[0] : resolveDefaultTask(hit.item) ?? undefined, alias: hit.token };
      notes.push({ code: "fuzzy-suggestion", level: "warning", message: `Possibly ${hit.item.client} (${hit.reason}) — confirm or choose another project.` });
      if (saysInternal && internals.length && hit.item.billable) {
        candidates = [hit.item.id, ...internals.filter((id) => id !== hit.item.id)];
        notes.push({ code: "ambiguous-project", level: "warning", message: `Says “internal” — bill it to ${hit.item.client}, or record it as internal time?` });
      }
    }
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
    excludeReason = ev.endDate ? `All-day event (${ev.date} to ${ev.endDate})` : "All-day event";
    notes.push({ code: "all-day", level: "info", message: "All-day event (e.g. someone's PTO) — excluded. Include it and enter hours only if it was your work." });
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
  for (const pn of ev.parseNotes ?? []) notes.push({ code: pn.code, level: pn.code === "info" ? "info" : "warning", message: pn.message });
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
    location: (projectId && projects.find((p) => p.id === projectId)?.location) || settings.defaultLocation,
    included,
    excludeReason,
    status: ev.status,
    notes,
    candidates,
    suggestion,
    domains: ev.domains,
    organizer: ev.organizer,
    sourceText: ev.sourceText,
    endDate: ev.endDate,
    scheduledMinutes: ev.allDay ? undefined : minutes,
    fingerprint: fingerprintOf(ev.date, ev.start, ev.end, ev.title),
  };
}
