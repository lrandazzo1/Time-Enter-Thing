"use client";
import { GuideFigure } from "./GuideFigure";
import { Card, Notice } from "./ui";

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
  ["quick", "Quick start"],
  ["report", "Which Projector report to export"],
  ["projects", "Other ways to import projects"],
  ["outlook", "Export your Outlook calendar"],
  ["bigtime", "Import the CSV into BigTime"],
  ["role", "Role and Rate Type"],
  ["privacy", "Privacy & storage"],
  ["limits", "Limitations & troubleshooting"],
];

export function SetupGuide({ onStart, onProjects }: { onStart: () => void; onProjects: () => void }) {
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

      <Card title="Quick start" className="anchor" >
        <span id="help-quick" className="anchor-target" />
        <div className="two-col">
          <div>
            <h3>First time (about 5 minutes)</h3>
            <ol className="guide-steps">
              <li>Download your Projector <strong>Time Card Report</strong> as Excel and upload it as-is (<button className="link" onClick={onProjects}>Projects</button>).</li>
              <li>Check the detected clients, codes and tasks, then save.</li>
              <li>Enter your BigTime location once.</li>
              <li>Import this week&apos;s Outlook calendar.</li>
              <li>Review the hours, approve, download the CSV.</li>
            </ol>
          </div>
          <div>
            <h3>Every week after that</h3>
            <ol className="guide-steps">
              <li>Open <button className="link" onClick={onStart}>Timesheet</button> and import the calendar.</li>
              <li>Match anything new (the app remembers your choices).</li>
              <li>Correct hours to what you actually worked and approve.</li>
              <li>Download and import into BigTime.</li>
            </ol>
          </div>
        </div>
        <Notice tone="info" title="Tip: name your work blocks">
          Outlook blocks named <code>CLIENT | TASK | WORK DESCRIPTION</code> — e.g. <code>Acme Components | Gears | Forecast model</code> — match automatically with the right task.
        </Notice>
      </Card>

      <Card title="Which Projector report to export">
        <span id="help-report" className="anchor-target" />
        <p>Timesheet Converter reads the <strong>original Excel file</strong> of a Projector <strong>Time Card Report</strong>. One report gives it every project code, project name and task you have charged time to, plus your work location.</p>
        <ol className="guide-steps">
          <li>In Projector, open <strong>Reports</strong> and run a <strong>Time Card Report</strong> (you can save it, e.g. as “Timesheet Converter”, to reuse it).</li>
          <li>Include these columns: <code>Project</code>, <code>Task Name</code>, <code>Work Location</code> and (optional) <code>Role</code>. Other columns are ignored.</li>
          <li>Filter it to <strong>yourself</strong> (the resource filter / resource search string) so only your projects are included.</li>
          <li>Pick a date range long enough to cover every project you&apos;re working on — the last <strong>3–6 months</strong> works well. Including approved time cards is enough.</li>
          <li>Export to <strong>Excel</strong> and upload the downloaded <code>.xlsx</code> on <em>Projects → Import projects → Upload Projector Excel report</em>. Don&apos;t open, convert or edit it first.</li>
        </ol>
        <div className="table-wrap mt">
          <table className="map-table">
            <thead><tr><th>Report column</th><th>Example</th><th>Used as</th></tr></thead>
            <tbody>
              <tr><td><strong>Project</strong></td><td><code>Acme Components - Adaptive Planning - Implementation (P001234-001)</code></td><td>Project code (from the final parentheses), full project name, and client name</td></tr>
              <tr><td><strong>Task Name</strong></td><td><code>Planning</code></td><td>The project&apos;s tasks, exactly as written</td></tr>
              <tr><td><strong>Work Location</strong></td><td><code>Main Office</code></td><td>Suggested BigTime location</td></tr>
              <tr className="muted"><td><strong>Role</strong></td><td><code>Consultant</code></td><td>Reference only — never exported (set Role in BigTime&apos;s Review Time step)</td></tr>
            </tbody>
          </table>
        </div>
        <Notice tone="warning" title="A time card report is history, not your assignment list">
          It only contains projects and tasks you charged time to in the chosen date range. A brand-new project won&apos;t be in it yet — when a meeting needs it, the Match step lets you upload a newer report or add that one project. The app shows the report&apos;s date range and filters (from its <em>Options</em> sheet) so you can check what was included.
        </Notice>
        <p className="small muted">Report and menu names can differ slightly between Projector versions; any report export with a <em>Project</em> column (name with the code in parentheses) and a <em>Task Name</em> column works. Projects you add later are merged — nothing you saved is deleted.</p>
      </Card>

      <Card title="Other ways to import projects">
        <span id="help-projects" className="anchor-target" />
        <p>You only need the projects you currently work on. Add more any time — new imports are merged with what you have.</p>
        <p>If you can&apos;t export the Excel report, these work too.</p>
        <h3>Option A — copy text</h3>
        <ol className="guide-steps">
          <li>Open the Projector screen that lists your assigned projects and tasks (the project/task picker on your timesheet, or your project assignments list).</li>
          <li><strong>Expand every project</strong> so its numbered tasks are visible.</li>
          <li>Select the list (drag across it, or Ctrl/⌘+A), copy (Ctrl/⌘+C), and paste into <em>Projects → Import projects → Paste Projector text</em>. Extra labels are ignored.</li>
        </ol>
        <h3>Option B — screenshots</h3>
        <ol className="guide-steps">
          <li>Expand every project first — tasks inside collapsed rows can&apos;t be read.</li>
          <li>Capture the list: Windows <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, Mac <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>4</kbd>. Use normal zoom (100% or larger) and keep the project codes in view.</li>
          <li>Long list? Scroll and take several screenshots, top to bottom, with a little overlap. Upload them in that order (you can reorder them). Repeated projects are merged by project code.</li>
          <li>Review the table: green <strong>Verified</strong> rows were read cleanly; <strong>Review</strong> rows have a missing or unclear code, a missing task, or a client name that was guessed. Fix those, then <em>Approve all verified</em> and <em>Save</em>.</li>
        </ol>
        <div className="figure-grid">
          <GuideFigure
            src="/guide/projector-example.png"
            width={760}
            height={364}
            alt="Illustration of a project list with project codes and numbered tasks (fictional data)"
            caption={<><strong>Illustration with fictional data</strong> — not a real Projector screenshot. This is the shape the importer reads: a project row ending in its code (P000000-000), followed by its numbered tasks. The app saves “2 Planning” as “Planning”.</>}
            highlights={[{ left: 3, top: 23.5, width: 61, height: 6.5, label: "project + code" }, { left: 5, top: 30.5, width: 21, height: 22, label: "tasks" }]}
          />
          <GuideFigure src="/guide/task-list.png" width={296} height={138} alt="BigTime task dropdown showing numbered task names" caption="BigTime displays a sequence number before each task. The CSV must use the name without the number — the importer removes it for you." highlights={[{ left: 11.5, top: 33, width: 6, height: 58, label: "not part of the name", tone: "bad" }]} />
        </div>
        <p className="small muted">We don&apos;t have a verified screenshot of every Projector screen, so these steps describe what to capture rather than exact menu names. If your screen looks different, any view that shows the project name, code and tasks works.</p>
      </Card>

      <Card title="Export your Outlook calendar">
        <span id="help-outlook" className="anchor-target" />
        <ul className="guide-steps">
          <li><strong>Outlook for Windows (classic):</strong> File → Save Calendar → <em>More Options</em> → date range + <em>Full details</em> → Save (.ics). Or File → Open &amp; Export → Import/Export → <em>Export to a file</em> → <em>Comma Separated Values</em> → Calendar (.csv).</li>
          <li><strong>New Outlook / Outlook on the web:</strong> Settings → Calendar → Shared calendars → <em>Publish a calendar</em> → “Can view all details” → open the ICS link to download the .ics. Keep that link private.</li>
          <li><strong>Outlook for Mac:</strong> drag the calendar (or selected events) to the desktop to create an .ics file, or File → Export.</li>
          <li><strong>Can&apos;t export?</strong> Switch Outlook to the list view, select the week&apos;s events, copy, and use <em>Paste event information</em>. Calendar screenshots are a last resort: they rarely show exact times.</li>
        </ul>
        <p className="small muted">Time zones, recurring meetings, moved occurrences and cancellations in .ics files are handled automatically. Canceled meetings, all-day events, “free” time and personal items are excluded but stay visible so you can include them.</p>
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
          <GuideFigure src="/guide/task-not-matched.png" width={274} height={81} alt="BigTime error: task could not be matched" caption="“This task could not be matched” means a task name includes BigTime's display number. Edit the task on the Projects page (or re-import with numbers removed) and export again." />
        </div>
      </Card>

      <Card title="Privacy & storage">
        <span id="help-privacy" className="anchor-target" />
        <ul className="guide-steps">
          <li>Calendar files, pasted text and screenshots are processed <strong>inside your browser</strong>. Text recognition (OCR) runs on your device using open-source Tesseract; its engine files come from this website, and your images are never uploaded. The site&apos;s security policy blocks the page from sending data to any other server.</li>
          <li>Projects, settings, remembered matches and the current timesheet are saved in this browser&apos;s local storage. They are <strong>specific to this device and browser</strong>, not synced, and are erased if you clear site data. Download a backup from the Projects page and restore it on another computer.</li>
          <li>No accounts, analytics, cookies for tracking, AI services or API keys. Nothing is submitted to BigTime.</li>
          <li>Browser storage is convenient, not an enterprise security control. Make sure your company allows using this tool with client information, and use it on a work device.</li>
        </ul>
      </Card>

      <Card title="Limitations & troubleshooting">
        <span id="help-limits" className="anchor-target" />
        <ul className="guide-steps">
          <li><strong>Screenshot text recognition isn&apos;t perfect.</strong> Blurry, low-resolution, heavily scaled or cropped screenshots produce missing or misread text. Codes that may contain look-alike characters (O/0, I/1, S/5) are flagged for you to check — the app never silently “fixes” them. When in doubt, paste text instead.</li>
          <li><strong>Hidden tasks can&apos;t be read.</strong> Expand projects before capturing. Tasks at the top of a screenshot whose project is on the previous screenshot are offered as “tasks without a project” for you to assign.</li>
          <li><strong>The first scan downloads the OCR engine</strong> (~11 MB, from this site) and caches it; later scans start quickly. Very old browsers without WebAssembly can&apos;t scan — use copied text.</li>
          <li><strong>Calendar screenshots</strong> only provide times that are written in the image; block positions are never turned into hours.</li>
          <li><strong>Calendar time is a proposal.</strong> Every line must be approved before export; adjust hours to what you actually worked.</li>
        </ul>
      </Card>
    </div>
  );
}
