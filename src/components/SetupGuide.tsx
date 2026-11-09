"use client";
import { useState } from "react";
import { GuideFigure } from "./GuideFigure";
import { Button, Card, Notice } from "./ui";

const MAPPINGS: [string, string, string?][] = [
  ["Description", "Description"],
  ["Location", "Location"],
  ["Handy Info", "— (leave blank)"],
  ["Project", "Project"],
  ["Rate Type", "— (leave blank; set at Review time)"],
  ["Task", "Task"],
  ["Role", "— (leave blank; set at Review time)"],
  ["Activity", "— (leave blank)"],
  ["MSP Ticket Number", "— (leave blank)"],
  ["Work Date", "Work Date", "mm/dd/yyyy"],
  ["Work Hours", "Work Hours", "H,HHH.00"],
];

const SECTIONS = [
  ["how", "How it works"],
  ["setup", "First-time setup: import projects"],
  ["outlook", "Weekly: Outlook PDF"],
  ["review", "Review your hours"],
  ["bigtime", "Import the CSV into BigTime"],
  ["role", "Role and Rate Type"],
  ["errors", "Import errors"],
  ["other", "Other ways to add projects"],
  ["privacy", "Privacy & storage"],
  ["limits", "Limitations"],
];

const IMG = "/guide/projector";
const TUTORIAL_STEPS = 6;

/** One collapsible tutorial step. */
function TutorialStep({ n, title, sub, open, onToggle, onNext, children }: { n: number; title: string; sub?: string; open: boolean; onToggle: (open: boolean) => void; onNext?: () => void; children: React.ReactNode }) {
  return (
    <details className="tut-step" id={`tut-step-${n}`} open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) onToggle(o); }}>
      <summary>
        <span className="tut-num" aria-hidden>{n}</span>
        <span>Step {n} — {title}{sub && <><br /><span className="tut-sub">{sub}</span></>}</span>
      </summary>
      <div className="tut-body">
        {children}
        {onNext && (
          <div className="tut-actions">
            <Button size="sm" onClick={onNext}>Next: step {n + 1} →</Button>
          </div>
        )}
      </div>
    </details>
  );
}

