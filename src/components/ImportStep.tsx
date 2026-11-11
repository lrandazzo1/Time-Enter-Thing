"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Dropzone, Notice } from "./ui";
import type { TimeEntry } from "@/lib/types";
import { eventToEntry } from "@/lib/matching";
import { formatDecimalHours, intervalMinutes, isValidHHMM, parseHoursInput, prettyDate, toUSDate } from "@/lib/time";
import { AgendaError, parseAgenda, textStats, type AgendaDiagnostics, type AgendaResult, type RejectedLine } from "@/lib/pdf/agenda";
import { extractPdfText, fileKey, ocrPdfPages, type OcrPdfProgress } from "@/lib/pdf/extract";
import { meetingsSoFar, missingPages, pageRanges, readPages, type OcrPagesState } from "@/lib/pdf/ocrRun";
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
  /** Text recognition didn't read every page: the timesheet is missing those pages' meetings. */
  incomplete?: IncompleteImport;
}

export interface IncompleteImport {
  totalPages: number;
  missingPages: number[];
  reason: "cancelled" | "failed";
  /** The user confirmed they added the missing pages' time themselves. */
  acknowledged?: boolean;
}

/** Pages read so far for the PDF being recognised — kept in memory (not storage) so a retry can continue. */
let ocrSession: { file: File; state: OcrPagesState } | null = null;
export const canRetryOcr = (fileName: string) => Boolean(ocrSession && ocrSession.file.name === fileName && missingPages(ocrSession.state).length);

