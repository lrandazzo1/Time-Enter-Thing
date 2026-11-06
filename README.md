# Timesheet Converter

Turn an Outlook calendar into a reviewed, import-ready **BigTime Enterprise PSA** (formerly Projector PSA) timesheet CSV.

1. Import an Outlook calendar file (`.ics` / `.csv`), screenshots (optional AI), or type entries.
2. Events are matched to *your* BigTime projects and tasks.
3. Review and correct every entry: hours, task, description, location, overlaps, duplicates.
4. Download `BigTime_Timesheet_YYYY-MM-DD_to_YYYY-MM-DD.csv` and import it in BigTime yourself.

Hours are always decimal (`3:30` of calendar time → `3.50`), computed from minutes and rounded once to hundredths.

---

## What works with and without AI

| Feature | Needs AI key? |
|---|---|
| Outlook `.ics` import (time zones incl. Windows TZIDs, recurring series, EXDATE, moved/cancelled occurrences) | No |
| Outlook `.csv` export import (classic "Export to a file", plus generic Title/Start/End CSVs) | No |
| `CLIENT \| TASK \| DESCRIPTION` naming convention + alias/keyword matching | No |
| Manual entry, editing, merging, exclusion, overlap & duplicate detection, totals | No |
| Projects & Tasks setup, CSV import/export, JSON backup | No |
| BigTime CSV export with validation, ANSI option, review summary | No |
| Read events from **calendar screenshots** | **Yes** (`ANTHROPIC_API_KEY`) |
| Read projects/tasks from **BigTime screenshots** | **Yes** (`ANTHROPIC_API_KEY`) |

Without a key the screenshot features show a clear "not set up" message; nothing is simulated.

---

## Run locally

Requires Node.js 20+.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000.

Optional, for screenshot recognition:

```bash
cp .env.example .env.local
```

Then put your key in `.env.local` (`ANTHROPIC_API_KEY=...`) and restart `npm run dev`.

Tests and production build:

```bash
npm test
```

```bash
npm run build && npm start
```

---

## Deploy (normal website URL)

The app is a standard Next.js app; any Node host works. Easiest is **Vercel**:

1. Push this folder to a GitHub repository (private is fine).
2. In Vercel: **Add New → Project → Import** the repository. Framework preset: Next.js. No build settings to change.
3. (Optional) **Settings → Environment Variables**:
   - `ANTHROPIC_API_KEY` — enables screenshot recognition.
   - `APP_ACCESS_CODE` — strongly recommended if the URL is public; coworkers enter it before screenshots are processed, so strangers can't spend your API credits.
   - `ANTHROPIC_MODEL` — optional override (default `claude-opus-5-5`).
4. Deploy. Share the `https://<project>.vercel.app` URL (or attach your own domain under **Settings → Domains**).

To restrict the whole site to your company, enable Vercel **Deployment Protection** (password or Vercel/SSO auth), or host it on an internal platform (Azure App Service with Entra ID authentication, an internal VM running `npm run build && npm start`, or a Docker container using `next start`).

Other hosts: Netlify, Azure Static Web Apps / App Service, Render, Railway — run `npm run build`, start with `npm start`, set the same environment variables. Keep request bodies ≥ 4 MB and function timeouts ≥ 60 s for screenshot recognition.

---

## API configuration (screenshot recognition)

1. Create an API key at https://console.anthropic.com (Settings → API keys). Add billing.
2. Set `ANTHROPIC_API_KEY` in the server environment (never in code, never with a `NEXT_PUBLIC_` prefix).
3. Redeploy. The Generate tab → **Screenshots** should now show the upload area instead of the setup notice.

How it works: the browser sends one screenshot per request to `/api/extract-events` (or `/api/extract-projects`). The server route calls Claude (`claude-opus-5-5`, structured JSON output, with Anthropic's server-side fallback enabled for declined requests) and returns transcribed events. The key exists only on the server. Every AI suggestion is validated against the user's own project list and shown flagged for review; unclear items are left blank, not guessed.

Cost is per screenshot (one vision request each). Images are re-encoded in the browser if needed to stay under ~3.4 MB.

---

## Privacy model

- Calendar files are parsed **in the browser**; they are never uploaded.
- Projects, settings and the draft timesheet are stored in the browser's `localStorage` for this site only. Each coworker has their own; nobody else's data is visible. No server database exists.
- Screenshots leave the browser only after the user ticks a consent box and clicks Extract. They are forwarded to Anthropic for that request with the user's client names/codes (for matching) and are not stored or logged by this app.
- Nothing is ever submitted to BigTime.

A hosted multi-user version that syncs settings across devices would need authenticated, per-user accounts and a database; the storage layer (`src/lib/storage.ts`) is isolated so it can be swapped.

---

## BigTime import mapping

The CSV header is `Description,Location,Project,Task,Work Date,Work Hours` — the same names as BigTime's fields. In BigTime **Import time → Map fields**:

| BigTime field | Column | Format |
|---|---|---|
| Description | Description | |
| Location | Location | |
| Project | Project | |
| Task | Task | |
| Work Date | Work Date | `mm/dd/yyyy` |
| Work Hours | Work Hours | `H,HHH.00` (change it from the `HH:MM` default) |

Leave Handy Info, Rate Type, Role, Activity and MSP Ticket Number blank; set Role/Rate in BigTime's Review step if your setup requires them. Save the mapping as **CSV Mapping** to reuse it. Task names must not include the sequence number BigTime displays (`3 Planning Consultant` → `Planning Consultant`); the app warns about and can strip these.

The in-app **Setup Guide** shows this with annotated (redacted) screenshots. Replace the images in `public/guide/` to update them.

---

## Validation before download

Every included row must have a valid date, hours > 0.00 (≤ 24), a configured project code and task, a location (when required), and no unresolved overlapping time or duplicate. Overlaps are "resolved" when the hours claimed fit within the real clock time (e.g. via **Split overlap evenly**) or the user confirms them. The user must also confirm the hours reflect time actually worked. Text fields are CSV-escaped and protected against spreadsheet formula injection (leading `= + - @` get an apostrophe).

---

## Project structure

```
src/app/                 Next.js app router (page, layout, API routes)
  api/status             reports whether AI is configured (no secrets)
  api/extract-events     calendar screenshot → events (server-side Claude call)
  api/extract-projects   BigTime screenshot → projects/tasks
src/components/          UI (Generate stepper, Review table, Export, Projects, Setup Guide)
src/lib/parsers/         ics.ts (ical.js + Intl time zones), csv.ts (Outlook CSV)
src/lib/matching.ts      convention/alias matching, exclusions, AI-hint validation
src/lib/review.ts        overlaps, duplicates, merge, validation, totals
src/lib/exporters/       timesheet platform exporters (BigTime) + CSV writer/encoder
src/lib/server/vision.ts Anthropic SDK wrapper (server only)
tests/                   Vitest unit tests + fixtures
```

### Adding another timesheet platform

Implement `TimesheetExporter` (`src/lib/exporters/types.ts`): columns, row mapping, platform checks, file name. Register it in `src/lib/exporters/index.ts`; it appears in the Export step's "Timesheet system" menu and reuses the whole import/review/validation workflow.
