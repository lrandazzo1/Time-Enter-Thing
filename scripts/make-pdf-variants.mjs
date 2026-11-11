// Synthetic (fictional) Outlook agenda PDFs in other layouts, for the parser's compatibility tests:
//   variant-alt-dates.pdf      month-name / ISO / day-first dates, 24-hour and compact times, bold titles in the
//                              same size as the date line, an icon after times, browser header/footer on each page
//   variant-split-lines.pdf    the date and the time on separate lines, titles split into styled fragments,
//                              several events per page, an event whose title and time fall on different pages,
//                              a canceled meeting, overlapping meetings, a time range inside a description
//   variant-classic.pdf        day headings with a time column and the title beside the time (date from the heading)
//   variant-partial.pdf        mostly valid, plus a start time without an end and an unusually long meeting
//   variant-unrecognized.pdf   readable calendar text without any start–end times
//   variant-image-agenda.pdf   an agenda page embedded only as an image (no text layer) — for text recognition
//   variant-undecodable.pdf    text drawn with a font that has no Unicode mapping (hand-written PDF)
//   agenda-image.png           the same image as variant-image-agenda.pdf, for the Node OCR test
//   variant-image-long.pdf     a 24-page image-only agenda (one meeting per page) — longer than the old 20-page OCR cap
// Run: node scripts/make-pdf-variants.mjs   (needs Playwright)
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = "tests/fixtures/pdf/";

const people = (n, domain) => Array.from({ length: n }, (_, i) => `Person ${i + 1} &lt;person${i + 1}@${domain}&gt;`).join("; ") + ";";
const lorem = (n) => Array.from({ length: n }, (_, i) => `Discussion point ${i + 1}: review the forecast assumptions, confirm owners and agree on next steps for the planning model.`).join(" ");
const icon = "<span>&#xE895;</span>";

/* ---------- 1. alternative date/time notations ---------- */
const alt = `<!doctype html><html><head><title>Calendar - Pat Example - Outlook</title><style>
  @page { size: Letter; margin: 0.7in 0.5in; }
  body { font-family: Arial, sans-serif; font-size: 10pt; }
  .day { font-size: 13pt; font-weight: bold; margin: 16pt 0 8pt; }
  .ev { margin: 0 0 16pt 0; } .t { font-weight: bold; } .meta { margin: 2pt 0; }
</style></head><body>
<div>11/2/2026 to 11/6/2026</div><div>Calendar</div>
<div class="day">Monday, 2 November 2026</div>
<div class="ev"><div class="t">PTO - Pat Example</div><div>Mon 11/2/2026 to Fri 11/6/2026</div><div class="meta">Organizer: Pat Example</div></div>
<div class="ev"><div class="t">Acme Components | Gears | Forecast model</div><div>Mon, Nov 2, 2026 9:30 AM – 10:00 AM ${icon}</div><div class="meta">Location: Microsoft Teams Meeting</div><div class="meta">Organizer: Acme Components</div><div class="meta">Required Attendees: ${people(6, "acme.example")}</div></div>
<div class="ev"><div class="t">Globex Corporation weekly sync</div><div>Monday, November 2, 2026 13:00 - 14:30</div><div class="meta">Organizer: Globex Corporation</div><div class="meta">${lorem(6)}</div></div>
<div class="day">Tuesday, 3 November 2026</div>
<div class="ev"><div class="t">PTO - Pat Example</div><div>Mon 11/2/2026 to Fri 11/6/2026</div></div>
<div class="ev"><div class="t">Smith-Jones Holdings review</div><div>Tue 2026-11-03 9:00AM-10:15AM</div><div class="meta">Location: Conference Room B</div></div>
<div class="ev"><div class="t">Initech planning</div><div>Tue 03/11/2026 15:00 – 16:00</div><div class="meta">${lorem(8)}</div></div>
<div class="day">Wednesday, 4 November 2026</div>
<div class="ev"><div class="t">Late support call</div><div>Wed 11/4/2026 11:00 PM - Thu 11/5/2026 12:30 AM</div><div class="meta">Organizer: Globex Corporation</div></div>
<div class="day">Thursday, 5 November 2026</div>
<div class="ev"><div class="t">Budget review</div><div>Thu 11/5/2026 9:30 - 11:00 AM</div><div class="meta">${lorem(10)}</div></div>
</body></html>`;