interface Progress extends OcrPdfProgress {
  meetings: number;
  failed: number;
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
  /** Offer to retry the pages text recognition hasn't read yet. */
  retryOcr?: boolean;
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
  const [progress, setProgress] = useState<Progress | null>(null);
  const [replace, setReplace] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []); // stop recognition if the step is left

  function applyResult(r: AgendaResult, f: File, method: "text" | "ocr", opts: { incomplete?: IncompleteImport; retry?: boolean } = {}) {
    const newPeriod = r.period ?? period;
    if (r.period) setPeriod(r.period);
    let next: TimeEntry[];
    if (opts.retry) {
      // Retrying the remaining pages: keep manual entries and the user's version of meetings already
      // imported from this PDF; add the newly read meetings. Parsing ran over all pages in order, so a
      // meeting spanning a page break appears once.
      const old = new Map(entries.filter((e) => e.source === "pdf" && e.fingerprint).map((e) => [e.fingerprint!, e]));
      const fresh = r.events.map((ev) => {
        const e = eventToEntry(ev, projects, settings, rules);
        return (e.fingerprint && old.get(e.fingerprint)) || e;
      });
      next = [...entries.filter((e) => e.source !== "pdf"), ...fresh];
    } else {
      const base = replace ? [] : entries;
      const known = new Set(base.filter((e) => e.included && e.fingerprint).map((e) => e.fingerprint!));
      const fresh: TimeEntry[] = r.events.map((ev) => {
        const e = eventToEntry(ev, projects, settings, rules);
        if (e.fingerprint && e.included && known.has(e.fingerprint)) {
          return { ...e, included: false, excludeReason: "Already in this timesheet", notes: [...e.notes, { code: "duplicate", level: "info", message: "Same meeting as an entry already in this timesheet — excluded." }] };
        }
        return e;
      });
      next = [...base, ...fresh];
    }
    setEntries(next);
    const flagged = r.events.filter((e) => e.parseNotes?.some((n) => n.code === "pdf-check")).length;
    setLastImport({
      fileName: f.name,
      pages: opts.incomplete?.totalPages ?? r.pages,
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
      incomplete: opts.incomplete,
    });
    setReplace(true);
    onDone();
  }

  async function onFiles(files: File[]) {
    if (progress) return;
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

  /** Read every page with text recognition, one page at a time; `retry` continues with the missing pages. */
  async function runOcr(f: File, retry = false) {
    if (progress) return;
    setProblem(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ page: 0, total: 0, index: 0, count: 0, status: "Starting text recognition on this device…", progress: 0, meetings: 0, failed: 0 });
    const prev = retry && ocrSession && ocrSession.state.fileKey === fileKey(f) ? ocrSession.state : undefined;
    let state: OcrPagesState | undefined;
    try {
      const run = await ocrPdfPages(f, {
        state: prev,
        signal: ctrl.signal,
        onProgress: (p) => setProgress((old) => (old ? { ...old, ...p } : null)),
        onPageDone: (st) => setProgress((old) => (old ? { ...old, meetings: meetingsSoFar(st, settings.csvDateOrder), failed: Object.keys(st.failed).length } : null)),
      });
      state = run.state;
      ocrSession = { file: f, state };
      const read = readPages(state);
      const missing = missingPages(state);
      const incomplete: IncompleteImport | undefined = missing.length ? { totalPages: state.total, missingPages: missing, reason: run.cancelled ? "cancelled" : "failed" } : undefined;
      if (!read.length) {
        setProblem({ kind: "other", title: run.cancelled ? "Text recognition cancelled" : "No page could be read", message: run.cancelled ? "Nothing was imported." : "Text recognition couldn't read any page of this PDF.", ocrFile: f, retryOcr: !run.cancelled });
        return;
      }
      const r = parseAgenda(read, { dateOrder: settings.csvDateOrder, stats: textStats(read), ocr: true });
      applyResult(r, f, "ocr", { incomplete, retry: Boolean(prev) });
    } catch (e) {
      const p = toProblem(e, f, true);
      if (state && missingPages(state).length) {
        p.message = `Pages ${pageRanges(missingPages(state))} of ${state.total} weren't read yet, and no meetings were found on the pages that were. ${p.message}`;
        p.retryOcr = true;
        p.ocrFile = f;
      }
      setProblem(p);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }

  const inc = lastImport?.incomplete;
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
        {progress && (
          <div className="ocr-progress mt" role="status" aria-live="polite">
            <strong>{progress.total ? `Processing page ${progress.page} of ${progress.total}` : progress.status}</strong>
            <progress max={Math.max(1, progress.count)} value={Math.min(progress.count, progress.index + progress.progress)} aria-label="Text recognition progress" />
            <div className="small muted">
              {progress.total > 0 && progress.count < progress.total && <>Retrying {progress.count} page{progress.count === 1 ? "" : "s"} · </>}
              {progress.total > 0 && <>{progress.status === `Processing page ${progress.page} of ${progress.total}` ? "Rendering page…" : progress.status} · </>}
              <span className="ocr-meetings">{progress.meetings} meeting{progress.meetings === 1 ? "" : "s"} identified so far</span>
              {progress.failed > 0 && <> · <span className="text-warning">{progress.failed} page{progress.failed === 1 ? "" : "s"} couldn&apos;t be read (you can retry)</span></>}
            </div>
            <div className="row gap-sm mt">
              <Button size="sm" onClick={() => abortRef.current?.abort()}>Cancel</Button>
              <span className="small muted">Pages already read are kept; you can continue later.</span>
            </div>
          </div>
        )}
        {inc && !progress && (
          <div className="mt">
            <Notice tone="error" title={`Incomplete import: page${inc.missingPages.length === 1 ? "" : "s"} ${pageRanges(inc.missingPages)} of ${inc.totalPages} ${inc.missingPages.length === 1 ? "wasn't" : "weren't"} read`}>
              <p>{inc.reason === "cancelled" ? "Text recognition was cancelled" : "Some pages couldn't be read"}, so meetings on {inc.missingPages.length === 1 ? "that page are" : "those pages are"} missing from this timesheet. The CSV can't be downloaded until the remaining pages are read or you confirm you added that time yourself.</p>
              <div className="row gap-sm mt">
                {lastImport && canRetryOcr(lastImport.fileName) ? (
                  <Button size="sm" variant="primary" onClick={() => runOcr(ocrSession!.file, true)}>Retry remaining pages</Button>
                ) : (
                  <span className="small">To continue, upload the same PDF again and choose <em>Read with text recognition</em>.</span>
                )}
              </div>
            </Notice>
          </div>
        )}
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
                <p>The pages can be read as images right here in your browser (free, nothing is uploaded), one page at a time with no page limit. It is slower — a few seconds per page — and recognised text can contain mistakes, so <strong>every meeting will be flagged for you to check</strong> against your calendar before export.</p>
                <div className="row gap-sm mt">
                  {problem.retryOcr && canRetryOcr(problem.ocrFile.name) && <Button size="sm" variant="primary" disabled={Boolean(busy || progress)} onClick={() => runOcr(problem.ocrFile!, true)}>Retry remaining pages</Button>}
                  <Button size="sm" disabled={Boolean(busy || progress)} onClick={() => runOcr(problem.ocrFile!)}>{problem.retryOcr ? "Start again from page 1" : "Read with text recognition"}</Button>
                </div>
              </Notice>
            )}
            <ImportDiagnostics diagnostics={problem.diagnostics} category={problem.category} open={problem.kind === "unrecognized"} />
          </div>
        )}
        {lastImport && !busy && !progress && !problem && !inc && (
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
