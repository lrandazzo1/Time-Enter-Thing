"use client";
import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Dropzone, Notice } from "./ui";
import type { TimeEntry } from "@/lib/types";
import { eventToEntry } from "@/lib/matching";
import { formatDecimalHours, intervalMinutes, isValidHHMM, parseHoursInput, prettyDate, toUSDate } from "@/lib/time";
import { AgendaError, parseAgenda } from "@/lib/pdf/agenda";
import { extractPdfText } from "@/lib/pdf/extract";
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
}

/** Step 1 — the only calendar input: Outlook's "Detailed agenda" printed to PDF, read in this browser. */
export function ImportStep({ onDone }: { onDone: () => void }) {
  const { period, setPeriod, settings, projects, entries, setEntries, rules, lastImport, setLastImport } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);

  async function onFiles(files: File[]) {
    setError(null);
    const f = files[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setError("Please upload the PDF from Outlook (Print → Detailed agenda → Save as PDF). Other calendar files and images aren't supported.");
      return;
    }
    if (f.size > 40 * 1024 * 1024) {
      setError("That PDF is larger than 40 MB. Print a shorter date range (one week is ideal).");
      return;
    }
    setBusy("Reading PDF on this device…");
    try {
      const pages = await extractPdfText(f, (p, n) => setBusy(`Reading page ${p} of ${n}…`));
      const r = parseAgenda(pages, { dateOrder: settings.csvDateOrder });
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
      setLastImport({
        fileName: f.name,
        pages: r.pages,
        meetings: r.events.length,
        timed: r.events.filter((e) => !e.allDay).length,
        canceled: r.events.filter((e) => e.canceled).length,
        allDay: r.events.filter((e) => e.allDay).length,
        duplicatesRemoved: r.duplicatesRemoved,
        warnings: [...r.warnings, ...(newPeriod && r.events.some((e) => e.date < newPeriod.start || e.date > newPeriod.end) ? ["Some meetings fall outside the printed date range."] : [])],
        period: r.period,
        importedAt: new Date().toISOString(),
      });
      setReplace(true);
      onDone();
    } catch (e) {
      setError(e instanceof AgendaError ? e.message : `Couldn't read this PDF: ${(e as Error).message}`);
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
        {error && <div className="mt"><Notice tone="error" title="Couldn't use this PDF">{error}</Notice></div>}
        {lastImport && !busy && !error && (
          <p className="small muted mt">Last import: {lastImport.fileName} · {lastImport.meetings} meetings · {lastImport.period ? `${toUSDate(lastImport.period.start)} – ${toUSDate(lastImport.period.end)}` : ""} · <button className="link" onClick={onDone}>review →</button></p>
        )}
        <details className="help">
          <summary>How do I make this PDF?</summary>
          <ol className="tight small">
            <li>In Outlook, open <strong>Calendar</strong> and go to the week you want.</li>
            <li>Choose <strong>Print</strong> (File → Print, or Home → Print in new Outlook).</li>
            <li>Set the date range (e.g. Monday–Sunday) and choose the <strong>Detailed agenda</strong> style.</li>
            <li>Printer: <strong>Microsoft Print to PDF</strong> or <strong>Save as PDF</strong>. Save the file, then drop it here.</li>
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
