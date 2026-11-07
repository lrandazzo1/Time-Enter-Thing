// End-to-end tests against a production build: first-time setup (Projector Excel report → location →
// Outlook Detailed agenda PDF → extracted meetings → match → review → CSV), returning user, unsupported
// PDFs, privacy audit, accessibility and mobile layout. Optional local-only checks with real files:
//   PRIVATE_PDF=/path/calendar.pdf node e2e/workflows.mjs [baseUrl] [outDir]
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "e2e-output";
mkdirSync(OUT, { recursive: true });
const FIX = path.resolve("tests/fixtures");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const EXPECTED = [
  "Description,Location,Project,Task,Work Date,Work Hours",
  "Forecast model,Main Office,P001234-001,Gears,11/02/2026,3.00",
  "Globex Corporation weekly sync,Main Office,P005678-001,Planning Consultant,11/02/2026,1.00",
  "Smith-Jones Holdings quarterly forecast deep dive and budget reconciliation working session with the finance leadership team,Remote,P002468-002,Consultant,11/03/2026,1.83",
  "TFAG Internal Status,Main Office,P000999-001,Internal - Meeting,11/04/2026,0.50",
  "Late support call,Main Office,P005678-001,Planning Consultant,11/04/2026,1.00",
  "Late support call,Main Office,P005678-001,Planning Consultant,11/05/2026,0.50",
  "Globex - Preparing for Meeting,Main Office,P005678-001,Planning Consultant,11/05/2026,1.00",
].join("\r\n") + "\r\n";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, timezoneId: "America/Chicago", acceptDownloads: true });
const page = await ctx.newPage();
const requests = [];
page.on("request", (r) => requests.push(r));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = async (name) => {
  await page.addStyleTag({ content: ".topbar{position:static !important}" });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};
const card = (t) => page.locator(".group-card").filter({ has: page.locator(".group-events", { hasText: t }) });

/* ---------- first-time setup ---------- */
const t0 = Date.now();
await page.goto(BASE);
await page.getByRole("heading", { name: "Welcome to Timesheet Converter" }).waitFor();
await page.locator('input[type=file][accept*=".xlsx"]').setInputFiles(path.join(FIX, "excel", "projector-report.xlsx"));
await page.getByText(/Detected 6 projects and 10 tasks/).waitFor();
await page.getByRole("button", { name: /Approve all verified \(5\)/ }).click();
const initech = page.locator("tr").filter({ has: page.locator('input[aria-label="Project code"][value="P003141-001"]') });
await initech.getByLabel("Client").fill("Initech");
await initech.getByRole("checkbox").check();
await page.getByRole("button", { name: "Save 6 projects" }).click();
await page.getByText("Step 3 — your BigTime location").waitFor();
check("projects from the Excel report saved; location suggested from the report", (await page.getByPlaceholder("e.g. Main Office").inputValue()) === "Main Office");
await page.getByRole("button", { name: "Continue →" }).click();

await page.getByRole("heading", { name: "Upload Your Outlook Calendar PDF" }).waitFor();
check("calendar step offers only the PDF upload", (await page.locator('input[type=file]').count()) === 1 && (await page.locator('input[type=file]').getAttribute("accept")).includes(".pdf") && (await page.getByText(/\.ics|screenshot/i).count()) === 0);
await shot("pdf-01-upload");

