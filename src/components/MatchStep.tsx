"use client";
import { useMemo, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Notice } from "./ui";
import type { MatchRule, ProjectMapping, TimeEntry } from "@/lib/types";
import { ruleKey, unknownClientHint } from "@/lib/matching";
import { formatDecimalHours, prettyDate } from "@/lib/time";
import { parseProjectorPages, parseProjectorText, type ParsedProject } from "@/lib/projector/parse";
import { isValidCode } from "@/lib/projector/codes";
import { mergeProjects } from "@/lib/projectsCsv";
import { ocrImages } from "@/lib/ocr/ocr";
import { uid } from "@/lib/uid";

interface Group {
  key: string;
  kind: "unmatched" | "task" | "confirm";
  title: string;
  hint: string;
  entries: TimeEntry[];
  projectId?: string;
  suggestion?: TimeEntry["suggestion"];
  candidates?: string[];
}

export function upsertRules(rules: MatchRule[], entries: TimeEntry[]): MatchRule[] {
  const out = [...rules];
  for (const e of entries) {
    if (!e.projectId || !e.task) continue;
    const key = ruleKey(e.title);
    if (!key) continue;
    const i = out.findIndex((r) => r.key === key);
    const rule: MatchRule = { id: i >= 0 ? out[i].id : uid(), key, example: e.title, projectId: e.projectId, task: e.task, createdAt: new Date().toISOString() };
    if (i >= 0) out[i] = rule;
    else out.push(rule);
  }
  return out;
}

const resolvedNote = (e: TimeEntry, msg: string): TimeEntry => ({
  ...e,
  notes: [...e.notes.filter((n) => !["no-project", "ambiguous-project", "task-unclear", "convention-task-unmatched", "fuzzy-suggestion", "domain-match", "unknown-client"].includes(n.code)), { code: "info", level: "info", message: msg }],
  candidates: undefined,
  suggestion: undefined,
});

