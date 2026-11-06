/** A BigTime (or other platform) project the user is assigned to. */
export interface ProjectMapping {
  id: string;
  client: string;
  aliases: string[];
  code: string;
  tasks: string[];
  defaultTask: string;
  billable: boolean;
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
}

export type BusyStatus = "busy" | "tentative" | "free" | "oof" | "elsewhere" | "unknown";
export type EntrySource = "ics" | "csv" | "screenshot" | "manual";

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
    | "ai-suggested"
    | "ai-disagrees"
    | "ai-low-confidence"
    | "missing-times"
    | "duplicate"
    | "crosses-midnight"
    | "outside-period"
    | "recurring"
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
  source: EntrySource;
  sourceLabel?: string;
  /** Screenshot-only AI hints (validated before use). */
  ai?: {
    projectCode: string;
    task: string;
    confidence: "high" | "medium" | "low";
    notes: string;
  };
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