/* ---------- 2. date and time on separate lines, split titles, page-spanning event ---------- */
const splitEv = (titleHtml, date, time, body = "", breakBefore = false) => `
  <div class="ev"><div class="t">${titleHtml}</div>
  <div class="when"${breakBefore ? ' style="break-before: page"' : ""}>${date}</div><div class="when">${time}</div>
  <div class="meta">Location: Microsoft Teams Meeting</div><div class="meta">Required Attendees: ${people(3, "ourfirm.example")}</div>${body}</div>`;
const split = `<!doctype html><html><head><style>
  @page { size: Letter; margin: 0.5in; }
  body { font-family: Arial, sans-serif; }
  .day { font-size: 14pt; font-weight: bold; margin: 16pt 0 8pt; }
  .ev { margin: 0 0 18pt 0; } .t { font-size: 12pt; font-weight: bold; } .when, .meta { font-size: 10pt; margin: 1pt 0; }
</style></head><body>
<div style="font-size:10pt">2026-11-02 to 2026-11-06</div>
<div class="day">Monday, November 02, 2026</div>
${splitEv('<span>Acme</span><span style="color:#333"> Components</span> | <span style="color:#1a4">Planning</span> | Kickoff', "Mon 11/2/2026", "9:00 AM - 10:30 AM")}
${splitEv("Globex Corporation weekly sync", "Mon 11/2/2026", "10:00 AM - 11:00 AM")}
${splitEv("Canceled: Smith-Jones Holdings review", "Mon 11/2/2026", "1:00 PM - 2:00 PM")}
<div class="day">Tuesday, November 03, 2026</div>
${splitEv("Northwind quarterly planning", "Tue 11/3/2026", "9:00 AM - 12:00 PM", `<div class="meta">Agenda:</div><div class="meta">9:00 - 9:15 Introductions</div><div class="meta">${lorem(14)}</div>`)}
${splitEv("Initech integration workshop", "Tue 11/3/2026", "1:00 PM - 3:00 PM", "", true)}
<div class="day">Wednesday, November 04, 2026</div>
${splitEv("Umbrella Health status", "Wed 11/4/2026", "8:30 AM - 9:00 AM")}
</body></html>`;

/* ---------- 3. classic layout: time column, title beside the time ---------- */
const row = (time, title, rest = []) => `<tr><td class="tm">${time}</td><td><div class="t">${title}</div>${rest.map((r) => `<div class="meta">${r}</div>`).join("")}</td></tr>`;
const classic = `<!doctype html><html><head><style>
  @page { size: Letter; margin: 0.5in; }
  body { font-family: "Times New Roman", serif; font-size: 10pt; }
  .day { font-size: 12pt; font-weight: bold; margin: 14pt 0 6pt; border-bottom: 1px solid #000; }
  table { border-collapse: collapse; width: 100%; } td { vertical-align: top; padding: 3pt 0; } .tm { width: 1.6in; } .t { font-weight: bold; }
</style></head><body>
<div style="font-size:14pt;font-weight:bold">Pat Example</div><div>November 02, 2026 - November 03, 2026</div>
<div class="day">Monday, November 02, 2026</div>
<table>${row("9:00 AM - 10:00 AM", "Acme Components | Gears | Design review", ["Location: Conference Room", "Organizer: Acme Components", "Notes: 2:00 PM - 3:00 PM follow-up if needed"])}
${row("1:00 PM - 2:30 PM", "Globex Corporation weekly sync", ["Organizer: Globex Corporation"])}</table>
<div class="day">Tuesday, November 03, 2026</div>
<table>${row("10:00 AM - 11:00 AM", "Canceled: Initech status", ["Organizer: Initech"])}
${row("3:00 PM - 4:00 PM", "Smith-Jones Holdings review", ["Location: Remote"])}</table>
</body></html>`;

