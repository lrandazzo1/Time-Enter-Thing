/** A BigTime (or other platform) project the user is assigned to. */
export interface ProjectMapping {
  id: string;
  client: string;
  aliases: string[];
  code: string;
  tasks: string[];
  defaultTask: string;
  billable: boolean;
  /** Full Projector project name, e.g. "Acme Components - Adaptive Planning - Implementation". */
  fullName?: string;
  /** How the project entered the app. */
  source?: "screenshot" | "paste" | "file" | "manual";
}

/** A confirmed calendar-title → project/task assignment, reused in later weeks. */
export interface MatchRule {
  id: string;
  /** Normalized calendar title. */
  key: string;
  /** Original title, for display. */
  example: string;
  projectId: string;
  task: string;
  createdAt: string;
}

export interface Settings {
  /** IANA time zone that work dates/times are expressed in. */
  timeZone: string;
  /** Location value exactly as accepted by the user's BigTime installation. */
  defaultLocation: string;
  locationRequired: boolean;
  /** Case-insensitive keywords; matching events are excluded on import (still visible in review). */
  exclusionKeywords: string[];
  /** Day order used by Outlook CSV exports when a date is ambiguous. */
  csvDateOrder: "MDY" | "DMY" | "YMD";
  /** Keep Projector's numeric task prefixes ("2 Planning") in task names. Off by default: BigTime's importer rejects them. */
  keepTaskNumbers: boolean;
  /** First-time setup wizard state. */
  onboarding: "active" | "done" | "skipped";
  /** Which onboarding step the user reached (1-5). */
  onboardingStep: number;
}

export type BusyStatus = "busy" | "tentative" | "free" | "oof" | "elsewhere" | "unknown";
export type EntrySource = "ics" | "csv" | "screenshot" | "paste" | "manual";

export interface Interval {
  /** "HH:MM" 24-hour, in Settings.timeZone */
  start: string;
  end: string;
}

export interface ImportNote {
  code:
    | "tentative"
    | "free"
    | "all-day"
    | "canceled"
    | "excluded-keyword"
    | "ambiguous-project"
    | "no-project"
    | "task-unclear"
    | "convention-task-unmatched"
    | "default-task"
    | "missing-times"
    | "duplicate"
    | "crosses-midnight"
    | "outside-period"
    | "recurring"
    | "remembered"
    | "domain-match"
    | "fuzzy-suggestion"
    | "unknown-client"
    | "screenshot-time"
    | "screenshot-date"
    | "info";
  level: "info" | "warning";
  message: string;
}

/** One proposed timesheet line. Calendar data is only ever a *proposal* of time worked. */
export interface TimeEntry {
  id: string;
  source: EntrySource;
  sourceLabel?: string;
  /** Original calendar title (kept for reference; never exported). */
  title: string;
  /** "YYYY-MM-DD" */
  date: string;
  intervals: Interval[];
  /** Duration in minutes (may be fractional after manual decimal edits). */
  minutes: number;
  projectId: string | null;
  task: string;
  description: string;
  location: string;
  included: boolean;
  excludeReason?: string;
  status: BusyStatus;
  notes: ImportNote[];
  /** Project ids that matched when the mapping was ambiguous. */
  candidates?: string[];
  /** User confirmed overlapping time is correct as entered. */
  overlapAck?: boolean;
  /** User confirmed this is not a duplicate. */
  duplicateAck?: boolean;
  /** Fingerprint used for duplicate detection: date|start|end|normalized title */
  fingerprint?: string;
  /** User approved this line as time actually worked. */
  confirmed?: boolean;
  /** A suggested (not applied) project from fuzzy/domain matching. */
  suggestion?: { projectId: string; reason: string };
  /** Email domains of the organizer/attendees (calendar files only), used for matching hints. */
  domains?: string[];
}

/** Raw calendar event produced by a parser, before matching. */
export interface CalendarEvent {
  title: string;
  description: string;
  location: string;
  date: string;
  start: string | null;
  end: string | null;
  minutes: number | null;
  allDay: boolean;
  canceled: boolean;
  status: BusyStatus;
  recurring: boolean;
  crossesMidnight?: boolean;
  /** Organizer/attendee email domains (lowercase). */
  domains?: string[];
  /** Extra review notes produced by the parser (e.g. screenshot inference). */
  parseNotes?: { code: "screenshot-time" | "screenshot-date" | "info"; message: string }[];
  source: EntrySource;
  sourceLabel?: string;

}

export interface Period {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD inclusive
}

export type IssueLevel = "error" | "warning" | "info";
export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  entryId?: string;
}