// unsupported PDFs first
const pdfInput = page.locator('input[type=file][accept*=".pdf"]');
await pdfInput.setInputFiles(path.join(FIX, "pdf", "calendar-grid.pdf"));
await page.getByText(/not Outlook's Detailed agenda/).waitFor();
check("calendar-grid PDF rejected with an explanation", true);
await pdfInput.setInputFiles(path.join(FIX, "pdf", "image-only.pdf"));
await page.getByText("This PDF doesn't contain readable meeting details. Please export from Outlook using Detailed agenda.").waitFor();
check("image-only PDF rejected with the required message", true);
await pdfInput.setInputFiles(path.join(FIX, "pdf", "malformed.pdf"));
await page.getByText(/couldn't be opened as a PDF/).waitFor();
check("malformed PDF rejected", true);

await pdfInput.setInputFiles(path.join(FIX, "pdf", "agenda-week.pdf"));
await page.getByText("Meetings to review (10)").waitFor();
const stats = await page.locator(".summary-grid").innerText();
check("extracted-meetings summary: 12 timed meetings, dates, 1 canceled, 2 all-day", /MEETINGS FOUND\s*12/i.test(stats) && /11\/01\/2026 – 11\/07\/2026/.test(stats) && /CANCELED\s*1/i.test(stats) && /ALL-DAY\s*2/i.test(stats), stats.replace(/\s+/g, " "));
check("duplicate meeting reported and kept once", (await page.getByText(/1 duplicate meeting listed twice/).count()) === 1);
check("excluded section lists canceled, all-day and personal items", (await page.getByText("Excluded events (4)").count()) === 1);
await shot("pdf-02-extracted");
await page.getByRole("button", { name: "Match projects →" }).click();

await card("TFAG Internal Status").getByLabel("Project").selectOption({ label: "Our Firm — P000999-001" });
await card("TFAG Internal Status").getByLabel("Task").selectOption("Internal - Meeting");
await shot("pdf-03-match");
await card("TFAG Internal Status").getByRole("button", { name: /Apply to 1/ }).click();
for (const t of ["Budget model revenue planning", "Northwind | Kite Mills", "KM & Northwind"]) await card(t).getByRole("button", { name: /Exclude event/ }).click();
await card("Late support call").getByRole("button", { name: "Confirm" }).click();
check("all included meetings matched", (await page.locator(".group-card").count()) === 0);
await page.getByRole("button", { name: "Review hours →" }).click();
await page.getByText(/Two meetings overlap by 30 minutes/).waitFor();
check("overlap flagged with specific wording, nothing changed automatically", (await page.locator('input[aria-label="Work hours (decimal)"]').first().inputValue()) === "3.50");
await page.getByRole("button", { name: /Keep “Globex Corporation weekly sync”/ }).click();
await page.getByRole("button", { name: /Approve all ready/ }).click();
await shot("pdf-04-review");
await page.getByRole("button", { name: /Continue to export/ }).click();
await page.getByText("Validation passed").waitFor();
const heads = await page.locator(".preview-table thead th").allInnerTexts();
const firstRow = await page.locator(".preview-table tbody tr").first().locator("td").allInnerTexts();
const nameW = await page.locator(".preview-table th.col-pname").evaluate((el) => el.getBoundingClientRect().width);
const codeW = await page.locator(".preview-table th.col-pcode").evaluate((el) => el.getBoundingClientRect().width);
check("export preview: Project Name left of Project Code, names from the Excel report", heads.map((h) => h.toUpperCase()).join("|") === "DESCRIPTION|LOCATION|PROJECT NAME|PROJECT CODE|TASK|WORK DATE|WORK HOURS" && firstRow[2] === "Acme Components - Adaptive Planning - Implementation" && firstRow[3] === "P001234-001" && nameW > codeW, `${firstRow[2]} / ${firstRow[3]} · name ${Math.round(nameW)}px > code ${Math.round(codeW)}px`);
await shot("pdf-04b-export");
await page.getByLabel(/I reviewed these entries/).check();
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download BigTime_Timesheet/ }).click()]);
const csv = readFileSync(await dl.path(), "utf8");
check("CSV: exact six columns, codes, tasks, locations, decimal hours", csv === EXPECTED, csv === EXPECTED ? dl.suggestedFilename() : JSON.stringify(csv));
check("CSV filename uses the PDF's date range", dl.suggestedFilename() === "BigTime_Timesheet_2026-11-01_to_2026-11-07.csv", dl.suggestedFilename());
await page.getByRole("heading", { name: "Setup complete" }).waitFor();
check("setup success state", true, `first-time run ${(Date.now() - t0) / 1000}s (automated)`);
await page.getByRole("button", { name: "Go to my timesheet" }).click();
await shot("pdf-05-done");

