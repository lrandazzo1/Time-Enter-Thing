// End-to-end tests against a running production build (npm run build && npm start).
// Usage: node e2e/workflows.mjs [baseUrl] [outDir]
// Requires Playwright (global install or `npm i -D playwright`).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const EXPECTED_CSV = [
  "Description,Location,Project,Task,Work Date,Work Hours",
  "Forecast model,Main Office,P001234-001,Gears,11/02/2026,3.25",
  "Globex Corporation weekly sync,Main Office,P005678-001,Planning Consultant,11/02/2026,0.75",
  "P002468-002 budget review,Main Office,P002468-002,Consultant,11/03/2026,1.83",
  "Roadmap workshop,Main Office,P009999-001,Planning,11/04/2026,1.75",
].join("\r\n") + "\r\n";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, timezoneId: "America/Chicago", acceptDownloads: true });
const page = await ctx.newPage();
const requests = [];
page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
const shot = async (name) => {
  await page.addStyleTag({ content: ".topbar{position:static !important}" });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

/* ---------------- First-time user ---------------- */
const t0 = Date.now();
await page.goto(BASE);
await page.getByRole("heading", { name: "Welcome to Timesheet Converter" }).waitFor();
check("first visit shows onboarding wizard", true);
await shot("01-onboarding");

await page.locator('input[type=file][accept*="image/png"]').setInputFiles(["projector-list-1.png", "projector-list-2.png", "projector-list-3.png"].map((f) => path.join(FIX, "projector", f)));
await page.getByRole("button", { name: /Detect projects in 3 screenshots/ }).click();
const ocrStart = Date.now();
await page.getByText(/Detected \d+ projects? and \d+ tasks?/).waitFor({ timeout: 180_000 });
const detected = await page.getByText(/Detected \d+ projects? and \d+ tasks?/).innerText();
check("browser OCR detects projects from 3 screenshots", /Detected 7 projects and 12 tasks/.test(detected), `${detected} in ${((Date.now() - ocrStart) / 1000).toFixed(1)}s`);
await shot("02-project-extraction");
// the orphan task from screenshot 2
await page.getByRole("button", { name: "Add to Our Firm" }).click();
check("orphan task assigned to suggested project after confirmation", await page.getByText("Tasks without a project").count() === 0);
await page.getByRole("button", { name: /Approve all verified \(7\)/ }).click();
await page.getByRole("button", { name: "Save 7 projects" }).click();
await page.getByText("Step 3 — your BigTime location").waitFor();
await page.getByPlaceholder("e.g. Main Office").fill("Main Office");
await page.getByRole("button", { name: "Continue →" }).click();

// calendar
await page.locator('input[type=date]').nth(0).fill("2026-11-02");
await page.locator('input[type=date]').nth(1).fill("2026-11-08");
await page.locator('input[type=file][accept*=".ics"]').setInputFiles(path.join(FIX, "e2e-week.ics"));
await page.getByText(/Imported 7 events/).waitFor();
await page.getByRole("button", { name: "Match work →" }).click();
await page.getByText(/Unrecognized project: Hooli/).waitFor();
await shot("03-match");
const card = (name) => page.locator(".group-card").filter({ has: page.locator(".card-title", { hasText: name }) });
const hooli = card("Hooli");
await hooli.getByRole("tab", { name: "Add new project" }).click();
await hooli.getByLabel("Project code (from Projector)").fill("P009999-001");
await hooli.getByLabel(/Tasks \(separate/).fill("Planning");
await hooli.getByRole("button", { name: "Save project" }).click();
await hooli.getByRole("button", { name: /Apply to 1/ }).click();
const coffee = page.locator(".group-card").filter({ has: page.locator(".group-events", { hasText: "Team coffee chat" }) });
check("unknown meeting without a client hint is labelled clearly", (await page.getByText("No project found for: Team coffee chat").count()) === 1);
await coffee.getByRole("button", { name: /Exclude event/ }).click();
// Globex matched by exact client name; task is single → no group. Code match row has single task too.
check("all remaining work matched", (await page.locator(".group-card").count()) === 0);
await page.getByRole("button", { name: "Review hours →" }).click();
await page.getByText(/Two meetings overlap by 30 minutes/).waitFor();
check("overlap warning is specific", true, "Two meetings overlap by 30 minutes");
await shot("04-review");
await page.getByRole("button", { name: "Split overlap evenly" }).click();
await page.getByRole("button", { name: /Approve all ready \(4\)/ }).click();
await page.getByRole("button", { name: /Continue to export/ }).click();
await page.getByText("Validation passed").waitFor();
await page.getByLabel(/I reviewed these entries/).check();
await shot("05-download");
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download BigTime_Timesheet/ }).click()]);
const csvPath = path.join(OUT, dl.suggestedFilename());
await dl.saveAs(csvPath);
const csv = readFileSync(csvPath, "utf8");
check("first-time CSV matches expected BigTime format exactly", csv === EXPECTED_CSV, csv === EXPECTED_CSV ? dl.suggestedFilename() : JSON.stringify(csv));
await page.getByRole("heading", { name: "Setup complete" }).waitFor();
check("setup success state shown", true, `first-time workflow ${(Date.now() - t0) / 1000}s (automated)`);
await shot("06-setup-complete");

