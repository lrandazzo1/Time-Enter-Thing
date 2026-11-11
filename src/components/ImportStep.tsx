"use client";
import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Dropzone, Notice } from "./ui";
import type { TimeEntry } from "@/lib/types";
import { eventToEntry } from "@/lib/matching";
import { formatDecimalHours, intervalMinutes, isValidHHMM, parseHoursInput, prettyDate, toUSDate } from "@/lib/time";
import { AgendaError, PARTIAL_MESSAGE, parseAgenda, type AgendaDiagnostics, type AgendaResult, type RejectedLine } from "@/lib/pdf/agenda";
import { extractPdfText, ocrPdf, OCR_MAX_PAGES } from "@/lib/pdf/extract";
import { ImportDiagnostics } from "./ImportDiagnostics";
import { uid } from "@/lib/uid";

export interface ImportSummary {
  fileName: string;
  pages: number;
  meetings: number;
  timed: number;
  canceled: number;
  allDay: number;
  duplicatesRemoved: { title: string; date: string; start: string | null }[];
  warnings: string[];
  period: { start: string; end: string } | null;
  importedAt: string;
  /** "ocr" when the PDF had no usable text and was read with on-device text recognition. */
  method?: "text" | "ocr";
  /** Lines that looked like meeting times but couldn't be interpreted (redacted). */
  rejected?: RejectedLine[];
  /** Meetings that were read but need checking (uncertain title, OCR, unusual length…). */
  flagged?: number;
  diagnostics?: AgendaDiagnostics;
}

interface Problem {
  kind: "no-text" | "undecodable" | "unrecognized" | "unreadable" | "other";
  title: string;
  message: string;
  category?: string;
  diagnostics?: AgendaDiagnostics;
  /** Offer on-device text recognition for this file. */
  ocrFile?: File;
  afterOcr?: boolean;
}

const TITLES: Record<Problem["kind"], string> = {
  "no-text": "No selectable text in this PDF",
  undecodable: "This PDF's text can't be decoded",
  unrecognized: "Meetings not recognised",
  unreadable: "Couldn't read this PDF",
  other: "Couldn't read this PDF",
};

function toProblem(e: unknown, file: File, afterOcr = false): Problem {
  if (e instanceof AgendaError) {
    const kind = e.code;
    return {
      kind,
      title: afterOcr ? "Text recognition couldn't find the meetings either" : TITLES[kind],
      message: afterOcr ? "The pages were read on this device, but no meeting dates and times could be identified. Add your time manually, or export the calendar again from Outlook with Print detailed agenda → Save as PDF." : e.message,
      category: e.category,
      diagnostics: e.diagnostics,
      ocrFile: !afterOcr && kind !== "unreadable" ? file : undefined,
      afterOcr,
    };
  }
  const err = e as Error;
  if (err?.name === "AbortError") return { kind: "other", title: "Cancelled", message: "Text recognition was cancelled." };
  return { kind: "other", title: TITLES.other, message: "Something went wrong while reading this PDF on this device.", category: `PARSER_${(err?.name || "ERROR").toUpperCase()}` };
}

