"use client";
import { useMemo } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Notice } from "./ui";
import type { TimeEntry } from "@/lib/types";
import { findOverlaps } from "@/lib/review";
import { formatDecimalHours, prettyDate, toUSDate } from "@/lib/time";

/** Step 2 — what was read from the PDF: meetings, dates covered, canceled/all-day exclusions, warnings. */
export function ExtractStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { entries, setEntries, lastImport } = useStore();
  const pdf = entries.filter((e) => e.source === "pdf");
  const included = pdf.filter((e) => e.included);
  const excluded = pdf.filter((e) => !e.included);
  const overlaps = useMemo(() => findOverlaps(entries), [entries]);
  const update = (id: string, patch: Partial<TimeEntry>) => setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch, confirmed: false } : e)));

  if (!lastImport && pdf.length === 0) {
    return (
      <Card title="No calendar imported yet">
        <p className="muted">Upload your Outlook Detailed agenda PDF first, or skip to Review to add work manually.</p>
        <div className="row gap-sm mt">
          <Button variant="primary" onClick={onBack}>← Upload calendar PDF</Button>
          <Button onClick={onNext}>Skip</Button>
        </div>
      </Card>
    );
  }

  const scheduled = included.reduce((a, e) => a + (e.scheduledMinutes ?? e.minutes), 0);
  return (
    <div className="stack">
      <div className="summary-grid">
        <div className="stat stat-ok"><span className="stat-label">Meetings found</span><span className="stat-value">{lastImport?.timed ?? included.length}</span><span className="stat-sub">{formatDecimalHours(scheduled)} h scheduled · {lastImport?.pages ?? "?"} PDF pages</span></div>
        <div className="stat"><span className="stat-label">Dates covered</span><span className="stat-value small-value">{lastImport?.period ? `${toUSDate(lastImport.period.start)} – ${toUSDate(lastImport.period.end)}` : "—"}</span><span className="stat-sub">from the PDF header</span></div>
        <div className="stat"><span className="stat-label">Canceled</span><span className="stat-value">{lastImport?.canceled ?? 0}</span><span className="stat-sub">excluded by default</span></div>
        <div className="stat"><span className="stat-label">All-day</span><span className="stat-value">{lastImport?.allDay ?? 0}</span><span className="stat-sub">PTO, holidays — excluded</span></div>
      </div>

      {(lastImport?.warnings.length ?? 0) > 0 && (
        <Notice tone="warning" title="Check these">
          <ul className="tight">{lastImport!.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Notice>
      )}
      {(lastImport?.duplicatesRemoved.length ?? 0) > 0 && (
        <Notice tone="info" title={`${lastImport!.duplicatesRemoved.length} duplicate meeting${lastImport!.duplicatesRemoved.length === 1 ? "" : "s"} listed twice in the PDF — kept once`}>
          <ul className="tight small">{lastImport!.duplicatesRemoved.map((d, i) => <li key={i}>{prettyDate(d.date)} {d.start} {d.title}</li>)}</ul>
        </Notice>
      )}
      {overlaps.length > 0 && (
        <Notice tone="warning" title={`${overlaps.length} time${overlaps.length === 1 ? "" : "s"} when meetings overlap`}>
          Overlapping hours are never counted twice. You&apos;ll choose what you actually attended in <strong>Review hours</strong>.
        </Notice>
      )}

      <Card title={`Meetings to review (${included.length})`} subtitle="Scheduled times from your calendar. These are proposals — you'll confirm the time you actually worked later.">
        <div className="table-wrap">
          <table className="extract-table">
            <thead>
              <tr><th className="col-inc">Use</th><th>Date</th><th>Time</th><th>Meeting</th><th>Organizer</th><th className="num">Hours</th></tr>
            </thead>
            <tbody>
              {included.map((e) => (
                <tr key={e.id}>
                  <td className="col-inc" data-label="Use"><input type="checkbox" checked aria-label={`Exclude ${e.title}`} onChange={() => update(e.id, { included: false, excludeReason: "Excluded by you" })} /></td>
                  <td data-label="Date">{prettyDate(e.date)}</td>
                  <td data-label="Time" className="nowrap">{e.intervals.map((i) => `${i.start}–${i.end}`).join(", ") || "—"}</td>
                  <td data-label="Meeting">
                    {e.title}
                    {e.notes.some((n) => n.code === "crosses-midnight") && <div className="row-note text-warning">Runs past midnight — split by day.</div>}
                    {e.sourceText && (
                      <details className="source"><summary>Source</summary><pre>{e.sourceText}</pre></details>
                    )}
                  </td>
                  <td data-label="Organizer" className="small">{e.organizer ?? "—"}</td>
                  <td data-label="Hours" className="num">{formatDecimalHours(e.scheduledMinutes ?? e.minutes)}</td>
                </tr>
              ))}
              {included.length === 0 && <tr><td colSpan={6} className="muted">No meetings are included.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Excluded events (${excluded.length})`} subtitle="Canceled meetings, all-day events (other people's PTO, holidays) and personal items. Include one only if you really did work in that time.">
        {excluded.length === 0 ? (
          <p className="muted small">Nothing was excluded.</p>
        ) : (
          <ul className="resolve-list">
            {excluded.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{e.title}</strong> <span className="muted small">· {prettyDate(e.date)}{e.endDate ? ` to ${prettyDate(e.endDate)}` : ""}{e.intervals[0] ? ` · ${e.intervals[0].start}–${e.intervals[0].end}` : ""}</span>
                  <div className="row-meta">
                    <Badge tone={/cancel/i.test(e.excludeReason ?? "") ? "warning" : "neutral"}>{e.excludeReason ?? "Excluded"}</Badge>
                  </div>
                </div>
                <Button size="sm" onClick={() => update(e.id, { included: true, excludeReason: undefined, minutes: e.intervals.length ? e.minutes : 0 })}>
                  Include{e.intervals.length ? "" : " (enter hours)"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="row space-between wrap gap">
        <Button onClick={onBack}>← Upload a different PDF</Button>
        <Button variant="primary" onClick={onNext}>Match projects →</Button>
      </div>
    </div>
  );
}
