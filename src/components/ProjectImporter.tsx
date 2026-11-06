"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Dropzone, Notice, readText } from "./ui";
import { ocrImages, type OcrProgress } from "@/lib/ocr/ocr";
import { parseProjectorPages, parseProjectorText, type ParseResult, type ParsedTask } from "@/lib/projector/parse";
import { isValidCode } from "@/lib/projector/codes";
import { rowProblems, rowStatus, toMapping, type ReviewProject } from "@/lib/projector/toMapping";
import { mergeProjects, parseProjectsCsv } from "@/lib/projectsCsv";
import { loadProjectDraft, parseBackup, saveProjectDraft } from "@/lib/storage";
import type { ProjectMapping } from "@/lib/types";
import { uid } from "@/lib/uid";

type Method = "screenshot" | "paste" | "file";

interface ReviewState {
  source: ProjectMapping["source"];
  rows: ReviewProject[];
  orphans: ParseResult["orphanTasks"];
  loose: ParseResult["looseLines"];
  rawText: ParseResult["rawText"];
}

export interface ImporterResult {
  added: number;
  updated: number;
  newTasks: number;
  saved: ProjectMapping[];
}

/** First-time and incremental project import: screenshots (local OCR), pasted text, or files. */
export function ProjectImporter({ onSaved, compact = false, initialMethod = "screenshot", onReviewing }: { onSaved?: (r: ImporterResult) => void; compact?: boolean; initialMethod?: Method; onReviewing?: (reviewing: boolean) => void }) {
  const { projects, setProjects, settings, setSettings, setRules } = useStore();
  const [method, setMethod] = useState<Method>(initialMethod);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const d = loadProjectDraft<ReviewState>();
    if (d && Array.isArray(d.rows) && d.rows.length) setReview(d);
  }, []);
  useEffect(() => {
    if (restored.current) saveProjectDraft(review);
    onReviewing?.(Boolean(review));
  }, [review]); // eslint-disable-line react-hooks/exhaustive-deps

  const startReview = useCallback((r: ParseResult, source: ProjectMapping["source"]) => {
    setError(null);
    setDone(null);
    if (!r.projects.length && !r.orphanTasks.length) {
      setError("No Projector projects were found. Make sure the project codes (like P001234-001) are visible, or try pasting the text instead.");
      return;
    }
    setReview({
      source,
      rows: r.projects.map((p) => ({ ...p, approved: false })),
      orphans: r.orphanTasks,
      loose: r.looseLines,
      rawText: r.rawText,
    });
  }, []);

  function save(rows: ReviewProject[]) {
    const incoming = rows.filter((r) => r.approved).map((r) => toMapping(r, review?.source));
    const m = mergeProjects(projects, incoming);
    setProjects(m.projects);
    setReview(null);
    saveProjectDraft(null); // the parent may unmount this component right away
    setDone(`Saved: ${m.added} new project${m.added === 1 ? "" : "s"}${m.updated ? `, ${m.updated} updated` : ""}${m.newTasks ? ` (${m.newTasks} task${m.newTasks === 1 ? "" : "s"} added)` : ""}. Your existing projects were kept.`);
    onSaved?.({ added: m.added, updated: m.updated, newTasks: m.newTasks, saved: m.projects });
  }

  if (review) {
    return <ProjectReview state={review} setState={setReview} onSave={save} onCancel={() => { setReview(null); saveProjectDraft(null); }} keepNumbers={settings.keepTaskNumbers} existing={projects} />;
  }

  return (
    <div className="stack">
      {!compact && (
        <div className="method-grid" role="tablist" aria-label="How to import projects">
          {(
            [
              ["screenshot", "📸", "Scan screenshots", "Recommended · reads Projector screenshots on this device"],
              ["paste", "📋", "Paste Projector text", "Fastest when Projector lets you select text"],
              ["file", "🗂️", "Import a file", "Backup .json or projects .csv"],
            ] as const
          ).map(([id, icon, title, sub]) => (
            <button key={id} role="tab" aria-selected={method === id} className={`method ${method === id ? "is-active" : ""}`} onClick={() => setMethod(id)}>
              <span className="method-icon" aria-hidden>{icon}</span>
              <span className="method-title">{title}</span>
              <span className="method-sub">{sub}</span>
            </button>
          ))}
        </div>
      )}
      {method === "screenshot" && <ScreenshotScan keepNumbers={settings.keepTaskNumbers} onResult={(r) => startReview(r, "screenshot")} onError={setError} />}
      {method === "paste" && <PasteText keepNumbers={settings.keepTaskNumbers} onResult={(r) => startReview(r, "paste")} />}
      {method === "file" && (
        <FileImport
          keepNumbers={settings.keepTaskNumbers}
          onRows={(rows) => setReview({ source: "file", rows, orphans: [], loose: [], rawText: [] })}
          onRestore={(b) => {
            setProjects(b.projects);
            setSettings({ ...b.settings, onboarding: settings.onboarding, onboardingStep: settings.onboardingStep });
            setRules(b.rules ?? []);
            setDone(`Restored ${b.projects.length} projects, your settings${b.rules?.length ? ` and ${b.rules.length} remembered matches` : ""} from the backup.`);
            onSaved?.({ added: b.projects.length, updated: 0, newTasks: 0, saved: b.projects });
          }}
          onError={setError}
        />
      )}
      <label className="check small">
        <input type="checkbox" checked={settings.keepTaskNumbers} onChange={(e) => setSettings({ ...settings, keepTaskNumbers: e.target.checked })} />
        <span>Keep Projector&apos;s task numbers (e.g. “2 Planning”). Leave this off unless your BigTime import requires them — the tested BigTime import uses “Planning”.</span>
      </label>
      {error && <Notice tone="error" title="Couldn't import projects">{error}</Notice>}
      {done && <Notice tone="success" title="Projects saved">{done}</Notice>}
    </div>
  );
}

