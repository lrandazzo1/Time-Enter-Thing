// End-to-end: first-time onboarding with a Projector Excel report, incremental report import from
// the Match step, export. Optional local-only check of a real report: PRIVATE_REPORT=/path/report.xlsx
// Usage: node e2e/excel.mjs [baseUrl] [outDir]
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
  "Forecast model,Main Office,P001234-001,Gears,11/02/2026,3.25",
  "Globex Corporation weekly sync,Main Office,P005678-001,Planning Consultant,11/02/2026,0.75",
  "P002468-002 budget review,Remote,P002468-002,Consultant,11/03/2026,1.83",
  "Data load,Main Office,P004242-001,Integration,11/04/2026,1.00",
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

await page.goto(BASE);
await page.getByRole("heading", { name: "Welcome to Timesheet Converter" }).waitFor();
check("Excel report is the default onboarding option", (await page.getByRole("tab", { name: /Upload Projector Excel report/ }).getAttribute("aria-selected")) === "true");
await shot("excel-01-onboarding");
await page.locator('input[type=file][accept*=".xlsx"]').setInputFiles(path.join(FIX, "excel", "projector-report.xlsx"));
await page.getByText(/Detected 6 projects and 10 tasks/).waitFor();
check("report parsed: 6 projects, 10 tasks", true);
check("report date range from Options sheet shown", (await page.getByText("01-Oct-2026 – 31-Oct-2026").count()) > 0);
check("historical-report warning shown", (await page.getByText(/history of your time cards/).count()) === 1);
check("most common work location preselected", await page.getByLabel(/Main Office/).first().isChecked());
await shot("excel-02-verification");
await page.getByRole("button", { name: /Approve all verified \(5\)/ }).click();
const initech = page.locator("tr").filter({ has: page.locator('input[aria-label="Project code"][value="P003141-001"]') });
await initech.getByLabel("Client").fill("Initech");
await initech.getByRole("checkbox").check();
await page.getByRole("button", { name: "Save 6 projects" }).click();
await page.getByText("Step 3 — your BigTime location").waitFor();
check("default location taken from report", (await page.getByPlaceholder("e.g. Main Office").inputValue()) === "Main Office");
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tsc.v1.projects")));
check("projects saved with exact codes/tasks; Role kept as metadata only", stored.length === 6 && stored[0].tasks.join("|") === "Planning|Gears|Bearings|Precision Parts" && stored[0].roles?.length === 2 && stored.find((p) => p.code === "P002468-002").location === "Remote", stored.map((p) => `${p.code}:${p.tasks.length}`).join(" "));
await page.getByRole("button", { name: "Continue →" }).click();

await page.locator("input[type=date]").nth(0).fill("2026-11-02");
await page.locator("input[type=date]").nth(1).fill("2026-11-08");
await page.locator('input[type=file][accept*=".ics"]').setInputFiles(path.join(FIX, "e2e-week.ics"));
await page.getByText(/Imported 7 events/).waitFor();
await page.getByRole("tab", { name: /Paste event information/ }).click();
await page.getByLabel("Pasted events").fill("11/04/2026 3:00 PM - 4:00 PM Stark Logistics | Integration | Data load");
await page.getByRole("button", { name: "Detect events" }).click();
await page.getByText(/Imported 1 event from pasted text/).waitFor();
await page.getByRole("button", { name: "Match work →" }).click();
const card = (t) => page.locator(".group-card").filter({ has: page.locator(".group-events", { hasText: t }) });
await card("Stark Logistics").getByRole("tab", { name: "Upload newer Projector report" }).click();
await card("Stark Logistics").locator('input[type=file][accept*=".xlsx"]').setInputFiles(path.join(FIX, "excel", "projector-report-grouped.xlsx"));
await card("Stark Logistics").getByRole("button", { name: "Save new projects and tasks" }).click();
await card("Stark Logistics").getByLabel("Project").selectOption({ label: "Stark Logistics — P004242-001" });
await card("Stark Logistics").getByLabel("Task").selectOption("Integration");
await shot("excel-03-match");
await card("Stark Logistics").getByRole("button", { name: /Apply to 1/ }).click();
const after = await page.evaluate(() => JSON.parse(localStorage.getItem("tsc.v1.projects")));
check("newer report added a project without removing saved ones", after.length === 7 && after.find((p) => p.code === "P001234-001").tasks.includes("Training") && after.find((p) => p.code === "P003141-001").client === "Initech", `${after.length} projects`);
for (const t of ["Hooli", "Team coffee chat"]) await card(t).getByRole("button", { name: /Exclude event/ }).click();
await page.getByRole("button", { name: "Review hours →" }).click();
await page.getByRole("button", { name: "Split overlap evenly" }).click();
await page.getByRole("button", { name: /Approve all ready/ }).click();
await shot("excel-04-review");
await page.getByRole("button", { name: /Continue to export/ }).click();
await page.getByLabel(/I reviewed these entries/).check();
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download BigTime_Timesheet/ }).click()]);
const csv = readFileSync(await dl.path(), "utf8");
check("exported CSV: exact six columns, codes, tasks, per-project location, decimal hours", csv === EXPECTED, csv === EXPECTED ? dl.suggestedFilename() : JSON.stringify(csv));
const foreign = requests.filter((r) => !r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url()));
check("no requests to other hosts, no uploads", foreign.length === 0 && requests.every((r) => r.method() === "GET"), `${requests.length} same-origin GET requests`);

// Optional: the real report (never stored in the repo or the app).
const real = process.env.PRIVATE_REPORT;
if (real && existsSync(real)) {
  const c2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const p2 = await c2.newPage();
  await p2.goto(BASE);
  await p2.locator('input[type=file][accept*=".xlsx"]').setInputFiles(real);
  await p2.getByText(/Detected \d+ projects? and \d+ tasks?/).waitFor();
  const summary = await p2.getByText(/Detected \d+ projects? and \d+ tasks?/).innerText();
  const verified = await p2.locator("tbody .badge-success").count();
  const loc = await p2.locator('input[name="report-location"]').count();
  check("real report in the browser", /Detected 6 projects and 9 tasks/.test(summary) && verified === 6 && loc === 1, `${summary} ${verified} verified, ${loc} location option(s)`);
  await c2.close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
writeFileSync(path.join(OUT, "excel-results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
