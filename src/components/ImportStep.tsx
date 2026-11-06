"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Dropzone, Notice, readText } from "./ui";
import type { CalendarEvent, TimeEntry } from "@/lib/types";
import { parseIcs } from "@/lib/parsers/ics";
import { parseCalendarCsv } from "@/lib/parsers/csv";
import { eventToEntry, fingerprintOf } from "@/lib/matching";
import { addDays, formatDecimalHours, intervalMinutes, isValidHHMM, mondayOf, parseHoursInput, prettyDate, todayIn } from "@/lib/time";
import { extractEventsFromScreenshot, fetchAiStatus, type AiStatus } from "@/lib/aiClient";
import { loadAccessCode, saveAccessCode } from "@/lib/storage";
import { uid } from "@/lib/uid";

type Mode = "file" | "screenshot" | "manual";

interface ImportSummary {
  added: number;
  excluded: number;
  review: number;
  duplicates: number;
  warnings: string[];
  sourceLabel: string;
}

export function ImportStep({ onDone }: { onDone: () => void }) {
  const { period, setPeriod, settings, projects, entries, setEntries } = useStore();
  const [mode, setMode] = useState<Mode>("file");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);

  const today = todayIn(settings.timeZone);
  const thisMonday = mondayOf(today);

  function addEvents(events: CalendarEvent[], warnings: string[], sourceLabel: string) {
    const base = replace ? [] : entries;
    const known = new Set(base.filter((e) => e.included && e.fingerprint).map((e) => e.fingerprint!));
    let duplicates = 0;
    const fresh: TimeEntry[] = events.map((ev) => {
      const entry = eventToEntry(ev, projects, settings);
      if (entry.fingerprint && entry.included && known.has(entry.fingerprint)) {
        duplicates++;
        return { ...entry, included: false, excludeReason: "Duplicate of an event already imported", notes: [...entry.notes, { code: "duplicate", level: "info", message: "Same title and time as an entry already in this timesheet — excluded." }] };
      }
      if (entry.fingerprint && entry.included) known.add(entry.fingerprint);
      return entry;
    });
    setEntries([...base, ...fresh]);
    const included = fresh.filter((e) => e.included);
    setSummary({
      added: fresh.length,
      excluded: fresh.length - included.length,
      review: included.filter((e) => !e.projectId || !e.task || e.notes.some((n) => n.level === "warning")).length,
      duplicates,
      warnings,
      sourceLabel,
    });
    setReplace(false);
  }

  async function onCalendarFiles(files: File[]) {
    setError(null);
    setSummary(null);
    const allEvents: CalendarEvent[] = [];
    const warnings: string[] = [];
    try {
      for (const file of files) {
        const text = await readText(file);
        const isIcs = /\.(ics|ical|ifb|icalendar)$/i.test(file.name) || /BEGIN:VCALENDAR/i.test(text.slice(0, 2000));
        if (isIcs) {
          const r = parseIcs(text, period, settings.timeZone, file.name);
          allEvents.push(...r.events);
          warnings.push(...r.warnings);
        } else if (/\.(csv|txt)$/i.test(file.name) || text.includes(",")) {
          const r = parseCalendarCsv(text, period, settings, file.name);
          allEvents.push(...r.events);
          warnings.push(...r.warnings);
        } else {
          throw new Error(`${file.name}: unsupported file. Use an Outlook .ics or .csv export.`);
        }
      }
      if (allEvents.length === 0) {
        setError(`No events found between ${prettyDate(period.start)} and ${prettyDate(period.end)}. Check the timesheet period above, or export a calendar range that covers it.`);
        return;
      }
      addEvents(allEvents, warnings, files.map((f) => f.name).join(", "));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <Card title="Timesheet period" subtitle={`Events outside this range are ignored. Times are shown in ${settings.timeZone} (change on the Projects & Tasks tab).`}>
        <div className="row wrap gap">
          <label className="field">
            <span>From</span>
            <input type="date" value={period.start} onChange={(e) => e.target.value && setPeriod({ start: e.target.value, end: period.end < e.target.value ? e.target.value : period.end })} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="date" value={period.end} min={period.start} onChange={(e) => e.target.value && setPeriod({ ...period, end: e.target.value })} />
          </label>
          <div className="row gap-sm align-end">
            <Button size="sm" onClick={() => setPeriod({ start: thisMonday, end: addDays(thisMonday, 6) })}>This week</Button>
            <Button size="sm" onClick={() => setPeriod({ start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) })}>Last week</Button>
          </div>
        </div>
      </Card>

      {projects.length === 0 && (
        <Notice tone="warning" title="Add your BigTime projects first">
          Matching needs your client names, project codes and tasks. Open the <strong>Projects &amp; Tasks</strong> tab to add them or import a CSV. You can still import now and assign projects during review.
        </Notice>
      )}

      <div className="segmented" role="tablist" aria-label="Import method">
        {(
          [
            ["file", "Calendar file", ".ics or .csv — no AI needed"],
            ["screenshot", "Screenshots", "AI recognition"],
            ["manual", "Add manually", "Type entries"],
          ] as const
        ).map(([id, label, sub]) => (
          <button key={id} role="tab" aria-selected={mode === id} className={`segment ${mode === id ? "is-active" : ""}`} onClick={() => setMode(id)}>
            <span className="segment-label">{label}</span>
            <span className="segment-sub">{sub}</span>
          </button>
        ))}
      </div>

      {entries.length > 0 && mode !== "manual" && (
        <label className="check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          <span>Replace the {entries.length} entries already in this timesheet (otherwise new events are added)</span>
        </label>
      )}

      {mode === "file" && (
        <Card title="Import an Outlook calendar file" subtitle="Your file is read in this browser only — it is not uploaded anywhere.">
          <Dropzone accept=".ics,.ical,.csv,text/calendar,text/csv" multiple onFiles={onCalendarFiles} label={<><strong>Drop .ics or .csv files here</strong> or click to choose</>} hint="Outlook: File → Save Calendar (.ics) or File → Open & Export → Import/Export → Export to a file → CSV. See the Setup Guide for Outlook on the web and Mac." icon="📅" />
          <details className="help">
            <summary>Tip: name your work blocks so they match automatically</summary>
            <p>
              Use <code>CLIENT | TASK | WORK DESCRIPTION</code>, e.g. <code>Acme Corp | Planning | Model development</code>. Blocks named this way are matched exactly; other meetings are matched by the client names and aliases you configure and flagged when unclear.
            </p>
          </details>
        </Card>
      )}

      {mode === "screenshot" && <ScreenshotImport onEvents={addEvents} onError={setError} />}
      {mode === "manual" && <ManualEntry />}

      {error && <Notice tone="error" title="Import problem">{error}</Notice>}
      {summary && (
        <Notice tone={summary.review > 0 ? "warning" : "success"} title={`Imported ${summary.added} event${summary.added === 1 ? "" : "s"} from ${summary.sourceLabel}`}>
          <p>
            {summary.added - summary.excluded} proposed as work time · {summary.excluded} excluded (canceled, all-day, free, personal{summary.duplicates ? `, ${summary.duplicates} duplicates` : ""}) · {summary.review} need your review.
          </p>
          {summary.warnings.length > 0 && (
            <ul className="tight">
              {summary.warnings.slice(0, 8).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="row gap-sm mt">
            <Button variant="primary" onClick={onDone}>Review entries →</Button>
          </div>
        </Notice>
      )}
    </div>
  );
}

function ScreenshotImport({ onEvents, onError }: { onEvents: (ev: CalendarEvent[], w: string[], label: string) => void; onError: (e: string | null) => void }) {
  const { period, settings, projects } = useStore();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  useEffect(() => {
    fetchAiStatus().then(setStatus);
    setCode(loadAccessCode());
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (imgs.length) setFiles((prev) => [...prev, ...imgs.map((f, i) => new File([f], f.name && f.name !== "image.png" ? f.name : `pasted-${Date.now()}-${i}.png`, { type: f.type }))].slice(0, 10));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  if (!status) return <Card title="Calendar screenshots"><p className="muted">Checking whether screenshot recognition is available…</p></Card>;

  if (!status.ai) {
    return (
      <Card title="Calendar screenshots" subtitle="Needs an AI backend">
        <Notice tone="warning" title="Screenshot recognition is not set up on this site">
          Reading screenshots requires a vision AI service configured on the server. The site owner needs to set <code>ANTHROPIC_API_KEY</code> in the hosting environment (see the README) and redeploy. Until then, use <strong>Calendar file</strong> import or <strong>Add manually</strong> — both work fully without AI.
        </Notice>
      </Card>
    );
  }

  async function run() {
    onError(null);
    if (status?.accessCodeRequired) saveAccessCode(code.trim());
    const events: CalendarEvent[] = [];
    const warnings: string[] = [];
    try {
      for (const [i, f] of files.entries()) {
        setBusy(`Reading screenshot ${i + 1} of ${files.length}…`);
        const label = f.name || `Screenshot ${i + 1}`;
        const r = await extractEventsFromScreenshot(f, { referenceDate: period.start, timeZone: settings.timeZone, projects, label });
        events.push(...r.events);
        warnings.push(...r.warnings.map((w) => `${label}: ${w}`));
      }
      // Within this batch, identical events seen in several screenshots are kept once.
      const seen = new Set<string>();
      const unique = events.filter((e) => {
        const k = fingerprintOf(e.date, e.start, e.end, e.title);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (unique.length < events.length) warnings.push(`${events.length - unique.length} event(s) appeared in more than one screenshot and were kept once.`);
      const outside = unique.filter((e) => e.date && (e.date < period.start || e.date > period.end));
      if (outside.length) warnings.push(`${outside.length} event(s) fall outside the timesheet period — they are flagged in review.`);
      if (unique.length === 0) {
        onError("No events could be read from these screenshots. Make sure event titles and the time grid are visible.");
        return;
      }
      onEvents(unique, warnings, `${files.length} screenshot${files.length > 1 ? "s" : ""}`);
      setFiles([]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Calendar screenshots" subtitle="Upload or paste (Ctrl/⌘+V) one or more screenshots of your Outlook calendar. Overlapping screenshots are fine — duplicates are detected.">
      <Dropzone accept="image/png,image/jpeg,image/webp,image/gif" multiple onFiles={(f) => setFiles((prev) => [...prev, ...f.filter((x) => x.type.startsWith("image/"))].slice(0, 10))} label={<><strong>Drop screenshots here</strong>, click to choose, or paste</>} hint="Work-week view with the time grid visible works best. Up to 10 images." icon="🖼️" />
      {files.length > 0 && (
        <ul className="thumbs">
          {files.map((f, i) => (
            <li key={i} className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[i]} alt={`Screenshot ${i + 1}`} />
              <span className="thumb-name">{f.name}</span>
              <button className="thumb-remove" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="privacy">
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I&apos;m allowed to share these screenshots with the AI service. They are sent from this site&apos;s server to Anthropic ({status.model}) for this one request, together with my client names and project codes for matching. This site does not store them.
          </span>
        </label>
        {status.accessCodeRequired && (
          <label className="field mt">
            <span>Access code (from whoever runs this site)</span>
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </label>
        )}
      </div>
      <div className="row gap-sm mt">
        <Button variant="primary" disabled={!files.length || !consent || Boolean(busy) || (status.accessCodeRequired && !code.trim())} onClick={run}>
          {busy ?? `Extract events from ${files.length || ""} screenshot${files.length === 1 ? "" : "s"}`}
        </Button>
        {files.length > 0 && !busy && <Button variant="ghost" onClick={() => setFiles([])}>Clear</Button>}
      </div>
      <p className="muted small mt">Extracted events always land in review flagged &ldquo;from screenshot&rdquo; — check the times against your calendar.</p>
    </Card>
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
        location: settings.defaultLocation,
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
