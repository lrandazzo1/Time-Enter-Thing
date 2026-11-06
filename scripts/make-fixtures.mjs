// Renders synthetic (fictional) Projector-style project/task list screenshots used by the OCR
// integration tests and the Help page. Requires Playwright (`npm i -D playwright` or a global install).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const OUT = "tests/fixtures/projector";
mkdirSync(OUT, { recursive: true });

const P = (name, code, tasks) => ({ name, code, tasks });
const sets = {
  "projector-list-1": {
    header: true,
    rows: [
      P("Acme Components - Adaptive Planning - Implementation", "P001234-001", ["2 Planning", "3 Gears", "4 Bearings", "5 Precision Parts"]),
      P("Globex Corporation - Adaptive Planning - MSP", "P005678-001", [["3 Planning Consultant", "LATE"]]),
      P("Smith-Jones Holdings - Adaptive Planning - Implementation", "P002468-002", ["2 Consultant"]),
      P("Our Firm - Internal", "P000999-001", ["5 Internal - Meeting"]),
    ],
  },
  "projector-list-2": {
    header: false,
    leading: ["11 Internal - Training"],
    rows: [
      P("The Metro Public Library (MPL) - Adaptive Planning - Implementation", "P007979-001", ["2 Planning"]),
      P("Initech - Workday Adaptive Planning - Support", "P003141-001", ["2 Support", "3 Integration"]),
    ],
  },
  "projector-list-3": {
    header: false,
    rows: [
      P("Initech - Workday Adaptive Planning - Support", "P003141-001", ["3 Integration", "4 Training"]),
      P("Umbrella Health - Adaptive Planning - Implementation", "P008080-003", ["3 Planning"]),
    ],
  },
};

const css = (dark) => `
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; background: ${dark ? "#1f2329" : "#fff"}; color: ${dark ? "#e6e6e6" : "#222"}; }
  .bar { background: ${dark ? "#2b3038" : "#2d5f8b"}; color: #fff; padding: 8px 14px; font-weight: bold; }
  .tools { padding: 10px 14px; display: flex; gap: 10px; align-items: center; border-bottom: 1px solid ${dark ? "#3a3f47" : "#ddd"}; }
  .tools input { border: 1px solid #aaa; padding: 4px 6px; width: 240px; font-size: 13px; }
  .proj { padding: 7px 14px 5px; font-weight: bold; border-top: 1px solid ${dark ? "#3a3f47" : "#e4e4e4"}; background: ${dark ? "#262a31" : "#f6f8fa"}; }
  .caret { display: inline-block; width: 14px; color: #888; }
  .task { padding: 5px 14px 5px 44px; }
  .badge { background: #c0392b; color: #fff; font-size: 10px; font-weight: bold; padding: 1px 5px; border-radius: 3px; margin-left: 8px; }
`;

function html(set, dark) {
  const rows = [];
  if (set.header) rows.push(`<div class="bar">Select Project / Task</div><div class="tools">Search <input value=""> <span>Expand all</span></div>`);
  for (const t of set.leading ?? []) rows.push(`<div class="task">${t}</div>`);
  for (const p of set.rows) {
    rows.push(`<div class="proj"><span class="caret">▾</span>${p.name} ${p.code}</div>`);
    for (const t of p.tasks) {
      const [label, badge] = Array.isArray(t) ? t : [t];
      rows.push(`<div class="task">${label}${badge ? `<span class="badge">${badge}</span>` : ""}</div>`);
    }
  }
  return `<!doctype html><html><head><style>${css(dark)}</style></head><body>${rows.join("")}</body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 200 }, deviceScaleFactor: 1 });
const manifest = {};
for (const [name, set] of Object.entries(sets)) {
  for (const dark of [false, true]) {
    if (dark && name !== "projector-list-1") continue;
    const file = `${name}${dark ? "-dark" : ""}.png`;
    await page.setContent(html(set, dark));
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
    manifest[file] = set;
  }
}
writeFileSync(`${OUT}/expected.json`, JSON.stringify(manifest, null, 2));

// Degraded copy: 60% scale + heavy JPEG compression (simulates a small, blurry screenshot).
await page.setViewportSize({ width: 456, height: 200 });
await page.setContent(`<html><body style="margin:0"><img id="i" src="data:image/png;base64,${readFileSync(`${OUT}/projector-list-1.png`).toString("base64")}" style="width:456px;image-rendering:auto"></body></html>`);
await page.waitForTimeout(100);
const jpg = await page.locator("#i").screenshot({ type: "jpeg", quality: 35 });
await page.setContent(`<html><body style="margin:0"><img id="j" src="data:image/jpeg;base64,${jpg.toString("base64")}"></body></html>`);
await page.waitForTimeout(100);
await page.locator("#j").screenshot({ path: `${OUT}/projector-list-1-degraded.png` }); // PNG of a JPEG-damaged image

// Synthetic Outlook-style work-week calendar screenshot.
const days = [["Mon 11/2", [["9:00 AM - 10:30 AM", "Acme Components | Gears | Forecast model"], ["", "Globex Corporation weekly sync"]]], ["Tue 11/3", [["1:00 PM - 2:15 PM", "Initech planning review"]]], ["Wed 11/4", [["", "Umbrella Health workshop"]]]];
const cal = `<!doctype html><html><head><style>
 body{margin:0;font-family:"Segoe UI",Arial,sans-serif;font-size:13px;background:#fff;color:#201f1e}
 .grid{display:grid;grid-template-columns:60px repeat(3,230px);}
 .hdr{padding:8px 10px;border-bottom:1px solid #ddd;font-weight:600;font-size:14px}
 .col{border-left:1px solid #e1dfdd;min-height:420px;padding:6px;display:flex;flex-direction:column;gap:18px}
 .time{color:#605e5c;font-size:12px;padding:6px;line-height:60px}
 .ev{background:#deecf9;border-left:4px solid #0078d4;padding:6px 8px;border-radius:2px}
 .ev .t{font-weight:600}.ev .s{font-size:12px;color:#323130}
</style></head><body><div class="grid"><div class="hdr"></div>${days.map(([d]) => `<div class="hdr">${d}</div>`).join("")}
<div class="time">9 AM<br>10<br>11<br>12 PM<br>1<br>2</div>${days.map(([, evs]) => `<div class="col">${evs.map(([t, n]) => `<div class="ev"><div class="t">${n}</div>${t ? `<div class="s">${t}</div>` : ""}<div class="s">Microsoft Teams Meeting</div></div>`).join("")}</div>`).join("")}</div></body></html>`;
await page.setViewportSize({ width: 760, height: 460 });
await page.setContent(cal);
await page.screenshot({ path: "tests/fixtures/calendar-week.png" });
console.log("fixtures written to", OUT);

await browser.close();
