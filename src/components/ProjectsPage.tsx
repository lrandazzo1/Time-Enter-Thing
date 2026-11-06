"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import { Badge, Button, Card, Notice, downloadBytes } from "./ui";
import { ProjectImporter } from "./ProjectImporter";
import type { ProjectMapping, Settings } from "@/lib/types";
import { projectsToCsv, validateProject } from "@/lib/projectsCsv";
import { stripTaskPrefix } from "@/lib/matching";
import { clearEverything, makeBackup } from "@/lib/storage";
import { isValidTimeZone } from "@/lib/time";
import { uid } from "@/lib/uid";

const blank = (): ProjectMapping => ({ id: uid(), client: "", aliases: [], code: "", tasks: [], defaultTask: "", billable: true, source: "manual" });

export function ProjectsPage({ onRestartSetup }: { onRestartSetup: () => void }) {
  const { projects, setProjects, settings, setSettings, rules, setRules } = useStore();
  const [editing, setEditing] = useState<ProjectMapping | null>(null);
  const [showImport, setShowImport] = useState(projects.length === 0);
  const [query, setQuery] = useState("");
  const complete = projects.filter((p) => p.code && p.tasks.length > 0).length;
  const shown = projects.filter((p) => !query.trim() || [p.client, p.code, p.fullName ?? "", ...p.tasks, ...p.aliases].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const byId = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">
            <strong>{projects.length}</strong> saved project{projects.length === 1 ? "" : "s"} · {complete} ready for time entry. Stored only in this browser on this device.
          </p>
        </div>
        <div className="row wrap gap-sm">
          <Button variant="primary" onClick={() => setShowImport((s) => !s)}>{showImport ? "Hide import" : "Import projects"}</Button>
          <Button onClick={() => setEditing(blank())}>+ Add manually</Button>
        </div>
      </div>

      {showImport && (
        <Card title="Import from Projector" subtitle="Scan screenshots, paste copied text, or import a file. New projects are added; existing ones keep their settings and gain any new tasks.">
          <ProjectImporter />
        </Card>
      )}

      <Card
        title="Saved projects"
        subtitle="Calendar events are matched by project code, client name or alias. Task names must match BigTime exactly."
        actions={projects.length > 6 ? <input className="input-sm" placeholder="Search projects" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} /> : undefined}
      >
        {editing && !projects.some((p) => p.id === editing.id) && (
          <ProjectEditor key={editing.id} value={editing} all={projects} onCancel={() => setEditing(null)} onSave={(p) => { setProjects([...projects, p]); setEditing(null); }} />
        )}
        {projects.length === 0 && !editing ? (
          <div className="empty"><p>No projects yet. Use <strong>Import projects</strong> above — scanning a few screenshots is usually fastest.</p></div>
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
                {shown.map((p) =>
                  editing?.id === p.id ? (
                    <tr key={p.id}>
                      <td colSpan={5}>
                        <ProjectEditor value={editing} all={projects} onCancel={() => setEditing(null)} onSave={(np) => { setProjects(projects.map((x) => (x.id === np.id ? np : x))); setEditing(null); }} />
                      </td>
                    </tr>
                  ) : (
                    <ProjectRow key={p.id} p={p} all={projects} onEdit={() => setEditing(p)} onDelete={() => {
                      if (window.confirm(`Delete ${p.client} (${p.code})?`)) {
                        setProjects(projects.filter((x) => x.id !== p.id));
                        setRules(rules.filter((r) => r.projectId !== p.id));
                      }
                    }} />
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Remembered matches (${rules.length})`} subtitle="When you confirm which project a meeting belongs to, the app remembers it for future weeks.">
        {rules.length === 0 ? (
          <p className="muted small">None yet. They are added when you approve entries you matched yourself.</p>
        ) : (
          <ul className="resolve-list">
            {rules.map((r) => {
              const p = byId.get(r.projectId);
              return (
                <li key={r.id}>
                  <div><strong>{r.example}</strong> <span className="muted small">→ {p ? `${p.client} · ${r.task || "no task"}` : "deleted project"}</span></div>
                  <Button size="sm" variant="ghost" onClick={() => setRules(rules.filter((x) => x.id !== r.id))}>Forget</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <SettingsCard settings={settings} setSettings={setSettings} />

      <Card title="Backup & reset" subtitle="Browser storage belongs to this browser on this device and is erased if you clear site data. Download a backup to move to another computer or browser.">
        <div className="row wrap gap-sm">
          <Button size="sm" onClick={() => downloadBytes(JSON.stringify(makeBackup(projects, settings, rules), null, 2), "timesheet-converter-backup.json", "application/json")}>Download backup (.json)</Button>
          <Button size="sm" disabled={!projects.length} onClick={() => downloadBytes(projectsToCsv(projects), "my-bigtime-projects.csv", "text/csv;charset=utf-8")}>Export projects CSV</Button>
          <Button size="sm" onClick={onRestartSetup}>Restart setup wizard</Button>
          <Button size="sm" variant="danger" onClick={() => {
            if (window.confirm("Erase all projects, settings, remembered matches and the current timesheet from this browser?")) {
              clearEverything();
              window.location.reload();
            }
          }}>Erase all data in this browser</Button>
        </div>
        <p className="small muted mt">To restore a backup, choose <em>Import projects → Import a file</em>.</p>
      </Card>
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
        <label className="check span-2">
          <input type="checkbox" checked={settings.keepTaskNumbers} onChange={(e) => setSettings({ ...settings, keepTaskNumbers: e.target.checked })} />
          <span>Keep Projector&apos;s numeric task prefixes when importing (“2 Planning”). Off = “Planning”, which is what the tested BigTime import accepts.</span>
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