/* ---------- 4. partly interpretable ---------- */
const nev = (title, when, extra = "") => `<div class="ev"><div class="t">${title}</div><div class="w">${when}</div><div class="meta">Organizer: Sam Organizer</div>${extra}</div>`;
const newCss = `@page { size: Letter; margin: 0.5in; } body { font-family: Arial, sans-serif; } .day { font-size: 14pt; font-weight: bold; margin: 14pt 0 8pt; } .ev { margin-bottom: 16pt; } .t { font-size: 12pt; font-weight: bold; } .w, .meta { font-size: 10pt; }`;
const partial = `<!doctype html><html><head><style>${newCss}</style></head><body>
<div style="font-size:10pt">11/2/2026 to 11/3/2026</div>
<div class="day">Monday, November 2, 2026</div>
${nev("Acme Components | Gears | Forecast model", "Mon 11/2/2026 9:00 AM - 10:00 AM")}
${nev("Quarterly roadmap", "Mon 11/2/2026 2:00 PM")}
${nev("Globex Corporation weekly sync", "Mon 11/2/2026 3:00 PM - 4:00 PM")}
<div class="day">Tuesday, November 3, 2026</div>
${nev("Overnight data load", "Tue 11/3/2026 9:30 AM - 9:00 AM")}
${nev("Smith-Jones Holdings review", "Tue 11/3/2026 10:00 AM - 10:45 AM")}
</body></html>`;

/* ---------- 5. readable but no start–end times ---------- */
const unrecognized = `<!doctype html><html><head><style>${newCss}</style></head><body>
<div style="font-size:10pt">Calendar list</div>
<div class="day">Monday, November 2, 2026</div>
<div class="ev"><div class="t">Acme Components weekly</div><div class="w">Thirty minutes, morning</div></div>
<div class="ev"><div class="t">Globex Corporation sync</div><div class="w">One hour, after lunch</div></div>
<div class="day">Tuesday, November 3, 2026</div>
<div class="ev"><div class="t">Smith-Jones Holdings review</div><div class="w">Forty-five minutes</div></div>
</body></html>`;

/* ---------- 6. image-only agenda (for text recognition) ---------- */
const imageAgenda = `<!doctype html><html><head><style>
  body { font-family: Arial, sans-serif; margin: 40px; width: 720px; background: #fff; color: #000; }
  .day { font-size: 22px; font-weight: bold; margin: 22px 0 12px; } .ev { margin-bottom: 22px; } .t { font-size: 19px; font-weight: bold; } .w, .meta { font-size: 15px; margin-top: 2px; }
</style></head><body>
<div style="font-size:15px">11/2/2026 to 11/3/2026</div>
<div class="day">Monday, November 2, 2026</div>
<div class="ev"><div class="t">Acme Components | Gears | Forecast model</div><div class="w">Mon 11/2/2026 9:00 AM - 10:30 AM</div><div class="meta">Location: Microsoft Teams Meeting</div></div>
<div class="ev"><div class="t">Globex Corporation weekly sync</div><div class="w">Mon 11/2/2026 1:00 PM - 2:00 PM</div><div class="meta">Organizer: Globex Corporation</div></div>
<div class="day">Tuesday, November 3, 2026</div>
<div class="ev"><div class="t">Smith-Jones Holdings review</div><div class="w">Tue 11/3/2026 3:00 PM - 4:00 PM</div><div class="meta">Location: Remote</div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const pdf = async (name, html, opts = {}) => {
  await page.setContent(html);
  await page.pdf({ path: OUT + name, format: "Letter", printBackground: true, preferCSSPageSize: true, ...opts });
};
await pdf("variant-alt-dates.pdf", alt, {
  displayHeaderFooter: true,
  headerTemplate: '<div style="font-size:8px;width:100%;padding:0 0.5in"><span class="date"></span>&nbsp;&nbsp;<span class="title"></span></div>',
  footerTemplate: '<div style="font-size:8px;width:100%;padding:0 0.5in"><span class="url"></span>&nbsp;&nbsp;<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
});
await pdf("variant-split-lines.pdf", split);
await pdf("variant-classic.pdf", classic);
await pdf("variant-partial.pdf", partial);
await pdf("variant-unrecognized.pdf", unrecognized);

const shot = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
await shot.setContent(imageAgenda);
const png = await shot.screenshot({ fullPage: true });
writeFileSync(OUT + "agenda-image.png", png);
await page.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}" style="width:100%"></body></html>`);
await page.pdf({ path: OUT + "variant-image-agenda.pdf", format: "Letter", printBackground: true });