/* ----------------------------- screenshots ----------------------------- */

function ScreenshotScan({ onResult, onError, keepNumbers }: { onResult: (r: ParseResult) => void; onError: (e: string | null) => void; keepNumbers: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (imgs.length) setFiles((prev) => [...prev, ...imgs.map((f, i) => new File([f], `Pasted screenshot ${prev.length + i + 1}.png`, { type: f.type }))].slice(0, 20));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    onError(null);
    abort.current = new AbortController();
    try {
      const pages = await ocrImages(files, { mode: "list", onProgress: setProgress, signal: abort.current.signal });
      const r = parseProjectorPages(pages.map((p) => ({ label: p.label, width: p.width, lines: p.lines })), { keepTaskNumbers: keepNumbers });
      onResult(r);
      setFiles([]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") onError(`Text recognition failed: ${(e as Error).message}. Try a sharper screenshot, or paste the text instead.`);
    } finally {
      setProgress(null);
    }
  }

  const move = (i: number, d: number) => setFiles((f) => {
    const n = [...f];
    const j = i + d;
    if (j < 0 || j >= n.length) return f;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  return (
    <Card title="Scan Projector screenshots" subtitle="Screenshots are read by a text-recognition engine running in this browser. Nothing is uploaded.">
      <Notice tone="info" title="Before you capture">
        In Projector, open your project/task list and <strong>expand every project</strong> so its tasks are visible — collapsed tasks can&apos;t be read. Capture the list top to bottom; overlapping screenshots are fine. Keep them in order.
      </Notice>
      <div className="mt">
        <Dropzone accept="image/png,image/jpeg,image/webp,image/bmp" multiple onFiles={(f) => setFiles((prev) => [...prev, ...f.filter((x) => x.type.startsWith("image/"))].slice(0, 20))} label={<><strong>Drop screenshots here</strong>, click to choose, or paste (Ctrl/⌘+V)</>} hint="PNG or JPG · up to 20 images · full-resolution screenshots read best" icon="📸" />
      </div>
      {files.length > 0 && (
        <ol className="thumbs ordered">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[i]} alt={`Screenshot ${i + 1}: ${f.name}`} />
              <span className="thumb-name">{i + 1}. {f.name}</span>
              <span className="thumb-tools">
                <button aria-label={`Move ${f.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button aria-label={`Move ${f.name} later`} disabled={i === files.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {progress ? (
        <div className="progress-box" role="status" aria-live="polite">
          <div className="row space-between small">
            <span>Screenshot {progress.index + 1} of {progress.total}: {progress.status}</span>
            <span>{Math.round(((progress.index + progress.progress) / progress.total) * 100)}%</span>
          </div>
          <div className="progress"><span style={{ width: `${((progress.index + progress.progress) / progress.total) * 100}%` }} /></div>
          <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button>
        </div>
      ) : (
        <div className="row gap-sm mt">
          <Button variant="primary" disabled={!files.length} onClick={run}>Detect projects{files.length ? ` in ${files.length} screenshot${files.length === 1 ? "" : "s"}` : ""}</Button>
          {files.length > 0 && <Button variant="ghost" onClick={() => setFiles([])}>Clear</Button>}
        </div>
      )}
    </Card>
  );
}

/* ----------------------------- paste ----------------------------- */

function PasteText({ onResult, keepNumbers }: { onResult: (r: ParseResult) => void; keepNumbers: boolean }) {
  const [text, setText] = useState("");
  return (
    <Card title="Paste Projector text" subtitle="In Projector, expand your projects, select the list (Ctrl/⌘+A), copy (Ctrl/⌘+C) and paste it below. Extra labels and spacing are fine.">
      <label className="field">
        <span className="sr-only">Projector text</span>
        <textarea className="paste-area" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Example:\nAcme Components - Adaptive Planning - Implementation P001234-001\n2 Planning\n3 Gears"} spellCheck={false} />
      </label>
      <div className="row gap-sm mt">
        <Button variant="primary" disabled={!text.trim()} onClick={() => onResult(parseProjectorText(text, { keepTaskNumbers: keepNumbers }))}>Detect projects</Button>
        {text && <Button variant="ghost" onClick={() => setText("")}>Clear</Button>}
      </div>
    </Card>
  );
}

/* ----------------------------- file ----------------------------- */

function FileImport({ onRows, onRestore, onError, keepNumbers }: { onRows: (r: ReviewProject[]) => void; onRestore: (b: ReturnType<typeof parseBackup>) => void; onError: (e: string | null) => void; keepNumbers: boolean }) {
  async function take(files: File[]) {
    onError(null);
    try {
      const text = await readText(files[0]);
      if (/^\s*\{/.test(text)) {
        const b = parseBackup(text, uid);
        if (window.confirm(`Restore this backup? It contains ${b.projects.length} projects and replaces the projects and settings saved in this browser.`)) onRestore(b);
        return;
      }
      const r = parseProjectsCsv(text, { stripNumericPrefixes: !keepNumbers });
      onRows(
        r.projects.map((p) => ({
          key: p.id,
          code: p.code,
          codeStatus: isValidCode(p.code) ? "valid" : p.code ? "ambiguous" : "missing",
          codeIssue: isValidCode(p.code) ? undefined : "Code isn't in the P000000-000 format — check it.",
          fullName: p.fullName ?? "",
          client: p.client,
          internal: !p.billable,
          tasks: p.tasks.map((t) => ({ name: t, raw: t })),
          pages: [files[0].name],
          raw: "",
          issues: r.warnings,
          approved: false,
        })),
      );
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <Card title="Import a file" subtitle="A Timesheet Converter backup (.json) restores everything. A projects CSV (Client, Project Code, Tasks…) is added to your saved projects after you review it.">
      <Dropzone accept=".json,.csv,application/json,text/csv" onFiles={take} label={<><strong>Drop a backup .json or projects .csv</strong> or click to choose</>} hint="Files are read in this browser only." icon="🗂️" />
    </Card>
  );
}

/* ----------------------------- review table ----------------------------- */

function ProjectReview({ state, setState, onSave, onCancel, keepNumbers, existing }: { state: ReviewState; setState: (s: ReviewState | null) => void; onSave: (rows: ReviewProject[]) => void; onCancel: () => void; keepNumbers: boolean; existing: ProjectMapping[] }) {
  const [filter, setFilter] = useState<"all" | "review">("all");
  const rows = state.rows;
  const set = (rows: ReviewProject[]) => setState({ ...state, rows });
  const upd = (key: string, patch: Partial<ReviewProject>) => set(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const verified = rows.filter((r) => rowStatus(r) === "verified");
  const needReview = rows.length - verified.length;
  const tasks = rows.reduce((a, r) => a + r.tasks.length, 0);
  const approved = rows.filter((r) => r.approved);
  const shown = filter === "all" ? rows : rows.filter((r) => rowStatus(r) === "review");
  const existingCodes = new Set(existing.map((p) => p.code.toLowerCase()));
  const dupCodes = new Set(rows.map((r) => r.code.toLowerCase()).filter((c, i, a) => c && a.indexOf(c) !== i));
  const [raw, setRaw] = useState(state.rawText.map((r) => `${r.text}`).join("\n\n"));

  const addTask = (key: string, task: ParsedTask) => set(rows.map((r) => (r.key === key && !r.tasks.some((t) => t.name.toLowerCase() === task.name.toLowerCase()) ? { ...r, tasks: [...r.tasks, task] } : r)));

  return (
    <div className="stack">
      <Notice tone={needReview ? "warning" : "success"} title={`Detected ${rows.length} project${rows.length === 1 ? "" : "s"} and ${tasks} task${tasks === 1 ? "" : "s"}.`}>
        {needReview ? `${needReview} ${needReview === 1 ? "entry needs" : "entries need"} review` : "Everything was read cleanly"}
        {state.orphans.length ? ` · ${state.orphans.length} task${state.orphans.length === 1 ? "" : "s"} without a project` : ""}
        {state.loose.length ? ` · ${state.loose.length} unrecognised line${state.loose.length === 1 ? "" : "s"}` : ""}. Nothing is saved until you click Save.
      </Notice>

      <div className="toolbar">
        <div className="segmented small" role="tablist" aria-label="Filter detected projects">
          <button role="tab" aria-selected={filter === "all"} className={`segment ${filter === "all" ? "is-active" : ""}`} onClick={() => setFilter("all")}>All ({rows.length})</button>
          <button role="tab" aria-selected={filter === "review"} className={`segment ${filter === "review" ? "is-active" : ""}`} onClick={() => setFilter("review")}>Review uncertain ({needReview})</button>
        </div>
        <div className="row wrap gap-sm">
          <Button size="sm" disabled={!verified.length} onClick={() => set(rows.map((r) => (rowStatus(r) === "verified" ? { ...r, approved: true } : r)))}>Approve all verified ({verified.length})</Button>
          <Button size="sm" variant="ghost" onClick={() => set([...rows, { key: uid(), code: "", codeStatus: "missing", fullName: "", client: "", internal: false, tasks: [], pages: ["added by you"], raw: "", issues: [], approved: false }])}>+ Add project</Button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="verify-table">
          <thead>
            <tr>
              <th className="col-inc">Approve</th>
              <th>Client</th>
              <th>Full project name</th>
              <th>Project code</th>
              <th>Tasks</th>
              <th>Type</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const status = rowStatus(r);
              const problems = rowProblems(r);
              const dup = r.code && dupCodes.has(r.code.toLowerCase());
              return (
                <tr key={r.key} className={status === "review" ? "is-review" : ""}>
                  <td className="col-inc" data-label="Approve">
                    <input type="checkbox" checked={r.approved} disabled={!r.client.trim() || !r.code.trim()} aria-label={`Approve ${r.client || "project"}`} onChange={(e) => upd(r.key, { approved: e.target.checked })} />
                  </td>
                  <td data-label="Client">
                    <input value={r.client} aria-label="Client" className={!r.client.trim() ? "has-error" : ""} onChange={(e) => upd(r.key, { client: e.target.value, clientUncertain: undefined })} />
                    {r.clientUncertain && <div className="row-note text-warning">⚠ {r.clientUncertain}</div>}
                  </td>
                  <td data-label="Full project name">
                    <input value={r.fullName} aria-label="Full project name" onChange={(e) => upd(r.key, { fullName: e.target.value })} />
                    <div className="row-note muted">from {r.pages.join(", ")}</div>
                  </td>
                  <td data-label="Project code">
                    <input value={r.code} aria-label="Project code" className={`mono ${r.codeStatus !== "valid" ? "has-warning" : ""}`} onChange={(e) => {
                      const v = e.target.value.trim();
                      upd(r.key, { code: v, codeStatus: isValidCode(v) ? "valid" : v ? "ambiguous" : "missing", codeSuggestion: undefined, codeIssue: isValidCode(v) ? undefined : "Not in the P000000-000 format — check it." });
                    }} />
                    {r.codeStatus === "ambiguous" && r.codeIssue && <div className="row-note text-warning">⚠ {r.codeIssue}</div>}
                    {r.codeStatus === "missing" && <div className="row-note text-warning">⚠ Code not found — type it from Projector.</div>}
                    {r.codeSuggestion && (
                      <button className="link small" onClick={() => upd(r.key, { code: r.codeSuggestion!, codeStatus: "valid", codeSuggestion: undefined, codeIssue: undefined })}>
                        Use {r.codeSuggestion} (I checked it)
                      </button>
                    )}
                    {r.code && existingCodes.has(r.code.toLowerCase()) && <div className="row-note muted">Already saved — tasks will be combined.</div>}
                    {dup && <div className="row-note text-error">Duplicate code in this list</div>}
                  </td>
                  <td data-label="Tasks">
                    <TaskEditor tasks={r.tasks} keepNumbers={keepNumbers} onChange={(tasks) => upd(r.key, { tasks })} />
                  </td>
                  <td data-label="Type">
                    <select value={r.internal ? "internal" : "billable"} aria-label="Billable or internal" onChange={(e) => upd(r.key, { internal: e.target.value === "internal" })}>
                      <option value="billable">Billable</option>
                      <option value="internal">Internal</option>
                    </select>
                  </td>
                  <td data-label="Status">
                    {status === "verified" ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Review</Badge>}
                    {r.approved && <div className="row-note text-success">✓ approved</div>}
                    {problems.length > 0 && (
                      <ul className="tight small text-warning">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                    )}
                    {r.issues.filter((i) => i.startsWith("Probably") || i.startsWith("Seen with")).map((i) => <div key={i} className="row-note text-warning">⚠ {i}</div>)}
                  </td>
                  <td className="col-act">
                    <button className="icon-btn" title={dup ? "Remove duplicate" : "Remove"} aria-label={dup ? `Remove duplicate ${r.client}` : `Remove ${r.client}`} onClick={() => set(rows.filter((x) => x.key !== r.key))}>🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {state.orphans.length > 0 && (
        <Card title="Tasks without a project" subtitle="These appeared above the first project in a screenshot, so their project isn't visible. Nothing is assigned until you choose.">
          <ul className="resolve-list">
            {state.orphans.map((o, i) => {
              const likely = rows.find((r) => r.key === o.likelyProjectKey);
              const dismiss = () => setState({ ...state, orphans: state.orphans.filter((_, j) => j !== i) });
              return (
                <li key={i}>
                  <div><strong>{o.task.name}</strong> <span className="muted small">— {o.reason}</span></div>
                  <div className="row wrap gap-sm">
                    {likely && <Button size="sm" onClick={() => { addTask(likely.key, o.task); dismiss(); }}>Add to {likely.client}</Button>}
                    <AssignSelect rows={rows} onPick={(key) => { addTask(key, o.task); dismiss(); }} />
                    <Button size="sm" variant="ghost" onClick={dismiss}>Ignore</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {state.loose.length > 0 && (
        <details className="help card-like">
          <summary>{state.loose.length} line{state.loose.length === 1 ? "" : "s"} weren&apos;t recognised as a project or task</summary>
          <ul className="resolve-list mt">
            {state.loose.map((l, i) => {
              const under = rows.find((r) => r.key === l.projectKey);
              const dismiss = () => setState({ ...state, loose: state.loose.filter((_, j) => j !== i) });
              return (
                <li key={i}>
                  <div><code>{l.text}</code> <span className="muted small">({l.page}{under ? `, under ${under.client}` : ""})</span></div>
                  <div className="row wrap gap-sm">
                    {under && <Button size="sm" onClick={() => { addTask(under.key, { name: l.text.trim(), raw: l.text }); dismiss(); }}>Add as {under.client} task</Button>}
                    <AssignSelect rows={rows} label="Add as task to…" onPick={(key) => { addTask(key, { name: l.text.trim(), raw: l.text }); dismiss(); }} />
                    <Button size="sm" variant="ghost" onClick={dismiss}>Ignore</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {state.rawText.length > 0 && (
        <details className="help card-like">
          <summary>Show recognised text (for troubleshooting)</summary>
          <p className="small muted mt">This is exactly what the text recognition read. You can correct it here and detect again.</p>
          <textarea className="paste-area mono" rows={10} value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} aria-label="Recognised text" />
          <Button size="sm" className="mt" onClick={() => {
            const r = parseProjectorText(raw, { keepTaskNumbers: keepNumbers });
            setState({ ...state, rows: r.projects.map((p) => ({ ...p, approved: false })), orphans: r.orphanTasks, loose: r.looseLines });
          }}>Detect again from this text</Button>
        </details>
      )}

      <div className="row wrap space-between gap">
        <Button variant="ghost" onClick={() => window.confirm("Discard these detected projects?") && onCancel()}>Discard</Button>
        <div className="row gap-sm align-center">
          {approved.length < rows.length && <span className="muted small">{rows.length - approved.length} not approved (won&apos;t be saved)</span>}
          <Button variant="primary" disabled={!approved.length} onClick={() => onSave(rows)}>Save {approved.length} project{approved.length === 1 ? "" : "s"}</Button>
        </div>
      </div>
    </div>
  );
}

function AssignSelect({ rows, onPick, label = "Add to another project…" }: { rows: ReviewProject[]; onPick: (key: string) => void; label?: string }) {
  return (
    <select className="select-sm" value="" aria-label={label} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">{label}</option>
      {rows.map((r) => <option key={r.key} value={r.key}>{r.client || r.fullName || r.code}</option>)}
    </select>
  );
}

function TaskEditor({ tasks, onChange, keepNumbers }: { tasks: ParsedTask[]; onChange: (t: ParsedTask[]) => void; keepNumbers: boolean }) {
  const [adding, setAdding] = useState("");
  const add = () => {
    const v = adding.trim();
    if (v && !tasks.some((t) => t.name.toLowerCase() === v.toLowerCase())) onChange([...tasks, { name: v, raw: v }]);
    setAdding("");
  };
  return (
    <div>
      <div className="chips">
        {tasks.map((t, i) => (
          <span key={`${t.name}-${i}`} className={`chip chip-edit ${t.uncertain ? "chip-warn" : ""}`} title={t.uncertain ?? (t.number ? `Shown in Projector as “${t.number} ${t.name}”` : undefined)}>
            <input
              value={t.name}
              aria-label="Task name"
              size={Math.max(6, t.name.length)}
              onChange={(e) => onChange(tasks.map((x, j) => (j === i ? { ...x, name: e.target.value, uncertain: undefined } : x)))}
            />
            {t.uncertain && <span aria-hidden>⚠</span>}
            <button aria-label={`Remove task ${t.name}`} onClick={() => onChange(tasks.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
      </div>
      {tasks.some((t) => t.uncertain) && <div className="row-note text-warning">⚠ {tasks.find((t) => t.uncertain)!.uncertain}</div>}
      <div className="row gap-sm mt-xs">
        <input className="input-sm" value={adding} placeholder={keepNumbers ? "Add task (e.g. 2 Planning)" : "Add missing task"} aria-label="Add missing task" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button size="sm" variant="ghost" disabled={!adding.trim()} onClick={add}>Add</Button>
      </div>
    </div>
  );
}
