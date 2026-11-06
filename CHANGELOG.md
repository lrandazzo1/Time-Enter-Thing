# Changelog

## 2.0.0 — Timesheet Converter 2.0

### Removed
- **All AI / Anthropic code.** Deleted the `/api/status`, `/api/extract-events` and `/api/extract-projects` server routes, the server-side vision helper, the client AI wrapper, the `@anthropic-ai/sdk` and `server-only` packages, `.env.example`, the access-code mechanism, and every AI setup instruction. The app now has **no server code, no API keys and no environment variables**, and builds as a fully static Next.js site.
- The old "Read projects from a BigTime screenshot (AI)" and "Calendar screenshots (AI)" features (replaced by local OCR below).

### Added — local, free OCR
- **Tesseract.js 7** running in a Web Worker in the browser (`src/lib/ocr/`). Worker, WebAssembly cores (plain/SIMD/relaxed-SIMD) and the English model are **self-hosted under `/tesseract/`** — no CDN, no uploads. The model is cached in the browser after the first scan.
- **Image preprocessing** (`src/lib/ocr/enhance.ts`): upscaling of small screenshots, grayscale, contrast stretch, automatic inversion of dark-mode screenshots. Shared by the browser and the Node tests.
- Progress reporting, cancel, worker termination and object-URL cleanup.
- **Content-Security-Policy** (`connect-src 'self'`, `wasm-unsafe-eval` only for the OCR engine) so the page cannot send data to other servers; long-lived caching for OCR assets.

### Added — Projector project import (the new first-time experience)
- **Import Your Projects** with three options: **Scan screenshots** (multiple, ordered, paste from clipboard), **Paste Projector text**, **Import a file** (v1/v2 JSON backups and project CSVs). Plus manual entry.
- **Projector parser** (`src/lib/projector/`), independent of the OCR engine:
  - project-code detection (`P000000-000`, leading zeros kept); OCR look-alikes (O/0, I/l/|/1, S/5, B/8, Z/2, odd dashes, spaces) are **flagged with a suggested correction, never silently changed**;
  - client extraction from "Client - Product - Engagement" names that splits only on spaced separators and uses known product/engagement words (handles `Smith-Jones Holdings`, `The Metro Public Library (MPL)`); uncertain splits are flagged; full project name kept separately;
  - task extraction with removal of Projector's numeric prefixes only (`2 Planning` → `Planning`, `11 Internal - Training` → `Internal - Training`), `LATE`-style badges removed when separate; optional setting to keep the numbers;
  - hierarchy recognition using line order and OCR bounding boxes (indentation); tasks less indented than their project are marked uncertain;
  - multi-screenshot handling: tasks at the top of a screenshot become **"tasks without a project"** with a one-click suggestion to attach them to the project that ended the previous screenshot; repeated projects are merged by verified code with tasks combined; ambiguous duplicates flagged;
  - wrapped project names joined; UI noise (search boxes, headers, dates) ignored; unrecognised lines listed for one-click assignment or dismissal; raw recognised text shown and editable, with "detect again".
- **Verification table**: editable client, full project name, code (with "use suggested code"), tasks (edit/remove/add missing), billable/internal, Verified/Review status, per-row problems, remove duplicate, **Approve all verified**, **Review uncertain** filter, **Save N projects**. Summary line, e.g. "Detected 7 projects and 12 tasks. 2 entries need review." Nothing is saved until approved.
- **Incremental imports**: new projects are added; existing ones keep their client name, type, default task and aliases and gain any new tasks. Unsaved review progress is saved and restored.

### Added — onboarding wizard
- Shown only when no projects are configured: **1 Import projects → 2 Confirm projects & tasks → 3 Set default location → 4 Import calendar → 5 Review & export**, with progress saved automatically, "Skip setup", "Skip — add projects while matching", a success screen, and **Restart setup wizard** on the Projects page. Existing v1 users with saved projects skip the wizard.

### Changed — matching for returning users
- Priority: **remembered matches** → **exact project code** in the title → `CLIENT | TASK | DESCRIPTION` convention → exact client name / alias → **organizer/attendee e-mail domain** (proposed, must be confirmed) → **fuzzy/acronym suggestions** (never applied automatically).
- The user's own internal project no longer captures client meetings that merely contain the company name; explicit aliases (e.g. "INTERNAL") still make a meeting ambiguous.
- **Remembered matches**: confirmed assignments are stored per meeting title and applied in later weeks; listed and removable on the Projects page; included in backups.
- New **Match work** step groups unresolved events by title and offers **Match existing project**, **Add new project**, **Paste Projector details**, **Upload Projector screenshot** and **Exclude event**; unknown clients are labelled ("Unrecognized project: Example Company").
- ICS import now reads organizer/attendee domains (the user's own company domain is ignored).

### Changed — calendar import
- Home screen leads with **Import your calendar**: Upload Outlook .ics/.csv (recommended), **Paste event information** (Outlook list-view rows with headers, or agenda text with day headings and time ranges), **Enter work manually**, **Calendar screenshot (beta)**.
- Calendar screenshots use local OCR; only times written in the image are used (block geometry is never converted into hours), dates inferred from day columns are flagged, and every screenshot event is marked for verification.
- Existing .ics/.csv behaviour (time zones incl. Windows TZIDs, recurrence, EXDATE, moved/canceled occurrences, exclusions) preserved.

### Changed — review & export
- Four-step flow: **Import calendar → Match work → Review hours → Download CSV**.
- Status per line: Proposed / Confirmed / Unmatched / Excluded / internal; **Approve** per line, **Approve all ready**; editing hours/project/task/date un-approves a line; **only approved lines can be exported**.
- **Split** an entry into two (e.g. two tasks in one block); specific overlap warnings ("Two meetings overlap by 30 minutes on …"); excluded rows shown struck-through.
- BigTime CSV export **unchanged** (six columns, order, formats, UTF-8/UTF-8-BOM/ANSI, formula protection) and covered by regression tests.

### Changed — interface, help, privacy
- Navigation simplified to **Timesheet · Projects · Help**; project count badge; "Runs on your device" indicator; skip link; improved colour contrast (WCAG AA); responsive layouts down to 390 px.
- **Help** rewritten: quick start, copying text from Projector, capturing screenshots (with a clearly labelled fictional illustration), Outlook export, BigTime mapping with redacted real screenshots, saving "CSV Mapping", **setting Role and Rate Type at Review time** (annotated), privacy/storage, limitations.
- Backups are now v2 (projects, settings, remembered matches); v1 backups and project CSVs still import. Backup data is sanitised on import. "Erase all data in this browser" added.

### Tests
- New: Projector parser, code ambiguity, client/task extraction, multi-page continuation/merging, paste events, matching priority, domains, fuzzy suggestions, remembered matches, incremental imports, backup v1/v2 and hostile input, synthetic Nov 2–6 regression, and **real image-to-text OCR integration tests** on synthetic Projector and Outlook screenshots.
- New Playwright end-to-end suite: first-time and returning workflows with in-browser OCR, exact CSV comparison, ANSI export, incremental import, v1 backup restore, network privacy audit, CSP check, axe accessibility, keyboard focus, mobile layout.