// 24 image-only pages, one meeting each (Mon–Fri, five per day), each page a separate picture.
const clients = ["Acme Components", "Globex Corporation", "Initech", "Umbrella Health", "Northwind Traders", "Stark Logistics"];
const longShot = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
const imgs = [];
for (let i = 1; i <= 24; i++) {
  const d = 2 + Math.floor((i - 1) / 5);
  const wd = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][d - 2];
  const h = 8 + ((i - 1) % 5);
  const t12 = (x) => `${x > 12 ? x - 12 : x}:00 ${x >= 12 ? "PM" : "AM"}`;
  await longShot.setContent(`<!doctype html><html><body style="font-family:Arial,sans-serif;margin:48px;color:#000;background:#fff">
    ${i === 1 ? '<div style="font-size:15px">11/2/2026 to 11/6/2026</div>' : ""}
    ${(i - 1) % 5 === 0 ? `<div style="font-size:22px;font-weight:bold;margin:20px 0 14px">${wd}, November ${d}, 2026</div>` : ""}
    <div style="font-size:19px;font-weight:bold">${clients[i % clients.length]} | Planning | Session ${i}</div>
    <div style="font-size:15px;margin-top:2px">${wd.slice(0, 3)} 11/${d}/2026 ${t12(h)} - ${t12(h + 1)}</div>
    <div style="font-size:15px;margin-top:10px">Location: Microsoft Teams Meeting</div>
    <div style="font-size:15px">Organizer: Sam Organizer</div>
    <div style="font-size:15px">Required Attendees: Person One; Person Two; Person Three;</div>
  </body></html>`);
  imgs.push((await longShot.screenshot({ type: "png" })).toString("base64"));
}
await page.setContent(`<html><body style="margin:0">${imgs.map((b, k) => `<img src="data:image/png;base64,${b}" style="width:100%;display:block;${k ? "break-before:page" : ""}">`).join("")}</body></html>`);
await page.pdf({ path: OUT + "variant-image-long.pdf", format: "Letter", printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
await browser.close();

/* ---------- 7. hand-written PDF whose font has no Unicode mapping ---------- */
const glyph = "500 0 0 0 400 600 d1 0 0 400 600 re f";
const lines = Array.from({ length: 12 }, (_, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td <0102030405060708090a0b0c0d0e0f10> Tj ET`).join("\n");
const objs = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`,
  `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 500 600] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs 6 0 R /Encoding << /Type /Encoding /Differences [1 ${Array.from({ length: 16 }, (_, i) => `/glyph${i + 1}`).join(" ")}] >> /FirstChar 1 /LastChar 16 /Widths [${Array(16).fill(500).join(" ")}] /Resources << >> >>`,
  `<< ${Array.from({ length: 16 }, (_, i) => `/glyph${i + 1} 7 0 R`).join(" ")} >>`,
  `<< /Length ${glyph.length} >>\nstream\n${glyph}\nendstream`,
];
let body = "%PDF-1.4\n";
const offsets = [];
objs.forEach((o, i) => {
  offsets.push(body.length);
  body += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = body.length;
body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(OUT + "variant-undecodable.pdf", body);
console.log("pdf variants written");