export function SetupGuide({ onStart, onProjects }: { onStart: () => void; onProjects: () => void }) {
  const [open, setOpen] = useState<boolean[]>(() => Array.from({ length: TUTORIAL_STEPS }, (_, i) => i === 0));
  const allOpen = open.every(Boolean);
  const setStep = (i: number, v: boolean) => setOpen((o) => o.map((x, k) => (k === i ? v : x)));
  const next = (i: number) => {
    setOpen((o) => o.map((x, k) => (k === i ? false : k === i + 1 ? true : x)));
    requestAnimationFrame(() => document.getElementById(`tut-step-${i + 2}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const step = (i: number) => ({ n: i + 1, open: open[i], onToggle: (v: boolean) => setStep(i, v), onNext: i < TUTORIAL_STEPS - 1 ? () => next(i) : undefined });

  return (
    <div className="stack guide">
      <div className="page-head">
        <div>
          <h1>Help</h1>
          <p className="muted">Everything runs in your browser — no account, no AI service, no API key, nothing to install.</p>
        </div>
      </div>
      <nav className="toc" aria-label="On this page">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#help-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: "smooth" }); }}>{label}</a>)}
      </nav>

      <Card title="How it works">
        <span id="help-how" className="anchor-target" />
        <ol className="flow" aria-label="Workflow">
          <li>Projector Excel report</li><li className="flow-sep" aria-hidden>→</li>
          <li>Outlook Detailed agenda PDF</li><li className="flow-sep" aria-hidden>→</li>
          <li>Review hours</li><li className="flow-sep" aria-hidden>→</li>
          <li>Download CSV</li><li className="flow-sep" aria-hidden>→</li>
          <li>Import into Projector</li>
        </ol>
        <div className="two-col">
          <div>
            <h3>Initial setup (once, about 10 minutes)</h3>
            <ol className="guide-steps">
              <li>Export the <strong>Time Card Report</strong> from Projector as Excel (<a href="#help-setup" onClick={(e) => { e.preventDefault(); document.getElementById("help-setup")?.scrollIntoView({ behavior: "smooth" }); }}>step-by-step below</a>).</li>
              <li>Upload it to Timesheet Converter on <button className="link" onClick={onProjects}>Projects</button>.</li>
              <li>Confirm your projects and tasks, and save.</li>
            </ol>
          </div>
          <div>
            <h3>Every week</h3>
            <ol className="guide-steps">
              <li>Export your Outlook calendar as a <strong>Detailed agenda PDF</strong>.</li>
              <li>Upload it on <button className="link" onClick={onStart}>Timesheet</button>.</li>
              <li>Review the proposed timesheet and correct it to the hours you actually worked.</li>
              <li>Download the CSV.</li>
              <li>Import the CSV into Projector (BigTime).</li>
            </ol>
          </div>
        </div>
        <Notice tone="warning" title="Your calendar shows scheduled meetings, not time worked">
          The app turns meetings into proposed time entries. You decide what you actually worked: check every line, adjust hours, exclude what wasn&apos;t work and add what isn&apos;t on your calendar. Nothing can be downloaded until you&apos;ve approved the entries.
        </Notice>
      </Card>

      <Card title="First-Time Setup: Import Your Projects from Projector">
        <span id="help-setup" className="anchor-target" />
        <p>Before creating your first timesheet, export a report from Projector containing your project assignments and tasks. Timesheet Converter will use this Excel file to automatically populate your projects, codes, and available tasks.</p>
        <p className="muted small">This is usually a one-time setup. Import another report whenever your project assignments change — new projects and tasks are added to what you already have; nothing you saved is deleted.</p>
        <div className="row wrap gap-sm">
          <Button size="sm" variant="ghost" onClick={() => setOpen(Array(TUTORIAL_STEPS).fill(!allOpen))}>{allOpen ? "Collapse all steps" : "Expand all steps"}</Button>
        </div>

        <div className="tutorial">
          <TutorialStep {...step(0)} title="Open Projector Reports" sub="Reports → Create New Report → Time Card Report">
            <ol className="guide-steps">
              <li>Sign into <strong>Projector</strong>.</li>
              <li>Open the <strong>Reports</strong> tab.</li>
              <li>Click <strong>Create New Report</strong>.</li>
              <li>Select <strong>Time Card Report</strong>.</li>
            </ol>
            <p className="small muted">Already saved this report before? Skip to <button className="link" onClick={() => next(2)}>step 4</button> and run it again.</p>
<div className="figure-grid">
              <GuideFigure
                src={`${IMG}/1a-reports-tab.png`} width={600} height={110}
                alt="Projector's top menu with the Reports tab highlighted"
                caption="1. The Reports tab at the top of Projector."
                highlights={[{ left: 48, top: 1, width: 11.8, height: 22, label: "Reports", labelBelow: true }]}
              />
              <GuideFigure
                src={`${IMG}/1b-create-menu.png`} width={298} height={495}
                alt="Create New Report button with its menu open and Time Card Report highlighted"
                caption="2. Create New Report → 3. Time Card Report."
                highlights={[
                  { left: 43, top: 13.5, width: 50.8, height: 6, label: "Create New Report", labelRight: true },
                  { left: 2.5, top: 80.6, width: 97, height: 6.5, label: "Time Card Report", labelRight: true },
                ]}
              />
              <GuideFigure
                src={`${IMG}/1-create-report.png`} width={1893} height={900}
                alt="The whole Projector Reports page with the Create New Report menu open"
                caption="The whole Reports page (click to zoom). Report names are blurred."
                highlights={[
                  { left: 15.2, top: 0.2, width: 3.8, height: 2.8 },
                  { left: 91, top: 15.8, width: 8.1, height: 3.3 },
                  { left: 84.6, top: 52.7, width: 15.3, height: 3.5 },
                ]}
              />
            </div>
          </TutorialStep>

          <TutorialStep {...step(1)} title="Select the required data fields" sub="Data Fields tab → Project, Role, Work Location, Task Name">
            <ol className="guide-steps">
              <li>In the <strong>Time Card Report Wizard</strong>, open the <strong>Data Fields</strong> tab.</li>
              <li>Find each field in the list on the left (use <em>Find</em>), select it and click <strong>›</strong> to add it to <strong>Selected Fields</strong>:</li>
            </ol>
            <ul className="field-list">
              <li><code>Project</code><span>required — the full project name with the project code, e.g. <em>Acme Components - Adaptive Planning - Implementation (P001234-001)</em></span></li>
              <li><code>Role</code><span>context only — it never replaces the task</span></li>
              <li><code>Work Location</code><span>required — the valid Projector location for your time</span></li>
              <li><code>Task Name</code><span>required — the actual task name (not your role)</span></li>
              <li><code>Resource Display Name</code><span>optional — shows whose time cards are included</span></li>
            </ul>
            <p className="small muted">The order doesn&apos;t matter, and other columns are ignored. With <em>Resource Display Name</em> included, the importer also tells you if the report contains more than one person.</p>
<div className="figure-grid">
              <GuideFigure
                src={`${IMG}/2a-data-fields-focus.png`} width={790} height={170} maxWidth={790}
                alt="Data Fields tab with the five selected fields: Project, Role, Work Location, Task Name, Resource Display Name"
                caption="Data Fields tab → the five fields in Selected Fields."
                highlights={[
                  { left: 5.4, top: 3, width: 9.2, height: 12, label: "Data Fields", labelBelow: true },
                  { left: 80.5, top: 39.5, width: 17, height: 53, label: "Selected Fields", labelRight: true },
                ]}
              />
              <GuideFigure
                src={`${IMG}/2-data-fields.png`} width={1273} height={677}
                alt="The whole Time Card Report Wizard on the Data Fields tab"
                caption="The whole wizard window (click to zoom)."
                highlights={[{ left: 3.3, top: 12.5, width: 5.8, height: 3 }, { left: 49.9, top: 21.7, width: 10.6, height: 13.4 }]}
              />
            </div>
          </TutorialStep>

          <TutorialStep {...step(2)} title="Configure the report parameters" sub="Parameters tab → Time Period and Resource Search String">
            <p>Open the <strong>Parameters</strong> tab. Two settings matter:</p>
            <h3>Time Period</h3>
            <p>Choose how far back to look for your projects and tasks. A longer range — for example <strong>last quarter</strong> or the last several months — includes more of the projects you&apos;ve worked on than <em>Last week</em>. This is a history of your time cards, so a brand-new assignment you&apos;ve never recorded time against won&apos;t appear yet (you can import a newer report later, or add that project by hand).</p>
            <h3>Resource Search String</h3>
            <p>Enter <strong>your own name</strong> so only your time cards are included — for example, Jane Smith enters <code>Jane Smith</code> (or another part of her name that only matches her). If colleagues have similar names, check the result: the importer lists every person found when <em>Resource Display Name</em> is included, so you can pick yourself.</p>
            <Notice tone="info" title="Time card status">
              The <em>Include time cards with status</em> boxes decide which time cards count. <strong>Approved</strong> is a good default; add <em>Unapproved</em> (or <em>Draft</em>) if recent work you need hasn&apos;t been approved yet. Make sure the statuses and the date range together cover the history you want to import.
            </Notice>
<div className="figure-grid">
              <GuideFigure
                src={`${IMG}/3a-parameters-focus.png`} width={440} height={468}
                alt="Parameters tab with Time Period, time card statuses and Resource Search String highlighted"
                caption="Parameters tab. The name shown is an example — enter your own."
                highlights={[
                  { left: 68.8, top: 0.6, width: 16, height: 4.8, label: "Parameters", labelBelow: true, labelRight: true },
                  { left: 8.3, top: 12.3, width: 76, height: 5.4, label: "Time Period", labelBelow: true },
                  { left: 8.8, top: 52.5, width: 41.5, height: 28.6, label: "Statuses" },
                  { left: 7.9, top: 92.9, width: 87.8, height: 5.9, label: "Resource Search String: your name" },
                ]}
              />
              <GuideFigure
                src={`${IMG}/3-parameters.png`} width={1281} height={678}
                alt="The whole Time Card Report Wizard on the Parameters tab"
                caption="The whole wizard window (click to zoom)."
                highlights={[{ left: 23.6, top: 12.2, width: 5.6, height: 3.3 }, { left: 2.9, top: 20.3, width: 26.2, height: 3.8 }, { left: 3, top: 48.1, width: 14.3, height: 19.6 }, { left: 2.7, top: 75.8, width: 30.4, height: 4.2 }]}
              />
            </div>
          </TutorialStep>

          <TutorialStep {...step(3)} title="Save and run the report" sub="Save As → Submit → Reports → Run">
            <ol className="guide-steps">
              <li>Click <strong>Save As</strong> to save the report definition for next time (recommended).</li>
              <li>Give it a recognizable name, such as <strong>My Timesheet Projects</strong>.</li>
              <li>Click <strong>Submit</strong>.</li>
              <li>Return to the <strong>Reports</strong> page.</li>
              <li>Select your report in the list and click <strong>Run</strong>.</li>
            </ol>
            <p className="small muted">Next time, just select the saved report and click <strong>Run</strong> — no need to create it again.</p>
<GuideFigure
              src={`${IMG}/4-save-submit.png`} width={1281} height={38} maxWidth={980}
              alt="Bottom of the Time Card Report Wizard with the Save As and Submit buttons"
              caption="Bottom of the wizard: Save As (name it), then Submit."
              highlights={[{ left: 64, top: 8, width: 5.6, height: 84 }, { left: 82.4, top: 8, width: 8.8, height: 84 }]}
            />
<div className="figure-grid">
              <GuideFigure
                src={`${IMG}/4a-run-focus.png`} width={212} height={145}
                alt="The Run button on the Projector Reports page"
                caption="Select your saved report in the list, then click Run."
                highlights={[{ left: 20, top: 28.5, width: 72.5, height: 20, label: "Run", labelBelow: true }]}
              />
              <GuideFigure
                src={`${IMG}/4-run.png`} width={1902} height={672}
                alt="Projector Reports page with a saved report selected and the Run button highlighted"
                caption="The whole Reports page (click to zoom). Report names are blurred."
                highlights={[{ left: 91, top: 16.4, width: 8.2, height: 4.6 }, { left: 0.9, top: 93.6, width: 28.7, height: 2.6 }]}
              />
            </div>
          </TutorialStep>

          <TutorialStep {...step(4)} title="Download the Excel report" sub="Report Output → Save as XLSX (New)">
            <ol className="guide-steps">
              <li>When Projector finishes, find the report in the <strong>Report Output</strong> panel (Status: <em>Completed</em>).</li>
              <li>Select that output — the buttons on the right become available.</li>
              <li>Click <strong>Save as XLSX (New)</strong> (or the equivalent Excel export).</li>
              <li>Save the <code>.xlsx</code> file to your computer.</li>
            </ol>
            <Notice tone="warning" title="Use the original Excel file">
              Upload the workbook exactly as Projector saved it — not a screenshot, PDF, or a table copied into a new file. Don&apos;t open and re-save it first.
            </Notice>
<div className="figure-grid">
              <GuideFigure
                src={`${IMG}/5a-output-rows.png`} width={940} height={150} maxWidth={940}
                alt="Report Output panel listing completed reports"
                caption="Report Output: select a Completed output. Names are blurred."
                highlights={[{ left: 2, top: 31.5, width: 97, height: 58, label: "completed output" }]}
              />
              <GuideFigure
                src={`${IMG}/5b-save-xlsx-button.png`} width={173} height={130}
                alt="The Save as XLSX (New) button next to the Report Output panel"
                caption="Then Save as XLSX (New). The buttons are grey until an output is selected."
                highlights={[{ left: 5.5, top: 52.5, width: 87.5, height: 19.5, label: "Save as XLSX (New)" }]}
              />
            </div>
          </TutorialStep>

          <TutorialStep {...step(5)} title="Upload the report into Timesheet Converter" sub="Projects → Import projects → Upload Projector Excel report">
            <ol className="guide-steps">
              <li>Return to Timesheet Converter.</li>
              <li>Open <button className="link" onClick={onProjects}>Projects</button> → <em>Import projects</em> → <strong>Upload Projector Excel report</strong> (first-time users see this as step 1 of setup).</li>
              <li>Upload the downloaded Excel file.</li>
              <li>Review the imported <strong>project names, project codes, tasks and locations</strong>. Rows marked <em>Review</em> need a look; fix anything that&apos;s wrong.</li>
              <li>Approve the projects (<em>Approve all verified</em>) and click <strong>Save</strong>.</li>
            </ol>
            <p className="small muted">Your projects and the choices you confirm are remembered in this browser. Importing a newer report later adds new projects and tasks without deleting your saved projects, aliases or matches.</p>
            <GuideFigure
              src={`${IMG}/6-review-projects.png`} width={1360} height={1302} maxWidth={760}
              alt="Timesheet Converter project review table after uploading a Projector report (fictional data)"
              caption="Checking the imported projects (fictional example data)."
              highlights={[
                { left: 21, top: 29.1, width: 48.4, height: 3, label: "names, codes, tasks" },
                { left: 75, top: 25, width: 13.4, height: 3.2, label: "Approve all verified" },
                { left: 86.6, top: 95.3, width: 10, height: 3.5, label: "Save", labelRight: true },
              ]}
            />
            <div className="row wrap gap-sm">
              <Button variant="primary" size="sm" onClick={onProjects}>Go to Projects</Button>
              <Button size="sm" onClick={onStart}>Then make my first timesheet →</Button>
            </div>
          </TutorialStep>
        </div>

        <details className="help mt">
          <summary>What the importer reads from each column</summary>
          <div className="table-wrap mt">
            <table className="map-table">
              <thead><tr><th>Report column</th><th>Example</th><th>Used as</th></tr></thead>
              <tbody>
                <tr><td><strong>Project</strong></td><td><code>Acme Components - Adaptive Planning - Implementation (P001234-001)</code></td><td>Project code (from the final parentheses), full project name, and client name</td></tr>
                <tr><td><strong>Task Name</strong></td><td><code>Planning</code></td><td>The project&apos;s tasks, exactly as written</td></tr>
                <tr><td><strong>Work Location</strong></td><td><code>Main Office</code></td><td>Suggested location</td></tr>
                <tr className="muted"><td><strong>Role</strong></td><td><code>Consultant</code></td><td>Reference only — never exported (set Role in BigTime&apos;s Review Time step)</td></tr>
                <tr className="muted"><td><strong>Resource Display Name</strong></td><td><code>Jane Smith</code></td><td>Optional — lets you choose yourself if the report contains several people</td></tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">Menu names can differ slightly between Projector versions; any Excel export with a <em>Project</em> column (name with the code in parentheses) and a <em>Task Name</em> column works.</p>
        </details>
      </Card>

      <Card title="Every week: export your Outlook calendar as a Detailed agenda PDF">
        <span id="help-outlook" className="anchor-target" />
        <p>The calendar is imported from one file each week: Outlook&apos;s <strong>Detailed agenda</strong> saved as a PDF. It lists every meeting&apos;s full title with its exact date, start and end time.</p>
        <ol className="guide-steps">
          <li>Open <strong>Outlook Calendar</strong>.</li>
          <li>Select the week you want to record.</li>
          <li>Go to <strong>Home → Print</strong> (or <strong>File → Print</strong>; in new Outlook / Outlook on the web use the calendar&apos;s <strong>Print</strong> button). Set the start and end dates to that week.</li>
          <li>Choose the <strong>Detailed agenda</strong> print style.</li>
          <li>Save the output as a <strong>PDF</strong> — printer <em>Microsoft Print to PDF</em> (Windows) or <em>Save as PDF</em> (Mac / browser).</li>
          <li>Upload that PDF on <button className="link" onClick={onStart}>Timesheet</button> (<em>Upload Your Outlook Calendar PDF</em>).</li>
        </ol>
        <Notice tone="warning" title="Use “Detailed agenda”, not the calendar grid">
          The standard day / work week / month PDF is the wrong format: meeting names are cut off and precise start and end times are often missing. If you upload a grid PDF (or a scanned PDF without text), the app tells you instead of guessing.
        </Notice>
        <p className="small muted">The PDF is read inside your browser and never uploaded. From each meeting the app keeps only its title, date, times, organizer and location; meeting links, passcodes and attendee lists are ignored. Canceled meetings and all-day events (for example colleagues&apos; PTO) are excluded by default but listed so you can include them.</p>
      </Card>

      <Card title="Review your hours">
        <span id="help-review" className="anchor-target" />
        <ol className="guide-steps">
          <li><strong>Review extracted meetings</strong> — untick anything that isn&apos;t work; include a canceled or all-day item only if you really worked then.</li>
          <li><strong>Match projects</strong> — confirm the project and task for anything new. Meetings named <code>CLIENT | TASK | DESCRIPTION</code> (e.g. <code>Acme Components | Gears | Forecast model</code>) match automatically, and your choices are remembered for next week.</li>
          <li><strong>Review hours</strong> — change start/end times or hours to what you actually worked, add entries that aren&apos;t on your calendar, resolve overlaps (overlapping time is never counted twice), and approve each line.</li>
          <li><strong>Download CSV</strong> — check the preview (project names are shown next to codes), confirm, and download.</li>
        </ol>
      </Card>

      <Card title="Import the CSV into BigTime">
        <span id="help-bigtime" className="anchor-target" />
        <ol className="guide-steps">
          <li>Download the CSV from the last step. The file is named <code>BigTime_Timesheet_YYYY-MM-DD_to_YYYY-MM-DD.csv</code>; hours are decimal (3 h 30 min = <code>3.50</code>).</li>
          <li>In BigTime open <strong>Import time</strong>. It has three tabs: <em>1. Choose file</em>, <em>2. Map fields</em>, <em>3. Review time</em>.</li>
          <li><em>Choose file</em>: select the CSV (up to 500 time cards per file).</li>
          <li><em>Map fields</em>: choose these columns and formats:</li>
        </ol>
        <div className="table-wrap mt">
          <table className="map-table">
            <thead>
              <tr><th>BigTime field</th><th>Column from your file</th><th>“How are values formatted?”</th></tr>
            </thead>
            <tbody>
              {MAPPINGS.map(([f, c, fmt]) => (
                <tr key={f} className={c.startsWith("—") ? "muted" : ""}>
                  <td><strong>{f}</strong></td>
                  <td>{c.startsWith("—") ? c : <code>{c}</code>}</td>
                  <td>{fmt ? <code className="code-strong">{fmt}</code> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notice tone="warning" title="Change the Work Hours format">
          BigTime defaults Work Hours to <code>HH:MM</code>. Choose <code>H,HHH.00</code> (period as the decimal point). Don&apos;t choose <code>H.HHH,00</code> or <code>H HHH,00</code>.
        </Notice>
        <div className="figure-grid">
          <GuideFigure src="/guide/map-fields.png" width={611} height={353} alt="BigTime Map fields step with the column dropdown open" caption="Each BigTime field has a dropdown listing the file's columns. Client details are redacted." highlights={[{ left: 25, top: 51, width: 62, height: 28, label: "your file's columns" }]} />
          <GuideFigure src="/guide/work-date-format.png" width={560} height={289} alt="Work Date format dropdown with mm/dd/yyyy selected" caption="Work Date → mm/dd/yyyy." highlights={[{ left: 25.5, top: 62, width: 64, height: 7.5, label: "mm/dd/yyyy" }]} />
          <GuideFigure src="/guide/work-hours-format.png" width={597} height={290} alt="Work Hours format dropdown showing H,HHH.00 and the HH:MM default" caption="Work Hours → H,HHH.00 (not the HH:MM default)." highlights={[{ left: 26, top: 35.5, width: 62.5, height: 7, label: "choose H,HHH.00" }, { left: 26, top: 49.5, width: 62.5, height: 7, label: "default — change it", tone: "bad" }]} />
        </div>
        <h3>Save the mapping as “CSV Mapping”</h3>
        <p>Before leaving <em>Map fields</em>, use BigTime&apos;s option to save these import settings and name them <strong>CSV Mapping</strong>. Next week choose <em>CSV Mapping</em> after uploading and every field and format is filled in. This app always writes the same six columns, so the saved mapping keeps working. (The save option&apos;s exact position can vary by BigTime version; it is on the Map fields step.)</p>
      </Card>

      <Card title="Role and Rate Type (at Review time)">
        <span id="help-role" className="anchor-target" />
        <p>The CSV deliberately doesn&apos;t include Role or Rate Type — the tested six-column import worked without them, and this app never guesses billing details. If your BigTime setup marks them as required, set them on BigTime&apos;s <em>3. Review time</em> tab:</p>
        <ol className="guide-steps">
          <li>Check that every card shows a real date and hours (if you see “unknown date” and 0.00, go back to Map fields).</li>
          <li>Click <strong>Select All for Edit</strong> to edit all cards at once (or select cards one by one if they need different values).</li>
          <li>Choose your <strong>Role</strong> from the Role dropdown.</li>
          <li>Choose the <strong>Rate</strong> (Rate Type) from the Rate dropdown. If you&apos;re unsure which applies, ask your manager or BigTime administrator.</li>
          <li>Confirm Location and Task, then mark the cards for import and complete the import.</li>
        </ol>
        <div className="figure-grid">
          <GuideFigure src="/guide/review-time-unmapped.png" width={734} height={610} alt="BigTime Review time step with Role, Rate and Select All for Edit" caption="Review time: Select All for Edit, then Role and Rate. (This screenshot also shows what an unmapped import looks like: unknown date, 0.00.)" highlights={[{ left: 60.5, top: 29.5, width: 33.5, height: 4.5, label: "Role" }, { left: 60.5, top: 45, width: 33.5, height: 4.5, label: "Rate" }, { left: 0.5, top: 92.5, width: 14, height: 4.5, label: "Select All for Edit" }]} />
        </div>
      </Card>

      <Card title="Resolving Projector import errors">
        <span id="help-errors" className="anchor-target" />
        <div className="table-wrap">
          <table className="map-table">
            <thead><tr><th>What you see in BigTime</th><th>Cause</th><th>Fix</th></tr></thead>
            <tbody>
              <tr><td>“unknown date” and <code>0.00</code> hours on Review time</td><td>Work Date / Work Hours formats weren&apos;t set</td><td>Go back to <em>Map fields</em>: Work Date <code>mm/dd/yyyy</code>, Work Hours <code>H,HHH.00</code>. Save the mapping.</td></tr>
              <tr><td>“This task could not be matched”</td><td>The task name differs from BigTime&apos;s (often a display number like “2 Planning”)</td><td>Correct the task on <button className="link" onClick={onProjects}>Projects</button> → Edit (or re-import the Excel report), then export again.</td></tr>
              <tr><td>Project not found / not matched</td><td>Wrong or old project code, or you aren&apos;t assigned to the project</td><td>Compare the code on the Projects page with Projector; import a newer Time Card Report.</td></tr>
              <tr><td>Location missing or invalid</td><td>The default location doesn&apos;t match BigTime&apos;s Location list</td><td>Projects → Settings: type the location exactly as BigTime shows it.</td></tr>
              <tr><td>Role or Rate required</td><td>The CSV intentionally leaves them out</td><td>Set them on <em>Review time</em> (see Role and Rate Type above).</td></tr>
              <tr><td>File rejected as too large</td><td>More than 500 time cards</td><td>Export a shorter period.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="figure-grid">
          <GuideFigure src="/guide/task-not-matched.png" width={274} height={81} alt="BigTime error: task could not be matched" caption="“This task could not be matched” — fix the task name on the Projects page and export again." />
        </div>
      </Card>

      <Card title="Other ways to add projects">
        <span id="help-other" className="anchor-target" />
        <p>The Projector Excel report is the recommended way. If you can&apos;t export it, these also work (all on <em>Projects → Import projects</em>), and you can always add a single project with <strong>+ Add project</strong>.</p>
        <details className="help">
          <summary>Copy text from Projector</summary>
          <ol className="guide-steps mt">
            <li>Open the Projector screen that lists your assigned projects and tasks, and <strong>expand every project</strong> so its tasks are visible.</li>
            <li>Select the list, copy (Ctrl/⌘+C) and paste into <em>Paste Projector text</em>. Extra labels are ignored.</li>
          </ol>
        </details>
        <details className="help">
          <summary>Screenshots of your project list</summary>
          <ol className="guide-steps mt">
            <li>Expand every project first — tasks inside collapsed rows can&apos;t be read.</li>
            <li>Capture the list (Windows <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, Mac <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>4</kbd>) at normal zoom with the project codes in view; long lists can be several screenshots, top to bottom.</li>
            <li>Check the <strong>Review</strong> rows (unclear code, missing task or guessed client), then save.</li>
          </ol>
          <div className="figure-grid">
            <GuideFigure src="/guide/projector-example.png" width={760} height={364} alt="Illustration of a project list with project codes and numbered tasks (fictional data)" caption={<><strong>Illustration with fictional data.</strong> A project row ending in its code, followed by its numbered tasks. The app saves “2 Planning” as “Planning”.</>} highlights={[{ left: 3, top: 23.5, width: 61, height: 6.5, label: "project + code" }, { left: 5, top: 30.5, width: 21, height: 22, label: "tasks" }]} />
            <GuideFigure src="/guide/task-list.png" width={296} height={138} alt="BigTime task dropdown showing numbered task names" caption="BigTime shows a sequence number before each task; it isn't part of the name and is removed for you." highlights={[{ left: 11.5, top: 33, width: 6, height: 58, label: "not part of the name", tone: "bad" }]} />
          </div>
        </details>
        <details className="help">
          <summary>Restore a backup or import a projects CSV</summary>
          <p className="mt">Use <em>Import a file</em> with a backup downloaded from the Projects page (on another computer or browser) or a projects CSV.</p>
        </details>
      </Card>

      <Card title="Privacy & storage">
        <span id="help-privacy" className="anchor-target" />
        <ul className="guide-steps">
          <li>Your calendar PDF, Projector report and any project screenshots are processed <strong>inside your browser</strong> with open-source pdf.js (and Tesseract for screenshots), served from this website. Nothing is uploaded, and the site&apos;s security policy blocks the page from sending data to any other server.</li>
          <li>Projects, settings, remembered matches and the current timesheet are saved in this browser&apos;s local storage. They are <strong>specific to this device and browser</strong>, not synced, and are erased if you clear site data. Download a backup from the Projects page and restore it on another computer.</li>
          <li>No accounts, analytics, cookies for tracking, AI services or API keys. Nothing is submitted to BigTime.</li>
          <li>Browser storage is convenient, not an enterprise security control. Make sure your company allows using this tool with client information, and use it on a work device.</li>
        </ul>
      </Card>

      <Card title="Limitations">
        <span id="help-limits" className="anchor-target" />
        <ul className="guide-steps">
          <li><strong>A time card report is history.</strong> It only contains projects and tasks you charged time to in its date range and statuses. Brand-new assignments appear once you&apos;ve recorded time on them; until then add them by hand or import a newer report.</li>
          <li><strong>Calendar PDF:</strong> only Outlook&apos;s Detailed agenda is supported. Times are read as printed (your Outlook time zone). Meetings that run past midnight are split by day. Scanned or image-only PDFs have no readable text and are rejected.</li>
          <li><strong>Calendar time is a proposal.</strong> Every line must be approved before export; adjust hours to what you actually worked.</li>
          <li><strong>Screenshot import</strong> (fallback only) can misread blurry or small text; look-alike characters in codes are flagged for you to check, never silently “fixed”.</li>
        </ul>
      </Card>
    </div>
  );
}
