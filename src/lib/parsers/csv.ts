import Papa from "papaparse";
import type { BusyStatus, CalendarEvent, Period, Settings } from "../types";
import { addDays, intervalMinutes, isValidISODate } from "../time";

export interface CsvParseResult {
  events: CalendarEvent[];
  warnings: string[];
  format: string;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

const HEADER_ALIASES: Record<string, string[]> = {
  subject: ["subject", "title", "summary", "eventtitle", "name", "event"],
  startDate: ["startdate", "date", "workdate", "day"],
  startTime: ["starttime", "from", "begin", "begintime"],
  endDate: ["enddate"],
  endTime: ["endtime", "to", "until", "finishtime"],
  start: ["start", "startdatetime", "starts", "dtstart"],
  end: ["end", "enddatetime", "ends", "dtend"],
  allDay: ["alldayevent", "allday", "isallday"],
  description: ["description", "body", "notes", "details"],
  location: ["location", "room"],
  showAs: ["showtimeas", "showas", "freebusy", "busystatus", "status"],
  duration: ["durationminutes", "minutes", "duration"],
  categories: ["categories", "category"],
};

/**
 * Parse calendar CSV files: the classic Outlook "Export to a file → Comma Separated Values"
 * format (Subject, Start Date, Start Time, End Date, End Time, All day event, …, Show time as)
 * and simpler generic layouts (Title/Start/End, or Date/Start Time/End Time).
 * Times in these files are wall-clock times; they are taken as-is in the user's time zone.
 */
export function parseCalendarCsv(text: string, period: Period, settings: Pick<Settings, "csvDateOrder">, sourceLabel?: string): CsvParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  if (parsed.data.length < 2) throw new Error("The CSV file has no data rows.");
  const header = parsed.data[0].map((h) => norm(String(h)));
  const col: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.subject === undefined) throw new Error('Could not find a "Subject" or "Title" column in this CSV.');
  const hasSplit = col.startDate !== undefined && col.startTime !== undefined;
  const hasCombined = col.start !== undefined;
  if (!hasSplit && !hasCombined) {
    throw new Error('Could not find start date/time columns. Expected Outlook columns ("Start Date", "Start Time", "End Date", "End Time") or "Start"/"End".');
  }
  const format = header.includes("showtimeas") || header.includes("meetingorganizer") ? "Outlook CSV export" : "Generic calendar CSV";

  const rows = parsed.data.slice(1);
  const order = detectDateOrder(rows, hasSplit ? [col.startDate, col.endDate] : [col.start, col.end], settings.csvDateOrder);
  const warnings: string[] = [];
  const events: CalendarEvent[] = [];

  rows.forEach((row, i) => {
    const get = (k: string) => (col[k] !== undefined ? String(row[col[k]] ?? "").trim() : "");
    const title = get("subject");
    if (!title && !get("startDate") && !get("start")) return;
    let sDate: string | null;
    let sTime: string | null;
    let eDate: string | null;
    let eTime: string | null;
    if (hasSplit) {
      sDate = parseDate(get("startDate"), order);
      sTime = parseTime(get("startTime"));
      eDate = parseDate(get("endDate"), order) ?? sDate;
      eTime = parseTime(get("endTime"));
    } else {
      [sDate, sTime] = parseDateTime(get("start"), order);
      [eDate, eTime] = parseDateTime(get("end"), order);
      eDate = eDate ?? sDate;
    }
    if (!sDate) {
      warnings.push(`Row ${i + 2}: could not read the date "${get("startDate") || get("start")}" — skipped.`);
      return;
    }
    const allDay = /^(true|yes|1)$/i.test(get("allDay")) || (!sTime && !eTime && !get("duration"));
    const canceled = /^\s*cancel+ed\s*:/i.test(title);
    const status = canceled ? "free" : showAs(get("showAs"));
    let start: string | null = null;
    let end: string | null = null;
    let minutes: number | null = null;
    let crosses = false;
    if (!allDay) {
      start = sTime;
      if (eTime) {
        end = eTime;
        if (eDate && eDate > sDate) {
          if (!(eDate === addDays(sDate, 1) && eTime === "00:00")) crosses = true;
          end = "24:00";
        }
      }
      const dur = get("duration");
      if (start && end) minutes = intervalMinutes(start, end);
      else if (start && dur && /^\d+(\.\d+)?$/.test(dur)) {
        minutes = Number(dur);
      }
      if (minutes !== null && minutes < 0) {
        warnings.push(`Row ${i + 2}: "${title}" ends before it starts — skipped.`);
        return;
      }
    }
    const ev: CalendarEvent = {
      title,
      description: get("description").slice(0, 2000),
      location: get("location").slice(0, 300),
      date: sDate,
      start,
      end,
      minutes,
      allDay,
      canceled,
      status,
      recurring: false,
      crossesMidnight: crosses,
      source: "csv",
      sourceLabel,
    };
    if (ev.date >= period.start && ev.date <= period.end) events.push(ev);
  });
  events.sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
  return { events, warnings, format };
}

function showAs(v: string): BusyStatus {
  const s = v.trim().toLowerCase();
  if (s === "0" || s === "free") return "free";
  if (s === "1" || s.startsWith("tentative")) return "tentative";
  if (s === "2" || s === "busy") return "busy";
  if (s === "3" || s.includes("out of office") || s === "oof") return "oof";
  if (s === "4" || s.includes("elsewhere")) return "elsewhere";
  return s ? "unknown" : "busy";
}

function detectDateOrder(rows: string[][], idxs: (number | undefined)[], fallback: Settings["csvDateOrder"]): Settings["csvDateOrder"] {
  for (const row of rows) {
    for (const idx of idxs) {
      if (idx === undefined) continue;
      const m = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/.exec(String(row[idx] ?? "").trim());
      if (!m) continue;
      if (m[1].length === 4) return "YMD";
      if (Number(m[1]) > 12) return "DMY";
      if (Number(m[2]) > 12) return "MDY";
    }
  }
  return fallback;
}

export function parseDate(raw: string, order: Settings["csvDateOrder"]): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const p = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(s.split(/[ T]/)[0]);
    if (!p) {
      const t = Date.parse(s);
      if (Number.isNaN(t)) return null;
      const dt = new Date(t);
      [y, m, d] = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
    } else {
      const [a, b, c] = [Number(p[1]), Number(p[2]), Number(p[3])];
      if (p[1].length === 4 || order === "YMD") [y, m, d] = [a, b, c];
      else if (order === "DMY") [d, m, y] = [a, b, c];
      else [m, d, y] = [a, b, c];
      if (y < 100) y += 2000;
    }
  }
  const out = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidISODate(out) ? out : null;
}

export function parseTime(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\./g, "");
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM|A|P)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[4];
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith("P") && h !== 12) h += 12;
    if (ap.startsWith("A") && h === 12) h = 0;
  }
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseDateTime(raw: string, order: Settings["csvDateOrder"]): [string | null, string | null] {
  const s = raw.trim();
  if (!s) return [null, null];
  const m = /^(\S+)[ T](.+)$/.exec(s);
  if (!m) return [parseDate(s, order), null];
  const timePart = m[2].replace(/(Z|[+-]\d{2}:?\d{2})$/, "").replace(/\.\d+$/, "");
  return [parseDate(m[1], order), parseTime(timePart)];
}
