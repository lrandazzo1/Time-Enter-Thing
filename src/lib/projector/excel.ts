/**
 * Native Projector (BigTime Enterprise PSA) Excel report import.
 *
 * Reads the original .xlsx / .xlsm report in the browser (or Node, for tests) — workbook data only;
 * macros, formulas and external links are never executed. Expected report layout (any column order,
 * extra columns ignored, title rows above the header allowed):
 *
 *   Report sheet:  Project | Role | Work Location | Task Name
 *                  Globex - Adaptive Planning - MSP (P005678-001) | Consultant | Main Office | Planning Consultant
 *   Options sheet: report date range and filters (shown to the user)
 *
 * One row per time card, so the same project/task repeats; rows are de-duplicated by project code
 * with every distinct task collected. Role is kept only as reference metadata.
 */
import { extractClient, INTERNAL_HINT, type ParsedProject } from "./parse";
import { isValidCode } from "./codes";

export type Cell = string | number | boolean | Date | null | undefined;
export interface WorkbookSheet {
  sheet: string;
  data: Cell[][];
}

export interface ReportColumns {
  project: number;
  task: number;
  location?: number;
  role?: number;
  code?: number;
  employee?: number;
}

export interface ReportOption {
  label: string;
  value: string;
}

export interface ProjectorReport {
  sheetName: string;
  headerRow: number; // 1-based row number in the sheet
  columns: Record<keyof ReportColumns, string | undefined>;
  projects: ParsedProject[];
  /** Distinct work locations with how many rows used each, most frequent first. */
  locations: { name: string; count: number }[];
  /** Distinct employee names, when the report has an employee/staff column. */
  employees: string[];
  options: ReportOption[];
  dateRange?: string;
  rowCount: number;
  skippedRows: { row: number; reason: string; text: string }[];
  warnings: string[];
}

const text = (c: Cell): string => {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return isNaN(c.getTime()) ? "" : c.toISOString().slice(0, 10);
  return String(c).replace(/[  -​ 　]/g, " ").replace(/\s+/g, " ").trim();
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

const HEADER_MATCH: Record<keyof ReportColumns, (h: string) => boolean> = {
  project: (h) => ["project", "projectname", "projectnameandcode", "projectcodename", "projecttitle"].includes(h),
  task: (h) => ["taskname", "task", "tasktitle", "budgettask"].includes(h),
  location: (h) => ["worklocation", "location", "timelocation"].includes(h),
  role: (h) => ["role", "rolename", "staffrole", "projectrole"].includes(h),
  code: (h) => ["projectcode", "projectid", "projectnumber", "code"].includes(h),
  employee: (h) => ["staff", "staffmember", "staffname", "employee", "employeename", "resource", "resourcename", "user", "username", "person", "timekeeper"].includes(h),
};

/** Find the header row: the first row (within the top 40) that has both a Project and a Task column. */
export function findHeader(data: Cell[][]): { row: number; cols: ReportColumns; names: Record<keyof ReportColumns, string | undefined> } | null {
  for (let r = 0; r < Math.min(40, data.length); r++) {
    const cells = (data[r] ?? []).map((c) => norm(text(c)));
    const find = (k: keyof ReportColumns) => {
      const i = cells.findIndex((h) => h && HEADER_MATCH[k](h));
      return i >= 0 ? i : undefined;
    };
    const project = find("project");
    const task = find("task");
    if (project === undefined || task === undefined) continue;
    const cols: ReportColumns = { project, task, location: find("location"), role: find("role"), code: find("code"), employee: find("employee") };
    const names = Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, i === undefined ? undefined : text(data[r][i as number])])) as Record<keyof ReportColumns, string | undefined>;
    return { row: r, cols, names };
  }
  return null;
}

/** Pick the report sheet: one named "Report" with the expected columns, else any sheet that has them. */
export function selectReportSheet(sheets: WorkbookSheet[]): WorkbookSheet | null {
  const withHeader = sheets.filter((s) => findHeader(s.data));
  return withHeader.find((s) => s.sheet.trim().toLowerCase() === "report") ?? withHeader[0] ?? null;
}

/**
 * "Globex - Adaptive Planning - MSP (P005678-001)" → name + code from the *final* parenthesised
 * identifier. Earlier parentheses (e.g. "(NYPL)") stay part of the name.
 */
