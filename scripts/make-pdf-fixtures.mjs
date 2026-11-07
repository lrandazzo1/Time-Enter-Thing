// Synthetic (fictional) Outlook "Detailed agenda" PDFs for tests, mirroring the real export's layout:
// range header, day headings (14pt), titles (12pt bold), "Ddd YYYY-MM-DD h:mm AM - h:mm PM" lines,
// Location/Organizer/Attendees labels, Teams boilerplate, separators, confidentiality notices.
// Also a calendar-grid PDF (not supported), an image-only PDF, and a malformed file.
// Run: node scripts/make-pdf-fixtures.mjs   (needs Playwright)
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = "tests/fixtures/pdf/";

const people = (n, domain) => Array.from({ length: n }, (_, i) => `Person ${i + 1} &lt;person${i + 1}@${domain}&gt;`).join("; ") + ";";
const teams = (id) => `
  <div class="sep">________________________________________________________________________________</div>
  <div class="teams">Microsoft Teams meeting</div>
  <div class="teams">Join: https://teams.microsoft.com/meet/${id}?p=AbCdEf123</div>
  <div class="small">Meeting ID: ${id.match(/.{1,3}/g).join(" ")}</div>
  <div class="small">Passcode: Xy7${id.slice(0, 4)}</div>
  <div class="small">Need help? | System reference</div>
  <div class="teams">Dial in by phone</div>
  <div class="small">+1 555-010-0199,,${id.slice(0, 9)}# United States, Springfield</div>
  <div class="small">Find a local number</div>
  <div class="small">Phone conference ID: ${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6, 9)}#</div>
  <div class="small">For organizers: Meeting options | Reset dial-in PIN</div>
  <div class="sep">________________________________________________________________________________</div>`;
const notice = `<div class="body">This e-mail transmission contains information that is confidential and may be privileged. It is intended only for the addressee(s) named above. If you receive this e-mail in error, please do not read, copy or disseminate any of its contents, in whole or in part.</div>`;
const ev = (title, when, { org, loc = "Microsoft Teams Meeting", req = 4, domain = "ourfirm.example", extra = "", id = "123456789012345" } = {}) => `
  <div class="ev">
    <div class="title">${title}</div>
    <div class="when">${when}</div>
    ${loc ? `<div class="meta"><b>Location:</b> ${loc}</div>` : ""}
    ${org ? `<div class="meta"><b>Organizer:</b> ${org}</div>` : ""}
    <div class="meta"><b>Required Attendees:</b> ${people(req, domain)} Me Example &lt;me@ourfirm.example&gt;;</div>
    ${extra}
    ${loc ? teams(id) : ""}
  </div>`;
const allDay = (title, when, org) => `<div class="ev"><div class="title">${title}</div><div class="when">${when}</div><div class="meta"><b>Organizer:</b> ${org}</div><div class="meta"><b>Required Attendees:</b> ${people(14, "ourfirm.example")}</div></div>`;
const day = (h) => `<div class="day">${h}</div>`;

const css = `
  @page { size: Letter; margin: 0.4in 0.45in; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  .hdr { font-size: 10pt; } .hdr2 { font-size: 10pt; margin-bottom: 30pt; }
  .day { font-size: 14pt; font-weight: bold; margin: 18pt 0 10pt -10pt; }
  .ev { margin: 0 0 22pt 0; }
  .title { font-size: 12pt; font-weight: bold; }
  .when { font-size: 10pt; margin-bottom: 8pt; }
  .meta, .body { font-size: 10pt; margin: 2pt 0; }
  .teams { font-size: 12pt; margin: 8pt 0 2pt; font-family: "Segoe UI", Arial, sans-serif; }
  .small { font-size: 8pt; margin: 4pt 0; }
  .sep { font-size: 10pt; margin: 8pt 0; }
`;

