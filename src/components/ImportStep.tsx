"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Dropzone, Notice, readText } from "./ui";
import type { CalendarEvent, TimeEntry } from "@/lib/types";
import { parseIcs } from "@/lib/parsers/ics";
import { parseCalendarCsv } from "@/lib/parsers/csv";
import { eventToEntry, fingerprintOf } from "@/lib/matching";
import { addDays, formatDecimalHours, intervalMinutes, isValidHHMM, mondayOf, parseHoursInput, prettyDate, todayIn } from "@/lib/time";
import { ocrImages, type OcrProgress } from "@/lib/ocr/ocr";
import { calendarEventsFromOcr } from "@/lib/parsers/calendarOcr";
import { parsePastedEvents } from "@/lib/parsers/paste";
import { uid } from "@/lib/uid";

type Mode = "file" | "paste" | "manual" | "screenshot";

interface ImportSummary {
  added: number;
  excluded: number;
  review: number;
  duplicates: number;
  warnings: string[];
  sourceLabel: string;
}

export function ImportStep({ onDone }: { onDone: () => void }) {
  const { period, setPeriod, settings, projects, entries, setEntries, rules } = useStore();
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
      const entry = eventToEntry(ev, projects, settings, rules);
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
        <Notice tone="info" title="No projects saved yet">
          You can import your calendar now and add projects as you match each meeting, or first upload your Projector Excel report on the <strong>Projects</strong> page.
        </Notice>
      )}

      <div className="method-grid four" role="tablist" aria-label="Import method">
        {(
          [
            ["file", "📅", "Upload Outlook .ics / .csv", "Recommended · exact times"],
            ["paste", "📋", "Paste event information", "Copied from Outlook or a list"],
            ["manual", "✍️", "Enter work manually", "Time that isn't on your calendar"],
            ["screenshot", "🖼️", "Calendar screenshot", "Beta · times must be verified"],
          ] as const
        ).map(([id, icon, label, sub]) => (
          <button key={id} role="tab" aria-selected={mode === id} className={`method ${mode === id ? "is-active" : ""}`} onClick={() => setMode(id)}>
            <span className="method-icon" aria-hidden>{icon}</span>
            <span className="method-title">{label}</span>
            <span className="method-sub">{sub}</span>
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
        <Card title="Import your Outlook calendar" subtitle="Your file is read in this browser only — it is not uploaded anywhere.">
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
      {mode === "paste" && <PasteEvents onEvents={addEvents} onError={setError} />}
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
            <Button variant="primary" onClick={onDone}>Match work →</Button>
          </div>
        </Notice>
      )}
    </div>
  );
}

function PasteEvents({ onEvents, onError }: { onEvents: (ev: CalendarEvent[], w: string[], label: string) => void; onError: (e: string | null) => void }) {
  const { period, settings } = useStore();
  const [text, setText] = useState("");
  return (
    <Card title="Paste event information" subtitle="Paste rows copied from Outlook's list view (with a header row), or lines like “11/03/2026 9:00 AM - 10:30 AM Acme | Planning | Model build”. Day headings such as “Tuesday, November 3” apply to the lines below them.">
      <textarea className="paste-area" rows={9} value={text} onChange={(e) => setText(e.target.value)} aria-label="Pasted events" spellCheck={false} placeholder={"Monday, November 2, 2026\n9:00 AM - 12:30 PM Acme Corp | Planning | Model build\n1:00 PM - 2:15 PM Globex sync"} />
      <div className="row gap-sm mt">
        <Button variant="primary" disabled={!text.trim()} onClick={() => {
          onError(null);
          try {
            const r = parsePastedEvents(text, period, settings);
            if (!r.events.length) {
              onError("No events with a recognisable title were found. Include a time range (e.g. 9:00 AM - 10:00 AM) and a date or day heading.");
              return;
            }
            onEvents(r.events, r.warnings, "pasted text");
            setText("");
          } catch (e) {
            onError((e as Error).message);
          }
        }}>Detect events</Button>
      </div>
      <p className="muted small mt">Lines without a visible time range are added with no hours — you enter them. Nothing is guessed.</p>
    </Card>
  );
}

function ScreenshotImport({ onEvents, onError }: { onEvents: (ev: CalendarEvent[], w: string[], label: string) => void; onError: (e: string | null) => void }) {
  const { period, settings } = useStore();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  async function run() {
    onError(null);
    try {
      const pages = await ocrImages(files, { mode: "calendar", onProgress: setProgress });
      const r = calendarEventsFromOcr(pages, period, settings);
      const seen = new Set<string>();
      const unique = r.events.filter((e) => {
        const k = fingerprintOf(e.date, e.start, e.end, e.title);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (!unique.length) {
        onError("No events could be read. Calendar screenshots are hard to read reliably — an .ics/.csv export or pasted text works much better.");
        return;
      }
      onEvents(unique, r.warnings, `${files.length} screenshot${files.length > 1 ? "s" : ""}`);
      setFiles([]);
    } catch (e) {
      onError(`Text recognition failed: ${(e as Error).message}`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card title="Calendar screenshot (beta)" subtitle="Read locally on this device. Use this only when you can't export or copy your calendar.">
      <Notice tone="warning" title="Screenshots give approximate results">
        Only text that is visible is used. Event blocks rarely show their exact times, so most events arrive <strong>without hours</strong> and every date and time must be checked. Calendar files are far more accurate.
      </Notice>
      <div className="mt">
        <Dropzone accept="image/png,image/jpeg,image/webp" multiple onFiles={(f) => setFiles((prev) => [...prev, ...f.filter((x) => x.type.startsWith("image/"))].slice(0, 10))} label={<><strong>Drop calendar screenshots</strong> or click to choose</>} hint="Work-week view with day headers visible works best." icon="🖼️" />
      </div>
      {files.length > 0 && (
        <ul className="thumbs">
          {files.map((f, i) => (
            <li key={i} className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[i]} alt={`Screenshot ${i + 1}`} />
              <span className="thumb-name">{f.name}</span>
              <button className="thumb-remove" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {progress ? (
        <div className="progress-box" role="status" aria-live="polite">
          <div className="small">Screenshot {progress.index + 1} of {progress.total}: {progress.status}</div>
          <div className="progress"><span style={{ width: `${((progress.index + progress.progress) / progress.total) * 100}%` }} /></div>
        </div>
      ) : (
        <Button variant="primary" className="mt" disabled={!files.length} onClick={run}>Read {files.length || ""} screenshot{files.length === 1 ? "" : "s"}</Button>
      )}
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