export function splitProjectCell(value: string): { fullName: string; code: string } {
  const v = value.trim();
  const m = /^(.*?)\s*\(\s*([A-Za-z0-9][A-Za-z0-9._/-]{2,})\s*\)\s*$/.exec(v);
  if (m && /\d/.test(m[2])) return { fullName: m[1].trim().replace(/\s*[-–—:]\s*$/, ""), code: m[2] };
  return { fullName: v, code: "" };
}

const TOTAL_ROW = /^(grand\s+)?(sub)?totals?\b|^report total/i;

function parseOptions(sheets: WorkbookSheet[], reportName: string): ReportOption[] {
  const opt = sheets.find((s) => s.sheet.trim().toLowerCase() === "options") ?? sheets.find((s) => s.sheet !== reportName && /option|filter|parameter|criteria/i.test(s.sheet));
  if (!opt) return [];
  const out: ReportOption[] = [];
  for (const row of opt.data.slice(0, 80)) {
    const cells = (row ?? []).map(text).filter(Boolean);
    if (!cells.length) continue;
    let label: string;
    let value: string;
    if (cells.length === 1) {
      // Projector writes one statement per row, e.g. "Resource Search String: leo".
      const i = cells[0].indexOf(":");
      label = i > 0 && i < 60 ? cells[0].slice(0, i) : cells[0];
      value = i > 0 && i < 60 ? cells[0].slice(i + 1).trim() : "";
    } else {
      [label, value] = [cells[0].replace(/:\s*$/, ""), cells.slice(1).join(" · ")];
    }
    out.push({ label: label.slice(0, 160), value: value.slice(0, 300) });
    if (out.length >= 40) break;
  }
  return out;
}

function dateRangeFrom(options: ReportOption[]): string | undefined {
  for (const o of options) {
    const m = /data from (.+?) (?:through|to|until) (.+?)\.?$/i.exec(`${o.label}${o.value ? ": " + o.value : ""}`);
    if (m) return `${m[1]} – ${m[2]}`;
  }
  const pick = options.find((o) => /date|period|range|from|through|between|week/i.test(o.label) && o.value) ?? options.find((o) => /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/.test(`${o.label} ${o.value}`));
  return pick ? (pick.value ? `${pick.label}: ${pick.value}` : pick.label) : undefined;
}

/** Report filters worth showing the user (resource/project filters, which time cards were included). */
export function reportFilters(options: ReportOption[]): ReportOption[] {
  return options.filter((o) => /search string|include|resource|staff|employee|engagements|project status|billable/i.test(o.label));
}

let seq = 0;
const key = () => `x${Date.now().toString(36)}${(seq++).toString(36)}`;

