"use client";
import { useState } from "react";
import { Button } from "./ui";
import { diagnosticsText, type AgendaDiagnostics } from "@/lib/pdf/agenda";

/**
 * Compact, content-free import diagnostics: counts, the PDF producer and masked line shapes
 * (letters → a/A, digits → 9). Shown on screen only; "Copy" puts the same text on the clipboard so an
 * employee can send it to whoever supports the tool — no titles, attendees, links or passcodes.
 */
export function ImportDiagnostics({ diagnostics, category, open = false }: { diagnostics?: AgendaDiagnostics; category?: string; open?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!diagnostics && !category) return null;
  const d = diagnostics;
  const s = d?.stats;
  const text = d ? diagnosticsText(d, { "error category": category }) : `error category: ${category}`;
  const rows: [string, string | number | undefined][] = d
    ? [
        ["Pages", s?.pages],
        ["Selectable text found", s ? (s.nonEmptyItems > 0 ? `yes (${s.pagesWithText} of ${s.pages} pages)` : "no") : undefined],
        ["Text items / characters", s ? `${s.nonEmptyItems} / ${s.characters}` : undefined],
        ["Readable characters", s ? `${Math.round(s.readableRatio * 100)}%` : undefined],
        ["PDF created by", s?.producer],
        ["Date/time patterns found", d.dateTimeLines],
        ["Day headings", d.dayHeadings],
        ["Layout", d.layout],
        ["Candidate meetings", d.candidates],
        ["Meetings read", d.parsed],
        ["Flagged for checking", d.flagged],
        ["Couldn't interpret", d.rejected ? `${d.rejected} (${Object.entries(d.rejections).map(([k, v]) => `${k}: ${v}`).join("; ")})` : 0],
        ...(d.ocr ? ([["Text recognition confidence", `${d.ocr.meanConfidence}%`]] as [string, number | string][]) : []),
        ...(category ? ([["Error category", category]] as [string, string][]) : []),
      ]
    : [["Error category", category]];
  return (
    <details className="help diag" open={open}>
      <summary>Import diagnostics (no meeting content)</summary>
      <table className="diag-table">
        <tbody>
          {rows.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => (
            <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
      {d && d.shapes.length > 0 && (
        <>
          <p className="small muted mt">Line shapes, with every letter and digit masked:</p>
          <pre className="raw diag-shapes">{d.shapes.join("\n")}</pre>
        </>
      )}
      <div className="row gap-sm mt">
        <Button size="sm" onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}>{copied ? "Copied" : "Copy diagnostics"}</Button>
        <span className="small muted">Safe to share: contains counts and masked patterns only.</span>
      </div>
    </details>
  );
}
