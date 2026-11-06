import type { Issue, Period, ProjectMapping, TimeEntry } from "./types";
import { dailyTotals, findOverlaps, totals } from "./review";
import { formatDecimalHours, listDates, prettyDate, toUSDate } from "./time";

/** Human-readable timesheet review (Markdown) to keep alongside the import CSV. */
export function reviewSummaryMarkdown(entries: TimeEntry[], projects: ProjectMapping[], period: Period, issues: Issue[]): string {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const t = totals(entries, projects);
  const daily = dailyTotals(entries);
  const inc = entries.filter((e) => e.included).sort((a, b) => a.date.localeCompare(b.date) || (a.intervals[0]?.start ?? "").localeCompare(b.intervals[0]?.start ?? ""));
  const exc = entries.filter((e) => !e.included);
  const L: string[] = [];
  L.push(`# Timesheet review — ${toUSDate(period.start)} to ${toUSDate(period.end)}`, "");
  L.push(`Generated ${new Date().toLocaleString()} by Timesheet Converter. Hours are decimal (minutes ÷ 60, rounded to 0.01).`, "");
  L.push("## Totals", "");
  L.push(`- **Total:** ${formatDecimalHours(t.total)} h`, `- **Billable:** ${formatDecimalHours(t.billable)} h`, `- **Internal / non-billable:** ${formatDecimalHours(t.internal)} h`);
  if (t.unassigned) L.push(`- **Unassigned:** ${formatDecimalHours(t.unassigned)} h`);
  L.push("", "## Daily totals", "", "| Date | Hours |", "|---|---|");
  for (const d of listDates(period.start, period.end)) L.push(`| ${prettyDate(d)} | ${formatDecimalHours(daily[d] ?? 0)} |`);
  L.push("", "## Project totals", "", "| Project | Hours |", "|---|---|");
  for (const p of t.byProject) L.push(`| ${p.label}${p.billable === false ? " (internal)" : ""} | ${formatDecimalHours(p.minutes)} |`);
  L.push("", "## Entries", "", "| Date | Time | Client | Project | Task | Hours | Description |", "|---|---|---|---|---|---|---|");
  for (const e of inc) {
    const p = e.projectId ? byId.get(e.projectId) : undefined;
    L.push(`| ${toUSDate(e.date)} | ${e.intervals.map((i) => `${i.start}–${i.end}`).join(", ") || "—"} | ${md(p?.client ?? "—")} | ${p?.code ?? "—"} | ${md(e.task || "—")} | ${formatDecimalHours(e.minutes)} | ${md(e.description)} |`);
  }
  if (exc.length) {
    L.push("", "## Excluded calendar events", "");
    for (const e of exc) L.push(`- ${toUSDate(e.date)} ${e.intervals[0] ? e.intervals[0].start + " " : ""}${md(e.title)} — ${e.excludeReason ?? "excluded"}`);
  }
  const ov = findOverlaps(entries);
  if (ov.length) {
    L.push("", "## Overlapping calendar time", "");
    for (const c of ov) L.push(`- ${toUSDate(c.date)}: ${c.entryIds.length} entries, ${formatDecimalHours(c.claimedMinutes)} h claimed over ${formatDecimalHours(c.unionMinutes)} h of clock time${c.unresolved ? " — **unresolved**" : " — resolved"}`);
  }
  const rounding = inc.filter((e) => Math.abs(Number(formatDecimalHours(e.minutes)) * 60 - e.minutes) > 0.05);
  if (rounding.length) {
    const exact = inc.reduce((a, e) => a + e.minutes, 0);
    const rowSum = inc.reduce((a, e) => a + Number(formatDecimalHours(e.minutes)), 0);
    L.push("", "## Rounding", "", `${rounding.length} entr${rounding.length === 1 ? "y does" : "ies do"} not convert to exact hundredths (e.g. 110 min = 1.8333 → 1.83). Sum of rows: ${rowSum.toFixed(2)} h; exact total: ${formatDecimalHours(exact)} h.`);
  }
  const open = issues.filter((i) => i.level !== "info");
  if (open.length) {
    L.push("", "## Outstanding items", "");
    for (const i of open) L.push(`- ${i.level === "error" ? "**Error:** " : ""}${md(i.message)}`);
  }
  return L.join("\n") + "\n";
}

const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
