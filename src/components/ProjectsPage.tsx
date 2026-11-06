"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Dropzone, Notice, downloadBytes, readText } from "./ui";
import type { ProjectMapping, Settings } from "@/lib/types";
import { mergeProjects, parseProjectsCsv, projectsToCsv, validateProject } from "@/lib/projectsCsv";
import { stripTaskPrefix } from "@/lib/matching";
import { makeBackup, parseBackup, saveAccessCode, loadAccessCode } from "@/lib/storage";
import { extractProjectsFromScreenshot, fetchAiStatus, type AiStatus, type ExtractedProject } from "@/lib/aiClient";
import { isValidTimeZone } from "@/lib/time";
import { uid } from "@/lib/uid";

const TEMPLATE = `Client,Aliases,Project Code,Tasks,Default Task,Type
Acme Corp,Acme; ACME Inc,P000123-001,Planning; Support,,Billable
Globex,,P000456-001,Consultant,Consultant,Billable
Our Firm (internal),Internal; Team,P000999-001,Internal - Meeting; Internal - Training,Internal - Meeting,Internal
`;

const blank = (): ProjectMapping => ({ id: uid(), client: "", aliases: [], code: "", tasks: [], defaultTask: "", billable: true });

export function ProjectsPage() {
  const { projects, setProjects, settings, setSettings } = useStore();
  const [editing, setEditing] = useState<ProjectMapping | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "warning"; text: string } | null>(null);
  const [strip, setStrip] = useState(true);

  async function importCsv(files: File[]) {
    setMsg(null);
    try {
      const text = await readText(files[0]);
      if (/^\s*\{/.test(text)) {
        const b = parseBackup(text);
        setProjects(b.projects);
        setSettings(b.settings);
        setMsg({ tone: "success", text: `Restored ${b.projects.length} projects and your settings from backup.` });
        return;
      }
      const r = parseProjectsCsv(text, { stripNumericPrefixes: strip });
      const m = mergeProjects(projects, r.projects);
      setProjects(m.projects);
      setMsg({ tone: r.warnings.length ? "warning" : "success", text: `Imported ${r.projects.length} projects (${m.added} added, ${m.updated} updated).${r.warnings.length ? " " + r.warnings.join(" ") : ""}` });
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Projects &amp; tasks</h1>
          <p className="muted">Your BigTime assignments. Stored only in this browser — other people using this site never see them.</p>
        </div>
      </div>

      <SettingsCard settings={settings} setSettings={setSettings} />

      <Card
        title={`Your projects (${projects.length})`}
        subtitle="Calendar events are matched by client name, aliases or project code. Task names must match BigTime exactly — without the sequence numbers BigTime shows in front of them."
        actions={<Button variant="primary" onClick={() => setEditing(blank())}>+ Add project</Button>}
      >
        {editing && !projects.some((p) => p.id === editing.id) && (
          <ProjectEditor key={editing.id} value={editing} all={projects} onCancel={() => setEditing(null)} onSave={(p) => { setProjects([...projects, p]); setEditing(null); }} />
        )}
        {projects.length === 0 && !editing ? (
          <div className="empty">
            <p>No projects yet. Add them one at a time, or import a CSV below.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Project code</th>
                  <th>Tasks</th>
                  <th>Type</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) =>
                  editing?.id === p.id ? (
                    <tr key={p.id}>
                      <td colSpan={5}>
                        <ProjectEditor value={editing} all={projects} onCancel={() => setEditing(null)} onSave={(np) => { setProjects(projects.map((x) => (x.id === np.id ? np : x))); setEditing(null); }} />
                      </td>
                    </tr>
                  ) : (
                    <ProjectRow key={p.id} p={p} all={projects} onEdit={() => setEditing(p)} onDelete={() => window.confirm(`Delete ${p.client} (${p.code})?`) && setProjects(projects.filter((x) => x.id !== p.id))} />
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Import or back up your mapping" subtitle="CSV columns: Client, Aliases, Project Code, Tasks, Default Task, Type. Separate multiple aliases or tasks with semicolons.">
        <Dropzone accept=".csv,.json,text/csv,application/json" onFiles={importCsv} label={<><strong>Drop a projects CSV</strong> (or a backup .json) here</>} hint="Rows with the same client and project code update existing entries." icon="🗂️" />
        <label className="check mt">
          <input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} />
          <span>Remove leading numbers from task names (e.g. “2 Planning” → “Planning”). BigTime&apos;s import rejects the numbered form.</span>
        </label>
        <div className="row wrap gap-sm mt">
          <Button size="sm" onClick={() => downloadBytes(TEMPLATE, "projects-template.csv", "text/csv;charset=utf-8")}>Download template</Button>
          <Button size="sm" disabled={!projects.length} onClick={() => downloadBytes(projectsToCsv(projects), "my-bigtime-projects.csv", "text/csv;charset=utf-8")}>Export projects CSV</Button>
          <Button size="sm" onClick={() => downloadBytes(JSON.stringify(makeBackup(projects, settings), null, 2), "timesheet-converter-backup.json", "application/json")}>Back up projects + settings</Button>
          <Button size="sm" variant="danger" disabled={!projects.length} onClick={() => window.confirm("Delete all projects from this browser?") && setProjects([])}>Delete all</Button>
        </div>
        {msg && <div className="mt"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      </Card>

      <ProjectScreenshotCard onAdd={(ps) => {
        const m = mergeProjects(projects, ps);
        setProjects(m.projects);
        setMsg({ tone: "success", text: `Added ${m.added} and updated ${m.updated} projects from the screenshot. Review the tasks below.` });
      }} />
    </div>
  );
}

function ProjectRow({ p, all, onEdit, onDelete }: { p: ProjectMapping; all: ProjectMapping[]; onEdit: () => void; onDelete: () => void }) {
  const v = validateProject(p, all);
  return (
    <tr>
      <td data-label="Client">
        <strong>{p.client}</strong>
        {p.aliases.length > 0 && <div className="muted small">also: {p.aliases.join(", ")}</div>}
        {[...v.errors, ...v.warnings].map((w, i) => (
          <div key={i} className={`small ${v.errors.includes(w) ? "text-error" : "text-warning"}`}>⚠ {w}</div>
        ))}
      </td>
      <td data-label="Project code"><code>{p.code}</code></td>
      <td data-label="Tasks">
        <div className="chips">
          {p.tasks.map((t) => (
            <span key={t} className={`chip ${t === p.defaultTask ? "chip-default" : ""}`} title={t === p.defaultTask ? "Default task" : undefined}>{t}{t === p.defaultTask ? " ★" : ""}</span>
          ))}
          {p.tasks.length === 0 && <Badge tone="warning">no tasks</Badge>}
        </div>
      </td>
      <td data-label="Type">{p.billable ? <Badge tone="success">Billable</Badge> : <Badge>Internal</Badge>}</td>
      <td className="col-act">
        <div className="row gap-sm">
          <Button size="sm" onClick={onEdit}>Edit</Button>
          <button className="icon-btn" aria-label={`Delete ${p.client}`} onClick={onDelete}>🗑</button>
        </div>
      </td>
    </tr>
  );
}

function ProjectEditor({ value, all, onSave, onCancel }: { value: ProjectMapping; all: ProjectMapping[]; onSave: (p: ProjectMapping) => void; onCancel: () => void }) {
  const [client, setClient] = useState(value.client);
  const [aliases, setAliases] = useState(value.aliases.join("; "));
  const [code, setCode] = useState(value.code);
  const [tasks, setTasks] = useState(value.tasks.join("\n"));
  const [defaultTask, setDefaultTask] = useState(value.defaultTask);
  const [billable, setBillable] = useState(value.billable);
  const taskList = [...new Set(tasks.split(/\n|;/).map((t) => t.trim()).filter(Boolean))];
  const draft: ProjectMapping = { id: value.id, client: client.trim(), aliases: aliases.split(/;|\n/).map((a) => a.trim()).filter(Boolean), code: code.trim(), tasks: taskList, defaultTask: taskList.includes(defaultTask) ? defaultTask : "", billable };
  const v = validateProject(draft, all);
  const numbered = taskList.some((t) => stripTaskPrefix(t) !== t);
  return (
    <div className="editor">
      <div className="editor-grid">
        <label className="field">
          <span>Client name</span>
          <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Acme Corp" autoFocus />
        </label>
        <label className="field">
          <span>BigTime project code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. P000123-001" />
        </label>
        <label className="field span-2">
          <span>Aliases (separate with ;)</span>
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Short names used in meeting titles, e.g. ACME; Acme Inc" />
        </label>
        <label className="field">
          <span>Tasks (one per line, exactly as BigTime names them)</span>
          <textarea rows={4} value={tasks} onChange={(e) => setTasks(e.target.value)} placeholder={"Planning\nSupport"} />
          {numbered && (
            <button type="button" className="link small" onClick={() => setTasks(taskList.map(stripTaskPrefix).join("\n"))}>Remove leading numbers</button>
          )}
        </label>
        <div className="stack-sm">
          <label className="field">
            <span>Default task (used when a meeting doesn&apos;t name one)</span>
            <select value={draft.defaultTask} onChange={(e) => setDefaultTask(e.target.value)}>
              <option value="">{taskList.length === 1 ? "Only task (automatic)" : "None — ask me"}</option>
              {taskList.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <fieldset className="field">
            <span>Type</span>
            <div className="row gap">
              <label className="check"><input type="radio" checked={billable} onChange={() => setBillable(true)} /> <span>Billable client project</span></label>
              <label className="check"><input type="radio" checked={!billable} onChange={() => setBillable(false)} /> <span>Internal / non-billable</span></label>
            </div>
          </fieldset>
        </div>
      </div>
      {[...v.errors, ...v.warnings].length > 0 && (
        <ul className="tight small">
          {v.errors.map((x) => <li key={x} className="text-error">{x}</li>)}
          {v.warnings.map((x) => <li key={x} className="text-warning">{x}</li>)}
        </ul>
      )}
      <div className="row gap-sm mt">
        <Button variant="primary" disabled={v.errors.length > 0} onClick={() => onSave(draft)}>Save project</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function SettingsCard({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      return [];
    }
  }, []);
  const [kw, setKw] = useState(settings.exclusionKeywords.join(", "));
  const [tz, setTz] = useState(settings.timeZone);
  useEffect(() => setTz(settings.timeZone), [settings.timeZone]);
  return (
    <Card title="Timesheet settings" subtitle="Applied to new imports. Location must match a value in your BigTime Location list exactly.">
      <div className="editor-grid">
        <label className="field">
          <span>Default BigTime location</span>
          <input value={settings.defaultLocation} onChange={(e) => setSettings({ ...settings, defaultLocation: e.target.value })} placeholder="Exactly as shown in BigTime" />
        </label>
        <label className="field">
          <span>Time zone for work dates</span>
          <input list="tz-list" value={tz} onChange={(e) => {
            setTz(e.target.value);
            if (isValidTimeZone(e.target.value)) setSettings({ ...settings, timeZone: e.target.value });
          }} className={isValidTimeZone(tz) ? "" : "has-error"} />
          <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
        </label>
        <label className="check span-2">
          <input type="checkbox" checked={settings.locationRequired} onChange={(e) => setSettings({ ...settings, locationRequired: e.target.checked })} />
          <span>Location is required by my BigTime setup (block export when missing)</span>
        </label>
        <label className="field span-2">
          <span>Exclude events whose title contains (comma-separated)</span>
          <input value={kw} onChange={(e) => setKw(e.target.value)} onBlur={() => setSettings({ ...settings, exclusionKeywords: kw.split(",").map((k) => k.trim()).filter(Boolean) })} />
        </label>
        <label className="field">
          <span>Outlook CSV date order</span>
          <select value={settings.csvDateOrder} onChange={(e) => setSettings({ ...settings, csvDateOrder: e.target.value as Settings["csvDateOrder"] })}>
            <option value="MDY">Month/Day/Year (US)</option>
            <option value="DMY">Day/Month/Year</option>
            <option value="YMD">Year-Month-Day</option>
          </select>
        </label>
      </div>
    </Card>
  );
}

function ProjectScreenshotCard({ onAdd }: { onAdd: (p: ProjectMapping[]) => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<(ExtractedProject & { pick: boolean })[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [strip, setStrip] = useState(true);
  const [code, setCode] = useState("");
  useEffect(() => {
    fetchAiStatus().then(setStatus);
    setCode(loadAccessCode());
  }, []);

  async function run(files: File[]) {
    setError(null);
    if (!consent) return setError("Tick the consent box first.");
    if (status?.accessCodeRequired) saveAccessCode(code.trim());
    setBusy(true);
    try {
      const all: ExtractedProject[] = [];
      const w: string[] = [];
      for (const f of files) {
        const r = await extractProjectsFromScreenshot(f);
        all.push(...r.projects);
        w.push(...r.warnings);
      }
      setFound(all.map((p) => ({ ...p, pick: Boolean(p.project_code) })));
      setWarnings(w);
      if (!all.length) setError("No projects could be read from that screenshot.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Read projects from a BigTime screenshot (optional, AI)" subtitle="Upload a screenshot of your BigTime project/task list and approve the proposed mapping.">
      {!status ? (
        <p className="muted">Checking AI availability…</p>
      ) : !status.ai ? (
        <Notice tone="info">Not available on this site — the server has no AI key configured. Add projects manually or by CSV instead.</Notice>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Send the screenshot to Anthropic ({status.model}) for this one request. It is not stored by this site.</span>
          </label>
          {status.accessCodeRequired && (
            <label className="field mt">
              <span>Access code</span>
              <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            </label>
          )}
          <div className="mt">
            <Dropzone accept="image/*" multiple onFiles={run} label={busy ? "Reading…" : <><strong>Drop BigTime screenshots</strong> or click</>} icon="🔎" />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          {warnings.length > 0 && <Notice tone="warning">{warnings.join(" ")}</Notice>}
          {found.length > 0 && (
            <div className="mt">
              <label className="check">
                <input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} />
                <span>Remove leading numbers from task names</span>
              </label>
              <div className="table-wrap mt">
                <table className="projects-table">
                  <thead>
                    <tr><th>Add</th><th>Client</th><th>Code</th><th>Tasks</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {found.map((p, i) => (
                      <tr key={i}>
                        <td><input type="checkbox" checked={p.pick} disabled={!p.project_code} onChange={(e) => setFound(found.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))} /></td>
                        <td>{p.client || p.project_name}</td>
                        <td><code>{p.project_code || "—"}</code></td>
                        <td>{p.tasks.map((t) => (strip ? stripTaskPrefix(t) : t)).join(", ") || "—"}</td>
                        <td className="small muted">{p.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="primary" className="mt" disabled={!found.some((p) => p.pick)} onClick={() => {
                onAdd(found.filter((p) => p.pick).map((p) => {
                  const tasks = [...new Set(p.tasks.map((t) => (strip ? stripTaskPrefix(t) : t.trim())).filter(Boolean))];
                  return { id: uid(), client: p.client || p.project_name, aliases: p.project_name && p.project_name !== p.client ? [p.project_name] : [], code: p.project_code, tasks, defaultTask: tasks.length === 1 ? tasks[0] : "", billable: !p.looks_internal };
                }));
                setFound([]);
              }}>Add selected projects</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