/* ---------------- Returning user ---------------- */
await page.reload();
const t1 = Date.now();
await page.getByRole("heading", { name: "This week's timesheet" }).waitFor();
check("returning user skips setup", (await page.getByText("Welcome to Timesheet Converter").count()) === 0);
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Start a new week" }).click();
await page.locator('input[type=date]').nth(0).fill("2026-11-02");
await page.locator('input[type=date]').nth(1).fill("2026-11-08");
await page.locator('input[type=file][accept*=".ics"]').setInputFiles(path.join(FIX, "e2e-week.ics"));
await page.getByRole("button", { name: "Match work →" }).click();
const groups = await page.locator(".group-card").count();
check("remembered match applied (only the excluded-before coffee chat needs a decision)", groups === 1, `${groups} group(s)`);
await page.locator(".group-card").filter({ has: page.locator(".group-events", { hasText: "Team coffee chat" }) }).getByRole("button", { name: /Exclude event/ }).click();
await page.getByRole("button", { name: "Review hours →" }).click();
await page.getByRole("button", { name: "Split overlap evenly" }).click();
await page.getByRole("button", { name: /Approve all ready/ }).click();
await page.getByRole("button", { name: /Continue to export/ }).click();
await page.getByLabel(/I reviewed these entries/).check();
const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download BigTime_Timesheet/ }).click()]);
const csv2 = readFileSync(await dl2.path(), "utf8");
check("returning-user CSV identical", csv2 === EXPECTED_CSV, csv2 !== EXPECTED_CSV ? JSON.stringify(csv2) : `returning workflow ${(Date.now() - t1) / 1000}s (automated)`);

// ANSI export
await page.getByLabel("File encoding").selectOption("windows-1252");
const [dl3] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download BigTime_Timesheet/ }).click()]);
const ansi = readFileSync(await dl3.path());
check("ANSI export has same bytes for ASCII content", ansi.toString("latin1") === EXPECTED_CSV);

/* ---------------- Paste Projector text (incremental import) ---------------- */
await page.getByRole("link", { name: /Projects/ }).click();
await page.getByRole("button", { name: "Import projects" }).click();
await page.getByRole("tab", { name: /Paste Projector text/ }).click();
await page.getByPlaceholder(/Example:/).fill("Stark Logistics - Adaptive Planning - Implementation P004242-001\n2 Planning\n3 Integration\nAcme Components - Adaptive Planning - Implementation P001234-001\n6 Training");
await page.getByRole("button", { name: "Detect projects" }).click();
await page.getByRole("button", { name: /Approve all verified \(2\)/ }).click();
await page.getByRole("button", { name: "Save 2 projects" }).click();
await page.getByText(/Saved: 1 new project, 1 updated/).waitFor();
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tsc.v1.projects")));
const acme = stored.find((p) => p.code === "P001234-001");
check("incremental import adds new project and merges tasks", stored.length === 9 && acme.tasks.join(",") === "Planning,Gears,Bearings,Precision Parts,Training", `${stored.length} projects; Acme tasks: ${acme.tasks.join(", ")}`);
await shot("07-projects");

