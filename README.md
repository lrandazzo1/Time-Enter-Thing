# Timesheet Converter 2.0

Turn your Outlook calendar into a reviewed, import-ready **BigTime Enterprise PSA** (formerly Projector PSA) timesheet CSV — free, private, and without any AI service.

- **Import your projects from Projector** by scanning screenshots (local OCR), pasting copied text, or importing a backup/CSV.
- **Import your Outlook calendar** (.ics or .csv export, pasted events, manual entry, or — beta — calendar screenshots).
- **Match, review and approve** the hours you actually worked; the app remembers your choices for next week.
- **Download** `BigTime_Timesheet_YYYY-MM-DD_to_YYYY-MM-DD.csv` with the exact six-column format that imports into BigTime.

Everything runs in the browser. There is no server-side code, no database, no account, no API key and no environment variable. Screenshots and calendar files never leave the device: text recognition uses open-source [Tesseract.js](https://github.com/naptha/tesseract.js) served from this site's own `/tesseract/` folder, and the site's Content-Security-Policy (`connect-src 'self'`) blocks the page from sending data to any other server.

---

## Deploy with Vercel Drop (no GitHub, no Node.js needed)

The ZIP contains the complete Next.js app with `package.json` at its root. Vercel installs and builds it for you.

1. **Unzip** `timesheet-converter-v2.zip`. You get a folder (e.g. `timesheet-converter-v2`) containing `package.json`, `src/`, `public/` …
2. Open Vercel's **Drop** page (in the Vercel dashboard: **Add New → Project**, then the drag-and-drop / Drop option).
3. **Drag the unzipped folder** onto the drop area. Vercel detects **Next.js**, runs `npm install` and `npm run build`, and gives you a URL. No settings or environment variables are needed.
4. Open the URL and check: the page shows *Welcome to Timesheet Converter*, and **Projects → Import projects → Scan screenshots** reads a screenshot (the first scan downloads ~11 MB of OCR engine from your own site).

### Replacing your current deployment (`timesheet-converter-five.vercel.app`)

Vercel Drop creates a **new project** each time; it can't update the old project in place. Two things matter when switching:

**Keep your coworkers' saved projects.** Browser storage belongs to one web address. On the *same* address, version 2 automatically reads everything version 1 saved. On a *new* address, saved projects don't carry over — so before switching, ask everyone to open the old site and download a backup (*Projects & Tasks → Back up projects + settings*), then restore it in the new site (*Projects → Import projects → Import a file*).

**Keep the old URL (recommended):**
1. Deploy v2 with Drop as above and confirm it works on its new URL.
2. In the **old** project: *Settings → Domains* → remove `timesheet-converter-five.vercel.app` (or delete the old project under *Settings → Advanced*).
3. In the **new** project: *Settings → Domains* → add `timesheet-converter-five.vercel.app`.
4. Visit the old URL; it now serves v2 and existing browser data is picked up automatically.

If Vercel won't let you reuse that `.vercel.app` name, share the new URL and have people restore their backups there. (A custom domain, if you have one, can be moved between projects the same way.)

---

## For developers (optional)

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit + real OCR integration tests (Vitest)
npm run build      # production build (copies OCR assets first)
npm start          # serve the build
npm run e2e        # end-to-end browser tests against http://localhost:3000 (needs Playwright)
npm run make-fixtures   # regenerate the synthetic screenshot fixtures (needs Playwright)
```

`scripts/copy-ocr-assets.mjs` copies the Tesseract worker, WebAssembly cores and English model from `node_modules` into `public/tesseract/` (they are also included in the ZIP so a Drop deploy never depends on a CDN).

### Structure

```
src/app/                 Next.js App Router page, layout, global styles (static export, no API routes)
src/components/          UI: App shell, Onboarding wizard, ProjectImporter (scan/paste/file + verification),
                         ProjectsPage, GenerateTimesheet (Import → Match → Review → Download), MatchStep,
                         ReviewStep, ExportStep, SetupGuide (Help)
src/lib/ocr/             Tesseract.js wrapper (Web Worker), image preprocessing, engine-independent OCR types
src/lib/projector/       Projector parser: project codes, client extraction, task hierarchy, merging, review helpers
src/lib/parsers/         Outlook .ics (ical.js + Intl time zones), Outlook/generic .csv, pasted events, calendar-screenshot OCR
src/lib/matching.ts      Calendar → project/task matching (rules, code, convention, names, domains, fuzzy suggestions)
src/lib/fuzzy.ts         Fuzzy/acronym/domain helpers (suggestions only)
src/lib/review.ts        Overlaps, duplicates, merge, validation, totals
src/lib/exporters/       BigTime CSV exporter + RFC 4180 writer, formula-injection guard, UTF-8/ANSI encoding
src/lib/storage.ts       Browser-local persistence, backups (v1 + v2)
tests/                   Vitest unit tests, real OCR integration tests, synthetic fixtures
e2e/                     Playwright end-to-end checks (workflows, privacy, accessibility, mobile)
```

The Projector parser takes plain `SourceLine[]` (text with optional bounding boxes), so it works on OCR output and pasted text alike and doesn't depend on Tesseract.

### BigTime CSV (unchanged from the version that imported successfully)

Header `Description,Location,Project,Task,Work Date,Work Hours`; dates `MM/DD/YYYY`; hours decimal with two places, computed from minutes (3 h 30 min → `3.50`); task names without Projector's display numbers; text fields CSV-escaped and protected against spreadsheet formulas. Map in BigTime: Work Date → `mm/dd/yyyy`, Work Hours → `H,HHH.00`. Role and Rate Type are set in BigTime's Review Time step (see the in-app Help).

### Adding another timesheet platform

Implement `TimesheetExporter` (`src/lib/exporters/types.ts`) and register it in `src/lib/exporters/index.ts`.

---

## Privacy notes

- Calendar files, pasted text, screenshots, projects and timesheets are processed and stored only in the user's browser (localStorage / IndexedDB cache for the OCR model). Storage is per device and per browser and is erased when site data is cleared — users can download and restore a backup.
- No analytics, telemetry, error reporting, cookies, accounts, AI services or third-party requests.
- Browser-local storage is not an enterprise security control. Users should confirm their company permits using the tool with client information.
- No personal project data is bundled with the app; the screenshots in `public/guide/` are redacted, and the Projector example image uses fictional data.
