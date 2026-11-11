# Test results — Timesheet Converter 2.2.4

Run on the final code in this ZIP (Node 22, Chromium via Playwright, production build).

## Summary

| Suite | Result |
|---|---|
| Unit, PDF parser, Excel and OCR integration tests (Vitest) | **159 passed, 0 failed** (16 files; the three real-file tests are skipped unless local files are supplied) |
| End-to-end browser workflow (synthetic PDF + Excel, returning user, privacy, accessibility, mobile) | **39/39 passed** |
| Type check (`tsc --noEmit`) | **Passed** |
| Production build (`npm run build`) | **Passed** — static pages only; no API routes, no environment variables |
| Clean install of the ZIP contents with no AI variables (`npm ci`, `npm run build`, `npm test`) | **Passed** |

## Your real Outlook PDF (used locally only)

The attached Detailed agenda PDF was used only on the development machine, through `tests/pdf.private.test.ts` (`OUTLOOK_PDF=…`) and the optional real-file step of `e2e/workflows.mjs`. **It is not in this ZIP, the repository, `public/`, any fixture, log or screenshot.** Results (counts only):

- 15 pages; week 11/01/2026 – 11/07/2026 read from the PDF header; 5 day headings.
- **21 timed meetings**, **4 canceled** and **3 all-day** events (multi-day PTO collapsed to one event each); 0 warnings.
- Durations checked against the PDF, including a 110-minute meeting → `1.83` and 60-minute meetings → `1.00`.
- Titles split across page breaks and long attendee lists/descriptions were read correctly; Teams links, meeting IDs, passcodes and phone numbers do not appear in extracted descriptions.
- After the parser changes, this PDF still produces exactly the same events, times, titles, organizers and period (compared field by field).
- In the browser the same PDF showed *Meetings found 21 · Canceled 4 · All-day 3*.

## The coworker's 28-page PDF (no selectable text; used locally only, never stored)

Created by *Microsoft: Print To PDF* (no text layer — this is why it was rejected before text recognition existed).

- **Browser** (production build, Chromium): all **28 of 28 pages** read in 81 s; the progress showed *“Processing page 21 of 28 … 25 meetings identified so far”*; result **36 meetings**, with meetings from pages 21, 22, 23, 24, 26, 27 and 28; not marked incomplete.
- **Node** (`tests/ocr-pdf.private.test.ts`, same pipeline): 28/28 pages, 0 failed pages, 36 timed meetings (25 from pages 1–20, 11 from pages 21–28), 1 all-day, 1 canceled, 0 untitled, 0 duplicates, 0 uninterpretable lines, 4 overlaps detected, mean confidence 90%; every meeting flagged for checking.
- Spot-checked against the page images: dates/times on pages 20–28 match; the meeting alone on the last page (previously lost to the blank-page contrast bug) is now found; the wrapped canceled title on page 26 is recognised as canceled.

## End-to-end (`e2e/workflows.mjs`)

Synthetic, fictional data only (`tests/fixtures/pdf/agenda-week.pdf`, 6 pages).

