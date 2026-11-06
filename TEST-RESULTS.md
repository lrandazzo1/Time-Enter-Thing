# Test results — Timesheet Converter 2.1

Run on the final code in this ZIP (Node 22, Chromium via Playwright).

## Summary

| Suite | Result |
|---|---|
| Unit + OCR + Excel integration tests (Vitest) | **104 passed, 0 failed** (10 files; the real-report test is skipped unless a local file is supplied) |
| Excel-report onboarding end-to-end (Playwright, production build) | **12/12 passed** |
| Original workflow end-to-end (screenshots OCR, returning user, privacy, accessibility, mobile) | **26/26 passed** |
| Production build (`npm run build`) | **Passed** — static pages only; no API routes, no environment variables |
| Clean install from this ZIP with all AI variables removed | **Passed** (`npm ci`, `npm run build`, `npm test`) |

## Your real Projector report (`Test 2026-11-06 13-36-59.xlsx`)

Used locally as the primary integration input; **it is not included in this ZIP, the repository or the app**. Checked with `tests/excel.private.test.ts` (Node) and `e2e/excel.mjs` (browser):

- Workbook sheets `Report`, `Options`, `Debug` → `Report` selected; header on row 1; columns Project, Role, Work Location, Task Name mapped.
- 26 time-card rows de-duplicated into **6 projects / 9 tasks**; every project code taken from the final parentheses and valid; one project with 4 tasks kept all 4; task names exact; Role values (which include a person's name on one project) kept only as metadata — never as tasks or in the CSV.
- Clients separated correctly for all 6 project names; the internal non-billable project was flagged as internal.
- Work Location: one value on all 26 rows → suggested as the default location.
- `Options` sheet: date range shown as “25-Oct-2026 – 31-Oct-2026”; filters (resource search string, approved time cards only, etc.) listed. No employee column exists, so no employee filter is shown.
- In the browser: “Detected 6 projects and 9 tasks”, all 6 *Verified*, one location option.
- The codes and tasks agree with the project list you confirmed earlier in this conversation.
- Matching your real Nov 2–6 calendar against only these 6 projects: client meetings named after a client (e.g. “Client | OurFirm … Working Session”, “OurFirm | Client: … Session”) matched the right project and task; meetings that only mention your own company or say “internal” are now offered as choices instead of being assigned (this was a real bug found with your data and fixed); projects missing from the report (one-week report) appear as unrecognised — as intended.

## Unit and integration tests

**tests/excel.test.ts** (19)

- ✓ project cell > Globex - Adaptive Planning - MSP (P005678-001)
- ✓ project cell > The Metro Public Library (MPL) - Adaptive Planning - Implementation (P007979-001)
- ✓ project cell > Smith-Jones Holdings - Adaptive Planning - Implementation (P002468-002)
- ✓ project cell > Odd Co - Retainer ( P000001-010 )
- ✓ project cell > No Code Project - Support
- ✓ project cell > Acme (Holdings) - Planning
- ✓ Projector report (synthetic replica of the real layout) > selects the Report sheet and maps the columns
- ✓ Projector report (synthetic replica of the real layout) > extracts codes, names, clients and de-duplicates rows with all distinct tasks
- ✓ Projector report (synthetic replica of the real layout) > asks for confirmation when the client can't be separated from the project name
- ✓ Projector report (synthetic replica of the real layout) > collects locations (most frequent first) and per-project locations
- ✓ Projector report (synthetic replica of the real layout) > keeps Role only as metadata (never as a task)
- ✓ Projector report (synthetic replica of the real layout) > reads the Options sheet for the date range and filters
- ✓ other report layouts > handles title rows, grouped project cells, total rows and reordered columns
- ✓ other report layouts > reads .xlsm workbooks as data only
- ✓ other report layouts > rejects workbooks that aren't Projector reports
- ✓ other report layouts > offers an employee filter only when the report has an employee column
- ✓ import → save → match → export > saves location and roles as metadata and later reports add without wiping
- ✓ import → save → match → export > old backups without the new fields still restore
- ✓ import → save → match → export > matches calendar events, uses the project's location and exports the exact six columns

**tests/workflow.test.ts** (16)

- ✓ pasted calendar events > parses day headings, inline dates and ranges; never invents times
- ✓ pasted calendar events > delegates header rows (Outlook list copy) to the CSV parser
- ✓ pasted calendar events > time ranges
- ✓ matching priority > 1. exact project code wins
- ✓ matching priority > remembered rules come first and survive date changes in titles
- ✓ matching priority > own-company internal project doesn't steal client meetings
- ✓ matching priority > your own organisation's name alone never assigns time (projects imported without aliases)
- ✓ matching priority > 4. organizer domain gives a proposed match that needs confirmation
- ✓ matching priority > 5. fuzzy matches are suggestions only
- ✓ matching priority > unknown clients get a readable label
- ✓ ICS recurring, canceled and organizer domains > still expands the Outlook fixture and drops the user's own domain
- ✓ project configuration > imports incrementally without losing existing settings
- ✓ project configuration > restores v1 backups and round-trips v2 backups (with remembered matches)
- ✓ project configuration > sanitises hostile backup content
- ✓ project configuration > remembers confirmed matches by title
- ✓ regression: Nov 2–6 week (synthetic replica) > produces the same rows, hours and totals as the imported file

**tests/time.test.ts** (16)

- ✓ decimal hours > 15 minutes -> 0.25
- ✓ decimal hours > 30 minutes -> 0.50
- ✓ decimal hours > 45 minutes -> 0.75
- ✓ decimal hours > 60 minutes -> 1.00
- ✓ decimal hours > 90 minutes -> 1.50
- ✓ decimal hours > 135 minutes -> 2.25
- ✓ decimal hours > 180 minutes -> 3.00
- ✓ decimal hours > 210 minutes -> 3.50
- ✓ decimal hours > 225 minutes -> 3.75
- ✓ decimal hours > 480 minutes -> 8.00
- ✓ decimal hours > 110 minutes -> 1.83
- ✓ decimal hours > 100 minutes -> 1.67
- ✓ decimal hours > 5 minutes -> 0.08
- ✓ decimal hours > never produces H:MM
- ✓ decimal hours > parses user input
- ✓ time zones > round-trips across DST

**tests/ics.test.ts** (6)

- ✓ ICS parser > parses Windows TZIDs and converts to the target zone
- ✓ ICS parser > converts UTC times and keeps tentative status
- ✓ ICS parser > expands recurrences with EXDATE, moved and cancelled occurrences, limited to the period
- ✓ ICS parser > flags cancelled and all-day events and filters out-of-period events
- ✓ ICS parser > reports times in another zone when asked
- ✓ ICS parser > rejects non-calendar files

**tests/review.test.ts** (7)

- ✓ overlaps > finds clusters and measures clock time
- ✓ overlaps > splits overlap evenly
- ✓ overlaps > blocks export until resolved or confirmed
- ✓ validation > requires project, task, location, positive hours
- ✓ validation > rejects tasks not configured for the project
- ✓ validation > detects duplicates by fingerprint
- ✓ merge > combines same date/project/task

**tests/matching.test.ts** (8)

- ✓ matching > uses the CLIENT | TASK | DESCRIPTION convention
- ✓ matching > flags unknown tasks instead of guessing
- ✓ matching > uses single/default tasks and keyword aliases
- ✓ matching > flags ambiguity across clients
- ✓ matching > does not match partial words
- ✓ matching > excludes cancelled, all-day, keyword and free events
- ✓ matching > strips numeric prefixes
- ✓ pipe titles that are not the convention > uses the only task when the second segment is not a task

**tests/projector.test.ts** (19)

- ✓ project codes > validates the Projector format and keeps leading zeros
- ✓ project codes > flags OCR look-alikes instead of silently fixing them
- ✓ client and task extraction > Acme Components - Adaptive Planning - Implementation → Acme Components
- ✓ client and task extraction > Globex - Adaptive Planning - MSP → Globex
- ✓ client and task extraction > The Metro Public Library (MPL) - Adaptive Planning - Implementation → The Metro Public Library (MPL)
- ✓ client and task extraction > Smith-Jones Holdings - Adaptive Planning - Implementation → Smith-Jones Holdings
- ✓ client and task extraction > Smith - Jones LLC - Adaptive Planning - Implementation → Smith - Jones LLC
- ✓ client and task extraction > Northwind - Internal → Northwind
- ✓ client and task extraction > flags clients it can't separate
- ✓ client and task extraction > removes only recognised numeric prefixes and badges
- ✓ text parsing > finds every project with its tasks
- ✓ text parsing > keeps numbers when configured
- ✓ text parsing > handles messy copied text: tabs, extra spaces, bullets, multiple tasks per line
- ✓ text parsing > flags a missing code and a project without tasks
- ✓ text parsing > joins a project name wrapped onto two lines
- ✓ multiple screenshots > treats tasks at the top of a page as orphans with a continuation suggestion
- ✓ multiple screenshots > merges a project repeated across screenshots and unions tasks
- ✓ multiple screenshots > uses indentation: a task less indented than its project is marked uncertain
- ✓ multiple screenshots > flags an ambiguous duplicate of a valid code

**tests/export.test.ts** (5)

- ✓ BigTime CSV > has the exact header BigTime maps
- ✓ BigTime CSV > writes MM/DD/YYYY dates, decimal hours, codes and plain task names
- ✓ BigTime CSV > neutralises spreadsheet formulas
- ✓ BigTime CSV > names the file by period
- ✓ BigTime CSV > encodes ANSI (Windows-1252)

**tests/csv-calendar.test.ts** (3)

- ✓ Outlook CSV parser > reads the classic Outlook export
- ✓ Outlook CSV parser > parses times and dates
- ✓ Outlook CSV parser > supports generic Start/End columns

**tests/ocr.integration.test.ts** (5)

- ✓ OCR → Projector parser (real images) > reads a full project list
- ✓ OCR → Projector parser (real images) > reads a dark-mode screenshot (after inversion the same data is found)
- ✓ OCR → Projector parser (real images) > combines a multi-screenshot batch: continuation, overlap and merging
- ✓ OCR limits and calendar screenshots (real images) > a small, blurry, compressed screenshot never yields a wrong 'valid' code
- ✓ OCR limits and calendar screenshots (real images) > reads visible titles/times from an Outlook-style week view; no times are invented

## Real OCR integration output (synthetic screenshots)

```
projector-list-1 → [{"client":"Acme Components","code":"P001234-001","status":"valid","tasks":["Planning","Gears","Bearings","Precision Parts"]},{"client":"Globex Corporation","code":"P005678-001","status":"valid","tasks":["Planning Consultant"]},{"client":"Smith-Jones Holdings","code":"P002468-002","status":"valid","tasks":["Consultant"]},{"client":"Our Firm","code":"P000999-001","status":"valid","tasks":["Internal - Meeting"]}]
dark → [["P001234-001","valid",4],["P005678-001","valid",1],["P002468-002","valid",1],["P000999-001","valid",1]]
batch → [["Acme Components","P001234-001","Planning; Gears; Bearings; Precision Parts"],["Globex Corporation","P005678-001","Planning Consultant"],["Smith-Jones Holdings","P002468-002","Consultant"],["Our Firm","P000999-001","Internal - Meeting"],["The Metro Public Library (MPL)","P007979-001","Planning"],["Initech","P003141-001","Support; Integration; Training"],["Umbrella Health","P008080-003","Planning"]] orphans → ["Internal - Training"]
degraded → [["Acme Components","POG1223.001","ambiguous",["Banning","Goars","Barings"]],["Globex Curporution","","missing",["Planning Constant"]],["Sevth-Jones Holdings","PO02466-D02","ambiguous",["Consarant"]]]
calendar → [["2026-11-02","Acme Components | Gears | Forecast model","09:00","10:30"],["2026-11-03","Initech planning review","13:00","14:15"],["2026-11-04","Umbrella Health workshop",null,null],["2026-11-02","Globex Corporation weekly sync",null,null]]
```

## Excel onboarding end-to-end

- PASS  Excel report is the default onboarding option
- PASS  report parsed: 6 projects, 10 tasks
- PASS  report date range from Options sheet shown
- PASS  historical-report warning shown
- PASS  most common work location preselected
- PASS  default location taken from report
- PASS  projects saved with exact codes/tasks; Role kept as metadata only — P001234-001:4 P005678-001:1 P007979-001:1 P002468-002:1 P000999-001:2 P003141-001:1
- PASS  newer report added a project without removing saved ones — 7 projects
- PASS  exported CSV: exact six columns, codes, tasks, per-project location, decimal hours — BigTime_Timesheet_2026-11-02_to_2026-11-08.csv
- PASS  no requests to other hosts, no uploads — 10 same-origin GET requests
- PASS  real report in the browser — Detected 6 projects and 9 tasks. 6 verified, 1 location option(s)
- PASS  no page errors

Exact CSV produced (fictional data):

```
Description,Location,Project,Task,Work Date,Work Hours
Forecast model,Main Office,P001234-001,Gears,11/02/2026,3.25
Globex Corporation weekly sync,Main Office,P005678-001,Planning Consultant,11/02/2026,0.75
P002468-002 budget review,Remote,P002468-002,Consultant,11/03/2026,1.83
Data load,Main Office,P004242-001,Integration,11/04/2026,1.00
```

(`Remote` comes from that project's own Work Location in the report; `Data load` belongs to a project added from a newer report in the Match step.)

## Original workflow end-to-end

- PASS  first visit shows onboarding wizard
- PASS  browser OCR detects projects from 3 screenshots — Detected 7 projects and 12 tasks. in 2.8s
- PASS  orphan task assigned to suggested project after confirmation
- PASS  unknown meeting without a client hint is labelled clearly
- PASS  all remaining work matched
- PASS  overlap warning is specific — Two meetings overlap by 30 minutes
- PASS  first-time CSV matches expected BigTime format exactly — BigTime_Timesheet_2026-11-02_to_2026-11-08.csv
- PASS  setup success state shown — first-time workflow 5.526s (automated)
- PASS  returning user skips setup
- PASS  remembered match applied (only the excluded-before coffee chat needs a decision) — 1 group(s)
- PASS  returning-user CSV identical — returning workflow 1.099s (automated)
- PASS  ANSI export has same bytes for ASCII content
- PASS  incremental import adds new project and merges tasks — 9 projects; Acme tasks: Planning, Gears, Bearings, Precision Parts, Training
- PASS  v1 backup restores — [1,"Old Office"]
- PASS  no requests to any other host — 25 same-origin requests
- PASS  no uploads (no POST/PUT requests at all)
- PASS  OCR engine loaded from this site — /tesseract/worker.min.js, /tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js, /tesseract/lang/eng.traineddata.gz
- PASS  Content-Security-Policy restricts connections to this site
- PASS  axe: no serious/critical WCAG A/AA violations on timesheet
- PASS  axe: no serious/critical WCAG A/AA violations on projects
- PASS  axe: no serious/critical WCAG A/AA violations on help
- PASS  keyboard focus reaches navigation — Timesheet Converter
- PASS  mobile #home: no horizontal scroll — scrollWidth 390
- PASS  mobile #projects: no horizontal scroll — scrollWidth 390
- PASS  mobile #help: no horizontal scroll — scrollWidth 390
- PASS  no page errors

## Remaining limitations

- **A time-card report only lists what you've charged time to** in its date range and filters. New projects appear after you log time to them (or add them individually / from a newer report). The app warns about this and never invents projects or tasks.
- **Client names** are split from project names using spaced separators and known product words (e.g. “Adaptive Planning”, “Implementation”, “MSP”). Unusual names are flagged for you to confirm; abbreviations people use in meeting titles (e.g. initials) aren't in the report, so the first time such a meeting appears you pick the project once and it's remembered (or suggested when the initials match).
- **Report layout**: tested on your real report and synthetic variants (title rows, grouped rows, totals, reordered columns, `.xlsm`). A report missing the *Project* or *Task Name* column, or an old `.xls` file, is rejected with an explanation.
- **Excel library**: `read-excel-file` (maintained, browser-native). The official SheetJS build is distributed from its own CDN, which wasn't reachable from this build environment, and the npm `xlsx` package is outdated with known vulnerabilities, so it wasn't used.
- **Screenshot OCR** (projects or calendar) depends on image quality; uncertain values are flagged, never auto-corrected. Calendar screenshots only use times written in the image.
- **Browser storage** is per device/browser; use backup/restore to move between computers.
- **Vercel Drop** behaviour (creating a new project per drop; reusing the old `.vercel.app` name) couldn't be verified from this environment — see README.