export function MatchStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { entries, setEntries, projects, setProjects, rules, setRules } = useStore();
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const included = entries.filter((e) => e.included);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const e of included) {
      const needsConfirm = e.projectId && e.task && e.notes.some((n) => n.code === "domain-match");
      const kind: Group["kind"] | null = !e.projectId ? "unmatched" : !e.task ? "task" : needsConfirm ? "confirm" : null;
      if (!kind) continue;
      const key = `${kind}|${ruleKey(e.title)}|${e.projectId ?? ""}`;
      const g = map.get(key) ?? { key, kind, title: e.title, hint: unknownClientHint(e.title, e.domains), entries: [], projectId: e.projectId ?? undefined, suggestion: e.suggestion, candidates: e.candidates };
      g.entries.push(e);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.entries.length - a.entries.length);
  }, [included]);

  const autoMatched = included.filter((e) => e.projectId && e.task && !groups.some((g) => g.entries.includes(e)));
  const excluded = entries.filter((e) => !e.included);
  const remembered = included.filter((e) => e.notes.some((n) => n.code === "remembered")).length;

  function apply(g: Group, projectId: string, task: string, remember: boolean, how: string) {
    const ids = new Set(g.entries.map((e) => e.id));
    const updated = entries.map((e) => (ids.has(e.id) ? resolvedNote({ ...e, projectId, task }, how) : e));
    setEntries(updated);
    if (remember && task) setRules(upsertRules(rules, updated.filter((e) => ids.has(e.id))));
  }
  function exclude(g: Group) {
    const ids = new Set(g.entries.map((e) => e.id));
    setEntries(entries.map((e) => (ids.has(e.id) ? { ...e, included: false, excludeReason: "Excluded by you (not project work)" } : e)));
  }

  if (entries.length === 0) {
    return (
      <Card title="Nothing to match yet">
        <p className="muted">Import your calendar first.</p>
        <Button variant="primary" onClick={onBack}>← Import calendar</Button>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="summary-grid">
        <div className="stat stat-ok"><span className="stat-label">Matched</span><span className="stat-value">{autoMatched.length}</span><span className="stat-sub">{remembered ? `${remembered} from remembered matches` : "automatically"}</span></div>
        <div className={`stat ${groups.length ? "stat-alert" : "stat-ok"}`}><span className="stat-label">Need you</span><span className="stat-value">{groups.reduce((a, g) => a + g.entries.length, 0)}</span><span className="stat-sub">{groups.length} group{groups.length === 1 ? "" : "s"} below</span></div>
        <div className="stat"><span className="stat-label">Excluded</span><span className="stat-value">{excluded.length}</span><span className="stat-sub">canceled, all-day, free, personal</span></div>
        <div className="stat"><span className="stat-label">Proposed hours</span><span className="stat-value">{formatDecimalHours(included.reduce((a, e) => a + e.minutes, 0))}</span><span className="stat-sub">before your review</span></div>
      </div>

      {groups.length === 0 ? (
        <Notice tone="success" title="Every included event has a project and task">Next, check the hours you actually worked.</Notice>
      ) : (
        <Notice tone="info" title="Match the remaining work">
          Each card groups events with the same title. Pick the project once — tick “Remember” and it&apos;s matched automatically next week. Nothing is assigned without you.
        </Notice>
      )}

      {groups.map((g) => (
        <GroupCard key={g.key} g={g} projects={projects} byId={byId} onApply={apply} onExclude={exclude} onAddProjects={(ps) => {
          const m = mergeProjects(projects, ps);
          setProjects(m.projects);
          return m.projects;
        }} />
      ))}

      {autoMatched.length > 0 && (
        <details className="help card-like">
          <summary>{autoMatched.length} event{autoMatched.length === 1 ? "" : "s"} matched automatically</summary>
          <ul className="tight small mt">
            {autoMatched.map((e) => (
              <li key={e.id}>{prettyDate(e.date)} · {e.title} → <strong>{byId.get(e.projectId!)?.client}</strong> / {e.task}{e.notes.some((n) => n.code === "remembered") ? " (remembered)" : ""}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="row space-between wrap gap">
        <Button onClick={onBack}>← Import more</Button>
        <Button variant="primary" onClick={onNext}>{groups.length ? `Review hours (${groups.length} unmatched) →` : "Review hours →"}</Button>
      </div>
    </div>
  );
}

function GroupCard({ g, projects, byId, onApply, onExclude, onAddProjects }: { g: Group; projects: ProjectMapping[]; byId: Map<string, ProjectMapping>; onApply: (g: Group, projectId: string, task: string, remember: boolean, how: string) => void; onExclude: (g: Group) => void; onAddProjects: (p: ProjectMapping[]) => ProjectMapping[] }) {
  const initialProject = g.projectId ?? g.suggestion?.projectId ?? (g.candidates?.length === 1 ? g.candidates[0] : "");
  const [mode, setMode] = useState<"match" | "new" | "paste" | "shot">("match");
  const [projectId, setProjectId] = useState(initialProject);
  const project = projectId ? byId.get(projectId) : undefined;
  const [task, setTask] = useState(project && project.tasks.length === 1 ? project.tasks[0] : project?.defaultTask ?? "");
  const [remember, setRemember] = useState(true);
  const hours = g.entries.reduce((a, e) => a + e.minutes, 0);
  const candidates = (g.candidates ?? []).map((id) => byId.get(id)).filter(Boolean) as ProjectMapping[];
  const title =
    g.kind === "unmatched" ? (candidates.length > 1 ? "Which project is this?" : g.title.includes("|") || g.entries[0].domains?.length ? <>Unrecognized project: <span className="hint">{g.hint}</span></> : <>No project found for: <span className="hint">{g.hint}</span></>) : g.kind === "task" ? <>Choose a task for <span className="hint">{byId.get(g.projectId!)?.client}</span></> : <>Confirm: <span className="hint">{byId.get(g.projectId!)?.client}</span>?</>;

  const pick = (id: string) => {
    setProjectId(id);
    const p = byId.get(id);
    setTask(p ? (p.tasks.length === 1 ? p.tasks[0] : p.defaultTask || "") : "");
  };
  const afterAdd = (saved: ProjectMapping[], code: string) => {
    const p = saved.find((x) => x.code.toLowerCase() === code.toLowerCase());
    if (p) {
      setMode("match");
      setProjectId(p.id);
      setTask(p.tasks.length === 1 ? p.tasks[0] : p.defaultTask || "");
    }
  };

  return (
    <Card className="group-card" title={title} subtitle={`${g.entries.length} event${g.entries.length === 1 ? "" : "s"} · ${formatDecimalHours(hours)} h proposed`}>
      <ul className="group-events">
        {g.entries.slice(0, 6).map((e) => (
          <li key={e.id}>
            <span className="muted">{prettyDate(e.date)}{e.intervals[0] ? ` ${e.intervals[0].start}–${e.intervals[0].end}` : ""}</span> <span>{e.title}</span>
          </li>
        ))}
        {g.entries.length > 6 && <li className="muted">…and {g.entries.length - 6} more</li>}
      </ul>
      {g.suggestion && byId.get(g.suggestion.projectId) && <p className="small text-warning">Suggestion: {byId.get(g.suggestion.projectId)!.client} — {g.suggestion.reason}. Not applied until you confirm.</p>}
      {g.kind === "confirm" && <p className="small text-warning">{g.entries[0].notes.find((n) => n.code === "domain-match")?.message}</p>}
      {candidates.length > 1 && (
        <div className="row wrap gap-sm">
          {candidates.map((c) => <Button key={c.id} size="sm" variant={projectId === c.id ? "primary" : "secondary"} onClick={() => pick(c.id)}>{c.client}</Button>)}
        </div>
      )}

      {g.kind === "unmatched" && (
        <div className="segmented small mt" role="tablist" aria-label="How to resolve">
          {(
            [
              ["match", "Match existing project"],
              ["new", "Add new project"],
              ["paste", "Paste Projector details"],
              ["shot", "Upload Projector screenshot"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mode === id} className={`segment ${mode === id ? "is-active" : ""}`} onClick={() => setMode(id)}>{label}</button>
          ))}
        </div>
      )}

      {mode === "match" && (
        <div className="match-row mt">
          <label className="field">
            <span>Project</span>
            <select value={projectId} onChange={(e) => pick(e.target.value)}>
              <option value="">Choose…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.client} — {p.code}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Task</span>
            <select value={task} disabled={!project} onChange={(e) => setTask(e.target.value)}>
              <option value="">Choose…</option>
              {project?.tasks.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="check align-self-end">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Remember for future weeks</span>
          </label>
          <div className="row gap-sm align-self-end">
            <Button variant="primary" disabled={!project || !task} onClick={() => onApply(g, projectId, task, remember, g.kind === "confirm" ? "Confirmed by you." : "Matched by you.")}>{g.kind === "confirm" ? "Confirm" : `Apply to ${g.entries.length}`}</Button>
          </div>
        </div>
      )}
      {mode === "new" && <NewProjectForm defaultClient={g.hint} onSave={(p) => afterAdd(onAddProjects([p]), p.code)} />}
      {(mode === "paste" || mode === "shot") && <QuickProjector mode={mode} onAdd={(ps) => afterAdd(onAddProjects(ps), ps[0].code)} />}

      <div className="row gap-sm mt">
        <Button size="sm" variant="ghost" onClick={() => onExclude(g)}>Exclude {g.entries.length === 1 ? "event" : `${g.entries.length} events`} (not project work)</Button>
      </div>
    </Card>
  );
}

function NewProjectForm({ defaultClient, onSave }: { defaultClient: string; onSave: (p: ProjectMapping) => void }) {
  const [client, setClient] = useState(defaultClient.includes("@") || defaultClient.includes(".") ? "" : defaultClient);
  const [code, setCode] = useState("");
  const [tasks, setTasks] = useState("");
  const [billable, setBillable] = useState(true);
  const list = [...new Set(tasks.split(/[;\n,]/).map((t) => t.trim()).filter(Boolean))];
  return (
    <div className="editor mt">
      <div className="editor-grid">
        <label className="field"><span>Client name</span><input value={client} onChange={(e) => setClient(e.target.value)} /></label>
        <label className="field"><span>Project code (from Projector)</span><input className="mono" value={code} placeholder="P000000-000" onChange={(e) => setCode(e.target.value.trim())} /></label>
        <label className="field span-2"><span>Tasks (separate with ; or new lines, without Projector&apos;s numbers)</span><input value={tasks} onChange={(e) => setTasks(e.target.value)} placeholder="Planning; Support" /></label>
        <label className="check"><input type="checkbox" checked={!billable} onChange={(e) => setBillable(!e.target.checked)} /><span>Internal / non-billable</span></label>
      </div>
      {code && !isValidCode(code) && <p className="small text-warning">“{code}” isn&apos;t in the usual P000000-000 format — double-check it in Projector.</p>}
      <Button variant="primary" className="mt" disabled={!client.trim() || !code || !list.length} onClick={() => onSave({ id: uid(), client: client.trim(), code, tasks: list, aliases: [], defaultTask: list.length === 1 ? list[0] : "", billable, source: "manual" })}>Save project</Button>
    </div>
  );
}

function QuickProjector({ mode, onAdd }: { mode: "paste" | "shot"; onAdd: (p: ProjectMapping[]) => void }) {
  const { settings } = useStore();
  const [text, setText] = useState("");
  const [found, setFound] = useState<ParsedProject[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = (found ?? []).filter((p) => p.codeStatus === "valid");
  async function scan(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy("Reading screenshot on this device…");
    try {
      const pages = await ocrImages(Array.from(files), { mode: "list", onProgress: (p) => setBusy(`${p.status} ${Math.round(p.progress * 100)}%`) });
      setFound(parseProjectorPages(pages.map((p) => ({ label: p.label, width: p.width, lines: p.lines })), { keepTaskNumbers: settings.keepTaskNumbers }).projects);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="editor mt">
      {mode === "paste" ? (
        <>
          <textarea className="paste-area" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the project row and its tasks from Projector" aria-label="Projector text" />
          <Button size="sm" className="mt" disabled={!text.trim()} onClick={() => setFound(parseProjectorText(text, { keepTaskNumbers: settings.keepTaskNumbers }).projects)}>Detect</Button>
        </>
      ) : (
        <label className="field">
          <span>Projector screenshot (read on this device)</span>
          <input type="file" accept="image/*" onChange={(e) => scan(e.target.files)} />
        </label>
      )}
      {busy && <p className="small muted" role="status">{busy}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {found && (
        <div className="mt">
          {found.length === 0 && <p className="small text-warning">No projects detected.</p>}
          <ul className="resolve-list">
            {found.map((p) => (
              <li key={p.key}>
                <div><strong>{p.client}</strong> <code>{p.code || "no code"}</code> <span className="small muted">{p.tasks.map((t) => t.name).join(", ") || "no tasks"}</span>
                  {p.codeStatus !== "valid" && <Badge tone="warning">check code</Badge>}
                </div>
                <Button size="sm" disabled={p.codeStatus !== "valid" || !p.tasks.length} onClick={() => onAdd([{ id: uid(), client: p.client, code: p.code, tasks: p.tasks.map((t) => t.name), aliases: [], defaultTask: p.tasks.length === 1 ? p.tasks[0].name : "", billable: !p.internal, fullName: p.fullName, source: mode === "paste" ? "paste" : "screenshot" }])}>Save & use</Button>
              </li>
            ))}
          </ul>
          {found.length > 0 && valid.length < found.length && <p className="small muted">Projects with an unclear code or no tasks can be fixed on the Projects page.</p>}
        </div>
      )}
    </div>
  );
}
