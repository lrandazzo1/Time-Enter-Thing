"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Notice } from "./ui";
import { ManualEntry } from "./ImportStep";
import type { ImportNote, ProjectMapping, TimeEntry } from "@/lib/types";
import { dailyTotals, findDuplicates, findOverlaps, mergeEntries, splitOverlapEvenly, totals, validate } from "@/lib/review";
import { formatDecimalHours, listDates, parseHoursInput, prettyDate } from "@/lib/time";
import { upsertRules } from "./MatchStep";
import { uid } from "@/lib/uid";

const MANUAL_MATCH_CODES = ["no-project", "ambiguous-project", "task-unclear", "convention-task-unmatched", "fuzzy-suggestion", "domain-match"];

export function entryStatus(e: TimeEntry, project?: ProjectMapping): { label: string; tone: "neutral" | "info" | "warning" | "error" | "success" } {
  if (!e.included) return { label: "Excluded", tone: "neutral" };
  if (!e.projectId || !e.task) return { label: "Unmatched", tone: "error" };
  if (e.confirmed) return { label: project && !project.billable ? "Confirmed · internal" : "Confirmed", tone: "success" };
  return { label: project && !project.billable ? "Proposed · internal" : e.source === "manual" ? "Proposed (manual)" : "Proposed", tone: "info" };
}