- ✓ projects from the Excel report saved; location suggested from the report
- ✓ calendar step offers only the PDF upload
- ✓ calendar-grid PDF: read, but meetings not recognised (with a Print detailed agenda hint)
- ✓ image-only PDF: 'no selectable text' message, text recognition offered
- ✓ malformed PDF rejected
- ✓ extracted-meetings summary: 12 timed meetings, dates, 1 canceled, 2 all-day — MEETINGS FOUND 12 11.83 h scheduled · 6 PDF pages DATES COVERED 11/01/2026 – 11/07/2026 from the PDF header CANCELED 1 excluded by default ALL-DAY 2 PTO, holidays — excluded
- ✓ duplicate meeting reported and kept once
- ✓ excluded section lists canceled, all-day and personal items
- ✓ all included meetings matched
- ✓ overlap flagged with specific wording, nothing changed automatically
- ✓ export preview: Project Name left of Project Code, names from the Excel report — Acme Components - Adaptive Planning - Implementation / P001234-001 · name 332px > code 136px
- ✓ CSV: exact six columns, codes, tasks, locations, decimal hours — BigTime_Timesheet_2026-11-01_to_2026-11-07.csv
- ✓ CSV filename uses the PDF's date range — BigTime_Timesheet_2026-11-01_to_2026-11-07.csv
- ✓ setup success state — first-time run 5.665s (automated)
- ✓ remembered match reused (TFAG not asked again) — 3 group(s) left
- ✓ returning user: same CSV (ANSI encoding) — 2.209s (automated)
- ✓ no requests to other hosts and no uploads — 26 same-origin GET requests
- ✓ pdf.js worker served from this site
- ✓ CSP restricts connections to this site
- ✓ Help: six Projector tutorial steps with screenshots, current workflow only — 6 steps, 13 images
- ✓ Help: screenshots open enlarged and close
- ✓ axe: no serious/critical issues on #home
- ✓ axe: no serious/critical issues on #projects
- ✓ axe: no serious/critical issues on #help
- ✓ mobile #home: no horizontal scroll — scrollWidth 390
- ✓ mobile #projects: no horizontal scroll — scrollWidth 390
- ✓ mobile #help: no horizontal scroll — scrollWidth 390
- ✓ other Outlook date/time formats + browser header/footer import
- ✓ date and time on separate lines, page-spanning event import
- ✓ partly interpretable PDF: valid meetings imported, the rest listed and flagged
- ✓ readable but unrecognised: specific message + diagnostics without meeting content — Import diagnostics (no meeting content) | Pages	1 | Selectable text found	yes (1 of 1 pages)
- ✓ undecodable text identified separately
- ✓ image-only PDF read with on-device text recognition; every meeting flagged — 2.534s, 3 flagged
- ✓ long image-only PDF: live 'Processing page N of 24', progress bar, meeting count; cancel keeps pages read and marks the import incomplete — Processing page 5 of 24 · 4 meetings kept
- ✓ incomplete import is flagged in Review and blocks the CSV download
- ✓ retry reads only the remaining pages; all 24 pages and 24 meetings, no duplicates, no longer incomplete — MEETINGS FOUND 24 24.00 h scheduled · 24 PDF pages DATES COV
- ✓ real image-only PDF: every page read, meetings from pages 21+ included, not incomplete — 81s · at page 21: "Processing page 21 of 28 Rendering page… · 25 meetings identified so far Cancel " · MEETINGS FOUND 36 28.67 h scheduled · 28 PDF pages DATES COVERED 11/02 · meeting pages ≥21: 21,22,23,24,26,27,28
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

**tests/ocr-pdf.private.test.ts** (1)

- skipped: image-only Outlook agenda PDF read with text recognition (local only) > reads every page, including the ones after page 20

**tests/pdf-variants.test.ts** (22)

- ✓ date and time notations > Mon 2026-11-02 → 2026-11-02
- ✓ date and time notations > Mon 11/2/2026 → 2026-11-02
- ✓ date and time notations > Monday, November 2, 2026 → 2026-11-02
- ✓ date and time notations > Mon, Nov 2, 2026 → 2026-11-02
- ✓ date and time notations > Monday 2 November 2026 → 2026-11-02
- ✓ date and time notations > Tue 03/11/2026 → 2026-11-03
- ✓ date and time notations > 2-Nov-26 → 2026-11-02
- ✓ date and time notations > 11.02.2026 → 2026-02-11
- ✓ Outlook agenda variations (synthetic PDFs) > 1. original layout (regression): unchanged result
- ✓ Outlook agenda variations (synthetic PDFs) > 2. alternative date/time formats, bold same-size titles, icons, browser header/footer
- ✓ Outlook agenda variations (synthetic PDFs) > 3–6. titles split into fragments, date and time on separate lines, several events per page, an event spanning pages
- ✓ Outlook agenda variations (synthetic PDFs) > 7. canceled meetings are recognised; 8. overlapping meetings are detected
- ✓ Outlook agenda variations (synthetic PDFs) > classic layout: time column with the title beside it, date from the day heading
- ✓ Outlook agenda variations (synthetic PDFs) > per-glyph text without widths (some PDF printers) reads the same as normal text
- ✓ Outlook agenda variations (synthetic PDFs) > text items delivered in any order give the same result
- ✓ failures are told apart > 9. no selectable text (image-only PDF)
- ✓ failures are told apart > text that can't be decoded into characters
- ✓ failures are told apart > 10. readable text, but no meeting dates/times recognised — with diagnostics
- ✓ failures are told apart > the calendar grid is 'unrecognised' with a hint to tick Print detailed agenda
- ✓ failures are told apart > partly interpretable: valid meetings are imported, the rest is listed and flagged
- ✓ text recognition output > OCR lines become items; every meeting read this way is flagged for checking
- ✓ text recognition output > masked line shapes keep only the structure

