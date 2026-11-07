# Test results — Timesheet Converter 2.2

Run on the final code in this ZIP (Node 22, Chromium via Playwright, production build).

## Summary

| Suite | Result |
|---|---|
| Unit, PDF parser, Excel and OCR integration tests (Vitest) | **120 passed, 0 failed** (11 files; the two real-file tests are skipped unless local files are supplied) |
| End-to-end browser workflow (synthetic PDF + Excel, returning user, privacy, accessibility, mobile) | **26/26 passed** |
| Type check (`tsc --noEmit`) | **Passed** |
| Production build (`npm run build`) | **Passed** — static pages only; no API routes, no environment variables |
| Clean install of the ZIP contents with no AI variables (`npm ci`, `npm run build`, `npm test`) | **Passed** |

## Your real Outlook PDF (used locally only)

The attached Detailed agenda PDF was used only on the development machine, through `tests/pdf.private.test.ts` (`OUTLOOK_PDF=…`) and the optional real-file step of `e2e/workflows.mjs`. **It is not in this ZIP, the repository, `public/`, any fixture, log or screenshot.** Results (counts only):

- 15 pages; week 11/01/2026 – 11/07/2026 read from the PDF header; 5 day headings.
- **21 timed meetings**, **4 canceled** and **3 all-day** events (multi-day PTO collapsed to one event each); 0 warnings.
- Durations checked against the PDF, including a 110-minute meeting → `1.83` and 60-minute meetings → `1.00`.
- Titles split across page breaks and long attendee lists/descriptions were read correctly; Teams links, meeting IDs, passcodes and phone numbers do not appear in extracted descriptions.
- With the real Projector report, all of the matching examples from the specification behaved as required (prep meeting → its project; a two-client session → the named client and task; a “Company | Client: …” session → the client; an internal status meeting → the client proposed with a billable/internal choice). Nothing was assigned to the internal project just because the company name appeared. (Client names are deliberately left out of this file.)
- In the browser the same PDF showed *Meetings found 21 · Canceled 4 · All-day 3*.

## End-to-end (`e2e/workflows.mjs`)

Synthetic, fictional data only (`tests/fixtures/pdf/agenda-week.pdf`, 6 pages).

- ✓ projects from the Excel report saved; location suggested from the report
- ✓ calendar step offers only the PDF upload
- ✓ calendar-grid PDF rejected with an explanation
- ✓ image-only PDF rejected with the required message
- ✓ malformed PDF rejected
- ✓ extracted-meetings summary: 12 timed meetings, dates, 1 canceled, 2 all-day — MEETINGS FOUND 12 11.83 h scheduled · 6 PDF pages DATES COVERED 11/01/2026 – 11/07/2026 from the PDF header CANCELED 1 excluded by default ALL-DAY 2 PTO, holidays — excluded
- ✓ duplicate meeting reported and kept once
- ✓ excluded section lists canceled, all-day and personal items
- ✓ all included meetings matched
- ✓ overlap flagged with specific wording, nothing changed automatically
- ✓ CSV: exact six columns, codes, tasks, locations, decimal hours — BigTime_Timesheet_2026-11-01_to_2026-11-07.csv
- ✓ CSV filename uses the PDF's date range — BigTime_Timesheet_2026-11-01_to_2026-11-07.csv
- ✓ setup success state — first-time run 4.362s (automated)
- ✓ remembered match reused (TFAG not asked again) — 3 group(s) left
- ✓ returning user: same CSV (ANSI encoding) — 2.018s (automated)
- ✓ no requests to other hosts and no uploads — 26 same-origin GET requests
- ✓ pdf.js worker served from this site
- ✓ CSP restricts connections to this site
- ✓ axe: no serious/critical issues on #home
- ✓ axe: no serious/critical issues on #projects
- ✓ axe: no serious/critical issues on #help
- ✓ mobile #home: no horizontal scroll — scrollWidth 390
- ✓ mobile #projects: no horizontal scroll — scrollWidth 390
- ✓ mobile #help: no horizontal scroll — scrollWidth 390
- ✓ real Outlook PDF in the browser — MEETINGS FOUND 21 14.67 h scheduled · 15 PDF pages DATES COVERED 11/01/2026 – 11/07/2026 from the PDF header CANCELED 4 excluded by default ALL-DAY 3 PTO, holidays — excluded
- ✓ no page errors

Exact CSV produced (identical on the returning-user run with ANSI encoding):

```
Description,Location,Project,Task,Work Date,Work Hours
Forecast model,Main Office,P001234-001,Gears,11/02/2026,3.00
Globex Corporation weekly sync,Main Office,P005678-001,Planning Consultant,11/02/2026,1.00
Smith-Jones Holdings quarterly forecast deep dive and budget reconciliation working session with the finance leadership team,Remote,P002468-002,Consultant,11/03/2026,1.83
TFAG Internal Status,Main Office,P000999-001,Internal - Meeting,11/04/2026,0.50
Late support call,Main Office,P005678-001,Planning Consultant,11/04/2026,1.00
Late support call,Main Office,P005678-001,Planning Consultant,11/05/2026,0.50
Globex - Preparing for Meeting,Main Office,P005678-001,Planning Consultant,11/05/2026,1.00
```

