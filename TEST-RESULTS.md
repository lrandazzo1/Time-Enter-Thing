# Test results — Timesheet Converter 2.0

Run on the final code in this ZIP (Node 22, Chromium via Playwright).

## Summary

| Suite | Result |
|---|---|
| Unit + OCR integration tests (Vitest) | **84 passed, 0 failed** (9 files) |
| End-to-end browser checks (Playwright, production build) | **26/26 passed** |
| Production build (`npm run build`) | **Passed** — static pages only (`/`, `/_not-found`, `/icon.svg`); no API routes |
| Clean install from this ZIP with every Anthropic/AI variable removed (`npm ci`, `npm run build`, `npm test`) | **Passed** — no API keys or environment variables needed |
| Private regression against the real Nov 2–6 week (local only, not in this ZIP) | **Passed** — same 14 rows (date, project, task, hours, location) as the CSV that imported into BigTime |

## Unit and integration tests

**tests/ics.test.ts** (6)

- ✓ ICS parser > parses Windows TZIDs and converts to the target zone
- ✓ ICS parser > converts UTC times and keeps tentative status
- ✓ ICS parser > expands recurrences with EXDATE, moved and cancelled occurrences, limited to the period
- ✓ ICS parser > flags cancelled and all-day events and filters out-of-period events
- ✓ ICS parser > reports times in another zone when asked
- ✓ ICS parser > rejects non-calendar files

**tests/workflow.test.ts** (15)

- ✓ pasted calendar events > parses day headings, inline dates and ranges; never invents times
- ✓ pasted calendar events > delegates header rows (Outlook list copy) to the CSV parser
- ✓ pasted calendar events > time ranges
- ✓ matching priority > 1. exact project code wins
- ✓ matching priority > remembered rules come first and survive date changes in titles
- ✓ matching priority > own-company internal project doesn't steal client meetings
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

**tests/matching.test.ts** (8)

- ✓ matching > uses the CLIENT | TASK | DESCRIPTION convention
- ✓ matching > flags unknown tasks instead of guessing
- ✓ matching > uses single/default tasks and keyword aliases
- ✓ matching > flags ambiguity across clients
- ✓ matching > does not match partial words
- ✓ matching > excludes cancelled, all-day, keyword and free events
- ✓ matching > strips numeric prefixes
- ✓ pipe titles that are not the convention > uses the only task when the second segment is not a task

**tests/csv-calendar.test.ts** (3)

- ✓ Outlook CSV parser > reads the classic Outlook export
- ✓ Outlook CSV parser > parses times and dates
- ✓ Outlook CSV parser > supports generic Start/End columns

**tests/export.test.ts** (5)

- ✓ BigTime CSV > has the exact header BigTime maps
- ✓ BigTime CSV > writes MM/DD/YYYY dates, decimal hours, codes and plain task names
- ✓ BigTime CSV > neutralises spreadsheet formulas
- ✓ BigTime CSV > names the file by period
- ✓ BigTime CSV > encodes ANSI (Windows-1252)

**tests/ocr.integration.test.ts** (5)

- ✓ OCR → Projector parser (real images) > reads a full project list
- ✓ OCR → Projector parser (real images) > reads a dark-mode screenshot (after inversion the same data is found)
- ✓ OCR → Projector parser (real images) > combines a multi-screenshot batch: continuation, overlap and merging
- ✓ OCR limits and calendar screenshots (real images) > a small, blurry, compressed screenshot never yields a wrong 'valid' code
- ✓ OCR limits and calendar screenshots (real images) > reads visible titles/times from an Outlook-style week view; no times are invented

## Real OCR integration output

Synthetic, fictional screenshots in `tests/fixtures/` → the same preprocessing as the browser → Tesseract.js (local English model) → parsers.

```
projector-list-1 → [{"client":"Acme Components","code":"P001234-001","status":"valid","tasks":["Planning","Gears","Bearings","Precision Parts"]},{"client":"Globex Corporation","code":"P005678-001","status":"valid","tasks":["Planning Consultant"]},{"client":"Smith-Jones Holdings","code":"P002468-002","status":"valid","tasks":["Consultant"]},{"client":"Our Firm","code":"P000999-001","status":"valid","tasks":["Internal - Meeting"]}]
dark → [["P001234-001","valid",4],["P005678-001","valid",1],["P002468-002","valid",1],["P000999-001","valid",1]]
batch → [["Acme Components","P001234-001","Planning; Gears; Bearings; Precision Parts"],["Globex Corporation","P005678-001","Planning Consultant"],["Smith-Jones Holdings","P002468-002","Consultant"],["Our Firm","P000999-001","Internal - Meeting"],["The Metro Public Library (MPL)","P007979-001","Planning"],["Initech","P003141-001","Support; Integration; Training"],["Umbrella Health","P008080-003","Planning"]] orphans → ["Internal - Training"]
degraded → [["Acme Components","POG1223.001","ambiguous",["Banning","Goars","Barings"]],["Globex Curporution","","missing",["Planning Constant"]],["Sevth-Jones Holdings","PO02466-D02","ambiguous",["Consarant"]]]
calendar → [["2026-11-02","Acme Components | Gears | Forecast model","09:00","10:30"],["2026-11-03","Initech planning review","13:00","14:15"],["2026-11-04","Umbrella Health workshop",null,null],["2026-11-02","Globex Corporation weekly sync",null,null]]
```