export function durationWords(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} hour${h === 1 ? "" : "s"}${r ? ` ${r} min` : ""}`;
}

type Filter = "all" | "attention" | "included" | "excluded";

const STALE: Record<string, (e: TimeEntry) => boolean> = {
  "no-project": (e) => Boolean(e.projectId),
  "ambiguous-project": (e) => Boolean(e.projectId),
  "task-unclear": (e) => Boolean(e.task),
  "convention-task-unmatched": (e) => Boolean(e.task),
  "missing-times": (e) => e.minutes > 0,
};
export const liveNotes = (e: TimeEntry): ImportNote[] => e.notes.filter((n) => !STALE[n.code]?.(e));

export function ReviewStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { entries, setEntries, projects, settings, setSettings, period, rules, setRules } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const overlaps = useMemo(() => findOverlaps(entries), [entries]);
  const dupGroups = useMemo(() => findDuplicates(entries).filter((g) => !entries.filter((e) => g.includes(e.id)).every((e) => e.duplicateAck)), [entries]);
  const issues = useMemo(() => validate(entries, { projects, settings, period }), [entries, projects, settings, period]);
  const errorsById = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of issues) if (i.entryId && i.level === "error") m.set(i.entryId, [...(m.get(i.entryId) ?? []), i.code]);
    return m;
  }, [issues]);
  const overlapIds = useMemo(() => new Set(overlaps.filter((c) => c.unresolved).flatMap((c) => c.entryIds)), [overlaps]);
  const dupIds = useMemo(() => new Set(dupGroups.flat()), [dupGroups]);
  const t = useMemo(() => totals(entries, projects), [entries, projects]);
  const daily = useMemo(() => dailyTotals(entries), [entries]);
  const errorCount = issues.filter((i) => i.level === "error").length;
  const readyIds = entries.filter((e) => e.included && !e.confirmed && e.projectId && e.task && e.minutes > 0 && !errorsById.has(e.id)).map((e) => e.id);
  const unapproved = entries.filter((e) => e.included && !e.confirmed).length;

  // Changing what an entry claims un-approves it, so approval always reflects the final values.
  const update = (id: string, patch: Partial<TimeEntry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch, confirmed: "confirmed" in patch ? patch.confirmed : ["minutes", "projectId", "task", "date", "included"].some((k) => k in patch) ? false : e.confirmed } : e)));
  const approve = (ids: string[]) => {
    const idSet = new Set(ids);
    const next = entries.map((e) => (idSet.has(e.id) ? { ...e, confirmed: true } : e));
    setEntries(next);
    // Remember matches the user made themselves (unmatched/ambiguous/suggested at import time).
    const learned = next.filter((e) => idSet.has(e.id) && e.notes.some((n) => MANUAL_MATCH_CODES.includes(n.code) || n.message === "Matched by you."));
    if (learned.length) setRules(upsertRules(rules, learned));
  };
  const split = (id: string) =>
    setEntries((prev) => prev.flatMap((e) => (e.id !== id ? [e] : [{ ...e, minutes: e.minutes / 2, confirmed: false }, { ...e, id: uid(), minutes: e.minutes / 2, confirmed: false, task: "", fingerprint: undefined, duplicateAck: true, notes: [{ code: "info", level: "info", message: "Split from another entry — choose the task for this part." }] }])));
  const remove = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));

  const needsAttention = (e: TimeEntry) => e.included && (errorsById.has(e.id) || overlapIds.has(e.id) || dupIds.has(e.id) || liveNotes(e).some((n) => n.level === "warning"));
  const visible = entries.filter((e) => (filter === "all" ? true : filter === "included" ? e.included : filter === "excluded" ? !e.included : needsAttention(e)));
  const dates = [...new Set([...listDates(period.start, period.end), ...visible.map((e) => e.date)])].sort();
  const sortKey = (e: TimeEntry) => `${e.intervals[0]?.start ?? "99:99"}`;

  useEffect(() => {
    if (!flash) return;
    const h = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(h);
  }, [flash]);

  if (entries.length === 0) {
    return (
      <Card title="Nothing to review yet">
        <p className="muted">Import a calendar file or screenshots, or add entries manually.</p>
        <div className="row gap-sm mt">
          <Button variant="primary" onClick={onBack}>← Import calendar</Button>
          <Button onClick={() => setShowAdd(true)}>Add manually</Button>
        </div>
        {showAdd && <div className="mt"><ManualEntry compact /></div>}
      </Card>
    );
  }

  return (
    <div className="stack">
      <Notice tone="info" title="Calendar time is a proposal, not proof of time worked">
        Check every entry against what you actually worked. Change hours, tasks and descriptions as needed, exclude anything that wasn&apos;t work, and add time that isn&apos;t on your calendar.
      </Notice>

      <div className="summary-grid">
        <div className="stat"><span className="stat-label">Total</span><span className="stat-value">{formatDecimalHours(t.total)}</span><span className="stat-sub">hours included</span></div>
        <div className="stat"><span className="stat-label">Billable</span><span className="stat-value">{formatDecimalHours(t.billable)}</span><span className="stat-sub">client projects</span></div>
        <div className="stat"><span className="stat-label">Internal</span><span className="stat-value">{formatDecimalHours(t.internal)}</span><span className="stat-sub">non-billable</span></div>
        <div className={`stat ${errorCount ? "stat-alert" : "stat-ok"}`}><span className="stat-label">To resolve</span><span className="stat-value">{errorCount}</span><span className="stat-sub">{errorCount ? "blocking export" : "ready to export"}</span></div>
      </div>

      {overlaps.filter((c) => c.unresolved).map((c) => (
        <Notice key={c.date + c.entryIds.join()} tone="error" title={`${c.entryIds.length === 2 ? "Two" : c.entryIds.length} meetings overlap by ${durationWords(c.claimedMinutes - c.unionMinutes)} on ${prettyDate(c.date)}. Review before exporting.`}>
          <p>
            Together they claim <strong>{formatDecimalHours(c.claimedMinutes)} h</strong>, but only <strong>{formatDecimalHours(c.unionMinutes)} h</strong> of clock time passed:{" "}
            {entries.filter((e) => c.entryIds.includes(e.id)).map((e) => `${e.intervals.map((i) => `${i.start}–${i.end}`).join(", ")} ${e.description || e.title}`).join(" · ")}
          </p>
          <div className="row wrap gap-sm mt">
            <Button size="sm" onClick={() => {
              const split = splitOverlapEvenly(entries, c);
              setEntries((prev) => prev.map((e) => (split[e.id] !== undefined ? { ...e, minutes: split[e.id], confirmed: false } : e)));
              setFlash("Overlapping time split evenly between the meetings. Adjust if you spent more time in one.");
            }}>Split overlap evenly</Button>
            <Button size="sm" variant="ghost" onClick={() => setEntries((prev) => prev.map((e) => (c.entryIds.includes(e.id) ? { ...e, overlapAck: true } : e)))}>Hours are correct as entered</Button>
            <span className="muted small">Or exclude the meeting you didn&apos;t attend, or edit the hours below.</span>
          </div>
        </Notice>
      ))}

      {dupGroups.map((g) => {
        const members = entries.filter((e) => g.includes(e.id));
        return (
          <Notice key={g.join()} tone="error" title={`Possible duplicate: "${members[0].title}" on ${prettyDate(members[0].date)}`}>
            <div className="row wrap gap-sm">
              <Button size="sm" onClick={() => setEntries((prev) => prev.map((e) => (g.slice(1).includes(e.id) ? { ...e, included: false, excludeReason: "Duplicate" } : e)))}>Keep one, exclude {g.length - 1}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEntries((prev) => prev.map((e) => (g.includes(e.id) ? { ...e, duplicateAck: true } : e)))}>They are separate</Button>
            </div>
          </Notice>
        );
      })}

      <div className="toolbar">
        <div className="segmented small" role="tablist" aria-label="Filter entries">
          {(
            [
              ["all", `All (${entries.length})`],
              ["attention", `Needs attention (${entries.filter(needsAttention).length})`],
              ["included", `Included (${entries.filter((e) => e.included).length})`],
              ["excluded", `Excluded (${entries.filter((e) => !e.included).length})`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} className={`segment ${filter === id ? "is-active" : ""}`} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="row wrap gap-sm align-end">
          <label className="field inline">
            <span>Default location</span>
            <input value={settings.defaultLocation} placeholder="Exactly as in BigTime" onChange={(e) => setSettings({ ...settings, defaultLocation: e.target.value })} />
          </label>
          <Button size="sm" disabled={!settings.defaultLocation.trim()} onClick={() => {
            setEntries((prev) => prev.map((e) => ({ ...e, location: settings.defaultLocation.trim() })));
            setFlash(`Location set to "${settings.defaultLocation.trim()}" on all entries.`);
          }}>Apply to all</Button>
          <Button size="sm" onClick={() => {
            const r = mergeEntries(entries);
            setEntries(r.entries);
            setFlash(r.merged ? `Merged ${r.merged} entr${r.merged === 1 ? "y" : "ies"} into same-day lines.${r.skipped.length ? " " + r.skipped.join(" ") : ""}` : r.skipped.length ? r.skipped.join(" ") : "Nothing to merge — no two included entries share a date, project and task.");
          }}>Merge same day/project/task</Button>
          <Button size="sm" onClick={() => setShowAdd((s) => !s)}>{showAdd ? "Close" : "+ Add entry"}</Button>
          <Button size="sm" variant="primary" disabled={!readyIds.length} onClick={() => approve(readyIds)}>Approve all ready ({readyIds.length})</Button>
        </div>
      </div>
      {unapproved > 0 && <p className="small muted">{unapproved} included entr{unapproved === 1 ? "y is" : "ies are"} still proposed. Approve each line once you&apos;ve checked it against the time you actually worked — only approved lines can be exported.</p>}
      {flash && <Notice tone="success">{flash}</Notice>}
      {showAdd && <Card title="Add missing work"><ManualEntry compact /></Card>}

      <div className="table-wrap">
        <table className="review-table">
          <thead>
            <tr>
              <th className="col-inc" aria-label="Include">Incl.</th>
              <th className="col-time">Time</th>
              <th className="col-proj">Client / Project</th>
              <th className="col-task">Task</th>
              <th className="col-desc">Description</th>
              <th className="col-loc">Location</th>
              <th className="col-hours">Hours</th>
              <th className="col-status">Status</th>
              <th className="col-act" aria-label="Actions" />
            </tr>
          </thead>
          {dates.map((d) => {
            const rows = visible.filter((e) => e.date === d).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
            if (rows.length === 0 && filter !== "all") return null;
            return (
              <tbody key={d || "nodate"}>
                <tr className="day-row">
                  <th colSpan={6}>
                    <div className="row gap-sm align-center">
                      {d ? prettyDate(d) : "No date — set a work date"}
                      {(d < period.start || d > period.end) && d && <Badge tone="warning">outside period</Badge>}
                    </div>
                  </th>
                  <th className="col-hours day-total">{formatDecimalHours(daily[d] ?? 0)}</th>
                  <th />
                  <th />
                </tr>
                {rows.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={9} className="muted small">No entries</td>
                  </tr>
                )}
                {rows.map((e) => (
                  <EntryRow key={e.id} e={e} projects={projects} project={e.projectId ? byId.get(e.projectId) : undefined} errors={errorsById.get(e.id) ?? []} overlap={overlapIds.has(e.id)} dup={dupIds.has(e.id)} update={update} remove={remove} approve={approve} split={split} />
                ))}
              </tbody>
            );
          })}
          <tfoot>
            <tr>
              <th colSpan={6}>Week total</th>
              <th className="col-hours">{formatDecimalHours(t.total)}</th>
              <th />
              <th />
            </tr>
          </tfoot>
        </table>
      </div>

      {t.byProject.length > 0 && (
        <Card title="Hours by project">
          <ul className="by-project">
            {t.byProject.map((p) => (
              <li key={p.label}>
                <span>{p.label}</span>
                {p.billable === false && <Badge>internal</Badge>}
                {p.billable === null && <Badge tone="error">unassigned</Badge>}
                <span className="num">{formatDecimalHours(p.minutes)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="row space-between wrap gap">
        <Button onClick={onBack}>← Import more</Button>
        <Button variant="primary" onClick={onNext}>{errorCount ? `Continue to export (${errorCount} to resolve)` : "Continue to export →"}</Button>
      </div>
    </div>
  );
}

function EntryRow({ e, projects, project, errors, overlap, dup, update, remove, approve, split }: { e: TimeEntry; projects: ProjectMapping[]; project?: ProjectMapping; errors: string[]; overlap: boolean; dup: boolean; update: (id: string, p: Partial<TimeEntry>) => void; remove: (id: string) => void; approve: (ids: string[]) => void; split: (id: string) => void }) {
  const st = entryStatus(e, project);
  const notes = liveNotes(e);
  const candidates = e.candidates?.length ? projects.filter((p) => e.candidates!.includes(p.id)) : [];
  const err = (c: string) => e.included && errors.includes(c);
  return (
    <tr className={`entry-row ${e.included ? "" : "is-excluded"} ${overlap || dup ? "is-flagged" : ""}`}>
      <td className="col-inc" data-label="Include">
        <input type="checkbox" checked={e.included} aria-label={e.included ? "Included — click to exclude" : "Excluded — click to include"} onChange={(ev) => update(e.id, { included: ev.target.checked, excludeReason: ev.target.checked ? undefined : "Excluded by you" })} />
      </td>
      <td className="col-time" data-label="Time">
        <input type="date" className={`date-input ${err("date") ? "has-error" : ""}`} value={e.date} aria-label="Work date" onChange={(ev) => update(e.id, { date: ev.target.value })} />
        <div className="time-range">{e.intervals.length ? e.intervals.map((i) => `${i.start}–${i.end}`).join(", ") : <span className="muted">no times</span>}</div>
      </td>
      <td className="col-proj" data-label="Project">
        <select className={err("project") ? "has-error" : ""} value={e.projectId ?? ""} aria-label="Project" onChange={(ev) => {
          const p = projects.find((x) => x.id === ev.target.value);
          const task = p ? (p.tasks.includes(e.task) ? e.task : p.tasks.length === 1 ? p.tasks[0] : p.defaultTask && p.tasks.includes(p.defaultTask) ? p.defaultTask : "") : "";
          update(e.id, { projectId: p?.id ?? null, task, candidates: undefined, suggestion: undefined });
        }}>
          <option value="">{candidates.length ? "Choose (ambiguous)…" : "Choose project…"}</option>
          {candidates.length > 0 && (
            <optgroup label="Suggested">
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>{p.client} — {p.code}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="All projects">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.client} — {p.code}</option>
            ))}
          </optgroup>
        </select>
        <div className="row-meta">
          {project && !project.billable && <Badge>internal</Badge>}
          <Badge title={e.sourceLabel}>{e.source === "screenshot" ? "from screenshot" : e.source === "manual" ? "manual" : e.source.toUpperCase()}</Badge>
          {e.status === "tentative" && <Badge tone="warning">tentative</Badge>}
        </div>
      </td>
      <td className="col-task" data-label="Task">
        <select className={err("task") ? "has-error" : ""} value={e.task} disabled={!project} aria-label="Task" onChange={(ev) => update(e.id, { task: ev.target.value })}>
          <option value="">{project ? "Choose task…" : "—"}</option>
          {project?.tasks.map((t) => (
            <option key={t}>{t}</option>
          ))}
          {project && e.task && !project.tasks.includes(e.task) && <option value={e.task}>{e.task} (not configured)</option>}
        </select>
      </td>
      <td className="col-desc" data-label="Description">
        <input value={e.description} maxLength={1000} aria-label="Description" onChange={(ev) => update(e.id, { description: ev.target.value })} />
        {e.title && e.title !== e.description && <div className="row-title" title="Calendar title">📅 {e.title}</div>}
        {!e.included && e.excludeReason && <div className="row-note muted">Excluded: {e.excludeReason}</div>}
        {e.included && overlap && <div className="row-note text-error">Overlaps another entry</div>}
        {e.included && dup && <div className="row-note text-error">Possible duplicate</div>}
        {e.included && notes.filter((n) => n.code !== "canceled" && n.code !== "all-day" && n.code !== "free" && n.code !== "excluded-keyword" && n.code !== "duplicate").map((n, i) => (
          <div key={i} className={`row-note ${n.level === "warning" ? "text-warning" : "muted"}`}>{n.level === "warning" ? "⚠ " : ""}{n.message}</div>
        ))}
      </td>
      <td className="col-loc" data-label="Location">
        <input className={err("location") ? "has-error" : ""} value={e.location} aria-label="Location" onChange={(ev) => update(e.id, { location: ev.target.value })} />
      </td>
      <td className="col-hours" data-label="Hours">
        <HoursInput minutes={e.minutes} invalid={err("hours")} onChange={(m) => update(e.id, { minutes: m })} />
      </td>
      <td className="col-status" data-label="Status">
        <Badge tone={st.tone}>{st.label}</Badge>
        {e.included && (
          e.confirmed ? (
            <button className="link small" onClick={() => update(e.id, { confirmed: false })}>Undo</button>
          ) : (
            <Button size="sm" className="approve-btn" disabled={errors.length > 0 || !e.projectId || !e.task} onClick={() => approve([e.id])} aria-label={`Approve ${e.description || e.title}`}>✓ Approve</Button>
          )
        )}
      </td>
      <td className="col-act">
        <div className="row-actions">
          {e.included && e.minutes > 0 && <button className="icon-btn" aria-label="Split entry into two" title="Split into two entries (e.g. two tasks in one block)" onClick={() => split(e.id)}>✂</button>}
          <button className="icon-btn" aria-label="Delete entry" title="Delete entry" onClick={() => remove(e.id)}>🗑</button>
        </div>
      </td>
    </tr>
  );
}

export function HoursInput({ minutes, onChange, invalid }: { minutes: number; onChange: (m: number) => void; invalid?: boolean }) {
  const [text, setText] = useState(formatDecimalHours(minutes));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(formatDecimalHours(minutes)), [minutes]);
  const commit = () => {
    const m = parseHoursInput(text);
    if (m === null) {
      setBad(true);
      return;
    }
    setBad(false);
    onChange(m);
    setText(formatDecimalHours(m));
  };
  return (
    <div>
      <input
        className={`hours-input ${bad || invalid ? "has-error" : ""}`}
        inputMode="decimal"
        aria-label="Work hours (decimal)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {bad && <div className="row-note text-error">Use decimals, e.g. 1.50</div>}
    </div>
  );
}