const agenda = `<!doctype html><html><head><style>${css}</style></head><body>
<div class="hdr">2026-11-01 to 2026-11-07</div><div class="hdr2">Calendar</div>
${day("Monday, November 02, 2026")}
${allDay("PTO - Pat Example", "Mon 2026-11-02 to Fri 2026-11-06", "Pat Example")}
${ev("Canceled: Acme Components | Planning | Review", "Mon 2026-11-02 10:00 AM - 11:00 AM", { org: "Acme Components", domain: "acme.example", id: "225827538330886" })}
${ev("Acme Components | Gears | Forecast model", "Mon 2026-11-02 9:00 AM - 12:30 PM", { loc: "", req: 2 })}
${ev("Globex Corporation weekly sync", "Mon 2026-11-02 12:00 PM - 1:00 PM", { org: "Globex Corporation", domain: "globex.example", req: 30, id: "228326846547490", extra: notice })}
${day("Tuesday, November 03, 2026")}
${allDay("PTO - Pat Example", "Mon 2026-11-02 to Fri 2026-11-06", "Pat Example")}
${ev("Northwind | Kite Mills: Rules Working Session", "Tue 2026-11-03 9:30 AM - 10:00 AM", { org: "Kite Mills", domain: "kitemills.example", id: "283195740976944" })}
${ev("Smith-Jones Holdings quarterly forecast deep dive and budget reconciliation working session with the finance leadership team", "Tue 2026-11-03 10:00 AM - 11:50 AM", { org: "Sam Organizer", domain: "smithjones.example", id: "214525407915536" })}
${ev("Budget model revenue planning", "Tue 2026-11-03 1:00 PM - 2:00 PM", { org: "Sam Organizer", domain: "northwindhomes.org", id: "212400340930232" })}
${ev("Budget model revenue planning", "Tue 2026-11-03 1:00 PM - 2:00 PM", { org: "Sam Organizer", domain: "northwindhomes.org", id: "212400340930232" })}
${day("Wednesday, November 04, 2026")}
${allDay("PTO - Pat Example", "Mon 2026-11-02 to Fri 2026-11-06", "Pat Example")}
${ev("TFAG Internal Status", "Wed 2026-11-04 10:30 AM - 11:00 AM", { org: "Taylor Lead", id: "213550360791375" })}
${ev("Lunch &amp; learn: forecasting tips", "Wed 2026-11-04 11:30 AM - 1:15 PM", { org: "Taylor Lead", id: "237509290714394" })}
${ev("Late support call", "Wed 2026-11-04 11:00 PM - Thu 2026-11-05 12:30 AM", { org: "Globex Corporation", domain: "globex.example", id: "214990925556256" })}
${day("Thursday, November 05, 2026")}
${allDay("PTO - Pat Example", "Mon 2026-11-02 to Fri 2026-11-06", "Pat Example")}
${allDay("Company Holiday", "Thu 2026-11-05", "Office Admin")}
${ev("KM &amp; Northwind / Gears Requirement Session", "Thu 2026-11-05 1:00 PM - 2:00 PM", { org: "Kite Mills", domain: "kitemills.example", id: "278423826176608" })}
${ev("Globex - Preparing for Meeting", "Thu 2026-11-05 3:00 PM - 4:00 PM", { loc: "", req: 1 })}
${day("Friday, November 06, 2026")}
${allDay("PTO - Pat Example", "Mon 2026-11-02 to Fri 2026-11-06", "Pat Example")}
</body></html>`;

const grid = `<!doctype html><html><head><style>
  @page { size: Letter landscape; margin: 0.4in; } body { font-family: Arial; font-size: 9pt; }
  table { border-collapse: collapse; width: 100%; } td, th { border: 1px solid #999; vertical-align: top; height: 60px; padding: 2px; }
</style></head><body><div style="font-size:14pt">November 02, 2026 - November 06, 2026</div>
<table><tr><th></th><th>Monday 2</th><th>Tuesday 3</th><th>Wednesday 4</th><th>Thursday 5</th><th>Friday 6</th></tr>
<tr><td>9 AM</td><td>Acme Components | Gea...</td><td>Northwind | Kite Mi...</td><td></td><td></td><td></td></tr>
<tr><td>10 AM</td><td>Canceled: Acme Co...</td><td>Smith-Jones Holdi...</td><td>TFAG Internal St...</td><td></td><td></td></tr>
<tr><td>12 PM</td><td>Globex Corporation...</td><td></td><td>Lunch &amp; learn...</td><td></td><td></td></tr></table></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, html] of [["agenda-week.pdf", agenda], ["calendar-grid.pdf", grid]]) {
  await page.setContent(html);
  await page.pdf({ path: OUT + name, format: "Letter", landscape: name.includes("grid"), printBackground: true, preferCSSPageSize: true });
}
// Image-only PDF: a screenshot of the grid embedded as an image (no text layer).
await page.setContent(grid);
const png = await page.screenshot({ fullPage: true });
await page.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}" style="width:100%"></body></html>`);
await page.pdf({ path: OUT + "image-only.pdf", format: "Letter", printBackground: true });
writeFileSync(OUT + "malformed.pdf", "%PDF-1.7\nthis is not really a pdf\n%%EOF\n");
await browser.close();
console.log("pdf fixtures written");
