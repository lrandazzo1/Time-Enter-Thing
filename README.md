# Timesheet Converter 2.2.3

Turn your Outlook calendar into a reviewed, import-ready **BigTime Enterprise PSA** (formerly Projector PSA) timesheet CSV — free, private, and without any AI service.

- **Import your projects from Projector** by uploading the original **Projector Excel report** (recommended), scanning screenshots of your project list (local OCR), pasting copied text, or importing a backup/CSV.
- **Import your Outlook calendar as a Detailed agenda PDF** — the only calendar import. The PDF's text is read in the browser with Mozilla's open-source [pdf.js](https://mozilla.github.io/pdf.js/); nothing is uploaded.
- **Review the extracted meetings, match them to projects, confirm the hours you actually worked**; the app remembers your choices for next week. Manual entries can be added at any time.
- **Download** `BigTime_Timesheet_YYYY-MM-DD_to_YYYY-MM-DD.csv` with the exact six-column format that imports into BigTime.

Everything runs in the browser.

## Weekly workflow

1. **Upload calendar PDF** — in Outlook: open Calendar → go to the week → **Home → Print** (or File → Print) → set the start/end dates → tick **Print detailed agenda** (or choose the *Detailed agenda* style) → printer **Save as PDF** (most reliable) or **Microsoft Print to PDF** → save → upload. The parser recognises several Outlook layouts (date and time on one line or on separate lines, a time column under day headings, US / day-first / ISO / month-name dates, 12- and 24-hour times, browser headers and footers). Failures are told apart: *no selectable text*, *text that can't be decoded*, *text read but meetings not recognised* (with content-free **import diagnostics** that can be copied), and *some meetings couldn't be interpreted* (the rest is imported and the problem lines are listed). For PDFs without usable text, optional **on-device text recognition** (Tesseract.js, self-hosted) reads the pages as images; every meeting read that way is flagged and must be approved individually.
2. **Review extracted meetings** — meetings found, dates covered, duplicates removed, overlaps flagged. Canceled meetings (“Canceled: …”) and all-day events (PTO, holidays) are excluded by default and listed separately; each can be included.
3. **Match projects** — saved rules, project codes, `CLIENT | TASK | DESCRIPTION` titles, project names and aliases, the organizer's company and e-mail domain, then fuzzy suggestions. Anything ambiguous is a manual choice; a project with one task is preselected, several tasks need confirmation. Your own company's name on its own never selects the internal project.
4. **Review hours** — edit date, description, project, task, start, end, hours and location; scheduled vs confirmed time; totals per day and project. Overlapping meetings are never counted twice: keep one meeting, split the overlap, exclude one, or edit the times.
5. **Download CSV** — after explicit confirmation; UTF-8 or ANSI (Windows-1252).

## Which Projector report employees should export

A **Time Card Report** from Projector, exported to **Excel** and uploaded unchanged:

The in-app **Help** page has an illustrated step-by-step version of this.

1. Projector → **Reports** → **Create New Report** → **Time Card Report**.
2. **Data Fields**: **Project**, **Role**, **Work Location**, **Task Name**, and optionally **Resource Display Name**. Other columns are ignored.
3. **Parameters**: a **Time Period** long enough to include every project you work on (e.g. last quarter), and your own name as the **Resource Search String**. Check the time card statuses (Approved is a good default).
4. **Save As** (e.g. “My Timesheet Projects”) → **Submit** → back on Reports select it → **Run**.
5. In **Report Output** select the completed report → **Save as XLSX (New)**, then in Timesheet Converter: **Projects → Import projects → Upload Projector Excel report** (or the first step of the setup wizard).

The importer uses the `Report` sheet (or any sheet with *Project* and *Task Name* columns), takes the project code from the final parentheses in the Project column (`Globex - Adaptive Planning - MSP (P005678-001)` → `P005678-001`), keeps task names exactly, suggests the location from *Work Location*, keeps *Role* only as reference, uses *Resource Display Name* (if present) only to let you pick yourself when a report contains several people, and shows the date range and filters from the `Options` sheet. A time card report is history, not an assignment list: projects you haven't charged time to in the date range won't be in it — upload a newer report later (also possible from the Match step) and new projects/tasks are merged into what's saved. `.xlsx` and `.xlsm` are read as data only; macros are never run. Menu names can vary slightly between Projector versions.

There is no server-side code, no database, no account, no API key and no environment variable. Calendar PDFs, Projector reports and screenshots never leave the device: the pdf.js worker is served from this site's own `/pdfjs/` folder, text recognition (project screenshots, and the optional fallback for calendar PDFs without text) uses open-source [Tesseract.js](https://github.com/naptha/tesseract.js) from `/tesseract/`, and the site's Content-Security-Policy (`connect-src 'self'`) blocks the page from sending data to any other server.

---

## Deploy with Vercel Drop (no GitHub, no Node.js needed)

The ZIP contains the complete Next.js app with `package.json` at its root. Vercel installs and builds it for you.

1. **Unzip** `timesheet-converter-pdf.zip`. You get a folder (`timesheet-converter-pdf`) containing `package.json`, `src/`, `public/` …
2. Open Vercel's **Drop** page (in the Vercel dashboard: **Add New → Project**, then the drag-and-drop / Drop option).
3. **Drag the unzipped folder** onto the drop area. Vercel detects **Next.js**, runs `npm install` and `npm run build`, and gives you a URL. No settings or environment variables are needed.
4. Open the URL and check: the page shows *Welcome to Timesheet Converter*; uploading a Projector report lists your projects; on the calendar step the only upload is **Upload Your Outlook Calendar PDF**.

### Redeploying over your current deployment (`timesheet-converter-five.vercel.app`)

Vercel Drop creates a **new project** each time; it can't update the old project in place. Two things matter when switching:

**Keep your coworkers' saved projects.** Browser storage belongs to one web address. On the *same* address, the new version automatically reads everything earlier versions saved. On a *new* address, saved projects don't carry over — so before switching, ask everyone to open the old site and download a backup (*Projects & Tasks → Back up projects + settings*), then restore it in the new site (*Projects → Import projects → Import a file*).

**Keep the old URL (recommended):**
1. Deploy this version with Drop as above and confirm it works on its new URL.
2. In the **old** project: *Settings → Domains* → remove `timesheet-converter-five.vercel.app` (or delete the old project under *Settings → Advanced*).
3. In the **new** project: *Settings → Domains* → add `timesheet-converter-five.vercel.app`.
4. Visit the old URL; it now serves the new version and existing browser data (projects, matching rules, settings) is picked up automatically. An unfinished week imported with an older version is kept; just upload the PDF to replace it.

If Vercel won't let you reuse that `.vercel.app` name, share the new URL and have people restore their backups there. (A custom domain, if you have one, can be moved between projects the same way.)

---

## For developers (optional)

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit, PDF parser, Excel and real OCR integration tests (Vitest)
npm run build      # production build (copies pdf.js + OCR assets first)
npm start          # serve the build
npm run e2e        # end-to-end browser tests against http://localhost:3000 (needs Playwright)
OUTLOOK_PDF=/path/to/agenda.pdf npx vitest run tests/pdf.private.test.ts            # optional check with a real PDF (never commit it)
PROJECTOR_REPORT=/path/to/real.xlsx npx vitest run tests/excel.private.test.ts      # optional check with a real report (never commit it)
python3 scripts/make-excel-fixtures.py      # regenerate the synthetic Excel fixtures (needs openpyxl)
npm run make-fixtures   # regenerate the synthetic screenshot and PDF fixtures (needs Playwright)
node scripts/make-pdf-variants.mjs   # regenerate the synthetic Outlook layout variants (needs Playwright)
```

`scripts/copy-assets.mjs` copies the pdf.js worker and standard fonts into `public/pdfjs/` and the Tesseract worker, WebAssembly cores and English model into `public/tesseract/` (both are also included in the ZIP so a Drop deploy never depends on a CDN).

### Structure

```
src/app/                 Next.js App Router page, layout, global styles (static export, no API routes)
src/components/          UI: App shell, Onboarding wizard, ProjectImporter (Excel/scan/paste/file + verification),
                         ProjectsPage, GenerateTimesheet (Upload PDF → Extracted meetings → Match → Review → Download),
                         ImportStep, ExtractStep, MatchStep, ReviewStep, ExportStep, SetupGuide (Help)
src/lib/pdf/             extract.ts (pdf.js in the browser, self-hosted worker), agenda.ts (Outlook Detailed agenda parser)
src/lib/ocr/             Tesseract.js wrapper (Web Worker), image preprocessing, engine-independent OCR types
src/lib/projector/       Projector Excel report import (excel.ts), text/OCR parser: codes, clients, tasks, hierarchy, merging
src/lib/matching.ts      Calendar → project/task matching (rules, code, convention, names, organizer, domains, fuzzy suggestions)
src/lib/fuzzy.ts         Fuzzy/acronym/domain helpers (suggestions only)
src/lib/review.ts        Overlaps, duplicates, merge, validation, totals
src/lib/exporters/       BigTime CSV exporter + RFC 4180 writer, formula-injection guard, UTF-8/ANSI encoding
src/lib/storage.ts       Browser-local persistence, backups (v1 + v2)
tests/                   Vitest unit tests, PDF/Excel/OCR integration tests, synthetic fixtures (fictional data only)
e2e/                     Playwright end-to-end checks (workflows, privacy, accessibility, mobile)
```

The Outlook agenda parser (`parseAgenda`) works on positioned text items, so it's tested in Node with the same pdf.js build the browser uses. It anchors on each event's date/time line, takes the title from the larger-font lines above it (across page breaks), reads Organizer/Location/attendee labels, ignores Teams links, meeting IDs, passcodes, phone numbers, e-mail addresses and signatures, collapses all-day events repeated on each day, removes exact duplicates, and splits events that run past midnight.

The Projector parser takes plain `SourceLine[]` (text with optional bounding boxes), so it works on OCR output and pasted text alike and doesn't depend on Tesseract.

### BigTime CSV (unchanged from the version that imported successfully)

Header `Description,Location,Project,Task,Work Date,Work Hours`; dates `MM/DD/YYYY`; hours decimal with two places, computed from minutes (3 h 30 min → `3.50`); task names without Projector's display numbers; text fields CSV-escaped and protected against spreadsheet formulas. Map in BigTime: Work Date → `mm/dd/yyyy`, Work Hours → `H,HHH.00`. Role and Rate Type are set in BigTime's Review Time step (see the in-app Help).

### Adding another timesheet platform

Implement `TimesheetExporter` (`src/lib/exporters/types.ts`) and register it in `src/lib/exporters/index.ts`.

---

## Privacy notes

- Calendar PDFs, Projector reports, screenshots, projects and timesheets are processed and stored only in the user's browser (localStorage / IndexedDB cache for the OCR model). The PDF file itself is never stored; only the extracted meetings for the current week are kept, with Teams links, meeting IDs, passcodes, phone numbers and e-mail addresses removed. The CSV contains only the six BigTime columns. Import diagnostics contain counts, the PDF producer name and masked line shapes (every letter and digit replaced) — never titles, attendees, links or passcodes — and are only shown on screen or copied by the user. Storage is per device and per browser and is erased when site data is cleared — users can download and restore a backup.
- No analytics, telemetry, error reporting, cookies, accounts, AI services or third-party requests.
- Browser-local storage is not an enterprise security control. Users should confirm their company permits using the tool with client information.
- No personal project or calendar data is bundled with the app; the screenshots in `public/guide/` are redacted, the Projector example image and all test fixtures and documentation screenshots use fictional data. Real PDFs/reports are only used locally through the optional `*.private.test.ts` checks and are never committed.