## Unit and integration tests

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

**tests/workflow.test.ts** (12)

- ✓ matching priority > 1. exact project code wins
- ✓ matching priority > remembered rules come first and survive date changes in titles
- ✓ matching priority > own-company internal project doesn't steal client meetings
- ✓ matching priority > your own organisation's name alone never assigns time (projects imported without aliases)
- ✓ matching priority > 4. organizer domain gives a proposed match that needs confirmation
- ✓ matching priority > 5. fuzzy matches are suggestions only
- ✓ matching priority > unknown clients get a readable label
- ✓ project configuration > imports incrementally without losing existing settings
- ✓ project configuration > restores v1 backups and round-trips v2 backups (with remembered matches)
- ✓ project configuration > sanitises hostile backup content
- ✓ project configuration > remembers confirmed matches by title
- ✓ regression: Nov 2–6 week (synthetic replica) > produces the same rows, hours and totals as the imported file

**tests/matching.test.ts** (8)

- ✓ matching > uses the CLIENT | TASK | DESCRIPTION convention
- ✓ matching > flags unknown tasks instead of guessing
- ✓ matching > uses single/default tasks and keyword aliases
- ✓ matching > flags ambiguity across clients
- ✓ matching > does not match partial words
- ✓ matching > excludes cancelled, all-day, keyword and free events
- ✓ matching > strips numeric prefixes
- ✓ pipe titles that are not the convention > uses the only task when the second segment is not a task

**tests/pdf.test.ts** (30)

- ✓ time and date parsing > 9:30 AM → 570
- ✓ time and date parsing > 12:00 PM → 720
- ✓ time and date parsing > 12:30 AM → 30
- ✓ time and date parsing > 1:30 PM → 810
- ✓ time and date parsing > 11:50 AM → 710
- ✓ time and date parsing > 13:45 → 825
- ✓ time and date parsing > 9.30 a.m. → 570
- ✓ time and date parsing > 0:00 → 0
- ✓ time and date parsing > rejects nonsense
- ✓ time and date parsing > dates
- ✓ time and date parsing > redacts links, passcodes, phone numbers and e-mail addresses
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > spans several pages and reads the printed range
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > extracts every timed meeting with full titles, dates and exact times — and nothing else
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > computes durations from minutes (110 → 1.83, 105 → 1.75)
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > marks canceled meetings
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > collapses multi-day all-day events repeated under every day, keeps single all-day events
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > removes an identical meeting printed twice and reports it
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > splits a meeting that crosses midnight by work date
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > keeps organizer, location and client e-mail domains; drops the user's own domain
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > keeps a redacted source snippet for troubleshooting
- ✓ Outlook Detailed agenda PDF (synthetic, multi-page) > does not depend on the order text items come out of the PDF
- ✓ page boundaries and edge layouts (constructed pages) > joins a title at the bottom of one page with its time line at the top of the next
- ✓ page boundaries and edge layouts (constructed pages) > handles an end time without AM/PM change, an end time past midnight without a second date, and 24-hour text
- ✓ unsupported PDFs are rejected, never guessed > calendar-grid print
- ✓ unsupported PDFs are rejected, never guessed > image-only PDF has no readable text
- ✓ unsupported PDFs are rejected, never guessed > malformed file
- ✓ PDF → matching → review → BigTime CSV > matches by convention, client name, organizer, e-mail domain and short names — never by your own company name
- ✓ PDF → matching → review → BigTime CSV > excludes canceled, all-day and personal items by default
- ✓ PDF → matching → review → BigTime CSV > flags the overlap and resolves it only by the user's choice
- ✓ PDF → matching → review → BigTime CSV > exports the exact six-column CSV after review

**tests/review.test.ts** (7)

- ✓ overlaps > finds clusters and measures clock time
- ✓ overlaps > splits overlap evenly
- ✓ overlaps > blocks export until resolved or confirmed
- ✓ validation > requires project, task, location, positive hours
- ✓ validation > rejects tasks not configured for the project
- ✓ validation > detects duplicates by fingerprint
- ✓ merge > combines same date/project/task

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

**tests/excel.private.test.ts** (1)

- skipped: real Projector report (local only) > parses the report

**tests/ocr.integration.test.ts** (4)

- ✓ OCR → Projector parser (real images) > reads a full project list
- ✓ OCR → Projector parser (real images) > reads a dark-mode screenshot (after inversion the same data is found)
- ✓ OCR → Projector parser (real images) > combines a multi-screenshot batch: continuation, overlap and merging
- ✓ OCR limits (real images) > a small, blurry, compressed screenshot never yields a wrong 'valid' code

**tests/pdf.private.test.ts** (1)

- skipped: real Outlook Detailed agenda PDF (local only) > parses every meeting cleanly