export function parseProjectorReport(sheets: WorkbookSheet[], opts: { employee?: string } = {}): ProjectorReport {
  const sheet = selectReportSheet(sheets);
  if (!sheet) {
    const names = sheets.map((s) => `“${s.sheet}”`).join(", ") || "none";
    throw new Error(`This workbook doesn't look like a Projector report: no sheet has “Project” and “Task Name” columns (sheets: ${names}).`);
  }
  const header = findHeader(sheet.data)!;
  const { cols } = header;
  const warnings: string[] = [];
  const skipped: ProjectorReport["skippedRows"] = [];
  const byCode = new Map<string, ParsedProject>();
  const noCode = new Map<string, ParsedProject>();
  const locationCounts = new Map<string, number>();
  const employees = new Set<string>();
  const projectLocCounts = new Map<string, Map<string, number>>();
  let lastProjectCell = "";
  let rows = 0;

  for (let r = header.row + 1; r < sheet.data.length; r++) {
    const row = sheet.data[r] ?? [];
    const projectCellRaw = text(row[cols.project]);
    const task = text(row[cols.task]);
    const location = cols.location !== undefined ? text(row[cols.location]) : "";
    const role = cols.role !== undefined ? text(row[cols.role]) : "";
    const employee = cols.employee !== undefined ? text(row[cols.employee]) : "";
    const joined = row.map(text).filter(Boolean).join(" | ");
    if (!joined) continue;
    if (TOTAL_ROW.test(projectCellRaw) || TOTAL_ROW.test(text(row[0]))) {
      skipped.push({ row: r + 1, reason: "Total row", text: joined.slice(0, 120) });
      continue;
    }
    if (employee) employees.add(employee);
    if (opts.employee && employee && employee !== opts.employee) continue;
    // Grouped reports show the project only on its first row; later rows inherit it.
    const projectCell = projectCellRaw || lastProjectCell;
    if (!projectCell) {
      skipped.push({ row: r + 1, reason: "No project on this row", text: joined.slice(0, 120) });
      continue;
    }
    lastProjectCell = projectCell;
    rows++;
    let { fullName, code } = splitProjectCell(projectCell);
    if (!code && cols.code !== undefined) code = text(row[cols.code]);
    const mapKey = code ? code.toUpperCase() : fullName.toLowerCase();
    const store = code ? byCode : noCode;
    let p = store.get(mapKey);
    if (!p) {
      const cg = extractClient(fullName);
      p = {
        key: key(),
        code,
        codeStatus: code ? "valid" : "missing",
        codeIssue: code ? (isValidCode(code) ? undefined : `Unusual code format “${code}” — taken exactly as it appears in the report.`) : "The Project cell has no code in parentheses — type the code from Projector.",
        fullName,
        client: cg.client,
        clientUncertain: cg.uncertain ? `${cg.uncertain} Full name: “${fullName}”.` : undefined,
        internal: INTERNAL_HINT.test(fullName),
        tasks: [],
        pages: [`${sheet.sheet} row ${r + 1}`],
        raw: projectCell,
        issues: [],
        roles: [],
        locations: [],
        rowCount: 0,
      };
      store.set(mapKey, p);
    }
    p.rowCount = (p.rowCount ?? 0) + 1;
    if (task) {
      if (!p.tasks.some((t) => t.name === task)) p.tasks.push({ name: task, raw: task });
    } else {
      skipped.push({ row: r + 1, reason: "No task name", text: joined.slice(0, 120) });
    }
    if (role && !p.roles!.includes(role)) p.roles!.push(role);
    if (location) {
      locationCounts.set(location, (locationCounts.get(location) ?? 0) + 1);
      const pl = projectLocCounts.get(p.key) ?? new Map<string, number>();
      pl.set(location, (pl.get(location) ?? 0) + 1);
      projectLocCounts.set(p.key, pl);
    }
  }

  const projects = [...byCode.values(), ...noCode.values()];
  for (const p of projects) {
    const pl = projectLocCounts.get(p.key);
    p.locations = pl ? [...pl.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n) : [];
    p.location = p.locations[0];
    if (p.codeStatus === "missing") p.issues.push(p.codeIssue!);
    else if (p.codeIssue) p.issues.push(p.codeIssue);
    if (!p.tasks.length) p.issues.push("No task names in the report for this project — add the task.");
    if (p.clientUncertain) p.issues.push(p.clientUncertain);
    if (p.tasks.some((t) => /^\d{1,3}\s+\S/.test(t.name))) p.issues.push("A task name starts with a number; it is kept exactly as in the report.");
  }
  // Code mapped to different names (renamed project) → keep first, warn.
  const options = parseOptions(sheets, sheet.sheet);
  if (cols.location === undefined) warnings.push("The report has no Work Location column; set your BigTime location manually.");
  if (employees.size > 1 && !opts.employee) warnings.push(`The report contains time for ${employees.size} people. Choose yourself so only your projects are imported.`);
  if (!rows) warnings.push("The report sheet has a header but no data rows.");
  return {
    sheetName: sheet.sheet,
    headerRow: header.row + 1,
    columns: header.names,
    projects,
    locations: [...locationCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    employees: [...employees].sort(),
    options,
    dateRange: dateRangeFrom(options),
    rowCount: rows,
    skippedRows: skipped,
    warnings,
  };
}

/** Read an .xlsx/.xlsm workbook (ArrayBuffer or Blob). Data only — nothing in the file is executed. */
export async function readWorkbook(input: ArrayBuffer | Blob): Promise<WorkbookSheet[]> {
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  try {
    const sheets = await readXlsxFile(input as Blob, { trim: true });
    return sheets.map((s) => ({ sheet: s.sheet, data: s.data as unknown as Cell[][] }));
  } catch (e) {
    const msg = (e as Error).message || String(e);
    throw new Error(`Couldn't read this Excel file (${msg}). Upload the original .xlsx downloaded from Projector — older .xls files and password-protected workbooks aren't supported.`);
  }
}

export const isExcelFile = (f: File) => /\.(xlsx|xlsm)$/i.test(f.name) || /spreadsheetml|ms-excel\.sheet\.macroEnabled/i.test(f.type);
