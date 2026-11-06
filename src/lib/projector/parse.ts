import { findCodes, isValidCode, type CodeMatch } from "./codes";

/**
 * Projector project/task list parser.
 *
 * Works on plain text (copied from Projector) or OCR lines with bounding boxes. Independent of the
 * OCR engine: anything that can produce `SourceLine[]` per page can use it.
 *
 * Projector shows projects as parent rows and tasks as children, e.g.
 *   Acme Components - Adaptive Planning - Implementation P001234-001
 *     2 Planning
 *     3 Gears
 * The parser never invents codes or tasks; anything uncertain is returned with an issue for review.
 */

export interface SourceLine {
  text: string;
  /** Optional geometry (pixels in the page image). */
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  /** OCR confidence 0–100. */
  confidence?: number;
}

export interface SourcePage {
  label: string;
  lines: SourceLine[];
  width?: number;
}

export interface ParsedTask {
  /** Task name without Projector's numeric prefix. */
  name: string;
  /** Projector's display number, if one was shown ("2" in "2 Planning"). */
  number?: string;
  raw: string;
  uncertain?: string;
}

export type CodeStatus = "valid" | "ambiguous" | "missing";

export interface ParsedProject {
  key: string;
  /** Code exactly as read (empty when missing). */
  code: string;
  codeStatus: CodeStatus;
  codeSuggestion?: string;
  codeIssue?: string;
  fullName: string;
  client: string;
  clientUncertain?: string;
  internal: boolean;
  tasks: ParsedTask[];
  /** Page labels this project was seen on. */
  pages: string[];
  raw: string;
  issues: string[];
}

export interface OrphanTask {
  task: ParsedTask;
  page: string;
  /** Project the list was showing at the end of the previous page (a likely continuation) — a suggestion only. */
  likelyProjectKey?: string;
  reason: string;
}

export interface LooseLine {
  text: string;
  page: string;
  /** Project the line appeared under. */
  projectKey?: string;
}

export interface ParseResult {
  projects: ParsedProject[];
  orphanTasks: OrphanTask[];
  looseLines: LooseLine[];
  rawText: { page: string; text: string }[];
}

/* ------------------------------ text helpers ------------------------------ */

const UI_NOISE = new Set(
  [
    "projects", "project", "tasks", "task", "search", "filter", "filters", "add", "add project", "cancel", "save", "ok", "close", "select",
    "select all", "expand", "expand all", "collapse", "collapse all", "time", "timesheet", "timesheets", "hours", "total", "totals", "my projects",
    "assigned projects", "recent", "favorites", "favourites", "show", "hide", "more", "less", "home", "menu", "help", "logout", "log out",
    "projector", "bigtime", "name", "code", "status", "client", "clients", "billable", "non-billable", "nonbillable", "active", "inactive",
    "project/task", "projects/tasks", "select project", "select task", "select project/task", "late", "new", "today", "week", "submit",
  ].map((s) => s.toLowerCase()),
);

// Status badges Projector shows after a task (and common OCR readings of the small "LATE" pill).
const STATUS_BADGE = /\s+(?:LATE|OVERDUE|NEW|CLOSED|INACTIVE|LOCKED|[(\[{]?L?ATE[)\]}]?|\(LATE\)|\[LATE\])$/;
const INTERNAL_HINT = /\b(internal|non[- ]?billable|overhead|administrative|admin|bench|pto|paid time off|holiday|training|corporate)\b/i;