**tests/pdf.private.test.ts** (1)

- skipped: real Outlook Detailed agenda PDF (local only) > parses every meeting cleanly

**tests/ocr-run.test.ts** (5)

- ✓ sequential page runner > processes every page of a long PDF one at a time — no page cap
- ✓ sequential page runner > a page that fails or times out is recorded and the run continues
- ✓ sequential page runner > cancel keeps the pages read so far; retrying the rest gives the same result as one full run, without duplicates
- ✓ sequential page runner > a missing page in the middle never joins a title to a time two pages away
- ✓ sequential page runner > page ranges

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

**tests/excel.test.ts** (21)

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
- ✓ other report layouts > accepts the recommended five-column report (optional Resource Display Name) with the same result
- ✓ other report layouts > Resource Display Name with two similar names asks which person to import
- ✓ other report layouts > offers an employee filter only when the report has an employee column
- ✓ import → save → match → export > saves location and roles as metadata and later reports add without wiping
- ✓ import → save → match → export > old backups without the new fields still restore
- ✓ import → save → match → export > matches calendar events, uses the project's location and exports the exact six columns

**tests/ocr.integration.test.ts** (5)

- ✓ OCR → Projector parser (real images) > reads a full project list
- ✓ OCR → Projector parser (real images) > reads a dark-mode screenshot (after inversion the same data is found)
- ✓ OCR → Projector parser (real images) > combines a multi-screenshot batch: continuation, overlap and merging
- ✓ OCR limits (real images) > a small, blurry, compressed screenshot never yields a wrong 'valid' code
- ✓ image-only calendar PDF → on-device text recognition → agenda parser > reads the meetings, and flags every one for checking

**tests/excel.private.test.ts** (1)

- skipped: real Projector report (local only) > parses the report

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

**tests/review.test.ts** (7)

- ✓ overlaps > finds clusters and measures clock time
- ✓ overlaps > splits overlap evenly
- ✓ overlaps > blocks export until resolved or confirmed
- ✓ validation > requires project, task, location, positive hours
- ✓ validation > rejects tasks not configured for the project
- ✓ validation > detects duplicates by fingerprint
- ✓ merge > combines same date/project/task

**tests/enhance.test.ts** (2)

- ✓ OCR image enhancement > keeps text visible on a mostly blank page (>99% background)
- ✓ OCR image enhancement > still stretches contrast on a normal page

**tests/preview.test.ts** (7)

- ✓ export preview: project name + code (from the imported Projector Excel report) > shows Project Name immediately left of Project Code, names taken from the report's Project column
- ✓ export preview: project name + code (from the imported Projector Excel report) > preview rows are the CSV rows with only the name column inserted
- ✓ export preview: project name + code (from the imported Projector Excel report) > the downloaded CSV is unchanged: six columns, project code only
- ✓ export preview: project name + code (from the imported Projector Excel report) > missing names show “Unknown project”, are flagged, and are never replaced by the code or client
- ✓ export preview: project name + code (from the imported Projector Excel report) > an unnamed duplicate mapping resolves the name from another saved mapping with the same code
- ✓ export preview: project name + code (from the imported Projector Excel report) > name survives a browser refresh and a restored configuration > localStorage save → load (refresh)
- ✓ export preview: project name + code (from the imported Projector Excel report) > name survives a browser refresh and a restored configuration > backup download → restore, and projects CSV export → import

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

**tests/matching.test.ts** (8)

- ✓ matching > uses the CLIENT | TASK | DESCRIPTION convention
- ✓ matching > flags unknown tasks instead of guessing
- ✓ matching > uses single/default tasks and keyword aliases
- ✓ matching > flags ambiguity across clients
- ✓ matching > does not match partial words
- ✓ matching > excludes cancelled, all-day, keyword and free events
- ✓ matching > strips numeric prefixes
- ✓ pipe titles that are not the convention > uses the only task when the second segment is not a task

**tests/export.test.ts** (5)

- ✓ BigTime CSV > has the exact header BigTime maps
- ✓ BigTime CSV > writes MM/DD/YYYY dates, decimal hours, codes and plain task names
- ✓ BigTime CSV > neutralises spreadsheet formulas
- ✓ BigTime CSV > names the file by period
- ✓ BigTime CSV > encodes ANSI (Windows-1252)