/* ---------- returning user ---------- */
await page.reload();
const t1 = Date.now();
await page.getByRole("heading", { name: "This week's timesheet" }).waitFor();
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Start a new week" }).click();
await page.locator('input[type=file][accept*=".pdf"]').setInputFiles(path.join(FIX, "pdf", "agenda-week.pdf"));
await page.getByRole("button", { name: "Match projects →" }).click();
const groups = await page.locator(".group-card").count();
check("remembered match reused (TFAG not asked again)", (await card("TFAG Internal Status").count()) === 0, `${groups} group(s) left`);
for (const t of ["Budget model revenue planning", "Northwind | Kite Mills", "KM & Northwind"]) await card(t).getByRole("button", { name: /Exclude event/ }).click();
const late2 = card("Late support call").getByRole("button", { name: "Confirm" });
if (await late2.count()) await late2.click();
await page.getByRole("button", { name: "Review hours →" }).click();
await page.getByRole("button", { name: /Keep “Globex Corporation weekly sync”/ }).click();
await page.getByRole("button", { name: /Approve all ready/ }).click();
await page.getByRole("button", { name: /Continue to export/ }).click();
await page.getByLabel(/I reviewed these entries/).check();
await page.getByLabel("File encoding").selectOption("windows-1252");
const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download BigTime_Timesheet/ }).click()]);
check("returning user: same CSV (ANSI encoding)", readFileSync(await dl2.path()).toString("latin1") === EXPECTED, `${(Date.now() - t1) / 1000}s (automated)`);

/* ---------- privacy ---------- */
const foreign = requests.filter((r) => !r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url()));
check("no requests to other hosts and no uploads", foreign.length === 0 && requests.every((r) => r.method() === "GET"), `${requests.length} same-origin GET requests`);
check("pdf.js worker served from this site", requests.some((r) => r.url().includes("/pdfjs/pdf.worker.min.mjs")));
const csp = (await (await fetch(BASE)).headers.get("content-security-policy")) ?? "";
check("CSP restricts connections to this site", /connect-src 'self'/.test(csp));

/* ---------- accessibility & mobile ---------- */
const axeSrc = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
for (const hash of ["#home", "#projects", "#help"]) {
  await page.goto(BASE + "/" + hash);
  await page.waitForTimeout(400);
  await page.addScriptTag({ content: axeSrc });
  const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }));
  const serious = res.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  check(`axe: no serious/critical issues on ${hash}`, serious.length === 0, serious.map((v) => `${v.id}(${v.nodes.length})`).join(", "));
}
const state = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await m.newPage();
await mp.goto(BASE);
await mp.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, state);
for (const hash of ["#home", "#projects", "#help"]) {
  await mp.goto(BASE + "/" + hash);
  await mp.waitForTimeout(400);
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  check(`mobile ${hash}: no horizontal scroll`, sw <= 390, `scrollWidth ${sw}`);
}
await mp.screenshot({ path: path.join(OUT, "pdf-mobile-review.png"), fullPage: false });

/* ---------- optional real files (never stored) ---------- */
const realPdf = process.env.PRIVATE_PDF;
if (realPdf && existsSync(realPdf)) {
  const c2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const p2 = await c2.newPage();
  await p2.goto(BASE);
  await p2.evaluate(() => localStorage.setItem("tsc.v1.settings", JSON.stringify({ onboarding: "done" })));
  await p2.reload();
  await p2.locator('input[type=file][accept*=".pdf"]').setInputFiles(realPdf);
  await p2.getByText(/Meetings to review \(\d+\)/).waitFor({ timeout: 60000 });
  const s2 = (await p2.locator(".summary-grid").innerText()).replace(/\s+/g, " ");
  check("real Outlook PDF in the browser", /MEETINGS FOUND 21/i.test(s2) && /CANCELED 4/i.test(s2) && /ALL-DAY 3/i.test(s2), s2);
  await c2.close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