/* ---------------- Backup restore (v1 format) ---------------- */
const v1 = { app: "timesheet-converter", version: 1, exportedAt: "2026-11-06T00:00:00Z", projects: [{ id: "x1", client: "Legacy Co", aliases: [], code: "P000111-001", tasks: ["Planning"], defaultTask: "Planning", billable: true }], settings: { timeZone: "America/Chicago", defaultLocation: "Old Office", locationRequired: true, exclusionKeywords: ["lunch"], csvDateOrder: "MDY" } };
writeFileSync(path.join(OUT, "v1-backup.json"), JSON.stringify(v1));
await page.getByRole("tab", { name: /Import a file/ }).click();
page.once("dialog", (d) => d.accept());
await page.locator('input[type=file][accept*=".json"]').setInputFiles(path.join(OUT, "v1-backup.json"));
await page.getByText(/Restored 1 projects/).waitFor();
const s2 = await page.evaluate(() => [JSON.parse(localStorage.getItem("tsc.v1.projects")).length, JSON.parse(localStorage.getItem("tsc.v1.settings")).defaultLocation]);
check("v1 backup restores", s2[0] === 1 && s2[1] === "Old Office", JSON.stringify(s2));

/* ---------------- Privacy ---------------- */
const foreign = requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith("data:") && !r.url.startsWith("blob:"));
const posts = requests.filter((r) => r.method !== "GET");
check("no requests to any other host", foreign.length === 0, foreign.map((r) => r.url).slice(0, 5).join(", ") || `${requests.length} same-origin requests`);
check("no uploads (no POST/PUT requests at all)", posts.length === 0, posts.map((r) => `${r.method} ${r.url}`).join(", "));
const ocrAssets = [...new Set(requests.filter((r) => r.url.includes("/tesseract/")).map((r) => new URL(r.url).pathname))];
check("OCR engine loaded from this site", ocrAssets.length >= 3, ocrAssets.join(", "));
const csp = (await (await fetch(BASE)).headers.get("content-security-policy")) ?? "";
check("Content-Security-Policy restricts connections to this site", /connect-src 'self'/.test(csp));

/* ---------------- Accessibility (axe) ---------------- */
const axeSrc = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
for (const [hash, name] of [["#home", "timesheet"], ["#projects", "projects"], ["#help", "help"]]) {
  await page.goto(BASE + "/" + hash);
  await page.waitForTimeout(400);
  await page.addScriptTag({ content: axeSrc });
  const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }));
  const serious = res.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  check(`axe: no serious/critical WCAG A/AA violations on ${name}`, serious.length === 0, serious.map((v) => `${v.id}(${v.nodes.length})`).join(", "));
}
// keyboard: tab reaches the main nav
await page.goto(BASE);
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
const focused = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40));
check("keyboard focus reaches navigation", Boolean(focused), String(focused));

/* ---------------- Mobile ---------------- */
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Chicago" });
const mp = await m.newPage();
const state = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
await mp.goto(BASE);
await mp.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, state);
for (const hash of ["#home", "#projects", "#help"]) {
  await mp.goto(BASE + "/" + hash);
  await mp.waitForTimeout(400);
  const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  check(`mobile ${hash}: no horizontal scroll`, sw <= 390, `scrollWidth ${sw}`);
  await mp.screenshot({ path: path.join(OUT, `mobile-${hash.slice(1)}.png`), fullPage: true });
}
check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
