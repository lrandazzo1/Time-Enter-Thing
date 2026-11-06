"use client";
import { useMemo, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Notice, downloadBytes } from "./ui";
import { validate } from "@/lib/review";
import { EXPORTERS, buildCsv, getExporter } from "@/lib/exporters";
import { encodeCsv, type CsvEncoding } from "@/lib/exporters/csv";
import { reviewSummaryMarkdown } from "@/lib/summary";
import { formatDecimalHours, toUSDate } from "@/lib/time";

export function ExportStep({ onBack, onGuide, onExported }: { onBack: () => void; onGuide: () => void; onExported?: () => void }) {
  const { entries, setEntries, projects, settings, period } = useStore();
  const [exporterId, setExporterId] = useState(EXPORTERS[0].id);
  const [encoding, setEncoding] = useState<CsvEncoding>("utf-8");
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const exporter = getExporter(exporterId);
  const ctx = { projects, settings, period };

  const issues = useMemo(() => [...validate(entries, ctx), ...exporter.validate(entries, ctx)], [entries, projects, settings, period, exporter]); // eslint-disable-line react-hooks/exhaustive-deps
  const unapproved = entries.filter((e) => e.included && !e.confirmed);
  const errors = [...issues.filter((i) => i.level === "error"), ...(unapproved.length ? [{ level: "error" as const, code: "unapproved", message: `${unapproved.length} included entr${unapproved.length === 1 ? "y hasn't" : "ies haven't"} been approved yet. Approve each line in Review once you've checked it against the time you actually worked.` }] : [])];
  const warnings = issues.filter((i) => i.level === "warning");
  const csv = useMemo(() => buildCsv(exporter, entries, ctx), [exporter, entries, projects, settings, period]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = exporter.rows(entries, ctx);
  const encoded = useMemo(() => encodeCsv(csv, encoding), [csv, encoding]);
  const fileName = exporter.fileName(period);
  const total = entries.filter((e) => e.included).reduce((a, e) => a + e.minutes, 0);
  const canDownload = errors.length === 0 && confirmed && rows.length > 0;

  return (
    <div className="stack">
      <Card title="Export timesheet" subtitle={`Period ${toUSDate(period.start)} – ${toUSDate(period.end)} · ${rows.length} rows · ${formatDecimalHours(total)} hours`}>
        <div className="row wrap gap">
          <label className="field">
            <span>Timesheet system</span>
            <select value={exporterId} onChange={(e) => setExporterId(e.target.value)}>
              {EXPORTERS.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>File encoding</span>
            <select value={encoding} onChange={(e) => setEncoding(e.target.value as CsvEncoding)}>
              <option value="utf-8">UTF-8 (recommended)</option>
              <option value="utf-8-bom">UTF-8 with BOM (Excel)</option>
              <option value="windows-1252">ANSI / Windows-1252</option>
            </select>
          </label>
        </div>
        <p className="muted small mt">{exporter.description}</p>
        {encoded.unmappable.length > 0 && (
          <Notice tone="warning">These characters can&apos;t be written in ANSI and will appear as “?”: {encoded.unmappable.join(" ")}</Notice>
        )}
      </Card>

      {errors.length > 0 ? (
        <Notice tone="error" title={`${errors.length} item${errors.length === 1 ? "" : "s"} must be fixed before downloading`}>
          <ul className="tight">
            {errors.slice(0, 30).map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
          <div className="row wrap gap-sm mt">
            <Button size="sm" onClick={onBack}>← Back to review</Button>
            {unapproved.length > 0 && errors.length === 1 && (
              <Button size="sm" variant="primary" onClick={() => {
                if (window.confirm(`Approve all ${unapproved.length} remaining entries? Only do this if you have checked every line against the time you actually worked.`)) {
                  const ids = new Set(unapproved.map((e) => e.id));
                  setEntries(entries.map((e) => (ids.has(e.id) ? { ...e, confirmed: true } : e)));
                }
              }}>I've checked them — approve all {unapproved.length}</Button>
            )}
          </div>
        </Notice>
      ) : (
        <Notice tone="success" title="Validation passed">
          Every included row is approved and has a valid date, positive decimal hours, a saved project code and task{settings.locationRequired ? ", a location" : ""}, and no unresolved overlaps or duplicates.
        </Notice>
      )}
      {warnings.length > 0 && (
        <details className="help">
          <summary>{warnings.length} warning{warnings.length === 1 ? "" : "s"} to double-check (not blocking)</summary>
          <ul className="tight">
            {warnings.map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
        </details>
      )}

      <Card title="Preview" subtitle={<>File name: <code>{fileName}</code></>}>
        <div className="table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                {exporter.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j === r.length - 1 ? "num" : ""}>{c}</td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={exporter.columns.length} className="muted">No included entries.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <details className="help mt">
          <summary>Show raw CSV</summary>
          <pre className="raw">{csv}</pre>
        </details>
      </Card>

      <Card>
        <label className="check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I reviewed these entries and they reflect the hours I actually worked.</span>
        </label>
        <div className="row wrap gap-sm mt">
          <Button variant="primary" disabled={!canDownload} onClick={() => {
            downloadBytes(encoded.bytes, fileName, encoding === "windows-1252" ? "text/csv;charset=windows-1252" : "text/csv;charset=utf-8");
            setDone(fileName);
            onExported?.();
          }}>Download {fileName}</Button>
          <Button disabled={rows.length === 0} onClick={() => downloadBytes(reviewSummaryMarkdown(entries, projects, period, issues), fileName.replace(/\.csv$/, "_Review.md"), "text/markdown;charset=utf-8")}>Download review summary</Button>
          {!confirmed && errors.length === 0 && rows.length > 0 && <Badge tone="warning">Confirm your hours to enable download</Badge>}
        </div>
        {done && (
          <Notice tone="success" title="Downloaded">
            Next: in BigTime open <strong>Import time</strong>, choose <code>{done}</code>, and map the fields as shown in the <button className="link" onClick={onGuide}>Setup Guide</button>. Nothing has been submitted to BigTime — you stay in control of the import.
          </Notice>
        )}
      </Card>
    </div>
  );
}
