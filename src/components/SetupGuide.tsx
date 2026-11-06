"use client";
import { GuideFigure } from "./GuideFigure";
import { Card, Notice } from "./ui";

const MAPPINGS: [string, string, string?][] = [
  ["Description", "Description"],
  ["Location", "Location"],
  ["Handy Info", "— (leave blank)"],
  ["Project", "Project"],
  ["Rate Type", "— (leave blank)"],
  ["Task", "Task"],
  ["Role", "— (leave blank)"],
  ["Activity", "— (leave blank)"],
  ["MSP Ticket Number", "— (leave blank)"],
  ["Work Date", "Work Date", "mm/dd/yyyy"],
  ["Work Hours", "Work Hours", "H,HHH.00"],
];

export function SetupGuide({ onStart, onProjects }: { onStart: () => void; onProjects: () => void }) {
  return (
    <div className="stack guide">
      <div className="page-head">
        <div>
          <h1>Setup guide</h1>
          <p className="muted">From your Outlook calendar to an imported BigTime timesheet. One-time setup takes about 10 minutes; after that each week takes a few minutes.</p>
        </div>
      </div>

      <Card title="Before your first timesheet">
        <ol className="guide-steps">
          <li>
            <strong>Add your projects.</strong> On <button className="link" onClick={onProjects}>Projects &amp; Tasks</button>, enter each client, its BigTime project code (e.g. <code>P000123-001</code>) and the task names you&apos;re assigned. Use the task name <em>without</em> the number BigTime shows in front of it — BigTime displays <code>3 Planning Consultant</code> but imports <code>Planning Consultant</code>.
          </li>
          <li>
            <strong>Set your location</strong> to the exact value in BigTime&apos;s Location list (for example your office name). This app never invents one.
          </li>
          <li>
            <strong>Name your work blocks</strong> in Outlook as <code>CLIENT | TASK | WORK DESCRIPTION</code>, e.g. <code>Acme Corp | Planning | Model development</code>. These match automatically; other meetings are matched by client names/aliases and flagged when unclear.
          </li>
        </ol>
        <div className="mt">
          <GuideFigure src="/guide/task-list.png" width={296} height={138} alt="BigTime task dropdown showing numbered task names" caption="BigTime shows a sequence number before each task (here 1–4). Enter the names without the number." highlights={[{ left: 11.5, top: 33, width: 6, height: 58, label: "not part of the name", tone: "bad" }]} />
        </div>
      </Card>

      <Card title="Step 1 — Generate and download the CSV">
        <ol className="guide-steps">
          <li>
            Export your calendar from Outlook:
            <ul>
              <li><strong>Outlook for Windows (classic):</strong> File → Save Calendar → <em>More Options</em> → choose the date range and <em>Full details</em> → Save (.ics). Or File → Open &amp; Export → Import/Export → <em>Export to a file</em> → <em>Comma Separated Values</em> → Calendar (.csv).</li>
              <li><strong>New Outlook / Outlook on the web:</strong> Settings → Calendar → Shared calendars → <em>Publish a calendar</em> → choose “Can view all details” → open the ICS link to download the .ics file. Keep that link private.</li>
              <li><strong>Outlook for Mac:</strong> drag the calendar or selected events to the desktop to create an .ics file, or use File → Export.</li>
              <li><strong>No export available?</strong> Use calendar screenshots (if AI is enabled on this site) or add time manually.</li>
            </ul>
          </li>
          <li>On <button className="link" onClick={onStart}>Generate Timesheet</button>, pick the week, drop in the file, then review every entry: fix hours, choose tasks, exclude what wasn&apos;t work, resolve overlaps, and add missing time.</li>
          <li>Tick the confirmation and click <strong>Download</strong>. The file is named <code>BigTime_Timesheet_YYYY-MM-DD_to_YYYY-MM-DD.csv</code>. Hours are decimal: 3 h 30 min is <code>3.50</code>, never <code>3:30</code>.</li>
        </ol>
      </Card>

      <Card title="Step 2 — Open BigTime Enterprise PSA">
        <p>Sign in to BigTime and open the <strong>Import time</strong> workflow (from your timesheet / time entry area). It has three tabs: <em>1. Choose file</em>, <em>2. Map fields</em>, <em>3. Review time</em>.</p>
      </Card>

      <Card title="Step 3 — Upload the CSV">
        <p>On <em>1. Choose file</em>, select the CSV you downloaded. BigTime accepts up to 500 time cards per file. The badge on <em>3. Review time</em> shows how many rows it read.</p>
      </Card>

      <Card title="Step 4 — Map the fields">
        <p>On <em>2. Map fields</em>, choose the matching column for each BigTime field. The column names in the file are identical to BigTime&apos;s field names.</p>
        <div className="table-wrap mt">
          <table className="map-table">
            <thead>
              <tr>
                <th>BigTime field</th>
                <th>Column from your file</th>
                <th>“How are values formatted?”</th>
              </tr>
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
          BigTime defaults Work Hours to <code>HH:MM</code>. Pick <code>H,HHH.00</code> (period as the decimal point). Leaving <code>HH:MM</code> makes 1.83 hours import wrong or fail. Don&apos;t choose <code>H.HHH,00</code> or <code>H HHH,00</code> — those use a comma for decimals.
        </Notice>
        <div className="figure-grid">
          <GuideFigure src="/guide/map-fields.png" width={611} height={353} alt="BigTime Map fields step with the column dropdown open" caption="Each BigTime field has a dropdown listing your file's columns (with sample values). Client details are redacted here." highlights={[{ left: 25, top: 51, width: 62, height: 28, label: "your file's columns" }]} />
          <GuideFigure src="/guide/work-date-format.png" width={560} height={289} alt="Work Date format dropdown with mm/dd/yyyy selected" caption="Work Date → format mm/dd/yyyy." highlights={[{ left: 25.5, top: 62, width: 64, height: 7.5, label: "mm/dd/yyyy" }]} />
          <GuideFigure src="/guide/work-hours-format.png" width={597} height={290} alt="Work Hours format dropdown showing H,HHH.00 and the HH:MM default" caption="Work Hours → format H,HHH.00 (not the HH:MM default)." highlights={[{ left: 26, top: 35.5, width: 62.5, height: 7, label: "choose H,HHH.00" }, { left: 26, top: 49.5, width: 62.5, height: 7, label: "default — change it", tone: "bad" }]} />
        </div>
      </Card>

      <Card title="Step 5 — Save the mapping">
        <p>Before leaving <em>2. Map fields</em>, use BigTime&apos;s option to save these import settings and name it <strong>CSV Mapping</strong>. Next week, choose <em>CSV Mapping</em> after uploading and every field and format is filled in for you. Because this app always writes the same columns, the saved mapping keeps working.</p>
        <p className="muted small">The exact location of the save option can vary by BigTime version; it appears on the Map fields step (“save your import settings for reuse”).</p>
      </Card>

      <Card title="Step 6 — Review and import">
        <ol className="guide-steps">
          <li>Open <em>3. Review time</em>. Every card should show a real date and the hours from your file. Totals should match the total shown in this app.</li>
          <li>Fill any fields your BigTime setup requires that this file doesn&apos;t include (often <strong>Role</strong> and <strong>Rate</strong>): use <em>Select All for Edit</em> to set them for all cards at once.</li>
          <li>Fix anything flagged with ⚠, then mark the cards for import and complete the import. Check your timesheet in BigTime afterwards.</li>
        </ol>
        <div className="figure-grid">
          <GuideFigure src="/guide/review-time-unmapped.png" width={734} height={610} alt="BigTime Review time step showing unknown date and 0.00 hours" caption="If every card says “unknown date” and 0.00, Work Date / Work Hours / Description weren't mapped — go back to Map fields." highlights={[{ left: 0.5, top: 20.5, width: 25, height: 72, label: "not mapped", tone: "bad" }]} />
          <GuideFigure src="/guide/task-not-matched.png" width={274} height={81} alt="BigTime error: task could not be matched" caption="“This task could not be matched” means the task name includes BigTime's display number. Remove the number on Projects & Tasks and export again." />
        </div>
      </Card>

      <Card title="What works without AI">
        <ul className="checklist">
          <li>✅ Outlook .ics and .csv import (time zones, recurring meetings, cancellations)</li>
          <li>✅ Automatic matching via names, aliases and the <code>CLIENT | TASK | DESCRIPTION</code> convention</li>
          <li>✅ Manual entry, editing, merging, overlap and duplicate checks</li>
          <li>✅ Projects &amp; tasks setup and CSV import/export</li>
          <li>✅ Validated BigTime CSV export and review summary</li>
          <li>🔑 Calendar and BigTime screenshot recognition — needs the site owner to configure an Anthropic API key</li>
        </ul>
      </Card>

      <Card title="Privacy">
        <p>Calendar files are read inside your browser. Your projects, settings and draft timesheet are saved only in this browser&apos;s local storage on this device — clear them any time from Projects &amp; Tasks. Screenshots are sent to the AI service only when you tick the consent box and click extract; this site doesn&apos;t store them.</p>
      </Card>
    </div>
  );
}