/** Normalise OCR/copy artifacts: odd dashes/spaces, checkbox glyphs and bullets at the start. */
export function cleanLine(s: string): string {
  return s
    .replace(/[  -​  　]/g, " ")
    .replace(/[‐-―−]/g, (c) => (c === "−" ? "-" : c)) // keep dash identity; only minus sign → hyphen
    .replace(/^[\s>»›•·*+▸▾▼►▶◦○●□■☐☑✓✔✗✘|\\/[\](){}~_=:;,.'"`^-]+(?=[A-Za-z0-9])/u, "")
    // expand/collapse carets are often read as a lone "v", "V", "+" or ">" before the name
    .replace(/^(?:v|V|y|>|\+|»|›|<|\^)\s+(?=[A-Z(])/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoise(s: string): boolean {
  const t = s.toLowerCase().replace(/[^a-z/ -]/g, "").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
  if (!/[a-z]{2,}/i.test(s)) return true; // no real words
  if (UI_NOISE.has(t)) return true;
  if (/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+\d/i.test(s)) return true; // dates
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(s) && s.length < 14) return true;
  if (/^page \d+( of \d+)?$/i.test(s)) return true;
  return false;
}

const TASK_LINE = /^(\d{1,3})(?:\s*[.):\-]\s*|\s+|(?=[A-Z]))([A-Za-z][^\n]{0,118})$/;

/** Recognise "2 Planning", "11 Internal - Training", "3. Gears". Returns null for non-task text. */
export function parseTaskLine(s: string): ParsedTask | null {
  const m = TASK_LINE.exec(s);
  if (!m) return null;
  let name = m[2].replace(STATUS_BADGE, "").replace(/\s+\d+(\.\d+)?\s*(h|hrs|hours)?$/i, "").trim();
  name = name.replace(/[|]+$/, "").trim();
  if (!/[A-Za-z]{2,}/.test(name)) return null;
  const task: ParsedTask = { name, number: m[1], raw: s };
  if (/[^\x20-\x7EÀ-ſ]/.test(name)) task.uncertain = "Contains unusual characters — check the spelling.";
  return task;
}

/** Strip Projector's leading task number ("2 Planning" → "Planning"). Only removes a recognised numeric prefix. */
export function normalizeTaskName(name: string, keepNumbers = false): string {
  const t = name.replace(/\s+/g, " ").trim();
  if (keepNumbers) return t;
  const m = /^(\d{1,3})(?:\s*[.):\-]\s*|\s+)(?=[A-Za-z])(.+)$/.exec(t);
  return m ? m[2].trim() : t;
}

/* ------------------------------ client names ------------------------------ */

const ENGAGEMENT_WORDS = [
  "adaptive planning", "adaptive insights", "workday", "anaplan", "planful", "onestream", "netsuite", "sage", "oracle", "sap",
  "implementation", "msp", "managed services", "managed service", "support", "optimization", "optimisation", "phase", "expansion",
  "integration", "integrations", "consulting", "retainer", "health check", "upgrade", "training", "internal", "staff augmentation",
  "advisory", "assessment", "migration", "enhancement", "enhancements", "renewal", "subscription", "time and materials", "t&m", "fixed fee",
  "sow", "project", "services",
];

export interface ClientGuess {
  client: string;
  uncertain?: string;
}

/**
 * Pull the client out of a Projector project name. Projector names usually read
 * "Client - Product - Engagement". Split only on spaced separators (" - "), never on hyphens inside
 * words, and use known product/engagement words to find where the client part ends.
 */
export function extractClient(fullName: string): ClientGuess {
  const name = fullName.trim();
  const segs = name.split(/\s+[-–—|:]\s+/).map((s) => s.trim()).filter(Boolean);
  if (segs.length <= 1) return { client: name, uncertain: name ? "No “Client - Project” separator found; check the client name." : "Project name is empty." };
  const idx = segs.findIndex((s, i) => i > 0 && ENGAGEMENT_WORDS.some((w) => s.toLowerCase().startsWith(w)));
  if (idx > 0) return { client: segs.slice(0, idx).join(" - ") };
  if (segs.length === 2) return { client: segs[0] };
  if (segs.length === 3) return { client: segs[0], uncertain: "Guessed the client from the first part of the name; check it." };
  return { client: segs.slice(0, segs.length - 2).join(" - "), uncertain: "Long project name; the client was guessed — check it." };
}

/* ------------------------------ parsing ------------------------------ */

function codeFields(c: CodeMatch | undefined): Pick<ParsedProject, "code" | "codeStatus" | "codeSuggestion" | "codeIssue"> {
  if (!c) return { code: "", codeStatus: "missing", codeIssue: "No project code found on this row." };
  if (c.status === "valid") return { code: c.raw, codeStatus: "valid" };
  return { code: c.raw, codeStatus: "ambiguous", codeSuggestion: c.suggestion, codeIssue: c.reason };
}

let keySeq = 0;
const newKey = () => `p${Date.now().toString(36)}${(keySeq++).toString(36)}`;

function buildProject(nameText: string, code: CodeMatch | undefined, page: string, raw: string): ParsedProject {
  let fullName = nameText
    .replace(STATUS_BADGE, "")
    .replace(/\s*[-–—:|(\[]+\s*$/, "")
    .replace(/^\s*[-–—:|)\]]+\s*/, "")
    .trim();
  fullName = fullName.replace(/\s*\(\s*\)$/, "").trim();
  const cg = extractClient(fullName);
  const p: ParsedProject = {
    key: newKey(),
    ...codeFields(code),
    fullName,
    client: cg.client,
    clientUncertain: cg.uncertain,
    internal: INTERNAL_HINT.test(fullName),
    tasks: [],
    pages: [page],
    raw,
    issues: [],
  };
  return p;
}

/** Projects whose name has no code (e.g. a line ending "… Implementation" with the code cropped). */
function looksLikeProjectName(s: string): boolean {
  return /\s[-–—]\s/.test(s) && /[A-Za-z]{3,}/.test(s) && !TASK_LINE.test(s) && s.length >= 12;
}

/** Split pasted lines that contain several cells (tabs) or several numbered tasks on one line. */
function explode(lines: SourceLine[]): SourceLine[] {
  const out: SourceLine[] = [];
  for (const l of lines) {
    for (const cell of l.text.split(/\t+/)) {
      const t = cleanLine(cell);
      if (!t) continue;
      if (findCodes(t).length === 0 && /^\d{1,3}\s+[A-Z]/.test(t) && (t.match(/(?:^|\s)\d{1,3}\s+[A-Z]/g) ?? []).length > 1) {
        for (const part of t.split(/\s(?=\d{1,3}\s+[A-Z])/)) out.push({ ...l, text: part.trim() });
      } else out.push({ ...l, text: t });
    }
  }
  return out;
}

export function parseProjectorPages(pages: SourcePage[], opts: { keepTaskNumbers?: boolean } = {}): ParseResult {
  const keep = Boolean(opts.keepTaskNumbers);
  const projects: ParsedProject[] = [];
  const orphanTasks: OrphanTask[] = [];
  const looseLines: LooseLine[] = [];
  const rawText = pages.map((p) => ({ page: p.label, text: p.lines.map((l) => l.text).join("\n") }));
  let lastProjectOfPrevPage: ParsedProject | undefined;

  for (const page of pages) {
    const lines = explode(page.lines);
    let current: ParsedProject | undefined;
    let pendingName: SourceLine | undefined; // a name line whose code may be on the next line
    let projectX: number | undefined;
    const hasGeometry = lines.some((l) => l.x0 !== undefined);
    const indentTol = Math.max(6, (page.width ?? 1000) * 0.006);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = line.text;
      const codes = findCodes(text);
      if (codes.length > 0) {
        // A row may contain more than one code (rare, e.g. two columns). Treat each as its own project.
        let prevEnd = 0;
        codes.forEach((c, ci) => {
          let name = codes.length === 1 ? (text.slice(0, c.index) + " " + text.slice(c.index + c.raw.length)).trim() : text.slice(prevEnd, c.index).trim();
          prevEnd = c.index + c.raw.length;
          if ((!name || name.length < 3 || /^[-–—]/.test(name)) && pendingName && ci === 0) {
            name = `${pendingName.text} ${name}`.trim();
          } else if (pendingName && ci === 0 && /[-–—:]$/.test(pendingName.text)) {
            name = `${pendingName.text} ${name}`.trim();
          } else if (pendingName && ci === 0) {
            looseLines.push({ text: pendingName.text, page: page.label, projectKey: current?.key });
          }
          const p = buildProject(name, c, page.label, text);
          if ((line.confidence ?? 100) < 60) p.issues.push(`Low OCR confidence (${Math.round(line.confidence ?? 0)}%) on this row.`);
          projects.push(p);
          current = p;
          projectX = line.x0;
        });
        pendingName = undefined;
        continue;
      }
      const task = parseTaskLine(text);
      if (task) {
        if (pendingName) {
          // A project-looking name followed directly by tasks: project without a readable code.
          const p = buildProject(pendingName.text, undefined, page.label, pendingName.text);
          projects.push(p);
          current = p;
          projectX = pendingName.x0;
          pendingName = undefined;
        }
        const finalTask: ParsedTask = { ...task, name: keep ? `${task.number} ${task.name}` : task.name };
        if ((line.confidence ?? 100) < 60) finalTask.uncertain = `Low OCR confidence (${Math.round(line.confidence ?? 0)}%) — check the spelling.`;
        if (!current) {
          orphanTasks.push({
            task: finalTask,
            page: page.label,
            likelyProjectKey: lastProjectOfPrevPage?.key,
            reason: lastProjectOfPrevPage
              ? `Appears at the top of ${page.label} before any project — probably continues “${lastProjectOfPrevPage.client}” from the previous screenshot.`
              : `Appears before any project in ${page.label}; its project is not visible.`,
          });
          continue;
        }
        if (hasGeometry && projectX !== undefined && line.x0 !== undefined && line.x0 + indentTol < projectX) {
          // Less indented than its supposed parent: hierarchy is unclear.
          finalTask.uncertain = `Not indented under ${current.client}; confirm it belongs to this project.`;
        }
        if (!current.tasks.some((t) => t.name.toLowerCase() === finalTask.name.toLowerCase())) current.tasks.push(finalTask);
        continue;
      }
      if (isNoise(text)) continue;
      if (looksLikeProjectName(text)) {
        if (pendingName) looseLines.push({ text: pendingName.text, page: page.label, projectKey: current?.key });
        pendingName = line;
        continue;
      }
      looseLines.push({ text, page: page.label, projectKey: current?.key });
    }
    if (pendingName) {
      // Name at the very bottom of a screenshot with no code/tasks visible.
      looseLines.push({ text: pendingName.text, page: page.label, projectKey: current?.key });
    }
    if (current) lastProjectOfPrevPage = current;
  }

  for (const p of projects) {
    if (p.codeStatus === "missing") p.issues.push("Project code missing — type it from Projector.");
    if (p.codeStatus === "ambiguous") p.issues.push(p.codeIssue ?? "Project code needs checking.");
    if (p.tasks.length === 0) p.issues.push("No tasks found — expand the project in Projector or add tasks.");
    if (p.clientUncertain) p.issues.push(p.clientUncertain);
    if (p.tasks.some((t) => t.uncertain)) p.issues.push("Some tasks need checking.");
  }
  return { projects: mergeParsedProjects(projects), orphanTasks, looseLines, rawText };
}

/** Parse pasted text (one page). */
export function parseProjectorText(text: string, opts: { keepTaskNumbers?: boolean } = {}): ParseResult {
  return parseProjectorPages([{ label: "pasted text", lines: text.split(/\r?\n/).map((t) => ({ text: t })) }], opts);
}

/** Merge projects that share a valid code (e.g. the same project seen in two screenshots); union their tasks. */
export function mergeParsedProjects(list: ParsedProject[]): ParsedProject[] {
  const out: ParsedProject[] = [];
  for (const p of list) {
    const same = p.codeStatus === "valid" ? out.find((q) => q.codeStatus === "valid" && q.code === p.code) : undefined;
    if (!same) {
      out.push({ ...p, tasks: [...p.tasks], pages: [...p.pages], issues: [...p.issues] });
      continue;
    }
    for (const t of p.tasks) if (!same.tasks.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) same.tasks.push(t);
    for (const pg of p.pages) if (!same.pages.includes(pg)) same.pages.push(pg);
    if (p.fullName.length > same.fullName.length && p.fullName.startsWith(same.fullName.slice(0, 8))) {
      same.fullName = p.fullName;
      const cg = extractClient(p.fullName);
      same.client = cg.client;
    } else if (p.fullName && same.fullName && p.fullName.toLowerCase() !== same.fullName.toLowerCase() && !same.issues.some((i) => i.startsWith("Seen with different names"))) {
      same.issues.push(`Seen with different names: “${same.fullName}” and “${p.fullName}”.`);
    }
    same.issues = same.issues.filter((i) => !i.startsWith("No tasks found") || same.tasks.length === 0);
  }
  // Flag ambiguous codes that probably duplicate a valid one.
  for (const p of out) {
    if (p.codeStatus === "ambiguous" && p.codeSuggestion) {
      const twin = out.find((q) => q !== p && q.codeStatus === "valid" && q.code === p.codeSuggestion);
      if (twin) p.issues.push(`Probably the same project as ${twin.client} (${twin.code}) — remove it if so.`);
    }
  }
  return out;
}

export function projectStatus(p: ParsedProject): "verified" | "review" {
  return p.codeStatus === "valid" && isValidCode(p.code) && p.tasks.length > 0 && !p.clientUncertain && !p.tasks.some((t) => t.uncertain) && p.issues.length === 0 ? "verified" : "review";
}

export function taskCount(projects: ParsedProject[]): number {
  return projects.reduce((a, p) => a + p.tasks.length, 0);
}