Notes:
- `projector-list-1/2/3`: every project, code and task read correctly; the batch merges a project that spans screenshots 2–3 and offers the task at the top of screenshot 2 as a “task without a project” (suggested: the last project of screenshot 1).
- `projector-list-1-dark`: dark-mode screenshot read correctly after automatic inversion.
- `projector-list-1-degraded` (60% size + heavy JPEG): text is badly misread, but **no wrong code is ever marked valid** — the codes are flagged as ambiguous/missing and the rows land in *Review*. This is the documented limit of screenshot OCR.
- `calendar-week`: titles (including a wrapped title), explicit times and day columns are read; events whose block shows no time get **no hours** and are flagged.

## End-to-end checks (in-browser OCR, production build)

- PASS  first visit shows onboarding wizard
- PASS  browser OCR detects projects from 3 screenshots — Detected 7 projects and 12 tasks. in 2.8s
- PASS  orphan task assigned to suggested project after confirmation
- PASS  unknown meeting without a client hint is labelled clearly
- PASS  all remaining work matched
- PASS  overlap warning is specific — Two meetings overlap by 30 minutes
- PASS  first-time CSV matches expected BigTime format exactly — BigTime_Timesheet_2026-11-02_to_2026-11-08.csv
- PASS  setup success state shown — first-time workflow 5.388s (automated)
- PASS  returning user skips setup
- PASS  remembered match applied (only the excluded-before coffee chat needs a decision) — 1 group(s)
- PASS  returning-user CSV identical — returning workflow 1.123s (automated)
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

The automated first-time run (scan 3 screenshots → confirm → location → import calendar → match → review → download) completes in about 5–6 s and the returning-user run in about 1 s of browser time; real people need longer to read and decide, but the number of steps matches the targets (first-time setup well under five minutes, weekly flow under two minutes for straightforward weeks).

Privacy audit: every network request made during the whole run (including OCR) went to the app's own origin; there were no POST/PUT requests at all; the OCR worker, WebAssembly core and language model were served from `/tesseract/`; the Content-Security-Policy restricts connections to the site itself.

## Exact CSV verified

```
Description,Location,Project,Task,Work Date,Work Hours
Forecast model,Main Office,P001234-001,Gears,11/02/2026,3.25
Globex Corporation weekly sync,Main Office,P005678-001,Planning Consultant,11/02/2026,0.75
P002468-002 budget review,Main Office,P002468-002,Consultant,11/03/2026,1.83
Roadmap workshop,Main Office,P009999-001,Planning,11/04/2026,1.75
```

(Fictional data. 3.25/0.75 are the 12:00–12:30 overlap split evenly after the user clicked *Split overlap evenly*; 1.83 = 110 minutes.)

## Remaining limitations

- **Screenshot OCR depends on image quality.** Small, blurry, zoomed-out, heavily compressed or cropped screenshots produce misread or missing text. Uncertain codes, tasks and client names are flagged, never auto-corrected; pasting Projector text avoids OCR entirely.
- **The parser was built against the Projector layout described in the brief** (“Client - Product - Engagement P000000-000” rows followed by numbered tasks). It was tested on realistic synthetic screenshots, not on real Projector screenshots. A different Projector screen layout may need a small parser adjustment — the recognised text is shown so problems are visible.
- **Collapsed Projector rows can't be read.** Users must expand projects before capturing.
- **Calendar screenshots are approximate**: only times written in the image are used; most week-view blocks show no times, so hours must be entered. Calendar files remain the recommended input.
- **Client-name extraction** uses known product/engagement words; unusual naming may be flagged for review.
- **Browser storage** is per device/browser and can be cleared; there is no cross-device sync (backup/restore is provided).
- **First scan downloads ~11 MB** of OCR engine from the site (then cached). Browsers without WebAssembly can't scan.
- **Vercel Drop specifics** (where the Drop page lives, accepted upload formats, reusing an old `.vercel.app` name) could not be verified from this environment; the README describes the expected steps and a fallback.
- Accessibility was checked with axe-core (WCAG 2 A/AA, no serious/critical issues on the three main pages) and keyboard focus; it was not audited with a screen reader.