/** Step 1 — the only calendar input: Outlook's "Detailed agenda" printed to PDF, read in this browser. */
export function ImportStep({ onDone }: { onDone: () => void }) {
  const { period, setPeriod, settings, projects, entries, setEntries, rules, lastImport, setLastImport } = useStore();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);

  function applyResult(r: AgendaResult, f: File, method: "text" | "ocr") {
    const newPeriod = r.period ?? period;
    if (r.period) setPeriod(r.period);
    const base = replace ? [] : entries;
    const known = new Set(base.filter((e) => e.included && e.fingerprint).map((e) => e.fingerprint!));
    const fresh: TimeEntry[] = r.events.map((ev) => {
      const e = eventToEntry(ev, projects, settings, rules);
      if (e.fingerprint && e.included && known.has(e.fingerprint)) {
        return { ...e, included: false, excludeReason: "Already in this timesheet", notes: [...e.notes, { code: "duplicate", level: "info", message: "Same meeting as an entry already in this timesheet — excluded." }] };
      }
      return e;
    });
    setEntries([...base, ...fresh]);
    const flagged = r.events.filter((e) => e.parseNotes?.some((n) => n.code === "pdf-check")).length;
    setLastImport({
      fileName: f.name,
      pages: r.pages,
      meetings: r.events.length,
      timed: r.events.filter((e) => !e.allDay).length,
      canceled: r.events.filter((e) => e.canceled).length,
      allDay: r.events.filter((e) => e.allDay).length,
      duplicatesRemoved: r.duplicatesRemoved,
      warnings: [...r.warnings.filter((w) => !/couldn't be interpreted/.test(w)), ...(newPeriod && r.events.some((e) => e.date < newPeriod.start || e.date > newPeriod.end) ? ["Some meetings fall outside the printed date range."] : [])],
      period: r.period,
      importedAt: new Date().toISOString(),
      method,
      rejected: r.rejected,
      flagged,
      diagnostics: r.diagnostics,
    });
    setReplace(true);
    onDone();
  }

  async function onFiles(files: File[]) {
    setProblem(null);
    const f = files[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setProblem({ kind: "other", title: "Not a PDF", message: "Please upload the PDF from Outlook (Print → Print detailed agenda → Save as PDF). Other calendar files and images aren't supported." });
      return;
    }
    if (f.size > 40 * 1024 * 1024) {
      setProblem({ kind: "unreadable", title: TITLES.unreadable, message: "That PDF is larger than 40 MB. Print a shorter date range (one week is ideal).", category: "PDF_TOO_LARGE" });
      return;
    }
    setBusy("Reading PDF on this device…");
    try {
      const x = await extractPdfText(f, (p, n) => setBusy(`Reading page ${p} of ${n}…`));
      applyResult(parseAgenda(x.pages, { dateOrder: settings.csvDateOrder, stats: x.stats }), f, "text");
    } catch (e) {
      setProblem(toProblem(e, f));
    } finally {
      setBusy(null);
    }
  }

  async function runOcr(f: File) {
    setProblem(null);
    setBusy("Starting text recognition on this device…");
    try {
      const x = await ocrPdf(f, (p) => setBusy(p.status));
      const r = parseAgenda(x.pages, { dateOrder: settings.csvDateOrder, stats: x.stats, ocr: true });
      if (x.truncated) r.warnings.push(`Only the first ${OCR_MAX_PAGES} pages were read with text recognition.`);
      applyResult(r, f, "ocr");
    } catch (e) {
      setProblem(toProblem(e, f, true));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {projects.length === 0 && (
        <Notice tone="info" title="No projects saved yet">
          You can import your calendar now and add projects while matching, or first upload your Projector Excel report on the <strong>Projects</strong> page.
        </Notice>
      )}
      <Card className="upload-card">
        <h2 className="upload-title">Upload Your Outlook Calendar PDF</h2>
        <p className="muted">Export your calendar from Outlook using <strong>Print → Detailed agenda → Save as PDF</strong>.</p>
        <Dropzone accept=".pdf,application/pdf" onFiles={onFiles} label={busy ?? <><strong>Drop your calendar PDF here</strong> or click to choose</>} hint="Read in this browser only — the PDF is never uploaded. One week per PDF works best." icon="📄" />
        {entries.length > 0 && (
          <label className="check mt">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span>Replace the {entries.length} entries currently in this timesheet (untick to add to them)</span>
          </label>
        )}
        {problem && (
          <div className="mt stack-sm" role="alert">
            <Notice tone="error" title={problem.title}>
              <p>{problem.message}</p>
              {problem.category && <p className="small mt">Error category: <code>{problem.category}</code></p>}
            </Notice>
            {problem.ocrFile && (
              <Notice tone="info" title="Optional: read the pages with on-device text recognition">
                <p>The pages can be read as images right here in your browser (free, nothing is uploaded). It is slower — several seconds per page — and recognised text can contain mistakes, so <strong>every meeting will be flagged for you to check</strong> against your calendar before export.</p>
                <div className="row gap-sm mt">
                  <Button size="sm" disabled={Boolean(busy)} onClick={() => runOcr(problem.ocrFile!)}>Read with text recognition</Button>
                </div>
              </Notice>
            )}
            <ImportDiagnostics diagnostics={problem.diagnostics} category={problem.category} open={problem.kind === "unrecognized"} />
          </div>
        )}
        {lastImport && !busy && !problem && (
          <p className="small muted mt">Last import: {lastImport.fileName} · {lastImport.meetings} meetings · {lastImport.period ? `${toUSDate(lastImport.period.start)} – ${toUSDate(lastImport.period.end)}` : ""} · <button className="link" onClick={onDone}>review →</button></p>
        )}
        <details className="help">
          <summary>How do I make this PDF?</summary>
          <ol className="tight small">
            <li>In Outlook, open <strong>Calendar</strong> and go to the week you want.</li>
            <li>Choose <strong>Print</strong> (File → Print, or Home → Print in new Outlook).</li>
            <li>Set the date range (e.g. Monday–Sunday) and tick <strong>Print detailed agenda</strong> (or choose the <em>Detailed agenda</em> style).</li>
            <li>Printer: <strong>Save as PDF</strong> (most reliable) or <strong>Microsoft Print to PDF</strong>. Save the file, then drop it here.</li>
          </ol>
          <p className="small">Don&apos;t use the normal day/week/month calendar print — it cuts off titles and doesn&apos;t list exact times.</p>
        </details>
      </Card>
      <Card title="Timesheet period" subtitle="Set automatically from the PDF's printed date range. Change it only if you need to.">
        <div className="row wrap gap">
          <label className="field">
            <span>From</span>
            <input type="date" value={period.start} onChange={(e) => e.target.value && setPeriod({ start: e.target.value, end: period.end < e.target.value ? e.target.value : period.end })} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={period.end} min={period.start} onChange={(e) => e.target.value && setPeriod({ ...period, end: e.target.value })} />
          </label>
        </div>
        <p className="small muted mt">No meetings this week? Skip ahead to <button className="link" onClick={onDone}>Review</button> and add your work manually.</p>
      </Card>
    </div>
  );
}

export function ManualEntry({ compact = false, onAdded }: { compact?: boolean; onAdded?: () => void }) {
  const { projects, settings, setEntries, period } = useStore();
  const [date, setDate] = useState(period.start);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [hours, setHours] = useState("");
  const [projectId, setProjectId] = useState("");
  const [task, setTask] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const project = projects.find((p) => p.id === projectId);

  useEffect(() => {
    if (project && !project.tasks.includes(task)) setTask(project.tasks.length === 1 ? project.tasks[0] : project.defaultTask || "");
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const timed = isValidHHMM(start) && isValidHHMM(end) && intervalMinutes(start, end) > 0;
  const minutes = hours.trim() ? parseHoursInput(hours) : timed ? intervalMinutes(start, end) : null;

  function add() {
    if (!date) return setMsg("Choose a date.");
    if (!minutes || minutes <= 0) return setMsg("Enter hours (e.g. 1.50) or a start and end time.");
    setEntries((prev) => [
      ...prev,
      {
        id: uid(),
        source: "manual",
        title: description || "Manual entry",
        date,
        intervals: timed ? [{ start, end }] : [],
        minutes,
        projectId: projectId || null,
        task,
        description,
        location: project?.location || settings.defaultLocation,
        included: true,
        status: "busy",
        notes: [],
      },
    ]);
    setMsg(`Added ${formatDecimalHours(minutes)} h on ${prettyDate(date)}.`);
    setDescription("");
    setHours("");
    setStart("");
    setEnd("");
    onAdded?.();
  }

  const body = (
    <div className="manual-grid">
      <label className="field">
        <span>Work date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        <span>Start (optional)</span>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="field">
        <span>End (optional)</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <label className="field">
        <span>Hours</span>
        <input inputMode="decimal" placeholder={timed ? formatDecimalHours(intervalMinutes(start, end)) : "e.g. 1.50"} value={hours} onChange={(e) => setHours(e.target.value)} />
      </label>
      <label className="field span-2">
        <span>Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Choose…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.client} — {p.code}
            </option>
          ))}
        </select>
      </label>
      <label className="field span-2">
        <span>Task</span>
        <select value={task} onChange={(e) => setTask(e.target.value)} disabled={!project}>
          <option value="">Choose…</option>
          {project?.tasks.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="field span-4">
        <span>Description</span>
        <input value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} placeholder="What you worked on" />
      </label>
      <div className="span-4 row gap-sm align-center">
        <Button variant="primary" onClick={add}>Add entry</Button>
        {minutes !== null && minutes > 0 && <Badge tone="info">{formatDecimalHours(minutes)} h</Badge>}
        {hours.trim() && parseHoursInput(hours) === null && <span className="text-error small">Use decimals like 1.50 (or 1:30)</span>}
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </div>
  );
  if (compact) return body;
  return (
    <Card title="Add time manually" subtitle="For work that isn't on your calendar. Hours accept decimals (1.50) or clock notation (1:30 → 1.50).">
      {body}
    </Card>
  );
}
